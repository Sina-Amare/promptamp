/**
 * Classify the focused editable so the insertion engine can start at the tier
 * most likely to work, instead of always beginning at tier 1 and burning a
 * failed attempt on every rich editor.
 *
 * Detection is by *capability and framework fingerprint*, never by site
 * selector. Site selectors are what make extensions like this break every time
 * a host ships a redesign; a fingerprint on the editor's own DOM contract
 * survives that.
 */

import { closestComposed } from '../dom/composed';

export type EditorKind =
  | 'textarea'
  | 'input'
  | 'contenteditable'
  | 'prosemirror'
  | 'lexical'
  | 'quill'
  | 'draftjs'
  | 'slate'
  | 'codemirror'
  | 'monaco'
  | 'unknown';

export interface DetectedField {
  element: HTMLElement;
  kind: EditorKind;
  /** React and friends intercept value writes; tier 1 needs the native setter. */
  reactControlled: boolean;
  /** Resolved writing direction — decides which corner the button anchors to. */
  direction: 'ltr' | 'rtl';
}

/** Focus/insertion identity kept separate from the box users can actually see. */
export interface EditorTarget {
  focusElement: HTMLElement;
  anchorElement: HTMLElement;
  kind: EditorKind;
  direction: 'ltr' | 'rtl';
}

/** Never offered on these: Apple disables writing tools on exact-text fields. */
const BLOCKED_INPUT_TYPES = new Set([
  'password',
  'email',
  'number',
  'search',
  'tel',
  'url',
  'date',
  'datetime-local',
  'month',
  'week',
  'time',
  'color',
  'range',
  'file',
  'checkbox',
  'radio',
  'submit',
  'button',
  'reset',
  'image',
  'hidden',
]);

export function isTextArea(el: Element): el is HTMLTextAreaElement {
  return el instanceof HTMLTextAreaElement;
}

export function isEditableInput(el: Element): el is HTMLInputElement {
  if (!(el instanceof HTMLInputElement)) return false;
  return !BLOCKED_INPUT_TYPES.has(el.type.toLowerCase());
}

export function isContentEditable(el: Element): el is HTMLElement {
  return el instanceof HTMLElement && el.isContentEditable;
}

export function isEditable(el: Element | null): el is HTMLElement {
  if (!el) return false;
  return isTextArea(el) || isEditableInput(el) || isContentEditable(el);
}

/**
 * The visible editor box for geometry and lightweight draft previews.
 *
 * Monaco focuses a tiny hidden textarea, while the actual composer is the
 * surrounding `.monaco-editor`. Keeping the focus element and visual element
 * separate lets keyboard/insertion logic target the former and placement/size
 * logic target the latter.
 */
export function visualEditorRoot(el: Element): HTMLElement {
  const codeRoot = closestComposed<HTMLElement>(
    el,
    '.monaco-editor, .cm-editor',
  );
  return codeRoot ?? (el as HTMLElement);
}

/**
 * `document.activeElement` stops at a shadow host, so a field inside an open
 * shadow root reports as the host element. Walk down until we reach the real
 * one. Closed roots are opaque by design and simply won't be found.
 */
export function deepActiveElement(root: Document | ShadowRoot): Element | null {
  const active = root.activeElement;
  if (!active) return null;
  if (active.shadowRoot) return deepActiveElement(active.shadowRoot) ?? active;
  return active;
}

/**
 * React (and Vue, and Svelte's bind:value) install a value setter on the
 * element instance that shadows the prototype's. Writing through the instance
 * updates the DOM but not the framework's state, so the next render throws the
 * text away — the classic "text appears then vanishes" bug. Detecting this is
 * what tells tier 1 to go through the prototype setter instead.
 */
export function isReactControlled(el: Element): boolean {
  for (const key of Object.keys(el)) {
    if (
      key.startsWith('__react') ||
      key.startsWith('_react') ||
      key.startsWith('__vue')
    ) {
      return true;
    }
  }
  return (
    Object.getOwnPropertyDescriptor(el, 'value') !== undefined ||
    el.hasAttribute('data-reactroot')
  );
}

/**
 * Framework fingerprints, most specific first. Each is an attribute or class
 * the editor sets on its own root — part of its public DOM contract, not a
 * site's markup.
 */
export function classifyEditor(el: HTMLElement): EditorKind {
  const inRoot = (selector: string): boolean =>
    el.matches(selector) || closestComposed(el, selector) !== null;

  // Code editors focus nested contenteditables/hidden textareas, so their
  // framework fingerprint must win before native element classification.
  if (inRoot('.monaco-editor')) return 'monaco';
  if (inRoot('.cm-content') || inRoot('.cm-editor')) return 'codemirror';
  if (isTextArea(el)) return 'textarea';
  if (isEditableInput(el)) return 'input';

  if (inRoot('.ProseMirror')) return 'prosemirror';
  if (el.hasAttribute('data-lexical-editor') || inRoot('[data-lexical-editor]'))
    return 'lexical';
  if (inRoot('.ql-editor')) return 'quill';
  if (el.hasAttribute('data-slate-editor') || inRoot('[data-slate-editor]'))
    return 'slate';
  if (inRoot('.DraftEditor-root') || inRoot('[data-contents="true"]'))
    return 'draftjs';
  if (isContentEditable(el)) return 'contenteditable';
  return 'unknown';
}

