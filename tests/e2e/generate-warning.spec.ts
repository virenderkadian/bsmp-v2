import { test, expect } from "@playwright/test";
import {
  TEST_CUSTOMER_1_ID,
  TEST_MONTH,
  TEST_MONTH_DATE,
  TEST_ROUTE_ID,
  testPrisma,
} from "./fixtures";

// Locking is what assigns a payment to a month. Generate a month while the one
// before it is still open and the same money is claimed twice — the closing
// carried forward is short by it, and the new month deducts it again. That is
// how ₹506,836 of drift appeared across 107 Rohtak bills.
test.describe("Generating over an unlocked previous month", () => {
  // TEST_MONTH is January, so the month before it is the previous December.
  const PREVIOUS_MONTH_DATE = new Date(
    Date.UTC(TEST_MONTH_DATE.getUTCFullYear() - 1, 11, 1),
  );

  test.afterEach(async () => {
    await testPrisma().monthlyBill.deleteMany({
      where: { routeId: TEST_ROUTE_ID, billingMonth: PREVIOUS_MONTH_DATE },
    });
  });

  async function openGenerateDialog(page: import("@playwright/test").Page) {
    await page.goto(`/monthly-bills?month=${TEST_MONTH}`);
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Generate bills" }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.locator('input[name="billingMonth"]').fill(TEST_MONTH);
    return dialog;
  }

  test("warns when the previous month still has an open bill", async ({ page }) => {
    await testPrisma().monthlyBill.create({
      data: {
        customerId: TEST_CUSTOMER_1_ID,
        routeId: TEST_ROUTE_ID,
        billingMonth: PREVIOUS_MONTH_DATE,
        openingBalance: 0,
        deliveryAmount: 1000,
        paymentAmount: 0,
        closingBalance: 1000,
        status: "GENERATED",
      },
    });

    const dialog = await openGenerateDialog(page);

    await expect(dialog.getByText(/Lock .* first/)).toBeVisible();
    // The warning has to name the real risk, not just say figures may move.
    await expect(dialog.getByText(/counted against this month as well/)).toBeVisible();
  });

  test("says nothing once the previous month is locked", async ({ page }) => {
    await testPrisma().monthlyBill.create({
      data: {
        customerId: TEST_CUSTOMER_1_ID,
        routeId: TEST_ROUTE_ID,
        billingMonth: PREVIOUS_MONTH_DATE,
        openingBalance: 0,
        deliveryAmount: 1000,
        paymentAmount: 1000,
        closingBalance: 0,
        status: "LOCKED",
      },
    });

    const dialog = await openGenerateDialog(page);

    await expect(dialog.getByText(/Lock .* first/)).toHaveCount(0);
  });
});
