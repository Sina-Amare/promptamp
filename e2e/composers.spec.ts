import type { Locator, Page } from '@playwright/test';
import { expect, test, useMockProvider } from './fixtures';

/**
 * Placement, proven against faithful replicas of the real chat UIs the button
 * kept missing (Claude / ChatGPT / Grok shells — see playground/index.html).
 *
 * These are geometric assertions, not vibes: the disc must sit inside the
 * visible composer shell, off the user's text, off every control, and stay
 * glued through page scroll and through the upward growth of a long draft.
 */

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const TOLERANCE = 3;

function within(inner: Box, outer: Box, pad = TOLERANCE): boolean {
  return (
    inner.x >= outer.x - pad &&
    inner.y >= outer.y - pad &&
    inner.x + inner.width <= outer.x + outer.width + pad &&
    inner.y + inner.height <= outer.y + outer.height + pad
  );
}

function intersects(a: Box, b: Box, slack = 2): boolean {
  return (
    a.x + slack < b.x + b.width &&
    b.x + slack < a.x + a.width &&
    a.y + slack < b.y + b.height &&
    b.y + slack < a.y + a.height
  );
}

async function boxOf(locator: Locator): Promise<Box> {
  const box = await locator.boundingBox();
  if (!box) throw new Error(`no box for ${String(locator)}`);
  return box;
}

/** The disc (the 28px visual, not the transparent hit area). */
const disc = (page: Page) => page.locator('.pa-button');

async function fillEditable(
  page: Page,
  testId: string,
  text: string,
  rtl = false,
): Promise<void> {
  const editable = page.getByTestId(testId);
  await editable.click();
  await editable.evaluate(
    (el, args) => {
      el.textContent = args.text;
      if (args.rtl) (el as HTMLElement).setAttribute('dir', 'rtl');
      el.dispatchEvent(new InputEvent('input', { bubbles: true }));
    },
    { text, rtl },
  );
}

/** Every VISIBLE client rect of the text inside the editable — the "never on
 * the user's words" assertion samples against these. Range rects are unclipped
 * (lines scrolled out of an overflow box still report), so each is intersected
 * with the editable's own box first: only painted words count. */
async function textRects(page: Page, testId: string): Promise<Box[]> {
  return page.getByTestId(testId).evaluate((el) => {
    const clip = el.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(el);
    const out: { x: number; y: number; width: number; height: number }[] = [];
    for (const r of range.getClientRects()) {
      const x = Math.max(r.left, clip.left);
      const y = Math.max(r.top, clip.top);
      const right = Math.min(r.right, clip.right);
      const bottom = Math.min(r.bottom, clip.bottom);
      if (right - x > 1 && bottom - y > 1) {
        out.push({ x, y, width: right - x, height: bottom - y });
      }
    }
    return out;
  });
}

async function assertPlacement(
  page: Page,
  shellId: string,
  editableId: string,
): Promise<void> {
  const discBox = await boxOf(disc(page));
  const shellBox = await boxOf(page.getByTestId(shellId));

  // 1. In the box — never outside the visible composer.
  expect(within(discBox, shellBox), 'disc inside the shell').toBe(true);

  // 2. Never on the user's words.
  for (const rect of await textRects(page, editableId)) {
    expect(intersects(discBox, rect), 'disc over text').toBe(false);
  }

  // 3. Never on a control.
  for (const control of await page
    .getByTestId(shellId)
    .locator('button')
    .all()) {
    expect(intersects(discBox, await boxOf(control)), 'disc over control').toBe(
      false,
    );
  }
}

const LONG_RTL = [
  'رو حفظ کرد failure با گایدلاین ها و سابمیشن های قبلی و … چک کن و ببین چجوری میشه',
  'و یک پرامپت مطابق استانداردهای پروژه ساخت.',
  'اولویت اینه که این تله از دست نره و حتما بتونیم از روش ی تسک سابمیت کنیم',
  'اگر اپروالش زیاد احتمالش خوب بود، همون راه را برویم و مستند کنیم.',
].join('\n');

const LONG_LTR =
  'Analyze the project guidelines and previous submissions to determine how to preserve failure cases. '.repeat(
    6,
  );

test.beforeEach(async ({ worker }) => {
  await useMockProvider(worker);
});

const SHOT_DIR =
  'C:/Users/sinaa/AppData/Local/Temp/claude/c--Users-sinaa-Desktop-Personal-Projects-PromptAmp/982636b5-9cc8-43c7-b36d-747f94cb5464/scratchpad/shots';

test('Claude-style shell: long RTL draft, disc in the row, glued on scroll', async ({
  page,
}) => {
  await page.goto('http://localhost:5174/');
  await fillEditable(page, 'claude-editable', LONG_RTL, true);
  await page.getByTestId('claude-editable').click();
  await expect(disc(page)).toBeVisible();
  // Let the resize/placement settle after growth.
  await page.waitForTimeout(300);

  await assertPlacement(page, 'claude-shell', 'claude-editable');

  // Glued through page scroll: same offset relative to the shell, ±3px.
  const before = await boxOf(disc(page));
  const shellBefore = await boxOf(page.getByTestId('claude-shell'));
  await page.mouse.wheel(0, 160);
  await page.waitForTimeout(250);
  const after = await boxOf(disc(page));
  const shellAfter = await boxOf(page.getByTestId('claude-shell'));
  expect(
    Math.abs(after.y - shellAfter.y - (before.y - shellBefore.y)),
  ).toBeLessThanOrEqual(TOLERANCE);
  expect(
    Math.abs(after.x - shellAfter.x - (before.x - shellBefore.x)),
  ).toBeLessThanOrEqual(TOLERANCE);
  await assertPlacement(page, 'claude-shell', 'claude-editable');

  await page
    .getByTestId('claude-shell')
    .screenshot({ path: `${SHOT_DIR}/claude-rtl.png` });
});

