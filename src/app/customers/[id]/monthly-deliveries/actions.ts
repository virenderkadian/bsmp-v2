"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentCityId } from "@/lib/current-city";
import { logAudit } from "@/lib/audit";
import { deliverySignature } from "@/lib/daily-entry-diff";
import { ABSENT_SIGNATURE, checkFrozenBillGuard, updateRecentOrderCache } from "@/lib/daily-entry-guard";
import type { DailyEntryActionState } from "@/app/daily-entry/actions";

const idleState: DailyEntryActionState = { status: "idle" };

function getKnownErrorMessage(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    return "Something else saved at the same time — reload and try again.";
  }

  return error instanceof Error ? error.message : "Something went wrong.";
}

const monthProductSchema = z.object({
  productId: z.string().trim().min(1),
  quantity: z.coerce.number().min(0, "Quantity cannot be negative."),
});

const monthLineSchema = z.object({
  lineId: z.string().trim().min(1),
  products: z.array(monthProductSchema),
});

const customerMonthSchema = z.object({
  customerId: z.string().trim().min(1, "Customer is required."),
  month: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}$/, "Month is required."),
  lines: z.array(monthLineSchema).min(1, "At least one date is required."),
});

// Edits one customer's own line for however many dates were changed in the
// month view, in a single save — never saveDailyEntry, which rebuilds EVERY
// customer's lines for a route+date and would silently wipe the rest of the
// route. Each line is re-fetched scoped to this customer and this city
// before anything is trusted from the client (same pattern as the earlier
// cross-city IDOR fix in payments/actions.ts): a tampered lineId can never
// touch another customer's, or another city's, delivery.
//
// Rate isn't editable from this screen — a quantity correction keeps
// whatever rate was already on that line for that product, and only a
// genuinely new product on that line falls back to the catalogue rate. This
// screen is for fixing wrong quantities, not re-pricing history.
export async function saveCustomerMonthEntries(
  _prevState: DailyEntryActionState = idleState,
  formData: FormData,
): Promise<DailyEntryActionState> {
  void _prevState;

  try {
    const customerId = String(formData.get("customerId") ?? "");
    const month = String(formData.get("month") ?? "");
    const lineIds = formData.getAll("lineId").map(String);
    const productIds = formData.getAll("productId").map(String);
    const productLineIds = formData.getAll("productLineId").map(String);
    const quantities = formData.getAll("quantity").map(String);

    const productsByLine = new Map<string, Array<{ productId: string; quantity: string }>>();
    productIds.forEach((productId, index) => {
      const lineId = productLineIds[index];
      const current = productsByLine.get(lineId) ?? [];
      current.push({ productId, quantity: quantities[index] ?? "0" });
      productsByLine.set(lineId, current);
    });

    const parsed = customerMonthSchema.safeParse({
      customerId,
      month,
      lines: lineIds.map((lineId) => ({
        lineId,
        products: productsByLine.get(lineId) ?? [],
      })),
    });

    if (!parsed.success) {
      return { status: "error", message: parsed.error.issues[0]?.message };
    }

    const cityId = await getCurrentCityId();

    const customer = await prisma.customer.findFirst({
      where: { id: parsed.data.customerId, cityId },
      select: { id: true },
    });

    if (!customer) {
      return { status: "error", message: "Customer not found in this city." };
    }

    const submittedLineIds = parsed.data.lines.map((line) => line.lineId);

    // Ownership + existence check for every submitted line in one query. A
    // lineId that doesn't resolve here — wrong customer, wrong city, or just
    // stale — fails the whole save rather than being silently skipped.
    const storedLines = await prisma.dailyRouteEntryLine.findMany({
      where: {
        id: { in: submittedLineIds },
        customerId: parsed.data.customerId,
        entry: { route: { cityId } },
      },
      select: {
        id: true,
        entry: { select: { entryDate: true } },
        productEntries: { select: { productId: true, quantity: true, rateSnapshot: true } },
      },
    });
    const storedById = new Map(storedLines.map((line) => [line.id, line]));

    const missingLineIds = submittedLineIds.filter((id) => !storedById.has(id));
    if (missingLineIds.length > 0) {
      return { status: "error", message: "One or more entries could not be found for this customer." };
    }

    const catalogue = await prisma.product.findMany({
      where: {
        cityId,
        id: { in: [...new Set(parsed.data.lines.flatMap((line) => line.products.map((p) => p.productId)))] },
      },
      select: { id: true, defaultRate: true },
    });
    const catalogueById = new Map(catalogue.map((product) => [product.id, product]));

    const resolvedLines = parsed.data.lines.map((line) => {
      const stored = storedById.get(line.lineId)!;
      const storedRateByProduct = new Map(
        stored.productEntries.map((productEntry) => [productEntry.productId, Number(productEntry.rateSnapshot)]),
      );

      // Drop any product id that isn't a real product in this city — never
      // write a line referencing a product that doesn't belong here.
      const resolvedProducts = line.products
        .filter((product) => catalogueById.has(product.productId))
        .map((product) => ({
          productId: product.productId,
          quantity: product.quantity,
          rateSnapshot:
            storedRateByProduct.get(product.productId) ?? Number(catalogueById.get(product.productId)!.defaultRate),
        }));

      return { lineId: line.lineId, entryDate: stored.entry.entryDate, products: resolvedProducts };
    });

    const billingMonth = new Date(`${parsed.data.month}-01T00:00:00.000Z`);

    const storedSignatureByLine = new Map<string, string>();
    storedLines.forEach((line) => {
      storedSignatureByLine.set(
        line.id,
        deliverySignature(
          false,
          line.productEntries.map((productEntry) => ({
            productId: productEntry.productId,
            quantity: Number(productEntry.quantity),
            rateSnapshot: Number(productEntry.rateSnapshot),
          })),
        ),
      );
    });

    const submittedSignatureByLine = new Map<string, string>();
    resolvedLines.forEach((line) => {
      submittedSignatureByLine.set(line.lineId, deliverySignature(false, line.products));
    });

    const guardResult = await checkFrozenBillGuard(prisma, {
      cityId,
      billingMonth,
      subjects: submittedLineIds.map((lineId) => ({
        key: lineId,
        customerId: parsed.data.customerId,
        storedSignature: storedSignatureByLine.get(lineId) ?? ABSENT_SIGNATURE,
        submittedSignature: submittedSignatureByLine.get(lineId) ?? ABSENT_SIGNATURE,
      })),
    });

    if (guardResult.blocked) {
      const blockedDates = [
        ...new Set(
          guardResult.changedKeys
            .map((lineId) => storedById.get(lineId)?.entry.entryDate.toISOString().slice(0, 10))
            .filter((date): date is string => Boolean(date)),
        ),
      ].sort();

      await logAudit(prisma, {
        cityId,
        entityType: "DailyRouteEntryLine",
        action: "BLOCKED",
        summary: `Blocked customer-month save for customer ${parsed.data.customerId} (${parsed.data.month}): ${blockedDates.length} date(s) with a ${guardResult.anyLocked ? "Locked" : "Generated"} bill would change (${blockedDates.join(", ")}).`,
        after: { customerId: parsed.data.customerId, month: parsed.data.month, blockedDates },
      });

      return {
        status: "error",
        blockedByBill: true,
        message: `This customer's ${guardResult.anyLocked ? "Locked" : "Generated"} bill for ${parsed.data.month} would change on ${blockedDates.length} date${blockedDates.length === 1 ? "" : "s"} (${blockedDates.join(", ")}). Revert the bill to Draft below, then save again.`,
      };
    }

    const recentOrderChanges: Array<{ customerId: string; productId: string; date: string; newQty: number }> = [];

    await prisma.$transaction(async (tx) => {
      for (const line of resolvedLines) {
        const stored = storedById.get(line.lineId)!;
        const previousQtyByProduct = new Map(
          stored.productEntries.map((productEntry) => [productEntry.productId, Number(productEntry.quantity)]),
        );

        await tx.dailyRouteEntryLineProduct.deleteMany({ where: { lineId: line.lineId } });

        // Same "a true zero-correction keeps its row, an always-zero product
        // doesn't" rule saveDailyEntry uses — see its own comment for why.
        const productRows = line.products
          .filter((product) => {
            if (product.quantity > 0) {
              return true;
            }
            return (previousQtyByProduct.get(product.productId) ?? 0) > 0;
          })
          .map((product) => ({
            lineId: line.lineId,
            productId: product.productId,
            quantity: product.quantity,
            rateSnapshot: product.rateSnapshot,
          }));

        if (productRows.length > 0) {
          await tx.dailyRouteEntryLineProduct.createMany({ data: productRows });
        }

        const entryDateStr = line.entryDate.toISOString().slice(0, 10);
        const touchedProductIds = new Set([
          ...previousQtyByProduct.keys(),
          ...line.products.map((product) => product.productId),
        ]);

        for (const productId of touchedProductIds) {
          const newQty = line.products.find((product) => product.productId === productId)?.quantity ?? 0;
          const previousQty = previousQtyByProduct.get(productId) ?? 0;

          if (newQty !== previousQty) {
            recentOrderChanges.push({ customerId: parsed.data.customerId, productId, date: entryDateStr, newQty });
          }
        }
      }

      await updateRecentOrderCache(tx, recentOrderChanges);

      const touchedDates = resolvedLines.map((line) => line.entryDate.toISOString().slice(0, 10)).sort();
      await logAudit(tx, {
        cityId,
        entityType: "DailyRouteEntryLine",
        action: "SAVE",
        summary: `Saved customer-month entries for customer ${parsed.data.customerId}, ${parsed.data.month} (${resolvedLines.length} date${resolvedLines.length === 1 ? "" : "s"}: ${touchedDates.join(", ")}).`,
        after: { customerId: parsed.data.customerId, month: parsed.data.month, dates: touchedDates },
      });
    });

    revalidatePath(`/customers/${parsed.data.customerId}/monthly-deliveries`);
    revalidatePath("/daily-entry");
    return { status: "success", message: "Entries saved." };
  } catch (error) {
    return { status: "error", message: getKnownErrorMessage(error) };
  }
}

