import { isEditableInput, isTextArea, readValue } from './detect';

/**
 * Byte-exact capture and restore of a field, taken before any insertion.
 *
 * This is what makes the undo guarantees in UX-SPEC §2.5 real. "Byte-exact"
 * is meant literally: Persian and Arabic drafts routinely carry directional
 * marks (U+200F RLM, U+200E LRM, U+061C ALM) that are invisible in a diff and
 * trivially lost by a naive `.trim()` or a normalising round trip. Losing one
 * silently changes how the whole line renders.
 */

export interface FieldSnapshot {
  kind: 'value' | 'text';
  text: string;
  selectionStart: number | null;
  selectionEnd: number | null;
  takenAt: number;
}

export function takeSnapshot(el: HTMLElement, now = Date.now()): FieldSnapshot {
  if (isTextArea(el) || isEditableInput(el)) {
    return {
      kind: 'value',
      text: el.value,
      selectionStart: el.selectionStart,
      selectionEnd: el.selectionEnd,
      takenAt: now,
    };
  }
  return {
    kind: 'text',
    text: el.innerText,
    selectionStart: null,
    selectionEnd: null,
    takenAt: now,
  };
}

/**
 * Restore through the same input-event path used for insertion, so the host
 * editor's own model and undo stack stay consistent. A direct `.value =` write
 * would restore the pixels but leave React's state holding the enhanced text.
 */
export async function restoreSnapshot(
  el: HTMLElement,
  snapshot: FieldSnapshot,
  insert: (el: HTMLElement, text: string) => Promise<boolean> | boolean,
): Promise<boolean> {
  const ok = await insert(el, snapshot.text);
  if (!ok) return false;

  if (
    snapshot.kind === 'value' &&
    (isTextArea(el) || isEditableInput(el)) &&
    snapshot.selectionStart !== null &&
    snapshot.selectionEnd !== null
  ) {
    try {
      el.setSelectionRange(snapshot.selectionStart, snapshot.selectionEnd);
    } catch {
      // Some inputs refuse setSelectionRange; the text is what matters.
    }
  }
  return true;
}

/**
 * Best-effort direct restore, used when *every* insertion tier failed.
 *
 * A tier can modify the field and still fail verification — a partial write, or
 * an editor that accepted half the text. That leaves the user's draft
 * corrupted, which principle 8 forbids outright. At this point the host's undo
 * stack is already a lost cause, so this writes as directly as possible and
 * optimises purely for getting the original characters back.
 */
export function restoreField(
  el: HTMLElement,
  snapshot: FieldSnapshot,
): boolean {
  try {
    if (snapshot.kind === 'value' && (isTextArea(el) || isEditableInput(el))) {
      const prototype = isTextArea(el)
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
      // Deliberately detached; `this` is supplied on the .call() below.
      // eslint-disable-next-line @typescript-eslint/unbound-method
      const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
      if (setter) setter.call(el, snapshot.text);
      else el.value = snapshot.text;
    } else {
      el.textContent = snapshot.text;
    }
    // Frameworks only learn about the change from the event, not the write.
    el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    return readValue(el) === snapshot.text;
  } catch {
    return false;
  }
}

/** True when the field currently holds exactly what the snapshot captured. */
export function matchesSnapshot(
  el: HTMLElement,
  snapshot: FieldSnapshot,
): boolean {
  return readValue(el) === snapshot.text;
}

/**
 * Directional marks and other invisible formatting characters, written as
 * escapes so a reviewer can actually see what is matched:
 *
 *   200B–200F  ZWSP, ZWNJ, ZWJ, LRM, RLM
 *   061C       Arabic letter mark
 *   202A–202E  legacy bidi embeddings/overrides
 *   2066–2069  bidi isolates
 *   FEFF       BOM / zero-width no-break space
 *
 * Insertion must round-trip these untouched — they are invisible in a diff and
 * losing one silently changes how a whole Persian line renders.
 */
const INVISIBLE_MARK_PATTERN =
  '[\\u200B-\\u200F\\u061C\\u202A-\\u202E\\u2066-\\u2069\\uFEFF]';

export function countInvisibleMarks(text: string): number {
  // Built fresh each call: a /g regex carries lastIndex between uses, and a
  // shared instance would silently skip matches on every second call.
  return (text.match(new RegExp(INVISIBLE_MARK_PATTERN, 'g')) ?? []).length;
}

/**
 * Read-back verification. Exact equality, not a normalised comparison: a
 * "close enough" check here would let an editor silently eat a directional
 * mark or collapse a run of whitespace, which is exactly the corruption this
 * whole layer exists to prevent.
 */
export function verifyInserted(el: HTMLElement, expected: string): boolean {
  return readValue(el) === expected;
}

/**
 * contenteditable normalises trailing whitespace and can rewrite newlines as
 * block elements, so an exact match is not always achievable there. This is
 * the deliberately looser check used only for that case.
 */
export function verifyInsertedLoose(
  el: HTMLElement,
  expected: string,
): boolean {
  const normalize = (text: string): string =>
    text
      .replace(/\r\n/g, '\n')
      .replace(/[ \t]+$/gm, '')
      // Block-level editors render each paragraph as its own element, so
      // innerText reports a blank line between them. That is correct output,
      // not a mismatch — collapse it before comparing.
      .replace(/\n{2,}/g, '\n')
      .trim();
  return normalize(readValue(el)) === normalize(expected);
}
