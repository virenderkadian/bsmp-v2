import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { logAudit } from "@/lib/audit";
import { withDbTimeout } from "@/lib/db-timeout";
import { assertNotificationsEnabled } from "@/lib/notifications/config";
import { normalizeIndianMobile } from "@/lib/notifications/phone";
import { zoepactVariableSchemas } from "@/lib/notifications/zoepact-templates";
import { monthInputToDate } from "@/lib/monthly-route-sequence";
import { prisma } from "@/lib/prisma";

// Notices: a rate change or a delivery notice, sent to customers the office picks.
// Unlike bills and reminders there is no per-customer figure, so the same message
// goes to everyone chosen, and the audience is simply "consent + a usable number".

export const NOTICE_TEMPLATES = ["rate_change_notice_v1", "delivery_notice_v1"] as const;
export type NoticeTemplate = (typeof NOTICE_TEMPLATES)[number];

export function isNoticeTemplate(value: string): value is NoticeTemplate {
  return (NOTICE_TEMPLATES as readonly string[]).includes(value);
}

export type NoticeCandidate = {
  customerId: string;
  customerCode: string;
  customerName: string;
  recipient: string;
  // The customer's route this month (their billing route when they have two), so the
  // office can pick or leave out a route or a vehicle. Blank if they are on none.
  routeId: string;
  routeLabel: string;
  vehicleId: string;
  vehicleLabel: string;
};

export type NoticeAudience = {
  candidates: NoticeCandidate[];
  noConsent: number;
  noNumber: number;
};

function istMonth(now: Date): string {
  return new Date(now.getTime() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 7);
}

// Active customers who can be messaged: consent on file and a valid Indian mobile.
// Counted, not listed, for the ones who can't: at several hundred customers a
// skipped list for a notice would bury the people being chosen.
export async function planNoticeAudience(cityId: string, now = new Date()): Promise<NoticeAudience> {
  const monthStart = monthInputToDate(istMonth(now));

  const [customers, sequences] = await withDbTimeout(
    Promise.all([
      prisma.customer.findMany({
        where: { cityId, isActive: true },
        select: { id: true, code: true, name: true, mobile: true, whatsappOptInAt: true },
        orderBy: { code: "asc" },
      }),
      prisma.monthlyRouteCustomerSequence.findMany({
        where: { route: { cityId }, sequenceMonth: monthStart, status: "ACTIVE" },
        select: {
          customerId: true,
          routeId: true,
          billsHere: true,
          route: { select: { code: true, name: true, vehicle: { select: { id: true, code: true, name: true } } } },
        },
      }),
    ]),
    "Loading notice audience",
    20_000,
  );

  // One route per customer: the one that bills them, else any they run on.
  const routeOf = new Map<string, (typeof sequences)[number]>();
  for (const row of sequences) {
    const current = routeOf.get(row.customerId);
    if (!current || (row.billsHere && !current.billsHere)) routeOf.set(row.customerId, row);
  }

  const candidates: NoticeCandidate[] = [];
  let noConsent = 0;
  let noNumber = 0;

  for (const customer of customers) {
    if (!customer.whatsappOptInAt) {
      noConsent += 1;
      continue;
    }
    const phone = normalizeIndianMobile(customer.mobile);
    if (!phone.ok) {
      noNumber += 1;
      continue;
    }
    const sequence = routeOf.get(customer.id);
    candidates.push({
      customerId: customer.id,
      customerCode: customer.code,
      customerName: customer.name,
      recipient: phone.msisdn,
      routeId: sequence?.routeId ?? "",
      routeLabel: sequence ? `${sequence.route.code} - ${sequence.route.name}` : "",
      vehicleId: sequence?.route.vehicle.id ?? "",
      vehicleLabel: sequence ? `${sequence.route.vehicle.code} - ${sequence.route.vehicle.name}` : "",
    });
  }

  return { candidates, noConsent, noNumber };
}

export type NoticeEnqueueResult = { batchId: string; queued: number; alreadyQueued: number };

// Queues one notice to exactly the customers chosen. The values are validated with
// the same schema the sender uses, so nothing is queued that WhatsApp would reject,
// and the chosen ids can only NARROW the eligible audience: naming a customer
// without consent or a number does nothing.
export async function enqueueNotice(input: {
  cityId: string;
  template: NoticeTemplate;
  variables: unknown;
  customerIds: string[];
  now?: Date;
}): Promise<NoticeEnqueueResult> {
  assertNotificationsEnabled();

  const parsed = zoepactVariableSchemas[input.template].safeParse(input.variables);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "The notice is not valid.");
  }

  const audience = await planNoticeAudience(input.cityId, input.now);
  const chosen = new Set(input.customerIds);
  const picked = audience.candidates.filter((candidate) => chosen.has(candidate.customerId));

  // The same notice to the same customer is queued once, however many times it is
  // pressed. A changed notice (new wording or date) is a new key, so it can go again.
  const dedupeKey = `notice:${createHash("sha256").update(JSON.stringify(parsed.data)).digest("hex").slice(0, 24)}`;
  const batchId = randomUUID();

  const rows: Prisma.NotificationOutboxCreateManyInput[] = picked.map((candidate) => ({
    customerId: candidate.customerId,
    recipient: candidate.recipient,
    template: input.template,
    variables: parsed.data as Prisma.InputJsonValue,
    dedupeKey,
    batchId,
  }));

  const created =
    rows.length > 0
      ? await withDbTimeout(prisma.notificationOutbox.createMany({ data: rows, skipDuplicates: true }), "Queueing notices", 20_000)
      : { count: 0 };

  await logAudit(prisma, {
    cityId: input.cityId,
    entityType: "NotificationOutbox",
    entityId: null,
    action: "QUEUE_NOTICE",
    summary: `Queued ${created.count} WhatsApp notice(s) (${input.template})`,
    after: { batchId, template: input.template, queued: created.count, chosen: input.customerIds.length, eligible: rows.length },
  });

  return { batchId, queued: created.count, alreadyQueued: rows.length - created.count };
}

export type NoticeProduct = { id: string; name: string; unit: string; defaultRate: string };

// The city's active products, so a rate change can be built by picking them and
// typing the new rate. The default rate is offered as the old rate.
export async function getNoticeProducts(cityId: string): Promise<NoticeProduct[]> {
  const products = await withDbTimeout(
    prisma.product.findMany({
      where: { cityId, isActive: true },
      select: { id: true, name: true, unit: true, defaultRate: true },
      orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
    }),
    "Loading products for notices",
    10_000,
  );
  return products.map((product) => ({ id: product.id, name: product.name, unit: product.unit, defaultRate: product.defaultRate.toString() }));
}
