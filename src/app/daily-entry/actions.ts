"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

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
            },
          },
        },
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

        const productRows = line.products.map((product) => ({
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
    });

    revalidatePath("/daily-entry");
    return { status: "success", message: "Daily entry saved." };
  } catch (error) {
    return { status: "error", message: getKnownErrorMessage(error) };
  }
}
