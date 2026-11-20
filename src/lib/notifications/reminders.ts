import "server-only";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { logAudit } from "@/lib/audit";
import { customersOwing, type CustomerPayments, type IssuedBill } from "@/lib/customer-dues";
import { withDbTimeout } from "@/lib/db-timeout";
import { assertNotificationsEnabled } from "@/lib/notifications/config";
import type { EnqueueResult, SkippedCustomer } from "@/lib/notifications/outbox";
import { normalizeIndianMobile } from "@/lib/notifications/phone";
import { prisma } from "@/lib/prisma";

// Payment reminders: who owes money, and may be told so on WhatsApp.
//
// "Who owes what" is NOT worked out here — it is customer-dues.ts, the same rule
// the driver app's dues screen uses, so a reminder can never quote a figure the
// driver and the office would not recognise (the old per-bill sum overstated
// some customers by thousands).

// A reminder for a few rupees of rounding residue is the kind of message that
// gets a number blocked. Below this the customer is skipped, and says why.
export const MIN_REMINDER_AMOUNT = 10;

export type ReminderCandidate = {
  customerId: string;
  customerCode: string;
  customerName: string;
  recipient: string;
  month: number; // the month of the bill the balance is on, 1-12
  outstanding: number;
  billId: string;
};

export type ReminderPlan = {
  candidates: ReminderCandidate[];
  skipped: SkippedCustomer[];
  totalOutstanding: number;
};

// India's calendar day, as a stable string: the dedupe key, so pressing the
// button twice in a day queues each customer once, while tomorrow starts fresh.
function istDay(now: Date): string {
  return new Date(now.getTime() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export async function planPaymentReminders(cityId: string): Promise<ReminderPlan> {
  // Who might owe: an unpaid issued bill on an active route. Whether they do is
  // decided from their LATEST bill below.
  const candidateRows = await withDbTimeout(
    prisma.monthlyBill.findMany({
      where: { route: { cityId, isActive: true }, status: "GENERATED", closingBalance: { gt: 0 } },
      select: { customerId: true },
      distinct: ["customerId"],
    }),
    "Loading customers who owe",
    15_000,
  );
  if (candidateRows.length === 0) {
    return { candidates: [], skipped: [], totalOutstanding: 0 };
  }
  const customerIds = candidateRows.map((row) => row.customerId);

  const [issuedBills, verified, customers] = await withDbTimeout(
    Promise.all([
      prisma.monthlyBill.findMany({
        where: { customerId: { in: customerIds }, status: { in: ["GENERATED", "LOCKED"] }, route: { cityId } },
        select: {
          id: true, customerId: true, routeId: true, billingMonth: true, status: true, paymentAmount: true, closingBalance: true,
          route: { select: { isActive: true } },
        },
      }),
      prisma.payment.groupBy({
        by: ["customerId"],
        where: { customerId: { in: customerIds }, status: "VERIFIED", route: { cityId } },
        _sum: { amount: true },
      }),
      prisma.customer.findMany({
        where: { id: { in: customerIds }, cityId },
        select: { id: true, code: true, name: true, mobile: true, whatsappOptInAt: true },
      }),
    ]),
    "Loading reminder details",
    20_000,
  );

  const issued: IssuedBill[] = issuedBills.map((bill) => ({
    billId: bill.id,
    customerId: bill.customerId,
    routeId: bill.routeId,
    month: bill.billingMonth.toISOString().slice(0, 7),
    status: bill.status as "GENERATED" | "LOCKED",
    paymentAmount: Number(bill.paymentAmount),
    closingBalance: Number(bill.closingBalance),
  }));
  const lockedPaid = new Map<string, number>();
  for (const bill of issued) {
    if (bill.status === "LOCKED") {
      lockedPaid.set(bill.customerId, (lockedPaid.get(bill.customerId) ?? 0) + bill.paymentAmount);
    }
  }
  const payments = new Map<string, CustomerPayments>(
    verified.map((row) => [row.customerId, { totalVerified: Number(row._sum.amount ?? 0), lockedPaid: lockedPaid.get(row.customerId) ?? 0 }]),
  );
  const routeActive = new Map(issuedBills.map((bill) => [bill.routeId, bill.route.isActive]));
  const customerById = new Map(customers.map((customer) => [customer.id, customer]));

  const candidates: ReminderCandidate[] = [];
  const skipped: SkippedCustomer[] = [];
  let totalOutstanding = 0;

  for (const [customerId, due] of customersOwing(issued, payments)) {
    // The customer's billing route must still be running — same as the driver dues list.
    if (!routeActive.get(due.bill.routeId)) continue;
    const customer = customerById.get(customerId);
    if (!customer) continue;

    const skip = (reason: string) => skipped.push({ customerCode: customer.code, customerName: customer.name, reason });

    if (!customer.whatsappOptInAt) {
      skip("No WhatsApp consent recorded");
      continue;
    }
    const phone = normalizeIndianMobile(customer.mobile);
    if (!phone.ok) {
      skip(phone.reason);
      continue;
    }
    if (due.outstanding < MIN_REMINDER_AMOUNT) {
      skip(`Outstanding is under ₹${MIN_REMINDER_AMOUNT}`);
      continue;
    }

    totalOutstanding += due.outstanding;
    candidates.push({
      customerId,
      customerCode: customer.code,
      customerName: customer.name,
      recipient: phone.msisdn,
      month: Number(due.bill.month.slice(5, 7)),
      outstanding: due.outstanding,
      billId: due.bill.billId,
    });
  }

  candidates.sort((a, b) => a.customerCode.localeCompare(b.customerCode, undefined, { numeric: true }));
  return { candidates, skipped, totalOutstanding: Math.round(totalOutstanding * 100) / 100 };
}

export async function enqueuePaymentReminders(input: { cityId: string; now?: Date }): Promise<EnqueueResult> {
  assertNotificationsEnabled();

  const { cityId } = input;
  const plan = await planPaymentReminders(cityId);
  const day = istDay(input.now ?? new Date());
  const batchId = randomUUID();

  const rows: Prisma.NotificationOutboxCreateManyInput[] = plan.candidates.map((candidate) => ({
    customerId: candidate.customerId,
    recipient: candidate.recipient,
    template: "payment_reminder_hi_en_v1",
    variables: { month: candidate.month, outstanding: candidate.outstanding.toFixed(2) } as Prisma.InputJsonValue,
    // Once per customer per India day: a second click, or a second admin, cannot
    // double-message anyone, while tomorrow's reminder is allowed.
    dedupeKey: `reminder:${candidate.billId}:${day}`,
    batchId,
  }));

  const created =
    rows.length > 0
      ? await withDbTimeout(prisma.notificationOutbox.createMany({ data: rows, skipDuplicates: true }), "Queueing reminders", 20_000)
      : { count: 0 };

  await logAudit(prisma, {
    cityId,
    entityType: "NotificationOutbox",
    entityId: null,
    action: "QUEUE_PAYMENT_REMINDERS",
    summary: `Queued ${created.count} WhatsApp payment reminder(s)${plan.skipped.length > 0 ? `, skipped ${plan.skipped.length}` : ""}`,
    after: { batchId, queued: created.count, skipped: plan.skipped.length, eligible: rows.length },
  });

  return { batchId, queued: created.count, alreadyQueued: rows.length - created.count, skipped: plan.skipped };
}
