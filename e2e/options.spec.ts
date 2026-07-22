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

test('saves a key and never sends it back to the page', async ({
  page,
  extensionId,
}) => {
  await openOptions(page, extensionId);

  const card = page.locator('.card', { hasText: 'OpenAI' });
  await card.locator('input[type="password"]').fill(KEY);
  await card.getByRole('button', { name: 'Save', exact: true }).click();

  await expect(card.locator('.status')).toHaveText('Saved');

  // The field is cleared and re-renders as a placeholder, never a value.
  await expect(card.locator('input[type="password"]')).toHaveValue('');
  await expect(card.locator('input[type="password"]')).toHaveAttribute(
    'placeholder',
    /saved/,
  );

  // Nothing anywhere in the rendered document contains the key.
  expect(await page.content()).not.toContain(KEY);

  // And a reload still does not surface it.
  await page.reload();
  expect(await page.content()).not.toContain(KEY);
});

test('marks the first saved provider active', async ({ page, extensionId }) => {
  await openOptions(page, extensionId);

  const card = page.locator('.card', { hasText: 'Groq' });
  await card.locator('input[type="password"]').fill(KEY);
  await card.getByRole('button', { name: 'Save', exact: true }).click();

  // A user who has just added their only key should not also have to select it.
  await expect(card.locator('.badge', { hasText: 'Active' })).toBeVisible();
});

test('removing the active provider clears it', async ({
  page,
  extensionId,
}) => {
  await openOptions(page, extensionId);
  const card = page.locator('.card', { hasText: 'Groq' });
  await card.locator('input[type="password"]').fill(KEY);
  await card.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(card.locator('.badge', { hasText: 'Active' })).toBeVisible();

  await card.getByRole('button', { name: 'Remove' }).click();
  await expect(card.locator('.badge', { hasText: 'Active' })).toHaveCount(0);
});

test('shows the Gemini training disclosure before the key field', async ({
  page,
  extensionId,
}) => {
  await openOptions(page, extensionId);
  // A user needs to know this to choose, not to discover it afterwards.
  await expect(
    page.locator('.card', { hasText: 'Google Gemini' }).locator('.notice'),
  ).toContainText('improve their models');
});

test('shows the Ollama origin instructions', async ({ page, extensionId }) => {
  await openOptions(page, extensionId);
  await expect(
    page.locator('.card', { hasText: 'Ollama' }).locator('.notice'),
  ).toContainText('OLLAMA_ORIGINS');
});

test('forks a built-in profile without touching the original', async ({
  page,
  extensionId,
}) => {
  await openOptions(page, extensionId);
  await page.getByRole('tab', { name: 'Profiles' }).click();

  await page
    .locator('.list-item', { hasText: 'Image' })
    .getByRole('button', { name: 'Fork' })
    .click();

  await expect(
    page.locator('.list-item', { hasText: 'Image (copy)' }),
  ).toBeVisible();
  // The built-in survives — it is improved by updates and must stay read-only.
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
  await page.getByRole('tab', { name: 'Behavior' }).click();

  const cap = page.locator('input[type="number"]');
  await cap.fill('25');
  await cap.blur();

  await page.reload();
  await page.getByRole('tab', { name: 'Behavior' }).click();
  await expect(page.locator('input[type="number"]')).toHaveValue('25');
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
