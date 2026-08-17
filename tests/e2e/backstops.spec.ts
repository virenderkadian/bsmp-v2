import { test, expect } from "@playwright/test";
import { TEST_CITY_ID, TEST_ROUTE_ID, testPrisma } from "./fixtures";

test.describe("Audit trail", () => {
  let testCityId: string;

  test.afterAll(async () => {
    if (testCityId) {
      await testPrisma().city.deleteMany({ where: { id: testCityId } });
    }
  });

  test("a city creation shows up in Settings > Activity", async ({ page }) => {
    const suffix = Date.now().toString().slice(-8);
    const cityName = `Audit Test City ${suffix}`;

    await page.goto("/settings");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: /^Cities/ }).click();
    await page.getByRole("button", { name: "Add city" }).click();

    const dialog = page.getByRole("dialog");
    await dialog.locator('input[name="code"]').fill(`AT${suffix}`.slice(0, 8));
    await dialog.locator('input[name="name"]').fill(cityName);
    await dialog.getByRole("button", { name: "Save city" }).click();
    await expect(dialog).toBeHidden({ timeout: 10_000 });

    const city = await testPrisma().city.findFirst({ where: { name: cityName } });
    expect(city).not.toBeNull();
    testCityId = city!.id;

    await page.getByRole("button", { name: /^Activity/ }).click();
    await expect(page.getByText(`Created city ${cityName}`)).toBeVisible({ timeout: 10_000 });

    const auditEntry = await testPrisma().auditLog.findFirst({
      where: { entityType: "City", entityId: testCityId, action: "CREATE" },
    });
    expect(auditEntry).not.toBeNull();
  });
});

// Audit summaries are free text and several embed a raw id, e.g. "Saved daily
// entry for route 2d63fc67-...". Ids are resolved when the log is read, so
// entries already stored become readable too.
test.describe("Activity readability", () => {
  test.afterAll(async () => {
    await testPrisma().auditLog.deleteMany({ where: { action: "E2E_LABEL_CHECK" } });
  });

  test("shows a route code instead of its id, and opens full detail from the view icon", async ({ page }) => {
    const prisma = testPrisma();
    const route = await prisma.route.findUnique({
      where: { id: TEST_ROUTE_ID },
      select: { code: true, name: true },
    });

    await prisma.auditLog.deleteMany({ where: { action: "E2E_LABEL_CHECK" } });
    await prisma.auditLog.create({
      data: {
        cityId: TEST_CITY_ID,
        actorName: "E2E",
        actorRole: "SUPERADMIN",
        entityType: "DailyRouteEntry",
        action: "E2E_LABEL_CHECK",
        // The exact shape that reads badly in the UI.
        summary: `Saved daily entry for route ${TEST_ROUTE_ID} on 2027-01-14 (32 customer lines).`,
        after: { routeId: TEST_ROUTE_ID, lineCount: 32 },
      },
    });

    await page.goto("/settings");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button").filter({ hasText: /^Activity/ }).first().click();

    await page.getByPlaceholder(/Search by actor/i).fill("E2E_LABEL_CHECK");

    const row = page.locator("tr", { hasText: "E2E_LABEL_CHECK" }).first();
    await expect(row).toBeVisible({ timeout: 10_000 });

    // The id is replaced by something a person can read.
    await expect(row).toContainText(route!.code);
    await expect(row).not.toContainText(TEST_ROUTE_ID);

    // Full text lives behind the view icon rather than stretching the table.
    await row.getByRole("button", { name: /view activity detail/i }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await expect(dialog).toContainText("32 customer lines");
    await expect(dialog).toContainText(route!.code);
  });
});
