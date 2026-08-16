import { test, expect } from "@playwright/test";
import {
  TEST_CUSTOMER_1_ID,
  TEST_CUSTOMER_2_ID,
  TEST_CUSTOMER_3_ID,
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

// Browser coverage for the "one combined bill per customer" work. The maths is
// unit-tested and the schema/pipeline is covered against a real database in
// src/lib/billing-route.test.ts; what neither can reach is the server actions
// and screens, because those call cookies() and only exist inside a request.

async function resetBoth() {
  await clearTestMonthData(TEST_ROUTE_ID);
  await clearTestMonthData(TEST_ROUTE_2_ID);
}

test.describe("Billing route", () => {
  test.beforeEach(async () => {
    await resetBoth();
  });

  test.afterAll(async () => {
    await resetBoth();
  });

  test("asks which route bills a customer already on another route, and records the choice", async ({ page }) => {
    // Customer 1 already runs the morning route this month.
    await ensureTestSequence(TEST_ROUTE_ID, [TEST_CUSTOMER_1_ID]);

    await page.goto(`/monthly-route-sequence?routeId=${TEST_ROUTE_2_ID}&month=${TEST_MONTH}`);
    await page.waitForLoadState("networkidle");

    // Adding them to the EVENING route should stop and ask, not just save.
    await page.getByPlaceholder(/search/i).first().fill("E2E Customer One");
    await page.getByText("E2E Customer One").last().click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await expect(dialog).toContainText(/which route/i);

    // Nothing is written until the question is answered.
    expect(
      await testPrisma().monthlyRouteCustomerSequence.count({
        where: { routeId: TEST_ROUTE_2_ID, customerId: TEST_CUSTOMER_1_ID, sequenceMonth: TEST_MONTH_DATE },
      }),
    ).toBe(0);

    // Choose the evening route (the one being added) as the billing route.
    await dialog.getByRole("radio").last().check();
    await dialog.getByRole("button", { name: /add customer/i }).click();
    await expect(dialog).toBeHidden({ timeout: 10_000 });
    // Wait for the SERVER to confirm, not just the dialog to close.
    await expect(page.getByText(/Customer added to sequence/i).first()).toBeVisible({ timeout: 10_000 });

    const rows = await testPrisma().monthlyRouteCustomerSequence.findMany({
      where: { customerId: TEST_CUSTOMER_1_ID, sequenceMonth: TEST_MONTH_DATE },
      select: { routeId: true, billsHere: true },
    });

    expect(rows).toHaveLength(2);
    expect(rows.filter((row) => row.billsHere)).toHaveLength(1);
    expect(rows.find((row) => row.billsHere)?.routeId).toBe(TEST_ROUTE_2_ID);
  });

  test("generates ONE bill covering both routes, issued on the billing route", async ({ page }) => {
    const prisma = testPrisma();

    await ensureTestSequence(TEST_ROUTE_ID, [TEST_CUSTOMER_1_ID]);
    await ensureTestSequence(TEST_ROUTE_2_ID, [TEST_CUSTOMER_1_ID]);
    // Morning carries the bill.
    await prisma.monthlyRouteCustomerSequence.updateMany({
      where: { customerId: TEST_CUSTOMER_1_ID, sequenceMonth: TEST_MONTH_DATE },
      data: { billsHere: false },
    });
    await prisma.monthlyRouteCustomerSequence.updateMany({
      where: { customerId: TEST_CUSTOMER_1_ID, sequenceMonth: TEST_MONTH_DATE, routeId: TEST_ROUTE_ID },
      data: { billsHere: true },
    });

    // Deliveries on BOTH routes, same day.
    for (const [routeId, qty] of [
      [TEST_ROUTE_ID, 2],
      [TEST_ROUTE_2_ID, 3],
    ] as const) {
      const entry = await prisma.dailyRouteEntry.create({
        data: { routeId, entryDate: new Date(`${testDate("05")}T00:00:00.000Z`), syncStatus: "SYNCED" },
        select: { id: true },
      });
      const line = await prisma.dailyRouteEntryLine.create({
        data: { entryId: entry.id, customerId: TEST_CUSTOMER_1_ID, sequenceNo: 1, skipped: false },
        select: { id: true },
      });
      await prisma.dailyRouteEntryLineProduct.create({
        data: { lineId: line.id, productId: TEST_PRODUCT_ID, quantity: qty, rateSnapshot: 60 },
      });
    }

    await page.goto("/monthly-bills");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Generate bills" }).click();

    const dialog = page.getByRole("dialog");
    await dialog.locator('input[name="billingMonth"]').fill(TEST_MONTH);
    await dialog.getByRole("button", { name: "Generate bills" }).click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });

    const bills = await prisma.monthlyBill.findMany({
      where: { customerId: TEST_CUSTOMER_1_ID, billingMonth: TEST_MONTH_DATE },
      select: { routeId: true, deliveryAmount: true },
    });

    // ONE bill, not one per route — this is the whole change.
    expect(bills).toHaveLength(1);
    expect(bills[0].routeId).toBe(TEST_ROUTE_ID);
    // (2 + 3) x 60 — both routes folded into it.
    expect(Number(bills[0].deliveryAmount)).toBe(300);
  });

  test("warns before removing a customer who already has deliveries this month", async ({ page }) => {
    const prisma = testPrisma();
    await ensureTestSequence(TEST_ROUTE_ID, [TEST_CUSTOMER_2_ID]);

    const entry = await prisma.dailyRouteEntry.create({
      data: { routeId: TEST_ROUTE_ID, entryDate: new Date(`${testDate("06")}T00:00:00.000Z`), syncStatus: "SYNCED" },
      select: { id: true },
    });
    const line = await prisma.dailyRouteEntryLine.create({
      data: { entryId: entry.id, customerId: TEST_CUSTOMER_2_ID, sequenceNo: 1, skipped: false },
      select: { id: true },
    });
    await prisma.dailyRouteEntryLineProduct.create({
      data: { lineId: line.id, productId: TEST_PRODUCT_ID, quantity: 4, rateSnapshot: 60 },
    });

    await page.goto(`/monthly-route-sequence?routeId=${TEST_ROUTE_ID}&month=${TEST_MONTH}`);
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: /remove/i }).first().click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    // The point of the warning: removal does NOT undo deliveries already made.
    await expect(dialog).toContainText(/still be billed/i);
    await expect(dialog).toContainText(/1 day/i);
  });

  test("Settings lists a multi-route customer and moves their bill to the other route", async ({ page }) => {
    const prisma = testPrisma();
    await ensureTestSequence(TEST_ROUTE_ID, [TEST_CUSTOMER_1_ID]);
    await ensureTestSequence(TEST_ROUTE_2_ID, [TEST_CUSTOMER_1_ID]);
    await prisma.monthlyRouteCustomerSequence.updateMany({
      where: { customerId: TEST_CUSTOMER_1_ID, sequenceMonth: TEST_MONTH_DATE },
      data: { billsHere: false },
    });
    await prisma.monthlyRouteCustomerSequence.updateMany({
      where: { customerId: TEST_CUSTOMER_1_ID, sequenceMonth: TEST_MONTH_DATE, routeId: TEST_ROUTE_ID },
      data: { billsHere: true },
    });

    await page.goto("/settings");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: /^Billing routes/ }).click();

    // The fixture month is in the future, so it's within the reviewable window.
    await expect(page.getByText("E2E Customer One").first()).toBeVisible({ timeout: 10_000 });

    // Only this customer is listed here, so the route button is unambiguous —
    // scoping to a "card" div matched inner elements without the buttons.
    await page.getByRole("button", { name: /ROUTE-01-E/ }).first().click();
    await expect(page.getByText(/Now billed on ROUTE-01-E/i)).toBeVisible({ timeout: 10_000 });

    const flagged = await prisma.monthlyRouteCustomerSequence.findFirst({
      where: { customerId: TEST_CUSTOMER_1_ID, sequenceMonth: TEST_MONTH_DATE, billsHere: true },
      select: { routeId: true },
    });
    expect(flagged?.routeId).toBe(TEST_ROUTE_2_ID);
  });
});

