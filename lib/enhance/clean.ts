import { errorFor } from '../providers/errors';

/**
 * Client-side defence for the OUTPUT paragraph in every system prompt.
 *
 * The prompts already say "no lead-in, no code fences, no surrounding quotes",
 * and strong models obey. Cheap models — the ones a BYOK user is most likely to
 * pick — do not, reliably. So the rules are enforced here too: the user should
 * never see "Here is the improved prompt:" pasted into their chat box because
 * they chose a smaller model.
 */

/**
 * Lead-ins observed from models that narrate instead of answering. Anchored to
 * the start and required to end at a colon or line break, so a rewrite that
 * legitimately *begins* with one of these words survives.
 */
const LEAD_INS = [
  /^(?:sure|certainly|of course|absolutely|got it|okay|ok)[,!.]?\s*/i,
  /^here(?:'s| is| are| you go)[^\n:]{0,60}[:\n]\s*/i,
  /^(?:the )?(?:improved|enhanced|revised|rewritten|refined|better|optimized|optimised|updated)\s+(?:version of\s+)?(?:the\s+)?prompt[^\n:]{0,40}[:\n]\s*/i,
  /^(?:i(?:'ve| have)\s+(?:rewritten|improved|enhanced|revised)[^\n:]{0,60}[:\n])\s*/i,
  /^(?:rewritten|improved|enhanced|revised)\s+prompt\s*[:\n]\s*/i,
];

/** Trailing commentary about what changed. */
const TRAILERS = [
  /\n+(?:note|notes|changes?(?: made)?|what changed|explanation|rationale)\s*:[\s\S]*$/i,
  /\n+---+\s*\n[\s\S]*$/,
  /\n+\*{0,2}(?:i )?(?:hope this helps|let me know)[\s\S]*$/i,
];

/**
 * Markers that the model answered the draft, or refused, instead of rewriting
 * it. These are not stripped — the result is unusable, so it becomes an error
 * and the draft stays untouched (principle 8).
 */
const ANSWER_SHAPED = [
  /\bas an ai (?:language )?model\b/i,
  /\bi(?:'m| am) (?:sorry|unable|not able)\b.{0,40}\b(?:can(?:'|no)?t|cannot|unable)\b/i,
  /^i can(?:'|no)?t (?:help|assist|comply)/i,
];

/**
 * Beyond this ratio the model almost certainly answered the draft rather than
 * rewriting it — every profile caps a one-line draft at a few sentences. Both
 * bounds must trip, so a legitimately expanded short draft is never rejected.
 */
const MAX_EXPANSION_RATIO = 60;
const MAX_EXPANSION_ABSOLUTE = 2000;

export interface CleanResult {
  text: string;
  /** True when the rewrite is effectively the draft — drives "Already looks good". */
  unchanged: boolean;
}

export function clean(raw: string, draft: string): CleanResult {
  let text = raw.replace(/\r\n/g, '\n').trim();

  text = stripCodeFence(text);

  // Lead-ins stack ("Sure! Here's the improved prompt:"), so sweep until
  // nothing changes. Bounded by the pattern count: each pass must strip at
  // least one, so there can never be more useful passes than patterns.
  let passesLeft = LEAD_INS.length;
  let changed = true;
  while (changed && passesLeft-- > 0) {
    changed = false;
    for (const pattern of LEAD_INS) {
      const next = text.replace(pattern, '');
      if (next !== text) {
        text = next;
        changed = true;
      }
    }
  }

  for (const pattern of TRAILERS) text = text.replace(pattern, '');

  text = stripCodeFence(text.trim());
  text = stripWrappingQuotes(text).trim();

  if (!text) throw errorFor('refusal');

  for (const pattern of ANSWER_SHAPED) {
    if (pattern.test(text)) throw errorFor('refusal');
  }

  const draftLength = draft.trim().length;
  if (
    draftLength > 0 &&
    text.length > MAX_EXPANSION_ABSOLUTE &&
    text.length > draftLength * MAX_EXPANSION_RATIO
  ) {
    throw errorFor(
      'refusal',
      'The model answered the draft instead of rewriting it.',
    );
  }

  return { text, unchanged: normalize(text) === normalize(draft) };
}

/**
 * Only unwraps a fence that encloses the *entire* output. A draft containing
 * its own code block keeps it — the coding profile's verbatim rule depends on
 * that.
 */
export function stripCodeFence(text: string): string {
  const match = /^```[a-zA-Z0-9_-]*\n([\s\S]*?)\n?```$/.exec(text.trim());
  return match?.[1] ?? text;
}

/**
 * Unwraps matched quotes around the whole output, but not when the text
 * contains the same quote character inside — that would be the user's own
 * quoted string, and mangling it breaks the preserve-verbatim guarantee.
 */
export function stripWrappingQuotes(text: string): string {
  const pairs: readonly (readonly [string, string])[] = [
    ['"', '"'],
    ["'", "'"],
    ['“', '”'],
    ['«', '»'],
  ];
  for (const [open, close] of pairs) {
    if (text.length > 1 && text.startsWith(open) && text.endsWith(close)) {
      const inner = text.slice(1, -1);
      if (!inner.includes(open) && !inner.includes(close)) return inner;
    }
  }
  return text;
}

/** Whitespace-insensitive comparison for the "already looks good" check. */
function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
