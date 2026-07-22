import { type MessageKey, en } from './en';
import { fa } from './fa';

export type { MessageKey, Messages } from './en';

/**
 * Translation, sized to the problem.
 *
 * Two locales and ~180 strings do not need a framework: a typed record and a
 * placeholder substitution cover it, and every key is checked at build time
 * because `fa` is declared as `Messages`.
 *
 * The catalogue is loaded synchronously from a module rather than fetched,
 * because the content script has to render the button on the first frame — an
 * awaited locale would mean a visible flash of English on every page load.
 * Both locales together are a few kilobytes, which is cheaper than the flash.
 */

export type LocaleId = 'en' | 'fa';

const CATALOGUES: Record<LocaleId, Record<MessageKey, string>> = { en, fa };

/** Right-to-left locales, for chrome mirroring. */
const RTL: ReadonlySet<LocaleId> = new Set<LocaleId>(['fa']);

let current: LocaleId = 'en';

/**
 * Resolve `auto` against the browser's languages.
 *
 * Matches on the primary subtag, so `fa-IR` and `fa-AF` both find `fa` — a
 * user whose browser is set to a regional variant should not silently fall
 * back to English.
 */
export function resolveLocale(setting: 'auto' | LocaleId): LocaleId {
  if (setting !== 'auto') return setting;

  const preferred =
    typeof navigator === 'undefined' ? [] : (navigator.languages ?? []);
  for (const tag of preferred) {
    const primary = tag.split('-')[0]?.toLowerCase();
    if (primary && primary in CATALOGUES) return primary as LocaleId;
  }
  return 'en';
}

export function setLocale(setting: 'auto' | LocaleId): LocaleId {
  current = resolveLocale(setting);
  return current;
}

export function getLocale(): LocaleId {
  return current;
}

export function isRtl(locale: LocaleId = current): boolean {
  return RTL.has(locale);
}

export function dirFor(locale: LocaleId = current): 'rtl' | 'ltr' {
  return isRtl(locale) ? 'rtl' : 'ltr';
}

/**
 * Look up a message, substituting `{name}` placeholders.
 *
 * Named rather than positional because translated sentences reorder their
 * parts — Persian routinely puts the object before the verb, and `%s` cannot
 * survive that.
 */
export function t(
  key: MessageKey,
  vars?: Record<string, string | number>,
): string {
  const template = CATALOGUES[current][key];
  if (!vars) return template;

  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = vars[name];
    // Leaving the placeholder visible beats silently dropping it: a missing
    // substitution is a bug, and "{n} models" in a screenshot gets fixed.
    return value === undefined ? whole : formatNumber(value);
  });
}

/**
 * Numbers in the locale's own digits.
 *
 * A Persian interface that renders "۱۲ مدل" everywhere except a count is
 * jarring in exactly the way that reads as machine translation. `Intl` already
 * knows the digit sets, so this is a formatting call, not a lookup table.
 */
export function formatNumber(value: string | number): string {
  if (typeof value === 'string') return value;
  return new Intl.NumberFormat(current === 'fa' ? 'fa-IR' : 'en-US').format(
    value,
  );
}

/**
 * Apply a locale to a document: language for screen readers and hyphenation,
 * direction for layout mirroring.
 */
export function applyLocaleToDocument(doc: Document = document): void {
  doc.documentElement.lang = current;
  doc.documentElement.dir = dirFor();
}
