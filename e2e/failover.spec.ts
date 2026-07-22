import type { Page } from '@playwright/test';
import { expect, test, useMockChain } from './fixtures';

/**
 * The fallback chain, end to end in a real browser.
 *
 * The unit tests prove the policy; this proves the wiring — that a failure on
 * the first connection reaches the second through the worker, the Port, and the
 * panel, and that the user is told it happened rather than being silently
 * served by a different model than they configured.
 *
 * Each mock connection takes its behaviour from its model name, which is the
 * only way to make one connection fail while another beside it succeeds.
 */

const DRAFT = 'tips for a job interview please';

const panel = (page: Page) => page.locator('.pa-panel');

async function enhance(page: Page): Promise<void> {
  await page.goto('http://localhost:5174/');
  const field = page.getByTestId('plain-textarea');
  await field.fill(DRAFT);
  await field.click();
  await page.locator('.pa-button').click();
}

test('a rate-limited primary hands over to the fallback', async ({
  page,
  worker,
}) => {
  await useMockChain(worker, ['mock-rate-limited', 'mock-1']);
  await enhance(page);

  // The rewrite still arrives — that is the entire point of a chain.
  await expect(panel(page).locator('.pa-body')).toContainText(
    'Be specific and concise',
    { timeout: 15_000 },
  );
});

test('says which connection failed and which answered', async ({
  page,
  worker,
}) => {
  await useMockChain(worker, ['mock-quota', 'mock-1']);
  await enhance(page);

  // Silent recovery would hide that a key needs topping up, and hide that a
  // different model wrote this.
  await expect(panel(page)).toContainText('Mock fallback 1', {
    timeout: 15_000,
  });
});

test('a refusal stops the chain instead of shopping for a model', async ({
  page,
  worker,
}) => {
  await useMockChain(worker, ['mock-refusal', 'mock-1']);
  await enhance(page);

  // Walking the chain until a model complies is guardrail shopping.
  await expect(panel(page).locator('.pa-error')).toBeVisible({
    timeout: 15_000,
  });
  await expect(panel(page).locator('.pa-error')).toContainText('refusal');
  // The second connection was never asked.
  await expect(panel(page).locator('.pa-attempts')).toHaveCount(0);
});

test('names every connection that failed, with a fix', async ({
  page,
  worker,
}) => {
  await useMockChain(worker, ['mock-bad-key', 'mock-quota']);
  await enhance(page);

  const error = panel(page).locator('.pa-error');
  await expect(error).toBeVisible({ timeout: 15_000 });
  await expect(error).toContainText('All 2 connections failed');

  // Both causes stay visible: they need different fixes, and collapsing them
  // to the last one sends the user to fix the wrong thing.
  await expect(error.locator('.pa-attempts li')).toHaveCount(2);
  await expect(error.locator('.pa-remedy')).toContainText('re-paste the key');

  // The promise that matters most, on the failure path above all.
  await expect(page.getByTestId('plain-textarea')).toHaveValue(DRAFT);
});

test('a single-connection failure still explains the fix', async ({
  page,
  worker,
}) => {
  await useMockChain(worker, ['mock-network']);
  await enhance(page);

  const error = panel(page).locator('.pa-error');
  await expect(error).toBeVisible({ timeout: 15_000 });
  await expect(error.locator('.pa-remedy')).toContainText(
    'internet connection',
  );
  // No chain, so no list — one failure is not a summary.
  await expect(error.locator('.pa-attempts')).toHaveCount(0);
});
