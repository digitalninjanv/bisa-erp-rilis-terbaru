import { defineConfig, devices } from "@playwright/test";

// E2E gate: runs against the production build (`pnpm build` first, the
// webServer below only starts `pnpm start`) and the local dev database
// seeded with the demo company. Specs live in e2e/ — vitest only scans
// tests/**, so the two suites stay separate.
//
// AUD-003: set BISA_E2E_RESEED=1 for official gate runs — global setup
// then reseeds the demo company to the canonical baseline first, so an
// e2e run right after the full vitest suite (which mutates demo data)
// starts from the same state every time. Off by default; see
// e2e/global-setup.ts.
export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // Lingkungan tanpa browser unduhan Playwright dapat memakai Chrome
    // sistem lewat PLAYWRIGHT_CHROME_PATH=/usr/bin/google-chrome.
    ...(process.env.PLAYWRIGHT_CHROME_PATH
      ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROME_PATH } }
      : {}),
  },
  projects: [
    { name: "setup", testMatch: /.*\.setup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], storageState: "e2e/.auth/user.json" },
      dependencies: ["setup"],
    },
  ],
  webServer: {
    command: "pnpm start",
    url: "http://localhost:3000/login",
    reuseExistingServer: false,
    timeout: 120_000,
    // FIX-ARS Tahap 1 (ARS4-03): the e2e harness deliberately serves
    // the production build on localhost, which env validation would
    // otherwise (correctly) reject as a production misconfiguration.
    // This flag is the explicit, logged operator acknowledgement for
    // that harness only — never set it on a real deployment.
    env: {
      BISA_ALLOW_LOCALHOST_AUTH_URL: "1",
      // Standalone Next binds to the machine hostname by default; pin it
      // to loopback so the baseURL health check and Playwright reach it.
      HOSTNAME: "127.0.0.1",
      PORT: "3000",
    },
  },
});
