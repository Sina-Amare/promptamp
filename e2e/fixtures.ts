import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  test as base,
  chromium,
  type BrowserContext,
  type Worker,
} from '@playwright/test';

/**
 * Loads the *built* extension into a real browser.
 *
 * MV3 extensions cannot be loaded any other way — there is no headless
 * `addInitScript` equivalent, and no way to fake a service worker. So the
 * suite runs against `.output/chrome-mv3` exactly as a user would load it
 * unpacked, which also means these tests catch manifest and permission
 * mistakes that a unit test never could.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = path.resolve(here, '../.output/chrome-mv3');

export const test = base.extend<{
  context: BrowserContext;
  extensionId: string;
  /** The background service worker, for seeding storage and reading state. */
  worker: Worker;
}>({
  // eslint-disable-next-line no-empty-pattern -- Playwright's fixture signature
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        '--no-first-run',
      ],
    });
    await use(context);
    await context.close();
  },

  worker: async ({ context }, use) => {
    // The worker may not have spun up yet on a cold profile.
    const worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent('serviceworker'));
    await use(worker);
  },

  extensionId: async ({ worker }, use) => {
    // chrome-extension://<id>/background.js
    await use(new URL(worker.url()).host);
  },
});

export const expect = test.expect;

/**
 * Point the extension at the mock provider.
 *
 * Runs inside the worker, so it writes the same `storage.local` the extension
 * reads — no test-only code path in the shipped bundle.
 */
export async function useMockProvider(worker: Worker): Promise<void> {
  await useMockChain(worker, ['mock-1']);
}

/**
 * Seed a fallback chain of mock connections, one per model name.
 *
 * The mock adapter reads its behaviour from the model name, so
 * `['mock-rate-limited', 'mock-1']` is a chain whose first connection always
 * fails and whose second always answers — which is the only way to exercise
 * failover against a provider that cannot be asked for a 429 on demand.
 */
export async function useMockChain(
  worker: Worker,
  models: string[],
): Promise<void> {
  await worker.evaluate(async (modelNames: string[]) => {
    // Typed loosely on purpose: this string is evaluated inside the extension
    // worker, where `chrome` exists but this file's types do not apply.
    const api = (
      globalThis as unknown as {
        chrome: {
          storage: { local: { set: (items: unknown) => Promise<void> } };
        };
      }
    ).chrome;

    await api.storage.local.set({
      settings: {
        defaultProfileId: 'general',
        autoProfile: true,
        globallyHidden: false,
        pausedUntil: null,
        firstRunDone: true,
        softCapPerDay: 0,
        historyEnabled: true,
        historyLimit: 200,
        uiLanguage: 'auto',
        outputLanguageOverride: '',
      },
      credentials: modelNames.map((model, index) => ({
        id: `mock-${String(index)}`,
        providerId: 'mock',
        label: index === 0 ? 'Mock' : `Mock fallback ${String(index)}`,
        model,
        authMethod: 'manual',
        addedAt: index,
      })),
      // WXT stores an item's schema version alongside it. Without this the
      // v1→v2 migration would run over an already-v2 array and wipe it.
      credentials$: { v: 2 },
    });
  }, models);
}

/** Reach into the extension's shadow root from a page-side selector. */
export const HOST_SELECTOR = '[data-promptamp-host]';
