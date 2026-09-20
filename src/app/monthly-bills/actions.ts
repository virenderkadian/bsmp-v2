"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { getCurrentCityId } from "@/lib/current-city";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { getCityCustomerLedger, getSingleCustomerLedger, receivedAgainstOpenBill } from "@/lib/bill-ledger";
import { buildBillPairs, computeClosingBalance, selectStaleDuplicateBills } from "@/lib/monthly-bills-math";

export type MonthlyBillActionState = {
  status: "idle" | "success" | "error";
  message?: string;
};

const idleState: MonthlyBillActionState = { status: "idle" };

const generateSchema = z.object({
  billingMonth: z.string().trim().min(1, "Billing month is required."),
  // Present only for the "one customer" mode. Same action, same audit trail —
  // just every query in it scoped down to this one person instead of the
  // whole city.
  customerId: z.string().trim().optional(),
});

const updateSchema = z.object({
  id: z.string().trim().min(1, "Bill is required."),
  status: z.enum(["DRAFT", "GENERATED", "LOCKED", "CANCELLED"]),
});

const revertGeneratedSchema = z
  .object({
    billingMonth: z.string().trim().min(1, "Billing month is required."),
    scope: z.enum(["all", "route", "vehicle"]),
    routeId: z.string().trim().optional(),
    vehicleId: z.string().trim().optional(),
  })
  .refine((value) => value.scope !== "route" || !!value.routeId, {
    message: "Pick a route.",
    path: ["routeId"],
  })
  .refine((value) => value.scope !== "vehicle" || !!value.vehicleId, {
    message: "Pick a vehicle.",
    path: ["vehicleId"],
  });

function getValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function asOptional(value: string) {
  return value.trim() === "" ? undefined : value.trim();
}

