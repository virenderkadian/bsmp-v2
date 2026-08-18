"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentCityId } from "@/lib/current-city";
import { logAudit } from "@/lib/audit";
import { ABSENT_SIGNATURE, deliverySignature } from "@/lib/daily-entry-diff";

export type DailyEntryActionState = {
  status: "idle" | "success" | "error";
  message?: string;
  // Set when the save was refused purely because this route+month already has
  // Generated/Locked bills. The screen uses it to offer a one-click revert of
  // those bills to Draft (revertMonthBillsToDraft) instead of a dead end.
  blockedByBill?: boolean;
};

const idleState: DailyEntryActionState = { status: "idle" };

const revertSchema = z.object({
  routeId: z.string().trim().min(1, "Route is required."),
  entryDate: z.string().trim().min(1, "Date is required."),
});

const productLineSchema = z.object({
  productId: z.string().trim().min(1),
  quantity: z.coerce.number().min(0, "Quantity cannot be negative."),
  rateSnapshot: z.coerce.number().min(0, "Rate cannot be negative."),
});

const lineSchema = z.object({
  customerId: z.string().trim().min(1),
  sequenceNo: z.coerce.number().int().positive(),
  skipped: z.boolean(),
  remarks: z.string(),
  products: z.array(productLineSchema),
});

const entrySchema = z.object({
  routeId: z.string().trim().min(1, "Route is required."),
  entryDate: z.string().trim().min(1, "Entry date is required."),
  notes: z.string(),
  lines: z.array(lineSchema).min(1, "At least one customer line is required."),
});

function getKnownErrorMessage(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    return "An entry already exists for that route and date.";
  }

  return error instanceof Error ? error.message : "Something went wrong.";
}

