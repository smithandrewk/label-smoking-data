import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for the bigmac-deployed label app smoke test.
 * Base URL points at the Tailscale hostname; override via PLAYWRIGHT_BASE_URL
 * (e.g. `PLAYWRIGHT_BASE_URL=http://100.126.100.6:5001 npx playwright test`).
 */
export default defineConfig({
  testDir: '.',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://bigmac.tail06507a.ts.net:5001',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ignoreHTTPSErrors: true,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],
});
