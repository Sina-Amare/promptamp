import { svg } from '../host';

/**
 * The "hone" mark — a whetstone stroke with a chevron tip: something being
 * sharpened, not something being conjured.
 *
 * Explicitly **not a sparkle**. Sparkle affordances have organised
 * disable-me demand behind them (Figma's forum, Notion's), and a sparkle says
 * "AI happened here" where this says "your draft got sharper", which is the
 * actual promise. It is also a logo-class mark, so it is never mirrored in RTL.
 */
export function honeIcon(): SVGElement {
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
      // The stone: a long tapered stroke.
      svg('path', {
        d: 'M4.5 17.5 L14 8',
        stroke: 'currentColor',
        'stroke-width': '2.1',
        'stroke-linecap': 'round',
      }),
      // The honed edge, catching the light.
      svg('path', {
        d: 'M13 4.5 L19.5 11 L15.5 15 L9 8.5 Z',
        stroke: 'currentColor',
        'stroke-width': '2.1',
        'stroke-linejoin': 'round',
        'stroke-linecap': 'round',
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
