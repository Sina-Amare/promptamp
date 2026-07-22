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
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