function getMonthBounds(monthValue: string) {
  const start = new Date(`${monthValue}-01T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  return { start, end };
}

function getErrorMessage(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.message;
  }

  return error instanceof Error ? error.message : "Something went wrong.";
}

async function runAction(
  action: () => Promise<{ message?: string } | void>,
  successMessage: string,
  paths: string[] = [],
): Promise<MonthlyBillActionState> {
  try {
    const result = await action();
    revalidatePath("/monthly-bills");
    revalidatePath("/monthly-bills/summary");
    paths.forEach((path) => revalidatePath(path));
    return { status: "success", message: result?.message ?? successMessage };
  } catch (error) {
    return { status: "error", message: getErrorMessage(error) };
  }
}

export async function generateMonthlyBills(
  _prevState: MonthlyBillActionState = idleState,
  formData: FormData,
): Promise<MonthlyBillActionState> {
  void _prevState;

  const parsed = generateSchema.safeParse({
    billingMonth: getValue(formData, "billingMonth"),
    customerId: asOptional(getValue(formData, "customerId")),
  });

  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message };
  }

  return runAction(async () => {
    const { start, end } = getMonthBounds(parsed.data.billingMonth);
    const cityId = await getCurrentCityId();
    const customerId = parsed.data.customerId;

    // "One customer" mode: refuse before touching a single row rather than
    // silently falling back to their earliest sequence row. That fallback
    // exists for the whole-month batch, where nobody is looking at any one
    // person — here someone deliberately picked this customer, which is
    // exactly the moment to catch a missing billsHere instead of guessing.
    let targetCustomer: { code: string; name: string } | null = null;
    if (customerId) {
      const [customer, activeRows] = await Promise.all([
        prisma.customer.findFirst({
          where: { id: customerId, cityId },
          select: { code: true, name: true },
        }),
        prisma.monthlyRouteCustomerSequence.findMany({
          where: { customerId, route: { cityId }, sequenceMonth: start, status: "ACTIVE" },
          select: { billsHere: true },
        }),
      ]);

      if (!customer) {
        throw new Error("Customer not found in this city.");
      }

      targetCustomer = customer;

      // Refuse only the case that is actually ambiguous: on two or more routes
      // this month with none flagged billsHere. One route resolves on its own
      // (the same fallback the whole-month batch already relies on), and zero
      // rows is the ordinary "removed mid-month, still delivered" case, billed
      // on the delivery route by design — neither needs a human to intervene.
      const isAmbiguous = activeRows.length >= 2 && !activeRows.some((row) => row.billsHere);

      if (isAmbiguous) {
        throw new Error(
          `${customer.name} (${customer.code}) is on ${activeRows.length} routes this month with none ` +
            `confirmed as their billing route. Set it in Settings → Billing routes first.`,
        );
      }
    }

    const entries = await prisma.dailyRouteEntry.findMany({
      where: {
        route: { cityId },
        entryDate: {
          gte: start,
          lt: end,
        },
        ...(customerId ? { lines: { some: { customerId } } } : {}),
      },
      select: {
        routeId: true,
        lines: {
          where: customerId ? { customerId } : undefined,
          select: {
            customerId: true,
            productEntries: {
              select: {
                productId: true,
                quantity: true,
                rateSnapshot: true,
              },
            },
          },
        },
      },
    });

    // Collection ledger: how much each customer has paid that isn't already
    // frozen into a locked bill (see src/lib/bill-ledger.ts). This — not the
    // payment date — is what the open bill being generated collects.
    // City-wide for the whole-month batch — every customer's own entry is read
    // exactly once out of it. For one customer, that same shape (VERIFIED
    // payments and LOCKED bills across the whole city) would pull hundreds of
    // rows nobody reads to answer a question about one person, so this scopes
    // the equivalent lookup to just them instead of calling the shared helper.
    const customerLedger = customerId
      ? new Map([[customerId, await getSingleCustomerLedger(prisma, cityId, customerId)]])
      : await getCityCustomerLedger(prisma, cityId);

    const customers = await prisma.customer.findMany({
      where: { cityId, ...(customerId ? { id: customerId } : {}) },
      select: {
        id: true,
        openingBalance: true,
      },
    });

    // Running-ledger carry-forward: a bill's opening balance is the previous
    // statement's closing balance, so an unpaid amount rolls into the next
    // month and a payment received later (a common flow — bill first, collect
    // next month) reduces the running balance on that later statement. Keyed
    // by customer (not customer+route) so a mid-stream route change doesn't
    // drop the carried balance. Falls back to the customer's static opening
    // balance only when there's no earlier bill (their first month).
    const priorBills = await prisma.monthlyBill.findMany({
      where: {
        route: { cityId },
        billingMonth: { lt: start },
        ...(customerId ? { customerId } : {}),
      },
      orderBy: { billingMonth: "desc" },
      select: { customerId: true, closingBalance: true },
    });
    const priorClosingMap = new Map<string, number>();
    for (const priorBill of priorBills) {
      // Ordered newest-first, so the first entry seen per customer is the
      // latest prior bill's closing balance.
      if (!priorClosingMap.has(priorBill.customerId)) {
        priorClosingMap.set(priorBill.customerId, Number(priorBill.closingBalance));
      }
    }

    // Who SHOULD have a bill this month, per the route's monthly customer
    // sequence — the authoritative source, independent of whether they
    // happen to have any daily entries right now.
    const sequenceLines = await prisma.monthlyRouteCustomerSequence.findMany({
      where: {
        route: { cityId },
        sequenceMonth: start,
        status: "ACTIVE",
        ...(customerId ? { customerId } : {}),
      },
      // Oldest-first is REQUIRED, not cosmetic: when a multi-route customer has
      // no row flagged billsHere (nothing forces one to exist — the partial
      // unique index only forbids a second), resolveBillingRoutes falls back to
      // the earliest row. Without this ordering Postgres could hand generation
      // a different order than the Customer Summary uses, and the two would
      // disagree about which route the customer is billed on.
      orderBy: { createdAt: "asc" },
      // billsHere decides which route a multi-route customer's single combined
      // bill is issued against — see buildBillPairs.
      select: { customerId: true, routeId: true, billsHere: true },
    });

    const openingBalanceMap = new Map(
      customers.map((customer) => [customer.id, customer.openingBalance]),
    );
    const billMap = new Map<
      string,
      {
        customerId: string;
        routeId: string;
        deliveryAmount: number;
        items: Map<string, { qty: number; totalAmount: number; rateTotal: number; rateCount: number }>;
      }
    >();

    entries.forEach((entry) => {
      entry.lines.forEach((line) => {
        const key = `${line.customerId}:${entry.routeId}`;
        const current =
          billMap.get(key) ??
          {
            customerId: line.customerId,
            routeId: entry.routeId,
            deliveryAmount: 0,
            items: new Map(),
          };

        line.productEntries.forEach((productEntry) => {
          const qty = Number(productEntry.quantity);
          const rate = Number(productEntry.rateSnapshot);
          const total = qty * rate;

          current.deliveryAmount += total;

          const item =
            current.items.get(productEntry.productId) ?? {
              qty: 0,
              totalAmount: 0,
              rateTotal: 0,
              rateCount: 0,
            };

          item.qty += qty;
          item.totalAmount += total;
          item.rateTotal += rate;
          item.rateCount += 1;

          current.items.set(productEntry.productId, item);
        });

        billMap.set(key, current);
      });
    });

    let skippedLocked = 0;
    let generatedCount = 0;

    const billPairs = buildBillPairs(billMap, sequenceLines);

    await prisma.$transaction(
      async (tx) => {
        for (const bill of billPairs.values()) {
          const existing = await tx.monthlyBill.findUnique({
            where: {
              customerId_routeId_billingMonth: {
                customerId: bill.customerId,
                routeId: bill.routeId,
                billingMonth: start,
              },
            },
            select: { id: true, status: true },
          });

          // A locked bill has already been finalized for the customer/office —
          // regenerating must never silently overwrite it.
          if (existing?.status === "LOCKED") {
            skippedLocked += 1;
            continue;
          }

          const openingBalance = priorClosingMap.has(bill.customerId)
            ? (priorClosingMap.get(bill.customerId) ?? 0)
            : Number(openingBalanceMap.get(bill.customerId) ?? 0);
          // Collections attribute to the customer's open bill, not by payment
          // date: everything verified minus what's frozen into their locked
          // bills. That's why a payment entered in July (default date = today)
          // still lands on the June statement being generated.
          const paymentAmount = receivedAgainstOpenBill(customerLedger.get(bill.customerId));
          const closingBalance = computeClosingBalance(openingBalance, bill.deliveryAmount, paymentAmount);

          const savedBill = await tx.monthlyBill.upsert({
            where: {
              customerId_routeId_billingMonth: {
                customerId: bill.customerId,
                routeId: bill.routeId,
                billingMonth: start,
              },
            },
            update: {
              openingBalance,
              deliveryAmount: bill.deliveryAmount,
              paymentAmount,
              closingBalance,
              status: "GENERATED",
              generatedAt: new Date(),
            },
            create: {
              customerId: bill.customerId,
              routeId: bill.routeId,
              billingMonth: start,
              openingBalance,
              deliveryAmount: bill.deliveryAmount,
              paymentAmount,
              closingBalance,
              status: "GENERATED",
              generatedAt: new Date(),
            },
            select: { id: true },
          });

          await tx.monthlyBillItem.deleteMany({
            where: { monthlyBillId: savedBill.id },
          });

          const items = Array.from(bill.items.entries()).map(([productId, item]) => ({
            monthlyBillId: savedBill.id,
            productId,
            totalQty: item.qty,
            averageRate: item.rateCount === 0 ? 0 : item.rateTotal / item.rateCount,
            totalAmount: item.totalAmount,
          }));

          if (items.length > 0) {
            await tx.monthlyBillItem.createMany({
              data: items,
            });
          }

          generatedCount += 1;
        }

        // Sweep up bills stranded on a route that no longer bills the customer
        // — from a billing-route change, or from the route holding it being
        // removed from the sequence. Without this the customer keeps the old
        // bill AND gains a new one, which is the duplicate this whole change
        // exists to remove.
        //
        // DRAFT only: a GENERATED or LOCKED bill has been issued to someone and
        // must never be deleted by a routine regeneration. Those are surfaced
        // for a human decision instead.
        const draftBills = await tx.monthlyBill.findMany({
          where: {
            route: { cityId },
            billingMonth: start,
            status: "DRAFT",
            ...(customerId ? { customerId } : {}),
          },
          select: { id: true, customerId: true, routeId: true },
        });
        const staleBillIds = selectStaleDuplicateBills(
          draftBills,
          new Map([...billPairs.values()].map((bill) => [bill.customerId, bill.routeId])),
        );

        if (staleBillIds.length > 0) {
          await tx.monthlyBillItem.deleteMany({ where: { monthlyBillId: { in: staleBillIds } } });
          await tx.monthlyBill.deleteMany({ where: { id: { in: staleBillIds } } });
        }

        const summary = targetCustomer
          ? `Generated the ${parsed.data.billingMonth} bill for ${targetCustomer.name} (${targetCustomer.code})` +
            `${generatedCount === 0 ? " — nothing to bill" : ""}${skippedLocked > 0 ? " — their bill is Locked, left unchanged" : ""}.`
          : `Generated/refreshed ${generatedCount} monthly bill${generatedCount === 1 ? "" : "s"} for ${parsed.data.billingMonth}${skippedLocked > 0 ? `, ${skippedLocked} locked bill(s) skipped` : ""}${staleBillIds.length > 0 ? `, ${staleBillIds.length} stale duplicate(s) removed` : ""}.`;

        await logAudit(tx, {
          cityId,
          entityType: "MonthlyBillBatch",
          action: "GENERATE",
          summary,
          after: {
            billingMonth: parsed.data.billingMonth,
            ...(customerId ? { customerId } : {}),
            generatedCount,
            skippedLocked,
            staleDuplicatesRemoved: staleBillIds.length,
          },
        });
      },
      { timeout: 30_000, maxWait: 10_000 },
    );

    if (targetCustomer) {
      if (skippedLocked > 0) {
        return { message: `${targetCustomer.name}'s bill is Locked — left unchanged.` };
      }
      if (generatedCount === 0) {
        return { message: `${targetCustomer.name} has no deliveries to bill for ${parsed.data.billingMonth}.` };
      }
      return { message: `Bill generated for ${targetCustomer.name}.` };
    }

    if (skippedLocked > 0) {
      return {
        message: `Monthly bills generated. ${skippedLocked} locked bill${skippedLocked === 1 ? "" : "s"} left unchanged.`,
      };
    }
  }, "Monthly bills generated.");
}

