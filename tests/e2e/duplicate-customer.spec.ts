import { test, expect } from "@playwright/test";
import { testPrisma, TEST_CITY_ID } from "./fixtures";

// Names collide constantly in this data: 10 groups share a name exactly (RAHUL
// is four different people) and 154 customers share a leading house number.
// Creating silently is how the wrong customer ends up on a round.
const DUP_NAME = "E2E DUPLICATE NAME";

test.describe("Duplicate customer names", () => {
  test.beforeAll(async () => {
    const prisma = testPrisma();
    await prisma.customer.deleteMany({ where: { cityId: TEST_CITY_ID, name: DUP_NAME } });
    await prisma.customer.create({
      data: {
        cityId: TEST_CITY_ID,
        code: "E2E-DUP1",
        name: DUP_NAME,
        area: "FIRST AREA",
        openingBalance: 0,
      },
    });
  });

  test.afterAll(async () => {
    await testPrisma().customer.deleteMany({ where: { cityId: TEST_CITY_ID, name: DUP_NAME } });
  });

  async function openCreateDialog(page: import("@playwright/test").Page) {
    await page.goto("/customers");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Add Customer" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
  }

  test("shows who you might be duplicating, with what tells them apart", async ({ page }) => {
    await openCreateDialog(page);
    const dialog = page.getByRole("dialog");
    await dialog.locator('input[name="name"]').fill(DUP_NAME);
    await dialog.locator('input[name="area"]').fill("SECOND AREA");
    await dialog.getByRole("button", { name: "Save customer" }).click();

    // Not created — and the existing one is listed with its area, which is the
    // field that actually distinguishes people here.
    await expect(dialog.getByText("Already in this city")).toBeVisible();
    await expect(dialog.getByText(/FIRST AREA/)).toBeVisible();

    const count = await testPrisma().customer.count({
      where: { cityId: TEST_CITY_ID, name: DUP_NAME },
    });
    expect(count).toBe(1);
  });

  test("demands an area when the name is ambiguous", async ({ page }) => {
    await openCreateDialog(page);
    const dialog = page.getByRole("dialog");
    await dialog.locator('input[name="name"]').fill(DUP_NAME);
    await dialog.getByRole("button", { name: "Save customer" }).click();

    // Area is required only on a collision — never for the 1,318 records that
    // are perfectly identifiable without one.
    await expect(dialog.getByText(/Add an area so the two can be told apart/)).toBeVisible();
  });

  test("creates it once the operator confirms a different person", async ({ page }) => {
    await openCreateDialog(page);
    const dialog = page.getByRole("dialog");
    await dialog.locator('input[name="name"]').fill(DUP_NAME);
    await dialog.locator('input[name="area"]').fill("SECOND AREA");
    await dialog.getByRole("button", { name: "Save customer" }).click();
    await expect(dialog.getByText("Already in this city")).toBeVisible();

    // The typed values must survive the failed submit — React resets an
    // uncontrolled form once its action returns, which used to wipe them at
    // exactly the moment the operator needed to read them and decide.
    await expect(dialog.locator('input[name="name"]')).toHaveValue(DUP_NAME);
    await expect(dialog.locator('input[name="area"]')).toHaveValue("SECOND AREA");

    // RAHUL really is four different people — this must never be a hard block.
    await dialog.getByRole("checkbox").check();
    await dialog.getByRole("button", { name: "Save customer" }).click();

    await expect
      .poll(
        async () =>
          testPrisma().customer.count({ where: { cityId: TEST_CITY_ID, name: DUP_NAME } }),
        { timeout: 15_000 },
      )
      .toBe(2);
  });

  test("lists the shared names in Settings, worst first", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: /Duplicate names/ }).click();

    await expect(page.getByRole("heading", { name: DUP_NAME })).toBeVisible();
    await expect(page.getByText("E2E-DUP1")).toBeVisible();
    // The area is what tells the two apart, so it has to be on the row.
    await expect(page.getByText("FIRST AREA")).toBeVisible();
  });

  test("blocks bulk add when a pasted name already exists", async ({ page }) => {
    // Bulk add is the fastest way to introduce duplicates — a whole round
    // pasted at once, previously with nothing checking the names.
    const before = await testPrisma().customer.count({
      where: { cityId: TEST_CITY_ID, name: DUP_NAME },
    });

    await page.goto("/customers/bulk-add");
    await page.waitForLoadState("networkidle");

    await page.getByRole("textbox").first().fill(DUP_NAME);
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: /^Save \d+ customer/ }).click();

    await expect(page.getByText(/Some names are not unique/)).toBeVisible({ timeout: 15_000 });

    // Counted before and after rather than pinned to a number: an earlier test
    // in this file legitimately adds a second record with this name.
    const after = await testPrisma().customer.count({
      where: { cityId: TEST_CITY_ID, name: DUP_NAME },
    });
    expect(after).toBe(before);
  });

  test("a unique name is created without any friction", async ({ page }) => {
    const unique = `E2E UNIQUE ${Date.now()}`;
    await openCreateDialog(page);
    const dialog = page.getByRole("dialog");
    await dialog.locator('input[name="name"]').fill(unique);
    await dialog.getByRole("button", { name: "Save customer" }).click();

    // No area, no confirmation — the common case stays a single click.
    await expect(dialog).toBeHidden({ timeout: 15_000 });
    await testPrisma().customer.deleteMany({ where: { cityId: TEST_CITY_ID, name: unique } });
  });
});
