import { svg } from '../host';

const stroke = {
  stroke: 'currentColor',
  'stroke-width': '2',
  'stroke-linecap': 'round',
  'stroke-linejoin': 'round',
  fill: 'none',
};

function icon(size: number, ...paths: SVGElement[]): SVGElement {
  return svg(
    'svg',
    {
      viewBox: '0 0 24 24',
      width: String(size),
      height: String(size),
      'aria-hidden': 'true',
      focusable: 'false',
    },
    paths,
  );
}

/** Carousel back. A directional glyph — mirrored in RTL chrome by CSS. */
export function chevronStart(): SVGElement {
  return icon(14, svg('path', { d: 'M15 5 L8 12 L15 19', ...stroke }));
}

export function chevronEnd(): SVGElement {
  return icon(14, svg('path', { d: 'M9 5 L16 12 L9 19', ...stroke }));
}

export function chevronDown(): SVGElement {
  return icon(11, svg('path', { d: 'M6 9 L12 15 L18 9', ...stroke }));
}

export function closeIcon(): SVGElement {
  return icon(14, svg('path', { d: 'M6 6 L18 18 M18 6 L6 18', ...stroke }));
}

export function copyIcon(): SVGElement {
  return icon(
    14,
    svg('rect', {
      x: '9',
      y: '9',
      width: '11',
      height: '11',
      rx: '2',
      ...stroke,
    }),
    svg('path', { d: 'M5 15 V6 a1 1 0 0 1 1-1 h9', ...stroke }),
  );
}

/** Output-language chip. A plain globe — meridian + equator. */
export function globeIcon(): SVGElement {
  return icon(
    12,
    svg('circle', { cx: '12', cy: '12', r: '9', ...stroke }),
    svg('path', { d: 'M3 12 h18', ...stroke }),
    svg('ellipse', { cx: '12', cy: '12', rx: '4', ry: '9', ...stroke }),
  );
}

/** Transient confirmation on the Copy button. */
export function checkIcon(): SVGElement {
  return icon(14, svg('path', { d: 'M5 12.5 L10 17.5 L19 7', ...stroke }));
}

export function alertIcon(): SVGElement {
  return icon(
    15,
    svg('circle', { cx: '12', cy: '12', r: '9', ...stroke }),
    svg('path', { d: 'M12 7.5 v5', ...stroke }),
    svg('circle', { cx: '12', cy: '16.5', r: '1.2', fill: 'currentColor' }),
  );
}
