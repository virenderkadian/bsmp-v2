import { test, expect } from "@playwright/test";
import {
  TEST_ROUTE_ID,
  TEST_CUSTOMER_1_ID,
  TEST_CUSTOMER_2_ID,
  ensureTestSequence,
  clearTestMonthData,
  testDate,
  testPrisma,
} from "./fixtures";

test.describe("Daily Entry", () => {
  test.beforeEach(async () => {
    await clearTestMonthData(TEST_ROUTE_ID);
    await ensureTestSequence(TEST_ROUTE_ID, [TEST_CUSTOMER_1_ID, TEST_CUSTOMER_2_ID]);
  });

  test.afterAll(async () => {
    await clearTestMonthData(TEST_ROUTE_ID);
  });

  test("saves a nonzero quantity and skips zero-quantity rows entirely", async ({ page }) => {
    const date = testDate("10");
    await page.goto(`/daily-entry?routeId=${TEST_ROUTE_ID}&entryDate=${date}`);
    await page.waitForLoadState("networkidle");

    const quantityInputs = page.locator('input[data-daily-entry-quantity="true"]');
    await expect(quantityInputs.first()).toBeVisible();
    await quantityInputs.nth(0).fill("5");
    await page.getByRole("button", { name: "Save All" }).click();
    await expect(page.getByText("Daily entry saved.")).toBeVisible({ timeout: 10_000 });

    const entry = await testPrisma().dailyRouteEntry.findFirst({
      where: { routeId: TEST_ROUTE_ID, entryDate: new Date(`${date}T00:00:00.000Z`) },
      select: { lines: { select: { customerId: true, productEntries: true } } },
    });

    const customer1Line = entry?.lines.find((line) => line.customerId === TEST_CUSTOMER_1_ID);
    const customer2Line = entry?.lines.find((line) => line.customerId === TEST_CUSTOMER_2_ID);

    expect(customer1Line?.productEntries.length).toBe(1);
    expect(customer2Line?.productEntries.length).toBe(0);
  });

  test("preserves an explicit correction from nonzero down to zero as a real row", async ({ page }) => {
    const date = testDate("11");
    await page.goto(`/daily-entry?routeId=${TEST_ROUTE_ID}&entryDate=${date}`);
    await page.waitForLoadState("networkidle");

    await page.locator('input[data-daily-entry-quantity="true"]').first().fill("20");
    await page.getByRole("button", { name: "Save All" }).click();
    await expect(page.getByText("Daily entry saved.")).toBeVisible({ timeout: 10_000 });

    await page.goto(`/daily-entry?routeId=${TEST_ROUTE_ID}&entryDate=${date}`);
    await page.waitForLoadState("networkidle");
    await page.locator('input[data-daily-entry-quantity="true"]').first().fill("0");
    await page.getByRole("button", { name: "Save All" }).click();
    await expect(page.getByText("Daily entry saved.")).toBeVisible({ timeout: 10_000 });

    const entry = await testPrisma().dailyRouteEntry.findFirst({
      where: { routeId: TEST_ROUTE_ID, entryDate: new Date(`${date}T00:00:00.000Z`) },
      select: { lines: { select: { customerId: true, productEntries: true } } },
    });

    const customer1Line = entry?.lines.find((line) => line.customerId === TEST_CUSTOMER_1_ID);
    expect(customer1Line?.productEntries.length).toBe(1);
    expect(Number(customer1Line?.productEntries[0]?.quantity)).toBe(0);
  });

  test("blocks saving once a GENERATED bill exists for the route/month", async ({ page }) => {
    const date = testDate("12");
    const prisma = testPrisma();

    await prisma.monthlyBill.create({
      data: {
        customerId: TEST_CUSTOMER_1_ID,
        routeId: TEST_ROUTE_ID,
        billingMonth: new Date("2027-01-01T00:00:00.000Z"),
        openingBalance: 0,
        deliveryAmount: 0,
        paymentAmount: 0,
        closingBalance: 0,
        status: "GENERATED",
        generatedAt: new Date(),
      },
    });

    await page.goto(`/daily-entry?routeId=${TEST_ROUTE_ID}&entryDate=${date}`);
    await page.waitForLoadState("networkidle");
    await page.locator('input[data-daily-entry-quantity="true"]').first().fill("3");
    await page.getByRole("button", { name: "Save All" }).click();

    await expect(page.getByText(/already Generated/i)).toBeVisible({ timeout: 10_000 });

    const entry = await prisma.dailyRouteEntry.findFirst({
      where: { routeId: TEST_ROUTE_ID, entryDate: new Date(`${date}T00:00:00.000Z`) },
    });
    expect(entry).toBeNull();
  });
});
