import "server-only";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { logAudit } from "@/lib/audit";
import { assertNotificationsEnabled } from "@/lib/notifications/config";
import { normalizeIndianMobile } from "@/lib/notifications/phone";
import { prisma } from "@/lib/prisma";
import { withDbTimeout } from "@/lib/db-timeout";

// App-facing half of the outbox: queueing work and reading its progress.
// The agent-facing half (claim/report) lives in ./dispatch.ts — different
// consumer, different auth, and deliberately kept apart so a change to how
// sending is paced can't disturb how work is queued.

export type SkippedCustomer = {
  customerCode: string;
  customerName: string;
  reason: string;
};

export type EnqueueResult = {
  batchId: string;
  queued: number;
  // Rows the unique index rejected because this exact message was queued by an
  // earlier click. Reported separately from `queued` so pressing send twice
  // reads as "nothing new to send" rather than silently appearing to work.
  alreadyQueued: number;
  skipped: SkippedCustomer[];
};

// Only bills that have actually been issued may be messaged. A DRAFT bill is
// still being worked on and its figures can change; sending one would put a
// number in a customer's hand that the office might contradict tomorrow.
const SENDABLE_BILL_STATUSES: Prisma.EnumBillingStatusFilter = { in: ["GENERATED", "LOCKED"] };

function formatBillingMonth(month: Date): string {
  // Forced to UTC because billingMonth is a @db.Date stored at UTC midnight —
  // formatting it in a local timezone west of UTC would name the previous month.
  return month.toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
}

export type BillCandidate = {
  customerId: string;
  customerCode: string;
  customerName: string;
  recipient: string;
  billId: string;
  amountDue: string;
  routeId: string;
  routeLabel: string;
  vehicleId: string;
  vehicleLabel: string;
};

export type BillPlan = { candidates: BillCandidate[]; skipped: SkippedCustomer[] };

// Who WOULD get a bill message for the month — read-only, so the office can see
// and edit the list before anything is queued.
//
// Eligibility is deliberately strict and every exclusion is reported rather
// than silently dropped: at ~2000 customers a quiet skip is invisible, and the
// customers most likely to be excluded (no number on file, never asked for
// consent) are exactly the ones someone needs to chase.
export async function planMonthlyBills(input: {
  cityId: string;
  billingMonth: Date;
  routeIds?: string[];
}): Promise<BillPlan> {
  const { cityId, billingMonth, routeIds } = input;

  const bills = await withDbTimeout(
    prisma.monthlyBill.findMany({
      where: {
        billingMonth,
        status: SENDABLE_BILL_STATUSES,
        route: { cityId },
        ...(routeIds && routeIds.length > 0 ? { routeId: { in: routeIds } } : {}),
      },
      select: {
        id: true,
        customerId: true,
        routeId: true,
        deliveryAmount: true,
        closingBalance: true,
        route: { select: { code: true, name: true, vehicle: { select: { id: true, code: true, name: true } } } },
        customer: {
          select: { code: true, name: true, mobile: true, whatsappOptInAt: true },
        },
      },
      orderBy: [{ customer: { code: "asc" } }],
    }),
    "Loading bills to queue",
    15_000,
  );

  const skipped: SkippedCustomer[] = [];
  const candidates: BillCandidate[] = [];

  for (const bill of bills) {
    const { customer } = bill;
    const skip = (reason: string) =>
      skipped.push({ customerCode: customer.code, customerName: customer.name, reason });

    if (!customer.whatsappOptInAt) {
      skip("No WhatsApp consent recorded");
      continue;
    }

    const phone = normalizeIndianMobile(customer.mobile);
    if (!phone.ok) {
      skip(phone.reason);
      continue;
    }

    // A customer with no deliveries and nothing owed has no bill worth reading.
    // Messaging them anyway is the kind of pointless contact that earns a block,
    // and blocks are the strongest ban signal there is.
    if (Number(bill.deliveryAmount) === 0 && Number(bill.closingBalance) === 0) {
      skip("Nothing delivered and nothing outstanding");
      continue;
    }

    candidates.push({
      customerId: bill.customerId,
      customerCode: customer.code,
      customerName: customer.name,
      recipient: phone.msisdn,
      billId: bill.id,
      // Decimals are passed as strings, not numbers: these round-trip through a
      // JSONB column and back, and money should not take a detour through a
      // float on the way.
      amountDue: bill.closingBalance.toString(),
      routeId: bill.routeId,
      routeLabel: `${bill.route.code} - ${bill.route.name}`,
      vehicleId: bill.route.vehicle.id,
      vehicleLabel: `${bill.route.vehicle.code} - ${bill.route.vehicle.name}`,
    });
  }

  return { candidates, skipped };
}

