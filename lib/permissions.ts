import { browser } from '#imports';
import { PROVIDERS } from './providers/registry';
import type { ProviderId } from './storage/schemas';

/**
 * Host-permission onboarding — a Firefox problem, handled everywhere.
 *
 * Chrome grants `host_permissions` at install. Firefox MV3 does not: they are
 * optional by default, and the user has to approve them. Without that step a
 * perfectly valid API key produces nothing but network errors, with no
 * indication of why — the single worst failure mode this extension has,
 * because it looks exactly like a broken key.
 *
 * So we check, and ask. On Chrome the check simply always passes and no UI is
 * ever shown, which keeps one code path rather than a browser fork.
 */

/**
 * The host patterns a provider needs before it can be called.
 *
 * `baseUrl` overrides the registry default, which is what the custom provider
 * and the local runners need — their real host is whatever the user typed, and
 * the permission has to match *that*, not a placeholder.
 */
export function originsFor(providerId: ProviderId, baseUrl?: string): string[] {
  const config = PROVIDERS[providerId];
  if (config.kind === 'mock') return [];
  try {
    const url = new URL(baseUrl ?? config.baseUrl);
    return [`${url.protocol}//${url.hostname}/*`];
  } catch {
    // A half-typed URL is not something to request a permission for.
    return [];
  }
}

export async function hasPermission(
  providerId: ProviderId,
  baseUrl?: string,
): Promise<boolean> {
  const origins = originsFor(providerId, baseUrl);
  if (origins.length === 0) return true;
  try {
    return await browser.permissions.contains({ origins });
  } catch {
    // Older browsers without the API behave like Chrome: granted at install.
    return true;
  }
}

/**
 * Must be called from a user gesture in an extension page — Firefox rejects a
 * request that did not come from a click, and a worker cannot show the prompt
 * at all.
 */
export async function requestPermission(
  providerId: ProviderId,
  baseUrl?: string,
): Promise<boolean> {
  const origins = originsFor(providerId, baseUrl);
  if (origins.length === 0) return true;
  try {
    return await browser.permissions.request({ origins });
  } catch {
    return false;
  }
}

/** Providers that are configured but cannot actually be reached yet. */
export async function missingPermissions(
  providers: { providerId: ProviderId; baseUrl?: string }[],
): Promise<ProviderId[]> {
  const checks = await Promise.all(
    providers.map(async (entry) => ({
      id: entry.providerId,
      ok: await hasPermission(entry.providerId, entry.baseUrl),
    })),
  );
  return checks.filter((entry) => !entry.ok).map((entry) => entry.id);
}
