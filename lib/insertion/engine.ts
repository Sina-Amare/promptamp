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
import type { MainWorldEditorResult } from './main-world';

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
   * Tier 4. Monaco and CodeMirror keep their authoritative text in an internal
   * model. The static MAIN-world bridge returns exact model state after both
   * reads and writes, so verification and rollback are exact.
   */
  mainWorldEditor?: {
    read: () => Promise<MainWorldEditorResult>;
    replace: (text: string) => Promise<MainWorldEditorResult>;
  };
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
  const modelEditor =
    (kind === 'monaco' || kind === 'codemirror') && options.mainWorldEditor
      ? options.mainWorldEditor
      : null;
  const originalModel = modelEditor ? await modelEditor.read() : null;
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
    const execution = await runTier(tier, el, text, options);
    if (!execution.ran) continue;

    // Rich editors commit to their model asynchronously — Quill and Lexical
    // both reconcile in a microtask or animation frame. Verifying in the same
    // synchronous turn reads the *pre-update* state and wrongly escalates.
    await settle();

    const ok =
      execution.readback !== undefined
        ? execution.readback === text
        : verify(el, text);
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
  if (
    modelEditor &&
    originalModel?.ok &&
    typeof originalModel.value === 'string'
  ) {
    await modelEditor.replace(originalModel.value);
  } else if (!matchesSnapshot(el, snapshot)) {
    restoreField(el, snapshot);
  }

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

/**
 * Yield long enough for an editor to reconcile. A rendered frame covers both
 * microtask-based (Lexical) and rAF-based (Quill, CodeMirror) commits; the
 * timeout is the fallback for a backgrounded tab, where rAF never fires.
 */
function settle(): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      resolve();
    };
    globalThis.requestAnimationFrame?.(() => {
      setTimeout(finish, 0);
    });
    setTimeout(finish, 50);
  });
}

async function runTier(
  tier: TierName,
  el: HTMLElement,
  text: string,
  options: InsertOptions,
): Promise<{ ran: boolean; readback?: string | null }> {
  switch (tier) {
    case 'exec-command':
      return { ran: insertViaExecCommand(el, text) };
    case 'native-setter':
      return { ran: insertViaNativeSetter(el, text) };
    case 'contenteditable':
      return { ran: insertIntoContentEditable(el, text) };
    case 'paste-simulation':
      return { ran: insertViaPasteSimulation(el, text) };
    case 'main-world': {
      if (options.mainWorldEditor) {
        const result = await options.mainWorldEditor.replace(text);
        return { ran: result.ok, readback: result.value };
      }
      return { ran: false };
    }
    case 'clipboard':
      return { ran: await copyToClipboard(text) };
  }
}
