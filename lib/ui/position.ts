import type { ButtonCorner } from '../storage/schemas';

/**
 * Where the button sits, and — more importantly — where it must not.
 *
 * Covering a host control is the single most-reported complaint against every
 * incumbent in this category: Grammarly over send buttons, Bitwarden over
 * password reveal icons. So collision detection here is not polish, it is the
 * feature. The corner is hit-tested before the button is shown, and again
 * whenever the field resizes.
 */

/** Inset from the field's border box, per UX-SPEC §1.2. */
export const EDGE_INSET = 8;

/** Gap between the field's outer border and an outside-placed button. */
export const OUTSIDE_GAP = 8;

/** The zone that must be clear. Matches the button's 40px hit area plus margin. */
export const HIT_ZONE = 48;

/**
 * The flip ladder.
 *
 * `outside-end` leads: hanging in the margin past the field's end edge is the
 * one placement that can never cover the user's own text, which was the
 * top complaint about sitting inside the corner. It falls back to the inside
 * corners (the convention Grammarly/LanguageTool established) only when there
 * is no room outside — a field flush against the window edge — and to
 * `outside-below` as the last resort.
 */
export const CORNER_LADDER: ButtonCorner[] = [
  'outside-end',
  'bottom-end',
  'bottom-start',
  'top-end',
  'top-start',
  'outside-below',
];

export interface Point {
  top: number;
  left: number;
}

export interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * Corner → document coordinates.
 *
 * "end" and "start" are resolved against the *field's* direction, not the
 * page's: an RTL Persian composer puts the button bottom-left, which no
 * incumbent does and which is the whole reason RTL drafts feel unserved.
 */
export function cornerPosition(
  field: Rect,
  corner: ButtonCorner,
  direction: 'ltr' | 'rtl',
  size: number,
): Point {
  const endIsRight = direction === 'ltr';
  const inset = EDGE_INSET;

  const right = field.left + field.width - inset - size;
  const left = field.left + inset;
  const bottom = field.top + field.height - inset - size;
  const top = field.top + inset;

  // Viewport coordinates. The layer is fixed and lives in the top layer, so
  // it can stay interactive while a modal <dialog> renders the rest of the
  // document inert — the one placement the spec calls out explicitly.
  const at = (t: number, l: number): Point => ({ top: t, left: l });

  switch (corner) {
    case 'outside-end': {
      // In the margin just past the field's end border — never over the
      // field's own content. Vertically: centred on a single-line field, but
      // bottom-aligned on a tall composer — a disc floating at the mid-height
      // of a five-line box looks detached, while the bottom line is where the
      // send button and the user's eye already are. "end" follows the field's
      // direction, so an RTL composer places it to the left.
      const tall = field.height > size * 2.5;
      const vert = tall
        ? field.top + field.height - size - inset
        : field.top + field.height / 2 - size / 2;
      const outerRight = field.left + field.width + OUTSIDE_GAP;
      const outerLeft = field.left - OUTSIDE_GAP - size;
      return at(vert, endIsRight ? outerRight : outerLeft);
    }
    case 'bottom-end':
      return at(bottom, endIsRight ? right : left);
    case 'bottom-start':
      return at(bottom, endIsRight ? left : right);
    case 'top-end':
      return at(top, endIsRight ? right : left);
    case 'top-start':
      return at(top, endIsRight ? left : right);
    case 'outside-below':
      // Hanging just below the field's bottom end-corner edge.
      return at(
        field.top + field.height + inset / 2,
        endIsRight ? right : left,
      );
  }
}

/**
 * Does the button's box fit inside the viewport at this point?
 *
 * The outside placements can land off-screen when a field is flush against a
 * window edge (full-width composers are common). A corner that would render
 * the button partly or wholly out of view is unusable, so `placeButton` skips
 * it and drops to the next rung.
 */
