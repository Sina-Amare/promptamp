/**
 * Which theme to render against.
 *
 * `prefers-color-scheme` is deliberately *not* the primary signal. It reports
 * the user's OS preference, which frequently disagrees with the page: a dark-
 * mode user on a site that only ships a light theme would get a dark button on
 * a white composer, with the icon failing contrast against the surface it
 * actually sits on.
 *
 * So the page is measured instead: walk up from the field for the first
 * non-transparent background colour (transparent resolves up the chain — the
 * SiteLint approach), classify by relative luminance, and fall back to the OS
 * preference only when the page says nothing useful.
 */

export type Theme = 'light' | 'dark';

/** WCAG relative luminance. Used for the classification threshold. */
export function relativeLuminance(r: number, g: number, b: number): number {
  const channel = (value: number): number => {
    const c = value / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/**
 * Parses the `rgb()` / `rgba()` form `getComputedStyle` always returns. Modern
 * Chrome also emits `color(srgb …)` for wide-gamut values, which is handled
 * separately rather than being silently misread as opaque black.
 */
export function parseColor(value: string): Rgba | null {
  const rgb =
    /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,/\s]+([\d.%]+))?\s*\)/i.exec(
      value,
    );
  if (rgb) {
    const alphaRaw = rgb[4];
    const alpha = alphaRaw
      ? alphaRaw.endsWith('%')
        ? Number.parseFloat(alphaRaw) / 100
        : Number.parseFloat(alphaRaw)
      : 1;
    return {
      r: Number.parseFloat(rgb[1] ?? '0'),
      g: Number.parseFloat(rgb[2] ?? '0'),
      b: Number.parseFloat(rgb[3] ?? '0'),
      a: Number.isFinite(alpha) ? alpha : 1,
    };
  }

  const srgb =
    /color\(\s*srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\s*\)/i.exec(
      value,
    );
  if (srgb) {
    return {
      r: Number.parseFloat(srgb[1] ?? '0') * 255,
      g: Number.parseFloat(srgb[2] ?? '0') * 255,
      b: Number.parseFloat(srgb[3] ?? '0') * 255,
      a: srgb[4] ? Number.parseFloat(srgb[4]) : 1,
    };
  }

  return null;
}

/**
 * Anything below this reads as "dark surface". 0.5 sits at the perceptual
 * midpoint of the luminance curve, so mid-greys land on the side a person
 * would call them.
 */
const DARK_THRESHOLD = 0.5;

/** How far up to walk before giving up. Deep DOMs are common; infinite ones are not. */
const MAX_ANCESTOR_WALK = 30;

/**
 * The first ancestor background that is actually painted. A `transparent` or
 * zero-alpha background is not a colour — it means "whatever is behind me" —
 * so the walk continues rather than treating it as black.
 */
export function effectiveBackground(el: Element): Rgba | null {
  let current: Element | null = el;
  let steps = 0;

  while (current && steps++ < MAX_ANCESTOR_WALK) {
    const color = parseColor(
      globalThis.getComputedStyle(current).backgroundColor,
    );
    // Semi-transparent layers over an unknown backdrop are not decidable, so
    // only treat a mostly-opaque colour as the answer.
    if (color && color.a > 0.5) return color;
    current = current.parentElement;
  }
  return null;
}

export function detectTheme(el: Element): Theme {
  const background = effectiveBackground(el);
  if (background) {
    return relativeLuminance(background.r, background.g, background.b) <
      DARK_THRESHOLD
      ? 'dark'
      : 'light';
  }
  // The page told us nothing — now the OS preference is the best guess.
  return globalThis.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

/**
 * In-page theme toggles (ChatGPT, Reddit) swap a class or attribute on
 * `<html>` or `<body>` rather than reloading, so a one-shot read goes stale
 * the moment the user flips the switch. Watching only those two elements'
 * attributes keeps this far cheaper than a subtree observer.
 */
export function watchTheme(
  el: Element,
  onChange: (theme: Theme) => void,
): () => void {
  let current = detectTheme(el);
  onChange(current);

  const resample = (): void => {
    const next = detectTheme(el);
    if (next !== current) {
      current = next;
      onChange(next);
    }
  };

  const observer = new MutationObserver(resample);
  for (const target of [document.documentElement, document.body]) {
    if (target) {
      observer.observe(target, {
        attributes: true,
        attributeFilter: ['class', 'style', 'data-theme', 'data-color-mode'],
      });
    }
  }

  const media = globalThis.matchMedia('(prefers-color-scheme: dark)');
  media.addEventListener('change', resample);

  return () => {
    observer.disconnect();
    media.removeEventListener('change', resample);
  };
}
