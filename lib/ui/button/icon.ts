import { svg } from '../host';

/**
 * The enhance mark — a large AI sparkle with a smaller companion, the widely
 * understood "improve this with AI" glyph. A monochrome version of the
 * store/logo mark (`assets/icon.svg`), so the floating button, the toolbar icon
 * and the brand read as one system.
 *
 * Single-colour on `currentColor` because it sits on the solid disc and has to
 * recolour with the button's state (white on teal idle, danger on error, dark
 * on the amber done flash). A logo-class mark, so it is never mirrored in RTL.
 */
export function promptMark(): SVGElement {
  return svg(
    'svg',
    {
      viewBox: '0 0 24 24',
      fill: 'none',
      'aria-hidden': 'true',
      focusable: 'false',
      width: '15',
      height: '15',
    },
    [
      // The primary four-point sparkle (arms pinch to the centre).
      svg('path', {
        d: 'M10.5 5 Q10.5 12.5 18 12.5 Q10.5 12.5 10.5 20 Q10.5 12.5 3 12.5 Q10.5 12.5 10.5 5 Z',
        fill: 'currentColor',
      }),
      // The smaller companion sparkle, upper-right.
      svg('path', {
        d: 'M18.8 2.6 Q18.8 5.5 21.7 5.5 Q18.8 5.5 18.8 8.4 Q18.8 5.5 15.9 5.5 Q18.8 5.5 18.8 2.6 Z',
        fill: 'currentColor',
      }),
    ],
  );
}

/** Confirmation micro-state after an accepted replacement. Never mirrored. */
export function checkIcon(): SVGElement {
  return svg(
    'svg',
    {
      viewBox: '0 0 24 24',
      fill: 'none',
      'aria-hidden': 'true',
      focusable: 'false',
      width: '15',
      height: '15',
    },
    [
      svg('path', {
        d: 'M5 12.5 L10 17.5 L19 7',
        stroke: 'currentColor',
        'stroke-width': '2.4',
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
      }),
    ],
  );
}

/**
 * Loading. The arc rotates via CSS; under reduced motion the stylesheet swaps
 * it for the static three-dot glyph below, because a two-stop opacity pulse is
 * still motion and the spec allows no partial compliance.
 */
export function loadingArc(): SVGElement {
  return svg(
    'svg',
    {
      viewBox: '0 0 24 24',
      fill: 'none',
      'aria-hidden': 'true',
      focusable: 'false',
      width: '15',
      height: '15',
      class: 'pa-arc',
    },
    [
      svg('path', {
        // 270° of a circle — the open quarter is what reads as rotation.
        d: 'M12 3 a9 9 0 1 1 -6.36 2.64',
        stroke: 'currentColor',
        'stroke-width': '2.2',
        'stroke-linecap': 'round',
      }),
    ],
  );
}

/** Reduced-motion stand-in for the arc: state change without movement. */
export function restingDots(): SVGElement {
  return svg(
    'svg',
    {
      viewBox: '0 0 24 24',
      fill: 'currentColor',
      'aria-hidden': 'true',
      focusable: 'false',
      width: '15',
      height: '15',
    },
    [
      svg('circle', { cx: '5', cy: '12', r: '1.8' }),
      svg('circle', { cx: '12', cy: '12', r: '1.8' }),
      svg('circle', { cx: '19', cy: '12', r: '1.8' }),
    ],
  );
}

/** Error state. Paired with a border colour change, never colour alone. */
export function alertIcon(): SVGElement {
  return svg(
    'svg',
    {
      viewBox: '0 0 24 24',
      fill: 'none',
      'aria-hidden': 'true',
      focusable: 'false',
      width: '15',
      height: '15',
    },
    [
      svg('path', {
        d: 'M12 7 v6',
        stroke: 'currentColor',
        'stroke-width': '2.4',
        'stroke-linecap': 'round',
      }),
      svg('circle', { cx: '12', cy: '17', r: '1.35', fill: 'currentColor' }),
    ],
  );
}

/** The dismissal affordance. 12px glyph inside a =24px target. */
export function closeIcon(): SVGElement {
  return svg(
    'svg',
    {
      viewBox: '0 0 12 12',
      fill: 'none',
      'aria-hidden': 'true',
      focusable: 'false',
      width: '9',
      height: '9',
    },
    [
      svg('path', {
        d: 'M3 3 L9 9 M9 3 L3 9',
        stroke: 'currentColor',
        'stroke-width': '1.8',
        'stroke-linecap': 'round',
      }),
    ],
  );
}
