import { diffArrays } from 'diff';
import { el } from '../host';

/**
 * The "Show changes" view (UX-SPEC §2.2).
 *
 * **Word-level, never character-level.** Splitting inside a word breaks
 * cursive shaping in Arabic and Persian — the letters stop joining, and the
 * text becomes genuinely hard to read rather than merely marked up. Word
 * granularity is a correctness requirement for RTL, not a stylistic choice.
 *
 * Colour is never the only signal: insertions are underlined, deletions
 * struck through (WCAG 1.4.1). And because JAWS ignores `<ins>`/`<del>`
 * entirely, each run is bracketed by visually-hidden text so a screen-reader
 * user hears the boundaries a sighted user sees.
 */

export interface DiffRun {
  kind: 'same' | 'added' | 'removed';
  value: string;
}

export function computeDiff(original: string, enhanced: string): DiffRun[] {
  return diffArrays(wordTokens(original), wordTokens(enhanced)).map((part) => ({
    kind: part.added ? 'added' : part.removed ? 'removed' : 'same',
    value: part.value.join(''),
  }));
}

/**
 * Diff whole Unicode words and emoji graphemes.
 *
 * `diffWords` uses an ASCII-biased character fallback for scripts without
 * spaces, which split Persian words (`کوتاه` → `ک` + `وتاه`) and ZWJ emoji.
 * Segmenting first makes those boundaries an input invariant rather than a
 * rendering repair after the diff has already broken them.
 */
function wordTokens(text: string): string[] {
  if (typeof Intl.Segmenter === 'function') {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
    return [...segmenter.segment(text)].map(({ segment }) => segment);
  }

  // Firefox versions before Intl.Segmenter: letters/marks stay together and a
  // complete emoji ZWJ sequence stays one token. Punctuation/spacing remain
  // byte-exact individual runs, so reconstruction is lossless.
  return (
    text.match(
      /(?:\p{Extended_Pictographic}(?:\p{Emoji_Modifier}|\uFE0F)?(?:\u200D\p{Extended_Pictographic}(?:\p{Emoji_Modifier}|\uFE0F)?)*)|(?:[\p{Letter}\p{Number}\p{Mark}_]+)|(?:\s+)|./gu,
    ) ?? []
  );
}

/** Nothing survived unchanged in either direction. Drives "Already looks good". */
export function isUnchanged(runs: DiffRun[]): boolean {
  return runs.every((run) => run.kind === 'same');
}

export function renderDiff(runs: DiffRun[]): DocumentFragment {
  const fragment = document.createDocumentFragment();

  for (const run of runs) {
    if (run.kind === 'same') {
      fragment.append(document.createTextNode(run.value));
      continue;
    }

    const added = run.kind === 'added';
    const label = added ? 'insertion' : 'deletion';

    fragment.append(
      el('span', {
        class: 'pa-sr-only',
        text: ` ${label} start `,
      }),
      // `dir="auto"` per run: a mixed-direction diff would otherwise reorder
      // at the seams, where direction-neutral punctuation sits.
      el(added ? 'ins' : 'del', {
        class: added ? 'pa-ins' : 'pa-del',
        text: run.value,
        attrs: { dir: 'auto' },
      }),
      el('span', {
        class: 'pa-sr-only',
        text: ` ${label} end `,
      }),
    );
  }

  return fragment;
}
