import { browser, defineBackground } from '#imports';
import { builtinProfile } from '../lib/enhance/prompts';
import { listProfiles, resolveProfile } from '../lib/enhance/resolve';
import {
  runEnhancement,
  safeErrorForEnhancement,
  toSafeError,
} from '../lib/enhance/run';
import { mainWorldInsertFunction } from '../lib/insertion/main-world';
import {
  ENHANCE_PORT,
  TRIGGER_ENHANCE,
  isTrustedSender,
  type EnhanceClientMessage,
  type EnhanceServerMessage,
  type Request,
} from '../lib/messaging/protocol';
import {
  fetchUsage,
  getProvider,
  listModels,
  testConnection,
} from '../lib/providers';
import { connectOpenRouter } from '../lib/providers/oauth-openrouter';
import {
  deleteConnection,
  publicConnections,
  reorderConnections,
  saveConnection,
} from '../lib/storage/credentials';
import {
  customProfilesItem,
  getCustomProfiles,
  getHistory,
  getSettings,
  getSiteRule,
  historyItem,
  patchSettings,
  patchSiteRule,
  sessionHiddenOriginsItem,
  siteRulesItem,
} from '../lib/storage/items';
import { profileImportSchema, profileSchema } from '../lib/storage/schemas';

/**
 * The message router.
 *
 * Stateless by construction: MV3 terminates this worker whenever it feels like
 * it, so every handler reloads what it needs from storage rather than trusting
 * anything held in module scope (principle 6).
 *
 * This is also the only place with access to API keys — content scripts cannot
 * import the credential module at all, and ESLint fails the build if one tries.
 */

export default defineBackground(() => {
  /**
   * The enhance channel.
   *
   * A Port rather than a one-shot message, for one reason: cancellation. The
   * Stop button disconnects the port, which aborts the in-flight fetch — a
   * `sendMessage` call would keep running and keep billing after the user had
   * visibly cancelled it.
   */
  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== ENHANCE_PORT) return;
    if (!isTrustedSender(port.sender ?? {})) {
      port.disconnect();
      return;
    }

    const controller = new AbortController();
    let finished = false;

    const post = (message: EnhanceServerMessage): void => {
      try {
        port.postMessage(message);
      } catch {
        // The panel closed mid-flight; nothing to deliver to.
      }
    };

    port.onDisconnect.addListener(() => {
      if (!finished) controller.abort();
    });

    port.onMessage.addListener((raw: unknown) => {
      const message = raw as EnhanceClientMessage;
      if (message.type === 'cancel') {
        controller.abort();
        return;
      }
      if (message.type !== 'start') return;

      runEnhancement(message, {
        signal: controller.signal,
        onAccepted: (profileId, auto) => {
          post({ type: 'accepted', profileId, auto });
        },
        // Forwarded as they arrive. Measured on real providers, this moves
        // first visible text from ~2.6 s to ~1.1 s on gpt-4o-mini.
        onChunk: (delta) => {
          post({ type: 'chunk', text: delta });
        },
        // A fallback took over mid-stream: what the panel has revealed so far
        // belongs to a different answer and must be thrown away.
        onReset: () => {
          post({ type: 'reset' });
        },
      })
        .then((result) => {
          finished = true;
          post({ type: 'done', result });
        })
        .catch((error: unknown) => {
          finished = true;
          // Every failure is mapped and redacted before it crosses back — a
          // raw provider message can echo the API key.
          post({ type: 'error', error: safeErrorForEnhancement(error) });
        });
    });
  });

  /**
   * Alt+E. Forwarded to the content script, which is the only side that knows
   * which field has focus.
   */
  browser.commands.onCommand.addListener((command) => {
    if (command !== 'enhance-prompt') return;
    void notifyActiveTab();
  });

  const MENU_ID = 'promptamp-enhance';

  // contextMenus.create throws on a duplicate id, and the worker re-runs this
  // on every wake — remove first rather than swallow the error.
  browser.runtime.onInstalled.addListener(() => {
    void browser.contextMenus.removeAll().then(() => {
      browser.contextMenus.create({
        id: MENU_ID,
        title: 'Enhance this draft with PromptAmp',
        // Only where there is something to enhance.
        contexts: ['editable'],
      });
    });
  });

  browser.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== MENU_ID) return;
    void notifyActiveTab(tab?.id);
  });

  // Returning a promise IS the webextension-polyfill contract for an async
  // reply — the `return true` + sendResponse callback style silently never
  // delivers through it. The upstream type models the callback style only.
  browser.runtime.onMessage.addListener(
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    (message: unknown, sender): Promise<unknown> | undefined => {
      // Principle 3. There is no `externally_connectable`, so a web page cannot
      // reach us — but another *extension* can, and an unvalidated listener
      // would happily read settings or start a paid API call on its behalf.
      if (!isTrustedSender(sender)) return undefined;
      if (!isRequest(message)) return undefined;

      // Return the promise itself. WXT ships the webextension-polyfill, whose
      // contract is promise-based — the `return true` + sendResponse callback
      // style silently never delivers a reply through it.
      return handle(message, sender.tab?.id, sender.frameId).catch(
        (error: unknown) => {
          console.error('[promptamp]', error);
          return undefined;
        },
      );
    },
  );
});

/**
 * Nudge the content script in the frontmost tab.
 *
 * Failure is expected and ignored: the page may be a chrome:// URL, a PDF, or
 * a site the user hid PromptAmp on — none of which have a listener, and none
 * of which are worth an error.
 */
