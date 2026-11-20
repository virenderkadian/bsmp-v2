import "server-only";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { logAudit } from "@/lib/audit";
import { withDbTimeout } from "@/lib/db-timeout";
import { assertNotificationsEnabled } from "@/lib/notifications/config";
import { readableDay } from "@/lib/notifications/delivery-updates";
import { normalizeIndianMobile } from "@/lib/notifications/phone";
import { paymentModeWords } from "@/lib/notifications/zoepact-templates";
import { prisma } from "@/lib/prisma";

// "We received your payment": a confirmation to the customer for a payment the office has
// VERIFIED. A payment a driver collected stays PENDING until the office checks it, and a
// receipt for money that turns out wrong is worse than a short wait, so pending and
// cancelled payments are never listed. The office picks the dates and then the payments, so
// nothing here fires by itself when a payment is recorded.
//
// Needs two consents: general WhatsApp consent and the separate payment-updates opt-in.

const MAX_RANGE_DAYS = 31;
const MAX_PAYMENTS = 1000;

export type PaymentCandidate = {
  paymentId: string;
  customerId: string;
  customerCode: string;
  customerName: string;
  recipient: string;
  amount: number;
  day: string; // YYYY-MM-DD
  mode: string; // CASH | UPI | BANK_TRANSFER | CHEQUE
  routeId: string;
  routeLabel: string;
  vehicleId: string;
  vehicleLabel: string;
};

export type PaymentAudience = {
  candidates: PaymentCandidate[];
  // Verified payments in the range (before any are left out).
  verified: number;
  // Payments left out, counted rather than listed.
  noConsent: number;
  noPaymentOptIn: number;
  noNumber: number;
  // True when the range held more payments than are shown.
  truncated: boolean;
};

