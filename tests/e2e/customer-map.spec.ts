import { test, expect } from "@playwright/test";
import { TEST_CITY_ID, TEST_CUSTOMER_3_ID, testPrisma } from "./fixtures";

// The map exists to fix locations the driver app captured wrongly, and to place
// ones it never captured at all.
test.describe("Customer map", () => {
  test.afterAll(async () => {
    await testPrisma().customer.updateMany({
      where: { id: TEST_CUSTOMER_3_ID },
      data: { latitude: null, longitude: null },
    });
  });

  test("shows a customer's pin and the filter bar", async ({ page }) => {
    await testPrisma().customer.update({
      where: { id: TEST_CUSTOMER_3_ID },
      data: { latitude: 28.6939, longitude: 76.9105, cityId: TEST_CITY_ID },
    });

    await page.goto("/customers/map");
    await page.waitForLoadState("networkidle");

    // Filters the user asked for.
    await expect(page.getByPlaceholder(/Search code, name, or area/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: /^Missing/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Check/ })).toBeVisible();

    // The map itself renders rather than failing to load.
    await expect(page.locator(".leaflet-container")).toBeVisible({ timeout: 15_000 });

    // And the customer is listed.
    await page.getByPlaceholder(/Search code, name, or area/i).fill("E2E Customer Three");
    await expect(page.getByText("E2E Customer Three").first()).toBeVisible();
  });

  test("offers to place a location for a customer that has none", async ({ page }) => {
    await testPrisma().customer.update({
      where: { id: TEST_CUSTOMER_3_ID },
      data: { latitude: null, longitude: null },
    });

    await page.goto("/customers/map");
    await page.waitForLoadState("networkidle");
    await expect(page.locator(".leaflet-container")).toBeVisible({ timeout: 15_000 });

    await page.getByPlaceholder(/Search code, name, or area/i).fill("E2E Customer Three");
    await page.getByRole("button", { name: /E2E Customer Three/ }).first().click();

    // The whole point of this case: there is no pin to drag, so the map takes
    // a click instead.
    await expect(page.getByText(/Click the map where this customer is/i)).toBeVisible({ timeout: 10_000 });
  });
});