// Queues one monthly bill message per eligible customer for the given month.
// `customerIds`, when given, narrows it to exactly those customers — the picker
// on the screen. It can only NARROW: anyone not on the eligible list is ignored,
// so a tampered request cannot message a customer the rules exclude.
export async function enqueueMonthlyBills(input: {
  cityId: string;
  billingMonth: Date;
  routeIds?: string[];
  customerIds?: string[];
}): Promise<EnqueueResult> {
  assertNotificationsEnabled();

  const { cityId, billingMonth, customerIds } = input;
  const plan = await planMonthlyBills(input);
  const chosen = customerIds ? new Set(customerIds) : null;
  const picked = chosen ? plan.candidates.filter((candidate) => chosen.has(candidate.customerId)) : plan.candidates;

  const batchId = randomUUID();
  const skipped = plan.skipped;
  const rows: Prisma.NotificationOutboxCreateManyInput[] = picked.map((candidate) => ({
    customerId: candidate.customerId,
    recipient: candidate.recipient,
    // Bills go out as the approved "monthly_bill_link_v1" template: the customer
    // gets the headline figure and a View bill button. The signed link is made at
    // SEND time from billId (see zoepact-sender.ts), so it is as fresh as the
    // message and nothing secret is stored here.
    template: "monthly_bill_link_v1",
    variables: {
      customerName: candidate.customerName,
      month: billingMonth.getUTCMonth() + 1,
      amountDue: candidate.amountDue,
      billId: candidate.billId,
    } as unknown as Prisma.InputJsonValue,
    // The bill's own id — so re-running this for the same month cannot
    // produce a second message, whoever clicks and however many times.
    dedupeKey: candidate.billId,
    batchId,
  }));

  // skipDuplicates relies on the plain unique index on
  // (customerId, template, dedupeKey). It would NOT dedupe against a partial
  // index — see the billsHere lesson in this repo's history — but this index is
  // unconditional, so ON CONFLICT DO NOTHING behaves as intended here.
  const created =
    rows.length > 0
      ? await withDbTimeout(
          prisma.notificationOutbox.createMany({ data: rows, skipDuplicates: true }),
          "Queueing bill messages",
          20_000,
        )
      : { count: 0 };

  await logAudit(prisma, {
    cityId,
    entityType: "NotificationOutbox",
    entityId: null,
    action: "QUEUE_MONTHLY_BILLS",
    summary: `Queued ${created.count} WhatsApp bill message(s) for ${formatBillingMonth(billingMonth)}${
      skipped.length > 0 ? `, skipped ${skipped.length}` : ""
    }`,
    after: { batchId, queued: created.count, skipped: skipped.length, eligible: rows.length },
  });

  return {
    batchId,
    queued: created.count,
    alreadyQueued: rows.length - created.count,
    skipped,
  };
}

export type SendableMonth = {
  // "YYYY-MM", matching the month input used elsewhere in the app.
  value: string;
  label: string;
  billCount: number;
};

// Months that actually have issued bills. Offering a free month picker would
// invite selecting a month with nothing in it and wondering why nothing sent.
export async function getSendableMonths(cityId: string): Promise<SendableMonth[]> {
  const grouped = await withDbTimeout(
    prisma.monthlyBill.groupBy({
      by: ["billingMonth"],
      where: { status: SENDABLE_BILL_STATUSES, route: { cityId } },
      _count: { _all: true },
      orderBy: { billingMonth: "desc" },
      take: 12,
    }),
    "Loading billable months",
    10_000,
  );

  return grouped.map((row) => ({
    value: row.billingMonth.toISOString().slice(0, 7),
    label: formatBillingMonth(row.billingMonth),
    billCount: row._count._all,
  }));
}

export type BatchProgress = {
  batchId: string;
  template: string;
  createdAt: Date;
  total: number;
  pending: number;
  sending: number;
  sent: number;
  failed: number;
  cancelled: number;
  lastSentAt: Date | null;
};

// Progress for the most recent batches. A run spans one to two days, so the
// screen's job is to answer "is it still going, and how far has it got" at a
// glance rather than to list two thousand rows.
export async function getRecentBatches(cityId: string, limit = 10): Promise<BatchProgress[]> {
  const grouped = await withDbTimeout(
    prisma.notificationOutbox.groupBy({
      by: ["batchId", "template", "status"],
      where: { batchId: { not: null }, customer: { cityId } },
      _count: { _all: true },
      _max: { sentAt: true, createdAt: true },
    }),
    "Loading notification batches",
    10_000,
  );

  const byBatch = new Map<string, BatchProgress>();

  for (const row of grouped) {
    if (!row.batchId) continue;

    const existing =
      byBatch.get(row.batchId) ??
      ({
        batchId: row.batchId,
        template: row.template,
        createdAt: row._max.createdAt ?? new Date(0),
        total: 0,
        pending: 0,
        sending: 0,
        sent: 0,
        failed: 0,
        cancelled: 0,
        lastSentAt: null,
      } satisfies BatchProgress);

    const count = row._count._all;
    existing.total += count;

    if (row.status === "PENDING") existing.pending += count;
    else if (row.status === "SENDING") existing.sending += count;
    else if (row.status === "SENT") existing.sent += count;
    else if (row.status === "FAILED") existing.failed += count;
    else if (row.status === "CANCELLED") existing.cancelled += count;

    if (row._max.createdAt && row._max.createdAt > existing.createdAt) {
      existing.createdAt = row._max.createdAt;
    }
    if (row._max.sentAt && (!existing.lastSentAt || row._max.sentAt > existing.lastSentAt)) {
      existing.lastSentAt = row._max.sentAt;
    }

    byBatch.set(row.batchId, existing);
  }

  return [...byBatch.values()]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, limit);
}

