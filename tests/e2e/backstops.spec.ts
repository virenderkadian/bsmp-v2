import { test, expect } from "@playwright/test";
import { testPrisma } from "./fixtures";

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
