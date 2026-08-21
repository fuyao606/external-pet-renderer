import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  timeout: 12_000,
  expect: { timeout: 3_000 },
  retries: 0,
  workers: process.env.UI_LOOP_WORKERS ? Number(process.env.UI_LOOP_WORKERS) : 2,
  use: {
    baseURL: process.env.UI_LOOP_BASE_URL || "http://127.0.0.1:3000",
    actionTimeout: 3_000,
    navigationTimeout: 8_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure"
  },
  reporter: [["json", { outputFile: "../.ui-loop/results/playwright-results.json" }], ["list"]]
});
