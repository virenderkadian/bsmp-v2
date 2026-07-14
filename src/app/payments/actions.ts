"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentCityId } from "@/lib/current-city";
import { logAudit } from "@/lib/audit";

export type PaymentActionState = {
  status: "idle" | "success" | "error";
  message?: string;
};

const idleState: PaymentActionState = { status: "idle" };

const paymentSchema = z.object({
  customerId: z.string().trim().min(1, "Customer is required."),
  routeId: z.string().trim().min(1, "Route is required."),
  amount: z.coerce.number().positive("Amount must be greater than zero."),
  paymentDate: z.string().trim().min(1, "Payment date is required."),
  mode: z.enum(["CASH", "UPI", "BANK_TRANSFER", "CHEQUE"]),
  status: z.enum(["PENDING", "VERIFIED", "CANCELLED"]),
  referenceNo: z.string().trim().optional(),
  notes: z.string().trim().optional(),
});

const paymentUpdateSchema = paymentSchema.extend({
  id: z.string().trim().min(1, "Payment is required."),
});

const paymentStatusSchema = z.object({
  id: z.string().trim().min(1, "Payment is required."),
  status: z.enum(["PENDING", "VERIFIED", "CANCELLED"]),
});

const bulkPaymentEntrySchema = z.object({
  customerId: z.string().trim().min(1, "Customer is required."),
  amount: z.coerce.number().positive("Amount must be greater than zero."),
});

