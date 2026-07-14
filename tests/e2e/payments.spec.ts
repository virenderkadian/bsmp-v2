import { test, expect } from "@playwright/test";
import { TEST_ROUTE_ID, TEST_CUSTOMER_1_ID, testPrisma, testDate } from "./fixtures";

test.describe("Payments", () => {
  test.afterAll(async () => {
    await testPrisma().payment.deleteMany({
      where: { routeId: TEST_ROUTE_ID, paymentDate: { gte: new Date("2027-01-01"), lt: new Date("2027-02-01") } },
    });
  });

  test("records a payment via the Add payment dialog", async ({ page }) => {
    const date = testDate("13");
    await page.goto("/payments");
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: "Add payment" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.locator('select[name="customerId"]').selectOption(TEST_CUSTOMER_1_ID);
    // paymentDate's own onChange resets routeId back to "" (see
    // payment-screen.tsx), so it must be filled before routeId is selected.
    await dialog.locator('input[name="paymentDate"]').fill(date);
    await dialog.locator('select[name="routeId"]').selectOption(TEST_ROUTE_ID);
    await dialog.locator('input[name="amount"]').fill("999");
    await dialog.locator('select[name="mode"]').selectOption("CASH");
    await dialog.locator('select[name="status"]').selectOption("VERIFIED");
    await dialog.getByRole("button", { name: "Save payment" }).click();

    // The dialog auto-closes on success (see payment-screen.tsx) — its own
    // inline success text unmounts with it, so closing is the real signal.
    await expect(dialog).toBeHidden({ timeout: 10_000 });

    const payment = await testPrisma().payment.findFirst({
      where: { customerId: TEST_CUSTOMER_1_ID, routeId: TEST_ROUTE_ID, paymentDate: new Date(`${date}T00:00:00.000Z`) },
    });

    expect(payment).not.toBeNull();
    expect(Number(payment?.amount)).toBe(999);
    expect(payment?.status).toBe("VERIFIED");
  });
});
