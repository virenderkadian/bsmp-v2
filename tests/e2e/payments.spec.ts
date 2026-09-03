import { test, expect } from "@playwright/test";
import {
  TEST_CUSTOMER_1_ID,
  TEST_CUSTOMER_2_ID,
  TEST_CUSTOMER_3_ID,
  TEST_MONTH,
  TEST_MONTH_DATE,
  TEST_ROUTE_ID,
  TEST_ROUTE_2_ID,
  TEST_VEHICLE_ID,
  ensureTestSequence,
  testDate,
  testPrisma,
} from "./fixtures";

// The collections sheet replaced the one-off "Add payment" dialog, which asked
// for a customer, a route and an amount without ever showing what was owed.
test.describe("Collections", () => {
  test.beforeAll(async () => {
    // Customer One rides BOTH rounds of the same vehicle — the shape that used
    // to list them twice, with a different (wrong) amount on each.
    await ensureTestSequence(TEST_ROUTE_ID, [TEST_CUSTOMER_1_ID, TEST_CUSTOMER_2_ID, TEST_CUSTOMER_3_ID]);
    await ensureTestSequence(TEST_ROUTE_2_ID, [TEST_CUSTOMER_1_ID]);
  });

  test.afterAll(async () => {
    const prisma = testPrisma();
    await prisma.payment.deleteMany({
      where: {
        routeId: { in: [TEST_ROUTE_ID, TEST_ROUTE_2_ID] },
        paymentDate: { gte: new Date("2027-01-01"), lt: new Date("2027-02-01") },
      },
    });
    await prisma.paymentBatch.deleteMany({
      where: { routeId: { in: [TEST_ROUTE_ID, TEST_ROUTE_2_ID] }, billingMonth: TEST_MONTH_DATE },
    });
  });

  async function openSheet(page: import("@playwright/test").Page, shift = "ALL") {
    await page.goto(
      `/payments/bulk-entry?vehicleId=${TEST_VEHICLE_ID}&shift=${shift}&month=${TEST_MONTH}&paymentDate=${testDate("15")}`,
    );
    await page.waitForLoadState("networkidle");
  }

  test("lists a customer riding both rounds exactly once", async ({ page }) => {
    await openSheet(page);

    await page.getByRole("searchbox", { name: /customer/i }).click();
    const matches = page.getByRole("button", { name: /E2E Customer One/ });

    // Both rounds are on this sheet, so a duplicate would show as two options.
    await expect(matches).toHaveCount(1);
  });

  test("shows which round each customer belongs to", async ({ page }) => {
    await openSheet(page);

    await page.getByRole("searchbox", { name: /customer/i }).click();
    await page.getByRole("button", { name: /E2E Customer One/ }).first().click();
    await page.getByLabel("Amount", { exact: true }).fill("10");
    await page.getByRole("button", { name: "Add row" }).click();

    // Both rounds number their customers from 1, so the row has to say which
    // trip it belongs to or the walking order is meaningless.
    await expect(page.getByText(/ROUTE-01-[ME] · (Morning|Evening)/).first()).toBeVisible();
  });

  test("narrows to a single round when a shift is chosen", async ({ page }) => {
    await openSheet(page, "EVENING");
    await page.getByRole("searchbox", { name: /customer/i }).click();

    // Customer Two is morning-only, so an evening sheet must not offer them.
    await expect(page.getByRole("button", { name: /E2E Customer Two/ })).toHaveCount(0);
  });

  test("saves twice in a row with the same row count, clearing each time", async ({ page }) => {
    // The result guard keyed on the message text, and the bulk success message
    // is only "Saved N route payments." — so a second save of the SAME row
    // count looked like an already-handled result and was swallowed, taking
    // its confirmation toast with it. This covers the repeat-save path; the
    // toast itself is not asserted here.
    await openSheet(page);

    for (const amount of ["11", "12"]) {
      await page.getByRole("searchbox", { name: /customer/i }).click();
      await page.getByRole("button", { name: /E2E Customer One/ }).first().click();
      await page.getByLabel("Amount", { exact: true }).fill(amount);
      await page.getByRole("button", { name: "Add row" }).click();
      await page.getByRole("button", { name: "Save All" }).click();

      // The action bar unmounts once the draft is empty, so its absence is the
      // sheet having cleared.
      await expect(page.getByRole("button", { name: "Save All" })).toHaveCount(0, { timeout: 15_000 });
    }

    // Both saves landed, and neither was swallowed. Polled because the row
    // clearing on screen and the transaction committing are not the same
    // instant.
    await expect
      .poll(
        async () => {
          const rows = await testPrisma().payment.findMany({
            where: {
              customerId: TEST_CUSTOMER_1_ID,
              paymentDate: new Date(`${testDate("15")}T00:00:00.000Z`),
              amount: { in: [11, 12] },
            },
            select: { amount: true },
          });
          return rows.map((row) => Number(row.amount)).sort();
        },
        { timeout: 15_000 },
      )
      .toEqual([11, 12]);
  });

  test("a double submit of the same draft records the money once", async ({ page }) => {
    // The bug that cost money: the sheet kept its rows after a save, the
    // operator clicked again, and the server wrote a second batch. In
    // production that put 3,061 against a 3,060 collection.
    await openSheet(page);

    await page.getByRole("searchbox", { name: /customer/i }).click();
    await page.getByRole("button", { name: /E2E Customer Three/ }).first().click();
    await page.getByLabel("Amount", { exact: true }).fill("777");
    await page.getByRole("button", { name: "Add row" }).click();

    // Two clicks as fast as the browser allows, before any re-render can
    // disable or unmount the button.
    await page.evaluate(() => {
      const button = [...document.querySelectorAll("button")].find(
        (candidate) => candidate.textContent?.trim() === "Save All",
      ) as HTMLButtonElement | undefined;
      button?.click();
      button?.click();
    });

    await expect
      .poll(
        async () =>
          testPrisma().payment.count({
            where: {
              customerId: TEST_CUSTOMER_3_ID,
              paymentDate: new Date(`${testDate("15")}T00:00:00.000Z`),
              amount: 777,
            },
          }),
        { timeout: 15_000 },
      )
      .toBe(1);

    // And still exactly one a moment later, in case the second write is slow.
    await page.waitForTimeout(2000);
    const finalCount = await testPrisma().payment.count({
      where: {
        customerId: TEST_CUSTOMER_3_ID,
        paymentDate: new Date(`${testDate("15")}T00:00:00.000Z`),
        amount: 777,
      },
    });
    expect(finalCount).toBe(1);
  });

  test("records a collection against the round it was taken on", async ({ page }) => {
    await openSheet(page);

    await page.getByRole("searchbox", { name: /customer/i }).click();
    await page.getByRole("button", { name: /E2E Customer Two/ }).first().click();
    await page.getByLabel("Amount", { exact: true }).fill("999");
    await page.getByRole("button", { name: "Add row" }).click();
    await page.getByRole("button", { name: "Save All" }).click();

    // The whole action bar unmounts once the draft is empty, so the saved row
    // itself is the signal rather than anything on screen.
    const saved = await expect
      .poll(
        async () =>
          testPrisma().payment.findFirst({
            where: {
              customerId: TEST_CUSTOMER_2_ID,
              paymentDate: new Date(`${testDate("15")}T00:00:00.000Z`),
            },
            select: { amount: true, routeId: true, collectedById: true },
          }),
        { timeout: 15_000 },
      )
      .not.toBeNull()
      .then(() =>
        testPrisma().payment.findFirst({
          where: {
            customerId: TEST_CUSTOMER_2_ID,
            paymentDate: new Date(`${testDate("15")}T00:00:00.000Z`),
          },
          select: { amount: true, routeId: true, collectedById: true },
        }),
      );

    const payment = saved;
    expect(Number(payment?.amount)).toBe(999);
    // Customer Two rides the morning round, and that is where the collection
    // is filed.
    expect(payment?.routeId).toBe(TEST_ROUTE_ID);
    // Stamped with who took the money — the column existed for a long time
    // with nothing ever writing to it.
    expect(payment?.collectedById).not.toBeNull();
  });
});
