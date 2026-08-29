import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { enqueueMonthlyBills } from "@/lib/notifications/outbox";
import { claimPending, reportOutcomes } from "@/lib/notifications/dispatch";

// Exercises the real queue against the real dev database, because the parts
// worth testing here are precisely the ones a mock would paper over: the unique
// index that makes double-sending impossible, the atomic claim, and the attempt
// refund on release. Creates and tears down its own throwaway city.

const db = new PrismaClient();

let cityId: string;
let routeId: string;
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

  const [route, product] = await Promise.all([
    db.route.create({ data: { cityId, code: `WAR-${suffix}`, name: "WA Test Route", shift: "MORNING" } }),
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

    expect(row.template).toBe("monthly_bill_v1");
    const variables = row.variables as Record<string, unknown>;
    expect(variables.closingBalance).toBe("2340");
    expect(variables.customerName).toBe("WhatsApp Test ok");
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
    await enqueueMonthlyBills({ cityId, billingMonth: month });

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
    await enqueueMonthlyBills({ cityId, billingMonth: month });
    const claimed = await claimPending(10);
    const mine = claimed.find((m) => m.chatId === "919812345678@c.us")!;

    await reportOutcomes([{ id: mine.id, ok: true, providerRef: "wamid.TEST123" }]);

    const row = await db.notificationOutbox.findFirstOrThrow({ where: { id: mine.id } });
    expect(row.status).toBe("SENT");
    expect(row.providerRef).toBe("wamid.TEST123");
    expect(row.sentAt).not.toBeNull();
  });

  it("fails a permanent rejection immediately instead of spending retries on it", async () => {
    await enqueueMonthlyBills({ cityId, billingMonth: month });
    const claimed = await claimPending(10);
    const mine = claimed.find((m) => m.chatId === "919812345678@c.us")!;

    await reportOutcomes([{ id: mine.id, ok: false, error: "not registered", permanent: true }]);

    const row = await db.notificationOutbox.findFirstOrThrow({ where: { id: mine.id } });
    expect(row.status).toBe("FAILED");
    expect(row.lastError).toBe("not registered");
  });

  it("requeues a retryable failure with a backoff instead of retrying immediately", async () => {
    await enqueueMonthlyBills({ cityId, billingMonth: month });
    const claimed = await claimPending(10);
    const mine = claimed.find((m) => m.chatId === "919812345678@c.us")!;

    await reportOutcomes([{ id: mine.id, ok: false, error: "socket timeout" }]);

    const row = await db.notificationOutbox.findFirstOrThrow({ where: { id: mine.id } });
    expect(row.status).toBe("PENDING");
    expect(row.notBefore.getTime()).toBeGreaterThan(Date.now());
  });

  it("refunds the attempt when a message is released unsent — a stopped gateway must not burn retries", async () => {
    await enqueueMonthlyBills({ cityId, billingMonth: month });
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
    await enqueueMonthlyBills({ cityId, billingMonth: month });

    const first = await claimPending(10);
    const second = await claimPending(10);

    const firstIds = new Set(first.map((m) => m.id));
    expect(second.some((m) => firstIds.has(m.id))).toBe(false);
  });
});
