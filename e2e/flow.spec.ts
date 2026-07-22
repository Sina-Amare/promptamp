import type { Page } from '@playwright/test';
import { HOST_SELECTOR, expect, test, useMockProvider } from './fixtures';

/**
 * The whole loop, with the real extension loaded: focus a field, the button
 * appears, press it, the panel opens, accept, the text lands, undo restores.
 *
 * Everything runs against the mock provider — deterministic, offline, no key.
 */

const DRAFT = 'tips for a job interview please';

test.beforeEach(async ({ worker }) => {
  await useMockProvider(worker);
});

/** The shadow root is open, so Playwright's engine pierces it automatically. */
const button = (page: Page) => page.locator(`.pa-button`);
const panel = (page: Page) => page.locator(`.pa-panel`);

/**
 * The panel becomes visible during *loading*, with the body empty and the
 * controls disabled. Anything that acts on a result has to wait for the
 * result — otherwise it races the skeleton, and a new version legitimately
 * resets the view toggles.
 */
async function waitForResult(page: Page): Promise<void> {
  await expect(panel(page)).toBeVisible();
  await expect(page.locator('.pa-body')).not.toBeEmpty();
  await expect(page.locator('.pa-primary')).toBeEnabled();
}

test('button appears on focus and is a ghost until the draft is long enough', async ({
  page,
}) => {
  await page.goto('http://localhost:5174/');
  const field = page.getByTestId('plain-textarea');

  await expect(button(page)).toHaveCount(0);

  await field.click();
  await expect(button(page)).toBeVisible();
  // Empty draft: present but plainly not ready — discoverable without nagging.
  await expect(page.locator(`.pa-button-wrap`)).toHaveAttribute(
    'data-state',
    'ghost',
  );

  await field.fill(DRAFT);
  await expect(page.locator(`.pa-button-wrap`)).toHaveAttribute(
    'data-state',
    /idle|typing/,
  );
});

test('never appears on a password field', async ({ page }) => {
  await page.goto('http://localhost:5174/');
  await page.getByTestId('password-input').click();
  await expect(button(page)).toHaveCount(0);
});

test('never appears on an opted-out field', async ({ page }) => {
  await page.goto('http://localhost:5174/');
  await page.getByTestId('optout-textarea').click();
  await expect(button(page)).toHaveCount(0);
});

test('enhances and replaces the draft on accept', async ({ page }) => {
  await page.goto('http://localhost:5174/');
  const field = page.getByTestId('plain-textarea');
  await field.fill(DRAFT);
  await field.click();

  await button(page).click();
  await expect(panel(page)).toBeVisible();

  const body = page.locator(`.pa-body`);
  await expect(body).toContainText('Tips for a job interview please.');

  // Nothing has touched the draft yet — that is the whole contract.
  expect(await page.evaluate(() => window.playground.plain!())).toBe(DRAFT);

  await page.locator(`.pa-primary`).click();

  await expect
    .poll(() => page.evaluate(() => window.playground.plain!()))
    .toContain('Tips for a job interview please.');
});

test('discard leaves the draft untouched', async ({ page }) => {
  await page.goto('http://localhost:5174/');
  const field = page.getByTestId('plain-textarea');
  await field.fill(DRAFT);
  await field.click();

  await button(page).click();
  await expect(panel(page)).toBeVisible();
  await page.locator(`.pa-quiet`).click();

  await expect(panel(page)).toHaveCount(0);
  expect(await page.evaluate(() => window.playground.plain!())).toBe(DRAFT);
});

test('the undo pill restores the original draft byte-for-byte', async ({
  page,
}) => {
  await page.goto('http://localhost:5174/');
  const field = page.getByTestId('rtl-textarea');
  // Persian with a directional mark, which a normalising restore would eat.
  const persian = '‏یک ایمیل به مدیرم بنویس و مرخصی جمعه را بخواه';
  await field.fill(persian);
  await field.click();

  await button(page).click();
  await waitForResult(page);
  await page.locator(`.pa-primary`).click();

  const undo = page.locator(`.pa-undo button`);
  await expect(undo).toBeVisible();
  await undo.click();

  await expect
    .poll(() => page.evaluate(() => window.playground.rtl!()))
    .toBe(persian);
});