// Covers the two screens that had no browser test: the Outstanding section and
// Daily Entry's usual-order helpers. Both are display/interaction behaviour
// that typecheck can't verify.
test.describe("Outstanding customers", () => {
  test.afterAll(async () => {
    await clearTestMonthData(TEST_ROUTE_ID);
    await testPrisma().monthlyBillItem.deleteMany({
      where: { monthlyBill: { customerId: TEST_CUSTOMER_3_ID } },
    });
    await testPrisma().monthlyBill.deleteMany({ where: { customerId: TEST_CUSTOMER_3_ID } });
  });

  test("lists a customer who owes money but is on no route this month", async ({ page }) => {
    const prisma = testPrisma();
    await clearTestMonthData(TEST_ROUTE_ID);
    await prisma.monthlyBill.deleteMany({ where: { customerId: TEST_CUSTOMER_3_ID } });

    // Billed and unpaid in an EARLIER month, then never served again — no
    // sequence row and no deliveries for the month being viewed.
    await prisma.monthlyBill.create({
      data: {
        customerId: TEST_CUSTOMER_3_ID,
        routeId: TEST_ROUTE_ID,
        billingMonth: new Date("2026-12-01T00:00:00.000Z"),
        openingBalance: 0,
        deliveryAmount: 500,
        paymentAmount: 0,
        closingBalance: 500,
        status: "GENERATED",
        generatedAt: new Date(),
      },
    });

    // Viewed across ALL routes — "on no route" isn't answerable filtered to one.
    await page.goto(`/monthly-bills?month=${TEST_MONTH}`);
    await page.waitForLoadState("networkidle");

    await expect(page.getByText(/not on any route this month/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("E2E Customer Three").first()).toBeVisible();
    await expect(page.getByText("₹500.00").first()).toBeVisible();
  });
});

test.describe("Daily Entry usual-order helper", () => {
  test.afterAll(async () => {
    await clearTestMonthData(TEST_ROUTE_ID);
  });

  test("highlights products the customer usually takes and fills only empty cells", async ({ page }) => {
    const prisma = testPrisma();
    await clearTestMonthData(TEST_ROUTE_ID);
    await ensureTestSequence(TEST_ROUTE_ID, [TEST_CUSTOMER_1_ID]);

    // An earlier day on this route establishes their usual order.
    const past = await prisma.dailyRouteEntry.create({
      data: { routeId: TEST_ROUTE_ID, entryDate: new Date(`${testDate("08")}T00:00:00.000Z`), syncStatus: "SYNCED" },
      select: { id: true },
    });
    const pastLine = await prisma.dailyRouteEntryLine.create({
      data: { entryId: past.id, customerId: TEST_CUSTOMER_1_ID, sequenceNo: 1, skipped: false },
      select: { id: true },
    });
    await prisma.dailyRouteEntryLineProduct.create({
      data: { lineId: pastLine.id, productId: TEST_PRODUCT_ID, quantity: 7, rateSnapshot: 60 },
    });

    await page.goto(`/daily-entry?routeId=${TEST_ROUTE_ID}&entryDate=${testDate("09")}`);
    await page.waitForLoadState("networkidle");

    const quantity = page.locator('input[data-daily-entry-quantity="true"]').first();

    // The usual order is exposed for the highlight, but NOT prefilled — the
    // cell still starts at 0 so nobody saves last week's numbers by accident.
    await expect(quantity).toHaveAttribute("data-last-quantity", "7");
    await expect(quantity).toHaveValue("0");

    // Fill usual applies it deliberately.
    await page.getByRole("button", { name: "Fill usual" }).click();
    await expect(quantity).toHaveValue("7");

    // And never overwrites something already typed.
    await quantity.fill("3");
    await page.getByRole("button", { name: "Fill usual" }).click();
    await expect(quantity).toHaveValue("3");
  });
});

// A generated bill freezes its amounts, so the summary can show figures that
// no longer match daily entry. The banner is the only thing distinguishing a
// snapshot from live data on that screen.
test.describe("Summary snapshot notice", () => {
  test.afterAll(async () => {
    await clearTestMonthData(TEST_ROUTE_ID);
  });

  test("warns when figures come from an already-generated bill, and not when they're live", async ({ page }) => {
    const prisma = testPrisma();
    await clearTestMonthData(TEST_ROUTE_ID);
    await ensureTestSequence(TEST_ROUTE_ID, [TEST_CUSTOMER_1_ID]);

    // Live preview only — no bill exists yet, so nothing is stale.
    await page.goto(`/monthly-bills?month=${TEST_MONTH}`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(/Figures as of/i)).toBeHidden();

    // A generated bill freezes its numbers as of generatedAt.
    await prisma.monthlyBill.create({
      data: {
        customerId: TEST_CUSTOMER_1_ID,
        routeId: TEST_ROUTE_ID,
        billingMonth: TEST_MONTH_DATE,
        openingBalance: 0,
        deliveryAmount: 250,
        paymentAmount: 0,
        closingBalance: 250,
        status: "GENERATED",
        generatedAt: new Date("2027-01-04T11:11:00.000Z"),
      },
    });

    await page.goto(`/monthly-bills?month=${TEST_MONTH}`);
    await page.waitForLoadState("networkidle");

    await expect(page.getByText(/Figures as of/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/Regenerate the month/i)).toBeVisible();
  });
});
