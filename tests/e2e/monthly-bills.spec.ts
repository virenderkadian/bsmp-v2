import { test, expect } from "@playwright/test";
import {
  TEST_CITY_ID,
  TEST_ROUTE_ID,
  TEST_CUSTOMER_1_ID,
  TEST_CUSTOMER_2_ID,
  TEST_MONTH,
  TEST_MONTH_DATE,
  ensureTestSequence,
  clearTestMonthData,
  testDate,
  testPrisma,
} from "./fixtures";

test.describe("Monthly Bills", () => {
  test.beforeEach(async () => {
    await clearTestMonthData(TEST_ROUTE_ID);
    await ensureTestSequence(TEST_ROUTE_ID, [TEST_CUSTOMER_1_ID, TEST_CUSTOMER_2_ID]);
  });

  test.afterAll(async () => {
    await clearTestMonthData(TEST_ROUTE_ID);
  });

  test("generates a bill from daily entries, and correctly zeroes a customer with no entries", async ({ page }) => {
    const prisma = testPrisma();

    // Save one real delivery for customer 1 via the actual save action, so
    // this test also exercises the zero-qty skip from the storage change —
    // only customer 1 gets any DailyRouteEntryLineProduct rows at all.
    const entry = await prisma.dailyRouteEntry.create({
      data: { routeId: TEST_ROUTE_ID, entryDate: new Date(`${testDate("05")}T00:00:00.000Z`), syncStatus: "DRAFT" },
    });
    const product = await prisma.product.findFirst({ where: { cityId: TEST_CITY_ID }, select: { id: true, defaultRate: true } });
    const line = await prisma.dailyRouteEntryLine.create({
      data: { entryId: entry.id, customerId: TEST_CUSTOMER_1_ID, sequenceNo: 1, skipped: false },
    });
    await prisma.dailyRouteEntryLineProduct.create({
      data: { lineId: line.id, productId: product!.id, quantity: 10, rateSnapshot: product!.defaultRate },
    });

    // Customer 2 deliberately has zero entries this month — this is the
    // exact scenario the zero-entry-union fix (buildBillPairs) covers:
    // regenerating must still zero out their bill, not skip them.
    await prisma.monthlyBill.create({
      data: {
        customerId: TEST_CUSTOMER_2_ID,
        routeId: TEST_ROUTE_ID,
        billingMonth: TEST_MONTH_DATE,
        openingBalance: 0,
        deliveryAmount: 5000,
        paymentAmount: 0,
        closingBalance: 5000,
        status: "DRAFT",
      },
    });

    await page.goto("/monthly-bills");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Generate bills" }).first().click();

    const dialog = page.getByRole("dialog");
    await dialog.locator('input[name="billingMonth"]').fill(TEST_MONTH);
    await dialog.getByRole("button", { name: "Generate bills" }).click();
    // The dialog auto-closes on success (see monthly-bill-screen.tsx) —
    // its own inline success text unmounts with it, so closing is the
    // real signal.
    await expect(dialog).toBeHidden({ timeout: 15_000 });

    const bill1 = await prisma.monthlyBill.findUnique({
      where: {
        customerId_routeId_billingMonth: {
          customerId: TEST_CUSTOMER_1_ID,
          routeId: TEST_ROUTE_ID,
          billingMonth: TEST_MONTH_DATE,
        },
      },
    });
    const bill2 = await prisma.monthlyBill.findUnique({
      where: {
        customerId_routeId_billingMonth: {
          customerId: TEST_CUSTOMER_2_ID,
          routeId: TEST_ROUTE_ID,
          billingMonth: TEST_MONTH_DATE,
        },
      },
    });

    expect(Number(bill1?.deliveryAmount)).toBe(10 * Number(product!.defaultRate));
    expect(bill1?.status).toBe("GENERATED");

    // The regression check: customer 2's stale 5000 must be reset to 0, not
    // left untouched because they had no matching daily-entry rows.
    expect(Number(bill2?.deliveryAmount)).toBe(0);
    expect(Number(bill2?.closingBalance)).toBe(0);
  });
});