export async function saveDailyEntry(
  _prevState: DailyEntryActionState = idleState,
  formData: FormData,
): Promise<DailyEntryActionState> {
  void _prevState;

  try {
    const routeId = String(formData.get("routeId") ?? "");
    const entryDate = String(formData.get("entryDate") ?? "");
    const notes = String(formData.get("notes") ?? "");

    const customerIds = formData.getAll("customerId").map(String);
    const sequenceNos = formData.getAll("sequenceNo").map(String);
    const skippedValues = new Set(formData.getAll("skipped").map(String));
    const remarksValues = formData.getAll("remarks").map(String);
    const productIds = formData.getAll("productId").map(String);
    const productCustomerIds = formData.getAll("productCustomerId").map(String);
    const quantities = formData.getAll("quantity").map(String);
    const rates = formData.getAll("rateSnapshot").map(String);

    const productsByCustomer = new Map<
      string,
      Array<{ productId: string; quantity: string; rateSnapshot: string }>
    >();

    productIds.forEach((productId, index) => {
      const customerId = productCustomerIds[index];
      const current = productsByCustomer.get(customerId) ?? [];
      current.push({
        productId,
        quantity: quantities[index] ?? "0",
        rateSnapshot: rates[index] ?? "0",
      });
      productsByCustomer.set(customerId, current);
    });

    const parsed = entrySchema.safeParse({
      routeId,
      entryDate,
      notes,
      lines: customerIds.map((customerId, index) => ({
        customerId,
        sequenceNo: sequenceNos[index],
        skipped: skippedValues.has(customerId),
        remarks: remarksValues[index] ?? "",
        products: productsByCustomer.get(customerId) ?? [],
      })),
    });

    if (!parsed.success) {
      return { status: "error", message: parsed.error.issues[0]?.message };
    }

    // Daily entry is destructive on save (deletes and rebuilds every line for
    // this route+date), but a bill generated from this month's entries is a
    // frozen snapshot with no link back to the source rows — if a resave
    // changed what was delivered, the bill's totals would stay while the trail
    // beneath them silently shifted. So we guard, but per-customer: block only
    // when a customer whose bill is already Generated/Locked would ACTUALLY
    // have their delivery change. Untouched frozen customers get rewritten to
    // identical values (a no-op for their bill) and pass straight through, so
    // correcting one customer no longer forces reverting the whole route.
    const entryDateValue = new Date(parsed.data.entryDate);
    const billingMonthStart = new Date(
      Date.UTC(entryDateValue.getUTCFullYear(), entryDateValue.getUTCMonth(), 1),
    );
    const guardCityId = await getCurrentCityId();

    // Read what's currently stored BEFORE the guard runs. Saving rebuilds the
    // whole route+date, so a customer present here and absent from the
    // submission is about to have their delivery deleted — and they have to be
    // checked too, not just the ones being written.
    const stored = await prisma.dailyRouteEntry.findUnique({
      where: {
        routeId_entryDate: {
          routeId: parsed.data.routeId,
          entryDate: entryDateValue,
        },
      },
      select: {
        lines: {
          select: {
            customerId: true,
            skipped: true,
            productEntries: {
              select: { productId: true, quantity: true, rateSnapshot: true },
            },
          },
        },
      },
    });

    // Everyone this save could affect: being written, or being removed.
    const affectedCustomerIds = [
      ...new Set([
        ...parsed.data.lines.map((line) => line.customerId),
        ...(stored?.lines.map((line) => line.customerId) ?? []),
      ]),
    ];

    // Matched by CUSTOMER rather than route. A customer running two routes gets
    // one combined bill, issued against whichever route is flagged billsHere,
    // so matching on routeId would miss a frozen bill sitting on their other
    // route and let this save quietly change the data behind an issued bill.
    const frozenBills = await prisma.monthlyBill.findMany({
      where: {
        customerId: { in: affectedCustomerIds },
        billingMonth: billingMonthStart,
        status: { in: ["GENERATED", "LOCKED"] },
        route: { cityId: guardCityId },
      },
      select: { customerId: true, status: true },
    });

    // Short-circuit: with nothing frozen, the diff is pointless — take the
    // exact same fast path as a route with no bills.
    if (frozenBills.length > 0) {

      const storedSignature = new Map<string, string>();
      stored?.lines.forEach((line) => {
        storedSignature.set(
          line.customerId,
          deliverySignature(
            line.skipped,
            line.productEntries.map((productEntry) => ({
              productId: productEntry.productId,
              quantity: Number(productEntry.quantity),
              rateSnapshot: Number(productEntry.rateSnapshot),
            })),
          ),
        );
      });

      const submittedSignature = new Map<string, string>();
      parsed.data.lines.forEach((line) => {
        submittedSignature.set(line.customerId, deliverySignature(line.skipped, line.products));
      });

      // A frozen customer only blocks the save if their bill-affecting delivery
      // actually differs between what's stored and what's being submitted.
      const changedFrozen = frozenBills.filter((bill) => {
        const before = storedSignature.get(bill.customerId) ?? ABSENT_SIGNATURE;
        const after = submittedSignature.get(bill.customerId) ?? ABSENT_SIGNATURE;
        return before !== after;
      });

      if (changedFrozen.length > 0) {
        const anyLocked = changedFrozen.some((bill) => bill.status === "LOCKED");
        await logAudit(prisma, {
          cityId: guardCityId,
          entityType: "DailyRouteEntry",
          action: "BLOCKED",
          summary: `Blocked daily entry save for route ${parsed.data.routeId} on ${parsed.data.entryDate}: ${changedFrozen.length} customer(s) with ${anyLocked ? "Locked" : "Generated"} bills would change.`,
          after: {
            routeId: parsed.data.routeId,
            entryDate: parsed.data.entryDate,
            changedCustomerIds: changedFrozen.map((bill) => bill.customerId),
          },
        });

        return {
          status: "error",
          blockedByBill: true,
          message: `${changedFrozen.length} customer${changedFrozen.length === 1 ? "" : "s"} on this route already ${
            anyLocked ? "have Locked" : "have Generated"
          } bills this month and your changes would alter them. Revert those customers' bills to Draft on the Monthly Bills page — or revert this whole route+month below — then edit and regenerate.`,
        };
      }
    }

    const cityId = await getCurrentCityId();

    await prisma.$transaction(async (tx) => {
      const entry = await tx.dailyRouteEntry.upsert({
        where: {
          routeId_entryDate: {
            routeId: parsed.data.routeId,
            entryDate: new Date(parsed.data.entryDate),
          },
        },
        update: {
          notes: parsed.data.notes.trim() || null,
          syncStatus: "DRAFT",
        },
        create: {
          routeId: parsed.data.routeId,
          entryDate: new Date(parsed.data.entryDate),
          notes: parsed.data.notes.trim() || null,
          syncStatus: "DRAFT",
        },
        select: {
          id: true,
          lines: {
            select: {
              id: true,
              customerId: true,
              productEntries: {
                select: { productId: true, quantity: true },
              },
            },
          },
        },
      });

      // Captured before the delete below, so a resave can tell "this
      // product was already 0 (or absent) and still is" — skip storing it —
      // apart from "this product had a real quantity before and is being
      // corrected to 0 now" — keep that as an explicit row rather than
      // letting the correction silently vanish.
      const previousQtyByCustomerProduct = new Map<string, number>();
      entry.lines.forEach((line) => {
        line.productEntries.forEach((productEntry) => {
          previousQtyByCustomerProduct.set(
            `${line.customerId}:${productEntry.productId}`,
            Number(productEntry.quantity),
          );
        });
      });

      if (entry.lines.length > 0) {
        await tx.dailyRouteEntryLineProduct.deleteMany({
          where: {
            lineId: {
              in: entry.lines.map((line) => line.id),
            },
          },
        });

        await tx.dailyRouteEntryLine.deleteMany({
          where: {
            entryId: entry.id,
          },
        });
      }

      for (const line of parsed.data.lines) {
        const createdLine = await tx.dailyRouteEntryLine.create({
          data: {
            entryId: entry.id,
            customerId: line.customerId,
            sequenceNo: line.sequenceNo,
            skipped: line.skipped,
            remarks: line.remarks.trim() || null,
          },
          select: {
            id: true,
          },
        });

        // A quantity that was never anything but 0 carries no information —
        // the edit form and every downstream reader (billing, reconciliation,
        // dashboards) already default a *missing* product row to 0 (see
        // src/lib/daily-entry.ts), so skipping it here is transparent and
        // meaningfully cuts row count (most customers only take a few of the
        // full product catalog on a given day). But a product that DID have
        // a real quantity before this save and is now being corrected down
        // to 0 keeps its row — that's a real edit worth a trail, not a
        // no-op, so it must not silently disappear.
        const productRows = line.products
          .filter((product) => {
            if (product.quantity > 0) {
              return true;
            }
            const previousQty = previousQtyByCustomerProduct.get(`${line.customerId}:${product.productId}`) ?? 0;
            return previousQty > 0;
          })
          .map((product) => ({
            lineId: createdLine.id,
            productId: product.productId,
            quantity: product.quantity,
            rateSnapshot: product.rateSnapshot,
          }));

        if (productRows.length > 0) {
          await tx.dailyRouteEntryLineProduct.createMany({
            data: productRows,
          });
        }
      }

      await logAudit(tx, {
        cityId,
        entityType: "DailyRouteEntry",
        entityId: entry.id,
        action: "SAVE",
        summary: `Saved daily entry for route ${parsed.data.routeId} on ${parsed.data.entryDate} (${parsed.data.lines.length} customer line${parsed.data.lines.length === 1 ? "" : "s"}).`,
        after: { routeId: parsed.data.routeId, entryDate: parsed.data.entryDate, lineCount: parsed.data.lines.length },
      });
    });

    revalidatePath("/daily-entry");
    return { status: "success", message: "Daily entry saved." };
  } catch (error) {
    return { status: "error", message: getKnownErrorMessage(error) };
  }
}

