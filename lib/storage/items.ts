import { storage } from '#imports';
import {
  type HistoryEntry,
  type Profile,
  type Settings,
  type SiteRule,
  type SoftCapCounter,
  historyEntrySchema,
  profileSchema,
  settingsSchema,
  siteRuleSchema,
  softCapCounterSchema,
  parseOrDefault,
} from './schemas';

/**
 * Non-secret persisted state. API keys deliberately live somewhere else — see
 * `lib/storage/credentials.ts`, which only the background worker may import.
 *
 * Versioning is WXT's: `defineItem({ version, migrations })` runs the migration
 * chain automatically on extension update, so there is no hand-rolled runner to
 * forget to call. To change a shape: bump `version` and add the function that
 * moves the old value forward under that number.
 */

export const SETTINGS_DEFAULT: Settings = settingsSchema.parse({});

export const settingsItem = storage.defineItem<Settings>('local:settings', {
  fallback: SETTINGS_DEFAULT,
  version: 1,
});

/** Custom profiles only. Built-ins live in code so they can be improved by update. */
export const customProfilesItem = storage.defineItem<Profile[]>(
  'local:customProfiles',
  { fallback: [], version: 1 },
);

/** Keyed by origin (`https://example.com`), never by full URL. */
export const siteRulesItem = storage.defineItem<Record<string, SiteRule>>(
  'local:siteRules',
  { fallback: {}, version: 1 },
);

/** Newest first. Trimmed to `settings.historyLimit` on write. */
export const historyItem = storage.defineItem<HistoryEntry[]>('local:history', {
  fallback: [],
  version: 1,
});

export const softCapItem = storage.defineItem<SoftCapCounter>('local:softCap', {
  fallback: { day: '1970-01-01', count: 0 },
  version: 1,
});

/**
 * "Hide until next visit" (UX-SPEC §1.5, option 1). Session area, so it dies
 * with the browser session exactly as the label promises — putting this in
 * `local` would silently turn a temporary hide into a permanent one.
 */
export const sessionHiddenOriginsItem = storage.defineItem<string[]>(
  'session:hiddenOrigins',
  { fallback: [] },
);

/* ------------------------------------------------------------------ *
 * Validated accessors
 *
 * Storage can hand back anything: a value written by a newer version the
 * user downgraded from, a half-finished sync, a hand-edited profile. Every
 * read is re-validated so a bad value degrades to a default rather than
 * propagating a malformed object into the worker.
 * ------------------------------------------------------------------ */

export async function getSettings(): Promise<Settings> {
  return parseOrDefault(
    settingsSchema,
    await settingsItem.getValue(),
    SETTINGS_DEFAULT,
  );
}

export async function patchSettings(
  patch: Partial<Settings>,
): Promise<Settings> {
  const next = settingsSchema.parse({ ...(await getSettings()), ...patch });
  await settingsItem.setValue(next);
  return next;
}

export async function getCustomProfiles(): Promise<Profile[]> {
  const raw = await customProfilesItem.getValue();
  if (!Array.isArray(raw)) return [];
  // One corrupt profile must not discard the user's other profiles.
  return raw.flatMap((entry) => {
    const parsed = profileSchema.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  });
}

export async function getSiteRule(origin: string): Promise<SiteRule> {
  const rules = await siteRulesItem.getValue();
  return parseOrDefault(
    siteRuleSchema,
    rules?.[origin],
    siteRuleSchema.parse({}),
  );
}

export async function patchSiteRule(
  origin: string,
  patch: Partial<SiteRule>,
): Promise<SiteRule> {
  const rules = (await siteRulesItem.getValue()) ?? {};
  const next = siteRuleSchema.parse({
    ...(await getSiteRule(origin)),
    ...patch,
  });
  await siteRulesItem.setValue({ ...rules, [origin]: next });
  return next;
}

export async function getHistory(): Promise<HistoryEntry[]> {
  const raw = await historyItem.getValue();
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    const parsed = historyEntrySchema.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  });
}

export async function addHistoryEntry(entry: HistoryEntry): Promise<void> {
  const settings = await getSettings();
  if (!settings.historyEnabled || settings.historyLimit === 0) return;
  const next = [entry, ...(await getHistory())].slice(0, settings.historyLimit);
  await historyItem.setValue(next);
}

export async function getSoftCap(): Promise<SoftCapCounter> {
  return parseOrDefault(softCapCounterSchema, await softCapItem.getValue(), {
    day: '1970-01-01',
    count: 0,
  });
}
