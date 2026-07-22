/**
 * Key redaction.
 *
 * Deliberately its own module with no imports: it is a pure string function,
 * and it is needed by the error layer, which must not drag in storage access
 * to get it. Keeping it separate also means it can run anywhere — including a
 * plain Node script — without a browser-extension runtime.
 */

/**
 * Strip anything key-shaped before it reaches a log, an error message, or the
 * UI. Provider keys are long, high-entropy and usually prefixed (`sk-`,
 * `gsk_`, `sk-or-v1-`, `AIza`); a stack trace that echoes a request header
 * would otherwise leak one into a bug report the user pastes in public.
 *
 * The prefix is kept so the message still says *which* key was wrong.
 */
export function redactKeys(text: string): string {
  return text
    .replace(
      /\b(sk-or-v1-|sk-ant-|sk-|gsk_|AIza)[A-Za-z0-9_-]{8,}/g,
      '$1[redacted]',
    )
    .replace(/\b[Bb]earer\s+[A-Za-z0-9._-]{16,}/g, 'Bearer [redacted]');
}
