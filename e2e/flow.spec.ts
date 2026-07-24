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
  await expect(panel(page)).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.pa-body')).not.toBeEmpty({ timeout: 15_000 });
  await expect(page.locator('.pa-primary')).toBeEnabled({ timeout: 15_000 });
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

test('declines a no-request draft with a gentle note, not a fabricated prompt', async ({
  page,
}) => {
  await page.goto('http://localhost:5174/');
  const field = page.getByTestId('plain-textarea');
  await field.fill('asdfghjkl qwerty [[mock:decline]]');
  await field.click();
  await button(page).click();

  await expect(panel(page)).toBeVisible();
  // A calm note — not a rewrite, and not the red of a real error.
  await expect(page.locator('.pa-decline')).toBeVisible();
  await expect(page.locator('.pa-decline')).toContainText('Nothing to enhance');
  await expect(page.locator('.pa-error')).toHaveCount(0);
  // No Replace: there is nothing to insert into the field.
  await expect(page.locator('.pa-primary')).toBeDisabled();
});

test('typing in the panel never leaks keystrokes to the page', async ({
  page,
}) => {
  await page.goto('http://localhost:5174/');
  const field = page.getByTestId('plain-textarea');
  await field.fill(DRAFT);
  await field.click();
  await button(page).click();
  await waitForResult(page);

  // Count keydowns that reach the page's document (bubble phase) — the phase a
  // host chat composer listens on to write typed characters into its box.
  await page.evaluate(() => {
    const w = window as unknown as { __docKeys: number };
    w.__docKeys = 0;
    document.addEventListener('keydown', () => {
      w.__docKeys += 1;
    });
  });

  const adjust = page.locator('.pa-adjust-input');
  await adjust.click();
  await adjust.pressSequentially('make it shorter');

  // Every keystroke was handled inside the panel; none escaped to the page.
  const leaked = await page.evaluate(
    () => (window as unknown as { __docKeys: number }).__docKeys,
  );
  expect(leaked).toBe(0);
  await expect(adjust).toHaveValue('make it shorter');
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
  await waitForResult(page);

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

test('accepting shows no pill — the done flash is the acknowledgement', async ({
  page,
}) => {
  // The confirmation pill was removed by user verdict (it read as noise);
  // native Ctrl+Z carries undo, which insertion.spec proves stays intact.
  await page.goto('http://localhost:5174/');
  const field = page.getByTestId('plain-textarea');
  await field.fill(DRAFT);
  await field.click();

  await button(page).click();
  await waitForResult(page);
  await page.locator(`.pa-primary`).click();

  await expect
    .poll(() => page.evaluate(() => window.playground.plain!()))
    .toContain('Tips for a job interview');
  await expect(page.locator('.pa-undo')).toHaveCount(0);
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

  const insertedText = (await inserted.allInnerTexts()).join('');
  // A real assertion: the appended sentence is one complete word-level run,
  // never a set of character fragments. Persian/Arabic and emoji grapheme
  // boundaries are covered directly by diff.test.ts.
  expect(insertedText).toContain('Be specific and concise');
  for (const text of await inserted.allInnerTexts()) {
    expect(text.trim().length).toBeGreaterThan(0);
    expect(text).not.toMatch(/^\p{Mark}|\p{Mark}$/u);
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

test('panel edits survive Original/Diff toggles and are what Replace inserts', async ({
  page,
}) => {
  await page.goto('http://localhost:5174/');
  const field = page.getByTestId('plain-textarea');
  await field.fill(DRAFT);
  await field.click();
  await button(page).click();
  await waitForResult(page);

  const edited = 'My carefully edited final prompt.';
  const body = page.locator('.pa-body');
  await body.fill(edited);
  await page.locator('.pa-pill', { hasText: 'Original' }).click();
  await expect(body).toHaveText(DRAFT);
  await page.locator('.pa-pill', { hasText: 'Original' }).click();
  await expect(body).toHaveText(edited);
  await page.locator('.pa-pill', { hasText: 'Show changes' }).click();
  await page.locator('.pa-pill', { hasText: 'Show changes' }).click();
  await expect(body).toHaveText(edited);

  await page.locator('.pa-primary').click();
  await expect
    .poll(() => page.evaluate(() => window.playground.plain!()))
    .toBe(edited);
});

test('an emptied result disables Replace, Copy, and the Replace shortcut', async ({
  page,
}) => {
  await page.goto('http://localhost:5174/');
  const field = page.getByTestId('plain-textarea');
  await field.fill(DRAFT);
  await field.click();
  await button(page).click();
  await waitForResult(page);

  await page.locator('.pa-body').fill('');
  await expect(page.locator('.pa-primary')).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Copy', exact: true }),
  ).toBeDisabled();
  await page.locator('.pa-body').press('ControlOrMeta+Enter');
  expect(await page.evaluate(() => window.playground.plain!())).toBe(DRAFT);
});

test('a narrow viewport keeps the panel on-screen and Replace prominent', async ({
  page,
}) => {
  await page.setViewportSize({ width: 300, height: 520 });
  await page.goto('http://localhost:5174/');
  const field = page.getByTestId('plain-textarea');
  await field.fill(DRAFT);
  await field.click();
  await button(page).click();
  await waitForResult(page);

  const panelBox = await panel(page).boundingBox();
  const replaceBox = await page.locator('.pa-primary').boundingBox();
  const retryBox = await page
    .getByRole('button', { name: 'Retry', exact: true })
    .boundingBox();
  expect(panelBox).not.toBeNull();
  expect(replaceBox).not.toBeNull();
  expect(retryBox).not.toBeNull();
  expect(panelBox!.width).toBeLessThan(320);
  expect(panelBox!.x).toBeGreaterThanOrEqual(0);
  expect(panelBox!.x + panelBox!.width).toBeLessThanOrEqual(300);
  expect(replaceBox!.width).toBeGreaterThan(panelBox!.width * 0.75);
  expect(replaceBox!.y).toBeLessThan(retryBox!.y);
});

test('Stop discards partial output and an immediate new run starts cleanly', async ({
  page,
}) => {
  await page.goto('http://localhost:5174/');
  const field = page.getByTestId('plain-textarea');
  const slowDraft = `${DRAFT} [[mock:slow:5000]]`;
  await field.fill(slowDraft);
  await field.click();
  await button(page).click();
  await expect(panel(page)).toBeVisible();

  // The disc itself becomes Stop while the request owns the Port.
  await button(page).click();
  await expect(panel(page)).toHaveCount(0);
  await expect(field).toBeFocused();
  expect(await page.evaluate(() => window.playground.plain!())).toBe(slowDraft);

  await field.fill(DRAFT);
  await button(page).click();
  await waitForResult(page);
  await expect(page.locator('.pa-body')).toContainText(
    'Tips for a job interview',
  );
  await expect(page.locator('.pa-body')).not.toContainText('[[mock:slow');
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

test('hiding from a cross-origin composer closes every frame in the site', async ({
  page,
}) => {
  const mountFrame = async (): Promise<void> => {
    await page.evaluate(() => {
      const frame = document.createElement('iframe');
      frame.src = 'http://127.0.0.1:5174/iframe.html';
      frame.dataset.testid = 'cross-origin-composer-frame';
      frame.style.cssText = 'width:700px;height:260px';
      document.body.append(frame);
    });
  };

  await page.goto('http://localhost:5174/');
  await mountFrame();
  const frame = page.frameLocator(
    '[data-testid="cross-origin-composer-frame"]',
  );
  const field = frame.getByTestId('iframe-composer');
  await field.fill('Hide PromptAmp for this entire top-level site.');
  await field.click();
  await expect(frame.locator('.pa-button')).toBeVisible();

  await frame.locator('.pa-button-wrap').hover();
  await frame.locator('.pa-dismiss').click();
  await frame
    .locator('.pa-menu button', { hasText: 'Hide on this site' })
    .click();

  // The iframe that originated the action and the independent top-frame
  // instance disappear together. Focusing another field cannot resurrect it.
  await expect(frame.locator(HOST_SELECTOR)).toHaveCount(0);
  await expect(page.locator(HOST_SELECTOR)).toHaveCount(0);
  await page.getByTestId('plain-textarea').click();
  await expect(page.locator('.pa-button')).toHaveCount(0);

  // The iframe stores the top-level site's origin, not its own 127.0.0.1
  // origin, so both frames remain suppressed on the next load.
  await page.reload();
  await mountFrame();
  const reloadedFrame = page.frameLocator(
    '[data-testid="cross-origin-composer-frame"]',
  );
  await reloadedFrame.getByTestId('iframe-composer').click();
  await expect(page.locator(HOST_SELECTOR)).toHaveCount(0);
  await expect(reloadedFrame.locator(HOST_SELECTOR)).toHaveCount(0);
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
