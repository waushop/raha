import { defineConfig, devices } from "@playwright/test";
import { E2E_DB_PATH, E2E_PORT } from "./e2e/env";

// End-to-end tests against a production build on 127.0.0.1:3199 with its own
// SQLite file in .e2e/ (127.0.0.1, not localhost, so cookies never mix with a
// dev session on localhost:3000). The web server command recreates the
// database before the server starts. Tests share that one database, so they
// run serially and each one uses names unique to its project.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: `http://127.0.0.1:${E2E_PORT}`,
    serviceWorkers: "block",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "phone", use: { ...devices["iPhone 14"], browserName: "chromium" } },
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
  ],
  webServer: {
    command: `npx tsx e2e/prepare.ts && npm run build && npx next start -p ${E2E_PORT} -H 127.0.0.1`,
    url: `http://127.0.0.1:${E2E_PORT}/login`,
    reuseExistingServer: false,
    timeout: 300_000,
    stdout: "pipe",
    env: { DB_PATH: E2E_DB_PATH, NUDGES: "off", NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1" },
  },
});
