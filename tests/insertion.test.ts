// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ladderFor, insertText } from '../lib/insertion/engine';
import {
  classifyEditor,
  isEditable,
  isEditableInput,
  isOptedOut,
  qualifies,
  readValue,
  resolveDirection,
} from '../lib/insertion/detect';
import {
  countInvisibleMarks,
  matchesSnapshot,
  restoreField,
  takeSnapshot,
  verifyInserted,
  verifyInsertedLoose,
} from '../lib/insertion/snapshot';

beforeEach(() => {
  document.body.innerHTML = '';
});

/** happy-dom reports zero-size boxes, so size gates need a stubbed rect. */
function withSize<T extends HTMLElement>(el: T, width = 600, height = 120): T {
  el.getBoundingClientRect = () =>
    ({
      width,
      height,
      top: 0,
      left: 0,
      right: width,
      bottom: height,
    }) as DOMRect;
  return el;
}

function mount<T extends HTMLElement>(html: string): T {
  document.body.innerHTML = html;
  return document.body.firstElementChild as T;
}

describe('editor classification', () => {
  it.each([
    ['<textarea></textarea>', 'textarea'],
    ['<div class="ProseMirror" contenteditable="true"></div>', 'prosemirror'],
    ['<div data-lexical-editor contenteditable="true"></div>', 'lexical'],
    ['<div class="ql-editor" contenteditable="true"></div>', 'quill'],
    ['<div data-slate-editor contenteditable="true"></div>', 'slate'],
    ['<div class="DraftEditor-root" contenteditable="true"></div>', 'draftjs'],
    ['<div class="cm-content" contenteditable="true"></div>', 'codemirror'],
    ['<div class="monaco-editor" contenteditable="true"></div>', 'monaco'],
    ['<div contenteditable="true"></div>', 'contenteditable'],
  ])('classifies %s', (html, expected) => {
    expect(classifyEditor(mount(html))).toBe(expected);
  });

  it('classifies a node nested inside an editor root', () => {
    mount('<div class="ProseMirror"><p><span id="inner">hi</span></p></div>');
    const inner = document.getElementById('inner')!;
    expect(classifyEditor(inner)).toBe('prosemirror');
  });

  it('treats a plain text input as editable but never qualifies it', () => {
    const input = withSize(mount<HTMLInputElement>('<input type="text">'));
    expect(isEditableInput(input)).toBe(true);
    expect(isEditable(input)).toBe(true);
    // Single-line boxes are noise for a rewrite affordance (UX-SPEC §1.1).
    expect(qualifies(input)).toBe(false);
  });

  it.each([
    'password',
    'email',
    'number',
    'search',
    'tel',
    'url',
    'date',
    'hidden',
  ])('never treats input[type=%s] as editable', (type) => {
    const input = mount<HTMLInputElement>(`<input type="${type}">`);
    expect(isEditableInput(input)).toBe(false);
    expect(qualifies(input)).toBe(false);
  });
});

describe('qualification gates', () => {
  it('accepts a large enough textarea', () => {
    expect(qualifies(withSize(mount('<textarea></textarea>')))).toBe(true);
  });

  it.each([
    [199, 120],
    [250, 24],
    [10, 10],
  ])('rejects a %ix%i field', (width, height) => {
    const el = withSize(mount('<textarea></textarea>'), width, height);
    expect(qualifies(el)).toBe(false);
  });

  it.each([
    // Gemini's real composer: a 445x24 line inside a padded pill. The plain
    // 40px height floor silently rejected it — a wide single line qualifies.
    [445, 24],
    [600, 39],
  ])('accepts a wide single-line composer (%ix%i)', (width, height) => {
    const el = withSize(mount('<textarea></textarea>'), width, height);
    expect(qualifies(el)).toBe(true);
  });

  it.each([
    'data-promptamp="false"',
    'data-gramm="false"',
    'data-enable-grammarly="false"',
  ])('honours the %s opt-out on the field', (attr) => {
    const el = withSize(mount(`<textarea ${attr}></textarea>`));
    expect(isOptedOut(el)).toBe(true);
    expect(qualifies(el)).toBe(false);
  });

  it('honours an opt-out on an ancestor', () => {
    document.body.innerHTML =
      '<section data-promptamp="false"><textarea id="t"></textarea></section>';
    const el = withSize(document.getElementById('t')!);
    expect(qualifies(el)).toBe(false);
  });

  it('rejects a non-editable element', () => {
    expect(qualifies(mount('<div>text</div>'))).toBe(false);
    expect(qualifies(null)).toBe(false);
  });
});