export function fitsInViewport(point: Point, size: number): boolean {
  return (
    point.left >= 0 &&
    point.top >= 0 &&
    point.left + size <= globalThis.innerWidth &&
    point.top + size <= globalThis.innerHeight
  );
}

/**
 * Is something interactive already at this corner?
 *
 * `elementsFromPoint` returns the full stack at a coordinate, so this catches
 * a send button *behind* a transparent overlay as well as one on top. Sampling
 * the zone's centre and its four corners is enough to catch partial overlap
 * without paying for a full grid.
 */
export function isCornerOccupied(
  point: Point,
  size: number,
  ignore: (el: Element) => boolean = () => false,
): boolean {
  const half = size / 2;
  const samples: [number, number][] = [
    [point.left + half, point.top + half],
    [point.left + 2, point.top + 2],
    [point.left + size - 2, point.top + 2],
    [point.left + 2, point.top + size - 2],
    [point.left + size - 2, point.top + size - 2],
  ];

  for (const [x, y] of samples) {
    for (const element of document.elementsFromPoint(x, y)) {
      if (ignore(element)) continue;
      if (isInteractive(element)) return true;
      // Stop at the first element that is not ours — anything below it in the
      // stack is visually covered and cannot be clicked anyway.
      break;
    }
  }
  return false;
}

/**
 * Interactive by role or by affordance. The `cursor: pointer` check is the
 * heuristic that catches the div-with-a-click-listener pattern, which no
 * amount of semantic matching would find.
 */
export function isInteractive(el: Element): boolean {
  if (
    el.matches(
      'button, a[href], input, select, textarea, summary, [role="button"], [role="link"], [role="tab"], [contenteditable="true"], [tabindex]:not([tabindex="-1"])',
    )
  ) {
    // The field we are anchoring to is not a collision with itself.
    return !el.matches('textarea, [contenteditable="true"]');
  }
  return globalThis.getComputedStyle(el).cursor === 'pointer';
}

export interface PlacementResult {
  corner: ButtonCorner;
  point: Point;
  /** True when every corner was occupied and the last rung was taken anyway. */
  forced: boolean;
}

/**
 * Walk the ladder until a corner is clear. A user-chosen corner is tried
 * first — if they dragged the button somewhere, that preference outranks our
 * convention, and it is only overridden when it would cover a control.
 */
export function placeButton(
  field: Element,
  direction: 'ltr' | 'rtl',
  size: number,
  preferred: ButtonCorner | null,
  ignore: (el: Element) => boolean,
): PlacementResult {
  const box = field.getBoundingClientRect();
  const rect: Rect = {
    top: box.top,
    left: box.left,
    width: box.width,
    height: box.height,
  };

  const ladder = preferred
    ? [preferred, ...CORNER_LADDER.filter((c) => c !== preferred)]
    : CORNER_LADDER;

  for (const corner of ladder) {
    const point = cornerPosition(rect, corner, direction, size);
    // Skip a placement that would put the button off-screen (a field flush to
    // the window edge has no room for an outside corner).
    if (!fitsInViewport(point, size)) continue;
    // getBoundingClientRect and elementsFromPoint are both viewport-relative,
    // so no scroll conversion is needed on either side.
    if (!isCornerOccupied(point, HIT_ZONE, ignore)) {
      return { corner, point, forced: false };
    }
  }

  // Every fitting corner is occupied. Fall back to the inside bottom-end
  // corner — clamped on-screen — rather than an off-screen outside slot.
  const corner: ButtonCorner = 'bottom-end';
  return {
    corner,
    point: cornerPosition(rect, corner, direction, size),
    forced: true,
  };
}

/** UX-SPEC §0.6: an orphaned button floating over unrelated content is worse than none. */
export function isFieldVisible(field: Element): boolean {
  const rect = field.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return false;
  return (
    rect.bottom > 0 &&
    rect.top < globalThis.innerHeight &&
    rect.right > 0 &&
    rect.left < globalThis.innerWidth
  );
}
