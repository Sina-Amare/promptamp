import { expect, test, useMockProvider } from './fixtures';

test.beforeEach(async ({ worker }) => {
  await useMockProvider(worker);
});

test('switching composers hands one disc to the newly focused field', async ({
  page,
}) => {
  await page.goto('http://localhost:5174/');
  const first = page.getByTestId('plain-textarea');
  const second = page.getByTestId('rtl-textarea');
  await first.fill('First composer has enough useful draft text.');
  await second.fill('این کادر دوم یک متن کامل برای آزمایش دارد.');
  await first.click();
  const disc = page.locator('.pa-button-wrap');
  await expect(disc).toHaveCount(1);
  const firstBox = await disc.boundingBox();

  await second.click();
  await expect(disc).toHaveCount(1);
  const secondBox = await disc.boundingBox();
  expect(secondBox).not.toBeNull();
  expect(firstBox).not.toBeNull();
  expect(Math.abs(secondBox!.y - firstBox!.y)).toBeGreaterThan(40);
});

test('a focused editor replacement is adopted without a duplicate disc', async ({
  page,
}) => {
  await page.goto('http://localhost:5174/');
  const field = page.getByTestId('plain-textarea');
  await field.fill('A draft that survives a React-style node replacement.');
  await field.click();
  await expect(page.locator('.pa-button-wrap')).toHaveCount(1);

  await page.evaluate(() => {
    const old = document.querySelector<HTMLTextAreaElement>(
      '[data-testid="plain-textarea"]',
    )!;
    const replacement = old.cloneNode(true) as HTMLTextAreaElement;
    replacement.value = old.value;
    old.replaceWith(replacement);
    replacement.focus();
  });

  await expect(page.locator('.pa-button-wrap')).toHaveCount(1);
  await expect(page.locator('.pa-button')).toBeVisible();
});

test('a full body replacement cannot orphan the injected surface', async ({
  page,
}) => {
  await page.goto('http://localhost:5174/');
  const first = page.getByTestId('plain-textarea');
  await first.fill(
    'The early composer exists before the application hydrates.',
  );
  await first.click();
  await expect(page.locator('.pa-button')).toBeVisible();

  // Google applications can replace the body during staged boot. Observing
  // only the old body misses that removal entirely because the observer itself
  // leaves the document with the subtree.
  await page.evaluate(() => {
    const nextBody = document.createElement('body');
    const shell = document.createElement('main');
    shell.style.cssText =
      'position:fixed;left:200px;top:160px;width:720px;padding:20px;border:1px solid #555;border-radius:28px';
    const replacement = document.createElement('textarea');
    replacement.dataset.testid = 'post-hydration-composer';
    replacement.style.cssText = 'display:block;width:100%;height:88px';
    replacement.value =
      'The live composer was mounted with a replacement document body.';
    shell.append(replacement);
    nextBody.append(shell);
    document.documentElement.replaceChild(nextBody, document.body);
    replacement.focus();
  });

  await expect(
    page.locator('[data-promptamp-host]'),
    'the shadow host must move to the replacement body',
  ).toHaveCount(1);
  await expect(page.locator('.pa-button')).toBeVisible();
});

test('an already-focused editor is acquired when hydration makes it eligible', async ({
  page,
}) => {
  await page.goto('http://localhost:5174/');
  await expect(page.locator('[data-promptamp-host]')).toHaveCount(1);

  await page.evaluate(() => {
    const field = document.createElement('textarea');
    field.dataset.testid = 'staged-composer';
    field.style.cssText =
      'position:fixed;left:240px;top:180px;width:80px;height:12px';
    document.body.append(field);
    field.focus();
  });
  await expect(page.locator('.pa-button')).toHaveCount(0);

  // Framework layout arrives after focus without dispatching another focus
  // event. A tracker that polls only after attachment never sees this editor.
  await page.getByTestId('staged-composer').evaluate((field) => {
    field.style.width = '620px';
    field.style.height = '88px';
  });

  await expect(page.locator('.pa-button')).toBeVisible({ timeout: 3_000 });
});

test('a focused custom-element host acquires its late shadow editor', async ({
  page,
}) => {
  await page.goto('http://localhost:5174/');
  await page.evaluate(() => {
    const shell = document.createElement('div');
    shell.style.cssText =
      'position:fixed;left:220px;top:180px;width:720px;height:88px;padding:0 20px;display:flex;align-items:center;border-radius:44px;background:#252525';
    const host = document.createElement('input-area-v2');
    host.tabIndex = 0;
    host.style.cssText = 'display:block;flex:1;min-width:0';
    shell.append(host);
    document.body.append(shell);
    host.focus();
  });
  await expect(page.locator('.pa-button')).toHaveCount(0);

  // Angular can focus the custom-element host before rich-textarea has
  // populated its open root. There is no second focus event when the real
  // editor appears.
  await page.evaluate(() => {
    const host = document.querySelector('input-area-v2')!;
    const shadow = host.attachShadow({ mode: 'open' });
    const editor = document.createElement('div');
    editor.contentEditable = 'true';
    editor.setAttribute('role', 'textbox');
    editor.style.cssText =
      'display:block;width:560px;height:24px;line-height:24px;outline:none';
    shadow.append(editor);
  });

  await expect(page.locator('.pa-button')).toBeVisible({ timeout: 3_000 });
});

