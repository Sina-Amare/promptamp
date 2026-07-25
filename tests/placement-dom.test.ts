// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  controlRowCenter,
  isPlacementSafe,
  placeButton,
} from '../lib/ui/position';

function rect(
  left: number,
  top: number,
  width: number,
  height: number,
): DOMRect {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  };
}

function setRect(element: Element, box: DOMRect): void {
  element.getBoundingClientRect = () => box;
}

beforeEach(() => {
  document.body.replaceChildren();
  vi.stubGlobal('innerWidth', 1_000);
  vi.stubGlobal('innerHeight', 800);
  Object.defineProperty(document, 'elementsFromPoint', {
    configurable: true,
    value: () => [],
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('shipping composer placement', () => {
  it('uses the lowest action row and walks the complete hitbox off a control', () => {
    document.body.innerHTML = `
      <div id="shell">
        <textarea id="field"></textarea>
        <button id="format"><svg><path /></svg></button>
        <button id="send"><svg><path /></svg></button>
      </div>`;
    const shell = document.getElementById('shell')!;
    const field = document.getElementById('field')!;
    const format = document.getElementById('format')!;
    const send = document.getElementById('send')!;
    setRect(shell, rect(100, 80, 440, 180));
    setRect(field, rect(120, 100, 400, 80));
    setRect(format, rect(120, 195, 28, 28));
    setRect(send, rect(492, 218, 40, 40));
    (field as HTMLTextAreaElement).value = 'A draft uses the action row.';

    expect(controlRowCenter(field, () => false)).toBe(238);
    const placement = placeButton(field, 'ltr', 40, null, () => false);

    expect(placement.anchor).toBe(shell);
    expect(placement.point.top).toBe(218);
    expect(placement.point.left + 40).toBeLessThan(
      send.getBoundingClientRect().left,
    );
    expect(placement.forced).toBe(false);
  });

  it('keeps a manual pin exactly where the user dropped it', () => {
    document.body.innerHTML =
      '<div id="shell"><textarea id="field"></textarea><button id="send"></button></div>';
    const shell = document.getElementById('shell')!;
    const field = document.getElementById('field')!;
    const send = document.getElementById('send')!;
    setRect(shell, rect(100, 100, 440, 140));
    setRect(field, rect(120, 110, 360, 70));
    setRect(send, rect(492, 192, 40, 40));

    const dropped = { top: 20, left: 650 };
    const placement = placeButton(field, 'ltr', 40, null, () => false, dropped);

    expect(placement.slot).toBe('pinned-free');
    expect(placement.point).toEqual(dropped);
  });

  it('rejects a stale page-corner pin in external mode and docks beside the composer', () => {
    document.body.innerHTML = `
      <div id="shell" style="background-color: rgb(32, 32, 32); border-radius: 28px">
        <input id="field" aria-label="Ask Gemini" />
        <button id="model">Pro</button>
        <button id="mic">Mic</button>
      </div>`;
    const shell = document.getElementById('shell')!;
    const field = document.getElementById('field')!;
    setRect(shell, rect(240, 300, 620, 88));
    setRect(field, rect(300, 332, 420, 24));
    setRect(document.getElementById('model')!, rect(742, 324, 56, 40));
    setRect(document.getElementById('mic')!, rect(812, 324, 40, 40));

    const placement = placeButton(
      field,
      'ltr',
      40,
      null,
      () => false,
      { top: 0, left: 0 },
      'external',
    );

    expect(placement.visible).toBe(true);
    expect(placement.slot).toMatch(/^outside-/);
    expect(placement.point).not.toEqual({ top: 0, left: 0 });
    const target = rect(placement.point.left, placement.point.top, 40, 40);
    const shellBox = shell.getBoundingClientRect();
    const gapX = Math.max(
      shellBox.left - target.right,
      target.left - shellBox.right,
      0,
    );
    const gapY = Math.max(
      shellBox.top - target.bottom,
      target.top - shellBox.bottom,
      0,
    );
    expect(Math.hypot(gapX, gapY)).toBeLessThanOrEqual(8);
  });

  it('docks to the painted box, not the transparent inner column that hugs the send button (live Claude)', () => {
    // Live claude.ai: a painted rounded box (the visible composer) wraps a
    // TRANSPARENT flex column holding the editable above the control row. The
    // column's right edge is flush with the send button, so anchoring to it
    // made a zero-gap dock collide with send and cascade the disc into the dead
    // space below. The shell must resolve to the painted box (right 806), whose
    // padding clears the send button (right 791).
    document.body.innerHTML = `
      <div id="box" style="background-color: rgb(44, 44, 42); border-radius: 20px">
        <div id="column">
          <div id="field" contenteditable="true"></div>
          <div id="row">
            <button id="plus">+</button>
            <button id="model">Opus 4.8 Max</button>
            <button id="mic">Mic</button>
            <button id="send">Send</button>
          </div>
        </div>
      </div>`;
    const box = document.getElementById('box')!;
    const field = document.getElementById('field')!;
    setRect(box, rect(38, 543, 768, 130)); // right 806, bottom 673
    setRect(document.getElementById('column')!, rect(53, 558, 738, 101)); // right 791
    setRect(field, rect(59, 564, 732, 22)); // editable above the row
    setRect(document.getElementById('row')!, rect(55, 598, 736, 32));
    setRect(document.getElementById('plus')!, rect(55, 598, 32, 32));
    setRect(document.getElementById('model')!, rect(553, 598, 118, 32));
    setRect(document.getElementById('mic')!, rect(679, 598, 32, 32));
    setRect(document.getElementById('send')!, rect(759, 598, 32, 32)); // right 791, flush with column

    const placement = placeButton(
      field,
      'ltr',
      40,
      null,
      () => false,
      null,
      'external',
    );

    // The visible painted box is the shell — not the inner control column.
    expect(placement.anchor).toBe(box);
    // Docks to the right edge on the control row, never the dead space below.
    expect(placement.slot).toBe('outside-right');
    expect(placement.point.left).toBe(box.getBoundingClientRect().right);
    expect(placement.visible).toBe(true);
  });

  it('keeps the compatibility launcher visible outside a delegated page surface', () => {
    document.body.innerHTML = `
      <main id="delegated" style="cursor:pointer">
        <div id="shell" style="background-color: rgb(32, 32, 32); border-radius: 28px">
          <input id="field" aria-label="What do you want to create?" />
        </div>
      </main>
      <div id="page-surface" role="button"></div>`;
    const delegated = document.getElementById('delegated')!;
    const pageSurface = document.getElementById('page-surface')!;
    const shell = document.getElementById('shell')!;
    const field = document.getElementById('field')!;
    setRect(delegated, rect(0, 0, 1_000, 800));
    setRect(pageSurface, rect(0, 0, 1_000, 800));
    setRect(shell, rect(220, 620, 620, 88));
    setRect(field, rect(260, 648, 500, 24));
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: () => [pageSurface, delegated],
    });

    const placement = placeButton(
      field,
      'ltr',
      40,
      null,
      () => false,
      null,
      'external',
    );

    expect(placement.visible).toBe(true);
    expect(placement.forced).toBe(true);
    expect(placement.slot).toBe('outside-right');
    expect(placement.point.left).toBe(shell.getBoundingClientRect().right);
  });

  it('reprojects a saved pin only when a late host control occupies it', () => {
    document.body.innerHTML =
      '<div id="shell"><textarea id="field"></textarea><button id="pro">Pro</button></div>';
    const shell = document.getElementById('shell')!;
    const field = document.getElementById('field')!;
    const pro = document.getElementById('pro')!;
    setRect(shell, rect(100, 100, 700, 80));
    setRect(field, rect(150, 128, 500, 24));
    setRect(pro, rect(700, 120, 80, 40));
    const occupied = { top: 120, left: 720 };

    const placement = placeButton(
      field,
      'ltr',
      40,
      null,
      () => false,
      occupied,
    );

    expect(placement.point).not.toEqual(occupied);
    expect(placement.visible).toBe(true);
    expect(
      placement.point.left < 780 &&
        placement.point.left + 40 > 700 &&
        placement.point.top < 160 &&
        placement.point.top + 40 > 120,
    ).toBe(false);
  });

  it('uses the empty top corner of a tall painted composer surface', () => {
    document.body.innerHTML = `
      <div id="shell" style="background-color: rgb(32, 32, 32); border-radius: 28px">
        <div id="field" contenteditable="true"></div>
      </div>`;
    const shell = document.getElementById('shell')!;
    const field = document.getElementById('field')!;
    setRect(shell, rect(100, 100, 700, 180));
    setRect(field, rect(128, 128, 644, 80));

    const placement = placeButton(field, 'ltr', 40, null, () => false);

    expect(placement.anchor).toBe(shell);
    expect(placement.point.top).toBe(108);
    expect(placement.corner).toBe('top-end');
  });

  it('crosses a shadow boundary to avoid late light-DOM composer controls', () => {
    document.body.innerHTML = `
      <div id="shell">
        <button id="plus">+</button>
        <rich-textarea id="host"></rich-textarea>
        <button id="pro">Pro</button>
        <button id="mic">Mic</button>
      </div>`;
    const shell = document.getElementById('shell')!;
    const host = document.getElementById('host')!;
    const shadow = host.attachShadow({ mode: 'open' });
    const field = document.createElement('div');
    field.className = 'ql-editor';
    field.contentEditable = 'true';
    shadow.append(field);

    setRect(shell, rect(100, 100, 700, 80));
    setRect(host, rect(160, 128, 450, 24));
    setRect(field, rect(160, 128, 450, 24));
    setRect(document.getElementById('plus')!, rect(108, 120, 40, 40));
    setRect(document.getElementById('pro')!, rect(744, 120, 48, 40));
    setRect(document.getElementById('mic')!, rect(690, 120, 40, 40));

    const placement = placeButton(field, 'ltr', 40, null, () => false);
    const placed = rect(placement.point.left, placement.point.top, 40, 40);

    expect(placement.anchor).toBe(shell);
    expect(placement.visible).toBe(true);
    expect(
      placed.left < 792 &&
        placed.right > 744 &&
        placed.top < 160 &&
        placed.bottom > 120,
    ).toBe(false);
  });

  it('never puts a full target over text in a bare textarea', () => {
    const field = document.createElement('textarea');
    field.value = 'Typed text that occupies the composer';
    document.body.append(field);
    setRect(field, rect(100, 100, 400, 100));

    expect(
      isPlacementSafe(field, { top: 152, left: 452 }, 40, () => false),
    ).toBe(false);
  });

  it('uses overlay-independent range rectangles to reject painted rich text', () => {
    const field = document.createElement('div');
    field.contentEditable = 'true';
    const text = document.createTextNode('متن تایپ شده');
    field.append(text);
    document.body.append(field);
    setRect(field, rect(100, 100, 400, 120));
    vi.spyOn(document, 'createRange').mockReturnValue({
      selectNodeContents: () => undefined,
      getClientRects: () => [rect(430, 160, 60, 24)],
    } as unknown as Range);

    expect(
      isPlacementSafe(field, { top: 152, left: 452 }, 40, () => false),
    ).toBe(false);
  });

  it('resolves the clipped composer shell when the editor rect is much taller', () => {
    document.body.innerHTML = `
      <div id="shell" style="overflow: hidden">
        <div id="field" contenteditable="true">A long visible draft</div>
        <div id="row">
          <button id="plus">+</button>
          <button id="model">High</button>
          <button id="mic">Mic</button>
          <button id="send">Send</button>
        </div>
      </div>`;
    const shell = document.getElementById('shell')!;
    const field = document.getElementById('field')!;
    setRect(shell, rect(140, 165, 1_056, 353));
    // The real failure: layout says the editor continues below the clipped
    // rounded composer, so editor-bottom anchoring points near the page edge.
    setRect(field, rect(165, 175, 990, 560));
    setRect(document.getElementById('plus')!, rect(154, 460, 40, 40));
    setRect(document.getElementById('model')!, rect(982, 460, 80, 40));
    setRect(document.getElementById('mic')!, rect(1_078, 460, 40, 40));
    setRect(document.getElementById('send')!, rect(1_136, 455, 50, 50));
    vi.stubGlobal('innerWidth', 1_280);
    vi.stubGlobal('innerHeight', 720);
    vi.spyOn(document, 'createRange').mockReturnValue({
      selectNodeContents: () => undefined,
      getClientRects: () => [
        rect(165, 180, 930, 28),
        rect(165, 300, 930, 28),
        rect(165, 420, 930, 28),
      ],
    } as unknown as Range);

    const placement = placeButton(field, 'ltr', 40, null, () => false);

    expect(placement.anchor).toBe(shell);
    expect(placement.slot).not.toBe('pinned');
    expect(placement.visible).toBe(true);
    expect(placement.point.top).toBe(460);
    expect(placement.point.top + 40).toBeLessThanOrEqual(
      shell.getBoundingClientRect().bottom,
    );
    expect(placement.point.top).not.toBeGreaterThanOrEqual(680);
    expect(
      isPlacementSafe(field, { top: 300, left: 1_090 }, 40, () => false),
    ).toBe(false);
  });

  it('hides instead of forcing a target over a tiny impossible viewport', () => {
    vi.stubGlobal('innerWidth', 60);
    vi.stubGlobal('innerHeight', 60);
    const field = document.createElement('textarea');
    document.body.append(field);
    setRect(field, rect(0, 0, 30, 24));

    const placement = placeButton(field, 'ltr', 40, null, () => false);
    expect(placement.visible).toBe(false);
    expect(placement.forced).toBe(true);
    expect(placement.point.left).toBeGreaterThanOrEqual(0);
    expect(placement.point.top).toBeGreaterThanOrEqual(0);
    expect(placement.point.left + 40).toBeLessThanOrEqual(60);
    expect(placement.point.top + 40).toBeLessThanOrEqual(60);
  });
});