async function notifyActiveTab(tabId?: number): Promise<void> {
  let target = tabId;
  if (target === undefined) {
    const [tab] = await browser.tabs.query({
      active: true,
      currentWindow: true,
    });
    target = tab?.id;
  }
  if (target === undefined) return;
  try {
    await browser.tabs.sendMessage(target, { type: TRIGGER_ENHANCE });
  } catch {
    // No content script in that tab.
  }
}

function isRequest(value: unknown): value is Request {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    typeof value.type === 'string'
  );
}

async function handle(
  message: Request,
  tabId: number | undefined,
  frameId: number | undefined,
): Promise<unknown> {
  switch (message.type) {
    case 'insert:mainWorld':
      return insertInMainWorld(message.text, tabId, frameId);

    case 'settings:get':
      return getSettings();

    case 'settings:patch':
      return patchSettings(message.patch);

    case 'siteRule:get':
      return getSiteRule(message.origin);

    case 'siteRule:patch':
      return patchSiteRule(message.origin, message.patch);

    case 'profiles:list':
      return listProfiles();

    case 'profile:resolve': {
      const { profile, auto } = await resolveProfile(message.origin);
      return { profile, auto };
    }

    case 'connection:test':
      return testConnection(message.connectionId);

    case 'history:list':
      return getHistory();

    case 'history:clear':
      await historyItem.setValue([]);
      return undefined;

    case 'session:hideOrigin': {
      const hidden = (await sessionHiddenOriginsItem.getValue()) ?? [];
      if (!hidden.includes(message.origin)) {
        await sessionHiddenOriginsItem.setValue([...hidden, message.origin]);
      }
      return undefined;
    }

    case 'session:isOriginHidden': {
      const hidden = (await sessionHiddenOriginsItem.getValue()) ?? [];
      return hidden.includes(message.origin);
    }

    /* ---- options page ---- */

    case 'connections:list':
      return publicConnections();

    case 'connection:save': {
      // `saveConnection` merges an omitted key with the stored one — the
      // options page renders a masked field and never round-trips the value.
      await saveConnection(message.connection);
      return await publicConnections();
    }

    case 'connection:delete': {
      await deleteConnection(message.connectionId);
      return await publicConnections();
    }

    case 'connections:reorder': {
      await reorderConnections(message.ids);
      return await publicConnections();
    }

    case 'connection:models':
      return listModels(message.connectionId);

    case 'connection:usage':
      return fetchUsage(message.connectionId);

    case 'connection:connectOpenRouter': {
      try {
        const key = await connectOpenRouter();
        const id = crypto.randomUUID();
        await saveConnection({
          id,
          providerId: 'openrouter',
          label: 'OpenRouter',
          apiKey: key,
          model: getProvider('openrouter').defaultModel,
          authMethod: 'oauth',
        });
        return await testConnection(id);
      } catch (error) {
        return { ok: false, error: toSafeError(error) };
      }
    }

    case 'profiles:save': {
      const parsed = profileSchema.parse({
        ...message.profile,
        builtIn: false,
      });
      const custom = await getCustomProfiles();
      const next = custom.filter((p) => p.id !== parsed.id);
      next.push(parsed);
      await customProfilesItem.setValue(next);
      return listProfiles();
    }

    case 'profiles:delete': {
      const custom = await getCustomProfiles();
      await customProfilesItem.setValue(
        custom.filter((p) => p.id !== message.profileId),
      );
      return listProfiles();
    }

    case 'profiles:import': {
      // Untrusted input: a pasted file could be anything at all.
      const parsed = profileImportSchema.safeParse(
        JSON.parse(message.json) as unknown,
      );
      if (!parsed.success) {
        return {
          added: 0,
          error: 'That file is not a PromptAmp profile export.',
        };
      }
      const custom = await getCustomProfiles();
      // A built-in id must never be shadowed by an import.
      const incoming = parsed.data.profiles
        .filter((p) => !builtinProfile(p.id))
        .map((p) => ({ ...p, builtIn: false }));
      const merged = [
        ...custom.filter((p) => !incoming.some((i) => i.id === p.id)),
        ...incoming,
      ];
      await customProfilesItem.setValue(merged);
      return { added: incoming.length };
    }

    case 'profiles:export':
      return JSON.stringify(
        { version: 1, profiles: await getCustomProfiles() },
        null,
        2,
      );

    case 'siteRules:list':
      return (await siteRulesItem.getValue()) ?? {};

    case 'history:export':
      return JSON.stringify(await getHistory(), null, 2);
  }
}

/**
 * Runs the tier-4 adapter in the page's own JavaScript world.
 *
 * `world: 'MAIN'` is the only way to touch a Monaco or CodeMirror instance
 * API, and only the worker can request it — a content script is permanently
 * isolated. `activeTab` covers the permission, so this never widens what the
 * extension can reach.
 */
async function insertInMainWorld(
  text: string,
  tabId: number | undefined,
  frameId: number | undefined,
): Promise<boolean> {
  if (tabId === undefined) return false;
  try {
    const results = await browser.scripting.executeScript({
      target: {
        tabId,
        ...(frameId === undefined ? {} : { frameIds: [frameId] }),
      },
      world: 'MAIN',
      func: mainWorldInsertFunction,
      args: [text],
    });
    return results.some((entry) => entry.result === true);
  } catch {
    // Injection refused (a restricted page, or the tab navigated away). The
    // engine falls through to the next tier.
    return false;
  }
}
