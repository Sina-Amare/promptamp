import { afterEach, describe, expect, it, vi } from 'vitest';
import { en } from '../lib/i18n/en';
import { fa } from '../lib/i18n/fa';
import {
  dirFor,
  formatNumber,
  isRtl,
  resolveLocale,
  setLocale,
  t,
} from '../lib/i18n';

/**
 * The parts of translation that a type checker cannot catch: placeholders that
 * were dropped in translation, digits that stayed Latin in a Persian UI, and
 * an `auto` setting that ignores a regional browser locale.
 */

afterEach(() => {
  setLocale('en');
  vi.unstubAllGlobals();
});

const KEYS = Object.keys(en) as (keyof typeof en)[];

function placeholders(text: string): string[] {
  return [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();
}

describe('catalogue integrity', () => {
  it('translates every key', () => {
    // The type system enforces this too; the test states it in the failure
    // output, which is what a translator will actually read.
    expect(Object.keys(fa).sort()).toEqual(KEYS.slice().sort());
  });

  it.each(KEYS)('keeps the placeholders of %s', (key) => {
    // A dropped {name} renders a sentence with a hole in it, and no type
    // checker can see it.
    expect(placeholders(fa[key])).toEqual(placeholders(en[key]));
  });

  it('leaves no string empty', () => {
    for (const key of KEYS) expect(fa[key].trim().length).toBeGreaterThan(0);
  });

  it('keeps product names and shortcuts in Latin script', () => {
    // Transliterating these makes them unrecognisable and unsearchable.
    expect(fa['button.dismiss']).toContain('PromptAmp');
    expect(fa['conn.oauthButton']).toContain('OpenRouter');
    expect(fa['behavior.shortcutHint']).toContain('Alt+E');
  });

  it('actually translates, rather than copying English through', () => {
    const identical = KEYS.filter((key) => fa[key] === en[key]);
    expect(identical).toEqual([]);
  });
});

describe('locale resolution', () => {
  it('honours an explicit choice over the browser', () => {
    // The whole reason this is not browser.i18n: a Persian speaker on an
    // English browser gets to choose.
    vi.stubGlobal('navigator', { languages: ['en-US'] });
    expect(resolveLocale('fa')).toBe('fa');
  });

  it.each([
    [['fa-IR', 'en-US'], 'fa'],
    [['fa'], 'fa'],
    [['fa-AF'], 'fa'],
    [['de-DE', 'fa-IR'], 'fa'],
    [['de-DE'], 'en'],
    [[], 'en'],
  ])('resolves auto against %o as %s', (languages, expected) => {
    vi.stubGlobal('navigator', { languages });
    expect(resolveLocale('auto')).toBe(expected);
  });
});

describe('direction', () => {
  it('mirrors the chrome for Persian', () => {
    expect(isRtl('fa')).toBe(true);
    expect(dirFor('fa')).toBe('rtl');
  });

  it('leaves English alone', () => {
    expect(dirFor('en')).toBe('ltr');
  });
});

describe('interpolation', () => {
  it('substitutes named placeholders', () => {
    setLocale('en');
    expect(t('conn.fallback', { n: 2 })).toBe('Fallback 2');
  });

  it('renders Persian digits in a Persian interface', () => {
    // Latin digits inside Persian text is the tell of a machine translation.
    setLocale('fa');
    expect(t('conn.fallback', { n: 2 })).toContain('۲');
    expect(formatNumber(1234)).toBe('۱٬۲۳۴');
  });

  it('keeps a placeholder visible when nothing was supplied', () => {
    // A hole that shows up in a screenshot gets fixed; a silently dropped one
    // does not.
    setLocale('en');
    expect(t('conn.fallback', {})).toBe('Fallback {n}');
  });

  it('passes string values through unchanged', () => {
    setLocale('fa');
    // Model names and hostnames are identifiers, not numbers to localise.
    expect(t('conn.working', { model: 'gpt-4o-mini' })).toContain(
      'gpt-4o-mini',
    );
  });
});