// Re-open a whole route+month's bills for editing in one click — the escape
// hatch offered from the Daily Entry block banner. The save guard itself is
// per-customer (it only blocks when a frozen customer's delivery actually
// changes), so per-customer reverts on the Monthly Bills page are the precise
// tool; this is the bulk convenience for "just reopen the month". Reverting to
// Draft returns each bill's collections to the open balance; regenerating (or
// re-locking) rebuilds them.
export async function revertMonthBillsToDraft(
  _prevState: DailyEntryActionState = idleState,
  formData: FormData,
): Promise<DailyEntryActionState> {
  void _prevState;

  const parsed = revertSchema.safeParse({
    routeId: String(formData.get("routeId") ?? ""),
    entryDate: String(formData.get("entryDate") ?? ""),
  });

  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message };
  }

  try {
    const entryDateValue = new Date(parsed.data.entryDate);
    const billingMonthStart = new Date(
      Date.UTC(entryDateValue.getUTCFullYear(), entryDateValue.getUTCMonth(), 1),
    );

    const cityId = await getCurrentCityId();
    const result = await prisma.monthlyBill.updateMany({
      where: {
        routeId: parsed.data.routeId,
        billingMonth: billingMonthStart,
        status: { in: ["GENERATED", "LOCKED"] },
      },
      data: { status: "DRAFT" },
    });

    if (result.count === 0) {
      return {
        status: "success",
        message: "No generated bills to revert — this date is already editable.",
      };
    }

    await logAudit(prisma, {
      cityId,
      entityType: "MonthlyBill",
      action: "STATUS_CHANGE",
      summary: `Reverted ${result.count} bill${result.count === 1 ? "" : "s"} to Draft to edit daily entry for route ${parsed.data.routeId} (${parsed.data.entryDate}).`,
      after: { routeId: parsed.data.routeId, entryDate: parsed.data.entryDate, revertedCount: result.count },
    });

    revalidatePath("/daily-entry");
    revalidatePath("/monthly-bills");
    return {
      status: "success",
      message: `${result.count} bill${result.count === 1 ? "" : "s"} reverted to Draft. You can edit and save now.`,
    };
  } catch (error) {
    return { status: "error", message: getKnownErrorMessage(error) };
  }
}
