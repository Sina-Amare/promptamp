import type { Page } from '@playwright/test';
import { expect, test, useMockProvider } from './fixtures';

/**
 * The panel's in-place controls: the profile chip, the output-language chip,
 * the one-tap Structured chip, and Copy feedback. These are the parts the user
 * flagged as dead ("chat · auto doesn't open") or missing feedback.
 *
 * Everything runs against the mock provider — deterministic, offline, no key.
 */

const DRAFT = 'tips for a job interview please';
const panel = (page: Page) => page.locator('.pa-panel');

test.beforeEach(async ({ worker }) => {
  await useMockProvider(worker);
});

async function openPanel(page: Page): Promise<void> {
  await page.goto('http://localhost:5174/');
  const field = page.getByTestId('plain-textarea');
  await field.fill(DRAFT);
  await field.click();
  await page.locator('.pa-button').click();
  await expect(panel(page).locator('.pa-body')).toContainText('Be specific', {
    timeout: 15_000,
  });
}

test('the profile chip opens a real menu and pins the pick', async ({
  page,
}) => {
  await openPanel(page);

  const chip = panel(page).getByRole('button', { name: 'Change profile' });
  await chip.click();

  const menu = panel(page).locator('.pa-chip-menu');
  await expect(menu).toBeVisible();
  await menu.getByRole('option', { name: 'Coding' }).click();

  // Picking from the menu re-enhances in that profile and pins it for the site.
  await expect(chip).toContainText('Coding');
  await expect(chip).toContainText('pinned');
});

test('the output-language chip changes the language on the panel', async ({
  page,
}) => {
  await openPanel(page);

  const chip = panel(page).getByRole('button', { name: 'Output language' });
  await expect(chip).toContainText('Same as my text');
  await chip.click();

  const menu = panel(page).locator('.pa-chip-menu');
  await expect(menu).toBeVisible();
  await menu.getByRole('option', { name: 'English', exact: true }).click();

  await expect(chip).toContainText('English');
});

test('the Structured chip is a one-off — it does not repin the profile', async ({
  page,
}) => {
  await openPanel(page);

  const profileChip = panel(page).getByRole('button', {
    name: 'Change profile',
  });
  await expect(profileChip).toContainText('General');

  await panel(page)
    .getByRole('button', { name: 'Structured', exact: true })
    .click();

  // Re-runs without error, and the profile chip stays on the site's profile —
  // Structured behaves like an adjust, not a profile switch.
  await expect(panel(page).locator('.pa-body')).toContainText('Be specific', {
    timeout: 15_000,
  });
  await expect(panel(page).locator('.pa-error')).toHaveCount(0);
  await expect(profileChip).toContainText('General');
});

test('Copy shows a Copied confirmation', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openPanel(page);

  await panel(page).getByRole('button', { name: 'Copy', exact: true }).click();
  // The icon-only button gains a visible + announced "Copied" state.
  await expect(
    panel(page).getByRole('button', { name: 'Copied' }),
  ).toBeVisible();
});
