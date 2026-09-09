import { test, expect } from "@playwright/test";
import { TEST_PRODUCT_ID, TEST_VEHICLE_ID, testPrisma } from "./fixtures";

// The vehicle cash report: what a round sold for cash over a range, and what
// the driver still owes for it.
test.describe("Vehicle cash report", () => {
  const DAY_ONE = new Date("2027-01-05T00:00:00.000Z");
  const DAY_TWO = new Date("2027-01-06T00:00:00.000Z");

  test.beforeAll(async () => {
    const prisma = testPrisma();
    await prisma.vehicleCycleStock.deleteMany({
      where: { vehicleId: TEST_VEHICLE_ID, cycleDate: { in: [DAY_ONE, DAY_TWO] } },
    });
    await prisma.vehicleCashSalePayment.deleteMany({
      where: { vehicleId: TEST_VEHICLE_ID, cycleDate: { in: [DAY_ONE, DAY_TWO] } },
    });

    // Day one has stock; day two deliberately does not, which is the state a
    // half-migrated month is in.
    await prisma.vehicleCycleStock.create({
      data: {
        vehicleId: TEST_VEHICLE_ID,
        productId: TEST_PRODUCT_ID,
        cycleDate: DAY_ONE,
        givenQty: 100,
        returnedQty: 10,
        rateSnapshot: 60,
      },
    });
    await prisma.vehicleCashSalePayment.create({
      data: {
        vehicleId: TEST_VEHICLE_ID,
        cycleDate: DAY_ONE,
        amount: 500,
        paymentDate: DAY_ONE,
        mode: "CASH",
        status: "VERIFIED",
      },
    });
  });

  test.afterAll(async () => {
    const prisma = testPrisma();
    await prisma.vehicleCycleStock.deleteMany({
      where: { vehicleId: TEST_VEHICLE_ID, cycleDate: { in: [DAY_ONE, DAY_TWO] } },
    });
    await prisma.vehicleCashSalePayment.deleteMany({
      where: { vehicleId: TEST_VEHICLE_ID, cycleDate: { in: [DAY_ONE, DAY_TWO] } },
    });
  });

  async function openReport(page: import("@playwright/test").Page) {
    await page.goto(
      `/reconciliation/cash-report?vehicleId=${TEST_VEHICLE_ID}&from=2027-01-05&to=2027-01-06`,
    );
    await page.waitForLoadState("networkidle");
  }

  test("prices the cash sale and nets the deposit off what is owed", async ({ page }) => {
    await openReport(page);

    // 100 given, 10 returned, nothing delivered on the test route that day, so
    // 90 sold for cash at 60 = 5,400, less the 500 deposited.
    await expect(page.getByText("₹5,400.00").first()).toBeVisible();
    await expect(page.getByText("₹500.00").first()).toBeVisible();
    await expect(page.getByText("₹4,900.00").first()).toBeVisible();
  });

  test("shows a day with no stock rather than hiding it, and says why", async ({ page }) => {
    await openReport(page);

    // Half-migrated months must read as incomplete, not as wrong.
    await expect(page.getByText("Stock not recorded")).toBeVisible();
    await expect(page.getByText(/1 of 2 days have stock recorded/)).toBeVisible();
  });

  test("keeps an unrecorded day out of the totals", async ({ page }) => {
    await openReport(page);

    // If day two counted, its leftover would be 0 minus deliveries — dragging
    // the amount owed below the truth.
    await expect(page.getByText("₹5,400.00").first()).toBeVisible();
  });

  test("records a deposit and reduces what the driver owes", async ({ page }) => {
    await openReport(page);
    await page.getByRole("button", { name: "Record a deposit" }).click();

    const dialog = page.getByRole("dialog");
    await dialog.locator('input[name="amount"]').fill("400");
    await dialog.getByRole("button", { name: "Record deposit" }).click();

    await expect
      .poll(
        async () => {
          const rows = await testPrisma().vehicleCashSalePayment.findMany({
            where: { vehicleId: TEST_VEHICLE_ID, cycleDate: DAY_TWO },
            select: { amount: true },
          });
          return rows.reduce((sum, row) => sum + Number(row.amount), 0);
        },
        { timeout: 15_000 },
      )
      .toBe(400);
  });
});
