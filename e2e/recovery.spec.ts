import { expect, test, useMockProvider } from './fixtures';

test.beforeEach(async ({ worker }) => {
  await useMockProvider(worker);
});

test('worker termination becomes a recoverable interruption, never a spinner', async ({
  context,
  page,
  worker,
}) => {
  const draft = 'summarize this architecture [[mock:slow:5000]]';
  await page.goto('http://localhost:5174/');
  const field = page.getByTestId('plain-textarea');
  await field.fill(draft);
  await field.click();
  await page.locator('.pa-button').click();
  await expect(page.locator('.pa-panel')).toBeVisible();

  // ServiceWorkerGlobalScope deliberately has no close(). Terminate the real
  // MV3 target through CDP so the Port observes the same unexpected
  // disconnect Chrome produces when it reclaims a worker.
  const cdp = await context.newCDPSession(page);
  const { targetInfos } = await cdp.send('Target.getTargets');
  const workerTarget = targetInfos.find((target) => {
    return target.type === 'service_worker' && target.url === worker.url();
  });
  expect(workerTarget).toBeDefined();
  await cdp.send('Target.closeTarget', { targetId: workerTarget!.targetId });
  await cdp.detach();

  const error = page.locator('.pa-error');
  await expect(error).toBeVisible({ timeout: 10_000 });
  await expect(error).toContainText('background worker stopped');
  await expect(error).toContainText('Your prompt is unchanged');
  await expect(error.getByRole('button', { name: 'Retry' })).toBeVisible();
  expect(await page.evaluate(() => window.playground.plain!())).toBe(draft);
});
