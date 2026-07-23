import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

/**
 * Options page, with the real extension loaded.
 *
 * The load-bearing assertion here is the security one: a saved API key must
 * never come back to this page. Everything else is flow.
 */

const KEY = 'sk-test-abcdefghijklmnopqrstuvwx';

async function openOptions(page: Page, extensionId: string): Promise<void> {
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await expect(page.getByRole('heading', { name: 'PromptAmp' })).toBeVisible();
}

/**
 * Match on the card's exact title, not on text anywhere in the card — the
 * "Custom (OpenAI-compatible)" card contains the string "OpenAI" too.
 */
function card(page: Page, title: string) {
  // Escaped: several provider labels contain parentheses, which would
  // otherwise be read as regex groups and match the wrong card.
  const exact = new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
  return page.locator('.card').filter({
    has: page.locator('.card-title', { hasText: exact }),
  });
}

/** Add a connection for `provider` and return its card. */
async function addConnection(page: Page, provider: string, label = provider) {
  const adder = card(page, 'Add a connection');
  await adder.locator('select').selectOption({ label: provider });
  await adder.getByRole('button', { name: 'Add connection' }).click();

  const target = card(page, label);
  await expect(target).toBeVisible();
  return target;
}

test('saves a key and never sends it back to the page', async ({
  page,
  extensionId,
}) => {
  await openOptions(page, extensionId);

  const target = await addConnection(page, 'OpenAI');
  await target.locator('input[type="password"]').fill(KEY);
  await target.getByRole('button', { name: 'Save', exact: true }).click();

  await expect(target.locator('.status')).toHaveText('Saved');

  // The field is cleared and re-renders as a placeholder, never a value.
  await expect(target.locator('input[type="password"]')).toHaveValue('');
  await expect(target.locator('input[type="password"]')).toHaveAttribute(
    'placeholder',
    /saved/,
  );

  // Nothing anywhere in the rendered document contains the key.
  expect(await page.content()).not.toContain(KEY);

  // And a reload still does not surface it.
  await page.reload();
  expect(await page.content()).not.toContain(KEY);
});

test('marks the first connection primary and the rest fallbacks', async ({
  page,
  extensionId,
}) => {
  await openOptions(page, extensionId);

  await addConnection(page, 'Groq');
  await expect(card(page, 'Groq').locator('.badge').first()).toHaveText(
    'Primary',
  );

  await addConnection(page, 'OpenAI');
  await expect(card(page, 'OpenAI').locator('.badge').first()).toHaveText(
    'Fallback 1',
  );
});

test('holds two keys for the same provider as separate connections', async ({
  page,
  extensionId,
}) => {
  await openOptions(page, extensionId);

  await addConnection(page, 'OpenRouter');
  // The second gets a distinguishing name automatically rather than
  // overwriting the first.
  await addConnection(page, 'OpenRouter', 'OpenRouter 2');

  await expect(card(page, 'OpenRouter')).toBeVisible();
  await expect(card(page, 'OpenRouter 2')).toBeVisible();
});

test('reorders the fallback chain from the keyboard', async ({
  page,
  extensionId,
}) => {
  await openOptions(page, extensionId);
  await addConnection(page, 'Groq');
  await addConnection(page, 'OpenAI');

  // Drag-and-drop would make this unreachable without a pointer.
  await card(page, 'OpenAI')
    .getByRole('button', { name: /Move .* earlier/ })
    .click();

  await expect(card(page, 'OpenAI').locator('.badge').first()).toHaveText(
    'Primary',
  );
  await expect(card(page, 'Groq').locator('.badge').first()).toHaveText(
    'Fallback 1',
  );

  // And it survives a reload, because it is stored, not just rendered.
  await page.reload();
  await expect(card(page, 'OpenAI').locator('.badge').first()).toHaveText(
    'Primary',
  );
});

test('removing a connection leaves the others alone', async ({
  page,
  extensionId,
}) => {
  await openOptions(page, extensionId);
  await addConnection(page, 'Groq');
  await addConnection(page, 'OpenAI');

  await card(page, 'Groq').getByRole('button', { name: 'Remove' }).click();

  await expect(card(page, 'Groq')).toHaveCount(0);
  await expect(card(page, 'OpenAI').locator('.badge').first()).toHaveText(
    'Primary',
  );
});

test('states the terms risk when one provider is used twice', async ({
  page,
  extensionId,
}) => {
  await openOptions(page, extensionId);
  const summary = card(page, 'Connections');

  await addConnection(page, 'OpenAI');
  await expect(summary.locator('.notice')).toHaveCount(0);

  await addConnection(page, 'OpenAI', 'OpenAI 2');
  // A user should learn this here, not by having an account suspended.
  await expect(summary.locator('.notice')).toContainText('free accounts');
});

test('explains the fallback rule where the ordering lives', async ({
  page,
  extensionId,
}) => {
  await openOptions(page, extensionId);
  await expect(card(page, 'Connections').locator('.hint')).toContainText(
    'fall back',
  );
});

test('shows the Gemini training disclosure before the key field', async ({
  page,
  extensionId,
}) => {
  await openOptions(page, extensionId);
  const target = await addConnection(page, 'Google Gemini');
  // A user needs to know this to choose, not to discover it afterwards.
  await expect(target.locator('.notice')).toContainText('improve their models');
});

test('shows the Ollama origin instructions', async ({ page, extensionId }) => {
  await openOptions(page, extensionId);
  const target = await addConnection(page, 'Ollama (local)');
  await expect(target.locator('.notice')).toContainText('OLLAMA_ORIGINS');
});

