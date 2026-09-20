import { test, expect } from "@playwright/test";
import {
  TEST_CITY_ID,
  TEST_CUSTOMER_1_ID,
  TEST_CUSTOMER_2_ID,
  TEST_MONTH,
  TEST_MONTH_DATE,
  TEST_PRODUCT_ID,
  TEST_ROUTE_2_ID,
  TEST_ROUTE_ID,
  clearTestMonthData,
  ensureTestSequence,
  testDate,
  testPrisma,
} from "./fixtures";

// "One customer" mode inside the Generate Bills dialog — the same pipeline the
// whole-month batch already uses (see billing-route.spec.ts for proof that
// combining a customer's routes into one bill already works), scoped down to
// whoever is picked. What's new here is the scoping itself, the picker, and
// the refusal on a genuinely ambiguous customer.
test.describe("Generate a bill for one customer", () => {
  async function resetBoth() {
    await clearTestMonthData(TEST_ROUTE_ID);
    await clearTestMonthData(TEST_ROUTE_2_ID);
  }

  test.beforeEach(async () => {
    await resetBoth();
  });

  test.afterAll(async () => {
    await resetBoth();
  });

  async function openCustomerMode(page: import("@playwright/test").Page) {
    await page.goto("/monthly-bills");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Generate bills" }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.locator('input[name="billingMonth"]').fill(TEST_MONTH);
    await dialog.getByRole("button", { name: "One customer" }).click();
    return dialog;
  }

  async function pickCustomer(dialog: import("@playwright/test").Locator, name: string) {
    await dialog.getByLabel("Customer").fill(name);
    await dialog.getByRole("button", { name: new RegExp(name) }).click();
  }

  test("the picker filters to matching customers only", async ({ page }) => {
    const dialog = await openCustomerMode(page);
    await dialog.getByLabel("Customer").fill("Customer One");
    await expect(dialog.getByRole("button", { name: /E2E Customer One/ })).toBeVisible();
    await expect(dialog.getByRole("button", { name: /E2E Customer Two/ })).toHaveCount(0);
  });

  test("generates one bill for a customer on a single route", async ({ page }) => {
    const prisma = testPrisma();
    await ensureTestSequence(TEST_ROUTE_ID, [TEST_CUSTOMER_1_ID]);

    const entry = await prisma.dailyRouteEntry.create({
      data: { routeId: TEST_ROUTE_ID, entryDate: new Date(`${testDate("05")}T00:00:00.000Z`), syncStatus: "SYNCED" },
      select: { id: true },
    });
    const line = await prisma.dailyRouteEntryLine.create({
      data: { entryId: entry.id, customerId: TEST_CUSTOMER_1_ID, sequenceNo: 1, skipped: false },
      select: { id: true },
    });
    await prisma.dailyRouteEntryLineProduct.create({
      data: { lineId: line.id, productId: TEST_PRODUCT_ID, quantity: 4, rateSnapshot: 60 },
    });

    const dialog = await openCustomerMode(page);
    await pickCustomer(dialog, "E2E Customer One");
    await dialog.getByRole("button", { name: "Generate bill" }).click();
    await expect(dialog.getByText("Bill generated for E2E Customer One.")).toBeVisible({ timeout: 15_000 });

    const bill = await prisma.monthlyBill.findFirst({
      where: { customerId: TEST_CUSTOMER_1_ID, routeId: TEST_ROUTE_ID, billingMonth: TEST_MONTH_DATE },
      select: { status: true, deliveryAmount: true },
    });
    expect(bill?.status).toBe("GENERATED");
    expect(Number(bill?.deliveryAmount)).toBe(240);
  });

  test("combines a two-route customer's deliveries onto their billing route, and touches nobody else", async ({ page }) => {
    const prisma = testPrisma();
    await ensureTestSequence(TEST_ROUTE_ID, [TEST_CUSTOMER_1_ID, TEST_CUSTOMER_2_ID]);
    await ensureTestSequence(TEST_ROUTE_2_ID, [TEST_CUSTOMER_1_ID]);
    // Morning (TEST_ROUTE_ID) carries the bill.
    await prisma.monthlyRouteCustomerSequence.updateMany({
      where: { customerId: TEST_CUSTOMER_1_ID, sequenceMonth: TEST_MONTH_DATE },
      data: { billsHere: false },
    });
    await prisma.monthlyRouteCustomerSequence.updateMany({
      where: { customerId: TEST_CUSTOMER_1_ID, sequenceMonth: TEST_MONTH_DATE, routeId: TEST_ROUTE_ID },
      data: { billsHere: true },
    });

    // Deliveries for customer 1 on BOTH routes, and a delivery for customer 2
    // on the morning route — a bystander who must not gain a bill.
    for (const [routeId, customerId, qty] of [
      [TEST_ROUTE_ID, TEST_CUSTOMER_1_ID, 2],
      [TEST_ROUTE_2_ID, TEST_CUSTOMER_1_ID, 3],
      [TEST_ROUTE_ID, TEST_CUSTOMER_2_ID, 5],
    ] as const) {
      const entry = await prisma.dailyRouteEntry.upsert({
        where: { routeId_entryDate: { routeId, entryDate: new Date(`${testDate("05")}T00:00:00.000Z`) } },
        update: {},
        create: { routeId, entryDate: new Date(`${testDate("05")}T00:00:00.000Z`), syncStatus: "SYNCED" },
        select: { id: true },
      });
      const line = await prisma.dailyRouteEntryLine.create({
        data: { entryId: entry.id, customerId, sequenceNo: 1, skipped: false },
        select: { id: true },
      });
      await prisma.dailyRouteEntryLineProduct.create({
        data: { lineId: line.id, productId: TEST_PRODUCT_ID, quantity: qty, rateSnapshot: 60 },
      });
    }

    const dialog = await openCustomerMode(page);
    await pickCustomer(dialog, "E2E Customer One");
    await dialog.getByRole("button", { name: "Generate bill" }).click();
    await expect(dialog.getByText("Bill generated for E2E Customer One.")).toBeVisible({ timeout: 15_000 });

    const bill = await prisma.monthlyBill.findFirst({
      where: { customerId: TEST_CUSTOMER_1_ID, billingMonth: TEST_MONTH_DATE },
      select: { routeId: true, deliveryAmount: true },
    });
    // Both routes' deliveries (2 + 3 = 5) at 60, filed on the billing route.
    expect(bill?.routeId).toBe(TEST_ROUTE_ID);
    expect(Number(bill?.deliveryAmount)).toBe(300);

    // Customer 2's delivery did not spawn a bill — this was scoped to one
    // customer, not the whole route.
    const untouched = await prisma.monthlyBill.findFirst({
      where: { customerId: TEST_CUSTOMER_2_ID, billingMonth: TEST_MONTH_DATE },
    });
    expect(untouched).toBeNull();
  });

  test("refuses a customer on two routes with neither confirmed as their billing route", async ({ page }) => {
    const prisma = testPrisma();
    // Both ACTIVE, neither billsHere — the exact shape of the "167 SEC 2"
    // mistake, and precisely the case a human should be stopped on.
    await prisma.monthlyRouteCustomerSequence.createMany({
      data: [
        {
          routeId: TEST_ROUTE_ID, customerId: TEST_CUSTOMER_1_ID, sequenceMonth: TEST_MONTH_DATE,
          sequenceNo: 1, status: "ACTIVE", billsHere: false,
        },
        {
          routeId: TEST_ROUTE_2_ID, customerId: TEST_CUSTOMER_1_ID, sequenceMonth: TEST_MONTH_DATE,
          sequenceNo: 1, status: "ACTIVE", billsHere: false,
        },
      ],
    });

    const dialog = await openCustomerMode(page);
    await pickCustomer(dialog, "E2E Customer One");
    await dialog.getByRole("button", { name: "Generate bill" }).click();

    await expect(dialog.getByText(/is on 2 routes this month with none/)).toBeVisible({ timeout: 15_000 });
    await expect(dialog.getByText(/Settings → Billing routes/)).toBeVisible();

    // Nothing was written.
    const bill = await prisma.monthlyBill.findFirst({
      where: { customerId: TEST_CUSTOMER_1_ID, billingMonth: TEST_MONTH_DATE },
    });
    expect(bill).toBeNull();
  });

  test("a single route needs no billsHere flag at all — no real ambiguity to catch", async ({ page }) => {
    const prisma = testPrisma();
    // Deliberately bypassing ensureTestSequence's auto-billsHere, to prove the
    // ONE-route case resolves on its own rather than needing the flag.
    await prisma.monthlyRouteCustomerSequence.create({
      data: {
        routeId: TEST_ROUTE_ID, customerId: TEST_CUSTOMER_1_ID, sequenceMonth: TEST_MONTH_DATE,
        sequenceNo: 1, status: "ACTIVE", billsHere: false,
      },
    });

    const dialog = await openCustomerMode(page);
    await pickCustomer(dialog, "E2E Customer One");
    await dialog.getByRole("button", { name: "Generate bill" }).click();

    // No deliveries this month, but a real sequence row still zeroes them out
    // — buildBillPairs bills every sequenced customer, present or not, so a
    // removed-from-the-round customer's balance doesn't silently freeze at
    // whatever it last was. The point of this test is what did NOT happen:
    // no refusal, because one route is not the ambiguity being guarded
    // against.
    await expect(dialog.getByText("Bill generated for E2E Customer One.")).toBeVisible({ timeout: 15_000 });
    await expect(dialog.getByText(/Settings → Billing routes/)).toHaveCount(0);

    const bill = await prisma.monthlyBill.findFirst({
      where: { customerId: TEST_CUSTOMER_1_ID, routeId: TEST_ROUTE_ID, billingMonth: TEST_MONTH_DATE },
      select: { status: true, deliveryAmount: true },
    });
    expect(bill?.status).toBe("GENERATED");
    expect(Number(bill?.deliveryAmount)).toBe(0);
  });

  test("a Locked bill for that customer is reported, not silently overwritten", async ({ page }) => {
    const prisma = testPrisma();
    await ensureTestSequence(TEST_ROUTE_ID, [TEST_CUSTOMER_1_ID]);
    await prisma.monthlyBill.create({
      data: {
        customerId: TEST_CUSTOMER_1_ID, routeId: TEST_ROUTE_ID, billingMonth: TEST_MONTH_DATE,
        openingBalance: 0, deliveryAmount: 900, paymentAmount: 900, closingBalance: 0, status: "LOCKED",
      },
    });

    const dialog = await openCustomerMode(page);
    await pickCustomer(dialog, "E2E Customer One");
    await dialog.getByRole("button", { name: "Generate bill" }).click();

    await expect(dialog.getByText(/is Locked — left unchanged/)).toBeVisible({ timeout: 15_000 });

    const bill = await prisma.monthlyBill.findFirst({
      where: { customerId: TEST_CUSTOMER_1_ID, routeId: TEST_ROUTE_ID, billingMonth: TEST_MONTH_DATE },
      select: { status: true, paymentAmount: true },
    });
    expect(bill?.status).toBe("LOCKED");
    expect(Number(bill?.paymentAmount)).toBe(900);
  });

  test("names the customer in the audit trail, not just a count", async ({ page }) => {
    const prisma = testPrisma();
    await ensureTestSequence(TEST_ROUTE_ID, [TEST_CUSTOMER_1_ID]);
    const entry = await prisma.dailyRouteEntry.create({
      data: { routeId: TEST_ROUTE_ID, entryDate: new Date(`${testDate("05")}T00:00:00.000Z`), syncStatus: "SYNCED" },
      select: { id: true },
    });
    const line = await prisma.dailyRouteEntryLine.create({
      data: { entryId: entry.id, customerId: TEST_CUSTOMER_1_ID, sequenceNo: 1, skipped: false },
      select: { id: true },
    });
    await prisma.dailyRouteEntryLineProduct.create({
      data: { lineId: line.id, productId: TEST_PRODUCT_ID, quantity: 1, rateSnapshot: 60 },
    });

    const dialog = await openCustomerMode(page);
    await pickCustomer(dialog, "E2E Customer One");
    await dialog.getByRole("button", { name: "Generate bill" }).click();
    await expect(dialog.getByText("Bill generated for E2E Customer One.")).toBeVisible({ timeout: 15_000 });

    await expect
      .poll(
        async () => {
          const log = await prisma.auditLog.findFirst({
            where: { cityId: TEST_CITY_ID, entityType: "MonthlyBillBatch", action: "GENERATE" },
            orderBy: { createdAt: "desc" },
            select: { summary: true },
          });
          return log?.summary ?? "";
        },
        { timeout: 15_000 },
      )
      .toContain("E2E Customer One");
  });
});
