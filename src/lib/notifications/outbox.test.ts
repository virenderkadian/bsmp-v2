import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { cancelMessages, enqueueMonthlyBills, getPendingMessages, planMonthlyBills } from "@/lib/notifications/outbox";
import { claimForZoepact, claimPending, reportOutcomes } from "@/lib/notifications/dispatch";
import { bulkOptInDeliveryUpdates, bulkOptInUpdates, getConsentSummary, planDeliveryOptIn, planUpdatesOptIn, setCustomerConsent, setDeliveryUpdatesConsent, setUpdatesConsent } from "@/lib/notifications/consent";
import { enqueuePaymentUpdates, planPaymentUpdates } from "@/lib/notifications/payment-updates";
import { runZoepactBatch } from "@/lib/notifications/zoepact-sender";
import { enqueueDeliveryUpdates, planDeliveryUpdates } from "@/lib/notifications/delivery-updates";
import { enqueueNotice, planNoticeAudience } from "@/lib/notifications/notices";
import { enqueuePaymentReminders, planPaymentReminders } from "@/lib/notifications/reminders";

// Exercises the real queue against the real dev database, because the parts
// worth testing here are precisely the ones a mock would paper over: the unique
// index that makes double-sending impossible, the atomic claim, and the attempt
// refund on release. Creates and tears down its own throwaway city.

const db = new PrismaClient();

let cityId: string;
let routeId: string;
let vehicleId: string;
let productId: string;
const customers: Record<string, string> = {};
const bills: Record<string, string> = {};

const suffix = Date.now().toString().slice(-8);
const month = new Date("2026-07-01T00:00:00.000Z");

async function makeCustomer(key: string, data: { mobile?: string | null; optedIn: boolean }) {
  const customer = await db.customer.create({
    data: {
      cityId,
      code: `WA-${key}-${suffix}`,
      name: `WhatsApp Test ${key}`,
      mobile: data.mobile ?? null,
      whatsappOptInAt: data.optedIn ? new Date() : null,
      openingBalance: 0,
    },
  });
  customers[key] = customer.id;

  const bill = await db.monthlyBill.create({
    data: {
      customerId: customer.id,
      routeId,
      billingMonth: month,
      openingBalance: 340,
      deliveryAmount: key === "zero" ? 0 : 2780,
      paymentAmount: 780,
      closingBalance: key === "zero" ? 0 : 2340,
      status: "GENERATED",
      generatedAt: new Date(),
    },
  });
  bills[key] = bill.id;
}

beforeAll(async () => {
  process.env.NOTIFICATIONS_ENABLED = "true";
  process.env.NOTIFICATIONS_AGENT_SECRET = "test-secret-at-least-32-characters-long";

  const city = await db.city.create({ data: { code: `WA${suffix}`, name: `WhatsApp Test City ${suffix}` } });
  cityId = city.id;

  // A route requires a vehicle now — see the route_vehicle_required migration.
  const vehicle = await db.vehicle.create({
    data: { cityId, code: `WAV-${suffix}`, name: "WA Test Vehicle" },
  });
  vehicleId = vehicle.id;

  const [route, product] = await Promise.all([
    db.route.create({
      data: { cityId, code: `WAR-${suffix}`, name: "WA Test Route", shift: "MORNING", vehicleId: vehicle.id },
    }),
    db.product.create({
      data: { cityId, code: `WAP-${suffix}`, name: "WA Test Milk", unit: "ltr", defaultRate: 62 },
    }),
  ]);
  routeId = route.id;
  productId = product.id;

  await Promise.all([
    makeCustomer("ok", { mobile: "9812345678", optedIn: true }),
    makeCustomer("noconsent", { mobile: "9812345679", optedIn: false }),
    makeCustomer("nomobile", { mobile: null, optedIn: true }),
    makeCustomer("badmobile", { mobile: "1800123456", optedIn: true }),
    makeCustomer("zero", { mobile: "9812345670", optedIn: true }),
  ]);
});

// A row for the office-PC agent's TEXT family, queued directly: bills no longer
// use it (they go out as Zoepact templates), but the agent path still has to work.
async function queueTextRow() {
  await db.notificationOutbox.create({
    data: {
      customerId: customers.ok,
      recipient: "919812345678",
      template: "monthly_bill_v1",
      variables: {
        businessName: "Your dairy", customerName: "WhatsApp Test ok", customerCode: "C-1", billingMonth: "July 2026",
        openingBalance: "340", deliveryAmount: "2780", paymentAmount: "780", closingBalance: "2340",
      },
      dedupeKey: `text-${Date.now()}-${Math.random()}`,
    },
  });
}

beforeEach(async () => {
  await db.notificationOutbox.deleteMany({ where: { customerId: { in: Object.values(customers) } } });
});

afterAll(async () => {
  const customerIds = Object.values(customers);
  await db.notificationOutbox.deleteMany({ where: { customerId: { in: customerIds } } });
  await db.monthlyBillItem.deleteMany({ where: { monthlyBillId: { in: Object.values(bills) } } });
  await db.monthlyBill.deleteMany({ where: { id: { in: Object.values(bills) } } });
  await db.auditLog.deleteMany({ where: { cityId } });
  await db.customer.deleteMany({ where: { id: { in: customerIds } } });
  await db.product.deleteMany({ where: { id: productId } });
  await db.route.deleteMany({ where: { id: routeId } });
  // Vehicles hold a city FK, so they have to go before the city.
  await db.vehicle.deleteMany({ where: { cityId: cityId } });
  await db.city.deleteMany({ where: { id: cityId } });
  await db.$disconnect();
});

