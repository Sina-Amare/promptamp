import { type MessageKey, en } from './en';

export type { MessageKey, Messages } from './en';

/**
 * Every user-facing string in one place.
 *
 * PromptAmp ships in English only. This module exists anyway for two reasons
 * that hold today, not hypothetically: UI copy is reviewable when it is a
 * single file instead of two hundred literals scattered through DOM builders,
 * and the store listing, README, and interface then quote the same wording
 * rather than drifting apart.
 *
 * Adding a locale later means adding a catalogue file typed as `Messages` and
 * a way to choose between them. That is deliberately *not* built yet — a
 * Persian locale was written, reviewed by a native speaker, and cut for
 * reading like machine translation. Shipping a second language is a
 * translation problem, not a plumbing one, and the plumbing is the easy half.
 */

/**
 * Look up a message, substituting `{name}` placeholders.
 *
 * Named rather than positional, because a translated sentence reorders its
 * parts and a `%s` cannot survive that.
 */
export function t(
  key: MessageKey,
  vars?: Record<string, string | number>,
): string {
  const template = en[key];
  if (!vars) return template;

  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = vars[name];
    // Leaving the placeholder visible beats silently dropping it: a missing
    // substitution is a bug, and "{n} models" in a screenshot gets fixed.
    return value === undefined ? whole : String(value);
  });
}
