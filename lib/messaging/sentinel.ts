/**
 * What a profile emits, verbatim and alone, when the draft holds no request to
 * rewrite (keyboard-mashing, a stray fragment). It leads with a bracket no real
 * rewrite starts with, so the panel can recognise a decline from its first
 * character and never flash it mid-stream. The panel shows a friendly note and
 * leaves the draft untouched — it is never a prompt to send.
 *
 * Deliberately in its own leaf module (no `#imports`, no `browser`): it is a
 * pure constant shared by the worker-side clean() and the wire protocol, and
 * the Gate-1 battery (`scripts/battery.ts`) imports clean() under plain tsx,
 * where pulling the WXT browser chain in transitively would fail to resolve.
 */
export const DECLINE_SENTINEL = '⟦NO_PROMPT⟧';
