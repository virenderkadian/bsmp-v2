import { test, expect } from "@playwright/test";
import {
  TEST_CITY_ID,
  TEST_CUSTOMER_1_ID,
  TEST_CUSTOMER_2_ID,
  TEST_MONTH,
  TEST_MONTH_DATE,
  TEST_ROUTE_ID,
  TEST_ROUTE_2_ID,
  TEST_VEHICLE_ID,
  testPrisma,
} from "./fixtures";

// Bulk-reopening Generated bills for a fresh Generate, scoped to a route, a
// vehicle (every route it runs), or the whole city — and never a Locked bill,
// which is a deliberate freeze undone one bill at a time, not by a sweep.
test.describe("Revert Generated bills to Draft", () => {
  test.afterEach(async () => {
    await testPrisma().monthlyBill.deleteMany({
      where: { routeId: { in: [TEST_ROUTE_ID, TEST_ROUTE_2_ID] }, billingMonth: TEST_MONTH_DATE },
    });
  });

  async function openDialog(page: import("@playwright/test").Page) {
    await page.goto(`/monthly-bills?month=${TEST_MONTH}`);
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Revert to Draft" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.locator('input[name="billingMonth"]').fill(TEST_MONTH);
    return dialog;
  }

  test("reverts one route's Generated bill, leaves the other route's alone", async ({ page }) => {
    await testPrisma().monthlyBill.createMany({
      data: [
        {
          customerId: TEST_CUSTOMER_1_ID, routeId: TEST_ROUTE_ID, billingMonth: TEST_MONTH_DATE,
          openingBalance: 0, deliveryAmount: 500, paymentAmount: 0, closingBalance: 500, status: "GENERATED",
        },
        {
          customerId: TEST_CUSTOMER_2_ID, routeId: TEST_ROUTE_2_ID, billingMonth: TEST_MONTH_DATE,
          openingBalance: 0, deliveryAmount: 700, paymentAmount: 0, closingBalance: 700, status: "GENERATED",
        },
      ],
    });

    const dialog = await openDialog(page);
    await dialog.getByRole("radio", { name: "One route" }).check();
    await dialog.locator('select[name="routeId"]').selectOption(TEST_ROUTE_ID);
    await dialog.getByRole("button", { name: "Revert to Draft" }).click();
    await expect(dialog.getByText(/Reverted 1 bill/)).toBeVisible({ timeout: 15_000 });

    const prisma = testPrisma();
    await expect
      .poll(
        async () =>
          (await prisma.monthlyBill.findFirst({
            where: { customerId: TEST_CUSTOMER_1_ID, routeId: TEST_ROUTE_ID, billingMonth: TEST_MONTH_DATE },
            select: { status: true },
          }))?.status,
        { timeout: 15_000 },
      )
      .toBe("DRAFT");

    // The other route's bill is untouched.
    const other = await prisma.monthlyBill.findFirst({
      where: { customerId: TEST_CUSTOMER_2_ID, routeId: TEST_ROUTE_2_ID, billingMonth: TEST_MONTH_DATE },
      select: { status: true },
    });
    expect(other?.status).toBe("GENERATED");
  });

  test("reverts every route a vehicle runs, in one go", async ({ page }) => {
    // TEST_VEHICLE_ID runs both TEST_ROUTE_ID (morning) and TEST_ROUTE_2_ID
    // (evening) — a single vehicle spanning two bills is the whole point of a
    // vehicle-scoped revert rather than a route-scoped one.
    await testPrisma().monthlyBill.createMany({
      data: [
        {
          customerId: TEST_CUSTOMER_1_ID, routeId: TEST_ROUTE_ID, billingMonth: TEST_MONTH_DATE,
          openingBalance: 0, deliveryAmount: 500, paymentAmount: 0, closingBalance: 500, status: "GENERATED",
        },
        {
          customerId: TEST_CUSTOMER_2_ID, routeId: TEST_ROUTE_2_ID, billingMonth: TEST_MONTH_DATE,
          openingBalance: 0, deliveryAmount: 700, paymentAmount: 0, closingBalance: 700, status: "GENERATED",
        },
      ],
    });

    const dialog = await openDialog(page);
    await dialog.getByRole("radio", { name: /One vehicle/ }).check();
    await dialog.locator('select[name="vehicleId"]').selectOption(TEST_VEHICLE_ID);
    await dialog.getByRole("button", { name: "Revert to Draft" }).click();
    await expect(dialog.getByText(/Reverted 2 bills/)).toBeVisible({ timeout: 15_000 });

    const prisma = testPrisma();
    await expect
      .poll(
        async () =>
          (await prisma.monthlyBill.count({
            where: {
              routeId: { in: [TEST_ROUTE_ID, TEST_ROUTE_2_ID] },
              billingMonth: TEST_MONTH_DATE,
              status: "DRAFT",
            },
          })),
        { timeout: 15_000 },
      )
      .toBe(2);
  });

  test("never touches a Locked bill, even inside the scope it reverts", async ({ page }) => {
    await testPrisma().monthlyBill.createMany({
      data: [
        {
          customerId: TEST_CUSTOMER_1_ID, routeId: TEST_ROUTE_ID, billingMonth: TEST_MONTH_DATE,
          openingBalance: 0, deliveryAmount: 500, paymentAmount: 0, closingBalance: 500, status: "GENERATED",
        },
        {
          customerId: TEST_CUSTOMER_2_ID, routeId: TEST_ROUTE_ID, billingMonth: TEST_MONTH_DATE,
          openingBalance: 0, deliveryAmount: 900, paymentAmount: 900, closingBalance: 0, status: "LOCKED",
        },
      ],
    });

    const dialog = await openDialog(page);
    // Whole-city scope, the default — the widest possible sweep, and the
    // Locked row still has to survive it.
    await dialog.getByRole("button", { name: "Revert to Draft" }).click();
    await expect(dialog.getByText(/Reverted 1 bill/)).toBeVisible({ timeout: 15_000 });

    const prisma = testPrisma();
    const locked = await prisma.monthlyBill.findFirst({
      where: { customerId: TEST_CUSTOMER_2_ID, routeId: TEST_ROUTE_ID, billingMonth: TEST_MONTH_DATE },
      select: { status: true, paymentAmount: true, closingBalance: true },
    });
    expect(locked?.status).toBe("LOCKED");
    // Not just the status — the frozen money too. A sweep must not so much as
    // touch the row.
    expect(Number(locked?.paymentAmount)).toBe(900);
    expect(Number(locked?.closingBalance)).toBe(0);
  });

  test("records who was reverted, and that Locked bills were left alone, in the audit trail", async ({ page }) => {
    await testPrisma().monthlyBill.create({
      data: {
        customerId: TEST_CUSTOMER_1_ID, routeId: TEST_ROUTE_ID, billingMonth: TEST_MONTH_DATE,
        openingBalance: 0, deliveryAmount: 500, paymentAmount: 0, closingBalance: 500, status: "GENERATED",
      },
    });

    const dialog = await openDialog(page);
    await dialog.getByRole("radio", { name: "One route" }).check();
    await dialog.locator('select[name="routeId"]').selectOption(TEST_ROUTE_ID);
    await dialog.getByRole("button", { name: "Revert to Draft" }).click();
    await expect(dialog.getByText(/Reverted 1 bill/)).toBeVisible({ timeout: 15_000 });

    await expect
      .poll(
        async () => {
          const log = await testPrisma().auditLog.findFirst({
            where: { cityId: TEST_CITY_ID, entityType: "MonthlyBill", action: "STATUS_CHANGE" },
            orderBy: { createdAt: "desc" },
            select: { summary: true },
          });
          return log?.summary ?? "";
        },
        { timeout: 15_000 },
      )
      .toContain("Locked bills were left unchanged");
  });
});
