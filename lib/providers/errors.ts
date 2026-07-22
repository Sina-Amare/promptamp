import type { ErrorKind, SafeError } from '../messaging/protocol';
import { redactKeys } from '../storage/credentials';

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
    return {
      kind: this.kind,
      message: redactKeys(this.message),
      ...(this.retryAfterSec === undefined
        ? {}
        : { retryAfterSec: this.retryAfterSec }),
    };
  }
}

/** Human-readable text per kind. The panel renders these verbatim. */
const MESSAGES: Record<ErrorKind, string> = {
  'bad-key': 'That API key was rejected. Check it in PromptAmp settings.',
  'rate-limited': 'Rate limited by the provider.',
  quota: 'This API key is out of quota or credit.',
  network: "Couldn't reach the provider — draft unchanged.",
  refusal: 'The model declined to rewrite this draft.',
  'too-long': 'Draft is too long for this profile.',
  'soft-cap': "You've hit your daily PromptAmp limit.",
  cancelled: 'Cancelled.',
  unknown: 'The enhancement failed — draft unchanged.',
};

export function errorFor(kind: ErrorKind, detail?: string): ProviderError {
  const base = MESSAGES[kind];
  return new ProviderError(kind, detail ? `${base} ${detail}` : base);
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