describe("enqueueMonthlyBills", () => {
  it("queues only the customer who has both consent and a usable number", async () => {
    const result = await enqueueMonthlyBills({ cityId, billingMonth: month });

    expect(result.queued).toBe(1);

    const rows = await db.notificationOutbox.findMany({ where: { batchId: result.batchId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].customerId).toBe(customers.ok);
    expect(rows[0].recipient).toBe("919812345678");
    expect(rows[0].status).toBe("PENDING");
  });

  it("reports every exclusion with a reason rather than dropping it silently", async () => {
    const result = await enqueueMonthlyBills({ cityId, billingMonth: month });
    const reasons = Object.fromEntries(result.skipped.map((s) => [s.customerName, s.reason]));

    expect(reasons["WhatsApp Test noconsent"]).toBe("No WhatsApp consent recorded");
    expect(reasons["WhatsApp Test nomobile"]).toBe("No mobile number");
    expect(reasons["WhatsApp Test badmobile"]).toBe("Not a valid Indian mobile number");
    expect(reasons["WhatsApp Test zero"]).toBe("Nothing delivered and nothing outstanding");
  });

  it("stores template variables, not rendered text — the Meta migration depends on this", async () => {
    const result = await enqueueMonthlyBills({ cityId, billingMonth: month });
    const row = await db.notificationOutbox.findFirstOrThrow({ where: { batchId: result.batchId } });

    expect(row.template).toBe("monthly_bill_link_v1");
    const variables = row.variables as Record<string, unknown>;
    expect(variables.amountDue).toBe("2340");
    expect(variables.customerName).toBe("WhatsApp Test ok");
    expect(variables.month).toBe(7);
    // Only the bill's id is stored; the signed link is made at send time.
    expect(variables.billId).toBe(bills.ok);
  });

  it("queues nothing the second time — the unique index makes a double click harmless", async () => {
    const first = await enqueueMonthlyBills({ cityId, billingMonth: month });
    const second = await enqueueMonthlyBills({ cityId, billingMonth: month });

    expect(first.queued).toBe(1);
    expect(second.queued).toBe(0);
    expect(second.alreadyQueued).toBe(1);

    const total = await db.notificationOutbox.count({
      where: { customerId: { in: Object.values(customers) } },
    });
    expect(total).toBe(1);
  });

  it("refuses to send a DRAFT bill, whose figures can still change", async () => {
    await db.monthlyBill.update({ where: { id: bills.ok }, data: { status: "DRAFT" } });

    const result = await enqueueMonthlyBills({ cityId, billingMonth: month });
    expect(result.queued).toBe(0);

    await db.monthlyBill.update({ where: { id: bills.ok }, data: { status: "GENERATED" } });
  });
});

describe("claim and report", () => {
  it("renders the message and hands it over addressed for WhatsApp", async () => {
    await queueTextRow();

    const claimed = await claimPending(10);
    const mine = claimed.filter((message) => message.chatId === "919812345678@c.us");

    expect(mine).toHaveLength(1);
    expect(mine[0].text).toContain("WhatsApp Test ok");
    expect(mine[0].text).toContain("2,340.00");

    const row = await db.notificationOutbox.findFirstOrThrow({ where: { id: mine[0].id } });
    expect(row.status).toBe("SENDING");
    expect(row.attempts).toBe(1);
  });

  it("marks a sent message SENT and keeps the provider reference", async () => {
    await queueTextRow();
    const claimed = await claimPending(10);
    const mine = claimed.find((m) => m.chatId === "919812345678@c.us")!;

    await reportOutcomes([{ id: mine.id, ok: true, providerRef: "wamid.TEST123" }]);

    const row = await db.notificationOutbox.findFirstOrThrow({ where: { id: mine.id } });
    expect(row.status).toBe("SENT");
    expect(row.providerRef).toBe("wamid.TEST123");
    expect(row.sentAt).not.toBeNull();
  });

  it("fails a permanent rejection immediately instead of spending retries on it", async () => {
    await queueTextRow();
    const claimed = await claimPending(10);
    const mine = claimed.find((m) => m.chatId === "919812345678@c.us")!;

    await reportOutcomes([{ id: mine.id, ok: false, error: "not registered", permanent: true }]);

    const row = await db.notificationOutbox.findFirstOrThrow({ where: { id: mine.id } });
    expect(row.status).toBe("FAILED");
    expect(row.lastError).toBe("not registered");
  });

  it("requeues a retryable failure with a backoff instead of retrying immediately", async () => {
    await queueTextRow();
    const claimed = await claimPending(10);
    const mine = claimed.find((m) => m.chatId === "919812345678@c.us")!;

    await reportOutcomes([{ id: mine.id, ok: false, error: "socket timeout" }]);

    const row = await db.notificationOutbox.findFirstOrThrow({ where: { id: mine.id } });
    expect(row.status).toBe("PENDING");
    expect(row.notBefore.getTime()).toBeGreaterThan(Date.now());
  });

  it("refunds the attempt when a message is released unsent — a stopped gateway must not burn retries", async () => {
    await queueTextRow();
    const claimed = await claimPending(10);
    const mine = claimed.find((m) => m.chatId === "919812345678@c.us")!;

    const afterClaim = await db.notificationOutbox.findFirstOrThrow({ where: { id: mine.id } });
    expect(afterClaim.attempts).toBe(1);

    await reportOutcomes([
      { id: mine.id, ok: false, error: "Cannot reach OpenWA", released: true },
    ]);

    const row = await db.notificationOutbox.findFirstOrThrow({ where: { id: mine.id } });
    expect(row.status).toBe("PENDING");
    expect(row.attempts).toBe(0);
    expect(row.claimedAt).toBeNull();
    // Immediately claimable again — the agent paces its own retry.
    expect(row.notBefore.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("does not hand the same message to a second claim while it is in flight", async () => {
    await queueTextRow();

    const first = await claimPending(10);
    const second = await claimPending(10);

    const firstIds = new Set(first.map((m) => m.id));
    expect(second.some((m) => firstIds.has(m.id))).toBe(false);
  });
});

describe("the two senders never touch each other's rows", () => {
  it("leaves a Zoepact bill message for the Zoepact sender, and a text row for the agent", async () => {
    await enqueueMonthlyBills({ cityId, billingMonth: month }); // a Zoepact-family row
    await queueTextRow(); //                                      a text-family row

    const forAgent = (await claimPending(50)).filter((m) => m.chatId === "919812345678@c.us");
    expect(forAgent).toHaveLength(1);
    expect(forAgent[0].text).toContain("WhatsApp Test ok");

    const forZoepact = (await claimForZoepact(50)).filter((row) => row.recipient === "919812345678");
    expect(forZoepact).toHaveLength(1);
    expect(forZoepact[0].template).toBe("monthly_bill_link_v1");
  });

  it("does not let the agent fail a Zoepact row it cannot render", async () => {
    const result = await enqueueMonthlyBills({ cityId, billingMonth: month });
    await claimPending(50);

    const row = await db.notificationOutbox.findFirstOrThrow({ where: { batchId: result.batchId } });
    expect(row.status).toBe("PENDING");
    expect(row.attempts).toBe(0);
  });
});

describe("payment reminders", () => {
  it("plans a reminder only for an owing customer who has consent and a usable number", async () => {
    const plan = await planPaymentReminders(cityId);
    const mine = plan.candidates.filter((candidate) => Object.values(customers).includes(candidate.customerId));

    expect(mine.map((candidate) => candidate.customerId)).toEqual([customers.ok]);
    expect(mine[0]).toMatchObject({
      recipient: "919812345678", month: 7, outstanding: 2340, billId: bills.ok,
      routeId, routeLabel: `WAR-${suffix} - WA Test Route`, vehicleId, vehicleLabel: `WAV-${suffix} - WA Test Vehicle`,
    });

    const reasons = Object.fromEntries(plan.skipped.map((entry) => [entry.customerName, entry.reason]));
    expect(reasons["WhatsApp Test noconsent"]).toBe("No WhatsApp consent recorded");
    expect(reasons["WhatsApp Test nomobile"]).toBe("No mobile number");
    expect(reasons["WhatsApp Test badmobile"]).toBe("Not a valid Indian mobile number");
    // Nothing owed, so not even a skip: they are simply not on the list.
    expect(reasons["WhatsApp Test zero"]).toBeUndefined();
  });

  it("queues once per customer per day, however many times it is pressed", async () => {
    const now = new Date("2026-11-20T06:00:00Z");
    const first = await enqueuePaymentReminders({ cityId, now });
    const second = await enqueuePaymentReminders({ cityId, now });

    expect(first.queued).toBe(1);
    expect(second.queued).toBe(0);
    expect(second.alreadyQueued).toBe(1);

    const row = await db.notificationOutbox.findFirstOrThrow({ where: { batchId: first.batchId } });
    expect(row.template).toBe("payment_reminder_hi_en_v1");
    expect(row.variables).toEqual({ month: 7, outstanding: "2340.00" });

    // The next day is a fresh reminder.
    const nextDay = await enqueuePaymentReminders({ cityId, now: new Date("2026-11-21T06:00:00Z") });
    expect(nextDay.queued).toBe(1);
  });

  it("stops reminding a customer once verified payments cover the balance", async () => {
    // The bill already accounts for 780 of payments (its paymentAmount), so the
    // 2,340 still owed is cleared by 2,340 MORE, i.e. 3,120 verified in all.
    const payment = await db.payment.create({
      data: { customerId: customers.ok, routeId, amount: 3120, mode: "CASH", status: "VERIFIED", paymentDate: new Date() },
    });
    try {
      const plan = await planPaymentReminders(cityId);
      expect(plan.candidates.some((candidate) => candidate.customerId === customers.ok)).toBe(false);
    } finally {
      await db.payment.delete({ where: { id: payment.id } });
    }
  });
});

describe("choosing who gets a message", () => {
  it("lists the eligible bills without queueing anything", async () => {
    const plan = await planMonthlyBills({ cityId, billingMonth: month });

    expect(plan.candidates.map((candidate) => candidate.customerId)).toEqual([customers.ok]);
    expect(plan.candidates[0]).toMatchObject({
      recipient: "919812345678", billId: bills.ok, amountDue: "2340",
      routeId, routeLabel: `WAR-${suffix} - WA Test Route`, vehicleId, vehicleLabel: `WAV-${suffix} - WA Test Vehicle`,
    });
    expect(plan.skipped).toHaveLength(4);
    expect(await db.notificationOutbox.count({ where: { customerId: { in: Object.values(customers) } } })).toBe(0);
  });

  it("queues only the customers chosen", async () => {
    const result = await enqueueMonthlyBills({ cityId, billingMonth: month, customerIds: [customers.ok] });
    expect(result.queued).toBe(1);

    const none = await enqueueMonthlyBills({ cityId, billingMonth: month, customerIds: [] });
    expect(none.queued).toBe(0);
  });

  it("can only narrow the list: a customer the rules exclude is ignored even if named", async () => {
    // noconsent / nomobile / badmobile / zero are all ineligible; naming them must do nothing.
    const result = await enqueueMonthlyBills({
      cityId,
      billingMonth: month,
      customerIds: [customers.noconsent, customers.nomobile, customers.badmobile, customers.zero],
    });
    expect(result.queued).toBe(0);
    expect(await db.notificationOutbox.count({ where: { customerId: { in: Object.values(customers) } } })).toBe(0);
  });

  it("queues only the chosen reminders, and ignores an ineligible customer even if named", async () => {
    const now = new Date("2026-11-20T06:00:00Z");

    const ignored = await enqueuePaymentReminders({ cityId, now, customerIds: [customers.noconsent] });
    expect(ignored.queued).toBe(0);

    const chosen = await enqueuePaymentReminders({ cityId, now, customerIds: [customers.ok] });
    expect(chosen.queued).toBe(1);
  });
});

describe("removing people from the queue", () => {
  it("removes a waiting message and records it as cancelled", async () => {
    const result = await enqueueMonthlyBills({ cityId, billingMonth: month });
    const waiting = (await getPendingMessages(cityId)).filter((message) => message.customerCode.endsWith(suffix));
    expect(waiting).toHaveLength(1);
    expect(waiting[0]).toMatchObject({ customerName: "WhatsApp Test ok", template: "monthly_bill_link_v1" });

    expect(await cancelMessages({ cityId, ids: [waiting[0].id] })).toBe(1);
    const row = await db.notificationOutbox.findFirstOrThrow({ where: { batchId: result.batchId } });
    expect(row.status).toBe("CANCELLED");
    expect((await getPendingMessages(cityId)).some((message) => message.id === waiting[0].id)).toBe(false);
  });

  it("leaves a message alone once it has been picked up or sent", async () => {
    await enqueueMonthlyBills({ cityId, billingMonth: month });
    const [claimed] = await claimForZoepact(50);
    expect(claimed).toBeDefined();

    expect(await cancelMessages({ cityId, ids: [claimed.id] })).toBe(0);
    const row = await db.notificationOutbox.findFirstOrThrow({ where: { id: claimed.id } });
    expect(row.status).toBe("SENDING");
  });

  it("does nothing for ids that don't exist or belong to another city", async () => {
    expect(await cancelMessages({ cityId, ids: ["00000000-0000-4000-8000-000000000000"] })).toBe(0);
    expect(await cancelMessages({ cityId, ids: [] })).toBe(0);

    const other = await db.city.create({ data: { code: `WB${suffix}`, name: `Other ${suffix}` } });
    try {
      await enqueueMonthlyBills({ cityId, billingMonth: month });
      const [mine] = await getPendingMessages(cityId);
      expect(await cancelMessages({ cityId: other.id, ids: [mine.id] })).toBe(0);
    } finally {
      await db.auditLog.deleteMany({ where: { cityId: other.id } });
      await db.city.delete({ where: { id: other.id } });
    }
  });
});

describe("notices", () => {
  const rate = { effectiveDate: "1 December 2026", ratesTextHi: "दूध (प्रति लीटर): ₹60 → ₹62; पनीर (प्रति किलो): ₹320 → ₹340", ratesTextEn: "Milk (per litre): ₹60 → ₹62; Paneer (per kg): ₹320 → ₹340" };
  const mine = () => db.notificationOutbox.findMany({ where: { customerId: { in: Object.values(customers) } } });

  it("lets anyone with consent and a usable number receive a notice, whether or not they owe", async () => {
    const audience = await planNoticeAudience(cityId);
    const ours = audience.candidates.filter((candidate) => Object.values(customers).includes(candidate.customerId));

    // ok and zero have consent and a valid number; the zero-balance customer is fine for a notice.
    expect(ours.map((candidate) => candidate.customerId).sort()).toEqual([customers.ok, customers.zero].sort());
    expect(audience.noConsent).toBeGreaterThanOrEqual(1);
    expect(audience.noNumber).toBeGreaterThanOrEqual(2);
  });

  it("queues the notice only to the customers chosen, with the values stored for the sender", async () => {
    const result = await enqueueNotice({ cityId, template: "rate_change_notice_v1", variables: rate, customerIds: [customers.ok] });
    expect(result.queued).toBe(1);

    const rows = await mine();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ customerId: customers.ok, template: "rate_change_notice_v1", recipient: "919812345678", status: "PENDING" });
    expect(rows[0].variables).toEqual(rate);
  });

  it("can only narrow: a customer without consent or a number is ignored even if named", async () => {
    const result = await enqueueNotice({
      cityId, template: "delivery_notice_v1",
      variables: { date: "14 November 2026", messageHi: "आज अवकाश", messageEn: "Holiday today" },
      customerIds: [customers.noconsent, customers.nomobile, customers.badmobile],
    });
    expect(result.queued).toBe(0);
    expect(await mine()).toHaveLength(0);
  });

  it("sends the same notice to the same customer once, and a changed notice again", async () => {
    const first = await enqueueNotice({ cityId, template: "rate_change_notice_v1", variables: rate, customerIds: [customers.ok] });
    const again = await enqueueNotice({ cityId, template: "rate_change_notice_v1", variables: rate, customerIds: [customers.ok] });
    expect(first.queued).toBe(1);
    expect(again.queued).toBe(0);
    expect(again.alreadyQueued).toBe(1);

    const changed = await enqueueNotice({
      cityId, template: "rate_change_notice_v1", variables: { ...rate, ratesTextEn: "Milk (per litre): ₹60 → ₹63" }, customerIds: [customers.ok],
    });
    expect(changed.queued).toBe(1);
    expect(await mine()).toHaveLength(2);
  });

  it("refuses a notice WhatsApp would reject, before anything is queued", async () => {
    await expect(
      enqueueNotice({ cityId, template: "rate_change_notice_v1", variables: { ...rate, ratesTextEn: "line one\nline two" }, customerIds: [customers.ok] }),
    ).rejects.toThrow();
    await expect(
      enqueueNotice({ cityId, template: "delivery_notice_v1", variables: { date: "", messageHi: "x", messageEn: "y" }, customerIds: [customers.ok] }),
    ).rejects.toThrow();
    expect(await mine()).toHaveLength(0);
  });

  it("hands a queued notice to the Zoepact sender, never the old text agent", async () => {
    await enqueueNotice({ cityId, template: "rate_change_notice_v1", variables: rate, customerIds: [customers.ok] });

    expect((await claimPending(50)).filter((message) => message.chatId === "919812345678@c.us")).toHaveLength(0);
    const forZoepact = (await claimForZoepact(50)).filter((row) => row.recipient === "919812345678");
    expect(forZoepact).toHaveLength(1);
    expect(forZoepact[0].template).toBe("rate_change_notice_v1");
  });
});

describe("delivery completed", () => {
  const day = "2026-11-21";
  let entryId: string;
  let paneerId: string;

  async function line(customerId: string, sequenceNo: number, options: { skipped?: boolean; milk?: number; paneer?: number }) {
    const created = await db.dailyRouteEntryLine.create({ data: { entryId, customerId, sequenceNo, skipped: options.skipped ?? false } });
    if (options.milk) await db.dailyRouteEntryLineProduct.create({ data: { lineId: created.id, productId, quantity: options.milk, rateSnapshot: 62 } });
    if (options.paneer) await db.dailyRouteEntryLineProduct.create({ data: { lineId: created.id, productId: paneerId, quantity: options.paneer, rateSnapshot: 320 } });
  }

  beforeEach(async () => {
    // Display orders are explicit: the message must list products in the shop's own order, not in whatever order the database returns them.
    await db.product.update({ where: { id: productId }, data: { displayOrder: 1 } });
    const paneer = await db.product.create({ data: { cityId, code: `WAQ-${suffix}-${Math.random().toString(36).slice(2, 6)}`, name: "WA Test Paneer", unit: "kg", defaultRate: 320, displayOrder: 2 } });
    paneerId = paneer.id;
    const entry = await db.dailyRouteEntry.create({ data: { routeId, entryDate: new Date(`${day}T00:00:00.000Z`) } });
    entryId = entry.id;

    // Delivery updates are a separate opt-in: only ok has agreed to them.
    await db.customer.update({ where: { id: customers.ok }, data: { deliveryUpdatesOptInAt: new Date() } });
    await line(customers.ok, 1, { milk: 2, paneer: 0.5 });
    await line(customers.noconsent, 2, { milk: 1 });
    await line(customers.nomobile, 3, { milk: 1 });
    await line(customers.badmobile, 4, { milk: 1 });
    await line(customers.zero, 5, { skipped: true }); // skipped: not delivered, so not on the list
  });

  afterEach(async () => {
    await db.customer.updateMany({ where: { id: { in: Object.values(customers) } }, data: { deliveryUpdatesOptInAt: null } });
    await db.dailyRouteEntryLineProduct.deleteMany({ where: { line: { entryId } } });
    await db.dailyRouteEntryLine.deleteMany({ where: { entryId } });
    await db.dailyRouteEntry.deleteMany({ where: { id: entryId } });
    await db.product.deleteMany({ where: { id: paneerId } });
  });

  it("lists who was delivered what, with the price of each line and the day's total", async () => {
    const plan = await planDeliveryUpdates(cityId, day);

    expect(plan.candidates.map((candidate) => candidate.customerId)).toEqual([customers.ok]);
    expect(plan.candidates[0]).toMatchObject({
      itemsText: "WA Test Milk 2 ltr = ₹124; WA Test Paneer 0.5 kg = ₹160",
      amount: 284,
      recipient: "919812345678",
      routeId,
      routeLabel: `WAR-${suffix} - WA Test Route`,
      vehicleId,
    });
    // Delivered that day: ok, noconsent, nomobile, badmobile. The skipped stop is not counted.
    // noconsent has no WhatsApp consent; nomobile and badmobile have it but have not opted in to
    // delivery updates, and that is the reason the office needs to see first.
    expect(plan).toMatchObject({ delivered: 4, noConsent: 1, noDeliveryOptIn: 2, noNumber: 0, tooLong: 0 });
  });

  it("reports a customer who opted in but has no usable number as that, not as left out for consent", async () => {
    await db.customer.updateMany({ where: { id: { in: [customers.nomobile, customers.badmobile] } }, data: { deliveryUpdatesOptInAt: new Date() } });
    const plan = await planDeliveryUpdates(cityId, day);
    expect(plan).toMatchObject({ noConsent: 1, noDeliveryOptIn: 0, noNumber: 2 });
    expect(plan.candidates.map((candidate) => candidate.customerId)).toEqual([customers.ok]);
  });

  it("lists the products in the shop's own display order, whichever way the database returns them", async () => {
    await db.product.update({ where: { id: paneerId }, data: { displayOrder: 0 } }); // now before the milk (1)
    const plan = await planDeliveryUpdates(cityId, day);
    expect(plan.candidates[0].itemsText).toBe("WA Test Paneer 0.5 kg = ₹160; WA Test Milk 2 ltr = ₹124");
  });

  it("finds nothing for a date with no deliveries, and refuses a bad date", async () => {
    expect(await planDeliveryUpdates(cityId, "2026-11-22")).toMatchObject({ delivered: 0, candidates: [] });
    await expect(planDeliveryUpdates(cityId, "21/11/2026")).rejects.toThrow();
    await expect(planDeliveryUpdates(cityId, "2026-13-45")).rejects.toThrow();
  });

  it("queues the chosen customers with the figures as they were, and a readable date", async () => {
    const result = await enqueueDeliveryUpdates({ cityId, day, customerIds: [customers.ok] });
    expect(result.queued).toBe(1);

    const rows = await db.notificationOutbox.findMany({ where: { customerId: { in: Object.values(customers) } } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ template: "delivery_completed_v1", recipient: "919812345678", status: "PENDING" });
    expect(rows[0].variables).toEqual({ date: "21 November 2026", itemsText: "WA Test Milk 2 ltr = ₹124; WA Test Paneer 0.5 kg = ₹160", amount: "284.00" });
  });

  it("can only narrow: a customer without consent, a number or a delivery is ignored even if named", async () => {
    const result = await enqueueDeliveryUpdates({
      cityId, day, customerIds: [customers.noconsent, customers.nomobile, customers.badmobile, customers.zero],
    });
    expect(result.queued).toBe(0);
    expect(await db.notificationOutbox.count({ where: { customerId: { in: Object.values(customers) } } })).toBe(0);
  });

  it("sends one message per customer per delivery date, however many times it is pressed", async () => {
    const first = await enqueueDeliveryUpdates({ cityId, day, customerIds: [customers.ok] });
    const again = await enqueueDeliveryUpdates({ cityId, day, customerIds: [customers.ok] });
    expect(first.queued).toBe(1);
    expect(again).toMatchObject({ queued: 0, alreadyQueued: 1 });
  });

  it("hands the queued update to the Zoepact sender, never the old text agent", async () => {
    await enqueueDeliveryUpdates({ cityId, day, customerIds: [customers.ok] });

    expect((await claimPending(50)).filter((message) => message.chatId === "919812345678@c.us")).toHaveLength(0);
    const forZoepact = (await claimForZoepact(50)).filter((row) => row.recipient === "919812345678");
    expect(forZoepact).toHaveLength(1);
    expect(forZoepact[0].template).toBe("delivery_completed_v1");
  });
});

describe("delivery updates consent", () => {
  const day = "2026-11-21";
  const everyone = () => Object.values(customers);

  async function reset() {
    await db.customer.updateMany({ where: { id: { in: everyone() } }, data: { deliveryUpdatesOptInAt: null } });
    // The fixtures' general WhatsApp consent, which a test may have withdrawn.
    for (const key of ["ok", "nomobile", "badmobile", "zero"]) {
      await db.customer.update({ where: { id: customers[key] }, data: { whatsappOptInAt: new Date() } });
    }
    await db.customer.update({ where: { id: customers.noconsent }, data: { whatsappOptInAt: null } });
  }

  beforeEach(reset);
  afterEach(reset);

  it("lists only customers who could be opted in: WhatsApp consent, a usable number, not already opted in", async () => {
    await db.customer.update({ where: { id: customers.zero }, data: { deliveryUpdatesOptInAt: new Date() } });
    const plan = await planDeliveryOptIn(cityId);
    const ours = plan.candidates.filter((candidate) => everyone().includes(candidate.customerId));

    expect(ours.map((candidate) => candidate.customerId)).toEqual([customers.ok]);
    expect(plan.alreadyOptedIn).toBeGreaterThanOrEqual(1); // zero
    expect(plan.noWhatsAppConsent).toBeGreaterThanOrEqual(1); // noconsent
    expect(plan.noNumber).toBeGreaterThanOrEqual(2); // nomobile, badmobile
  });

  it("will not opt in someone who has not agreed to WhatsApp at all", async () => {
    await expect(setDeliveryUpdatesConsent({ cityId, customerId: customers.noconsent, optIn: true })).rejects.toThrow(/WhatsApp/);
    const row = await db.customer.findUniqueOrThrow({ where: { id: customers.noconsent } });
    expect(row.deliveryUpdatesOptInAt).toBeNull();
  });

  it("records a dated opt-in, and an opt-out clears it", async () => {
    await setDeliveryUpdatesConsent({ cityId, customerId: customers.ok, optIn: true });
    expect((await db.customer.findUniqueOrThrow({ where: { id: customers.ok } })).deliveryUpdatesOptInAt).toBeInstanceOf(Date);

    await setDeliveryUpdatesConsent({ cityId, customerId: customers.ok, optIn: false });
    expect((await db.customer.findUniqueOrThrow({ where: { id: customers.ok } })).deliveryUpdatesOptInAt).toBeNull();
  });

  it("withdrawing WhatsApp consent withdraws the delivery opt-in with it", async () => {
    await setDeliveryUpdatesConsent({ cityId, customerId: customers.ok, optIn: true });
    await setCustomerConsent({ cityId, customerId: customers.ok, optIn: false });

    const row = await db.customer.findUniqueOrThrow({ where: { id: customers.ok } });
    expect(row.whatsappOptInAt).toBeNull();
    expect(row.deliveryUpdatesOptInAt).toBeNull();
  });

  it("opts in the chosen customers only, and can only narrow: an ineligible one named is ignored", async () => {
    const count = await bulkOptInDeliveryUpdates({ cityId, customerIds: [customers.ok, customers.noconsent, customers.nomobile, customers.badmobile] });
    expect(count).toBe(1);

    const rows = await db.customer.findMany({ where: { id: { in: everyone() } }, select: { id: true, deliveryUpdatesOptInAt: true } });
    expect(rows.filter((row) => row.deliveryUpdatesOptInAt).map((row) => row.id)).toEqual([customers.ok]);

    // Asking again changes nothing: already opted in.
    expect(await bulkOptInDeliveryUpdates({ cityId, customerIds: [customers.ok] })).toBe(0);
    expect(await bulkOptInDeliveryUpdates({ cityId, customerIds: [] })).toBe(0);
  });

  it("counts the opt-ins in the consent summary", async () => {
    const before = (await getConsentSummary(cityId)).deliveryUpdatesOptedIn;
    await setDeliveryUpdatesConsent({ cityId, customerId: customers.ok, optIn: true });
    expect((await getConsentSummary(cityId)).deliveryUpdatesOptedIn).toBe(before + 1);
  });

  it("keeps a customer off the delivery list until they opt in, and tells the office why", async () => {
    const entry = await db.dailyRouteEntry.create({ data: { routeId, entryDate: new Date(`${day}T00:00:00.000Z`) } });
    const created = await db.dailyRouteEntryLine.create({ data: { entryId: entry.id, customerId: customers.ok, sequenceNo: 1 } });
    await db.dailyRouteEntryLineProduct.create({ data: { lineId: created.id, productId, quantity: 1, rateSnapshot: 62 } });
    try {
      // General WhatsApp consent only: not enough for delivery updates.
      const before = await planDeliveryUpdates(cityId, day);
      expect(before.candidates).toHaveLength(0);
      expect(before).toMatchObject({ delivered: 1, noDeliveryOptIn: 1, noConsent: 0 });
      expect((await enqueueDeliveryUpdates({ cityId, day, customerIds: [customers.ok] })).queued).toBe(0);

      await setDeliveryUpdatesConsent({ cityId, customerId: customers.ok, optIn: true });
      const after = await planDeliveryUpdates(cityId, day);
      expect(after.candidates.map((candidate) => candidate.customerId)).toEqual([customers.ok]);
      expect(after.noDeliveryOptIn).toBe(0);
    } finally {
      await db.dailyRouteEntryLineProduct.deleteMany({ where: { line: { entryId: entry.id } } });
      await db.dailyRouteEntryLine.deleteMany({ where: { entryId: entry.id } });
      await db.dailyRouteEntry.delete({ where: { id: entry.id } });
    }
  });
});

describe("payment updates consent", () => {
  const everyone = () => Object.values(customers);

  async function reset() {
    await db.customer.updateMany({ where: { id: { in: everyone() } }, data: { deliveryUpdatesOptInAt: null, paymentUpdatesOptInAt: null } });
    for (const key of ["ok", "nomobile", "badmobile", "zero"]) {
      await db.customer.update({ where: { id: customers[key] }, data: { whatsappOptInAt: new Date() } });
    }
    await db.customer.update({ where: { id: customers.noconsent }, data: { whatsappOptInAt: null } });
  }
  beforeEach(reset);
  afterEach(reset);

  it("is its own opt-in: agreeing to delivery updates does not agree to payment updates, or the reverse", async () => {
    await setUpdatesConsent({ cityId, customerId: customers.ok, kind: "delivery", optIn: true });
    let row = await db.customer.findUniqueOrThrow({ where: { id: customers.ok } });
    expect(row.deliveryUpdatesOptInAt).toBeInstanceOf(Date);
    expect(row.paymentUpdatesOptInAt).toBeNull();

    await setUpdatesConsent({ cityId, customerId: customers.ok, kind: "payment", optIn: true });
    await setUpdatesConsent({ cityId, customerId: customers.ok, kind: "delivery", optIn: false });
    row = await db.customer.findUniqueOrThrow({ where: { id: customers.ok } });
    expect(row.deliveryUpdatesOptInAt).toBeNull();
    expect(row.paymentUpdatesOptInAt).toBeInstanceOf(Date);
  });

  it("needs general WhatsApp consent first, and withdrawing it withdraws both extras", async () => {
    await expect(setUpdatesConsent({ cityId, customerId: customers.noconsent, kind: "payment", optIn: true })).rejects.toThrow(/WhatsApp/);

    await setUpdatesConsent({ cityId, customerId: customers.ok, kind: "delivery", optIn: true });
    await setUpdatesConsent({ cityId, customerId: customers.ok, kind: "payment", optIn: true });
    await setCustomerConsent({ cityId, customerId: customers.ok, optIn: false });
    const row = await db.customer.findUniqueOrThrow({ where: { id: customers.ok } });
    expect(row).toMatchObject({ whatsappOptInAt: null, deliveryUpdatesOptInAt: null, paymentUpdatesOptInAt: null });
  });

  it("lists who could be opted in to payment updates, and opts in only the eligible chosen", async () => {
    // ok and zero both have WhatsApp consent and a usable number and have not agreed to payment
    // updates yet; noconsent, nomobile and badmobile cannot be listed.
    const plan = await planUpdatesOptIn(cityId, "payment");
    expect(plan.candidates.filter((candidate) => everyone().includes(candidate.customerId)).map((candidate) => candidate.customerId).sort()).toEqual([customers.ok, customers.zero].sort());

    const count = await bulkOptInUpdates({ cityId, kind: "payment", customerIds: [customers.ok, customers.noconsent, customers.nomobile, customers.badmobile] });
    expect(count).toBe(1);
    expect(await bulkOptInUpdates({ cityId, kind: "payment", customerIds: [customers.ok] })).toBe(0);
    // The delivery list is unaffected.
    expect((await planDeliveryOptIn(cityId)).candidates.some((candidate) => candidate.customerId === customers.ok)).toBe(true);
  });

  it("counts payment opt-ins in the consent summary, separately from delivery", async () => {
    const before = await getConsentSummary(cityId);
    await setUpdatesConsent({ cityId, customerId: customers.ok, kind: "payment", optIn: true });
    const after = await getConsentSummary(cityId);
    expect(after.paymentUpdatesOptedIn).toBe(before.paymentUpdatesOptedIn + 1);
    expect(after.deliveryUpdatesOptedIn).toBe(before.deliveryUpdatesOptedIn);
  });
});

describe("payment received", () => {
  const from = "2026-11-18";
  const to = "2026-11-21";
  const made: string[] = [];

  async function pay(customerKey: string, amount: number, status: "VERIFIED" | "PENDING" | "CANCELLED", options: { date?: string; mode?: "CASH" | "UPI"; routeLess?: boolean } = {}) {
    const payment = await db.payment.create({
      data: {
        customerId: customers[customerKey],
        routeId: options.routeLess ? null : routeId,
        amount,
        mode: options.mode ?? "CASH",
        status,
        paymentDate: new Date(`${options.date ?? "2026-11-20"}T00:00:00.000Z`),
      },
    });
    made.push(payment.id);
    return payment;
  }

  beforeEach(async () => {
    // ok has agreed to both; noconsent has not agreed to WhatsApp at all; zero agreed to WhatsApp but not to payment updates.
    await db.customer.updateMany({ where: { id: { in: Object.values(customers) } }, data: { paymentUpdatesOptInAt: null } });
    await db.customer.update({ where: { id: customers.ok }, data: { paymentUpdatesOptInAt: new Date() } });
  });

  afterEach(async () => {
    await db.payment.deleteMany({ where: { id: { in: made.splice(0) } } });
    await db.customer.updateMany({ where: { id: { in: Object.values(customers) } }, data: { paymentUpdatesOptInAt: null } });
  });

  it("lists only VERIFIED payments, with the amount, date, mode, route and vehicle", async () => {
    await pay("ok", 1500, "VERIFIED", { mode: "UPI" });
    await pay("ok", 700, "PENDING");
    await pay("ok", 900, "CANCELLED");

    const plan = await planPaymentUpdates(cityId, from, to);
    expect(plan.candidates).toHaveLength(1);
    expect(plan.candidates[0]).toMatchObject({
      customerId: customers.ok, amount: 1500, day: "2026-11-20", mode: "UPI", recipient: "919812345678",
      routeId, routeLabel: `WAR-${suffix} - WA Test Route`, vehicleId,
    });
    expect(plan.verified).toBe(1);
  });

  it("leaves out payments by customers without consent, without the payment opt-in, or without a number, and says why", async () => {
    await pay("ok", 100, "VERIFIED");
    await pay("noconsent", 200, "VERIFIED"); //   no WhatsApp consent at all
    await pay("zero", 300, "VERIFIED"); //        WhatsApp yes, payment updates no
    await db.customer.update({ where: { id: customers.badmobile }, data: { paymentUpdatesOptInAt: new Date() } });
    await pay("badmobile", 400, "VERIFIED"); //   opted in but the number is unusable

    const plan = await planPaymentUpdates(cityId, from, to);
    expect(plan.candidates.map((candidate) => candidate.customerId)).toEqual([customers.ok]);
    expect(plan).toMatchObject({ verified: 4, noConsent: 1, noPaymentOptIn: 1, noNumber: 1 });
  });

  it("only looks inside the date range, and keeps a payment with no route", async () => {
    await pay("ok", 100, "VERIFIED", { date: "2026-11-10" }); // before
    await pay("ok", 200, "VERIFIED", { date: "2026-11-25" }); // after
    await pay("ok", 300, "VERIFIED", { date: "2026-11-18" }); // first day, included
    await pay("ok", 400, "VERIFIED", { date: "2026-11-21", routeLess: true }); // last day, no route

    const plan = await planPaymentUpdates(cityId, from, to);
    expect(plan.candidates.map((candidate) => candidate.amount).sort()).toEqual([300, 400]);
    expect(plan.candidates.find((candidate) => candidate.amount === 400)).toMatchObject({ routeId: "", vehicleId: "" });
  });

  it("refuses a bad or over-long date range", async () => {
    await expect(planPaymentUpdates(cityId, "21/11/2026", to)).rejects.toThrow();
    await expect(planPaymentUpdates(cityId, to, from)).rejects.toThrow(/after/);
    await expect(planPaymentUpdates(cityId, "2026-01-01", "2026-03-01")).rejects.toThrow(/at most/);
  });

  it("queues a receipt only for the payments chosen, and can only narrow", async () => {
    const a = await pay("ok", 1500, "VERIFIED");
    const b = await pay("ok", 250, "VERIFIED");
    const pending = await pay("ok", 999, "PENDING");
    const noConsent = await pay("noconsent", 100, "VERIFIED");

    const result = await enqueuePaymentUpdates({ cityId, from, to, paymentIds: [a.id, pending.id, noConsent.id] });
    expect(result.queued).toBe(1);

    const rows = await db.notificationOutbox.findMany({ where: { customerId: { in: Object.values(customers) } } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ template: "payment_received_v1", recipient: "919812345678", status: "PENDING" });
    expect(rows[0].variables).toEqual({ amount: "1500.00", date: "20 November 2026", mode: "CASH", paymentId: a.id });
    expect(b.id).not.toBe(a.id);
  });

  it("sends one receipt per payment however often it is pressed, and one customer's two payments are two messages", async () => {
    const a = await pay("ok", 1500, "VERIFIED");
    const b = await pay("ok", 250, "VERIFIED");

    expect((await enqueuePaymentUpdates({ cityId, from, to, paymentIds: [a.id] })).queued).toBe(1);
    expect(await enqueuePaymentUpdates({ cityId, from, to, paymentIds: [a.id] })).toMatchObject({ queued: 0, alreadyQueued: 1 });
    expect((await enqueuePaymentUpdates({ cityId, from, to, paymentIds: [a.id, b.id] })).queued).toBe(1);
    expect(await db.notificationOutbox.count({ where: { customerId: customers.ok } })).toBe(2);
  });

  it("does not send a receipt for a payment cancelled after it was queued", async () => {
    const kept = await pay("ok", 1500, "VERIFIED");
    const cancelled = await pay("ok", 250, "VERIFIED");
    await enqueuePaymentUpdates({ cityId, from, to, paymentIds: [kept.id, cancelled.id] });
    await db.payment.update({ where: { id: cancelled.id }, data: { status: "CANCELLED" } });
    // The sender only takes rows that are due. The batch below pretends it is 20 Nov, so make them due then.
    await db.notificationOutbox.updateMany({ where: { customerId: customers.ok }, data: { notBefore: new Date("2026-11-19T00:00:00Z") } });

    process.env.ZOEPACT_API_KEY = "test-key";
    const sent: string[] = [];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/wallet")) return new Response(JSON.stringify({ success: true, data: { balance: 500 } }), { status: 200 });
      if (url.endsWith("/templates/sync")) return new Response(JSON.stringify({ success: true, data: {} }), { status: 200 });
      sent.push(String(init?.body));
      return new Response(JSON.stringify({ success: true, data: { message_id: "wamid.TEST" } }), { status: 200 });
    });
    try {
      // 11:00 IST: inside the sending hours.
      const result = await runZoepactBatch(new Date("2026-11-20T05:30:00Z"));
      expect(result.status).toBe("ran");
    } finally {
      fetchSpy.mockRestore();
      delete process.env.ZOEPACT_API_KEY;
    }

    // Only the payment that is still verified was sent.
    const templateCalls = sent.filter((body) => body.includes("bsmp_payment_received_v1"));
    expect(templateCalls).toHaveLength(1);
    expect(templateCalls[0]).toContain("1,500.00");

    const rows = await db.notificationOutbox.findMany({ where: { customerId: customers.ok } });
    const byPayment = new Map(rows.map((row) => [(row.variables as { paymentId: string }).paymentId, row]));
    expect(byPayment.get(kept.id)).toMatchObject({ status: "SENT", providerRef: "wamid.TEST" });
    expect(byPayment.get(cancelled.id)).toMatchObject({ status: "FAILED" });
    expect(byPayment.get(cancelled.id)?.lastError).toMatch(/no longer verified/);
  });
});
