import type { ErrorKind, SafeError } from '../messaging/protocol';
import { redactKeys } from '../redact';

/**
 * Every provider failure becomes one of the wire-level `ErrorKind`s before it
 * crosses back to the panel. UX-SPEC §4 requires naming the cause class —
 * "Rate limited, retrying in 20 s" is actionable, "Something went wrong" is not.
 *
 * Nothing here ever carries key material: messages are redacted on the way out
 * (a 401 body sometimes echoes the offending header).
 */

export class ProviderError extends Error {
  readonly kind: ErrorKind;
  readonly retryAfterSec: number | undefined;

  constructor(kind: ErrorKind, message: string, retryAfterSec?: number) {
    super(message);
    this.name = 'ProviderError';
    this.kind = kind;
    this.retryAfterSec = retryAfterSec;
  }

  toSafeError(): SafeError {
    const remedy = REMEDIES[this.kind];
    return {
      kind: this.kind,
      message: redactKeys(this.message),
      ...(remedy ? { remedy } : {}),
      ...(this.retryAfterSec === undefined
        ? {}
        : { retryAfterSec: this.retryAfterSec }),
    };
  }
}

/** Human-readable text per kind. The panel renders these verbatim. */
const MESSAGES: Record<ErrorKind, string> = {
  'bad-key': 'That API key was rejected.',
  'bad-model': 'That model is not available on this connection.',
  'rate-limited': 'Rate limited by the provider.',
  quota: 'This API key is out of quota or credit.',
  network: "Couldn't reach the provider — draft unchanged.",
  refusal: 'The model declined to rewrite this draft.',
  'too-long': 'Draft is too long for this profile.',
  'soft-cap': "You've hit your daily PromptAmp limit.",
  cancelled: 'Cancelled.',
  unknown: 'The enhancement failed — draft unchanged.',
};

/**
 * The fix, not just the diagnosis.
 *
 * Each of these names one action the user can actually take from where they
 * are standing. Kinds with no honest next step (a cancel they performed
 * themselves, a refusal that is the model's decision to make) get none rather
 * than filler — a remedy that does not help is worse than silence, because it
 * costs a read to discover that.
 */
const REMEDIES: Partial<Record<ErrorKind, string>> = {
  'bad-key':
    'Open PromptAmp settings and re-paste the key for this connection — keys are usually rejected because of a stray space, a revoked key, or a key from a different provider.',
  'bad-model':
    'Open PromptAmp settings, press “Load models” on this connection, and pick one from the list — model names differ between providers and change over time.',
  'rate-limited':
    'Wait for the limit to reset, or add a second connection in settings so PromptAmp can fall back to it automatically.',
  quota:
    'Top up or switch plans with this provider, or add another connection in settings and PromptAmp will use it when this one runs dry.',
  network:
    'Check your internet connection. If you are using a local model, confirm the server is running and that PromptAmp has permission to reach that address.',
  'too-long':
    'Shorten the draft, or select just the part you want rewritten before enhancing.',
  'soft-cap': 'Raise or turn off the daily limit under Behavior in settings.',
  unknown:
    'Try again. If it keeps happening, use Test on the connection in settings to find out which part of the setup is failing.',
};

export function errorFor(kind: ErrorKind, detail?: string): ProviderError {
  const base = MESSAGES[kind];
  return new ProviderError(kind, detail ? `${base} ${detail}` : base);
}

/** Exposed for the chain summary, which builds a SafeError from parts. */
export function remedyFor(kind: ErrorKind): string | undefined {
  return REMEDIES[kind];
}

/**
 * HTTP status → error kind.
 *
 * 401/403 both mean "this key won't work", which is one user action (fix the
 * key) even though the causes differ. 402 and 429-with-quota-wording mean the
 * key is valid but spent — a different action (top up), so a different kind.
 */
export function mapStatus(status: number, body: string): ErrorKind {
  if (status === 401 || status === 403) return 'bad-key';
  if (status === 402) return 'quota';
  if (status === 429) {
    // Providers overload 429 for both "too fast" and "out of credit".
    return /quota|credit|billing|insufficient/i.test(body)
      ? 'quota'
      : 'rate-limited';
  }
  if (status === 413) return 'too-long';
  if (status >= 500) return 'network';
  if (status === 400 && /context|too long|max.*token/i.test(body))
    return 'too-long';
  // A 404 on a chat endpoint is almost always the model name, not the route —
  // the route came from our own registry. Some servers say it with a 400.
  //
  // Verified against the live APIs rather than assumed:
  //   Groq       → "The model `x` does not exist or you do not have access"
  //   OpenRouter → "x is not a valid model ID"
  // Both map here; both bad keys map to `bad-key` ("Invalid API Key" /
  // "User not found").
  if (status === 404) return 'bad-model';
  if (status === 400 && /model/i.test(body)) return 'bad-model';
  return 'unknown';
}

/** `Retry-After` may be seconds or an HTTP date. Both appear in the wild. */
export function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  const at = Date.parse(header);
  if (Number.isNaN(at)) return undefined;
  return Math.max(0, Math.ceil((at - Date.now()) / 1000));
}

export function toSafeError(err: unknown): SafeError {
  if (err instanceof ProviderError) return err.toSafeError();
  if (err instanceof DOMException && err.name === 'AbortError') {
    return { kind: 'cancelled', message: MESSAGES.cancelled };
  }
  if (err instanceof TypeError) {
    // fetch() rejects with TypeError for DNS/offline/CORS failures.
    return { kind: 'network', message: MESSAGES.network };
  }
  return {
    kind: 'unknown',
    message: redactKeys(err instanceof Error ? err.message : MESSAGES.unknown),
  };
}

/** Max 2 retries on 429, per principle 10. Never rotates keys, never loops. */
export const MAX_RETRIES = 2;

/** Exponential backoff, capped — a provider's own Retry-After always wins. */
export function backoffMs(attempt: number, retryAfterSec?: number): number {
  if (retryAfterSec !== undefined)
    return Math.min(retryAfterSec * 1000, 60_000);
  return Math.min(1000 * 2 ** attempt, 8000);
}
