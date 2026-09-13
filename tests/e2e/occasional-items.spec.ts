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

// Selling a one-off item from Daily Entry.
//
// The save rebuilds every line's product rows from what the form posts, so the
// two things that matter are that a typed rate survives, and that an item
// already saved is posted back rather than silently deleted by the next save.
test.describe("Occasional items in Daily Entry", () => {
  const GHEE_ID = "c1a7f6d2-0b3e-4a51-9f8c-2d6e5b4a3c97";
  const ENTRY_DATE = testDate("07");

  test.beforeAll(async () => {
    await testPrisma().product.upsert({
      where: { id: GHEE_ID },
      update: { isActive: true, showInDailyEntry: false },
      create: {
        id: GHEE_ID, cityId: TEST_CITY_ID, code: "E2E-GHEE2", name: "E2E Ghee Jar",
        unit: "Kg", defaultRate: 1400, displayOrder: 60, isActive: true, showInDailyEntry: false,
      },
    });
  });

  test.beforeEach(async () => {
    await clearTestMonthData(TEST_ROUTE_ID);
    await ensureTestSequence(TEST_ROUTE_ID, [TEST_CUSTOMER_1_ID, TEST_CUSTOMER_2_ID]);
  });

  test.afterAll(async () => {
    await clearTestMonthData(TEST_ROUTE_ID);
    await testPrisma().product.update({ where: { id: GHEE_ID }, data: { isActive: false } });
  });

  async function openEntry(page: import("@playwright/test").Page, date = ENTRY_DATE) {
    await page.goto(`/daily-entry?routeId=${TEST_ROUTE_ID}&entryDate=${date}`);
    await page.waitForLoadState("networkidle");
  }

  // The column is opt-in, so anything that uses it has to ask for it first.
  async function openEntryWithActions(page: import("@playwright/test").Page, date = ENTRY_DATE) {
    await openEntry(page, date);
    const toggle = page.getByRole("checkbox", { name: "At the door" });
    if (!(await toggle.isChecked())) {
      await toggle.check();
    }
  }

  // Scoped to a date: tests use different entry dates so they cannot share a
  // cached route payload, which means product and customer alone no longer
  // identify one row.
  async function savedGhee(date = ENTRY_DATE) {
    return testPrisma().dailyRouteEntryLineProduct.findFirst({
      where: {
        productId: GHEE_ID,
        line: {
          customerId: TEST_CUSTOMER_1_ID,
          entry: { entryDate: new Date(`${date}T00:00:00.000Z`) },
        },
      },
      select: { quantity: true, rateSnapshot: true },
    });
  }

  test("sells a one-off item at a rate typed at the door", async ({ page }) => {
    await openEntryWithActions(page);

    const row = page.getByRole("row", { name: /E2E Customer One/ });
    await row.getByRole("button", { name: /Item/ }).click();

    // The catalogue says 1,400. This one was agreed at 1,450.
    await page.getByLabel(/Quantity of E2E Ghee Jar/).fill("0.5");
    await page.getByLabel(/Rate for E2E Ghee Jar/).fill("1450");
    await page.getByRole("button", { name: /^Save/ }).click();

    await expect
      .poll(async () => Number((await savedGhee())?.rateSnapshot ?? 0), { timeout: 20_000 })
      .toBe(1450);
    expect(Number((await savedGhee())?.quantity)).toBe(0.5);
  });

  test("the typed rate lands on the right customer, not shifted by a row", async ({ page }) => {
    // The form posts four flat parallel arrays paired by index. An occasional
    // row sits between two customers' grid cells, so a mismatch here would
    // quietly bill the wrong person.
    await openEntryWithActions(page);
    await page
      .getByRole("row", { name: /E2E Customer One/ })
      .getByRole("button", { name: /Item/ })
      .click();
    await page.getByLabel(/Quantity of E2E Ghee Jar/).fill("2");
    await page.getByLabel(/Rate for E2E Ghee Jar/).fill("1234");
    await page.getByRole("button", { name: /^Save/ }).click();

    await expect
      .poll(async () => Number((await savedGhee())?.rateSnapshot ?? 0), { timeout: 20_000 })
      .toBe(1234);

    // Customer Two bought no ghee and must have none.
    const other = await testPrisma().dailyRouteEntryLineProduct.findFirst({
      where: { productId: GHEE_ID, line: { customerId: TEST_CUSTOMER_2_ID } },
    });
    expect(other).toBeNull();
  });

  test("a saved item survives the next save of that round", async ({ page }) => {
    await openEntryWithActions(page);
    await page
      .getByRole("row", { name: /E2E Customer One/ })
      .getByRole("button", { name: /Item/ })
      .click();
    await page.getByLabel(/Quantity of E2E Ghee Jar/).fill("1");
    await page.getByRole("button", { name: /^Save/ }).click();
    await expect.poll(async () => Number((await savedGhee())?.quantity ?? 0), { timeout: 20_000 }).toBe(1);

    // Reload and save again without touching the item. The save rebuilds every
    // product row from the form, so this is where a missing round-trip would
    // delete it.
    await openEntry(page);
    await expect(page.getByLabel(/Quantity of E2E Ghee Jar/)).toHaveValue("1");
    // Grid quantity cells carry no accessible label, so they are reached by
    // the attribute the screen's own recompute uses.
    await page
      .getByRole("row", { name: /E2E Customer Two/ })
      .locator('[data-daily-entry-quantity="true"]')
      .first()
      .fill("3");
    await page.getByRole("button", { name: /^Save/ }).click();

    await expect
      .poll(async () => Number((await savedGhee())?.quantity ?? 0), { timeout: 20_000 })
      .toBe(1);
  });

  test("counts an occasional sale in the day's total on first load", async ({ page }) => {
    // Its own date. This asserts an exact figure, and two tests sharing a URL
    // can share a cached route payload as well.
    const date = testDate("06");
    await openEntryWithActions(page, date);
    await page
      .getByRole("row", { name: /E2E Customer One/ })
      .getByRole("button", { name: /Item/ })
      .click();
    await page.getByLabel(/Quantity of E2E Ghee Jar/).fill("2");
    await page.getByLabel(/Rate for E2E Ghee Jar/).fill("1000");
    await page.getByRole("button", { name: /^Save/ }).click();
    await expect
      .poll(async () => Number((await savedGhee(date))?.quantity ?? 0), { timeout: 20_000 })
      .toBe(2);

    // Reload: the figure must already include the 2,000 of ghee, not wait for
    // somebody to touch a quantity before correcting itself.
    await openEntry(page, date);
    // The label and the figure are separate spans — assert on the row.
    // Daily Entry prints the running total unseparated: 2000.00, not 2,000.00.
    await expect(page.locator("tfoot")).toContainText("2000.00");
  });

  // Reported from the screen: add a row, change your mind, remove it — and Save
  // still offered to save a change that no longer existed.
  test("adding a row and removing it leaves nothing to save", async ({ page }) => {
    await openEntryWithActions(page);
    const save = page.getByRole("button", { name: /^Save|^Saved/ });
    await expect(save).toHaveText("Saved");

    const row = page.getByRole("row", { name: /E2E Customer One/ });
    await row.getByRole("button", { name: /Item/ }).click();
    await expect(save).toHaveText("Save changes");

    await page.getByRole("button", { name: "Remove" }).click();
    // Back exactly as found, so there is nothing to save.
    await expect(save).toHaveText("Saved");
  });

  test("the column is off until asked for, then remembered", async ({ page }) => {
    await openEntry(page);
    const column = page.getByRole("columnheader", { name: "At the door" });
    // Off by default: most rounds are milk and quantities.
    await expect(column).toHaveCount(0);

    await page.getByRole("checkbox", { name: "At the door" }).check();
    await expect(column).toBeVisible();

    // The preference survives a reload — a per-operator choice, not a
    // per-visit one.
    await openEntry(page);
    await expect(page.getByRole("columnheader", { name: "At the door" })).toBeVisible();

    await page.getByRole("checkbox", { name: "At the door" }).uncheck();
    await expect(page.getByRole("columnheader", { name: "At the door" })).toHaveCount(0);
  });

  test("hiding the column never hides a sale already recorded", async ({ page }) => {
    await openEntryWithActions(page);
    await page
      .getByRole("row", { name: /E2E Customer One/ })
      .getByRole("button", { name: /Item/ })
      .click();
    await page.getByLabel(/Quantity of E2E Ghee Jar/).fill("1");
    await page.getByRole("button", { name: /^Save/ }).click();
    await expect.poll(async () => Number((await savedGhee())?.quantity ?? 0), { timeout: 20_000 }).toBe(1);

    await openEntryWithActions(page);
    await page.getByRole("checkbox", { name: "At the door" }).uncheck();

    // Only the buttons go. A figure that disappears from a screen is how money
    // goes missing.
    await expect(page.getByRole("columnheader", { name: "At the door" })).toHaveCount(0);
    await expect(page.getByLabel(/Quantity of E2E Ghee Jar/)).toHaveValue("1");
  });

  test("records the hand-typed rate in the audit trail", async ({ page }) => {
    await openEntryWithActions(page);
    await page
      .getByRole("row", { name: /E2E Customer One/ })
      .getByRole("button", { name: /Item/ })
      .click();
    await page.getByLabel(/Quantity of E2E Ghee Jar/).fill("0.25");
    await page.getByLabel(/Rate for E2E Ghee Jar/).fill("1999");
    await page.getByRole("button", { name: /^Save/ }).click();

    // Shipping before permissions means the trail is the only control.
    await expect
      .poll(
        async () => {
          const log = await testPrisma().auditLog.findFirst({
            where: { entityType: "DailyRouteEntry", action: "SAVE" },
            orderBy: { createdAt: "desc" },
            select: { after: true, summary: true },
          });
          return JSON.stringify(log?.after ?? {});
        },
        { timeout: 20_000 },
      )
      .toContain("1999");
  });
});