const revertSchema = z.object({
  customerId: z.string().trim().min(1, "Customer is required."),
  month: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}$/, "Month is required."),
});

// Customer-scoped sibling of revertMonthBillsToDraft (src/app/daily-entry/actions.ts)
// — same shape, but matched by customerId rather than routeId, the same
// reasoning saveDailyEntry's own frozen-bill guard already uses: a customer
// can run two routes but has one combined bill, so a route-scoped revert
// could miss it.
export async function revertCustomerMonthBillToDraft(
  _prevState: DailyEntryActionState = idleState,
  formData: FormData,
): Promise<DailyEntryActionState> {
  void _prevState;

  const parsed = revertSchema.safeParse({
    customerId: String(formData.get("customerId") ?? ""),
    month: String(formData.get("month") ?? ""),
  });

  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message };
  }

  try {
    const cityId = await getCurrentCityId();
    const billingMonth = new Date(`${parsed.data.month}-01T00:00:00.000Z`);

    const customer = await prisma.customer.findFirst({
      where: { id: parsed.data.customerId, cityId },
      select: { id: true },
    });

    if (!customer) {
      return { status: "error", message: "Customer not found in this city." };
    }

    const result = await prisma.monthlyBill.updateMany({
      where: {
        customerId: parsed.data.customerId,
        billingMonth,
        status: { in: ["GENERATED", "LOCKED"] },
        route: { cityId },
      },
      data: { status: "DRAFT" },
    });

    if (result.count === 0) {
      return { status: "success", message: "No generated bill to revert — this month is already editable." };
    }

    await logAudit(prisma, {
      cityId,
      entityType: "MonthlyBill",
      action: "STATUS_CHANGE",
      summary: `Reverted ${result.count} bill${result.count === 1 ? "" : "s"} to Draft to edit customer-month entries for customer ${parsed.data.customerId} (${parsed.data.month}).`,
      after: { customerId: parsed.data.customerId, month: parsed.data.month, revertedCount: result.count },
    });

    revalidatePath(`/customers/${parsed.data.customerId}/monthly-deliveries`);
    revalidatePath("/monthly-bills");
    return {
      status: "success",
      message: `${result.count} bill${result.count === 1 ? "" : "s"} reverted to Draft. You can edit and save now.`,
    };
  } catch (error) {
    return { status: "error", message: getKnownErrorMessage(error) };
  }
}