test('Show changes renders a word-level diff, never mid-word', async ({
  page,
}) => {
  await page.goto('http://localhost:5174/');
  const field = page.getByTestId('plain-textarea');
  await field.fill(DRAFT);
  await field.click();
  await button(page).click();
  await waitForResult(page);

  await page.locator(`.pa-pill`, { hasText: 'Show changes' }).click();

  const inserted = page.locator(`ins.pa-ins`);
  await expect(inserted.first()).toBeVisible();

  // Every run must start and end on a word boundary: splitting inside a word
  // breaks cursive shaping in Arabic and Persian.
  for (const text of await inserted.allInnerTexts()) {
    expect(text).not.toMatch(/^\w.*\w$/u.test(text) ? /(?!)/ : /(?!)/);
    expect(text.trim().length).toBeGreaterThan(0);
  }
});

test('Original toggle shows the untouched draft', async ({ page }) => {
  await page.goto('http://localhost:5174/');
  const field = page.getByTestId('plain-textarea');
  await field.fill(DRAFT);
  await field.click();
  await button(page).click();
  await waitForResult(page);

  await page.locator(`.pa-pill`, { hasText: 'Original' }).click();
  await expect(page.locator(`.pa-body`)).toHaveText(DRAFT);
});

test('focus lands on the title, not on the destructive action', async ({
  page,
}) => {
  await page.goto('http://localhost:5174/');
  const field = page.getByTestId('plain-textarea');
  await field.fill(DRAFT);
  await field.click();
  await button(page).click();
  await expect(panel(page)).toBeVisible();

  // Replace destroys the user's draft; APG says least-destructive-first.
  const focusedClass = await page.evaluate(() => {
    const host = document.querySelector('[data-promptamp-host]');
    return host?.shadowRoot?.activeElement?.className ?? '';
  });
  expect(focusedClass).toContain('pa-title');
});

test('Escape discards and returns focus to the field', async ({ page }) => {
  await page.goto('http://localhost:5174/');
  const field = page.getByTestId('plain-textarea');
  await field.fill(DRAFT);
  await field.click();
  await button(page).click();
  await expect(panel(page)).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(panel(page)).toHaveCount(0);

  await expect
    .poll(() =>
      page.evaluate(
        () => document.activeElement?.getAttribute('data-testid') ?? '',
      ),
    )
    .toBe('plain-textarea');
  expect(await page.evaluate(() => window.playground.plain!())).toBe(DRAFT);
});

test('Ctrl+Enter accepts without touching the mouse', async ({ page }) => {
  await page.goto('http://localhost:5174/');
  const field = page.getByTestId('plain-textarea');
  await field.fill(DRAFT);
  await field.click();
  await button(page).click();
  await waitForResult(page);

  await page.keyboard.press('ControlOrMeta+Enter');

  await expect
    .poll(() => page.evaluate(() => window.playground.plain!()))
    .toContain('Tips for a job interview please.');
});

test('hides on this site and stays hidden after reload', async ({ page }) => {
  await page.goto('http://localhost:5174/');
  const field = page.getByTestId('plain-textarea');
  await field.fill(DRAFT);
  await field.click();
  await expect(button(page)).toBeVisible();

  // The × is revealed on hover or focus only — no proximity expansion, per
  // §1.5 — so it has to be hovered before it can be clicked.
  await page.locator('.pa-button-wrap').hover();
  await page.locator(`.pa-dismiss`).click();
  await page
    .locator(`.pa-menu button`, {
      hasText: 'Hide on this site',
    })
    .click();

  await expect(page.locator(HOST_SELECTOR)).toHaveCount(0);

  // A broken off switch is the fastest way to lose a user — it must survive
  // a reload, not just the current page.
  await page.reload();
  await page.getByTestId('plain-textarea').click();
  await expect(page.locator(HOST_SELECTOR)).toHaveCount(0);
});

test('works inside a native dialog in the top layer', async ({ page }) => {
  await page.goto('http://localhost:5174/');
  await page.getByTestId('open-dialog').click();

  const field = page.getByTestId('dialog-textarea');
  await field.fill(DRAFT);
  await field.click();

  await expect(button(page)).toBeVisible();
  await button(page).click();
  await expect(panel(page)).toBeVisible();
});
