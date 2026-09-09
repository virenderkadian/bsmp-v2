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

    // Today's rate, frozen onto each row as it is written. Reading it at
    // display time meant a rate change silently re-priced every past month's
    // cash sale — and therefore what a driver was recorded as owing.
    const rates = new Map(
      (
        await prisma.product.findMany({
          where: { cityId, id: { in: entriesParsed.data.map((entry) => entry.productId) } },
          select: { id: true, defaultRate: true },
        })
      ).map((product) => [product.id, product.defaultRate]),
    );

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
            rateSnapshot: rates.get(entry.productId),
          },
          create: {
            vehicleId: parsed.data.vehicleId,
            productId: entry.productId,
            cycleDate: new Date(entry.cycleDate),
            givenQty: entry.givenQty,
            returnedQty: entry.returnedQty,
            rateSnapshot: rates.get(entry.productId),
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

const paymentUpdateSchema = paymentSchema
  .omit({ vehicleId: true, cycleDate: true })
  .extend({ id: z.string().trim().min(1, "Deposit is required.") });

// Correcting a deposit that was typed wrong.
//
// Editing a verified deposit is deliberately allowed: these are small daily
// cash amounts, and a typo should not need cancelling and re-entering. The
// before/after in the audit trail is what makes that safe — it records what
// the figure was believed to be, and what it became.
export async function updateCashSalePayment(
  _prevState: ActionState = idleState,
  formData: FormData,
): Promise<ActionState> {
  void _prevState;

  const parsed = paymentUpdateSchema.safeParse({
    id: getValue(formData, "id"),
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

    // Scoped to this city rather than trusting the id alone — the deposit id
    // arrives from the browser.
    const before = await prisma.vehicleCashSalePayment.findFirst({
      where: { id: parsed.data.id, vehicle: { cityId } },
    });

    if (!before) {
      throw new Error("That deposit was not found in this city.");
    }

    const after = await prisma.vehicleCashSalePayment.update({
      where: { id: parsed.data.id },
      data: {
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
      entityId: after.id,
      action: "UPDATE",
      summary: `Changed a deposit for vehicle ${after.vehicleId} from ${before.amount} to ${after.amount}.`,
      before,
      after,
    });
  }, "Deposit updated.");
}

// Cancelling, not deleting.
//
// Every total already counts VERIFIED deposits only, so cancelling removes it
// from the maths without touching a single calculation — and the row survives,
// so the trail still shows that money was recorded and then withdrawn. A hard
// delete would erase the fact it ever happened, which is the one thing a money
// trail must not do.
export async function cancelCashSalePayment(
  _prevState: ActionState = idleState,
  formData: FormData,
): Promise<ActionState> {
  void _prevState;

  const id = getValue(formData, "id");

  if (!id) {
    return { status: "error", message: "Deposit is required." };
  }

  return runAction(async () => {
    const cityId = await getCurrentCityId();
    const before = await prisma.vehicleCashSalePayment.findFirst({
      where: { id, vehicle: { cityId } },
    });

    if (!before) {
      throw new Error("That deposit was not found in this city.");
    }

    const after = await prisma.vehicleCashSalePayment.update({
      where: { id },
      data: { status: "CANCELLED" },
    });

    await logAudit(prisma, {
      cityId,
      entityType: "VehicleCashSalePayment",
      entityId: after.id,
      action: "CANCEL",
      summary: `Cancelled a deposit of ${after.amount} for vehicle ${after.vehicleId}.`,
      before,
      after,
    });
  }, "Deposit cancelled.");
}
