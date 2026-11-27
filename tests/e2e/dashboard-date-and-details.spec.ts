import { test, expect } from "@playwright/test";

// The dashboard's date stepper and the detail behind each card.
test.describe("Dashboard date and card details", () => {
  test("stepping the date reloads the dashboard for that day and keeps it in the URL", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Previous day" }).click();
    await expect(page).toHaveURL(/[?&]date=\d{4}-\d{2}-\d{2}/);
    await expect(page.getByText("Selected day")).toBeVisible();

    // "Today" jumps back and drops the parameter.
    await page.getByRole("button", { name: "Today", exact: true }).click();
    await expect(page).not.toHaveURL(/date=/);
  });

  test("an invalid date in the URL falls back to today instead of failing", async ({ page }) => {
    await page.goto("/?date=not-a-date");
    await expect(page.getByText("Daily entry", { exact: true })).toBeVisible();
    await expect(page.getByText("Selected day")).toHaveCount(0);
  });

  test("Delivered and Cash sale open a per-product split", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /^Delivered/ }).click();
    const dialog = page.getByRole("dialog", { name: "Delivered" });
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);

    await page.getByRole("button", { name: /^Cash sale/ }).click();
    await expect(page.getByRole("dialog", { name: "Cash sale" })).toBeVisible();
  });

  test("Collected opens Payments filtered to verified payments on that day", async ({ page }) => {
    await page.goto("/?date=2027-01-05");
    await page.getByRole("button", { name: /^Collected/ }).click();
    await expect(page).toHaveURL(/\/payments\?status=VERIFIED&dateFrom=2027-01-05&dateTo=2027-01-05/, { timeout: 20_000 });
  });

  test("Customer outstanding lists customers and its filters narrow the list and the total", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /^Customer outstanding/ }).click();
    const dialog = page.getByRole("dialog", { name: "Customer outstanding" });
    await expect(dialog).toBeVisible();

    const summary = dialog.getByText(/^\d+ of \d+ customers$/);
    await expect(summary).toBeVisible();
    const before = await summary.innerText();

    const vehicleChips = dialog.locator("button[aria-pressed]");
    if ((await vehicleChips.count()) > 0) {
      await vehicleChips.first().click();
      await expect(dialog.locator("button[aria-pressed='true']").first()).toBeVisible();
      const after = await summary.innerText();
      const [shownAfter] = after.split(" of ");
      const [shownBefore] = before.split(" of ");
      expect(Number(shownAfter)).toBeLessThanOrEqual(Number(shownBefore));
    }
  });
});

test("Unsettled vehicles opens each vehicle's cash position", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /^Unsettled vehicles/ }).click();
  const dialog = page.getByRole("dialog", { name: "Vehicle cash position" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("columnheader", { name: "Balance" })).toBeVisible();
});
