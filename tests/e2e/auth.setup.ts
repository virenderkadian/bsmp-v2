import { test as setup } from "@playwright/test";
import { TEST_CITY_ID, TEST_SUPERADMIN } from "./fixtures";

const authFile = "tests/e2e/.auth/superadmin.json";

// Runs once before the rest of the suite (see playwright.config.ts's
// "setup" project + dependency). Logs in as the seeded dev superadmin and
// pins the active city, so every other test starts already authenticated
// and scoped to the city that actually has test fixture data (routes,
// customers, sequences) rather than whichever city happens to sort first.
setup("authenticate", async ({ page, context }) => {
  await page.goto("/login");
  await page.fill('input[type="email"]', TEST_SUPERADMIN.email);
  await page.fill('input[type="password"]', TEST_SUPERADMIN.password);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.includes("/login"));

  await context.addCookies([
    { name: "active-city-id", value: TEST_CITY_ID, domain: "localhost", path: "/" },
  ]);

  await page.context().storageState({ path: authFile });
});
