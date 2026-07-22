import type { ErrorKind } from '../messaging/protocol';

/**
 * Which failures hand over to the next connection, and which stop the chain.
 *
 * The line is *whose problem it is*. A failure that belongs to one credential
 * — its key, its quota, its host being down — is exactly what a second
 * credential exists to survive, so it hands over. A failure that belongs to the
 * **draft** or to the **user** would repeat identically on every connection, so
 * retrying it is a waste of the user's money and their time.
 *
 * `refusal` is the interesting one, and it deliberately does NOT hand over.
 * When a model declines to rewrite a draft, walking down a list of models until
 * one complies is shopping for a permissive model — the exact pattern principle
 * 12 keeps out of this extension. One model says no, the answer is no.
 */
const HANDS_OVER: Record<ErrorKind, boolean> = {
  // This credential is broken; another one may not be.
  'bad-key': true,
  // This connection has no usable model; another one may serve a good one.
  'bad-model': true,
  // This credential is spent or throttled — the whole point of a chain.
  'rate-limited': true,
  quota: true,
  // This host is unreachable; a different host may be up.
  network: true,
  // Cause unknown, so it may well be credential-specific. Worth one more try.
  unknown: true,

  // The draft is too long for every model in the list, at any price.
  'too-long': false,
  // Our own daily limit — the user set it, and it is not per-credential.
  'soft-cap': false,
  // The user pressed Stop. Starting another request would be the opposite.
  cancelled: false,
  // Never shop for a model that will comply (principle 12).
  refusal: false,
};

export function handsOver(kind: ErrorKind): boolean {
  return HANDS_OVER[kind];
}

/** What each connection said, in order, when the whole chain failed. */
export interface Attempt {
  connectionId: string;
  label: string;
  kind: ErrorKind;
  message: string;
}
