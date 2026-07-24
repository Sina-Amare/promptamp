import type { Locator, Page } from '@playwright/test';
import { expect, test, useMockProvider } from './fixtures';

/**
 * Placement, proven against faithful replicas of the real chat UIs the button
 * kept missing (Claude / ChatGPT / Grok shells — see playground/index.html).
 *
 * These are geometric assertions, not vibes: the complete affordance must dock
 * immediately outside the visible composer shell, off the user's text and
 * every control, and stay glued through scroll and upward draft growth.
 */

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const TOLERANCE = 3;

function intersects(a: Box, b: Box, slack = 2): boolean {
  return (
    a.x + slack < b.x + b.width &&
    b.x + slack < a.x + a.width &&
    a.y + slack < b.y + b.height &&
    b.y + slack < a.y + a.height
  );
}

function dockSide(
  target: Box,
  shell: Box,
  tolerance = TOLERANCE,
): 'right' | 'left' | 'above' | 'below' | null {
  const targetRight = target.x + target.width;
  const targetBottom = target.y + target.height;
  const shellRight = shell.x + shell.width;
  const shellBottom = shell.y + shell.height;
  const verticalFit =
    target.y >= shell.y - tolerance && targetBottom <= shellBottom + tolerance;
  const horizontalFit =
    target.x >= shell.x - tolerance && targetRight <= shellRight + tolerance;

  if (Math.abs(target.x - shellRight) <= tolerance && verticalFit)
    return 'right';
  if (Math.abs(targetRight - shell.x) <= tolerance && verticalFit)
    return 'left';
  if (Math.abs(targetBottom - shell.y) <= tolerance && horizontalFit)
    return 'above';
  if (Math.abs(target.y - shellBottom) <= tolerance && horizontalFit)
    return 'below';
  return null;
}

async function boxOf(locator: Locator): Promise<Box> {
  const box = await locator.boundingBox();
  if (!box) throw new Error(`no box for ${String(locator)}`);
  return box;
}

