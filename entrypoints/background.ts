import { browser, defineBackground } from '#imports';
import { listProfiles, resolveProfile } from '../lib/enhance/resolve';
import { isTrustedSender, type Request } from '../lib/messaging/protocol';
import { testProvider } from '../lib/providers';
import {
  getHistory,
  getSettings,
  getSiteRule,
  historyItem,
  patchSettings,
  patchSiteRule,
  sessionHiddenOriginsItem,
} from '../lib/storage/items';

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
  browser.runtime.onMessage.addListener(
    (message: unknown, sender, sendResponse: (value: unknown) => void) => {
      // Principle 3. There is no `externally_connectable`, so a web page cannot
      // reach us — but another *extension* can, and an unvalidated listener
      // would happily read settings or start a paid API call on its behalf.
      if (!isTrustedSender(sender)) return false;
      if (!isRequest(message)) return false;

      handle(message).then(sendResponse, (error: unknown) => {
        console.error('[promptamp]', error);
        sendResponse(undefined);
      });

      // Keeps the message channel open for the async handler above.
      return true;
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

async function handle(message: Request): Promise<unknown> {
  switch (message.type) {
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
  }
}
