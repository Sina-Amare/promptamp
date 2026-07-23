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
 * Inside corners lead — the convention Grammarly/LanguageTool established, and
 * the placement live testing validated. The outside-first experiment failed on
 * real chat UIs: ChatGPT and Claude wrap the true editable in a padded visual
 * shell, so "just outside the field" lands ON the shell's border and reads as
 * a glitch. Inside `bottom-end` sits where the eye already is (the send row),
 * the occupancy check walks it off any control there, and the outside rungs
 * remain as genuine fallbacks for tiny or crowded fields.
 */
export const CORNER_LADDER: ButtonCorner[] = [
  'bottom-end',
  'top-end',
  'bottom-start',
  'top-start',
  'outside-end',
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
    // Edge midpoints: a pill-shaped control's rounded corners are transparent
    // to hit-testing, so corner probes slide past it — but at its vertical
    // midline the cap is at its widest, and these catch it.
    [point.left + 2, point.top + half],
    [point.left + size - 2, point.top + half],
    [point.left + half, point.top + 2],
    [point.left + half, point.top + size - 2],
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
/**
 * The visual composer shell around a bare editable.
 *
 * On real chat UIs (ChatGPT, Claude, Grok) the true editable is only the text
 * block; the rounded box the user sees — with its control row ("+", model
 * picker, mic, send) and its empty space — is an ancestor wrapper. Docking
 * into the *editable's* bottom row lands on the last line of text; the empty
 * space lives in the shell. Walk a few ancestors up and take the first that
 * extends meaningfully below the editable (that extension IS the control row)
 * while still wrapping it horizontally like a composer box would.
 */
export function shellRect(field: Element, fieldBox: DOMRect): DOMRect {
  let candidate: Element | null = field.parentElement;
  for (let hops = 0; candidate && hops < 4; hops++) {
    const box = candidate.getBoundingClientRect();
    // Sanity: a composer shell is box-like, not the page or a scroll region.
    const sane =
      box.height <= fieldBox.height + 160 && box.width <= fieldBox.width + 320;

    // Multi-line composers (ChatGPT, Claude): the control row sits BELOW the
    // text block, inside a wrapper that spans it horizontally.
    const rowBelow =
      box.bottom - fieldBox.bottom >= 36 &&
      box.left <= fieldBox.left + 16 &&
      box.right >= fieldBox.right - 16;

    // Single-line pills (Grok, ChatGPT's empty bar): the control cluster sits
    // to the END of the text, inside a wrapper that spans it vertically.
    const rowBeside =
      (box.right - fieldBox.right >= 36 || fieldBox.left - box.left >= 36) &&
      box.top <= fieldBox.top + 8 &&
      box.bottom >= fieldBox.bottom - 8;

    if (sane && (rowBelow || rowBeside)) return box;
    candidate = candidate.parentElement;
  }
  return fieldBox;
}

/**
 * Does this slot sit on the field's own text? `caretRangeFromPoint` finds the
 * nearest text position; the slot only counts as "on text" when that text
 * node's painted rects actually reach the slot — a caret snapped in from an
 * empty region does not.
 */
function overText(field: Element, point: Point, size: number): boolean {
  const doc = field.ownerDocument;
  // Three probes across the slot — a single centre sample slips between line
  // boxes and misses full-width lines.
  const y = point.top + size / 2;
  const xs = [point.left + 4, point.left + size / 2, point.left + size - 4];
  for (const x of xs) {
    const caret = doc.caretRangeFromPoint?.(x, y);
    const node = caret?.startContainer;
    if (!node || node.nodeType !== Node.TEXT_NODE || !field.contains(node)) {
      continue;
    }
    if (!(node.textContent ?? '').trim()) continue;
    const range = doc.createRange();
    range.selectNodeContents(node);
    for (const r of range.getClientRects()) {
      if (
        r.left < point.left + size &&
        point.left < r.right &&
        r.top < point.top + size &&
        point.top < r.bottom
      ) {
        return true;
      }
    }
  }
  return false;
}

/**
 * ONE deterministic home — learned the hard way.
 *
 * Seven rounds of heuristics (corner ladders, occupancy hopping, visual-shell
 * walking) each fixed one real site and broke another: real chat DOMs defeat
 * geometry guessing. What survived every live test as "perfect" was the same
 * spot each time: the field's own bottom-end corner. So that is the rule now,
 * Grammarly-style: the disc lives at the field's physical bottom-right
 * (bottom-left only if the user chose it), reading ONLY the field's own rect —
 * never an ancestor's. It slides sideways, at most a few steps, when a real
 * control or the user's own text is under it; if everything is busy it takes
 * the corner anyway — a visible disc beats a missing one. Deterministic in,
 * deterministic out: the same field always yields the same spot.
 */
export function placeButton(
  field: Element,
  direction: 'ltr' | 'rtl',
  size: number,
  preferred: ButtonCorner | null,
  ignore: (el: Element) => boolean,
): PlacementResult {
  void direction; // physical placement on purpose: RTL must not flip the disc
  const box = field.getBoundingClientRect();
  const rect: Rect = {
    top: box.top,
    left: box.left,
    width: box.width,
    height: box.height,
  };

  const startIsRight = preferred !== 'bottom-start';
  const corner: ButtonCorner = startIsRight ? 'bottom-end' : 'bottom-start';

  // A box shorter than the disc + insets has no "bottom row" — the row IS the
  // box. Centre vertically there, or the maths lands above the top edge.
  const rowTop =
    rect.height < size + EDGE_INSET * 2
      ? rect.top + (rect.height - size) / 2
      : rect.top + rect.height - EDGE_INSET - size;

  const slotAt = (step: number): number =>
    startIsRight
      ? rect.left + rect.width - EDGE_INSET - size - step * HIT_ZONE
      : rect.left + EDGE_INSET + step * HIT_ZONE;

  for (let step = 0; step < 6; step++) {
    const left = slotAt(step);
    if (left < rect.left || left + size > rect.left + rect.width) break;
    const slot: Point = { top: rowTop, left };
    if (!fitsInViewport(slot, size)) break;
    if (
      !isCornerOccupied(slot, HIT_ZONE, ignore) &&
      !overText(field, slot, size)
    ) {
      return { corner, point: slot, forced: false };
    }
  }

  // Every in-field slot sits on the user's words (an internally-scrolling
  // editable is solid text). Tier two, still deterministic and still only the
  // field's own rect: the band just below the field's bottom edge — on real
  // chat shells that IS the control row, on a bare textarea it is the page
  // margin. Slide along it past the row's own controls. Never on text.
  const belowTop = rect.top + rect.height + EDGE_INSET / 2;
  for (let step = 0; step < 6; step++) {
    const left = slotAt(step);
    if (left < rect.left || left + size > rect.left + rect.width) break;
    const slot: Point = { top: belowTop, left };
    if (!fitsInViewport(slot, size)) break;
    if (!isCornerOccupied(slot, HIT_ZONE, ignore)) {
      return { corner: 'outside-below', point: slot, forced: false };
    }
  }

  // Truly nowhere: take the corner anyway rather than wandering off.
  return { corner, point: { top: rowTop, left: slotAt(0) }, forced: true };
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
