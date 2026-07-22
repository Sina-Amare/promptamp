import { browser } from '#imports';
import type {
  HistoryEntry,
  Profile,
  ProviderId,
  Settings,
  SiteRule,
} from '../storage/schemas';

/**
 * The one contract between the content script and the worker.
 *
 * Two channels, for two different jobs:
 *
 * - **One-shot** (`sendMessage`) for everything cheap and synchronous-ish:
 *   reading settings, toggling a site rule, listing profiles.
 * - **A Port** for enhancement, because it is the only call that can take
 *   seconds and must be cancellable. Disconnecting the port aborts the
 *   in-flight fetch — that is what the Stop button does (UX-SPEC §2.3).
 */

export const ENHANCE_PORT = 'promptamp:enhance';

/* ------------------------------- errors -------------------------------- */

/**
 * The wire-level error taxonomy. Every provider failure is mapped onto one of
 * these before it crosses back, so the panel can say something specific
 * ("Rate limited — retrying in 20 s") instead of a generic failure, per
 * UX-SPEC §4. Provider-specific detail is mapped in `lib/providers/errors.ts`.
 */
export type ErrorKind =
  | 'bad-key'
  | 'rate-limited'
  | 'quota'
  | 'network'
  | 'refusal'
  | 'too-long'
  | 'soft-cap'
  | 'cancelled'
  | 'unknown';

export interface SafeError {
  kind: ErrorKind;
  /** Already redacted and safe to render. Never contains key material. */
  message: string;
  /** Seconds until a retry is worth attempting; set for `rate-limited`. */
  retryAfterSec?: number;
}

/* --------------------------- one-shot messages -------------------------- */

export type Request =
  | { type: 'settings:get' }
  | { type: 'settings:patch'; patch: Partial<Settings> }
  | { type: 'siteRule:get'; origin: string }
  | { type: 'siteRule:patch'; origin: string; patch: Partial<SiteRule> }
  | { type: 'profiles:list' }
  | { type: 'profile:resolve'; origin: string }
  | { type: 'provider:test'; providerId: ProviderId }
  | { type: 'history:list' }
  | { type: 'history:clear' }
  | { type: 'session:hideOrigin'; origin: string }
  | { type: 'session:isOriginHidden'; origin: string }
  /**
   * Insertion tier 4. Monaco and CodeMirror keep their text in a model no DOM
   * event reaches, so it has to be written by calling the editor's own API
   * from the page's JavaScript world — which only the worker can reach, via
   * `scripting.executeScript({ world: 'MAIN' })`.
   */
  | { type: 'insert:mainWorld'; text: string };

/** Which profile the panel should show, and whether the system picked it. */
export interface ResolvedProfile {
  profile: Profile;
  /** `false` once the user pinned one for this origin — drops the "auto" chip suffix. */
  auto: boolean;
}

export interface ProviderTestResult {
  ok: boolean;
  error?: SafeError;
  /** Echoed back so the options page can confirm which model answered. */
  model?: string;
}

export interface ResponseMap {
  'settings:get': Settings;
  'settings:patch': Settings;
  'siteRule:get': SiteRule;
  'siteRule:patch': SiteRule;
  'profiles:list': Profile[];
  'profile:resolve': ResolvedProfile;
  'provider:test': ProviderTestResult;
  'history:list': HistoryEntry[];
  'history:clear': void;
  'session:hideOrigin': void;
  'session:isOriginHidden': boolean;
  'insert:mainWorld': boolean;
}

export type ResponseFor<T extends Request['type']> = ResponseMap[T];

/* ----------------------------- enhance port ----------------------------- */

export interface EnhanceRequest {
  /**
   * Untrusted. Goes into the user role wrapped in <draft> tags and nowhere
   * else — never interpolated into a system prompt (principle 7).
   */
  draft: string;
  origin: string;
  /** Omit to let the worker resolve it from the site map + pins. */
  profileId?: string;
  /**
   * Free-text or preset chip from the Adjust row. Also untrusted: it is the
   * user's own words, but it still arrives from a content script.
   */
  adjust?: string;
}

export type EnhanceClientMessage =
  ({ type: 'start' } & EnhanceRequest) | { type: 'cancel' };

export interface EnhanceResult {
  text: string;
  profileId: string;
  providerId: ProviderId;
  model: string;
  promptTokens?: number;
  completionTokens?: number;
  costUsd?: number;
}

export type EnhanceServerMessage =
  /** Sent immediately so the panel can render the resolved profile chip. */
  | { type: 'accepted'; profileId: string; auto: boolean }
  | { type: 'chunk'; text: string }
  | { type: 'done'; result: EnhanceResult }
  | { type: 'error'; error: SafeError };

/* ------------------------------ sender guard ---------------------------- */

/**
 * Principle 3. Every listener calls this first.
 *
 * There is no `externally_connectable` in the manifest, so a web page cannot
 * open a port to us at all — but another *extension* can send us a message, and
 * an unvalidated listener would happily read settings or start a paid API call
 * on its behalf. `sender.id` is set by the browser and cannot be forged.
 */
export function isTrustedSender(sender: {
  id?: string | undefined;
  url?: string | undefined;
}): boolean {
  return sender.id === browser.runtime.id;
}
