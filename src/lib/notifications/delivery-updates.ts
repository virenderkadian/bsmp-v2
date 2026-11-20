import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { logAudit } from "@/lib/audit";
import { withDbTimeout } from "@/lib/db-timeout";
import { assertNotificationsEnabled } from "@/lib/notifications/config";
import { normalizeIndianMobile } from "@/lib/notifications/phone";
import { buildDeliveredItemsText, MAX_NOTICE_TEXT, type DeliveredItem } from "@/lib/notifications/zoepact-templates";
import { prisma } from "@/lib/prisma";

// "Your delivery is completed": what a customer received on a day, with the price of each
// line and the day's total. The office picks the date and then the customers, so nothing
// here fires by itself when a driver saves a stop.
//
// The figures are the delivery entries as saved (quantity x the rate recorded on the
// entry), summed per customer for the date across every route they were delivered on.

export type DeliveryCandidate = {
  customerId: string;
  customerCode: string;
  customerName: string;
  recipient: string;
  routeId: string;
  routeLabel: string;
  vehicleId: string;
  vehicleLabel: string;
  itemsText: string;
  amount: number;
};

export type DeliveryAudience = {
  candidates: DeliveryCandidate[];
  // Delivered that day but left out, counted rather than listed.
  noConsent: number;
  // Has general WhatsApp consent but has not opted in to delivery updates.
  noDeliveryOptIn: number;
  noNumber: number;
  tooLong: number;
  // Customers who had a delivery that day at all (before any of the above).
  delivered: number;
};

