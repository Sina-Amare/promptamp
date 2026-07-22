/**
 * Live-site smoke pass.
 *
 *   pnpm smoke
 *
 * Loads the real extension into a real browser and visits public pages with
 * real text fields, recording for each one whether the button attached, where
 * it landed, and whether the site fought back.
 *
 * Deliberately a script and not a test. These are third-party sites: they
 * redesign without warning, rate-limit, geo-block, and serve bot walls. A red
 * CI run caused by Cloudflare teaches nobody anything, so this reports rather
 * than asserts — the output is evidence for a human, and "blocked" is a
 * perfectly valid result to write down.
 *
 * The hard editors (Monaco, CodeMirror, ProseMirror, Quill, Slate, shadow DOM,
 * iframes, modal dialogs) are covered far better by `playground/` in the e2e
 * suite, which is deterministic and offline. What this adds is the one thing
 * the playground cannot fake: real pages, with their own CSS, their own
 * scroll containers, and their own opinions about where a floating button may
 * sit. Logged-in sites remain a human's job.
 */
import { fileURLToPath } from 'node:url';
import { chromium, type BrowserContext, type Page } from '@playwright/test';

const EXTENSION_PATH = fileURLToPath(
  new URL('../.output/chrome-mv3', import.meta.url),
);

interface Target {
  name: string;
  url: string;
  /** A field that exists without logging in. */
  field: string;
}

/**
 * Multi-line composers only.
 *
 * Search boxes are deliberately absent: `qualifies()` excludes single-line
 * `<input>` per UX-SPEC §1.1, because a rewrite affordance on a one-line box is
 * noise. Probing DuckDuckGo would report a failure that is actually the design
 * working, which is worse than not probing it.
 */
const TARGETS: Target[] = [
  {
    name: 'Google Translate',
    url: 'https://translate.google.com/',
    field: 'textarea',
  },
  { name: 'DeepL', url: 'https://www.deepl.com/translator', field: 'textarea' },
  { name: 'Pastebin', url: 'https://pastebin.com/', field: 'textarea' },
  {
    name: 'Perplexity',
    url: 'https://www.perplexity.ai/',
    field: 'textarea, [contenteditable="true"]',
  },
  {
    name: 'DeepSeek',
    url: 'https://chat.deepseek.com/',
    field: 'textarea, [contenteditable="true"]',
  },
  {
    name: 'ChatGPT',
    url: 'https://chatgpt.com/',
    field: '#prompt-textarea, textarea',
  },
  {
    name: 'Claude',
    url: 'https://claude.ai/new',
    field: '[contenteditable="true"], textarea',
  },
];

const DRAFT = 'tips for a job interview please';

interface Result {
  name: string;
  outcome: 'ok' | 'no-field' | 'no-button' | 'blocked';
  detail: string;
}

async function probe(context: BrowserContext, target: Target): Promise<Result> {
  const page: Page = await context.newPage();

  try {
    await page.goto(target.url, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });

    const field = page.locator(target.field).first();
    await field.waitFor({ state: 'visible', timeout: 15_000 });

    await field.click();
    await field.fill(DRAFT).catch(async () => {
      // contenteditable fields reject fill() on some sites.
      await page.keyboard.type(DRAFT);
    });

    const button = page.locator('.pa-button');
    const appeared = await button
      .waitFor({ state: 'visible', timeout: 10_000 })
      .then(
        () => true,
        () => false,
      );

    if (!appeared) {
      // Say *why*. "No button" is ambiguous between a bug and the design
      // working — a 30×180 box is supposed to be skipped, and reporting that
      // as a failure would send someone hunting a bug that is not there.
      const why = await field.evaluate((node) => {
        const rect = node.getBoundingClientRect();
        const tag = node.tagName.toLowerCase();
        const editable = (node as HTMLElement).isContentEditable;
        const small = rect.height < 40 || rect.width < 200;
        return `${tag}${editable ? '[ce]' : ''} ${String(Math.round(rect.width))}×${String(Math.round(rect.height))}${small ? ' — below the size gate' : ''}`;
      });
      return { name: target.name, outcome: 'no-button', detail: why };
    }

    const box = await button.boundingBox();
    const fieldBox = await field.boundingBox();
    if (!box || !fieldBox) {
      return { name: target.name, outcome: 'no-button', detail: 'no geometry' };
    }

    // Inside the field is the design; outside-below is the documented fallback
    // for fields too small to hold it.
    const inside =
      box.x >= fieldBox.x - 2 &&
      box.y >= fieldBox.y - 2 &&
      box.x + box.width <= fieldBox.x + fieldBox.width + 2 &&
      box.y + box.height <= fieldBox.y + fieldBox.height + 2;

    const viewport = page.viewportSize();
    const onScreen =
      viewport !== null &&
      box.x >= 0 &&
      box.y >= 0 &&
      box.x + box.width <= viewport.width &&
      box.y + box.height <= viewport.height;

    return {
      name: target.name,
      outcome: 'ok',
      detail: `${inside ? 'inside field' : 'outside field'}, ${
        onScreen ? 'on screen' : 'OFF SCREEN'
      }, at ${String(Math.round(box.x))},${String(Math.round(box.y))}`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const blocked = /net::|Timeout .* exceeded.*goto|ERR_/.test(message);
    return {
      name: target.name,
      outcome: blocked ? 'blocked' : 'no-field',
      detail: message.split('\n')[0]?.slice(0, 90) ?? '',
    };
  } finally {
    await page.close();
  }
}

const context = await chromium.launchPersistentContext('', {
  channel: 'chromium',
  args: [
    `--disable-extensions-except=${EXTENSION_PATH}`,
    `--load-extension=${EXTENSION_PATH}`,
    '--no-first-run',
  ],
});

const results: Result[] = [];
for (const target of TARGETS) {
  const result = await probe(context, target);
  results.push(result);
  console.log(
    `${result.outcome.padEnd(10)} ${result.name.padEnd(18)} ${result.detail}`,
  );
}

await context.close();

console.log('\n| Site | Result | Detail |');
console.log('| --- | --- | --- |');
for (const r of results) {
  console.log(`| ${r.name} | ${r.outcome} | ${r.detail} |`);
}

const reached = results.filter((r) => r.outcome !== 'blocked').length;
const attached = results.filter((r) => r.outcome === 'ok').length;
console.log(
  `\n${String(attached)}/${String(reached)} reachable sites attached the button ` +
    `(${String(results.length - reached)} unreachable).`,
);
