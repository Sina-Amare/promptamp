import { browser, defineBackground } from '#imports';
import { builtinProfile } from '../lib/enhance/prompts';
import { listProfiles, resolveProfile } from '../lib/enhance/resolve';
import { runEnhancement, toSafeError } from '../lib/enhance/run';
import { mainWorldInsertFunction } from '../lib/insertion/main-world';
import {
  ENHANCE_PORT,
  isTrustedSender,
  type EnhanceClientMessage,
  type EnhanceServerMessage,
  type Request,
} from '../lib/messaging/protocol';
import { getProvider, listModels, testProvider } from '../lib/providers';
import { connectOpenRouter } from '../lib/providers/oauth-openrouter';
import {
  deleteCredential,
  getCredential,
  listConfiguredProviders,
  setCredential,
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
      })
        .then((result) => {
          finished = true;
          post({ type: 'done', result });
        })
        .catch((error: unknown) => {
          finished = true;
          // Every failure is mapped and redacted before it crosses back — a
          // raw provider message can echo the API key.
          post({ type: 'error', error: toSafeError(error) });
        });
    });
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

    case 'provider:test':
      return testProvider(message.providerId);

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

    case 'providers:list':
      return listConfiguredProviders();

    case 'provider:save': {
      const existing = await getCredential(message.providerId);
      await setCredential(message.providerId, {
        // An empty key means "leave the saved one alone" — the options page
        // renders a masked field and never round-trips the real value.
        ...(message.apiKey
          ? { apiKey: message.apiKey }
          : existing?.apiKey
            ? { apiKey: existing.apiKey }
            : {}),
        model: message.model,
        ...(message.baseUrl ? { baseUrl: message.baseUrl } : {}),
        authMethod: existing?.authMethod ?? 'manual',
        addedAt: existing?.addedAt ?? Date.now(),
      });
      // First provider configured becomes the active one, so a new user is not
      // left with a working key and nothing selected.
      const settings = await getSettings();
      if (!settings.activeProviderId) {
        await patchSettings({ activeProviderId: message.providerId });
      }
      return undefined;
    }

    case 'provider:delete': {
      await deleteCredential(message.providerId);
      const settings = await getSettings();
      if (settings.activeProviderId === message.providerId) {
        const remaining = await listConfiguredProviders();
        await patchSettings({
          activeProviderId: remaining[0]?.providerId ?? null,
        });
      }
      return undefined;
    }

    case 'provider:models':
      return listModels(message.providerId);

    case 'provider:connectOpenRouter': {
      try {
        const key = await connectOpenRouter();
        await setCredential('openrouter', {
          apiKey: key,
          model: getProvider('openrouter').defaultModel,
          authMethod: 'oauth',
          addedAt: Date.now(),
        });
        const settings = await getSettings();
        if (!settings.activeProviderId) {
          await patchSettings({ activeProviderId: 'openrouter' });
        }
        return await testProvider('openrouter');
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