export async function updateMonthlyBillStatus(
  _prevState: MonthlyBillActionState = idleState,
  formData: FormData,
): Promise<MonthlyBillActionState> {
  void _prevState;

  const parsed = updateSchema.safeParse({
    id: getValue(formData, "id"),
    status: getValue(formData, "status"),
  });

  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message };
  }

  return runAction(async () => {
    const cityId = await getCurrentCityId();
    const before = await prisma.monthlyBill.findUnique({ where: { id: parsed.data.id } });

    if (!before) {
      throw new Error("Bill not found.");
    }

    const nextStatus = parsed.data.status;

    // A status change is also the moment we (re)settle collections against this
    // bill. Locking freezes the amount currently collected; reverting to
    // DRAFT/GENERATED re-opens the bill and recomputes it live so a payment
    // added meanwhile is reflected. Cancelling just parks it — no money move.
    let data: Prisma.MonthlyBillUpdateInput = { status: nextStatus };

    if (nextStatus !== "CANCELLED") {
      const ledger = await getCityCustomerLedger(prisma, cityId);
      const entry = ledger.get(before.customerId);
      // Exclude THIS bill's own frozen amount when it's currently LOCKED, so a
      // LOCKED -> DRAFT revert gives its collections back to the open pool
      // instead of double-counting them.
      const otherLockedPaid =
        (entry?.lockedPaid ?? 0) - (before.status === "LOCKED" ? Number(before.paymentAmount) : 0);
      const paymentAmount = Math.max(0, (entry?.totalVerified ?? 0) - otherLockedPaid);
      const openingBalance = Number(before.openingBalance);
      const deliveryAmount = Number(before.deliveryAmount);
      data = {
        status: nextStatus,
        paymentAmount,
        closingBalance: computeClosingBalance(openingBalance, deliveryAmount, paymentAmount),
      };
    }

    const after = await prisma.monthlyBill.update({
      where: { id: parsed.data.id },
      data,
    });

    await logAudit(prisma, {
      cityId,
      entityType: "MonthlyBill",
      entityId: after.id,
      action: "STATUS_CHANGE",
      summary: `Monthly bill status changed from ${before.status} to ${after.status}.`,
      before,
      after,
    });
  }, "Monthly bill updated.", [`/monthly-bills/${parsed.data.id}`]);
}

