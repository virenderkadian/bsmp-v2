import { test, expect } from "@playwright/test";
import { testPrisma, testDate } from "./fixtures";

const VEHICLE_ID = "5de299ab-7213-4ad4-a460-9bacb7f05874"; // Vehicle01, has both a morning and evening route
const BUFFALO_MILK_ID = "bd5e3067-28d6-4f63-92c2-44f616465dbb";

test.describe("Reconciliation", () => {
  const cycleDate = testDate("20");

  test.afterAll(async () => {
    await testPrisma().vehicleCycleStock.deleteMany({
      where: { vehicleId: VEHICLE_ID, cycleDate: new Date(`${cycleDate}T00:00:00.000Z`) },
    });
    await testPrisma().vehicleCashSalePayment.deleteMany({
      where: { vehicleId: VEHICLE_ID, cycleDate: new Date(`${cycleDate}T00:00:00.000Z`) },
    });
  });

  test("saves vehicle stock given/returned quantities for a cycle", async ({ page }) => {
    await page.goto(`/reconciliation?cycleDate=${cycleDate}`);
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: "Edit stock" }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    const buffaloRow = dialog.locator("tr", { hasText: "Buffalo Milk" });
    const [givenInput, returnedInput] = await buffaloRow.locator('input[type="number"]').all();
    await givenInput.fill("100");
    await returnedInput.fill("2");

    await dialog.getByRole("button", { name: "Save stock" }).click();
    // The dialog auto-closes on success — its own inline success text
    // unmounts with it, so closing is the real signal.
    await expect(dialog).toBeHidden({ timeout: 10_000 });

    const stock = await testPrisma().vehicleCycleStock.findUnique({
      where: {
        vehicleId_productId_cycleDate: {
          vehicleId: VEHICLE_ID,
          productId: BUFFALO_MILK_ID,
          cycleDate: new Date(`${cycleDate}T00:00:00.000Z`),
        },
      },
    });

    expect(Number(stock?.givenQty)).toBe(100);
    expect(Number(stock?.returnedQty)).toBe(2);
  });

  test("records a cash sale payment for a cycle", async ({ page }) => {
    await page.goto(`/reconciliation?cycleDate=${cycleDate}`);
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: "Record payment" }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.locator('input[name="amount"]').fill("450");
    await dialog.locator('input[name="paymentDate"]').fill(cycleDate);
    await dialog.getByRole("button", { name: "Record payment" }).click();

    // The dialog auto-closes on success — its own inline success text
    // unmounts with it, so closing is the real signal.
    await expect(dialog).toBeHidden({ timeout: 10_000 });

    const payment = await testPrisma().vehicleCashSalePayment.findFirst({
      where: { vehicleId: VEHICLE_ID, cycleDate: new Date(`${cycleDate}T00:00:00.000Z`) },
    });

    expect(Number(payment?.amount)).toBe(450);
  });
});
