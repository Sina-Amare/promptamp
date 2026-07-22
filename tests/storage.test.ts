import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import {
  SETTINGS_DEFAULT,
  addHistoryEntry,
  customProfilesItem,
  getCustomProfiles,
  getHistory,
  getSettings,
  getSiteRule,
  historyItem,
  patchSettings,
  patchSiteRule,
  settingsItem,
  siteRulesItem,
} from '../lib/storage/items';
import {
  deleteCredential,
  getCredential,
  listConfiguredProviders,
  redactKeys,
  setCredential,
} from '../lib/storage/credentials';
import {
  type HistoryEntry,
  profileImportSchema,
  profileSchema,
  settingsSchema,
  siteRuleSchema,
} from '../lib/storage/schemas';

beforeEach(() => {
  fakeBrowser.reset();
});

describe('settings', () => {
  it('returns defaults when storage is empty', async () => {
    expect(await getSettings()).toEqual(SETTINGS_DEFAULT);
  });

  it('round-trips a patch without dropping untouched fields', async () => {
    await patchSettings({ softCapPerDay: 25 });
    const settings = await getSettings();
    expect(settings.softCapPerDay).toBe(25);
    expect(settings.defaultProfileId).toBe(SETTINGS_DEFAULT.defaultProfileId);
    expect(settings.historyEnabled).toBe(SETTINGS_DEFAULT.historyEnabled);
  });

  it('falls back to defaults when storage holds garbage', async () => {
    // A downgrade, a botched import, or a hand-edited profile can all produce
    // this. It must not throw — principle 8.
    await settingsItem.setValue({ softCapPerDay: 'lots' } as never);
    expect(await getSettings()).toEqual(SETTINGS_DEFAULT);
  });

  it('rejects an out-of-range soft cap rather than persisting it', async () => {
    await expect(patchSettings({ softCapPerDay: -5 })).rejects.toThrow();
    expect((await getSettings()).softCapPerDay).toBe(
      SETTINGS_DEFAULT.softCapPerDay,
    );
  });
});

describe('site rules', () => {
  it('defaults to visible, unpinned, unpositioned', async () => {
    expect(await getSiteRule('https://example.com')).toEqual({
      hidden: false,
      pinnedProfileId: null,
      buttonCorner: null,
    });
  });

  it('keeps rules isolated per origin', async () => {
    await patchSiteRule('https://a.com', { hidden: true });
    await patchSiteRule('https://b.com', { pinnedProfileId: 'image' });

    expect((await getSiteRule('https://a.com')).hidden).toBe(true);
    expect((await getSiteRule('https://b.com')).hidden).toBe(false);
    expect((await getSiteRule('https://b.com')).pinnedProfileId).toBe('image');
  });

  it('merges patches instead of replacing the rule', async () => {
    await patchSiteRule('https://a.com', { hidden: true });
    await patchSiteRule('https://a.com', { buttonCorner: 'top-start' });

    const rule = await getSiteRule('https://a.com');
    expect(rule.hidden).toBe(true);
    expect(rule.buttonCorner).toBe('top-start');
  });

  it('survives a corrupt entry for one origin', async () => {
    await siteRulesItem.setValue({
      'https://bad.com': { hidden: 'yes' },
    } as never);
    expect((await getSiteRule('https://bad.com')).hidden).toBe(false);
  });
});

describe('profiles', () => {
  const valid = {
    id: 'custom-1',
    name: 'My profile',
    description: 'Test',
    category: 'chat' as const,
    systemPrompt: 'Rewrite the draft.',
    outputLanguage: 'same-language' as const,
    builtIn: false,
  };

  it('drops only the corrupt profile, keeping the rest', async () => {
    await customProfilesItem.setValue([
      valid,
      { id: 'broken' },
      { ...valid, id: 'custom-2' },
    ] as never);

    const profiles = await getCustomProfiles();
    expect(profiles.map((p) => p.id)).toEqual(['custom-1', 'custom-2']);
  });

  it('rejects an oversized system prompt', () => {
    const result = profileSchema.safeParse({
      ...valid,
      systemPrompt: 'x'.repeat(20_001),
    });
    expect(result.success).toBe(false);
  });

  it('rejects an import with the wrong version', () => {
    expect(
      profileImportSchema.safeParse({ version: 2, profiles: [valid] }).success,
    ).toBe(false);
  });

  it('rejects an import with too many profiles', () => {
    expect(
      profileImportSchema.safeParse({
        version: 1,
        profiles: Array.from({ length: 101 }, (_, i) => ({
          ...valid,
          id: `p${String(i)}`,
        })),
      }).success,
    ).toBe(false);
  });
});