const bulkPaymentSchema = z.object({
  routeId: z.string().trim().min(1, "Route is required."),
  billingMonth: z.string().trim().regex(/^\d{4}-\d{2}$/, "Billing month is required."),
  paymentDate: z.string().trim().min(1, "Payment date is required."),
  mode: z.enum(["CASH", "UPI", "BANK_TRANSFER", "CHEQUE"]),
  status: z.enum(["PENDING", "VERIFIED", "CANCELLED"]),
  referenceNo: z.string().trim().optional(),
  notes: z.string().trim().optional(),
  entriesJson: z.string().trim().min(2, "Add at least one payment row."),
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

function revalidatePaymentViews() {
  revalidatePath("/payments");
  revalidatePath("/payments/bulk-entry");
  revalidatePath("/monthly-bills");
  revalidatePath("/monthly-bills/summary");
  revalidatePath("/reconciliation");
}

async function runAction(
  action: () => Promise<void>,
  successMessage: string,
): Promise<PaymentActionState> {
  try {
    await action();
    revalidatePaymentViews();
    return { status: "success", message: successMessage };
  } catch (error) {
    return { status: "error", message: getErrorMessage(error) };
  }
}

function parseBulkEntries(entriesJson: string) {
  try {
    return JSON.parse(entriesJson);
  } catch {
    return null;
  }
}

function getBillingMonth(month: string) {
  return new Date(`${month}-01T00:00:00.000Z`);
}

export async function createPayment(
  _prevState: PaymentActionState = idleState,
  formData: FormData,
): Promise<PaymentActionState> {
  void _prevState;

  const parsed = paymentSchema.safeParse({
    customerId: getValue(formData, "customerId"),
    routeId: getValue(formData, "routeId"),
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
    const payment = await prisma.payment.create({
      data: {
        customerId: parsed.data.customerId,
        routeId: parsed.data.routeId,
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
      entityType: "Payment",
      entityId: payment.id,
      action: "CREATE",
      summary: `Recorded payment of ${payment.amount} for customer ${payment.customerId}.`,
      after: payment,
    });
  }, "Payment recorded.");
}

export async function updatePayment(
  _prevState: PaymentActionState = idleState,
  formData: FormData,
): Promise<PaymentActionState> {
  void _prevState;

  const parsed = paymentUpdateSchema.safeParse({
    id: getValue(formData, "id"),
    customerId: getValue(formData, "customerId"),
    routeId: getValue(formData, "routeId"),
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
    const before = await prisma.payment.findUnique({ where: { id: parsed.data.id } });
    const after = await prisma.payment.update({
      where: { id: parsed.data.id },
      data: {
        customerId: parsed.data.customerId,
        routeId: parsed.data.routeId,
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
      entityType: "Payment",
      entityId: after.id,
      action: "UPDATE",
      summary: `Updated payment for customer ${after.customerId}.`,
      before,
      after,
    });
  }, "Payment updated.");
}

export async function setPaymentStatus(
  _prevState: PaymentActionState = idleState,
  formData: FormData,
): Promise<PaymentActionState> {
  void _prevState;

  const parsed = paymentStatusSchema.safeParse({
    id: getValue(formData, "id"),
    status: getValue(formData, "status"),
  });

  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message };
  }

  return runAction(async () => {
    const cityId = await getCurrentCityId();
    const before = await prisma.payment.findUnique({ where: { id: parsed.data.id } });
    const after = await prisma.payment.update({
      where: { id: parsed.data.id },
      data: {
        status: parsed.data.status,
      },
    });

    await logAudit(prisma, {
      cityId,
      entityType: "Payment",
      entityId: after.id,
      action: "STATUS_CHANGE",
      summary: `Payment status changed from ${before?.status ?? "UNKNOWN"} to ${after.status}.`,
      before,
      after,
    });
  }, "Payment status updated.");
}

export async function createBulkRoutePayments(
  _prevState: PaymentActionState = idleState,
  formData: FormData,
): Promise<PaymentActionState> {
  void _prevState;

  const parsed = bulkPaymentSchema.safeParse({
    routeId: getValue(formData, "routeId"),
    billingMonth: getValue(formData, "billingMonth"),
    paymentDate: getValue(formData, "paymentDate"),
    mode: getValue(formData, "mode"),
    status: getValue(formData, "status"),
    referenceNo: getValue(formData, "referenceNo"),
    notes: getValue(formData, "notes"),
    entriesJson: getValue(formData, "entriesJson"),
  });

  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message };
  }

  const entriesParsed = z
    .array(bulkPaymentEntrySchema)
    .safeParse(parseBulkEntries(parsed.data.entriesJson));

  if (!entriesParsed.success) {
    return { status: "error", message: "Payment rows are invalid. Please reload and try again." };
  }

  const entries = entriesParsed.data.map((entry) => ({
    customerId: entry.customerId,
    amount: Number(entry.amount.toFixed(2)),
  }));
  const uniqueCustomerIds = new Set(entries.map((entry) => entry.customerId));

  if (entries.length === 0) {
    return { status: "error", message: "Add at least one payment row." };
  }

  if (uniqueCustomerIds.size !== entries.length) {
    return { status: "error", message: "A customer can be added only once in one bulk payment batch." };
  }

  const billingMonth = getBillingMonth(parsed.data.billingMonth);
  const totalAmount = entries.reduce((sum, entry) => sum + entry.amount, 0);

  return runAction(async () => {
    const cityId = await getCurrentCityId();

    await prisma.$transaction(async (transaction) => {
      const sequenceCustomers = await transaction.monthlyRouteCustomerSequence.findMany({
        where: {
          routeId: parsed.data.routeId,
          sequenceMonth: billingMonth,
          status: "ACTIVE",
          customerId: {
            in: entries.map((entry) => entry.customerId),
          },
        },
        select: {
          customerId: true,
        },
      });
      const validCustomerIds = new Set(sequenceCustomers.map((line) => line.customerId));

      if (validCustomerIds.size !== entries.length) {
        throw new Error("One or more customers are not active in the selected route/month sequence.");
      }

      const batch = await transaction.paymentBatch.create({
        data: {
          routeId: parsed.data.routeId,
          billingMonth,
          paymentDate: new Date(parsed.data.paymentDate),
          mode: parsed.data.mode,
          defaultStatus: parsed.data.status,
          totalAmount,
          referenceNo: asOptional(parsed.data.referenceNo ?? ""),
          notes: asOptional(parsed.data.notes ?? ""),
        },
        select: {
          id: true,
        },
      });

      await transaction.payment.createMany({
        data: entries.map((entry) => ({
          batchId: batch.id,
          customerId: entry.customerId,
          routeId: parsed.data.routeId,
          amount: entry.amount,
          paymentDate: new Date(parsed.data.paymentDate),
          mode: parsed.data.mode,
          status: parsed.data.status,
          referenceNo: asOptional(parsed.data.referenceNo ?? ""),
          notes: asOptional(parsed.data.notes ?? ""),
        })),
      });

      await logAudit(transaction, {
        cityId,
        entityType: "PaymentBatch",
        entityId: batch.id,
        action: "CREATE",
        summary: `Recorded ${entries.length} bulk route payments totaling ${totalAmount} for route ${parsed.data.routeId}.`,
        after: { batchId: batch.id, routeId: parsed.data.routeId, billingMonth, entries },
      });
    });
  }, `Saved ${entries.length} route payments.`);
}