function isDay(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

// "2026-11-21" -> "21 November 2026", the way the customer reads it.
export function readableDay(value: string): string {
  return new Date(`${value}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

type TotalRow = { customerId: string; productId: string; quantity: unknown; amount: unknown };
type RouteRow = { customerId: string; routeId: string };

export async function planDeliveryUpdates(cityId: string, day: string): Promise<DeliveryAudience> {
  if (!isDay(day)) throw new Error("Choose a valid date.");
  const date = new Date(`${day}T00:00:00.000Z`);

  // Two small aggregates for one day, summed in the database. Lines the driver skipped
  // carry no quantity, so "quantity > 0" leaves out anyone who wasn't delivered.
  const [totals, routes] = await withDbTimeout(
    Promise.all([
      prisma.$queryRaw<TotalRow[]>`
        SELECT dl."customerId" AS "customerId", dp."productId" AS "productId",
          SUM(dp.quantity)::numeric AS quantity, SUM(dp.quantity * dp."rateSnapshot")::numeric AS amount
        FROM "DailyRouteEntryLineProduct" dp
        JOIN "DailyRouteEntryLine" dl ON dl.id = dp."lineId"
        JOIN "DailyRouteEntry" e ON e.id = dl."entryId"
        JOIN "Route" r ON r.id = e."routeId"
        WHERE r."cityId" = ${cityId}::uuid AND e."entryDate" = ${date}::date AND dl.skipped = false AND dp.quantity > 0
        GROUP BY dl."customerId", dp."productId"
      `,
      // The route each customer was first delivered on that day, so the office can
      // filter by route and vehicle.
      prisma.$queryRaw<RouteRow[]>`
        SELECT DISTINCT ON (dl."customerId") dl."customerId" AS "customerId", e."routeId" AS "routeId"
        FROM "DailyRouteEntryLine" dl
        JOIN "DailyRouteEntry" e ON e.id = dl."entryId"
        JOIN "Route" r ON r.id = e."routeId"
        WHERE r."cityId" = ${cityId}::uuid AND e."entryDate" = ${date}::date AND dl.skipped = false
        ORDER BY dl."customerId", r.shift ASC, r.code ASC
      `,
    ]),
    "Loading the day's deliveries",
    20_000,
  );

  if (totals.length === 0) {
    return { candidates: [], noConsent: 0, noDeliveryOptIn: 0, noNumber: 0, tooLong: 0, delivered: 0 };
  }

  const customerIds = [...new Set(totals.map((row) => row.customerId))];
  const productIds = [...new Set(totals.map((row) => row.productId))];
  const routeIds = [...new Set(routes.map((row) => row.routeId))];

  const [customers, products, routeInfo] = await withDbTimeout(
    Promise.all([
      prisma.customer.findMany({
        where: { id: { in: customerIds }, cityId },
        select: { id: true, code: true, name: true, mobile: true, whatsappOptInAt: true, deliveryUpdatesOptInAt: true },
        orderBy: { code: "asc" },
      }),
      prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, name: true, shortName: true, unit: true, displayOrder: true } }),
      prisma.route.findMany({
        where: { id: { in: routeIds }, cityId },
        select: { id: true, code: true, name: true, vehicle: { select: { id: true, code: true, name: true } } },
      }),
    ]),
    "Loading delivery details",
    20_000,
  );

  const productById = new Map(products.map((product) => [product.id, product]));
  const routeById = new Map(routeInfo.map((route) => [route.id, route]));
  const routeOf = new Map(routes.map((row) => [row.customerId, row.routeId]));

  // Each customer's delivered lines, in the same order every time: the products' own
  // display order, then name. The database returns grouped rows in no particular order,
  // so without this a customer's message could list the same products differently on
  // two runs.
  const linesOf = new Map<string, Array<DeliveredItem & { order: number }>>();
  for (const row of totals) {
    const product = productById.get(row.productId);
    if (!product) continue;
    const lines = linesOf.get(row.customerId) ?? [];
    lines.push({ name: product.shortName || product.name, quantity: Number(row.quantity), unit: product.unit, amount: Number(row.amount), order: product.displayOrder });
    linesOf.set(row.customerId, lines);
  }
  for (const lines of linesOf.values()) {
    lines.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, undefined, { numeric: true }));
  }

  const candidates: DeliveryCandidate[] = [];
  let noConsent = 0;
  let noDeliveryOptIn = 0;
  let noNumber = 0;
  let tooLong = 0;

  for (const customer of customers) {
    const lines = linesOf.get(customer.id);
    if (!lines || lines.length === 0) continue;

    if (!customer.whatsappOptInAt) {
      noConsent += 1;
      continue;
    }
    // Delivery updates are a separate opt-in: general WhatsApp consent is not enough.
    if (!customer.deliveryUpdatesOptInAt) {
      noDeliveryOptIn += 1;
      continue;
    }
    const phone = normalizeIndianMobile(customer.mobile);
    if (!phone.ok) {
      noNumber += 1;
      continue;
    }

    const itemsText = buildDeliveredItemsText(lines);
    // A template value has a length limit; a customer with an unusually long list is left out and counted.
    if (itemsText.length > MAX_NOTICE_TEXT) {
      tooLong += 1;
      continue;
    }

    const route = routeById.get(routeOf.get(customer.id) ?? "");
    candidates.push({
      customerId: customer.id,
      customerCode: customer.code,
      customerName: customer.name,
      recipient: phone.msisdn,
      routeId: route?.id ?? "",
      routeLabel: route ? `${route.code} - ${route.name}` : "",
      vehicleId: route?.vehicle.id ?? "",
      vehicleLabel: route ? `${route.vehicle.code} - ${route.vehicle.name}` : "",
      itemsText,
      amount: Math.round(lines.reduce((sum, line) => sum + line.amount, 0) * 100) / 100,
    });
  }

  return { candidates, noConsent, noDeliveryOptIn, noNumber, tooLong, delivered: linesOf.size };
}

export type DeliveryEnqueueResult = { batchId: string; queued: number; alreadyQueued: number };

// Queues the delivery-completed message to exactly the customers chosen. It re-plans on
// the server and only ever NARROWS to the chosen ids, so a customer without consent, a
// number, delivery-updates opt-in, or a delivery that day is ignored even if named. One message per customer per
// delivery date, however many times it is pressed.
export async function enqueueDeliveryUpdates(input: {
  cityId: string;
  day: string;
  customerIds: string[];
}): Promise<DeliveryEnqueueResult> {
  assertNotificationsEnabled();

  const audience = await planDeliveryUpdates(input.cityId, input.day);
  const chosen = new Set(input.customerIds);
  const picked = audience.candidates.filter((candidate) => chosen.has(candidate.customerId));

  const batchId = randomUUID();
  const date = readableDay(input.day);

  const rows: Prisma.NotificationOutboxCreateManyInput[] = picked.map((candidate) => ({
    customerId: candidate.customerId,
    recipient: candidate.recipient,
    template: "delivery_completed_v1",
    // The figures are stored as they were when queued, so the message says exactly what
    // the office saw and ticked even if an entry is corrected later.
    variables: { date, itemsText: candidate.itemsText, amount: candidate.amount.toFixed(2) } as Prisma.InputJsonValue,
    dedupeKey: `delivered:${input.day}:${createHash("sha256").update(candidate.customerId).digest("hex").slice(0, 12)}`,
    batchId,
  }));

  const created =
    rows.length > 0
      ? await withDbTimeout(prisma.notificationOutbox.createMany({ data: rows, skipDuplicates: true }), "Queueing delivery updates", 20_000)
      : { count: 0 };

  await logAudit(prisma, {
    cityId: input.cityId,
    entityType: "NotificationOutbox",
    entityId: null,
    action: "QUEUE_DELIVERY_UPDATES",
    summary: `Queued ${created.count} WhatsApp delivery update(s) for ${date}`,
    after: { batchId, day: input.day, queued: created.count, chosen: input.customerIds.length, eligible: rows.length },
  });

  return { batchId, queued: created.count, alreadyQueued: rows.length - created.count };
}
