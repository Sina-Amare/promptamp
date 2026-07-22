import {
  type EditorKind,
  classifyEditor,
  isEditableInput,
  isTextArea,
} from './detect';
import {
  matchesSnapshot,
  restoreField,
  takeSnapshot,
  verifyInserted,
  verifyInsertedLoose,
} from './snapshot';
import {
  type TierName,
  type TierResult,
  copyToClipboard,
  insertIntoContentEditable,
  insertViaExecCommand,
  insertViaNativeSetter,
  insertViaPasteSimulation,
} from './tiers';

/**
 * Attempt → verify by read-back → escalate.
 *
 * The verification step is the important half. Every one of these APIs can
 * report success and change nothing: `execCommand` returns true on editors that
 * silently drop the input, and a dispatched paste event is "handled" by any
 * listener that calls preventDefault for its own reasons. Trusting the return
 * value alone is how insertion bugs reach users. So after each attempt the
 * field is read back and compared, and only a real match ends the ladder.
 */

export interface InsertOptions {
  /**
   * Tier 4. Monaco and CodeMirror 6 keep their text in an internal model that
   * no DOM event reaches, so the only reliable path is calling their instance
   * API from the page's own world — which a content script cannot do. The
   * content script supplies this hook, which asks the worker to run
   * `scripting.executeScript({ world: 'MAIN' })`.
   */
  mainWorldInsert?: (text: string) => Promise<boolean>;
  /** Injected in tests. */
  verify?: (el: HTMLElement, expected: string) => boolean;
}

export interface InsertOutcome {
  ok: boolean;
  tier: TierName | null;
  attempts: TierResult[];
  /** True when the text reached the clipboard instead of the field. */
  clipboardFallback: boolean;
  /** True when insertion worked but the host's native Ctrl+Z was lost. */
  undoLost: boolean;
}

/**
 * Which ladder to climb for which editor. Starting at the tier most likely to
 * work avoids burning a visible failed attempt on every rich editor — and
 * `execCommand` on Lexical does not merely fail, it can corrupt the document.
 */
export function ladderFor(kind: EditorKind): TierName[] {
  switch (kind) {
    case 'textarea':
    case 'input':
      return ['exec-command', 'native-setter', 'paste-simulation'];
    case 'contenteditable':
    case 'prosemirror':
    case 'quill':
      return ['contenteditable', 'paste-simulation'];
    case 'lexical':
    case 'slate':
    case 'draftjs':
      // These build their document from beforeinput/paste and ignore direct
      // DOM writes, so the paste path goes first.
      return ['paste-simulation', 'contenteditable'];
    case 'codemirror':
    case 'monaco':
      return ['main-world', 'paste-simulation', 'contenteditable'];
    case 'unknown':
      return ['exec-command', 'contenteditable', 'paste-simulation'];
  }
}

export async function insertText(
  el: HTMLElement,
  text: string,
  options: InsertOptions = {},
): Promise<InsertOutcome> {
  const kind = classifyEditor(el);
  // Taken before anything is attempted, so a partial write from a failed tier
  // can be rolled back rather than left in the user's field.
  const snapshot = takeSnapshot(el);
  const attempts: TierResult[] = [];
  // contenteditable normalises trailing whitespace and re-wraps newlines as
  // blocks, so exact equality is unachievable there through any API.
  const isPlainValue = isTextArea(el) || isEditableInput(el);
  const verify =
    options.verify ?? (isPlainValue ? verifyInserted : verifyInsertedLoose);

  for (const tier of ladderFor(kind)) {
    const ran = await runTier(tier, el, text, options);
    if (!ran) continue;

    const ok = verify(el, text);
    attempts.push({
      tier,
      ok,
      ...(tier === 'native-setter' ? { undoLost: true } : {}),
    });

    if (ok) {
      return {
        ok: true,
        tier,
        attempts,
        clipboardFallback: false,
        undoLost: tier === 'native-setter',
      };
    }
  }

  // Every tier failed — but "failed" does not mean "changed nothing". A tier
  // can write and still fail verification (a partial write, or an editor that
  // accepted only part of the text), which would leave the user's draft
  // corrupted. Principle 8 says the draft is provably untouched on any error,
  // so put it back before doing anything else.
  if (!matchesSnapshot(el, snapshot)) restoreField(el, snapshot);

  // The draft is safe; hand the user their text rather than failing silently.
  const copied = await copyToClipboard(text);
  attempts.push({ tier: 'clipboard', ok: copied });

  return {
    ok: copied,
    tier: copied ? 'clipboard' : null,
    attempts,
    clipboardFallback: copied,
    undoLost: false,
  };
}

async function runTier(
  tier: TierName,
  el: HTMLElement,
  text: string,
  options: InsertOptions,
): Promise<boolean> {
  switch (tier) {
    case 'exec-command':
      return insertViaExecCommand(el, text);
    case 'native-setter':
      return insertViaNativeSetter(el, text);
    case 'contenteditable':
      return insertIntoContentEditable(el, text);
    case 'paste-simulation':
      return insertViaPasteSimulation(el, text);
    case 'main-world':
      return options.mainWorldInsert
        ? await options.mainWorldInsert(text)
        : false;
    case 'clipboard':
      return copyToClipboard(text);
  }
}
