import { diffWords } from 'diff';
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
  return diffWords(original, enhanced).map((part) => ({
    kind: part.added ? 'added' : part.removed ? 'removed' : 'same',
    value: part.value,
  }));
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
