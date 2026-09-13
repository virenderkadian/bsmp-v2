import { test, expect } from "@playwright/test";
import {
  TEST_CITY_ID,
  TEST_CUSTOMER_1_ID,
  TEST_CUSTOMER_2_ID,
  TEST_ROUTE_ID,
  clearTestMonthData,
  ensureTestSequence,
  testDate,
  testPrisma,
} from "./fixtures";

// Taking money from the Daily Entry screen.
//
// Eight customers were charged twice in September because a second surface
// showed a stale figure and nobody was told the money was already in. A third
// place to record a payment makes that easier, so the guards matter more than
// the feature.
test.describe("Payment at the door", () => {
  const ENTRY_DATE = testDate("14");
  const PAY_DATE = new Date(`${ENTRY_DATE}T00:00:00.000Z`);

  test.beforeEach(async () => {
    await clearTestMonthData(TEST_ROUTE_ID);
    await ensureTestSequence(TEST_ROUTE_ID, [TEST_CUSTOMER_1_ID, TEST_CUSTOMER_2_ID]);
    await testPrisma().payment.deleteMany({
      where: { route: { cityId: TEST_CITY_ID }, paymentDate: PAY_DATE },
    });
  });

  test.afterAll(async () => {
    await clearTestMonthData(TEST_ROUTE_ID);
    await testPrisma().payment.deleteMany({
      where: { route: { cityId: TEST_CITY_ID }, paymentDate: PAY_DATE },
    });
  });

  async function openWithActions(page: import("@playwright/test").Page) {
    await page.goto(`/daily-entry?routeId=${TEST_ROUTE_ID}&entryDate=${ENTRY_DATE}`);
    await page.waitForLoadState("networkidle");
    const toggle = page.getByRole("checkbox", { name: "At the door" });
    if (!(await toggle.isChecked())) {
      await toggle.check();
    }
  }

  function paymentsFor(customerId: string) {
    return testPrisma().payment.findMany({
      where: { customerId, paymentDate: PAY_DATE },
      select: { amount: true, status: true, routeId: true, collectedById: true },
    });
  }

  test("records money against the round being entered", async ({ page }) => {
    await openWithActions(page);
    await page.getByRole("row", { name: /E2E Customer One/ }).getByRole("button", { name: /Pay/ }).click();

    const dialog = page.getByRole("dialog");
    await dialog.locator('input[name="amount"]').fill("450");
    await dialog.getByRole("button", { name: "Record payment" }).click();

    await expect.poll(async () => (await paymentsFor(TEST_CUSTOMER_1_ID)).length, { timeout: 20_000 }).toBe(1);
    const [payment] = await paymentsFor(TEST_CUSTOMER_1_ID);
    expect(Number(payment.amount)).toBe(450);
    // Office entry, so it counts immediately — unlike the driver app, whose
    // payments stay UNVERIFIED until someone here confirms them.
    expect(payment.status).toBe("VERIFIED");
    // The round it was collected on, taken from context rather than typed.
    expect(payment.routeId).toBe(TEST_ROUTE_ID);
    // Who took it — the column that existed for years with nothing writing it.
    expect(payment.collectedById).not.toBeNull();
  });

  test("warns before taking a second payment the same day, and allows it", async ({ page }) => {
    const prisma = testPrisma();
    await prisma.payment.create({
      data: {
        customerId: TEST_CUSTOMER_2_ID, routeId: TEST_ROUTE_ID, amount: 300,
        paymentDate: PAY_DATE, mode: "CASH", status: "VERIFIED",
      },
    });

    await openWithActions(page);
    await page.getByRole("row", { name: /E2E Customer Two/ }).getByRole("button", { name: /Pay/ }).click();

    const dialog = page.getByRole("dialog");
    await dialog.locator('input[name="amount"]').fill("200");
    await dialog.getByRole("button", { name: "Record payment" }).click();

    // Warned, and nothing written yet.
    await expect(dialog.getByText(/Already recorded/)).toBeVisible({ timeout: 20_000 });
    expect((await paymentsFor(TEST_CUSTOMER_2_ID)).length).toBe(1);

    // Two genuine payments in a day happen, so it confirms rather than blocks.
    await dialog.getByRole("checkbox").check();
    await dialog.getByRole("button", { name: "Record payment" }).click();
    await expect.poll(async () => (await paymentsFor(TEST_CUSTOMER_2_ID)).length, { timeout: 20_000 }).toBe(2);
  });

  test("the same submission arriving twice records the money once", async ({ page }) => {
    test.setTimeout(60_000);

    // Clicking twice proves nothing — the dialog closes before a second click
    // lands. A retried request is the real shape of the bug: the same form data
    // reaching the server again, which is what put 3,061 against a 3,060
    // collection in production.
    //
    // The payment is confirmed past the same-day warning first, so that guard
    // is out of the way and the only thing standing between the replay and a
    // second row is the submission id being the payment's primary key.
    const prisma = testPrisma();
    await prisma.payment.create({
      data: {
        customerId: TEST_CUSTOMER_1_ID, routeId: TEST_ROUTE_ID, amount: 100,
        paymentDate: PAY_DATE, mode: "CASH", status: "VERIFIED",
      },
    });

    let captured: { url: string; headers: Record<string, string>; body: string } | null = null;
    page.on("request", (request) => {
      const headers = request.headers();
      if (request.method() === "POST" && headers["next-action"] && request.postData()) {
        captured = { url: request.url(), headers, body: request.postData() as string };
      }
    });

    await openWithActions(page);
    await page.getByRole("row", { name: /E2E Customer One/ }).getByRole("button", { name: /Pay/ }).click();

    const dialog = page.getByRole("dialog");
    await dialog.locator('input[name="amount"]').fill("777");
    await dialog.getByRole("button", { name: "Record payment" }).click();
    await expect(dialog.getByText(/Already recorded/)).toBeVisible({ timeout: 20_000 });

    await dialog.getByRole("checkbox").check();
    await dialog.getByRole("button", { name: "Record payment" }).click();
    await expect.poll(async () => (await paymentsFor(TEST_CUSTOMER_1_ID)).length, { timeout: 20_000 }).toBe(2);

    const replay = captured as unknown as { url: string; headers: Record<string, string>; body: string };
    expect(replay).not.toBeNull();
    await page.request.post(replay.url, { headers: replay.headers, data: replay.body });

    // Still two: the retry collided with the primary key instead of writing the
    // money a third time.
    await page.waitForTimeout(1500);
    expect((await paymentsFor(TEST_CUSTOMER_1_ID)).length).toBe(2);
  });

  // Money attaches to the earliest month not yet locked, which is often not the
  // month being worked in. An operator should be told, not left to deduce it.
  test("says which month the payment will settle against", async ({ page }) => {
    const prisma = testPrisma();
    const thisMonth = new Date(`${ENTRY_DATE.slice(0, 7)}-01T00:00:00.000Z`);
    const lastMonth = new Date(
      Date.UTC(thisMonth.getUTCFullYear(), thisMonth.getUTCMonth() - 1, 1),
    );

    // Last month generated but NOT locked, this month open too.
    await prisma.monthlyBill.deleteMany({
      where: { routeId: TEST_ROUTE_ID, billingMonth: { in: [lastMonth, thisMonth] } },
    });
    await prisma.monthlyBill.createMany({
      data: [
        {
          customerId: TEST_CUSTOMER_1_ID, routeId: TEST_ROUTE_ID, billingMonth: lastMonth,
          openingBalance: 0, deliveryAmount: 900, paymentAmount: 0, closingBalance: 900,
          status: "GENERATED",
        },
        {
          customerId: TEST_CUSTOMER_1_ID, routeId: TEST_ROUTE_ID, billingMonth: thisMonth,
          openingBalance: 900, deliveryAmount: 500, paymentAmount: 0, closingBalance: 1400,
          status: "DRAFT",
        },
      ],
    });

    await openWithActions(page);
    await page.getByRole("row", { name: /E2E Customer One/ }).getByRole("button", { name: /Pay/ }).click();

    const dialog = page.getByRole("dialog");
    // The earliest open month, not the one being worked in.
    await expect(dialog.getByText(/Settles against December 2026/)).toBeVisible({ timeout: 20_000 });
    // And the honest consequence of leaving it unlocked.
    await expect(dialog.getByText(/also show against January 2027/)).toBeVisible();

    await prisma.monthlyBill.deleteMany({
      where: { routeId: TEST_ROUTE_ID, billingMonth: { in: [lastMonth, thisMonth] } },
    });
  });

  test("shows what the customer owes before asking for an amount", async ({ page }) => {
    await testPrisma().monthlyBill.create({
      data: {
        customerId: TEST_CUSTOMER_1_ID, routeId: TEST_ROUTE_ID,
        billingMonth: new Date(`${ENTRY_DATE.slice(0, 7)}-01T00:00:00.000Z`),
        openingBalance: 0, deliveryAmount: 1200, paymentAmount: 500, closingBalance: 700,
        status: "GENERATED",
      },
    });

    await openWithActions(page);
    await page.getByRole("row", { name: /E2E Customer One/ }).getByRole("button", { name: /Pay/ }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Outstanding")).toBeVisible({ timeout: 20_000 });
    await expect(dialog.getByText("₹700.00")).toBeVisible();
  });
});
