import type { ButtonCorner } from '../storage/schemas';
import { visualEditorRoot } from '../insertion/detect';
import {
  closestComposed,
  composedContains,
  composedElementsFromPoint,
  composedParentElement,
  queryComposedAll,
} from '../dom/composed';
import type { ComposerPlacementMode } from './compatibility';

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

/** Shipping fallback sits flush to the shell; visual padding supplies the gap. */
const DOCK_GAP = 0;

/** A manual external pin remains associated with its composer, not the page. */
const MAX_EXTERNAL_PIN_GAP = 160;

/** The zone that must be clear. Matches the button's 40px hit area plus margin. */
export const HIT_ZONE = 48;

/**
 * The flip ladder.
 *
 * The shipping presentation is external and composer-attached. This exported
 * ladder remains for the pure corner helpers and the internal automatic mode,
 * with the same outside-first order as production.
 */
export const CORNER_LADDER: ButtonCorner[] = [
  'outside-end',
  'outside-below',
  'bottom-end',
  'top-end',
  'bottom-start',
  'top-start',
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
    for (const element of composedElementsFromPoint(x, y)) {
      if (ignore(element)) continue;
      const owner = interactiveOwner(element);
      if (owner && !ignore(owner)) return true;
      if (isInteractive(element)) return true;
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
  /** The visual composer whose layout should trigger a reposition. */
  anchor: Element;
  /** Stable identity for the slot, used to avoid needless hopping. */
  slot: string;
  /** False when no collision-free complete hit target exists. */
  visible: boolean;
  /** True when no safe slot exists. The button is hidden, never forced over UI. */
  forced: boolean;
}

const HOST_CONTROL_SELECTOR =
  'button, [role="button"], [role="menuitem"], [aria-haspopup], [aria-expanded], [aria-controls], [aria-pressed], [tabindex]:not([tabindex="-1"]), [jsaction], [data-action]';

function paintsComposerSurface(style: CSSStyleDeclaration): boolean {
  const background = style.backgroundColor.replaceAll(' ', '').toLowerCase();
  const transparent =
    background === '' ||
    background === 'transparent' ||
    background === 'rgba(0,0,0,0)';
  const radii = style.borderRadius
    .split(/[\s/]+/)
    .map((value) => Number.parseFloat(value))
    .filter(Number.isFinite);
  const rounded = radii.some((radius) => radius >= 12);
  const painted =
    !transparent ||
    (style.backgroundImage !== '' && style.backgroundImage !== 'none');
  return rounded && painted;
}

/**
 * The visual composer shell around a bare editable.
 *
 * The editor rectangle is not a trustworthy description of what is painted.
 * Modern composers often make the contenteditable taller than the rounded
 * shell and clip it, or pull the action row over its padding. The former
 * implementation required the ancestor to extend below/beside the editor; on
 * those layouts it rejected the real shell and anchored to an invisible part
 * of the oversized editor — exactly how a disc ended up at the page edge.
 *
 * DOM ownership is the durable signal: the nearest reasonably-sized ancestor
 * shared by the editable and a visible composer control is the shell,
 * regardless of which rectangle is larger. A clipping ancestor is the second
 * strongest signal for control-less composers.
 */
export function composerShell(field: Element, fieldBox: DOMRect): Element {
  field = visualEditorRoot(field);
  fieldBox = field.getBoundingClientRect();
  let fallback = field;
  let controlShell: Element | null = null;
  let candidate: Element | null = composedParentElement(field);
  for (let hops = 0; candidate && hops < 12; hops++) {
    if (candidate === document.body || candidate === document.documentElement) {
      break;
    }
    const box = candidate.getBoundingClientRect();
    const overlapWidth =
      Math.min(box.right, fieldBox.right) - Math.max(box.left, fieldBox.left);
    const overlapHeight =
      Math.min(box.bottom, fieldBox.bottom) - Math.max(box.top, fieldBox.top);

    // A shell can clip an oversized editor, but it must still share a
    // meaningful visible area and remain composer-sized rather than page-sized.
    const sane =
      box.width > 0 &&
      box.height > 0 &&
      overlapWidth >= Math.min(120, box.width * 0.5) &&
      overlapHeight >= Math.min(20, box.height * 0.25) &&
      box.height <= Math.max(fieldBox.height + 220, 440) &&
      box.width <= Math.max(fieldBox.width + 640, fieldBox.width * 2.75);

    if (!sane) {
      candidate = composedParentElement(candidate);
      continue;
    }

    const style = globalThis.getComputedStyle(candidate);
    // The painted, rounded composer box is the strongest shell signal — it is
    // the boundary the user actually sees, and it carries the padding that
    // keeps a zero-gap side dock clear of the outermost controls. Prefer it
    // over a tighter inner control column: Claude nests its send/model row in a
    // TRANSPARENT flex column whose right edge hugs the send button, so docking
    // to that column lands the disc flush on the control (DOCK_GAP is 0) and
    // the collision test cascades the disc into the dead space below the box.
    // Custom-element composers (Gemini) also rely on this: their controls live
    // in separate elements, so only the painted surface identifies the shell.
    const hasComposerPadding =
      box.height >= fieldBox.height + 12 || box.width >= fieldBox.width + 24;
    if (hasComposerPadding && paintsComposerSurface(style)) return candidate;

    // A control-bearing ancestor that paints nothing is a fallback shell only:
    // remember the first, but keep walking in case the painted box is one hop
    // out (Claude's rounded container around the transparent column).
    const hasVisibleControl =
      visibleControlElements(candidate, field, () => false).length > 0;
    if (hasVisibleControl) {
      controlShell ??= candidate;
      candidate = composedParentElement(candidate);
      continue;
    }

    const clips = /(auto|scroll|hidden|clip)/.test(
      `${style.overflow}${style.overflowX}${style.overflowY}`,
    );
    const geometricallyClips =
      box.left > fieldBox.left + 1 ||
      box.right < fieldBox.right - 1 ||
      box.top > fieldBox.top + 1 ||
      box.bottom < fieldBox.bottom - 1;
    if (clips && geometricallyClips) {
      fallback = candidate;
    }
    candidate = composedParentElement(candidate);
  }
  return controlShell ?? fallback;
}

export function shellRect(field: Element, fieldBox: DOMRect): DOMRect {
  return composerShell(field, fieldBox).getBoundingClientRect();
}

/** Intersection of two viewport rectangles, or null when they do not meet. */
function intersectRects(
  a: { top: number; left: number; right: number; bottom: number },
  b: { top: number; left: number; right: number; bottom: number },
): { top: number; left: number; right: number; bottom: number } | null {
  const result = {
    top: Math.max(a.top, b.top),
    left: Math.max(a.left, b.left),
    right: Math.min(a.right, b.right),
    bottom: Math.min(a.bottom, b.bottom),
  };
  return result.right > result.left && result.bottom > result.top
    ? result
    : null;
}

/**
 * Does this slot intersect text that the editable can actually paint?
 *
 * Caret hit-testing is unsuitable for validating an overlay: once our button
 * is already at the point being checked, some engines return our shadow-tree
 * node (or null) instead of the text underneath. Range client rectangles are
 * independent of the overlay stack and work in Chromium, Firefox, and WebKit.
 * They also check the complete hitbox rather than three lucky sample points.
 */
function overText(field: Element, point: Point, size: number): boolean {
  const focusElement = field;
  field = visualEditorRoot(field);
  const candidate = pointRect(point, size);
  const shell = composerShell(field, field.getBoundingClientRect());
  let visibleEditor = intersectRects(
    field.getBoundingClientRect(),
    shell.getBoundingClientRect(),
  );
  if (!visibleEditor) return false;
  // Respect every clipping viewport between the editable and its shell.
  // Range rects include off-screen lines inside overflow containers.
  let ancestor = composedParentElement(field);
  while (ancestor && ancestor !== shell) {
    const style = globalThis.getComputedStyle(ancestor);
    if (
      /(auto|scroll|hidden|clip)/.test(
        `${style.overflow}${style.overflowX}${style.overflowY}`,
      )
    ) {
      visibleEditor = intersectRects(
        visibleEditor,
        ancestor.getBoundingClientRect(),
      );
      if (!visibleEditor) return false;
    }
    ancestor = composedParentElement(ancestor);
  }

  // Browser caret APIs do not expose the anonymous text nodes painted inside
  // a textarea. Treat its occupied content box conservatively: a bare
  // textarea with text sends the disc outside, while a real composer shell can
  // still use its separate action row.
  if (
    focusElement instanceof HTMLTextAreaElement &&
    focusElement.value.trim() &&
    rectsIntersect(candidate, visibleEditor)
  ) {
    return true;
  }

  if (focusElement instanceof HTMLInputElement) {
    const text = focusElement.value || focusElement.placeholder;
    if (!text.trim()) return false;
    const textRect = paintedInputTextRect(focusElement, text);
    return textRect
      ? rectsIntersect(candidate, textRect)
      : rectsIntersect(candidate, visibleEditor);
  }

  const doc = field.ownerDocument;
  if (!(field.textContent ?? '').trim()) return false;
  const range = doc.createRange();
  range.selectNodeContents(field);
  for (const textRect of range.getClientRects()) {
    const painted = intersectRects(textRect, visibleEditor);
    if (painted && rectsIntersect(candidate, painted)) {
      return true;
    }
  }
  return false;
}

/**
 * Native inputs paint anonymous text, so Range APIs cannot expose its client
 * rectangle. Measure the rendered line and project it into the input's content
 * box instead of either ignoring it or declaring the entire prompt line
 * occupied. That leaves genuine empty space usable in compact Flow-style
 * composers while keeping the complete target off both values and
 * placeholders.
 */
function paintedInputTextRect(
  input: HTMLInputElement,
  text: string,
): {
  top: number;
  right: number;
  bottom: number;
  left: number;
} | null {
  const box = input.getBoundingClientRect();
  const style = globalThis.getComputedStyle(input);
  const number = (value: string): number => Number.parseFloat(value) || 0;
  const paddingLeft = number(style.paddingLeft);
  const paddingRight = number(style.paddingRight);
  const paddingTop = number(style.paddingTop);
  const paddingBottom = number(style.paddingBottom);
  const contentLeft = box.left + paddingLeft;
  const contentRight = box.right - paddingRight;
  if (contentRight <= contentLeft) return null;

  const canvas = input.ownerDocument.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.font =
    style.font ||
    `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  const width = Math.min(
    Math.ceil(context.measureText(text).width) + 2,
    contentRight - contentLeft,
  );
  const align = style.textAlign;
  const fromRight =
    align === 'right' ||
    align === 'end' ||
    (align === 'start' && style.direction === 'rtl');
  const centered = align === 'center';
  const unclippedLeft = centered
    ? contentLeft + (contentRight - contentLeft - width) / 2
    : fromRight
      ? contentRight - width + input.scrollLeft
      : contentLeft - input.scrollLeft;
  const left = Math.max(contentLeft, unclippedLeft);
  const right = Math.min(contentRight, unclippedLeft + width);
  if (right <= left) return null;
  return {
    top: box.top + paddingTop,
    right,
    bottom: box.bottom - paddingBottom,
    left,
  };
}

/**
 * The vertical centre of the composer's control row — the band holding the
 * send / mic / model buttons — read from those buttons, not guessed from
 * geometry. Ground-truthed on chatgpt.com: the editable's own rect overlaps
 * the control row, so anchoring to the editable's bottom lands the disc ON the
 * send button (or, when the draft grows tall, in dead space below the box).
 * The buttons never lie about where the row is.
 */
export function controlRowCenter(
  field: Element,
  ignore: (el: Element) => boolean,
): number | null {
  field = visualEditorRoot(field);
  const container = composerShell(field, field.getBoundingClientRect());
  const shell = container.getBoundingClientRect();
  const centers: number[] = [];
  for (const b of visibleControlElements(container, field, ignore)) {
    const r = b.getBoundingClientRect();
    // The shell, not the editor, is the coordinate authority. An editor may be
    // larger than and clipped by this shell, so comparing against a fraction
    // of its height can incorrectly discard the real action row.
    if (
      r.width >= 16 &&
      r.height >= 16 &&
      r.width <= 120 &&
      r.height <= 120 &&
      r.top <= shell.bottom &&
      r.bottom >= shell.top &&
      r.left <= shell.right &&
      r.right >= shell.left
    ) {
      centers.push(r.top + r.height / 2);
    }
  }
  if (centers.length === 0) return null;
  centers.sort((a, b) => a - b);
  // Controls may exist in formatting and action rows. Cluster by vertical
  // centre and choose the lowest row associated with the composer.
  const rows: number[][] = [];
  for (const center of centers) {
    const row = rows.find(
      (candidate) =>
        Math.abs(
          candidate.reduce((a, b) => a + b, 0) / candidate.length - center,
        ) <= 12,
    );
    if (row) row.push(center);
    else rows.push([center]);
  }
  const lowest = rows.at(-1)!;
  lowest.sort((a, b) => a - b);
  return lowest[Math.floor(lowest.length / 2)]!;
}

const INTERACTIVE_SELECTOR =
  'button, a[href], input, select, textarea, summary, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [aria-haspopup], [contenteditable="true"], [tabindex]:not([tabindex="-1"])';

function interactiveOwner(el: Element): Element | null {
  const semantic = closestComposed(el, INTERACTIVE_SELECTOR);
  if (semantic) return semantic;

  // Custom controls sometimes expose no role/tabindex at all. Cursor intent
  // is inherited by their text/SVG descendants, so walking outward catches
  // those controls without a site-specific class name.
  let current: Element | null = el;
  while (current) {
    if (
      !current.matches('[contenteditable="true"]') &&
      globalThis.getComputedStyle(current).cursor === 'pointer'
    ) {
      return current;
    }
    current = composedParentElement(current);
  }
  return null;
}

function rectsIntersect(
  a: { top: number; left: number; right: number; bottom: number },
  b: { top: number; left: number; right: number; bottom: number },
  gap = 0,
): boolean {
  return (
    a.left - gap < b.right &&
    b.left - gap < a.right &&
    a.top - gap < b.bottom &&
    b.top - gap < a.bottom
  );
}

function pointRect(point: Point, size: number) {
  return {
    top: point.top,
    left: point.left,
    right: point.left + size,
    bottom: point.top + size,
  };
}

function visibleControlElements(
  shell: Element,
  field: Element,
  ignore: (el: Element) => boolean,
): Element[] {
  const controls = new Set<Element>();
  const candidates = queryComposedAll(
    shell,
    `${HOST_CONTROL_SELECTOR}, a[href], input, select, summary, [role="link"], [role="tab"], svg`,
  );
  for (const node of candidates) {
    const owner = interactiveOwner(node) ?? node;
    if (
      ignore(node) ||
      ignore(owner) ||
      owner === field ||
      composedContains(owner, field) ||
      composedContains(field, owner)
    ) {
      continue;
    }
    if (
      owner.matches('textarea, [contenteditable="true"]') &&
      !owner.matches('button, [role="button"]')
    ) {
      continue;
    }
    const rect = owner.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) controls.add(owner);
  }
  return [...controls];
}

function visibleControls(
  shell: Element,
  field: Element,
  ignore: (el: Element) => boolean,
): DOMRect[] {
  return visibleControlElements(shell, field, ignore).map((control) =>
    control.getBoundingClientRect(),
  );
}

function isPointInside(
  point: Point,
  size: number,
  rect: DOMRect,
  allowShortHeight = false,
): boolean {
  const horizontal = point.left >= rect.left && point.left + size <= rect.right;
  if (!horizontal) return false;
  if (allowShortHeight && rect.height < size) {
    return (
      point.top + size / 2 >= rect.top && point.top + size / 2 <= rect.bottom
    );
  }
  return point.top >= rect.top && point.top + size <= rect.bottom;
}

type DockSide = 'right' | 'left' | 'above' | 'below';

/** Which edge a complete target is immediately docked to, if any. */
function adjacentSide(
  point: Point,
  size: number,
  rect: DOMRect,
): DockSide | null {
  const candidate = pointRect(point, size);
  const verticalFit =
    rect.height < size
      ? candidate.top + size / 2 >= rect.top &&
        candidate.top + size / 2 <= rect.bottom
      : candidate.top >= rect.top && candidate.bottom <= rect.bottom;
  const horizontalFit =
    rect.width < size
      ? candidate.left + size / 2 >= rect.left &&
        candidate.left + size / 2 <= rect.right
      : candidate.left >= rect.left && candidate.right <= rect.right;

  const atRight =
    candidate.left >= rect.right &&
    candidate.left - rect.right <= OUTSIDE_GAP &&
    verticalFit;
  const atLeft =
    candidate.right <= rect.left &&
    rect.left - candidate.right <= OUTSIDE_GAP &&
    verticalFit;
  const above =
    candidate.bottom <= rect.top &&
    rect.top - candidate.bottom <= OUTSIDE_GAP &&
    horizontalFit;
  const below =
    candidate.top >= rect.bottom &&
    candidate.top - rect.bottom <= OUTSIDE_GAP &&
    horizontalFit;
  if (atRight) return 'right';
  if (atLeft) return 'left';
  if (above) return 'above';
  if (below) return 'below';
  return null;
}

/** A free manual pin may live anywhere, but never under newly arrived UI. */
function isPinnedPointSafe(
  field: Element,
  point: Point,
  size: number,
  ignore: (el: Element) => boolean,
  mode: ComposerPlacementMode,
): boolean {
  if (!fitsInViewport(point, size)) return false;
  const visual = visualEditorRoot(field);
  const shell = composerShell(visual, visual.getBoundingClientRect());
  const shellBox = shell.getBoundingClientRect();
  const candidate = pointRect(point, size);
  if (mode === 'external') {
    // External launchers never return to the action row. A stale pin
    // from an older build may point at Gemini's Pro picker or Flow's page
    // corner; accept only a complete target outside and near the live shell.
    if (rectsIntersect(candidate, shellBox)) return false;
    const gapX = Math.max(
      shellBox.left - candidate.right,
      candidate.left - shellBox.right,
      0,
    );
    const gapY = Math.max(
      shellBox.top - candidate.bottom,
      candidate.top - shellBox.bottom,
      0,
    );
    if (Math.hypot(gapX, gapY) > MAX_EXTERNAL_PIN_GAP) return false;
  }
  if (
    visibleControls(shell, visual, ignore).some((control) =>
      rectsIntersect(candidate, control, 3),
    )
  ) {
    return false;
  }

  // A deliberate drag may sit anywhere else, including over the editor or
  // elsewhere on the page. Generic hit-testing is intentionally not used
  // here: contenteditables and inherited pointer cursors produce false
  // positives that made apparently identical drops snap back unpredictably.
  return true;
}

/**
 * Validate a complete hit target at a proposed point. Exported so the tracker
 * can retain its prior slot until that slot genuinely becomes invalid.
 */
export function isPlacementSafe(
  field: Element,
  point: Point,
  size: number,
  ignore: (el: Element) => boolean,
): boolean {
  field = visualEditorRoot(field);
  if (!fitsInViewport(point, size)) return false;
  const fieldBox = field.getBoundingClientRect();
  const shell = composerShell(field, fieldBox);
  const shellBox = shell.getBoundingClientRect();
  const inside = isPointInside(point, size, shellBox, true);
  if (!inside && !adjacentSide(point, size, shellBox)) return false;

  const candidate = pointRect(point, size);
  if (
    visibleControls(shell, field, ignore).some((control) =>
      rectsIntersect(candidate, control, 3),
    )
  ) {
    return false;
  }

  // elementsFromPoint catches controls outside the selected shell and controls
  // whose clickable descendant is larger than its visible bounding box.
  const samples = [
    [point.left + 2, point.top + 2],
    [point.left + size - 2, point.top + 2],
    [point.left + size / 2, point.top + size / 2],
    [point.left + 2, point.top + size - 2],
    [point.left + size - 2, point.top + size - 2],
  ] as const;
  for (const [x, y] of samples) {
    for (const element of composedElementsFromPoint(x, y)) {
      if (
        ignore(element) ||
        element === field ||
        composedContains(field, element) ||
        // Angular/Material commonly puts delegated pointer handlers or a
        // tabindex on the composer host. That host is the editor's ownership
        // boundary, not a control occupying every empty pixel in the pill.
        // Treating an ancestor as a collision made Gemini appear during early
        // boot and disappear as soon as the hydrated host became interactive.
        composedContains(element, field)
      ) {
        continue;
      }
      const owner = interactiveOwner(element);
      if (
        owner &&
        !ignore(owner) &&
        owner !== field &&
        !composedContains(field, owner) &&
        !composedContains(owner, field)
      ) {
        return false;
      }
      if (isInteractive(element)) return false;
    }
  }

  return !inside || !overText(field, point, size);
}

export function placeButton(
  field: Element,
  direction: 'ltr' | 'rtl',
  size: number,
  preferred: ButtonCorner | null,
  ignore: (el: Element) => boolean,
  preferredPoint: Point | null = null,
  mode: ComposerPlacementMode = 'auto',
): PlacementResult {
  field = visualEditorRoot(field);
  const box = field.getBoundingClientRect();
  const anchor = composerShell(field, box);
  const anchorBox = anchor.getBoundingClientRect();
  const rect: Rect = {
    top: anchorBox.top,
    left: anchorBox.left,
    width: anchorBox.width,
    height: anchorBox.height,
  };

  const endIsRight = direction === 'ltr';
  const startIsRight =
    preferred === 'bottom-start'
      ? !endIsRight
      : preferred === 'bottom-end'
        ? endIsRight
        : endIsRight;

  // Anchor the disc's vertical line to the real control row when we can find
  // it. Only then fall back to the field's own bottom (a box shorter than the
  // disc has no row — the row IS the box; centre there or the maths lands
  // above the top edge).
  const rowCenter = controlRowCenter(field, ignore);
  const rowTop =
    rowCenter !== null
      ? rowCenter - size / 2
      : rect.height < size + EDGE_INSET * 2
        ? rect.top + (rect.height - size) / 2
        : rect.top + rect.height - EDGE_INSET - size;

  const slotAt = (step: number, fromRight: boolean): number =>
    fromRight
      ? rect.left + rect.width - EDGE_INSET - size - step * HIT_ZONE
      : rect.left + EDGE_INSET + step * HIT_ZONE;

  const candidates: {
    point: Point;
    slot: string;
    corner: ButtonCorner;
  }[] = [];
  const hasDraft =
    field instanceof HTMLTextAreaElement
      ? field.value.trim().length > 0
      : (field.textContent ?? '').trim().length > 0;
  const rows =
    !hasDraft && rect.height >= size * 2.5
      ? [
          { top: rect.top + EDGE_INSET, name: 'top' },
          { top: rowTop, name: 'row' },
        ]
      : [{ top: rowTop, name: 'row' }];
  for (const row of rows) {
    for (const fromRight of [startIsRight, !startIsRight]) {
      for (let step = 0; step < 8; step++) {
        const left = slotAt(step, fromRight);
        if (left < rect.left || left + size > rect.left + rect.width) break;
        candidates.push({
          point: { top: row.top, left },
          slot: `${row.name}-${fromRight ? 'right' : 'left'}-${String(step)}`,
          corner:
            row.name === 'top'
              ? fromRight === endIsRight
                ? 'top-end'
                : 'top-start'
              : fromRight === endIsRight
                ? 'bottom-end'
                : 'bottom-start',
        });
      }
    }
  }

  // A manual drag remains exact while its complete target is clear. If a host
  // later mounts a control over that coordinate (Gemini's delayed Pro picker),
  // reproject to the nearest safe slot instead of allowing the pin to bypass
  // collision safety. If the host control disappears, the saved coordinate
  // becomes valid again and is restored.
  if (
    preferredPoint &&
    isPinnedPointSafe(field, preferredPoint, size, ignore, mode)
  ) {
    const dock = adjacentSide(preferredPoint, size, anchorBox);
    const inside = isPointInside(preferredPoint, size, anchorBox, true);
    return {
      corner:
        preferredPoint.left + size / 2 >= rect.left + rect.width / 2
          ? endIsRight
            ? 'bottom-end'
            : 'bottom-start'
          : endIsRight
            ? 'bottom-start'
            : 'bottom-end',
      point: preferredPoint,
      anchor,
      slot: dock
        ? `pinned-outside-${dock}`
        : inside
          ? 'pinned-inside'
          : 'pinned-free',
      visible: true,
      forced: false,
    };
  }

  const safe =
    mode === 'external'
      ? []
      : candidates.filter((candidate) =>
          isPlacementSafe(field, candidate.point, size, ignore),
        );
  if (safe.length > 0) {
    const selected =
      preferredPoint === null
        ? safe[0]!
        : safe.toSorted(
            (a, b) =>
              Math.hypot(
                a.point.left - preferredPoint.left,
                a.point.top - preferredPoint.top,
              ) -
              Math.hypot(
                b.point.left - preferredPoint.left,
                b.point.top - preferredPoint.top,
              ),
          )[0]!;
    return {
      corner: selected.corner,
      point: selected.point,
      anchor,
      slot: selected.slot,
      visible: true,
      forced: false,
    };
  }

  // If the action band is genuinely full, dock immediately beside the shell.
  // This is composer-relative, unlike the former "below then clamp to the
  // viewport" fallback that could leave the icon stranded at the page edge.
  const verticalTop =
    anchorBox.height < size
      ? anchorBox.top + (anchorBox.height - size) / 2
      : Math.min(Math.max(anchorBox.top, rowTop), anchorBox.bottom - size);
  const sideOrder = endIsRight
    ? (['right', 'left'] as const)
    : (['left', 'right'] as const);
  const outsideCandidates: {
    point: Point;
    slot: string;
    corner: ButtonCorner;
  }[] = sideOrder.map((side) => ({
    point: {
      top: verticalTop,
      left:
        side === 'right'
          ? anchorBox.right + DOCK_GAP
          : anchorBox.left - DOCK_GAP - size,
    },
    slot: `outside-${side}`,
    corner: 'outside-end',
  }));

  for (const edge of ['below', 'above'] as const) {
    for (const fromRight of [startIsRight, !startIsRight]) {
      for (let step = 0; step < 8; step++) {
        const left = slotAt(step, fromRight);
        if (left < anchorBox.left || left + size > anchorBox.right) break;
        outsideCandidates.push({
          point: {
            top:
              edge === 'below'
                ? anchorBox.bottom + DOCK_GAP
                : anchorBox.top - DOCK_GAP - size,
            left,
          },
          slot: `outside-${edge}-${fromRight ? 'right' : 'left'}-${String(step)}`,
          corner: 'outside-below',
        });
      }
    }
  }

  const safeOutside = outsideCandidates.filter((candidate) =>
    isPlacementSafe(field, candidate.point, size, ignore),
  );
  if (safeOutside.length > 0) {
    const selected =
      preferredPoint === null
        ? safeOutside[0]!
        : safeOutside.toSorted(
            (a, b) =>
              Math.hypot(
                a.point.left - preferredPoint.left,
                a.point.top - preferredPoint.top,
              ) -
              Math.hypot(
                b.point.left - preferredPoint.left,
                b.point.top - preferredPoint.top,
              ),
          )[0]!;
    return {
      corner: selected.corner,
      point: selected.point,
      anchor,
      slot: selected.slot,
      visible: true,
      forced: false,
    };
  }

  if (mode === 'external') {
    // Google composer hosts sometimes make a page-sized delegated pointer
    // surface appear interactive to hit-testing after hydration. Exact host
    // controls still win, but that broad wrapper must not make the dedicated
    // outside launcher disappear. Choose the first viewport-fitting dock that
    // clears every concrete control rectangle.
    const controls = visibleControls(anchor, field, ignore);
    const fallback = outsideCandidates.find(
      (candidate) =>
        fitsInViewport(candidate.point, size) &&
        !controls.some((control) =>
          rectsIntersect(pointRect(candidate.point, size), control, 3),
        ),
    );
    if (fallback) {
      return {
        corner: fallback.corner,
        point: fallback.point,
        anchor,
        slot: fallback.slot,
        visible: true,
        forced: true,
      };
    }
  }

  // No safe complete target exists. Hiding is the only non-destructive
  // answer; a periodic geometry check will restore it when space appears.
  return {
    corner: startIsRight === endIsRight ? 'bottom-end' : 'bottom-start',
    point: {
      top: Math.min(
        Math.max(0, rowTop),
        Math.max(0, globalThis.innerHeight - size),
      ),
      left: Math.min(
        Math.max(0, slotAt(0, startIsRight)),
        Math.max(0, globalThis.innerWidth - size),
      ),
    },
    anchor,
    slot: 'hidden',
    visible: false,
    forced: true,
  };
}

/** UX-SPEC §0.6: an orphaned button floating over unrelated content is worse than none. */
export function isFieldVisible(field: Element): boolean {
  field = visualEditorRoot(field);
  const rect = field.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return false;
  return (
    rect.bottom > 0 &&
    rect.top < globalThis.innerHeight &&
    rect.right > 0 &&
    rect.left < globalThis.innerWidth
  );
}