describe('direction resolution', () => {
  it('reports rtl for an RTL field so the button mirrors', () => {
    const el = mount<HTMLTextAreaElement>('<textarea dir="rtl"></textarea>');
    expect(resolveDirection(el)).toBe('rtl');
  });

  it('inherits direction from an ancestor', () => {
    document.body.innerHTML =
      '<div dir="rtl"><textarea id="t"></textarea></div>';
    expect(resolveDirection(document.getElementById('t')!)).toBe('rtl');
  });

  it('lets a nearer ltr override an rtl ancestor', () => {
    document.body.innerHTML =
      '<div dir="rtl"><textarea id="t" dir="ltr"></textarea></div>';
    expect(resolveDirection(document.getElementById('t')!)).toBe('ltr');
  });

  it('defaults to ltr', () => {
    expect(resolveDirection(mount('<textarea></textarea>'))).toBe('ltr');
  });
});

describe('escalation ladder', () => {
  it('starts plain fields on execCommand, which keeps native undo', () => {
    expect(ladderFor('textarea')[0]).toBe('exec-command');
    expect(ladderFor('textarea')).toContain('native-setter');
  });

  it('starts Lexical-family editors on paste simulation', () => {
    // execCommand does not merely fail on these — it can corrupt the document.
    for (const kind of ['lexical', 'slate', 'draftjs'] as const) {
      expect(ladderFor(kind)[0]).toBe('paste-simulation');
      expect(ladderFor(kind)).not.toContain('exec-command');
    }
  });

  it('starts code editors in the main world', () => {
    expect(ladderFor('codemirror')[0]).toBe('main-world');
    expect(ladderFor('monaco')[0]).toBe('main-world');
  });

  it('never puts the native setter on a rich editor', () => {
    for (const kind of [
      'contenteditable',
      'prosemirror',
      'quill',
      'lexical',
      'codemirror',
    ] as const) {
      expect(ladderFor(kind)).not.toContain('native-setter');
    }
  });
});

describe('verify-and-escalate', () => {
  it('escalates past a tier that reports success but changed nothing', async () => {
    // The core failure mode: execCommand returns true on editors that silently
    // drop the input. Only the read-back catches it.
    const el = withSize(mount<HTMLTextAreaElement>('<textarea></textarea>'));
    const seen: string[] = [];

    const outcome = await insertText(el, 'enhanced', {
      verify: (_el, expected) => {
        seen.push(expected);
        // Fail the first two tiers, succeed on the third.
        return seen.length >= 3;
      },
    });

    expect(outcome.ok).toBe(true);
    expect(outcome.attempts.length).toBeGreaterThan(1);
    expect(outcome.attempts.filter((a) => !a.ok).length).toBeGreaterThan(0);
  });

  it('falls back to the clipboard when every tier fails', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });

    const el = withSize(mount<HTMLTextAreaElement>('<textarea></textarea>'));
    const outcome = await insertText(el, 'enhanced', { verify: () => false });

    expect(outcome.clipboardFallback).toBe(true);
    expect(outcome.ok).toBe(true);
    expect(outcome.tier).toBe('clipboard');
    expect(writeText).toHaveBeenCalledWith('enhanced');
    vi.unstubAllGlobals();
  });

  it('rolls back a partial write when everything fails', async () => {
    vi.stubGlobal('navigator', {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    });

    const el = withSize(mount<HTMLTextAreaElement>('<textarea></textarea>'));
    el.value = 'my original draft';

    // A tier that writes but never verifies — the case that would otherwise
    // leave the user's field holding half-applied text.
    const outcome = await insertText(el, 'enhanced', { verify: () => false });

    expect(outcome.ok).toBe(false);
    expect(outcome.tier).toBeNull();
    // Principle 8: on any failure the draft is provably unchanged.
    expect(el.value).toBe('my original draft');
    vi.unstubAllGlobals();
  });

  it('reports undo loss when it had to use the native setter', async () => {
    // happy-dom has no execCommand, so tier 1a is skipped and the native setter
    // is what actually lands the text. Real verification, no stub.
    const el = withSize(mount<HTMLTextAreaElement>('<textarea></textarea>'));
    const outcome = await insertText(el, 'enhanced');

    expect(el.value).toBe('enhanced');
    expect(outcome.tier).toBe('native-setter');
    expect(outcome.undoLost).toBe(true);
  });

  it('dispatches an input event so frameworks commit the change', async () => {
    const el = withSize(mount<HTMLTextAreaElement>('<textarea></textarea>'));
    const seen: string[] = [];
    el.addEventListener('input', () => seen.push(el.value));

    await insertText(el, 'enhanced');
    expect(seen).toContain('enhanced');
  });

  it('uses the main-world hook for code editors', async () => {
    const mainWorldInsert = vi.fn().mockResolvedValue(true);
    const el = withSize(
      mount('<div class="cm-content" contenteditable="true"></div>'),
    );

    const outcome = await insertText(el, 'enhanced', {
      mainWorldInsert,
      verify: () => true,
    });

    expect(mainWorldInsert).toHaveBeenCalledWith('enhanced');
    expect(outcome.tier).toBe('main-world');
  });
});