function isDay(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function dayStart(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

export async function planPaymentUpdates(cityId: string, from: string, to: string): Promise<PaymentAudience> {
  if (!isDay(from) || !isDay(to)) throw new Error("Choose a valid date range.");
  if (from > to) throw new Error("The start date is after the end date.");
  if ((dayStart(to).getTime() - dayStart(from).getTime()) / 86_400_000 >= MAX_RANGE_DAYS) {
    throw new Error(`Choose a range of at most ${MAX_RANGE_DAYS} days.`);
  }

  const payments = await withDbTimeout(
    prisma.payment.findMany({
      where: { status: "VERIFIED", paymentDate: { gte: dayStart(from), lte: dayStart(to) }, customer: { cityId } },
      select: { id: true, customerId: true, amount: true, paymentDate: true, mode: true, routeId: true },
      orderBy: [{ paymentDate: "desc" }, { createdAt: "desc" }],
      take: MAX_PAYMENTS + 1,
    }),
    "Loading verified payments",
    20_000,
  );

  const truncated = payments.length > MAX_PAYMENTS;
  const shown = truncated ? payments.slice(0, MAX_PAYMENTS) : payments;
  if (shown.length === 0) {
    return { candidates: [], verified: 0, noConsent: 0, noPaymentOptIn: 0, noNumber: 0, truncated: false };
  }

  const customerIds = [...new Set(shown.map((payment) => payment.customerId))];
  const routeIds = [...new Set(shown.map((payment) => payment.routeId).filter((id): id is string => !!id))];

  const [customers, routes] = await withDbTimeout(
    Promise.all([
      prisma.customer.findMany({
        where: { id: { in: customerIds }, cityId },
        select: { id: true, code: true, name: true, mobile: true, whatsappOptInAt: true, paymentUpdatesOptInAt: true },
      }),
      prisma.route.findMany({
        where: { id: { in: routeIds }, cityId },
        select: { id: true, code: true, name: true, vehicle: { select: { id: true, code: true, name: true } } },
      }),
    ]),
    "Loading payment details",
    20_000,
  );

  const customerById = new Map(customers.map((customer) => [customer.id, customer]));
  const routeById = new Map(routes.map((route) => [route.id, route]));

  const candidates: PaymentCandidate[] = [];
  let noConsent = 0;
  let noPaymentOptIn = 0;
  let noNumber = 0;

  for (const payment of shown) {
    const customer = customerById.get(payment.customerId);
    if (!customer) continue;
    if (!customer.whatsappOptInAt) {
      noConsent += 1;
      continue;
    }
    // Payment confirmations are a separate opt-in: general WhatsApp consent is not enough.
    if (!customer.paymentUpdatesOptInAt) {
      noPaymentOptIn += 1;
      continue;
    }
    const phone = normalizeIndianMobile(customer.mobile);
    if (!phone.ok) {
      noNumber += 1;
      continue;
    }
    const route = payment.routeId ? routeById.get(payment.routeId) : undefined;
    candidates.push({
      paymentId: payment.id,
      customerId: customer.id,
      customerCode: customer.code,
      customerName: customer.name,
      recipient: phone.msisdn,
      amount: Number(payment.amount),
      day: payment.paymentDate.toISOString().slice(0, 10),
      mode: payment.mode,
      routeId: route?.id ?? "",
      routeLabel: route ? `${route.code} - ${route.name}` : "",
      vehicleId: route?.vehicle.id ?? "",
      vehicleLabel: route ? `${route.vehicle.code} - ${route.vehicle.name}` : "",
    });
  }

  return { candidates, verified: shown.length, noConsent, noPaymentOptIn, noNumber, truncated };
}

export type PaymentEnqueueResult = { batchId: string; queued: number; alreadyQueued: number };

// Queues a confirmation for exactly the payments chosen. It re-plans on the server and only
// ever NARROWS to the chosen ids, so a payment that is not verified, or whose customer lacks
// either consent or a number, is ignored even if named. One message per payment, however many
// times it is pressed.
export async function enqueuePaymentUpdates(input: {
  cityId: string;
  from: string;
  to: string;
  paymentIds: string[];
}): Promise<PaymentEnqueueResult> {
  assertNotificationsEnabled();

  const audience = await planPaymentUpdates(input.cityId, input.from, input.to);
  const chosen = new Set(input.paymentIds);
  const picked = audience.candidates.filter((candidate) => chosen.has(candidate.paymentId));
  const batchId = randomUUID();

  const rows: Prisma.NotificationOutboxCreateManyInput[] = picked.map((candidate) => ({
    customerId: candidate.customerId,
    recipient: candidate.recipient,
    template: "payment_received_v1",
    // Stored as they were when ticked. paymentId lets the sender stop the message if the
    // payment is cancelled before it goes out.
    variables: {
      amount: candidate.amount.toFixed(2),
      date: readableDay(candidate.day),
      mode: candidate.mode,
      paymentId: candidate.paymentId,
    } as Prisma.InputJsonValue,
    dedupeKey: `payment:${candidate.paymentId}`,
    batchId,
  }));

  const created =
    rows.length > 0
      ? await withDbTimeout(prisma.notificationOutbox.createMany({ data: rows, skipDuplicates: true }), "Queueing payment receipts", 20_000)
      : { count: 0 };

  await logAudit(prisma, {
    cityId: input.cityId,
    entityType: "NotificationOutbox",
    entityId: null,
    action: "QUEUE_PAYMENT_RECEIPTS",
    summary: `Queued ${created.count} WhatsApp payment receipt(s) for ${readableDay(input.from)} to ${readableDay(input.to)}`,
    after: { batchId, from: input.from, to: input.to, queued: created.count, chosen: input.paymentIds.length, eligible: rows.length },
  });

  return { batchId, queued: created.count, alreadyQueued: rows.length - created.count };
}

// "Cash", "UPI", "Bank transfer", "Cheque": for the list the office reads.
export function modeLabel(mode: string): string {
  const words = paymentModeWords(mode).en;
  return words.charAt(0).toUpperCase() + words.slice(1);
}
