import { test, expect } from "@playwright/test";
import { TEST_VEHICLE_ID } from "./fixtures";

// A thin colour bar that shows only while the screen is waiting.
test.describe("Loading bar", () => {
  test("stays out of the way when nothing is loading", async ({ page }) => {
    await page.goto("/reconciliation");
    await page.waitForLoadState("networkidle");

    // Present in the tree but not announced, and it occupies no height, so
    // nothing below it shifts as it comes and goes.
    await expect(page.getByRole("status")).toHaveCount(0);
  });

  test("navigating between tabs goes through the router, not a page load", async ({ page }) => {
    await page.goto("/reconciliation");
    await page.waitForLoadState("networkidle");

    // A full document navigation would unload the page and take the bar with
    // it, so the tab switch has to be client-side for the bar to mean anything.
    let reloaded = false;
    page.on("load", () => {
      reloaded = true;
    });

    await page.getByRole("button", { name: "Cash report", exact: true }).click();
    await expect(page.getByRole("button", { name: "Load report" })).toBeVisible();

    expect(reloaded).toBe(false);
    expect(page.url()).toContain("tab=cash-report");
  });

  test("loading a range keeps the page alive rather than reloading it", async ({ page }) => {
    await page.goto(`/reconciliation?tab=cash-report&vehicleId=${TEST_VEHICLE_ID}`);
    await page.waitForLoadState("networkidle");

    let reloaded = false;
    page.on("load", () => {
      reloaded = true;
    });

    await page.getByRole("button", { name: "Load report" }).click();
    await expect(page.getByRole("button", { name: "Load report" })).toBeVisible();

    expect(reloaded).toBe(false);
  });
});
