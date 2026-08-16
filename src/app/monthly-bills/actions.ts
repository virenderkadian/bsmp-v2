"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { getCurrentCityId } from "@/lib/current-city";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { getCityCustomerLedger, receivedAgainstOpenBill } from "@/lib/bill-ledger";
import { buildBillPairs, computeClosingBalance, selectStaleDuplicateBills } from "@/lib/monthly-bills-math";

export type MonthlyBillActionState = {
  status: "idle" | "success" | "error";
  message?: string;
};

const idleState: MonthlyBillActionState = { status: "idle" };

const generateSchema = z.object({
  billingMonth: z.string().trim().min(1, "Billing month is required."),
});

const updateSchema = z.object({
  id: z.string().trim().min(1, "Bill is required."),
  status: z.enum(["DRAFT", "GENERATED", "LOCKED", "CANCELLED"]),
});

function getValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
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
  });

  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message };
  }

  return runAction(async () => {
    const { start, end } = getMonthBounds(parsed.data.billingMonth);
    const cityId = await getCurrentCityId();

    const entries = await prisma.dailyRouteEntry.findMany({
      where: {
        route: { cityId },
        entryDate: {
          gte: start,
          lt: end,
        },
      },
      select: {
        routeId: true,
        lines: {
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
    const customerLedger = await getCityCustomerLedger(prisma, cityId);

    const customers = await prisma.customer.findMany({
      where: { cityId },
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
          where: { route: { cityId }, billingMonth: start, status: "DRAFT" },
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

        await logAudit(tx, {
          cityId,
          entityType: "MonthlyBillBatch",
          action: "GENERATE",
          summary: `Generated/refreshed ${generatedCount} monthly bill${generatedCount === 1 ? "" : "s"} for ${parsed.data.billingMonth}${skippedLocked > 0 ? `, ${skippedLocked} locked bill(s) skipped` : ""}${staleBillIds.length > 0 ? `, ${staleBillIds.length} stale duplicate(s) removed` : ""}.`,
          after: {
            billingMonth: parsed.data.billingMonth,
            generatedCount,
            skippedLocked,
            staleDuplicatesRemoved: staleBillIds.length,
          },
        });
      },
      { timeout: 30_000, maxWait: 10_000 },
    );

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
