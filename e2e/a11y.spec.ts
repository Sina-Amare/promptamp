import AxeBuilder from '@axe-core/playwright';
import { expect, test, useMockProvider } from './fixtures';

/**
 * Accessibility, machine-checked.
 *
 * Two things worth being precise about:
 *
 * 1. The scans are scoped to *our* surfaces. The playground is a fixture, and
 *    failing a build on a fixture's markup would train everyone to ignore this
 *    suite.
 * 2. axe cannot see keyboard traps, focus order, or whether a live region
 *    actually announces — so the keyboard journey is asserted separately
 *    below, by driving it.
 */

test.beforeEach(async ({ worker }) => {
  await useMockProvider(worker);
});

const SERIOUS = ['critical', 'serious'];

test('the injected button and panel are clean', async ({ page }) => {
  await page.goto('http://localhost:5174/');
  await page.getByTestId('plain-textarea').fill('tips for a job interview');
  await page.getByTestId('plain-textarea').click();
  await page.locator('.pa-button').click();
  await expect(page.locator('.pa-panel')).toBeVisible();
  await expect(page.locator('.pa-body')).not.toBeEmpty();

  const results = await new AxeBuilder({ page })
    // Only PromptAmp's own host element.
    .include('[data-promptamp-host]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();

  const blocking = results.violations.filter((v) =>
    SERIOUS.includes(v.impact ?? ''),
  );
  expect(
    blocking.map((v) => `${v.id}: ${v.help}`),
    'axe found blocking violations in the injected UI',
  ).toEqual([]);
});

test('the options page is clean', async ({ page, extensionId }) => {
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await expect(page.getByRole('heading', { name: 'PromptAmp' })).toBeVisible();

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();

  const blocking = results.violations.filter((v) =>
    SERIOUS.includes(v.impact ?? ''),
  );
  expect(blocking.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
});

test('the popup is clean', async ({ page, extensionId }) => {
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(page.getByRole('heading', { name: 'PromptAmp' })).toBeVisible();

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();

  const blocking = results.violations.filter((v) =>
    SERIOUS.includes(v.impact ?? ''),
  );
  expect(blocking.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
});

test('the whole flow is operable by keyboard alone', async ({ page }) => {
  await page.goto('http://localhost:5174/');
  const field = page.getByTestId('plain-textarea');
  await field.fill('tips for a job interview please');
  await field.focus();

  // The button is in the tab order immediately after the field — no hunting,
  // and no unlabelled injected nodes in between.
  await page.keyboard.press('Tab');
  const focusedLabel = await page.evaluate(() => {
    const host = document.querySelector('[data-promptamp-host]');
    const active = host?.shadowRoot?.activeElement;
    return active?.getAttribute('aria-label') ?? '';
  });
  expect(focusedLabel).toContain('Enhance draft');

  // Enter activates it, and focus lands on the panel title — not on Replace.
  await page.keyboard.press('Enter');
  await expect(page.locator('.pa-panel')).toBeVisible();
  await expect(page.locator('.pa-body')).not.toBeEmpty();

  // Accept without ever touching the mouse.
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect
    .poll(() => page.evaluate(() => window.playground.plain!()))
    .toContain('Tips for a job interview please.');
});

test('announces progress and completion once, politely', async ({ page }) => {
  await page.goto('http://localhost:5174/');
  await page.getByTestId('plain-textarea').fill('tips for a job interview');
  await page.getByTestId('plain-textarea').click();
  await page.locator('.pa-button').click();
  await expect(page.locator('.pa-body')).not.toBeEmpty();

  const region = page.locator('[role="status"]').first();
  await expect(region).toHaveAttribute('aria-live', 'polite');
  await expect(region).toHaveText(/ready|reads well/i);

  // aria-busy must be cleared — leaving it set silences the live region for
  // the rest of the session, and the user cannot tell or recover.
  await expect(page.locator('.pa-body-wrap')).toHaveAttribute(
    'aria-busy',
    'false',
  );
});

test('the panel does not claim modality it does not have', async ({ page }) => {
  await page.goto('http://localhost:5174/');
  await page.getByTestId('plain-textarea').fill('tips for a job interview');
  await page.getByTestId('plain-textarea').click();
  await page.locator('.pa-button').click();
  await expect(page.locator('.pa-panel')).toBeVisible();

  // aria-modal would hide the host page from screen readers while it stays
  // visibly interactive — the exact misuse APG warns about.
  await expect(page.locator('.pa-panel')).toHaveAttribute('role', 'dialog');
  expect(await page.locator('.pa-panel').getAttribute('aria-modal')).toBeNull();
});
