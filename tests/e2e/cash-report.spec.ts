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
      `/reconciliation?tab=cash-report&vehicleId=${TEST_VEHICLE_ID}&from=2027-01-05&to=2027-01-06`,
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

  test("switches between the cycle and the report on one screen", async ({ page }) => {
    // Two views of the same data, so they belong on one screen: the cycle is
    // where stock is entered, the report is the range read-out over it.
    await page.goto("/reconciliation");
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: "Cash report", exact: true }).click();
    await expect(page.getByRole("button", { name: "Load report" })).toBeVisible();

    await page.getByRole("button", { name: "Cycle", exact: true }).click();
    // The cycle date control belongs to the cycle tab, and comes back with it.
    await expect(page.locator('input[name="cycleDate"]')).toBeVisible();
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

  // A deposit typed wrong is the ordinary case: the figure needs correcting,
  // not the row deleting.
  test("edits a deposit and keeps the old figure in the trail", async ({ page }) => {
    const prisma = testPrisma();
    const deposit = await prisma.vehicleCashSalePayment.create({
      data: {
        vehicleId: TEST_VEHICLE_ID,
        cycleDate: DAY_TWO,
        amount: 111,
        paymentDate: DAY_TWO,
        mode: "CASH",
        status: "VERIFIED",
        referenceNo: "EDIT-ME",
      },
    });

    await openReport(page);
    await page
      .getByRole("row", { name: /EDIT-ME/ })
      .getByRole("button", { name: "Edit" })
      .click();

    const dialog = page.getByRole("dialog");
    await dialog.locator('input[name="amount"]').fill("222");
    await dialog.getByRole("button", { name: "Save changes" }).click();

    await expect
      .poll(
        async () => {
          const row = await prisma.vehicleCashSalePayment.findUnique({
            where: { id: deposit.id },
            select: { amount: true },
          });
          return Number(row?.amount);
        },
        { timeout: 15_000 },
      )
      .toBe(222);

    // Polled, not read once: the audit row is written after the update itself,
    // so the amount can already read 222 while the trail entry is still in
    // flight.
    await expect
      .poll(
        async () => {
          const audit = await prisma.auditLog.findFirst({
            where: { entityType: "VehicleCashSalePayment", entityId: deposit.id, action: "UPDATE" },
            orderBy: { createdAt: "desc" },
          });
          // The point of the trail: what it was, not only what it is now.
          return JSON.stringify(audit?.before ?? null);
        },
        { timeout: 15_000 },
      )
      .toContain('"amount":111');
  });

  // Cancelling rather than deleting: the row survives, and every total already
  // counts VERIFIED only, so no arithmetic changes.
  test("cancels a deposit so it stops counting but stays on record", async ({ page }) => {
    const prisma = testPrisma();
    const deposit = await prisma.vehicleCashSalePayment.create({
      data: {
        vehicleId: TEST_VEHICLE_ID,
        cycleDate: DAY_TWO,
        amount: 333,
        paymentDate: DAY_TWO,
        mode: "CASH",
        status: "VERIFIED",
        referenceNo: "CANCEL-ME",
      },
    });

    await openReport(page);
    const depositedTotal = () =>
      page.locator("section", { hasText: "Total deposited" }).last().locator("p").last().innerText();
    const before = Number((await depositedTotal()).replace(/[^0-9.]/g, ""));

    await page
      .getByRole("row", { name: /CANCEL-ME/ })
      .getByRole("button", { name: "Cancel" })
      .click();
    await page.getByRole("dialog").getByRole("button", { name: "Cancel deposit" }).click();

    await expect
      .poll(
        async () => {
          const row = await prisma.vehicleCashSalePayment.findUnique({
            where: { id: deposit.id },
            select: { status: true },
          });
          return row?.status;
        },
        { timeout: 15_000 },
      )
      .toBe("CANCELLED");

    // Still listed — struck through, not gone.
    await expect(page.getByRole("row", { name: /CANCEL-ME/ })).toBeVisible();
    // And it has stopped counting: the deposited total is 333 lighter.
    await expect
      .poll(async () => Number((await depositedTotal()).replace(/[^0-9.]/g, "")), {
        timeout: 15_000,
      })
      .toBe(before - 333);
  });
});
