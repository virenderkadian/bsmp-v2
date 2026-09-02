import { test, expect } from "@playwright/test";
import {
  TEST_CUSTOMER_1_ID,
  TEST_MONTH,
  TEST_ROUTE_ID,
  TEST_ROUTE_2_ID,
  ensureTestSequence,
  testPrisma,
} from "./fixtures";

// Settings > Billing routes used to load the current month onward only, so
// there was no way to see which route had carried a customer's bill in an
// earlier month. Past months are now viewable, but never editable.
test.describe("Billing routes history", () => {
  // Genuinely in the past. The other fixtures use 2027-01 to stay clear of real
  // data, but a FUTURE month is editable — read-only is what is being tested.
  const PAST_MONTH = new Date("2026-07-01T00:00:00.000Z");
  const PAST_MONTH_INPUT = "2026-07";

  test.beforeAll(async () => {
    const prisma = testPrisma();
    await ensureTestSequence(TEST_ROUTE_ID, [TEST_CUSTOMER_1_ID]);
    await ensureTestSequence(TEST_ROUTE_2_ID, [TEST_CUSTOMER_1_ID]);

    // The same customer on both rounds in a month that has already passed.
    for (const [index, routeId] of [TEST_ROUTE_ID, TEST_ROUTE_2_ID].entries()) {
      await prisma.monthlyRouteCustomerSequence.upsert({
        where: {
          routeId_sequenceMonth_customerId: {
            routeId,
            sequenceMonth: PAST_MONTH,
            customerId: TEST_CUSTOMER_1_ID,
          },
        },
        update: {},
        create: {
          routeId,
          customerId: TEST_CUSTOMER_1_ID,
          sequenceMonth: PAST_MONTH,
          sequenceNo: 1,
          status: "ACTIVE",
          billsHere: index === 0,
        },
      });
    }
  });

  test.afterAll(async () => {
    await testPrisma().monthlyRouteCustomerSequence.deleteMany({
      where: { sequenceMonth: PAST_MONTH, customerId: TEST_CUSTOMER_1_ID },
    });
  });

  test("shows a past month and marks it read only", async ({ page }) => {
    await page.goto(`/settings?billingMonth=${PAST_MONTH_INPUT}`);
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: /Billing routes/i }).click();

    await expect(page.getByText("Read only — already billed")).toBeVisible();
    await expect(page.getByText("E2E Customer One").first()).toBeVisible();
  });

  test("cannot change where a past month's bill sits", async ({ page }) => {
    await page.goto(`/settings?billingMonth=${PAST_MONTH_INPUT}`);
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: /Billing routes/i }).click();

    // Every route choice is disabled: the month is already billed, and moving
    // the bill now would rewrite history rather than correct anything.
    const choices = page.getByRole("button", { name: /ROUTE-01-/ });
    const count = await choices.count();
    expect(count).toBeGreaterThan(0);
    for (let index = 0; index < count; index += 1) {
      await expect(choices.nth(index)).toBeDisabled();
    }
  });

  test("the current month stays editable", async ({ page }) => {
    await page.goto(`/settings?billingMonth=${TEST_MONTH}`);
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: /Billing routes/i }).click();

    await expect(page.getByText("Read only — already billed")).toHaveCount(0);
  });
});
