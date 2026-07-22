import type { Page } from '@playwright/test';
import { HOST_SELECTOR, expect, test, useMockChain } from './fixtures';

/**
 * The Persian interface, in a real browser.
 *
 * Unit tests prove the catalogue is complete; only a rendered page proves the
 * chrome actually mirrors, that the setting reaches the injected UI on a third-
 * party page, and that a right-to-left panel still lays an English draft out
 * left-to-right.
 */

async function usePersian(page: Page, extensionId: string): Promise<void> {
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await page.getByRole('tab', { name: 'Behavior' }).click();
  await page
    .locator('select')
    .filter({ has: page.locator('option[value="fa"]') })
    .selectOption('fa');
}

test('switches the settings page to Persian without a reload', async ({
  page,
  extensionId,
}) => {
  await usePersian(page, extensionId);

  // A language setting that needs a reload makes the user doubt it worked.
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('html')).toHaveAttribute('lang', 'fa');
  await expect(page.getByRole('tab', { name: 'رفتار' })).toBeVisible();
});

test('keeps the choice after a reload', async ({ page, extensionId }) => {
  await usePersian(page, extensionId);
  await page.reload();

  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('tab', { name: 'سرویس‌ها' })).toBeVisible();
});

test('mirrors the injected chrome on a third-party page', async ({
  page,
  extensionId,
  worker,
}) => {
  await useMockChain(worker, ['mock-1']);
  await usePersian(page, extensionId);

  // The user's language, not the page's: an English site still gets a
  // right-to-left PromptAmp for a Persian user.
  await page.goto('http://localhost:5174/');
  const field = page.getByTestId('plain-textarea');
  await field.fill('یک ایمیل به مدیرم بنویس و مرخصی جمعه را درخواست کن');
  await field.click();

  await expect(page.locator(HOST_SELECTOR)).toHaveAttribute('lang', 'fa');
  await expect(page.locator('.pa-button-wrap')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('.pa-button')).toBeVisible();
});

test('keeps the button on screen in a right-to-left interface', async ({
  page,
  extensionId,
  worker,
}) => {
  await useMockChain(worker, ['mock-1']);
  await usePersian(page, extensionId);

  await page.goto('http://localhost:5174/');
  const field = page.getByTestId('plain-textarea');
  await field.fill('tips for a job interview please');
  await field.click();

  // Regression guard. The positioning layer is a physical coordinate frame:
  // when it inherited an rtl direction, every surface's static origin moved to
  // the right edge and the same translate put the button a full viewport width
  // off-screen, where it still rendered and was findable but could never be
  // clicked.
  const button = page.locator('.pa-button');
  await expect(button).toBeVisible();

  const box = await button.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width);

  await button.click();

  const panel = page.locator('.pa-panel');
  await expect(panel.locator('.pa-title')).toHaveText('پرامپت بهینه‌شده', {
    timeout: 15_000,
  });
  await expect(panel).toHaveAttribute('dir', 'rtl');

  // Chrome is RTL; the draft is dir="auto", so an English rewrite inside a
  // Persian interface still reads left to right.
  const body = panel.locator('.pa-body');
  await expect(body).toHaveAttribute('dir', 'auto');
  await expect(body).toContainText('Be specific', { timeout: 15_000 });
  expect(await body.evaluate((node) => getComputedStyle(node).direction)).toBe(
    'ltr',
  );
});

test('renders counts in Persian digits', async ({ page, extensionId }) => {
  await usePersian(page, extensionId);
  await page.getByRole('tab', { name: 'سرویس‌ها' }).click();

  const adder = page
    .locator('.card')
    .filter({ has: page.locator('.card-title', { hasText: 'افزودن اتصال' }) });
  await adder.getByRole('button', { name: 'افزودن اتصال' }).click();
  await adder.getByRole('button', { name: 'افزودن اتصال' }).click();

  // Latin digits inside Persian text is the tell of a machine translation.
  await expect(page.locator('.badge', { hasText: 'جایگزین' })).toHaveText(
    'جایگزین ۱',
  );
});
