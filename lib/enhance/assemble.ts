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
    system: profile.systemPrompt,
    user: buildUserTurn(trimmed, adjust),
    maxTokens: MAX_OUTPUT_TOKENS,
  };
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

/** Preset chips from the Adjust row (UX-SPEC §2.2). */
export const ADJUST_PRESETS: readonly {
  id: string;
  label: string;
  instruction: string;
}[] = Object.freeze([
  { id: 'shorter', label: 'Shorter', instruction: 'Make it shorter.' },
  {
    id: 'longer',
    label: 'Longer',
    instruction: 'Add more useful detail, without inventing facts.',
  },
  {
    id: 'specific',
    label: 'More specific',
    instruction: 'Make it more specific and concrete.',
  },
]);
