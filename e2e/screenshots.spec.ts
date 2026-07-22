import type { Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, test, useMockChain } from './fixtures';

/**
 * Store screenshots, generated from the real extension.
 *
 *   pnpm shots
 *
 * Generated rather than mocked up, for one reason: a mockup can promise
 * something the build does not do. These are the actual surfaces, driven
 * through the actual flow, so a listing image cannot drift away from the
 * product without a test noticing.
 *
 * Everything runs against the mock provider, so no key is spent and the text
 * is byte-identical on every run — a listing image that changes on each build
 * is one nobody can review.
 */

// Chrome Web Store accepts 1280×800 or 640×400; 1280×800 is the one to use.
const STORE = { width: 1280, height: 800 };

const outDir = fileURLToPath(new URL('../store/screenshots/', import.meta.url));

const DRAFT = 'tips for a job interview please';

test.beforeAll(async () => {
  await mkdir(outDir, { recursive: true });
});

test.beforeEach(async ({ page, worker }) => {
  await useMockChain(worker, ['mock-1', 'mock-2']);
  await page.setViewportSize(STORE);
});

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `${outDir}${name}.png` });
}

test('01 — the button in a real composer', async ({ page }) => {
  await page.goto('http://localhost:5174/');
  const field = page.getByTestId('plain-textarea');
  await field.fill(DRAFT);
  await field.click();

  await expect(page.locator('.pa-button')).toBeVisible();
  await shot(page, '01-button');
});

test('02 — the preview panel with a diff', async ({ page }) => {
  await page.goto('http://localhost:5174/');
  const field = page.getByTestId('plain-textarea');
  await field.fill(DRAFT);
  await field.click();
  await page.locator('.pa-button').click();

  const panel = page.locator('.pa-panel');
  await expect(panel.locator('.pa-body')).toContainText('Be specific', {
    timeout: 15_000,
  });

  // The diff is the whole argument for the panel existing: nothing is applied
  // until you have seen exactly what changed.
  await panel.getByRole('button', { name: 'Show changes' }).click();
  await shot(page, '02-panel-diff');
});

test('03 — connections and the fallback order', async ({
  page,
  extensionId,
}) => {
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await expect(page.getByRole('heading', { name: 'PromptAmp' })).toBeVisible();
  await expect(page.locator('.badge').first()).toHaveText('Primary');

  await shot(page, '03-connections');
});

test('04 — the privacy claim, as the product states it', async ({
  page,
  extensionId,
}) => {
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await page.getByRole('tab', { name: 'About' }).click();
  await expect(page.locator('.card-title').first()).toHaveText('Privacy');

  await shot(page, '04-privacy');
});

test('05 — profiles', async ({ page, extensionId }) => {
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await page.getByRole('tab', { name: 'Profiles' }).click();
  await expect(page.locator('.list-item').first()).toBeVisible();

  await shot(page, '05-profiles');
});
