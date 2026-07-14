"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentCityId } from "@/lib/current-city";
import { logAudit } from "@/lib/audit";

export type DailyEntryActionState = {
  status: "idle" | "success" | "error";
  message?: string;
};

const idleState: DailyEntryActionState = { status: "idle" };

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
    // frozen snapshot with no link back to the source rows — if we let a
    // resave go through after generation, the bill's own totals stay correct
    // while the "what was delivered" trail silently disappears underneath
    // it. Block the save instead; the user can set the bill back to Draft,
    // correct the entry, then regenerate.
    const entryDateValue = new Date(parsed.data.entryDate);
    const billingMonthStart = new Date(
      Date.UTC(entryDateValue.getUTCFullYear(), entryDateValue.getUTCMonth(), 1),
    );
    const blockingBill = await prisma.monthlyBill.findFirst({
      where: {
        routeId: parsed.data.routeId,
        billingMonth: billingMonthStart,
        status: { in: ["GENERATED", "LOCKED"] },
      },
      select: { status: true },
    });

    if (blockingBill) {
      const cityId = await getCurrentCityId();
      await logAudit(prisma, {
        cityId,
        entityType: "DailyRouteEntry",
        action: "BLOCKED",
        summary: `Blocked daily entry save for route ${parsed.data.routeId} on ${parsed.data.entryDate}: bill already ${blockingBill.status}.`,
        after: { routeId: parsed.data.routeId, entryDate: parsed.data.entryDate, billStatus: blockingBill.status },
      });

      return {
        status: "error",
        message: `Bills for this route and month are already ${
          blockingBill.status === "LOCKED" ? "Locked" : "Generated"
        }. Set the bill status back to Draft on the Monthly Bills page before editing this date, then regenerate.`,
      };
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
