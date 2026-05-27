import { defineConfig, devices } from "@playwright/test";

// The plugin's own e2e suite. It runs against a kserp host that has this plugin
// loaded (KSERP_PLUGINS=. ) — the CI workflow starts that host and sets
// PLAYWRIGHT_BASE_URL; locally it defaults to the dev server on :4000.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  // The host runs vinxi dev; on the CI box (2 cores, now also carrying the
  // spawned plugin process) the FIRST navigation to a plugin page compiles the
  // catch-all route cold AND then loads the plugin's remote bundle over the
  // proxy — several async hops that easily outlast the default 5s assertion
  // timeout. (wait-on only fetches the SPA shell; it can't warm the client
  // route compile.) Generous timeouts absorb that cold path on CI.
  timeout: 90_000,
  expect: { timeout: 30_000 },
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://localhost:4000",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
