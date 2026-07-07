"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

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

    const entries = await prisma.dailyRouteEntry.findMany({
      where: {
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

    const verifiedPayments = await prisma.payment.findMany({
      where: {
        status: "VERIFIED",
        routeId: { not: null },
        paymentDate: {
          gte: start,
          lt: end,
        },
      },
      select: {
        customerId: true,
        routeId: true,
        amount: true,
      },
    });

    const customers = await prisma.customer.findMany({
      select: {
        id: true,
        openingBalance: true,
      },
    });

    const openingBalanceMap = new Map(
      customers.map((customer) => [customer.id, customer.openingBalance]),
    );
    const paymentMap = new Map<string, number>();
    const billMap = new Map<
      string,
      {
        customerId: string;
        routeId: string;
        deliveryAmount: number;
        items: Map<string, { qty: number; totalAmount: number; rateTotal: number; rateCount: number }>;
      }
    >();

    verifiedPayments.forEach((payment) => {
      if (!payment.routeId) {
        return;
      }

      const key = `${payment.customerId}:${payment.routeId}`;

      paymentMap.set(
        key,
        (paymentMap.get(key) ?? 0) + Number(payment.amount),
      );
    });

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

    await prisma.$transaction(
      async (tx) => {
        for (const bill of billMap.values()) {
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

          const openingBalance = Number(openingBalanceMap.get(bill.customerId) ?? 0);
          const paymentAmount = paymentMap.get(`${bill.customerId}:${bill.routeId}`) ?? 0;
          const closingBalance = openingBalance + bill.deliveryAmount - paymentAmount;

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
        }
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
    await prisma.monthlyBill.update({
      where: { id: parsed.data.id },
      data: {
        status: parsed.data.status,
      },
    });
  }, "Monthly bill updated.", [`/monthly-bills/${parsed.data.id}`]);
}
