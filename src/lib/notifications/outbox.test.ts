import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { cancelMessages, enqueueMonthlyBills, getPendingMessages, planMonthlyBills } from "@/lib/notifications/outbox";
import { claimForZoepact, claimPending, reportOutcomes } from "@/lib/notifications/dispatch";
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
  const rate = { effectiveDate: "1 December 2026", ratesText: "Milk (per litre): ₹60 → ₹62; Paneer (per kg): ₹320 → ₹340" };
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
      cityId, template: "rate_change_notice_v1", variables: { ...rate, ratesText: "Milk (per litre): ₹60 → ₹63" }, customerIds: [customers.ok],
    });
    expect(changed.queued).toBe(1);
    expect(await mine()).toHaveLength(2);
  });

  it("refuses a notice WhatsApp would reject, before anything is queued", async () => {
    await expect(
      enqueueNotice({ cityId, template: "rate_change_notice_v1", variables: { ...rate, ratesText: "line one\nline two" }, customerIds: [customers.ok] }),
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
