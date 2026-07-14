"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentCityId } from "@/lib/current-city";
import { logAudit } from "@/lib/audit";

export type ActionState = {
  status: "idle" | "success" | "error";
  message?: string;
};

const idleState: ActionState = { status: "idle" };

const stockEntrySchema = z.object({
  cycleDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "A valid date is required."),
  productId: z.string().trim().min(1, "Product is required."),
  givenQty: z.coerce.number().min(0, "Given quantity cannot be negative."),
  returnedQty: z.coerce.number().min(0, "Returned quantity cannot be negative."),
});

const saveStockSchema = z.object({
  vehicleId: z.string().trim().min(1, "Vehicle is required."),
  entriesJson: z.string().trim().min(2, "Add at least one row."),
});

const paymentSchema = z.object({
  vehicleId: z.string().trim().min(1, "Vehicle is required."),
  cycleDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "A valid date is required."),
  amount: z.coerce.number().positive("Amount must be greater than zero."),
  paymentDate: z.string().trim().min(1, "Payment date is required."),
  mode: z.enum(["CASH", "UPI", "BANK_TRANSFER", "CHEQUE"]),
  status: z.enum(["PENDING", "VERIFIED", "CANCELLED"]),
  referenceNo: z.string().trim().optional(),
  notes: z.string().trim().optional(),
});

function getValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function asOptional(value: string) {
  return value.trim() === "" ? undefined : value.trim();
}

function getErrorMessage(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.message;
  }

  return error instanceof Error ? error.message : "Something went wrong.";
}

function revalidateReconciliation() {
  revalidatePath("/reconciliation");
}

async function runAction(action: () => Promise<void>, successMessage: string): Promise<ActionState> {
  try {
    await action();
    revalidateReconciliation();
    return { status: "success", message: successMessage };
  } catch (error) {
    return { status: "error", message: getErrorMessage(error) };
  }
}

function parseEntries(entriesJson: string) {
  try {
    return JSON.parse(entriesJson);
  } catch {
    return null;
  }
}

// Handles both the quick "today's cycle" edit (one date, all reconciliation
// products) and multi-day catch-up entry (several dates at once) — both UIs
// serialize their rows into the same entriesJson shape.
export async function saveVehicleCycleStock(
  _prevState: ActionState = idleState,
  formData: FormData,
): Promise<ActionState> {
  void _prevState;

  const parsed = saveStockSchema.safeParse({
    vehicleId: getValue(formData, "vehicleId"),
    entriesJson: getValue(formData, "entriesJson"),
  });

  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message };
  }

  const entriesParsed = z.array(stockEntrySchema).safeParse(parseEntries(parsed.data.entriesJson));

  if (!entriesParsed.success || entriesParsed.data.length === 0) {
    return { status: "error", message: "Stock rows are invalid. Please reload and try again." };
  }

  return runAction(async () => {
    const cityId = await getCurrentCityId();

    await prisma.$transaction(async (tx) => {
      for (const entry of entriesParsed.data) {
        await tx.vehicleCycleStock.upsert({
          where: {
            vehicleId_productId_cycleDate: {
              vehicleId: parsed.data.vehicleId,
              productId: entry.productId,
              cycleDate: new Date(entry.cycleDate),
            },
          },
          update: {
            givenQty: entry.givenQty,
            returnedQty: entry.returnedQty,
          },
          create: {
            vehicleId: parsed.data.vehicleId,
            productId: entry.productId,
            cycleDate: new Date(entry.cycleDate),
            givenQty: entry.givenQty,
            returnedQty: entry.returnedQty,
          },
        });
      }

      await logAudit(tx, {
        cityId,
        entityType: "VehicleCycleStock",
        entityId: parsed.data.vehicleId,
        action: "SAVE",
        summary: `Saved ${entriesParsed.data.length} vehicle stock row${entriesParsed.data.length === 1 ? "" : "s"} for vehicle ${parsed.data.vehicleId}.`,
        after: { vehicleId: parsed.data.vehicleId, entries: entriesParsed.data },
      });
    });
  }, "Vehicle stock saved.");
}

export async function recordCashSalePayment(
  _prevState: ActionState = idleState,
  formData: FormData,
): Promise<ActionState> {
  void _prevState;

  const parsed = paymentSchema.safeParse({
    vehicleId: getValue(formData, "vehicleId"),
    cycleDate: getValue(formData, "cycleDate"),
    amount: getValue(formData, "amount"),
    paymentDate: getValue(formData, "paymentDate"),
    mode: getValue(formData, "mode"),
    status: getValue(formData, "status"),
    referenceNo: getValue(formData, "referenceNo"),
    notes: getValue(formData, "notes"),
  });

  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message };
  }

  return runAction(async () => {
    const cityId = await getCurrentCityId();
    const payment = await prisma.vehicleCashSalePayment.create({
      data: {
        vehicleId: parsed.data.vehicleId,
        cycleDate: new Date(parsed.data.cycleDate),
        amount: parsed.data.amount,
        paymentDate: new Date(parsed.data.paymentDate),
        mode: parsed.data.mode,
        status: parsed.data.status,
        referenceNo: asOptional(parsed.data.referenceNo ?? ""),
        notes: asOptional(parsed.data.notes ?? ""),
      },
    });

    await logAudit(prisma, {
      cityId,
      entityType: "VehicleCashSalePayment",
      entityId: payment.id,
      action: "CREATE",
      summary: `Recorded cash sale payment of ${payment.amount} for vehicle ${payment.vehicleId}.`,
      after: payment,
    });
  }, "Cash sale payment recorded.");
}