// Bulk-reopen a month's bills for a fresh Generate — GENERATED only, never
// LOCKED. Locking is a deliberate freeze (money settled, the statement
// handed out); this is meant for "I generated too early / on the wrong
// scope", not for undoing a lock. Scoped to the whole city, one route, or
// every route under one vehicle (a vehicle can run a morning and an evening
// route, and both need to come back together).
export async function revertGeneratedBillsToDraft(
  _prevState: MonthlyBillActionState = idleState,
  formData: FormData,
): Promise<MonthlyBillActionState> {
  void _prevState;

  const parsed = revertGeneratedSchema.safeParse({
    billingMonth: getValue(formData, "billingMonth"),
    scope: getValue(formData, "scope"),
    routeId: getValue(formData, "routeId"),
    vehicleId: getValue(formData, "vehicleId"),
  });

  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message };
  }

  return runAction(async () => {
    const cityId = await getCurrentCityId();
    const { start: billingMonth } = getMonthBounds(parsed.data.billingMonth);

    let routeIds: string[] | null = null;
    let scopeLabel = "the whole city";

    if (parsed.data.scope === "route") {
      routeIds = [parsed.data.routeId as string];
      const route = await prisma.route.findFirst({
        where: { id: parsed.data.routeId, cityId },
        select: { code: true, name: true },
      });
      if (!route) {
        throw new Error("Route not found in this city.");
      }
      scopeLabel = `route ${route.code} - ${route.name}`;
    } else if (parsed.data.scope === "vehicle") {
      const vehicle = await prisma.vehicle.findFirst({
        where: { id: parsed.data.vehicleId, cityId },
        select: { code: true, name: true, routes: { select: { id: true } } },
      });
      if (!vehicle) {
        throw new Error("Vehicle not found in this city.");
      }
      routeIds = vehicle.routes.map((route) => route.id);
      scopeLabel = `vehicle ${vehicle.code} - ${vehicle.name}`;

      if (routeIds.length === 0) {
        return { message: `No routes are assigned to ${scopeLabel}.` };
      }
    }

    const result = await prisma.monthlyBill.updateMany({
      where: {
        route: { cityId, ...(routeIds ? { id: { in: routeIds } } : {}) },
        billingMonth,
        // GENERATED only. A LOCKED bill has already been handed to someone —
        // reopening it is a per-bill decision made from the bill itself
        // (updateMonthlyBillStatus above), never a bulk sweep.
        status: "GENERATED",
      },
      data: { status: "DRAFT" },
    });

    if (result.count === 0) {
      return { message: `No Generated bills to revert for ${scopeLabel}.` };
    }

    await logAudit(prisma, {
      cityId,
      entityType: "MonthlyBill",
      action: "STATUS_CHANGE",
      summary:
        `Reverted ${result.count} Generated bill${result.count === 1 ? "" : "s"} to Draft ` +
        `for ${scopeLabel}, ${parsed.data.billingMonth}. Locked bills were left unchanged.`,
      after: {
        billingMonth: parsed.data.billingMonth,
        scope: parsed.data.scope,
        routeId: parsed.data.routeId ?? null,
        vehicleId: parsed.data.vehicleId ?? null,
        revertedCount: result.count,
      },
    });

    return { message: `Reverted ${result.count} bill${result.count === 1 ? "" : "s"} to Draft.` };
  }, "", ["/monthly-bills", "/daily-entry"]);
}

