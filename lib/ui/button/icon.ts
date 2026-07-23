import { svg } from '../host';

/**
 * The prompt mark — lines of prompt text with a live caret and an AI spark. A
 * monochrome version of the store/logo mark (`assets/icon.svg`), so the
 * floating button, the toolbar icon and the brand read as one system.
 *
 * Single-colour on `currentColor` because it sits on the solid disc and has to
 * recolour with the button's state (white on indigo idle, danger on error,
 * dark on the amber done flash) — the logo keeps the amber accent, the button
 * inherits it. A logo-class mark, so it is never mirrored in RTL.
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
      // Three lines of prompt text.
      svg('path', {
        d: 'M5 9 H12 M5 12 H16 M5 15 H11',
        stroke: 'currentColor',
        'stroke-width': '1.8',
        'stroke-linecap': 'round',
      }),
      // The live text caret.
      svg('path', {
        d: 'M14.6 7.4 V11',
        stroke: 'currentColor',
        'stroke-width': '1.7',
        'stroke-linecap': 'round',
      }),
      // The AI spark.
      svg('path', {
        d: 'M18.5 5.3 C18.714 6.286 19.214 6.786 20.2 7 C19.214 7.214 18.714 7.714 18.5 8.7 C18.286 7.714 17.786 7.214 16.8 7 C17.786 6.786 18.286 6.286 18.5 5.3 Z',
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
