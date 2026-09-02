import { test, expect } from "@playwright/test";
import {
  TEST_CUSTOMER_1_ID,
  TEST_CUSTOMER_2_ID,
  TEST_MONTH,
  TEST_MONTH_DATE,
  TEST_ROUTE_ID,
  ensureTestSequence,
  testPrisma,
} from "./fixtures";

// Filters on the Bills tab, plus the month bound. Bills are fetched one month
// at a time now — the page used to load every bill the city had ever produced
// and filter them in the browser, which grows without limit.
test.describe("Monthly bill filters", () => {
  const PREVIOUS_MONTH = new Date("2026-12-01T00:00:00.000Z");

  test.beforeAll(async () => {
    const prisma = testPrisma();
    await ensureTestSequence(TEST_ROUTE_ID, [TEST_CUSTOMER_1_ID, TEST_CUSTOMER_2_ID]);

    await prisma.monthlyBill.deleteMany({
      where: { routeId: TEST_ROUTE_ID, billingMonth: { in: [TEST_MONTH_DATE, PREVIOUS_MONTH] } },
    });

    // A big DRAFT and a small GENERATED in the test month, plus one bill in the
    // month before so the month bound has something to exclude.
    await prisma.monthlyBill.createMany({
      data: [
        {
          customerId: TEST_CUSTOMER_1_ID,
          routeId: TEST_ROUTE_ID,
          billingMonth: TEST_MONTH_DATE,
          openingBalance: 0,
          deliveryAmount: 9000,
          paymentAmount: 0,
          closingBalance: 9000,
          status: "DRAFT",
        },
        {
          customerId: TEST_CUSTOMER_2_ID,
          routeId: TEST_ROUTE_ID,
          billingMonth: TEST_MONTH_DATE,
          openingBalance: 0,
          deliveryAmount: 120,
          paymentAmount: 0,
          closingBalance: 120,
          status: "GENERATED",
        },
        {
          customerId: TEST_CUSTOMER_1_ID,
          routeId: TEST_ROUTE_ID,
          billingMonth: PREVIOUS_MONTH,
          openingBalance: 0,
          deliveryAmount: 4321,
          paymentAmount: 0,
          closingBalance: 4321,
          status: "LOCKED",
        },
      ],
    });
  });

  test.afterAll(async () => {
    await testPrisma().monthlyBill.deleteMany({
      where: { routeId: TEST_ROUTE_ID, billingMonth: { in: [TEST_MONTH_DATE, PREVIOUS_MONTH] } },
    });
  });

  async function openBillsTab(page: import("@playwright/test").Page) {
    await page.goto(`/monthly-bills?month=${TEST_MONTH}`);
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Bills", exact: true }).click();
  }

  test("loads only the selected month", async ({ page }) => {
    await openBillsTab(page);

    // 9,000 and 120 are this month; 4,321 belongs to the month before and must
    // not be shipped to the browser at all.
    await expect(page.getByText("9,000.00").first()).toBeVisible();
    await expect(page.getByText("4,321.00")).toHaveCount(0);
  });

  test("filters by bill status", async ({ page }) => {
    await openBillsTab(page);

    await page.getByRole("combobox").filter({ hasText: /All statuses|Draft/ }).first().selectOption("DRAFT");

    await expect(page.getByText("9,000.00").first()).toBeVisible();
    await expect(page.getByText("120.00")).toHaveCount(0);
  });

  test("filters by a minimum amount", async ({ page }) => {
    await openBillsTab(page);

    await page.getByLabel("Minimum amount").fill("1000");

    // The small bill drops out; the large one stays.
    await expect(page.getByText("9,000.00").first()).toBeVisible();
    await expect(page.getByText("120.00")).toHaveCount(0);
  });

  test("filters by a maximum amount", async ({ page }) => {
    await openBillsTab(page);

    await page.getByLabel("Maximum amount").fill("1000");

    await expect(page.getByText("120.00").first()).toBeVisible();
    await expect(page.getByText("9,000.00")).toHaveCount(0);
  });

  test("clears every filter at once", async ({ page }) => {
    await openBillsTab(page);

    await page.getByLabel("Minimum amount").fill("1000");
    await expect(page.getByText("120.00")).toHaveCount(0);

    await page.getByRole("button", { name: "Clear" }).click();

    await expect(page.getByText("120.00").first()).toBeVisible();
    await expect(page.getByText("9,000.00").first()).toBeVisible();
  });
});