/**
 * Resolved direction, so RTL fields anchor the button on the correct side.
 *
 * The nearest explicit `dir` wins and is checked first — it is both the common
 * case and free, where `getComputedStyle` forces a style resolution. The
 * performance budget in UX-SPEC §0.5 exists because Grammarly measured >90% CPU
 * from exactly this kind of read, so avoiding one is worth the branch.
 */
export function resolveDirection(el: HTMLElement): 'ltr' | 'rtl' {
  const explicit = closestComposed(el, '[dir]')
    ?.getAttribute('dir')
    ?.toLowerCase();
  if (explicit === 'rtl') return 'rtl';
  if (explicit === 'ltr') return 'ltr';
  return globalThis.getComputedStyle(el).direction === 'rtl' ? 'rtl' : 'ltr';
}

export function describeField(el: HTMLElement): DetectedField {
  return {
    element: el,
    kind: classifyEditor(el),
    reactControlled: isReactControlled(el),
    direction: resolveDirection(el),
  };
}

export function resolveEditorTarget(el: HTMLElement): EditorTarget {
  return {
    focusElement: el,
    anchorElement: visualEditorRoot(el),
    kind: classifyEditor(el),
    direction: resolveDirection(el),
  };
}

/** Read the current text, whichever kind of field it is. */
export function readValue(el: HTMLElement): string {
  const kind = classifyEditor(el);
  if (kind === 'monaco') {
    // Preview only. The exact draft is read from Monaco's model through the
    // MAIN-world bridge before enhancement.
    return (
      visualEditorRoot(el).querySelector<HTMLElement>('.view-lines')
        ?.innerText ?? ''
    );
  }
  if (isTextArea(el) || isEditableInput(el)) return el.value;
  return el.innerText;
}

/**
 * Site opt-out (UX-SPEC §0.4). Checked on the field and every ancestor, and
 * honoured before any injection happens.
 */
export function isOptedOut(el: Element): boolean {
  return (
    closestComposed(el, '[data-promptamp="false"]') !== null ||
    closestComposed(el, '[data-gramm="false"]') !== null ||
    closestComposed(el, '[data-enable-grammarly="false"]') !== null
  );
}

/** UX-SPEC §1.1: below this the field is too small to be a prompt box. */
export const MIN_FIELD_HEIGHT = 40;
export const MIN_FIELD_WIDTH = 200;

/**
 * The wide-single-line exception, ground-truthed on gemini.google.com: its
 * composer's true editable is a short line inside a padded pill, so the 40px
 * height floor silently rejected the most-visited AI site there is. Flow can
 * expose the same capability as a native text input. Requiring a substantial
 * width keeps compact form controls, chips, and tag inputs out.
 */
export const MIN_LINE_HEIGHT = 16;
export const MIN_LINE_WIDTH = 320;

export function isLargeEnough(el: Element): boolean {
  const rect = visualEditorRoot(el).getBoundingClientRect();
  if (rect.height >= MIN_FIELD_HEIGHT && rect.width >= MIN_FIELD_WIDTH) {
    return true;
  }
  return rect.height >= MIN_LINE_HEIGHT && rect.width >= MIN_LINE_WIDTH;
}

/**
 * A field the site has locked. `readOnly` still accepts a programmatic write —
 * it only blocks the user — so nothing else stops us from replacing text in a
 * field the site deliberately made uneditable. Gate it explicitly.
 */
export function isLocked(el: Element): boolean {
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    if (el.readOnly || el.disabled) return true;
  }
  return closestComposed(el, '[contenteditable="false"]') !== null;
}

/** Every gate from UX-SPEC §1.1, in the order that fails cheapest first. */
export function qualifies(el: Element | null): el is HTMLElement {
  if (!isEditable(el)) return false;
  if (isLocked(el)) return false;
  if (isOptedOut(el)) return false;
  if (isEditableInput(el)) {
    // Google Flow and a growing number of compact AI composers use a native
    // text input for their prompt line. The insertion engine already supports
    // these exactly; the old blanket exclusion made detection impossible.
    // Keep the affordance off ordinary form fields by accepting only a wide,
    // visibly rendered prompt line.
    const rect = visualEditorRoot(el).getBoundingClientRect();
    return rect.width >= MIN_LINE_WIDTH && rect.height >= MIN_LINE_HEIGHT;
  }
  return isLargeEnough(el);
}
