import { createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Quill from 'quill';
import 'quill/dist/quill.snow.css';
import { createEditor } from 'lexical';
import { registerPlainText } from '@lexical/plain-text';
import { EditorView, basicSetup } from 'codemirror';
import { insertText } from '../lib/insertion/engine';
import { qualifies } from '../lib/insertion/detect';
import { mainWorldInsertFunction } from '../lib/insertion/main-world';

/**
 * Mounts one real editor per insertion tier.
 *
 * Real libraries, not stand-ins: the tiers exist precisely because these
 * editors behave differently from a plain textarea, so a mock would test
 * nothing. Everything is bundled — no CDN, so the suite runs offline and
 * deterministically.
 *
 * Each editor exposes a `readValue()` on `window.playground` so a Playwright
 * assertion can read the editor's *own model* rather than scraped DOM text.
 * That distinction matters: a tier can update the DOM and leave the model
 * stale, which is the exact bug this engine exists to prevent.
 */

declare global {
  interface Window {
    playground: Record<string, () => string>;
    promptampInsert: (
      testId: string,
      text: string,
    ) => Promise<{ ok: boolean; tier: string | null; undoLost: boolean }>;
    promptampQualifies: (testId: string) => boolean;
  }
}

const readers: Record<string, () => string> = {};
window.playground = readers;

/**
 * Test harness — playground only, never shipped.
 *
 * It drives the *real* insertion engine against these *real* editors, so the
 * Playwright suite can prove tier selection and read-back verification before
 * the button and panel exist. Without it, Phase 4 would have no acceptance
 * until the whole UI was built.
 */
window.promptampInsert = async (testId, text) => {
  const target = findField(testId);
  if (!target) throw new Error(`no field for ${testId}`);
  target.focus();

  const outcome = await insertText(target, text, {
    // In the playground the page *is* the main world, so tier 4 can call the
    // editor's API directly instead of going through scripting.executeScript.
    mainWorldInsert: (value: string) =>
      Promise.resolve(mainWorldInsertFunction(value)),
  });

  return { ok: outcome.ok, tier: outcome.tier, undoLost: outcome.undoLost };
};

/** Exposes the real qualification gates so e2e can assert suppression. */
window.promptampQualifies = (testId) => qualifies(findField(testId));

/** Resolves a testid to the focusable editable, including inside shadow roots. */
function findField(testId: string): HTMLElement | null {
  const direct = document.querySelector<HTMLElement>(
    `[data-testid="${testId}"]`,
  );
  if (direct?.shadowRoot) {
    return direct.shadowRoot.querySelector<HTMLElement>('textarea');
  }
  if (direct && isFocusableEditable(direct)) return direct;
  // Quill and CodeMirror wrap the real editable inside a host container.
  return (
    direct?.querySelector<HTMLElement>(
      '.ql-editor, .cm-content, [contenteditable="true"], textarea',
    ) ?? direct
  );
}

function isFocusableEditable(el: HTMLElement): boolean {
  return (
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLInputElement ||
    el.isContentEditable
  );
}

/* ── Tier 1 · React controlled textarea ──────────────────────────── */

function ControlledTextarea() {
  const [value, setValue] = useState('');
  // Reading state (not the DOM) is what proves React actually committed.
  readers.react = () => value;
  return createElement('textarea', {
    id: 'react-textarea',
    'data-testid': 'react-textarea',
    rows: 4,
    value,
    placeholder: 'React-controlled draft…',
    onChange: (event: { target: { value: string } }) => {
      setValue(event.target.value);
    },
  });
}

const reactRoot = document.getElementById('react-root');
if (reactRoot) createRoot(reactRoot).render(createElement(ControlledTextarea));

/* ── Tier 1/2 · plain fields ─────────────────────────────────────── */

readers.plain = () =>
  (document.getElementById('plain-textarea') as HTMLTextAreaElement).value;
readers.rtl = () =>
  (document.getElementById('rtl-textarea') as HTMLTextAreaElement).value;
readers.contenteditable = () =>
  document.getElementById('plain-contenteditable')?.innerText ?? '';
readers.dialog = () =>
  (document.getElementById('dialog-textarea') as HTMLTextAreaElement).value;
readers.overlap = () =>
  (document.getElementById('overlap-textarea') as HTMLTextAreaElement).value;

/* ── Tier 2 · Quill ──────────────────────────────────────────────── */

const quillHost = document.getElementById('quill-host');
if (quillHost) {
  const quill = new Quill(quillHost, {
    theme: 'snow',
    placeholder: 'Quill draft…',
  });
  readers.quill = () => quill.getText().replace(/\n$/, '');
}

/* ── Tier 3 · Lexical ────────────────────────────────────────────── */

const lexicalHost = document.getElementById('lexical-host');
if (lexicalHost) {
  const root = document.createElement('div');
  root.contentEditable = 'true';
  root.setAttribute('data-testid', 'lexical-editor');
  root.setAttribute('role', 'textbox');
  root.setAttribute('aria-multiline', 'true');
  root.setAttribute('aria-labelledby', 'lexical-label');
  root.className = 'lexical-editor';
  lexicalHost.append(root);

  const editor = createEditor({
    namespace: 'playground',
    onError: (error: unknown) => {
      console.error('lexical', error);
    },
  });
  editor.setRootElement(root);
  registerPlainText(editor);

  readers.lexical = () => {
    let text = '';
    editor.getEditorState().read(() => {
      text = root.innerText;
    });
    return text;
  };
}

/* ── Tier 4 · CodeMirror 6 ───────────────────────────────────────── */

const cmHost = document.getElementById('codemirror-host');
if (cmHost) {
  const view = new EditorView({
    doc: '',
    extensions: [basicSetup],
    parent: cmHost,
  });
  // Reads the EditorState document, not the rendered lines — a DOM-only write
  // would leave this stale, which is exactly what tier 4 exists to avoid.
  readers.codemirror = () => view.state.doc.toString();
}

/* ── Containers ──────────────────────────────────────────────────── */

const shadowHost = document.getElementById('shadow-host');
if (shadowHost) {
  // Open, not closed: activeElement stops at the host, and the engine has to
  // walk down to find the real field.
  const shadow = shadowHost.attachShadow({ mode: 'open' });
  const area = document.createElement('textarea');
  area.setAttribute('data-testid', 'shadow-textarea');
  area.rows = 4;
  area.placeholder = 'Inside a shadow root…';
  area.style.cssText = 'width:100%;min-height:120px;font:inherit;padding:8px;';
  shadow.append(area);
  readers.shadow = () => area.value;
}

const dialog = document.getElementById(
  'test-dialog',
) as HTMLDialogElement | null;
document
  .querySelector('[data-testid="open-dialog"]')
  ?.addEventListener('click', () => dialog?.showModal());
document
  .querySelector('[data-testid="close-dialog"]')
  ?.addEventListener('click', () => dialog?.close());
