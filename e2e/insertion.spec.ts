import { expect, test } from '@playwright/test';

/**
 * The real acceptance test for the insertion engine: the actual engine, driven
 * against actual ProseMirror-class editors, in a real browser.
 *
 * The unit suite can only cover classification and ladder logic — happy-dom
 * has no `execCommand`, no working `innerText` line handling and no real
 * selection model. Everything that matters about insertion is verified here.
 *
 * Each assertion reads the editor's **own model** (React state, Quill's
 * getText, CodeMirror's EditorState) rather than scraped DOM text. That
 * distinction is the entire point: a naive write updates the DOM and leaves the
 * model stale, and only a model read catches it.
 */

const DRAFT = 'Explain TCP handshakes to a junior developer, with an analogy.';
const PERSIAN =
  'یک ایمیل کوتاه و مودبانه به مدیرم بنویس و مرخصی جمعه را بخواه.';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('plain-textarea')).toBeVisible();
  // React and CodeMirror mount asynchronously.
  await page.waitForFunction(
    () =>
      typeof window.promptampInsert === 'function' &&
      !!window.playground.codemirror,
  );
});

interface Target {
  name: string;
  testId: string;
  reader: string;
  expectedTier: string;
}

const TARGETS: Target[] = [
  {
    name: 'plain textarea',
    testId: 'plain-textarea',
    reader: 'plain',
    expectedTier: 'exec-command',
  },
  {
    name: 'RTL textarea',
    testId: 'rtl-textarea',
    reader: 'rtl',
    expectedTier: 'exec-command',
  },
  {
    name: 'React controlled textarea',
    testId: 'react-textarea',
    reader: 'react',
    expectedTier: 'exec-command',
  },
  {
    name: 'plain contenteditable',
    testId: 'plain-contenteditable',
    reader: 'contenteditable',
    expectedTier: 'contenteditable',
  },
  {
    name: 'Quill',
    testId: 'quill-host',
    reader: 'quill',
    expectedTier: 'contenteditable',
  },
  {
    name: 'Lexical',
    testId: 'lexical-host',
    reader: 'lexical',
    expectedTier: 'paste-simulation',
  },
  {
    name: 'CodeMirror 6',
    testId: 'codemirror-host',
    reader: 'codemirror',
    expectedTier: 'main-world',
  },
  {
    name: 'textarea in a shadow root',
    testId: 'shadow-host',
    reader: 'shadow',
    expectedTier: 'exec-command',
  },
];

for (const target of TARGETS) {
  test(`inserts into ${target.name} and the editor's own model sees it`, async ({
    page,
  }) => {
    const outcome = await page.evaluate(
      ([testId, text]) => window.promptampInsert(testId, text),
      [target.testId, DRAFT] as const,
    );

    expect(outcome.ok).toBe(true);

    // The model read — not the DOM. A stale model here is the bug the whole
    // insertion layer exists to prevent.
    const model = await page.evaluate(
      (reader) => window.playground[reader]!(),
      target.reader,
    );
    expect(model.trim()).toBe(DRAFT);
  });

  test(`reaches ${target.name} at the expected tier`, async ({ page }) => {
    const outcome = await page.evaluate(
      ([testId, text]) => window.promptampInsert(testId, text),
      [target.testId, DRAFT] as const,
    );
    expect(outcome.tier).toBe(target.expectedTier);
  });
}

test('replaces existing text rather than appending to it', async ({ page }) => {
  const field = page.getByTestId('plain-textarea');
  await field.fill('my rough draft');

  await page.evaluate(
    (text) => window.promptampInsert('plain-textarea', text),
    DRAFT,
  );

  const model = await page.evaluate(() => window.playground.plain!());
  expect(model).toBe(DRAFT);
  expect(model).not.toContain('my rough draft');
});

test('preserves Persian text and its directional marks byte-for-byte', async ({
  page,
}) => {
  // RLM/LRM are invisible in a diff and trivially lost by a normalising write;
  // losing one changes how the whole line renders.
  const withMarks = `‏${PERSIAN}‎`;

  await page.evaluate(
    (text) => window.promptampInsert('rtl-textarea', text),
    withMarks,
  );

  const model = await page.evaluate(() => window.playground.rtl!());
  expect(model).toBe(withMarks);
  expect(model.codePointAt(0)).toBe(0x200f);
});

test('keeps native undo working on a plain textarea', async ({ page }) => {
  // execCommand is deprecated and still the only API that pushes a native undo
  // entry — which is exactly why it is tier 1.
  const field = page.getByTestId('plain-textarea');
  await field.fill('my rough draft');

  const outcome = await page.evaluate(
    (text) => window.promptampInsert('plain-textarea', text),
    DRAFT,
  );
  expect(outcome.undoLost).toBe(false);

  await field.focus();
  await page.keyboard.press('ControlOrMeta+z');

  await expect
    .poll(() => page.evaluate(() => window.playground.plain!()))
    .toBe('my rough draft');
});

test('inserts multi-line text as real paragraphs in a rich editor', async ({
  page,
}) => {
  const multiline = 'First paragraph.\nSecond paragraph.\nThird paragraph.';

  await page.evaluate(
    (text) => window.promptampInsert('quill-host', text),
    multiline,
  );

  const model = await page.evaluate(() => window.playground.quill!());
  expect(model.split('\n').filter(Boolean)).toEqual([
    'First paragraph.',
    'Second paragraph.',
    'Third paragraph.',
  ]);
});

test('works on a field inside a native dialog in the top layer', async ({
  page,
}) => {
  await page.getByTestId('open-dialog').click();
  await expect(page.getByTestId('dialog-textarea')).toBeVisible();

  const outcome = await page.evaluate(
    (text) => window.promptampInsert('dialog-textarea', text),
    DRAFT,
  );

  expect(outcome.ok).toBe(true);
  expect(await page.evaluate(() => window.playground.dialog!())).toBe(DRAFT);
});

test('never offers to write into a readonly field', async ({ page }) => {
  // readOnly blocks the *user*, not a programmatic write — the native setter
  // goes straight through it. So the gate has to be explicit, or PromptAmp
  // would happily replace text in a field the site deliberately locked.
  const locked = await page.evaluate(() => {
    const el = document.querySelector<HTMLTextAreaElement>(
      '[data-testid="plain-textarea"]',
    )!;
    el.value = 'untouchable draft';
    el.readOnly = true;
    return window.promptampQualifies('plain-textarea');
  });

  expect(locked).toBe(false);
});

test('never offers to write into a disabled field', async ({ page }) => {
  const qualifies = await page.evaluate(() => {
    const el = document.querySelector<HTMLTextAreaElement>(
      '[data-testid="plain-textarea"]',
    )!;
    el.disabled = true;
    return window.promptampQualifies('plain-textarea');
  });

  expect(qualifies).toBe(false);
});

test.describe('qualification gates', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(
      () => typeof window.promptampQualifies === 'function',
    );
  });

  for (const [name, testId] of [
    ['a field below the size floor', 'tiny-textarea'],
    ['a data-promptamp opt-out', 'optout-textarea'],
    ['a data-gramm opt-out', 'gramm-textarea'],
    ['a password field', 'password-input'],
    ['a search field', 'search-input'],
  ] as const) {
    test(`suppresses on ${name}`, async ({ page }) => {
      expect(
        await page.evaluate((id) => window.promptampQualifies(id), testId),
      ).toBe(false);
    });
  }

  test('allows a normal composer', async ({ page }) => {
    expect(
      await page.evaluate(() => window.promptampQualifies('plain-textarea')),
    ).toBe(true);
  });
});
