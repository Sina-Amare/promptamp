import { expect, test, useMockProvider } from './fixtures';

const DRAFT = 'explain a websocket reconnect strategy';

test.beforeEach(async ({ worker }) => {
  await useMockProvider(worker);
});

test('CodeMirror reads and replaces through the static MAIN-world bridge', async ({
  page,
}) => {
  await page.goto('http://localhost:5174/');
  const editor = page.locator('.cm-content');
  await editor.fill(DRAFT);
  await editor.click();
  await expect(page.locator('.pa-button')).toBeVisible();
  await page.locator('.pa-button').click();

  await expect(page.locator('.pa-primary')).toBeEnabled({ timeout: 15_000 });
  await page.locator('.pa-primary').click();

  await expect
    .poll(() => page.evaluate(() => window.playground.codemirror!()))
    .toContain('Explain a websocket reconnect strategy');
});

test('Monaco hidden textarea resolves to its visible root and exact model', async ({
  page,
}) => {
  await page.goto('http://localhost:5174/');
  await page.evaluate((draft) => {
    const input = document.querySelector<HTMLTextAreaElement>(
      '[data-testid="monaco-input"]',
    )!;
    input.value = draft;
    input.dispatchEvent(new InputEvent('input', { bubbles: true }));
    input.focus();
  }, DRAFT);

  await expect(page.locator('.pa-button')).toBeVisible();
  const button = page.locator('.pa-button');
  const root = page.getByTestId('monaco-host');
  const [buttonBox, rootBox] = await Promise.all([
    button.boundingBox(),
    root.boundingBox(),
  ]);
  expect(buttonBox).not.toBeNull();
  expect(rootBox).not.toBeNull();
  expect(buttonBox!.y).toBeGreaterThanOrEqual(rootBox!.y - 20);

  await button.click();
  await expect(page.locator('.pa-primary')).toBeEnabled({ timeout: 15_000 });
  await page.locator('.pa-primary').click();

  await expect
    .poll(() => page.evaluate(() => window.playground.monaco!()))
    .toContain('Explain a websocket reconnect strategy');
});
