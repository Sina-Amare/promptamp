import { describe, expect, it } from 'vitest';
import config from '../wxt.config';

/**
 * These are guards, not documentation. Principle 11 says the API host list stays
 * narrow and separate from the content script's match list — the easiest way to
 * violate that is a well-meaning "just add <all_urls> to host_permissions" that
 * nobody notices in review. This test fails loudly if that happens.
 */
describe('manifest', () => {
  const manifest = config.manifest;

  // The manifest may be declared as an object, a function, or a promise. Ours
  // is a static object on purpose: a reviewer can read the permissions without
  // executing anything. Narrow here so the assertions below stay type-safe.
  if (
    typeof manifest !== 'object' ||
    manifest === null ||
    manifest instanceof Promise
  ) {
    throw new Error('wxt.config.ts must export a static manifest object');
  }

  const hostPermissions = manifest.host_permissions ?? [];
  const permissions = manifest.permissions ?? [];

  it('never grants broad host permissions to the worker', () => {
    for (const host of hostPermissions) {
      expect(host).not.toBe('<all_urls>');
      expect(host).not.toMatch(/^\*:\/\/\*\//);
      expect(host).not.toMatch(/^https?:\/\/\*\/\*$/);
    }
  });

  it('only reaches provider APIs and local model runners', () => {
    const allowedHosts = [
      'api.openai.com',
      'api.anthropic.com',
      'api.groq.com',
      'openrouter.ai',
      'generativelanguage.googleapis.com',
      'localhost',
      '127.0.0.1',
    ];

    for (const host of hostPermissions) {
      const { hostname } = new URL(host.replace('/*', '/'));
      expect(allowedHosts).toContain(hostname);
    }
  });

  it('requests no permission beyond the documented set', () => {
    // Adding one here means updating the store listing's justification text.
    expect([...permissions].sort()).toEqual([
      'activeTab',
      'commands',
      'contextMenus',
      'identity',
      'scripting',
      'storage',
    ]);
  });

  it('declares no permission that implies a backend or analytics', () => {
    for (const banned of ['webRequest', 'cookies', 'history', 'management']) {
      expect(permissions).not.toContain(banned);
    }
  });

  it('declares Firefox data collection for AMO', () => {
    const gecko = manifest.browser_specific_settings?.gecko;
    expect(gecko?.id).toBeTruthy();
    expect(gecko?.data_collection_permissions?.required).toEqual([
      'websiteContent',
      'authenticationInfo',
    ]);
  });

  it('has no auto-imports enabled', () => {
    // Explicit imports are a reviewability guarantee, not a style preference.
    expect(config.imports).toBe(false);
  });
});
