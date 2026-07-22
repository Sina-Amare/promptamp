import { getCustomProfiles, getSettings, getSiteRule } from '../storage/items';
import type { Profile } from '../storage/schemas';
import {
  BUILTIN_PROFILES,
  DEFAULT_PROFILE_ID,
  builtinProfile,
} from './prompts';

/**
 * Which profile to use, and whether the system chose it.
 *
 * Precedence, highest first (UX-SPEC §3):
 *   1. The user picked one in this panel — always wins.
 *   2. The user pinned one for this origin ("On this site, use…").
 *   3. The site map, when auto-selection is on.
 *   4. The configured default.
 *
 * Only case 3 counts as `auto`, which is what puts the "· auto" suffix on the
 * chip. A pin is still the user's choice even though they made it earlier.
 */

/**
 * Registrable-domain fragments → profile id. Matched as suffixes so
 * `chat.openai.com` and `openai.com` both resolve, without a PSL dependency.
 */
const SITE_MAP: readonly (readonly [string, string])[] = [
  // Conversational assistants
  ['chatgpt.com', 'chat'],
  ['chat.openai.com', 'chat'],
  ['claude.ai', 'chat'],
  ['gemini.google.com', 'chat'],
  ['perplexity.ai', 'chat'],
  ['chat.deepseek.com', 'chat'],
  ['copilot.microsoft.com', 'chat'],
  ['grok.com', 'chat'],
  ['poe.com', 'chat'],

  // Image generators
  ['midjourney.com', 'image'],
  ['ideogram.ai', 'image'],
  ['leonardo.ai', 'image'],
  ['firefly.adobe.com', 'image'],
  ['civitai.com', 'image'],

  // Video generators
  ['runwayml.com', 'video'],
  ['klingai.com', 'video'],
  ['pika.art', 'video'],
  ['sora.com', 'video'],
  ['lumalabs.ai', 'video'],

  // App builders and code hosts
  ['bolt.new', 'coding'],
  ['v0.app', 'coding'],
  ['v0.dev', 'coding'],
  ['lovable.dev', 'coding'],
  ['replit.com', 'coding'],
  ['github.com', 'coding'],
  ['gitlab.com', 'coding'],
  ['stackoverflow.com', 'coding'],

  // Writing surfaces
  ['mail.google.com', 'writing'],
  ['outlook.live.com', 'writing'],
  ['outlook.office.com', 'writing'],
  ['linkedin.com', 'writing'],
  ['substack.com', 'writing'],
  ['medium.com', 'writing'],
];

/**
 * Discord only means "image prompt" inside a Midjourney channel, and a content
 * script cannot read the channel name without touching the page. Left off the
 * map deliberately: a wrong auto-profile is worse than none, and the user can
 * pin Discord to Image in one tap.
 */

export function profileIdForHost(hostname: string): string | undefined {
  const host = hostname.toLowerCase().replace(/^www\./, '');
  for (const [domain, profileId] of SITE_MAP) {
    if (host === domain || host.endsWith(`.${domain}`)) return profileId;
  }
  return undefined;
}

/** Accepts an origin or a full URL; returns undefined for anything unparseable. */
export function profileIdForOrigin(origin: string): string | undefined {
  try {
    return profileIdForHost(new URL(origin).hostname);
  } catch {
    return undefined;
  }
}

export interface Resolution {
  profile: Profile;
  auto: boolean;
}

export async function listProfiles(): Promise<Profile[]> {
  // Custom profiles come last so a built-in id always wins a collision — a
  // malformed import must not be able to shadow the shipped prompts.
  return [...BUILTIN_PROFILES, ...(await getCustomProfiles())];
}

export async function findProfile(id: string): Promise<Profile | undefined> {
  return (
    builtinProfile(id) ?? (await getCustomProfiles()).find((p) => p.id === id)
  );
}

export async function resolveProfile(
  origin: string,
  explicitProfileId?: string,
): Promise<Resolution> {
  const fallback = async (): Promise<Profile> => {
    const settings = await getSettings();
    return (
      (await findProfile(settings.defaultProfileId)) ??
      builtinProfile(DEFAULT_PROFILE_ID) ??
      BUILTIN_PROFILES[0]!
    );
  };

  if (explicitProfileId) {
    const picked = await findProfile(explicitProfileId);
    if (picked) return { profile: picked, auto: false };
  }

  const rule = await getSiteRule(origin);
  if (rule.pinnedProfileId) {
    const pinned = await findProfile(rule.pinnedProfileId);
    if (pinned) return { profile: pinned, auto: false };
  }

  const settings = await getSettings();
  if (settings.autoProfile) {
    const mapped = profileIdForOrigin(origin);
    if (mapped) {
      const profile = await findProfile(mapped);
      if (profile) return { profile, auto: true };
    }
  }

  return { profile: await fallback(), auto: true };
}