/** The visible affordance, distinct from its transparent 40px hit area. */
const disc = (page: Page) => page.locator('.pa-button');
const hitbox = (page: Page) => page.locator('.pa-button-wrap');

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
    let clip = el.getBoundingClientRect();
    let ancestor = el.parentElement;
    while (ancestor) {
      const style = getComputedStyle(ancestor);
      if (
        /(auto|scroll|hidden|clip)/.test(
          `${style.overflow}${style.overflowX}${style.overflowY}`,
        )
      ) {
        const rect = ancestor.getBoundingClientRect();
        const left = Math.max(clip.left, rect.left);
        const top = Math.max(clip.top, rect.top);
        const right = Math.min(clip.right, rect.right);
        const bottom = Math.min(clip.bottom, rect.bottom);
        clip = {
          ...clip,
          left,
          top,
          right,
          bottom,
          x: left,
          y: top,
          width: Math.max(0, right - left),
          height: Math.max(0, bottom - top),
        };
      }
      ancestor = ancestor.parentElement;
    }
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
  const discBox = await boxOf(hitbox(page));
  const shellBox = await boxOf(page.getByTestId(shellId));

  // 1. The complete 40px target is outside and attached to the shell.
  expect(intersects(discBox, shellBox, 0), 'hit target enters the shell').toBe(
    false,
  );
  expect(
    dockSide(discBox, shellBox),
    'hit target detached from shell',
  ).not.toBe(null);
  await expect(hitbox(page)).toHaveAttribute('data-placement', 'outside');

  // 2. Never on the user's words.
  for (const rect of await textRects(page, editableId)) {
    expect(intersects(discBox, rect), 'hit target over text').toBe(false);
  }

  // 3. Never on a control.
  for (const control of await page
    .getByTestId(shellId)
    .locator('button')
    .all()) {
    expect(
      intersects(discBox, await boxOf(control)),
      'hit target over control',
    ).toBe(false);
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

test('an empty tall composer uses the universal outside dock', async ({
  page,
}) => {
  await page.goto('http://localhost:5174/');
  await page.getByTestId('claude-editable').click();
  const wrap = hitbox(page);
  await expect(wrap).toBeVisible();
  await page.waitForTimeout(200);

  const target = await boxOf(wrap);
  const shell = await boxOf(page.getByTestId('claude-shell'));
  expect(intersects(target, shell, 0), 'target enters empty composer').toBe(
    false,
  );
  expect(dockSide(target, shell), 'target detached from composer').not.toBe(
    null,
  );
  await expect(wrap).toHaveAttribute('data-placement', 'outside');
  for (const control of await page
    .getByTestId('claude-shell')
    .locator('button')
    .all()) {
    expect(intersects(target, await boxOf(control))).toBe(false);
  }
});

test('Claude-style shell: long RTL draft, outside dock glued on scroll', async ({
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

test('ChatGPT-style shell: internal scroll with a stable outside dock', async ({
  page,
}) => {
  await page.goto('http://localhost:5174/');
  await fillEditable(page, 'gpt-editable', LONG_LTR, false);
  await page.getByTestId('gpt-editable').click();
  await expect(disc(page)).toBeVisible();
  await page.waitForTimeout(300);

  const fieldBox = await boxOf(page.getByTestId('gpt-editable'));
  const shellBefore = await boxOf(page.getByTestId('gpt-shell'));
  expect(fieldBox.y + fieldBox.height).toBeGreaterThan(
    shellBefore.y + shellBefore.height + 40,
  );
  await assertPlacement(page, 'gpt-shell', 'gpt-editable');

  const before = await boxOf(hitbox(page));
  await page
    .getByTestId('gpt-shell')
    .locator('.gpt-text-viewport')
    .evaluate((viewport) => {
      viewport.scrollTop = 160;
      viewport.dispatchEvent(new Event('scroll'));
    });
  await page.waitForTimeout(250);
  const after = await boxOf(hitbox(page));
  const shellAfter = await boxOf(page.getByTestId('gpt-shell'));
  expect(
    Math.abs(after.y - shellAfter.y - (before.y - shellBefore.y)),
  ).toBeLessThanOrEqual(TOLERANCE);
  expect(
    Math.abs(after.x - shellAfter.x - (before.x - shellBefore.x)),
  ).toBeLessThanOrEqual(TOLERANCE);
  await assertPlacement(page, 'gpt-shell', 'gpt-editable');
});

test('ChatGPT-style shell: the panel clears the composer on a long draft', async ({
  page,
}) => {
  // This test asserts a complete gap, so give the tall regression composer
  // enough room for the full panel on one side.
  await page.setViewportSize({ width: 1_280, height: 900 });
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
});

test('Grok-style pill: universal dock stays outside the composer', async ({
  page,
}) => {
  await page.goto('http://localhost:5174/');
  await fillEditable(page, 'grok-editable', 'What do you want to know?');
  await page.getByTestId('grok-editable').click();
  await expect(disc(page)).toBeVisible();
  await page.waitForTimeout(250);

  const targetBox = await boxOf(hitbox(page));
  const shellBox = await boxOf(page.getByTestId('grok-shell'));
  expect(intersects(targetBox, shellBox, 0)).toBe(false);
  expect(dockSide(targetBox, shellBox)).not.toBeNull();
  await expect(hitbox(page)).toHaveAttribute('data-placement', 'outside');
  for (const control of await page
    .getByTestId('grok-shell')
    .locator('button')
    .all()) {
    expect(intersects(targetBox, await boxOf(control))).toBe(false);
  }
});

test('Gemini-style pill: a 24px-tall line gets the same outside dock', async ({
  page,
}) => {
  // Ground truth from gemini.google.com: EDITABLE [445x24] in a padded pill.
  // The 40px height gate silently rejected it — the disc never appeared.
  await page.goto('http://localhost:5174/');
  await fillEditable(page, 'gemini-editable', 'یک عکس لینکدین حرفه‌ای بساز');
  await page.getByTestId('gemini-editable').click();
  await expect(disc(page)).toBeVisible();
  await page.waitForTimeout(250);

  const targetBox = await boxOf(hitbox(page));
  const shellBox = await boxOf(page.getByTestId('gemini-shell'));
  expect(intersects(targetBox, shellBox, 0)).toBe(false);
  expect(dockSide(targetBox, shellBox)).not.toBeNull();
  await expect(hitbox(page)).toHaveAttribute('data-placement', 'outside');
  for (const control of await page
    .getByTestId('gemini-shell')
    .locator('button')
    .all()) {
    expect(intersects(targetBox, await boxOf(control))).toBe(false);
  }
});

test('Gemini hydration: adopts the replaced editor and vacates a late Pro control', async ({
  page,
}) => {
  await page.goto('http://localhost:5174/');
  await fillEditable(page, 'gemini-editable', 'Plan a focused launch brief.');
  await expect(hitbox(page)).toBeVisible();
  await page.waitForTimeout(200);
  const initial = await boxOf(hitbox(page));

  // Turn the current automatic slot into a real persisted manual pin. The live
  // failure only occurred on this path: automatic placement moved safely, but
  // a saved pin was allowed to ignore the late Pro control.
  await page.mouse.move(initial.x + 20, initial.y + 20);
  await page.mouse.down();
  await page.mouse.move(initial.x + 32, initial.y + 20);
  await page.mouse.move(initial.x + 20, initial.y + 20);
  await page.mouse.up();
  await page.waitForTimeout(150);
  const occupied = await boxOf(hitbox(page));
  expect(Math.abs(occupied.x - initial.x)).toBeLessThanOrEqual(TOLERANCE);
  expect(Math.abs(occupied.y - initial.y)).toBeLessThanOrEqual(TOLERANCE);

  // Faithful to Gemini's hydration race: replace the rich-textarea host first,
  // then populate its shadow tree in a later task without restoring focus.
  await page.getByTestId('gemini-shell').evaluate((shell) => {
    const oldHost = shell.querySelector<HTMLElement>(
      '[data-testid="gemini-host"]',
    )!;
    const replacement = document.createElement('rich-textarea');
    replacement.className = oldHost.className;
    replacement.dataset.testid = 'gemini-host';
    oldHost.replaceWith(replacement);
  });
  await page.waitForTimeout(150);
  await page.getByTestId('gemini-host').evaluate((host) => {
    const shadow = host.attachShadow({ mode: 'open' });
    const editor = document.createElement('div');
    editor.className = 'ql-editor textarea gemini-line';
    editor.dataset.testid = 'gemini-editable';
    editor.contentEditable = 'true';
    editor.setAttribute('role', 'textbox');
    editor.setAttribute('aria-labelledby', 'gemini-label');
    editor.style.cssText =
      'display:block;width:100%;height:24px;line-height:24px;outline:none;white-space:nowrap;overflow:hidden;font:inherit;color:inherit;';
    editor.textContent = 'Plan a focused launch brief.';
    shadow.append(editor);
  });
  await page.waitForTimeout(150);

  // The Pro picker arrives in the light DOM after the shadow editor has been
  // adopted, directly over the slot that was free during the first render.
  await page.getByTestId('gemini-shell').evaluate((shell, oldSlot) => {
    const pro = document.createElement('bard-mode-switcher');
    pro.className = 'chat-model';
    pro.dataset.testid = 'gemini-pro';
    pro.setAttribute('jsaction', 'click:selectMode');
    pro.textContent = 'Pro ▾';
    Object.assign(pro.style, {
      position: 'fixed',
      zIndex: '2',
      cursor: 'pointer',
      left: `${String(oldSlot.x)}px`,
      top: `${String(oldSlot.y)}px`,
      width: `${String(Math.max(64, oldSlot.width))}px`,
      height: `${String(oldSlot.height)}px`,
    });
    shell.insertBefore(pro, shell.querySelector('[data-testid="gemini-mic"]'));
  }, occupied);

  await expect(page.getByTestId('gemini-editable')).toBeVisible();
  await expect(hitbox(page)).toBeVisible();
  await expect(hitbox(page)).toHaveCount(1);
  await page.waitForTimeout(250);

  const current = await boxOf(hitbox(page));
  const pro = await boxOf(page.getByTestId('gemini-pro'));
  expect(intersects(current, pro), 'PromptAmp remains under late Pro').toBe(
    false,
  );
  expect(
    Math.hypot(current.x - occupied.x, current.y - occupied.y),
    'PromptAmp did not vacate the occupied slot',
  ).toBeGreaterThan(TOLERANCE);
});

test('the universal launcher is a composer-attached tab, not a floating disc', async ({
  page,
}) => {
  await page.goto('http://localhost:5174/');
  const field = page.getByTestId('plain-textarea');
  await field.fill(
    'A filled bare textarea has no safe internal action row for an overlay.',
  );
  await field.click();
  const wrap = hitbox(page);
  await expect(wrap).toBeVisible();
  await expect(wrap).toHaveAttribute('data-placement', 'outside');
  const side = await wrap.getAttribute('data-side');
  expect(side).toMatch(/^(right|left|above|below)$/);

  const fieldBox = await boxOf(field);
  const wrapBox = await boxOf(wrap);
  const visualBox = await boxOf(disc(page));
  if (side === 'right') {
    expect(
      Math.abs(wrapBox.x - (fieldBox.x + fieldBox.width)),
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(visualBox.x - (fieldBox.x + fieldBox.width)),
    ).toBeLessThanOrEqual(1);
  } else if (side === 'left') {
    expect(
      Math.abs(wrapBox.x + wrapBox.width - fieldBox.x),
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(visualBox.x + visualBox.width - fieldBox.x),
    ).toBeLessThanOrEqual(1);
  } else if (side === 'above') {
    expect(
      Math.abs(wrapBox.y + wrapBox.height - fieldBox.y),
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(visualBox.y + visualBox.height - fieldBox.y),
    ).toBeLessThanOrEqual(1);
  } else {
    expect(
      Math.abs(wrapBox.y - (fieldBox.y + fieldBox.height)),
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(visualBox.y - (fieldBox.y + fieldBox.height)),
    ).toBeLessThanOrEqual(1);
  }

  const radii = await disc(page).evaluate((button) => {
    const style = getComputedStyle(button);
    return [
      style.borderTopLeftRadius,
      style.borderTopRightRadius,
      style.borderBottomRightRadius,
      style.borderBottomLeftRadius,
    ];
  });
  expect(radii).toContain('0px');
});

test('a detached legacy pin is retired and reprojected beside the composer', async ({
  page,
  worker,
}) => {
  await worker.evaluate(async () => {
    const api = (
      globalThis as unknown as {
        chrome: {
          storage: {
            local: {
              get: (key: string) => Promise<Record<string, unknown>>;
              set: (items: unknown) => Promise<void>;
            };
          };
        };
      }
    ).chrome;
    await api.storage.local.set({
      siteRules: {
        'http://localhost:5174': {
          hidden: false,
          pinnedProfileId: null,
          buttonCorner: 'bottom-end',
          buttonPin: { dx: -2_000, dy: -2_000 },
        },
      },
      siteRules$: { v: 1 },
    });
  });

  await page.goto('http://localhost:5174/');
  await fillEditable(page, 'claude-editable', 'Retire this old placement pin.');
  const wrap = hitbox(page);
  await expect(wrap).toBeVisible();
  await assertPlacement(page, 'claude-shell', 'claude-editable');
  await expect
    .poll(() =>
      worker.evaluate(async () => {
        const api = (
          globalThis as unknown as {
            chrome: {
              storage: {
                local: {
                  get: (key: string) => Promise<Record<string, unknown>>;
                };
              };
            };
          }
        ).chrome;
        const stored = await api.storage.local.get('siteRules');
        const rules = stored.siteRules as Record<
          string,
          { buttonPin?: unknown }
        >;
        return rules['http://localhost:5174']?.buttonPin;
      }),
    )
    .toBeNull();
});

test('the dismiss menu flips above the viewport edge and has Cancel', async ({
  page,
}) => {
  await page.goto('http://localhost:5174/');
  const field = page.getByTestId('plain-textarea');
  await field.evaluate((element) => {
    Object.assign(element.style, {
      position: 'fixed',
      right: '80px',
      bottom: '8px',
      width: '520px',
      height: '120px',
      zIndex: '10',
    });
  });
  await field.fill('Keep every dismissal choice visible near the screen edge.');
  await field.click();

  const wrap = hitbox(page);
  await expect(wrap).toBeVisible();
  await wrap.hover();
  await page.locator('.pa-dismiss').click();
  const menu = page.locator('.pa-menu');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Cancel' })).toBeVisible();

  const menuBox = await boxOf(menu);
  const viewport = page.viewportSize()!;
  expect(menuBox.y).toBeGreaterThanOrEqual(8);
  expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(viewport.height - 8);
  await menu.getByRole('menuitem', { name: 'Cancel' }).click();
  await expect(menu).toHaveCount(0);
  await expect(wrap).toBeVisible();
});

test('a dragged external pin stays where dropped, survives reload, clamps on resize, and can be reset', async ({
  page,
}) => {
  await page.goto('http://localhost:5174/');
  await fillEditable(page, 'grok-editable', 'Plan a concise product launch.');
  await page.getByTestId('grok-editable').click();
  const wrap = page.locator('.pa-button-wrap');
  await expect(wrap).toBeVisible();
  const start = await boxOf(wrap);
  const shellAtDrag = await boxOf(page.getByTestId('grok-shell'));
  const intended = {
    x: shellAtDrag.x + 80,
    y: shellAtDrag.y - 56,
  };

  await page.mouse.move(start.x + 20, start.y + 20);
  await page.mouse.down();
  await page.mouse.move(intended.x + 20, intended.y + 20, { steps: 8 });
  // Cross the tracker's one-second safety poll while the pointer is still
  // down. Layout tracking must not snap an active drag back to its old slot.
  await page.waitForTimeout(1_150);
  const duringDrag = await boxOf(wrap);
  expect(Math.abs(duringDrag.x - intended.x)).toBeLessThanOrEqual(TOLERANCE);
  expect(Math.abs(duringDrag.y - intended.y)).toBeLessThanOrEqual(TOLERANCE);
  await page.mouse.up();
  await page.waitForTimeout(200);

  const dragged = await boxOf(wrap);
  expect(
    Math.abs(dragged.x - intended.x),
    `settled slot: ${String(await wrap.getAttribute('data-slot'))}`,
  ).toBeLessThanOrEqual(TOLERANCE);
  expect(Math.abs(dragged.y - intended.y)).toBeLessThanOrEqual(TOLERANCE);
  const shellBeforeReload = await boxOf(page.getByTestId('grok-shell'));
  const draggedOffset = {
    x: dragged.x - shellBeforeReload.x,
    y: dragged.y - shellBeforeReload.y,
  };
  await page.waitForTimeout(250);

  await page.reload();
  await fillEditable(page, 'grok-editable', 'Plan a concise product launch.');
  await expect(wrap).toBeVisible();
  await page.waitForTimeout(200);
  const restored = await boxOf(wrap);
  const restoredShell = await boxOf(page.getByTestId('grok-shell'));
  expect(
    Math.abs(restored.x - restoredShell.x - draggedOffset.x),
  ).toBeLessThanOrEqual(TOLERANCE);
  expect(
    Math.abs(restored.y - restoredShell.y - draggedOffset.y),
  ).toBeLessThanOrEqual(TOLERANCE);

  await page.setViewportSize({ width: 760, height: 620 });
  await page.waitForTimeout(250);
  const resized = await boxOf(wrap);
  expect(resized.x).toBeGreaterThanOrEqual(0);
  expect(resized.y).toBeGreaterThanOrEqual(0);
  expect(resized.x + resized.width).toBeLessThanOrEqual(760);
  expect(resized.y + resized.height).toBeLessThanOrEqual(620);

  await wrap.hover();
  await page.locator('.pa-dismiss').click();
  const reset = page.getByRole('menuitem', { name: 'Reset icon position' });
  await expect(reset).toBeVisible();
  await reset.click();

  await wrap.hover();
  await page.locator('.pa-dismiss').click();
  await expect(
    page.getByRole('menuitem', { name: 'Reset icon position' }),
  ).toHaveCount(0);
  await assertPlacement(page, 'grok-shell', 'grok-editable');
});
