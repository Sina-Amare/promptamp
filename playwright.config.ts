import { defineConfig } from '@playwright/test';

/**
 * E2E runs against a *built* extension loaded into a persistent Chromium
 * context (MV3 extensions cannot be loaded any other way), driving the local
 * `playground/` page. No network: the mock provider serves every response.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // one persistent browser context, shared extension state
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL: 'http://localhost:5174',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  // The playground is a *host page*, so it is served by plain Vite rather than
  // going through WXT — it has to look like any other site on the web.
  webServer: {
    command: 'pnpm exec vite --config playground/vite.config.ts',
    url: 'http://localhost:5174',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
