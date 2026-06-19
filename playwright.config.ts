import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  retries: 1,
  use: {
    baseURL: "http://localhost:5199",
    headless: true,
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npx vite --config e2e/vite.config.ts --port 5199",
    port: 5199,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
  ],
});
