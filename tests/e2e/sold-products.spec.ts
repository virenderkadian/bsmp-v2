import { test, expect } from "@playwright/test";
import {
  TEST_CITY_ID,
  TEST_CUSTOMER_1_ID,
  TEST_CUSTOMER_2_ID,
  TEST_MONTH,
  TEST_ROUTE_ID,
  clearTestMonthData,
  ensureTestSequence,
  testDate,
  testPrisma,
} from "./fixtures";

// A column exists because something was sold into it.
//
// Two bugs in one: a milk-only round printed a column for every product in the
// city, and a product not flagged for Daily Entry was billed for the right
// amount while getting no column at all — so the printed lines did not add up
// to the printed total.
test.describe("Printed sheets show the products a round actually sold", () => {
  const GHEE_ID = "c1a7f6d2-0b3e-4a51-9f8c-2d6e5b4a3c99";
  const PANEER_ID = "c1a7f6d2-0b3e-4a51-9f8c-2d6e5b4a3c98";

  test.beforeAll(async () => {
    const prisma = testPrisma();

    // An occasional item: sold now and then, deliberately kept off the Daily
    // Entry grid so it does not sit empty against 600 customers.
    await prisma.product.upsert({
      where: { id: GHEE_ID },
      update: { isActive: true, showInDailyEntry: false },
      create: {
        id: GHEE_ID, cityId: TEST_CITY_ID, code: "E2E-GHEE", name: "E2E Ghee",
        unit: "Kg", defaultRate: 1450, displayOrder: 50, isActive: true, showInDailyEntry: false,
      },
    });

    // An everyday product that this round simply does not sell. It is the one
    // that used to take up a column on every printed sheet regardless.
    await prisma.product.upsert({
      where: { id: PANEER_ID },
      update: { isActive: true, showInDailyEntry: true },
      create: {
        id: PANEER_ID, cityId: TEST_CITY_ID, code: "E2E-PANEER", name: "E2E Paneer",
        unit: "Kg", defaultRate: 400, displayOrder: 51, isActive: true, showInDailyEntry: true,
      },
    });
  });

  test.beforeEach(async () => {
    const prisma = testPrisma();
    await clearTestMonthData(TEST_ROUTE_ID);
    await ensureTestSequence(TEST_ROUTE_ID, [TEST_CUSTOMER_1_ID, TEST_CUSTOMER_2_ID]);

    const milk = await prisma.product.findFirst({
      where: { cityId: TEST_CITY_ID, code: "E2E-MILK" },
      select: { id: true, defaultRate: true },
    });
    const entry = await prisma.dailyRouteEntry.create({
      data: { routeId: TEST_ROUTE_ID, entryDate: new Date(`${testDate("05")}T00:00:00.000Z`), syncStatus: "DRAFT" },
    });

    // Customer 1 takes milk and, this once, a half kilo of ghee.
    const lineOne = await prisma.dailyRouteEntryLine.create({
      data: { entryId: entry.id, customerId: TEST_CUSTOMER_1_ID, sequenceNo: 1, skipped: false },
    });
    await prisma.dailyRouteEntryLineProduct.createMany({
      data: [
        { lineId: lineOne.id, productId: milk!.id, quantity: 10, rateSnapshot: milk!.defaultRate },
        { lineId: lineOne.id, productId: GHEE_ID, quantity: 0.5, rateSnapshot: 1450 },
      ],
    });

    // Customer 2 takes milk only.
    const lineTwo = await prisma.dailyRouteEntryLine.create({
      data: { entryId: entry.id, customerId: TEST_CUSTOMER_2_ID, sequenceNo: 2, skipped: false },
    });
    await prisma.dailyRouteEntryLineProduct.create({
      data: { lineId: lineTwo.id, productId: milk!.id, quantity: 4, rateSnapshot: milk!.defaultRate },
    });
  });

  test.afterAll(async () => {
    await clearTestMonthData(TEST_ROUTE_ID);
    const prisma = testPrisma();
    await prisma.product.updateMany({ where: { id: { in: [GHEE_ID, PANEER_ID] } }, data: { isActive: false } });
  });

  test("drops a product the round never sold", async ({ page }) => {
    await page.goto(`/monthly-bills/summary?month=${TEST_MONTH}&routeId=${TEST_ROUTE_ID}`);
    await page.waitForLoadState("networkidle");

    await expect(page.getByRole("columnheader", { name: /E2E-MILK|Buffalo/i })).toBeVisible();
    // Paneer is active and shown in Daily Entry, but nobody bought any.
    await expect(page.getByRole("columnheader", { name: /PANEER/i })).toHaveCount(0);
  });

  test("keeps an occasional sale off the summary columns but inside the money", async ({ page }) => {
    await page.goto(`/monthly-bills/summary?month=${TEST_MONTH}&routeId=${TEST_ROUTE_ID}`);
    await page.waitForLoadState("networkidle");

    // The office sheet does not need a ghee column for one sale.
    await expect(page.getByRole("columnheader", { name: /GHEE/i })).toHaveCount(0);
    // But the ₹725 of ghee is still inside the amounts: 10 x 60 milk + 725
    // for customer one, 4 x 60 for customer two = 1,565.
    await expect(page.getByRole("row", { name: /Route Total/i })).toContainText("1,565.00");
  });

  test("itemises the occasional sale on the customer's own bill", async ({ page }) => {
    const prisma = testPrisma();
    await generateBills(page);

    const billOne = await prisma.monthlyBill.findFirst({
      where: { routeId: TEST_ROUTE_ID, customerId: TEST_CUSTOMER_1_ID },
      select: { id: true },
    });

    await page.goto(`/monthly-bills/${billOne!.id}`);
    await page.waitForLoadState("networkidle");

    // Ghee gets no calendar column — it gets a line that explains the money,
    // and the bill's own arithmetic now accounts for every rupee in its total.
    await expect(page.getByRole("columnheader", { name: /GHEE/i })).toHaveCount(0);
    await expect(page.getByText(/Other items:/)).toBeVisible();
    await expect(page.getByText(/0\.5 Kg .*Ghee/i)).toBeVisible();
    await expect(page.getByText("Other Items (+)")).toBeVisible();
    await expect(page.getByText("₹725.00").first()).toBeVisible();
  });

  async function generateBills(page: import("@playwright/test").Page) {
    await page.goto("/monthly-bills");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Generate bills" }).first().click();

    const dialog = page.getByRole("dialog");
    await dialog.locator('input[name="billingMonth"]').fill(TEST_MONTH);
    await dialog.getByRole("button", { name: "Generate bills" }).click();
    // The dialog closes itself on success — that is the real signal.
    await expect(dialog).toBeHidden({ timeout: 20_000 });
  }

  test("a printed bill shows only what that customer took", async ({ page }) => {
    const prisma = testPrisma();
    await generateBills(page);

    const billTwo = await prisma.monthlyBill.findFirst({
      where: { routeId: TEST_ROUTE_ID, customerId: TEST_CUSTOMER_2_ID },
      select: { id: true },
    });

    await page.goto(`/monthly-bills/${billTwo!.id}`);
    await page.waitForLoadState("networkidle");

    // Customer 2 took milk only, so their bill's calendar carries no ghee
    // column even though the round sold some to customer 1.
    await expect(page.getByText(/GHEE/i)).toHaveCount(0);
    await expect(page.getByText(/PANEER/i)).toHaveCount(0);
  });
});