describe('history', () => {
  const entry = (id: string): HistoryEntry => ({
    id,
    at: 1_700_000_000_000,
    origin: 'https://example.com',
    profileId: 'general',
    providerId: 'mock',
    model: 'mock-1',
    original: 'draft',
    enhanced: 'better draft',
  });

  it('stores newest first', async () => {
    await addHistoryEntry(entry('a'));
    await addHistoryEntry(entry('b'));
    expect((await getHistory()).map((e) => e.id)).toEqual(['b', 'a']);
  });

  it('trims to the configured limit', async () => {
    await patchSettings({ historyLimit: 2 });
    await addHistoryEntry(entry('a'));
    await addHistoryEntry(entry('b'));
    await addHistoryEntry(entry('c'));
    expect((await getHistory()).map((e) => e.id)).toEqual(['c', 'b']);
  });

  it('writes nothing when history is disabled', async () => {
    await patchSettings({ historyEnabled: false });
    await addHistoryEntry(entry('a'));
    expect(await getHistory()).toEqual([]);
  });

  it('writes nothing when the limit is zero', async () => {
    await patchSettings({ historyLimit: 0 });
    await addHistoryEntry(entry('a'));
    expect(await getHistory()).toEqual([]);
  });

  it('skips corrupt entries on read', async () => {
    await historyItem.setValue([entry('a'), { id: 'nope' }] as never);
    expect((await getHistory()).map((e) => e.id)).toEqual(['a']);
  });
});

describe('credentials', () => {
  const cred = {
    apiKey: 'sk-test-abcdefghijklmnop',
    model: 'gpt-4o-mini',
    authMethod: 'manual' as const,
    addedAt: 1_700_000_000_000,
  };

  it('round-trips a credential', async () => {
    await setCredential('openai', cred);
    expect(await getCredential('openai')).toEqual(cred);
  });

  it('returns null for an unconfigured provider', async () => {
    expect(await getCredential('groq')).toBeNull();
  });

  it('deletes without disturbing other providers', async () => {
    await setCredential('openai', cred);
    await setCredential('groq', { ...cred, model: 'llama-3.3-70b' });
    await deleteCredential('openai');

    expect(await getCredential('openai')).toBeNull();
    expect((await getCredential('groq'))?.model).toBe('llama-3.3-70b');
  });

  it('never exposes key material when listing providers', async () => {
    await setCredential('openai', cred);
    const listed = await listConfiguredProviders();

    expect(listed).toEqual([
      {
        providerId: 'openai',
        model: 'gpt-4o-mini',
        authMethod: 'manual',
        // The fact of a key, never the key itself.
        hasKey: true,
      },
    ]);
    expect(JSON.stringify(listed)).not.toContain('sk-test');
  });

  it('allows a keyless credential for local runners', async () => {
    await setCredential('ollama', {
      model: 'llama3.2',
      baseUrl: 'http://localhost:11434',
      authMethod: 'manual',
      addedAt: 1,
    });
    expect((await getCredential('ollama'))?.apiKey).toBeUndefined();
  });
});

describe('redactKeys', () => {
  it.each([
    ['sk-proj-abcdefghijklmnopqrstuv', 'sk-'],
    ['sk-ant-api03-abcdefghijklmnop', 'sk-ant-'],
    ['gsk_abcdefghijklmnopqrstuv', 'gsk_'],
    ['sk-or-v1-abcdefghijklmnopqrst', 'sk-or-v1-'],
    ['AIzaSyAbcdefghijklmnopqrstuv', 'AIza'],
  ])('redacts %s but keeps the prefix', (key, prefix) => {
    const out = redactKeys(`request failed with key ${key}`);
    expect(out).toContain(`${prefix}[redacted]`);
    expect(out).not.toContain(key);
  });

  it('redacts bearer tokens in header echoes', () => {
    const out = redactKeys('Authorization: Bearer abcdefghijklmnopqrstuvwxyz');
    expect(out).toBe('Authorization: Bearer [redacted]');
  });

  it('leaves ordinary text alone', () => {
    expect(redactKeys('the model declined to rewrite this draft')).toBe(
      'the model declined to rewrite this draft',
    );
  });
});

describe('schema defaults', () => {
  it('fills every settings field from an empty object', () => {
    const parsed = settingsSchema.parse({});
    for (const [key, value] of Object.entries(parsed)) {
      expect(value, `${key} should have a default`).toBeDefined();
    }
  });

  it('fills every site-rule field from an empty object', () => {
    expect(siteRuleSchema.parse({})).toEqual({
      hidden: false,
      pinnedProfileId: null,
      buttonCorner: null,
    });
  });
});
