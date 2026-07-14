import { defineConfig, devices } from "@playwright/test";

const BASE_URL = "http://localhost:3000";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  timeout: 30_000,
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev",
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 60_000,
  },
  projects: [
    {
      name: "setup",
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        storageState: "tests/e2e/.auth/superadmin.json",
      },
      dependencies: ["setup"],
    },
  ],
});
