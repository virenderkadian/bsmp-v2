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

// The filter panel, and the bug behind it: the print views are separate server
// routes, so any filter that stayed in the browser never reached the paper.
test.describe("Filter panel and printing", () => {
  test.beforeAll(async () => {
    const prisma = testPrisma();
    await ensureTestSequence(TEST_ROUTE_ID, [TEST_CUSTOMER_1_ID, TEST_CUSTOMER_2_ID]);
    await prisma.monthlyBill.deleteMany({
      where: { routeId: TEST_ROUTE_ID, billingMonth: TEST_MONTH_DATE },
    });
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
      ],
    });
  });

  test.afterAll(async () => {
    await testPrisma().monthlyBill.deleteMany({
      where: { routeId: TEST_ROUTE_ID, billingMonth: TEST_MONTH_DATE },
    });
  });

  test("collapses the filters behind one button", async ({ page }) => {
    await page.goto(`/monthly-bills?month=${TEST_MONTH}`);
    await page.waitForLoadState("networkidle");

    // The controls are not on the toolbar until the panel is opened.
    await expect(page.getByLabel("Minimum amount")).toHaveCount(0);

    await page.getByRole("button", { name: "Filters" }).click();
    await expect(page.getByRole("dialog", { name: "Filters" })).toBeVisible();
    await expect(page.getByLabel("Bill status")).toBeVisible();
  });

  test("says on screen that a filter is active", async ({ page }) => {
    await page.goto(`/monthly-bills?month=${TEST_MONTH}`);
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: "Filters" }).click();
    await page.getByLabel("Bill status").selectOption("DRAFT");
    await page.getByRole("button", { name: "Done" }).click();

    // A chip, and a count on the button. Hiding the controls is only safe if
    // the screen still shows that it is showing a subset.
    await expect(page.getByRole("button", { name: /Clear filter: Draft/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Filters, 1 active/ })).toBeVisible();
  });

  test("clears one filter from its chip", async ({ page }) => {
    await page.goto(`/monthly-bills?month=${TEST_MONTH}`);
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: "Filters" }).click();
    await page.getByLabel("Bill status").selectOption("DRAFT");
    await page.getByRole("button", { name: "Done" }).click();
    await page.getByRole("button", { name: /Clear filter: Draft/ }).click();

    await expect(page.getByRole("button", { name: /Filters, 1 active/ })).toHaveCount(0);
  });

  test("the printed summary honours the status filter", async ({ page }) => {
    // The reported bug: this page took only month and routeId, so a filtered
    // screen printed the whole month.
    await page.goto(
      `/monthly-bills/summary?month=${TEST_MONTH}&routeId=${TEST_ROUTE_ID}&status=DRAFT`,
    );
    await page.waitForLoadState("networkidle");

    await expect(page.getByText("E2E Customer One")).toBeVisible();
    await expect(page.getByText("E2E Customer Two")).toHaveCount(0);
    // And the sheet says it is filtered, so nobody reads it as a full month.
    await expect(page.getByText(/Filtered: Draft bills only/)).toBeVisible();
  });

  test("the printed summary is complete when nothing is filtered", async ({ page }) => {
    await page.goto(`/monthly-bills/summary?month=${TEST_MONTH}&routeId=${TEST_ROUTE_ID}`);
    await page.waitForLoadState("networkidle");

    await expect(page.getByText("E2E Customer One")).toBeVisible();
    await expect(page.getByText("E2E Customer Two")).toBeVisible();
    await expect(page.getByText(/Filtered:/)).toHaveCount(0);
  });

  // Status was the only filter that ever reached the paper. Search and the
  // amount bounds stayed in the browser, so a screen narrowed to a handful of
  // customers still printed the whole month.
  test("the printed summary honours the amount filter", async ({ page }) => {
    await page.goto(
      `/monthly-bills/summary?month=${TEST_MONTH}&routeId=${TEST_ROUTE_ID}&amountField=closingBalance&minAmount=1000`,
    );
    await page.waitForLoadState("networkidle");

    // One is 9,000 pending, Two is 120.
    await expect(page.getByText("E2E Customer One")).toBeVisible();
    await expect(page.getByText("E2E Customer Two")).toHaveCount(0);
    await expect(page.getByText(/Filtered: pending of ₹1000 or more/)).toBeVisible();
  });

  test("the printed summary honours the search filter", async ({ page }) => {
    await page.goto(
      `/monthly-bills/summary?month=${TEST_MONTH}&routeId=${TEST_ROUTE_ID}&search=Customer%20Two`,
    );
    await page.waitForLoadState("networkidle");

    await expect(page.getByText("E2E Customer Two")).toBeVisible();
    await expect(page.getByText("E2E Customer One")).toHaveCount(0);
    await expect(page.getByText(/matching "Customer Two"/)).toBeVisible();
  });

  // A Route Total that still counts the rows a filter removed reads as an
  // arithmetic bug to whoever is handed the sheet.
  test("a filtered sheet totals only the rows it prints", async ({ page }) => {
    await page.goto(
      `/monthly-bills/summary?month=${TEST_MONTH}&routeId=${TEST_ROUTE_ID}&amountField=closingBalance&minAmount=1000`,
    );
    await page.waitForLoadState("networkidle");

    const totalsRow = page.getByRole("row", { name: /Route Total/ });
    await expect(totalsRow).toContainText("9,000.00");
    // 9,120 would mean Customer Two's 120 was still counted.
    await expect(totalsRow).not.toContainText("9,120.00");
  });

  test("printing every bill on a route honours the amount filter too", async ({ page }) => {
    await page.goto(
      `/monthly-bills/print-all?month=${TEST_MONTH}&routeId=${TEST_ROUTE_ID}&amountField=closingBalance&minAmount=1000`,
    );
    await page.waitForLoadState("networkidle");

    await expect(page.getByText("E2E Customer Two")).toHaveCount(0);
    await expect(page.getByText(/Filtered: pending of ₹1000 or more/)).toBeVisible();
  });
});