export type FailedMessage = {
  id: string;
  customerCode: string;
  customerName: string;
  recipient: string;
  attempts: number;
  lastError: string | null;
  createdAt: Date;
};

export async function getFailedMessages(cityId: string, limit = 100): Promise<FailedMessage[]> {
  const rows = await withDbTimeout(
    prisma.notificationOutbox.findMany({
      where: { status: "FAILED", customer: { cityId } },
      select: {
        id: true,
        recipient: true,
        attempts: true,
        lastError: true,
        createdAt: true,
        customer: { select: { code: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
    "Loading failed messages",
    10_000,
  );

  return rows.map((row) => ({
    id: row.id,
    customerCode: row.customer.code,
    customerName: row.customer.name,
    recipient: row.recipient,
    attempts: row.attempts,
    lastError: row.lastError,
    createdAt: row.createdAt,
  }));
}

// Puts failed rows back in the queue. Attempts are reset so the agent's own
// retry budget applies afresh — this is a human deciding to try again after
// fixing something, not the automatic backoff.
export async function retryFailed(input: { cityId: string; batchId?: string }): Promise<number> {
  assertNotificationsEnabled();

  const result = await prisma.notificationOutbox.updateMany({
    where: {
      status: "FAILED",
      customer: { cityId: input.cityId },
      ...(input.batchId ? { batchId: input.batchId } : {}),
    },
    data: { status: "PENDING", attempts: 0, lastError: null, claimedAt: null, notBefore: new Date() },
  });

  await logAudit(prisma, {
    cityId: input.cityId,
    entityType: "NotificationOutbox",
    entityId: input.batchId ?? null,
    action: "RETRY_FAILED",
    summary: `Requeued ${result.count} failed WhatsApp message(s)`,
  });

  return result.count;
}

// Withdraws everything not yet sent. The realistic trigger is noticing a
// mistake partway through a two-day run: rows already sent cannot be recalled,
// but the remainder can be stopped, and CANCELLED records that this was a
// decision rather than a failure.
export async function cancelPending(input: { cityId: string; batchId: string }): Promise<number> {
  assertNotificationsEnabled();

  const result = await prisma.notificationOutbox.updateMany({
    where: {
      batchId: input.batchId,
      status: { in: ["PENDING", "SENDING"] },
      customer: { cityId: input.cityId },
    },
    data: { status: "CANCELLED" },
  });

  await logAudit(prisma, {
    cityId: input.cityId,
    entityType: "NotificationOutbox",
    entityId: input.batchId,
    action: "CANCEL_BATCH",
    summary: `Cancelled ${result.count} unsent WhatsApp message(s)`,
  });

  return result.count;
}

export type PendingMessage = {
  id: string;
  customerCode: string;
  customerName: string;
  recipient: string;
  template: string;
  createdAt: Date;
};

// Messages queued but not yet picked up. The sender takes them from the oldest,
// so this is the window to take someone off before they are sent.
export async function getPendingMessages(cityId: string, limit = 300): Promise<PendingMessage[]> {
  const rows = await withDbTimeout(
    prisma.notificationOutbox.findMany({
      where: { status: "PENDING", customer: { cityId } },
      select: {
        id: true,
        recipient: true,
        template: true,
        createdAt: true,
        customer: { select: { code: true, name: true } },
      },
      orderBy: { createdAt: "asc" },
      take: limit,
    }),
    "Loading waiting messages",
    10_000,
  );

  return rows.map((row) => ({
    id: row.id,
    customerCode: row.customer.code,
    customerName: row.customer.name,
    recipient: row.recipient,
    template: row.template,
    createdAt: row.createdAt,
  }));
}

// Takes specific people off the queue. Only rows still PENDING qualify: one
// already SENDING is in flight and one SENT cannot be recalled, so those are left
// alone and simply not counted. CANCELLED records that this was a decision.
export async function cancelMessages(input: { cityId: string; ids: string[] }): Promise<number> {
  assertNotificationsEnabled();
  if (input.ids.length === 0) return 0;

  const result = await prisma.notificationOutbox.updateMany({
    where: { id: { in: input.ids }, status: "PENDING", customer: { cityId: input.cityId } },
    data: { status: "CANCELLED" },
  });

  await logAudit(prisma, {
    cityId: input.cityId,
    entityType: "NotificationOutbox",
    entityId: null,
    action: "CANCEL_MESSAGES",
    summary: `Removed ${result.count} waiting WhatsApp message(s) from the queue`,
    after: { requested: input.ids.length, cancelled: result.count },
  });

  return result.count;
}