test('offers a custom OpenAI-compatible endpoint with a base URL', async ({
  page,
  extensionId,
}) => {
  await openOptions(page, extensionId);
  const target = await addConnection(page, 'Custom (OpenAI-compatible)');

  // The whole point: any provider that speaks the OpenAI wire format.
  await expect(target.locator('.notice')).toContainText('LiteLLM proxy');
  await expect(target.locator('input[type="password"]')).toBeVisible();

  // The base URL lives under Advanced (progressive disclosure) — expand it.
  await target.locator('summary', { hasText: 'Advanced' }).click();
  await expect(target.locator('input[type="url"]')).toBeVisible();
});

test('pins named providers to their own host', async ({
  page,
  extensionId,
}) => {
  await openOptions(page, extensionId);
  const target = await addConnection(page, 'OpenAI');
  // A key entered under "OpenAI" must be unable to go anywhere else, so that
  // card has no base-URL field at all.
  await expect(target.locator('input[type="url"]')).toHaveCount(0);
});

test('shows one model control and guides a keyless test', async ({
  page,
  extensionId,
}) => {
  await openOptions(page, extensionId);
  const target = await addConnection(page, 'OpenAI');

  // Exactly one model control — the text field — never a field AND a duplicate
  // dropdown (the bug). No list is cached without a key, so no <select>.
  await expect(target.getByRole('textbox', { name: 'Model' })).toBeVisible();
  await expect(target.getByRole('combobox', { name: 'Model' })).toHaveCount(0);
  await expect(target.locator('.field-note')).toContainText('Save your key');

  // Test with no key is calm guidance, not a red rejection.
  await target.getByRole('button', { name: 'Test', exact: true }).click();
  await expect(target.locator('.status')).toHaveText('Add your API key first.');
  await expect(target.locator('.status')).toHaveClass(/info/);
});

test('customizing a built-in profile makes an editable copy, editor open', async ({
  page,
  extensionId,
}) => {
  await openOptions(page, extensionId);
  await page.getByRole('tab', { name: 'Profiles' }).click();

  await page
    .locator('.list-item', { hasText: 'Image' })
    .getByRole('button', { name: 'Customize' })
    .click();

  // Customizing drops you straight into the editor on the new copy.
  await expect(
    page.locator('.card-title', { hasText: 'Edit Image (my copy)' }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Back' }).click();

  // The copy is now a custom profile; the built-in survives untouched.
  await expect(
    page.locator('.list-item', { hasText: 'Image (my copy)' }),
  ).toBeVisible();
  await expect(
    page.locator('.list-item', { hasText: /^Image —/ }),
  ).toBeVisible();
});

test('rejects a profile import that is not a PromptAmp export', async ({
  page,
  extensionId,
}) => {
  await openOptions(page, extensionId);
  await page.getByRole('tab', { name: 'Profiles' }).click();

  await page.locator('textarea').fill('{"totally": "wrong"}');
  await page.getByRole('button', { name: 'Import' }).click();

  await expect(page.locator('.status')).toContainText('not a PromptAmp');
});

test('behavior tab persists a setting', async ({ page, extensionId }) => {
  await openOptions(page, extensionId);
  await page.getByRole('tab', { name: 'Preferences' }).click();

  const cap = page.locator('input[type="number"]');
  await cap.fill('25');
  await cap.blur();

  await page.reload();
  await page.getByRole('tab', { name: 'Preferences' }).click();
  await expect(page.locator('input[type="number"]')).toHaveValue('25');
});

test('persists an enhanced-prompt language across reloads', async ({
  page,
  extensionId,
}) => {
  await openOptions(page, extensionId);
  await page.getByRole('tab', { name: 'Preferences' }).click();

  const language = page.getByRole('combobox', {
    name: 'Enhanced prompt language',
  });
  // Empty value = "same as my draft"; it is the first, selected option rather
  // than a mode toggle.
  await expect(language).toHaveValue('');
  await expect(language.locator('option').first()).toHaveText(
    /Same language as my text/,
  );

  await language.selectOption({ label: 'English' });

  await page.reload();
  await page.getByRole('tab', { name: 'Preferences' }).click();
  await expect(
    page.getByRole('combobox', { name: 'Enhanced prompt language' }),
  ).toHaveValue('English');
});

test('offers a free-text language via the Other option', async ({
  page,
  extensionId,
}) => {
  await openOptions(page, extensionId);
  await page.getByRole('tab', { name: 'Preferences' }).click();

  const language = page.getByRole('combobox', {
    name: 'Enhanced prompt language',
  });
  const other = page.getByRole('textbox', { name: 'Enhanced prompt language' });
  await expect(other).toBeHidden();

  // "Other…" reveals a free-text field for a language no fixed list holds.
  await language.selectOption({ label: 'Other…' });
  await expect(other).toBeVisible();
  await other.fill('Brazilian Portuguese');
  await other.blur();

  // It survives a reload, reopening on "Other…" with the value intact.
  await page.reload();
  await page.getByRole('tab', { name: 'Preferences' }).click();
  await expect(
    page.getByRole('textbox', { name: 'Enhanced prompt language' }),
  ).toHaveValue('Brazilian Portuguese');
});

test('history tab states that nothing leaves the device', async ({
  page,
  extensionId,
}) => {
  await openOptions(page, extensionId);
  await page.getByRole('tab', { name: 'History' }).click();
  await expect(page.locator('.hint').first()).toContainText(
    'never uploaded anywhere',
  );
});
