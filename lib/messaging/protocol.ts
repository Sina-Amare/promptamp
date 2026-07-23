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

/**
 * Worker → content script. The keyboard shortcut and the context menu both
 * arrive at the worker, which has no DOM — the content script owns the focused
 * field, so the trigger has to be forwarded to it.
 */
export const TRIGGER_ENHANCE = 'promptamp:trigger-enhance';

/* ------------------------------- errors -------------------------------- */

/**
 * The wire-level error taxonomy. Every provider failure is mapped onto one of
 * these before it crosses back, so the panel can say something specific
 * ("Rate limited — retrying in 20 s") instead of a generic failure, per
 * UX-SPEC §4. Provider-specific detail is mapped in `lib/providers/errors.ts`.
 */
export type ErrorKind =
  | 'bad-key'
  /**
   * No model chosen, or a model the endpoint does not serve. Distinct from
   * `bad-key` because the credential is fine and the fix is a different one —
   * and a custom endpoint has no default worth guessing.
   */
  | 'bad-model'
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
  /**
   * The one concrete next step, in the user's terms. An error that names its
   * cause but not its fix still leaves the user stuck, which is the actual
   * complaint behind "the extension is broken".
   */
  remedy?: string;
  /** Seconds until a retry is worth attempting; set for `rate-limited`. */
  retryAfterSec?: number;
  /** Which connection produced this. Only meaningful with several configured. */
  connectionLabel?: string;
  /**
   * Set only when a fallback chain ran and every connection failed: what each
   * one said, in order. Without it, three different failures collapse into one
   * misleading message from whichever happened to be last.
   */
  attempts?: { label: string; kind: ErrorKind; message: string }[];
}

/* --------------------------- one-shot messages -------------------------- */

export type Request =
  | { type: 'settings:get' }
  | { type: 'settings:patch'; patch: Partial<Settings> }
  | { type: 'siteRule:get'; origin: string }
  | { type: 'siteRule:patch'; origin: string; patch: Partial<SiteRule> }
  | { type: 'profiles:list' }
  | { type: 'profile:resolve'; origin: string }
  // A candidate key/model from the options form overrides the stored one, so
  // "Test" verifies what the user is looking at — even before they save.
  | {
      type: 'connection:test';
      connectionId: string;
      apiKey?: string;
      model?: string;
    }
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
  | { type: 'insert:mainWorld'; text: string }
  /* ---- options page ---- */
  /** Metadata only — never returns key material. */
  | { type: 'connections:list' }
  | {
      type: 'connection:save';
      connection: {
        id: string;
        providerId: ProviderId;
        label: string;
        /** Omitted means "keep the stored key" — a blank field must not wipe it. */
        apiKey?: string;
        model: string;
        baseUrl?: string;
      };
    }
  | { type: 'connection:delete'; connectionId: string }
  /** The whole chain, in the new order. */
  | { type: 'connections:reorder'; ids: string[] }
  | { type: 'connection:models'; connectionId: string }
  | { type: 'connection:usage'; connectionId: string }
  | { type: 'connection:connectOpenRouter' }
  | { type: 'profiles:save'; profile: Profile }
  | { type: 'profiles:delete'; profileId: string }
  | { type: 'profiles:import'; json: string }
  | { type: 'profiles:export' }
  | { type: 'siteRules:list' }
  | { type: 'history:export' };

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

/**
 * One selectable model. `free` is only set where the provider's API reports
 * pricing (OpenRouter) — elsewhere free/paid is not a concept the API exposes,
 * so it stays undefined and the picker shows a single group.
 */
export interface ModelInfo {
  id: string;
  free?: boolean;
}

/**
 * What a key's usage/quota looks like. Providers differ wildly in what they
 * expose, so this is a small union rather than one shape pretending they are
 * the same:
 *  - `credit`: a spend/limit account (OpenRouter's key endpoint).
 *  - `rate`: only per-window rate-limit headers off a live request
 *    (Groq / OpenAI / Anthropic).
 *  - `unavailable`: the API exposes nothing (Gemini, local runners).
 */
export type UsageInfo =
  | {
      kind: 'credit';
      freeTier: boolean;
      usedUsd: number;
      usedMonthlyUsd: number;
      /** Null when the key has no set spending limit. */
      limitUsd: number | null;
      remainingUsd: number | null;
    }
  | {
      kind: 'rate';
      requestsRemaining?: number;
      requestsLimit?: number;
      tokensRemaining?: number;
      tokensLimit?: number;
      /** Seconds until the window resets, if the provider says. */
      resetSeconds?: number;
    }
  | { kind: 'unavailable'; hintUrl?: string };

export interface ResponseMap {
  'settings:get': Settings;
  'settings:patch': Settings;
  'siteRule:get': SiteRule;
  'siteRule:patch': SiteRule;
  'profiles:list': Profile[];
  'profile:resolve': ResolvedProfile;
  'connection:test': ProviderTestResult;
  'history:list': HistoryEntry[];
  'history:clear': void;
  'session:hideOrigin': void;
  'session:isOriginHidden': boolean;
  'insert:mainWorld': boolean;
  'connections:list': ConfiguredConnection[];
  'connection:save': ConfiguredConnection[];
  'connection:delete': ConfiguredConnection[];
  'connections:reorder': ConfiguredConnection[];
  'connection:models': ModelInfo[];
  'connection:usage': UsageInfo;
  'connection:connectOpenRouter': ProviderTestResult;
  'profiles:save': Profile[];
  'profiles:delete': Profile[];
  'profiles:import': { added: number; error?: string };
  'profiles:export': string;
  'siteRules:list': Record<string, SiteRule>;
  'history:export': string;
}

/** Safe to send to a UI: describes a saved connection without its key. */
export interface ConfiguredConnection {
  id: string;
  providerId: ProviderId;
  label: string;
  model: string;
  authMethod: 'manual' | 'oauth';
  /** So the card can render "key saved" without ever seeing the key. */
  hasKey: boolean;
  baseUrl?: string;
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
  connectionLabel: string;
  /**
   * Set when an earlier connection failed and this one took over. The panel
   * says so — a silent switch would hide that a key needs attention, and would
   * also hide that the answer came from a different model than expected.
   */
  fellBackFrom?: { label: string; kind: ErrorKind; message: string };
  promptTokens?: number;
  completionTokens?: number;
  costUsd?: number;
}

export type EnhanceServerMessage =
  /** Sent immediately so the panel can render the resolved profile chip. */
  | { type: 'accepted'; profileId: string; auto: boolean }
  | { type: 'chunk'; text: string }
  /**
   * Discard everything streamed so far. Sent when a connection failed
   * part-way and a fallback is starting the rewrite over — without it the
   * panel would render the two halves spliced into one nonsense answer.
   */
  | { type: 'reset' }
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