test('Claude-style shell: disc stays put while the draft grows upward', async ({
  page,
}) => {
  await page.goto('http://localhost:5174/');
  await fillEditable(page, 'claude-editable', 'short start', false);
  await page.getByTestId('claude-editable').click();
  await expect(disc(page)).toBeVisible();
  await page.waitForTimeout(250);
  const before = await boxOf(disc(page));
  const shellBefore = await boxOf(page.getByTestId('claude-shell'));

  // The draft grows: the text block gets taller, the send row stays the row.
  await fillEditable(page, 'claude-editable', LONG_LTR, false);
  await page.waitForTimeout(350);
  const after = await boxOf(disc(page));
  const shellAfter = await boxOf(page.getByTestId('claude-shell'));

  // Bottom-anchored: measured from the shell's bottom (the send row), the disc
  // must not move as the text block grows — whichever way the box expands.
  const offsetBefore =
    shellBefore.y + shellBefore.height - (before.y + before.height);
  const offsetAfter =
    shellAfter.y + shellAfter.height - (after.y + after.height);
  expect(Math.abs(offsetAfter - offsetBefore)).toBeLessThanOrEqual(6);
  await assertPlacement(page, 'claude-shell', 'claude-editable');
});

test('ChatGPT-style shell: internal scroll on a long draft, disc in the row', async ({
  page,
}) => {
  await page.goto('http://localhost:5174/');
  await fillEditable(page, 'gpt-editable', LONG_LTR, false);
  await page.getByTestId('gpt-editable').click();
  await expect(disc(page)).toBeVisible();
  await page.waitForTimeout(300);

  await assertPlacement(page, 'gpt-shell', 'gpt-editable');
  await page
    .getByTestId('gpt-shell')
    .screenshot({ path: `${SHOT_DIR}/gpt-long.png` });
});

test('ChatGPT-style shell: the panel clears the composer on a long draft', async ({
  page,
}) => {
  await page.goto('http://localhost:5174/');
  await fillEditable(page, 'gpt-editable', LONG_LTR, false);
  await page.getByTestId('gpt-editable').click();
  await expect(disc(page)).toBeVisible();
  await disc(page).click();

  const panel = page.locator('.pa-panel');
  await expect(panel).toBeVisible();
  await expect(page.locator('.pa-body')).not.toBeEmpty();
  await page.waitForTimeout(250);

  const panelBox = await boxOf(panel);
  const shellBox = await boxOf(page.getByTestId('gpt-shell'));
  // A clear gap from the composer — never sitting on it.
  expect(intersects(panelBox, shellBox, 0), 'panel overlaps composer').toBe(
    false,
  );
  // And fully on screen.
  const viewport = page.viewportSize()!;
  expect(panelBox.y).toBeGreaterThanOrEqual(0);
  expect(panelBox.y + panelBox.height).toBeLessThanOrEqual(viewport.height);

  await page.screenshot({ path: `${SHOT_DIR}/gpt-panel.png` });
});

test('Grok-style pill: disc beside the cluster, never over the edge', async ({
  page,
}) => {
  await page.goto('http://localhost:5174/');
  await fillEditable(page, 'grok-editable', 'What do you want to know?');
  await page.getByTestId('grok-editable').click();
  await expect(disc(page)).toBeVisible();
  await page.waitForTimeout(250);

  const discBox = await boxOf(disc(page));
  const shellBox = await boxOf(page.getByTestId('grok-shell'));
  expect(within(discBox, shellBox), 'disc inside the pill').toBe(true);
  for (const control of await page
    .getByTestId('grok-shell')
    .locator('button')
    .all()) {
    expect(intersects(discBox, await boxOf(control))).toBe(false);
  }

  await page
    .getByTestId('grok-shell')
    .screenshot({ path: `${SHOT_DIR}/grok-pill.png` });
});

test('Gemini-style pill: a 24px-tall line still gets the disc, well placed', async ({
  page,
}) => {
  // Ground truth from gemini.google.com: EDITABLE [445x24] in a padded pill.
  // The 40px height gate silently rejected it — the disc never appeared.
  await page.goto('http://localhost:5174/');
  await fillEditable(page, 'gemini-editable', 'یک عکس لینکدین حرفه‌ای بساز');
  await page.getByTestId('gemini-editable').click();
  await expect(disc(page)).toBeVisible();
  await page.waitForTimeout(250);

  const discBox = await boxOf(disc(page));
  const shellBox = await boxOf(page.getByTestId('gemini-shell'));
  expect(within(discBox, shellBox), 'disc inside the pill').toBe(true);
  for (const control of await page
    .getByTestId('gemini-shell')
    .locator('button')
    .all()) {
    expect(intersects(discBox, await boxOf(control))).toBe(false);
  }

  await page
    .getByTestId('gemini-shell')
    .screenshot({ path: `${SHOT_DIR}/gemini-pill.png` });
});