test('a wide native prompt input is supported without admitting ordinary inputs', async ({
  page,
}) => {
  await page.goto('http://localhost:5174/');
  await page.evaluate(() => {
    const shell = document.createElement('div');
    shell.style.cssText =
      'position:fixed;left:220px;top:180px;width:720px;height:88px;padding:0 18px;display:flex;align-items:center;gap:12px;border-radius:28px;background:#252525';
    const prompt = document.createElement('input');
    prompt.type = 'text';
    prompt.dataset.testid = 'flow-prompt';
    prompt.setAttribute('aria-label', 'What do you want to create?');
    prompt.style.cssText =
      'display:block;width:560px;height:24px;border:0;background:transparent;color:white;font:18px sans-serif';
    const send = document.createElement('button');
    send.type = 'button';
    send.textContent = '→';
    send.style.cssText = 'width:40px;height:40px';
    shell.append(prompt, send);
    document.body.append(shell);
  });
  const prompt = page.getByTestId('flow-prompt');
  await prompt.fill('Create a cinematic launch sequence for this product.');
  await prompt.click();
  await expect(page.locator('.pa-button')).toBeVisible();
  expect(
    await prompt.evaluate((element) => ({
      active: document.activeElement === element,
      height: element.getBoundingClientRect().height,
      type: (element as HTMLInputElement).type,
      value: (element as HTMLInputElement).value,
      width: element.getBoundingClientRect().width,
    })),
  ).toEqual({
    active: true,
    height: 24,
    type: 'text',
    value: 'Create a cinematic launch sequence for this product.',
    width: 560,
  });
  await expect(page.locator('.pa-button-wrap')).toHaveAttribute(
    'data-state',
    /idle|typing/,
  );
  const targetBox = await page.locator('.pa-button-wrap').boundingBox();
  const paintedText = await prompt.evaluate((element) => {
    const input = element as HTMLInputElement;
    const rect = input.getBoundingClientRect();
    const context = document.createElement('canvas').getContext('2d')!;
    context.font = getComputedStyle(input).font;
    return {
      x: rect.left,
      y: rect.top,
      width: Math.ceil(context.measureText(input.value).width) + 2,
      height: rect.height,
    };
  });
  expect(targetBox).not.toBeNull();
  expect(
    targetBox!.x < paintedText.x + paintedText.width &&
      paintedText.x < targetBox!.x + targetBox!.width &&
      targetBox!.y < paintedText.y + paintedText.height &&
      paintedText.y < targetBox!.y + targetBox!.height,
    'the complete target overlaps the native input text',
  ).toBe(false);

  const valueBefore = await prompt.inputValue();
  await page.locator('.pa-button').click();
  await expect(page.locator('.pa-primary')).toBeEnabled({ timeout: 15_000 });
  await page.locator('.pa-primary').click();
  await expect(prompt).not.toHaveValue(valueBefore);
});

test('delegated pointer handling on a composer host never hides the icon', async ({
  page,
}) => {
  await page.goto('http://localhost:5174/');
  const editor = page.getByTestId('gemini-editable');
  await editor.click();
  await expect(page.locator('.pa-button')).toBeVisible();

  // Angular event delegation can make the complete composer ownership chain
  // report as interactive after hydration. It must not be mistaken for a
  // control occupying every otherwise-empty slot.
  await page.getByTestId('gemini-shell').evaluate((shell) => {
    shell.setAttribute('tabindex', '0');
    shell.setAttribute('jsaction', 'pointerdown:focusComposer');
    (shell as HTMLElement).style.cursor = 'pointer';
    const wrapper = shell.parentElement!;
    wrapper.setAttribute('jsaction', 'click:delegate');
    wrapper.style.cursor = 'pointer';
  });

  await page.waitForTimeout(1_200);
  await expect(page.locator('.pa-button')).toBeVisible();
});

test('a composer in a same-origin iframe gets its own working surface', async ({
  page,
}) => {
  await page.goto('http://localhost:5174/');
  await page.evaluate(() => {
    const frame = document.createElement('iframe');
    frame.src = '/iframe.html';
    frame.dataset.testid = 'composer-frame';
    frame.style.cssText = 'width:700px;height:260px';
    document.body.append(frame);
  });
  const frame = page.frameLocator('[data-testid="composer-frame"]');
  const field = frame.getByTestId('iframe-composer');
  await field.fill('Explain a robust iframe messaging architecture.');
  await field.click();

  await expect(frame.locator('.pa-button')).toBeVisible();
  await frame.locator('.pa-button').click();
  await expect(frame.locator('.pa-primary')).toBeEnabled({ timeout: 15_000 });
});
