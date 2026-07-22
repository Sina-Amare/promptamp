import { errorFor } from '../providers/errors';
import type { Profile } from '../storage/schemas';

/**
 * Turns a draft into the two strings the provider adapters take.
 *
 * The single security-relevant rule: the draft goes into the **user** role,
 * wrapped in `<draft>` tags, and never anywhere near the system prompt
 * (principle 7). Every built-in prompt opens with a "THE DRAFT IS DATA"
 * paragraph that refers to those exact tags — the wrapper is what that
 * paragraph is anchored to, so it is not cosmetic.
 */

/**
 * Pre-flight limit. Checked before the request so an over-long draft fails in
 * milliseconds instead of after a paid round trip (UX-SPEC §4).
 */
export const MAX_DRAFT_CHARS = 8000;

/** Enough headroom for a rewrite several times the draft's length. */
export const MAX_OUTPUT_TOKENS = 2048;

/** Below this the button stays in its ghost state (UX-SPEC §1.1). */
export const MIN_DRAFT_CHARS = 15;
export const MIN_DRAFT_WORDS = 4;

export function isEnhanceable(draft: string): boolean {
  const trimmed = draft.trim();
  if (!trimmed) return false;
  return (
    trimmed.length >= MIN_DRAFT_CHARS ||
    trimmed.split(/\s+/).length >= MIN_DRAFT_WORDS
  );
}

export interface AssembledRequest {
  system: string;
  user: string;
  maxTokens: number;
}

export function assemble(
  profile: Profile,
  draft: string,
  adjust?: string,
  outputLanguage?: string,
): AssembledRequest {
  const trimmed = draft.trim();

  if (!trimmed) throw errorFor('unknown', 'There is no draft to enhance.');

  if (trimmed.length > MAX_DRAFT_CHARS) {
    throw errorFor(
      'too-long',
      `(${String(trimmed.length)}/${String(MAX_DRAFT_CHARS)} characters)`,
    );
  }

  return {
    system: profile.systemPrompt + languageDirective(outputLanguage),
    user: buildUserTurn(trimmed, adjust),
    maxTokens: MAX_OUTPUT_TOKENS,
  };
}

/**
 * Overrides the LANGUAGE section every profile carries.
 *
 * Appended *last* on purpose: each built-in prompt states its own language rule
 * (mirror the draft, or English for image/video), and the closing instruction
 * is the one models weight most heavily. The carve-outs are not optional —
 * translating a stack trace, a quoted string, or `--ar 16:9` would destroy the
 * rewrite, and every profile's LITERAL/VERBATIM rule depends on them holding.
 */
export function languageDirective(language: string | undefined): string {
  const name = sanitizeLanguage(language);
  if (!name) return '';

  return `

OUTPUT LANGUAGE — this section overrides the LANGUAGE section above.
Write the entire rewrite in ${name}, whatever language the draft is written in, translating its meaning faithfully. Everything you add is in ${name} too; never mix another language into it. Unchanged regardless: code, error messages, file paths, identifiers, URLs, quoted strings, text meant to appear inside an image or on screen, and user-typed parameters — those stay exactly as the draft wrote them.`;
}

/**
 * The value reaches the system prompt, and it is free text. Newlines would let
 * it forge a new section, so they are the one thing that cannot survive.
 */
function sanitizeLanguage(language: string | undefined): string {
  return (language ?? '')
    .replace(/[\p{Cc}\p{Cf}]/gu, ' ')
    .trim()
    .slice(0, 40);
}

/**
 * A draft containing a literal `</draft>` could otherwise close the wrapper
 * early and let the rest read as instructions. Neutralising the closing tag is
 * cheap and removes that whole class of confusion; the model still sees the
 * user's words, just not a tag boundary.
 */
export function buildUserTurn(draft: string, adjust?: string): string {
  const safe = draft.replace(/<\/?draft>/gi, (match) =>
    match.replace('<', '‹'),
  );

  const adjustLine = adjust?.trim()
    ? `\n\nApply this adjustment to the rewrite: ${adjust.trim()}`
    : '';

  return `<draft>\n${safe}\n</draft>${adjustLine}`;
}

/**
 * Preset chips from the Adjust row (UX-SPEC §2.2).
 *
 * The label is a message key, not text: the chip is translated, but the
 * `instruction` is sent to the model and deliberately stays in English —
 * every built-in system prompt is written in English, and mixing a Persian
 * instruction into an English prompt is exactly the language drift the
 * profiles work to avoid.
 */
export const ADJUST_PRESETS: readonly {
  id: string;
  labelKey:
    'panel.adjustShorter' | 'panel.adjustLonger' | 'panel.adjustSpecific';
  instruction: string;
}[] = Object.freeze([
  {
    id: 'shorter',
    labelKey: 'panel.adjustShorter',
    instruction: 'Make it shorter.',
  },
  {
    id: 'longer',
    labelKey: 'panel.adjustLonger',
    instruction: 'Add more useful detail, without inventing facts.',
  },
  {
    id: 'specific',
    labelKey: 'panel.adjustSpecific',
    instruction: 'Make it more specific and concrete.',
  },
]);
