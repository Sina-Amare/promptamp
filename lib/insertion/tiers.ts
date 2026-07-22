import { isEditableInput, isTextArea } from './detect';

/**
 * The insertion strategies, cheapest and safest first.
 *
 * Every one of them writes through an *input event path* rather than assigning
 * to the DOM directly. That is the whole point: `el.value = text` updates the
 * pixels but not the host editor's model, so React re-renders the old text back
 * and ProseMirror's document desynchronises from its DOM. Going through the
 * event path keeps the host's model — and its native Ctrl+Z — intact
 * (UX-SPEC §2.5, principle 5).
 */

export type TierName =
  | 'exec-command'
  | 'native-setter'
  | 'contenteditable'
  | 'paste-simulation'
  | 'main-world'
  | 'clipboard';

export interface TierResult {
  tier: TierName;
  ok: boolean;
  /** Set when the write worked but the host's native undo stack was lost. */
  undoLost?: boolean;
}

/**
 * Tier 1a — `execCommand('insertText')`.
 *
 * Deprecated, and still the only API that pushes a *native* undo entry. Nothing
 * has replaced it: the Undo API is not shipped anywhere. So it stays first, and
 * everything below it is a fallback for when it returns false.
 */
export function insertViaExecCommand(el: HTMLElement, text: string): boolean {
  try {
    el.focus();
    if (isTextArea(el) || isEditableInput(el)) {
      el.select();
    } else {
      selectAllIn(el);
    }
    // Returns false when the document is not editable or the call is refused.
    return document.execCommand('insertText', false, text);
  } catch {
    return false;
  }
}

/**
 * Tier 1b — the native prototype setter.
 *
 * React installs its own `value` setter on the element instance, shadowing the
 * prototype's. Assigning through the instance updates the DOM but leaves
 * React's state stale, so the next render discards the text. Reaching the
 * prototype descriptor bypasses the shadow, and the dispatched `input` event
 * makes React commit the change.
 *
 * Costs the native undo entry, which the caller surfaces via `undoLost`.
 */
export function insertViaNativeSetter(el: HTMLElement, text: string): boolean {
  if (!isTextArea(el) && !isEditableInput(el)) return false;
  try {
    const prototype = isTextArea(el)
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    // Detaching the setter from the prototype is the entire technique — `this`
    // is supplied explicitly on the .call() below, which is what lets us reach
    // past React's shadowing instance property.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    if (!setter) return false;

    setter.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    return true;
  } catch {
    return false;
  }
}

/**
 * Tier 2 — contenteditable, line by line.
 *
 * Inserting a string with `\n` via insertText produces a single run in most
 * rich editors; splitting on newlines and emitting `insertParagraph` between
 * them is what makes ProseMirror and Quill build real block structure.
 */
export function insertIntoContentEditable(
  el: HTMLElement,
  text: string,
): boolean {
  try {
    el.focus();
    selectAllIn(el);

    const lines = text.split('\n');
    for (const [index, line] of lines.entries()) {
      if (index > 0 && !document.execCommand('insertParagraph')) return false;
      if (line && !document.execCommand('insertText', false, line)) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Tier 3 — simulated paste.
 *
 * Lexical, Slate and Draft.js intercept `beforeinput` and `paste` and build
 * their document from those, ignoring direct DOM writes entirely. A synthetic
 * ClipboardEvent carrying a real DataTransfer is the supported way in; the
 * `beforeinput` dispatch first covers editors that listen there and never look
 * at paste.
 *
 * Note this never touches the system clipboard — the DataTransfer is
 * constructed in memory, so the user's clipboard contents survive.
 */
export function insertViaPasteSimulation(
  el: HTMLElement,
  text: string,
): boolean {
  try {
    el.focus();
    selectAllIn(el);

    const beforeInput = new InputEvent('beforeinput', {
      inputType: 'insertReplacementText',
      data: text,
      bubbles: true,
      cancelable: true,
      composed: true,
    });
    const consumed = !el.dispatchEvent(beforeInput);
    if (consumed) return true;

    const transfer = new DataTransfer();
    transfer.setData('text/plain', text);
    const paste = new ClipboardEvent('paste', {
      clipboardData: transfer,
      bubbles: true,
      cancelable: true,
      composed: true,
    });
    return !el.dispatchEvent(paste);
  } catch {
    return false;
  }
}

/**
 * Final fallback — copy to the clipboard and tell the user (UX-SPEC §4).
 *
 * Explicitly a success path, not a failure: on a hostile editor the user still
 * gets their enhanced prompt in one keystroke, and the draft is untouched.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Select everything inside a contenteditable so insertText replaces it. */
function selectAllIn(el: HTMLElement): void {
  const selection = globalThis.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(el);
  selection.removeAllRanges();
  selection.addRange(range);
}
