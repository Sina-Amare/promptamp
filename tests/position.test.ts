import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CORNER_LADDER,
  OUTSIDE_GAP,
  cornerPosition,
  fitsInViewport,
  type Rect,
} from '../lib/ui/position';

/**
 * The placement maths is pure, so it is tested without a DOM. The parts that
 * need `getBoundingClientRect`/`elementsFromPoint` (collision, `placeButton`)
 * are exercised end-to-end in Playwright instead.
 */

const field: Rect = { top: 100, left: 200, width: 300, height: 60 };
const SIZE = 40;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('outside-end placement', () => {
  it('leads the ladder — never on the text is the default', () => {
    expect(CORNER_LADDER[0]).toBe('outside-end');
  });

  it('hangs past the end edge, vertically centred (LTR → right)', () => {
    const point = cornerPosition(field, 'outside-end', 'ltr', SIZE);
    // Right of the field's border, with the gap.
    expect(point.left).toBe(field.left + field.width + OUTSIDE_GAP);
    // Centred on the field.
    expect(point.top).toBe(field.top + field.height / 2 - SIZE / 2);
  });

  it('mirrors for RTL (→ left of the field)', () => {
    const point = cornerPosition(field, 'outside-end', 'rtl', SIZE);
    expect(point.left).toBe(field.left - OUTSIDE_GAP - SIZE);
    expect(point.top).toBe(field.top + field.height / 2 - SIZE / 2);
  });
});

describe('viewport guard', () => {
  it('accepts a point fully inside the viewport', () => {
    vi.stubGlobal('innerWidth', 1000);
    vi.stubGlobal('innerHeight', 800);
    expect(fitsInViewport({ top: 110, left: 508 }, SIZE)).toBe(true);
  });

  it('rejects a point past the right edge (full-width composer)', () => {
    vi.stubGlobal('innerWidth', 1000);
    vi.stubGlobal('innerHeight', 800);
    // Field flush to the right → outside-end would land off-screen.
    expect(fitsInViewport({ top: 110, left: 980 }, SIZE)).toBe(false);
  });

  it('rejects a point off the top or left edge', () => {
    vi.stubGlobal('innerWidth', 1000);
    vi.stubGlobal('innerHeight', 800);
    expect(fitsInViewport({ top: -5, left: 100 }, SIZE)).toBe(false);
    expect(fitsInViewport({ top: 100, left: -5 }, SIZE)).toBe(false);
    expect(fitsInViewport({ top: 790, left: 100 }, SIZE)).toBe(false);
  });
});