describe('snapshot', () => {
  it('captures value and selection for a textarea', () => {
    const el = mount<HTMLTextAreaElement>('<textarea></textarea>');
    el.value = 'my draft';
    el.setSelectionRange(3, 5);

    const snapshot = takeSnapshot(el, 1000);
    expect(snapshot).toMatchObject({
      kind: 'value',
      text: 'my draft',
      selectionStart: 3,
      selectionEnd: 5,
      takenAt: 1000,
    });
    expect(matchesSnapshot(el, snapshot)).toBe(true);

    el.value = 'changed';
    expect(matchesSnapshot(el, snapshot)).toBe(false);
  });

  it('preserves Persian directional marks byte-for-byte', () => {
    // RLM and LRM are invisible in a diff and trivially lost by a trim() —
    // losing one silently changes how the whole line renders.
    const withMarks = '‏سلام‎ world‏';
    const el = mount<HTMLTextAreaElement>('<textarea></textarea>');
    el.value = withMarks;

    const snapshot = takeSnapshot(el);
    expect(snapshot.text).toBe(withMarks);
    expect(countInvisibleMarks(snapshot.text)).toBe(3);
  });

  it('verifies exactly for plain fields', () => {
    const el = mount<HTMLTextAreaElement>('<textarea></textarea>');
    el.value = 'exact  text ';
    expect(verifyInserted(el, 'exact  text ')).toBe(true);
    expect(verifyInserted(el, 'exact text')).toBe(false);
  });

  it('tolerates trailing-whitespace normalisation in rich editors only', () => {
    // happy-dom's innerText drops newlines entirely, so the multi-line case is
    // covered by the Playwright suite against real editors. This asserts the
    // single-line normalisation the loose verifier is actually for.
    const el = mount<HTMLDivElement>('<div contenteditable="true"></div>');
    el.innerText = '  line one   ';
    expect(verifyInsertedLoose(el, 'line one')).toBe(true);
    expect(verifyInsertedLoose(el, 'something else')).toBe(false);
  });

  it('restores a field directly when insertion left it corrupted', () => {
    const el = mount<HTMLTextAreaElement>('<textarea></textarea>');
    el.value = 'original ‏draft‎';
    const snapshot = takeSnapshot(el);

    el.value = 'half-written enha';
    expect(matchesSnapshot(el, snapshot)).toBe(false);

    expect(restoreField(el, snapshot)).toBe(true);
    expect(el.value).toBe('original ‏draft‎');
    expect(matchesSnapshot(el, snapshot)).toBe(true);
  });

  it('reads the value of whichever field kind it gets', () => {
    const textarea = mount<HTMLTextAreaElement>('<textarea></textarea>');
    textarea.value = 'from value';
    expect(readValue(textarea)).toBe('from value');

    const editable = mount<HTMLDivElement>(
      '<div contenteditable="true"></div>',
    );
    editable.innerText = 'from text';
    expect(readValue(editable)).toBe('from text');
  });
});
