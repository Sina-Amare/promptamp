import { getLocale } from '../i18n';
import { TOKENS_CSS } from './tokens';
import { type Theme, watchTheme } from './theme';

/**
 * The single shadow host every injected surface lives in.
 *
 * **Open, not closed.** Bitwarden uses a closed root for tamper-resistance,
 * and we deliberately trade some of that away: ARIA IDREF relationships
 * (`aria-labelledby`, `aria-controls`) do not resolve across a shadow
 * boundary, and element reflection cannot reach into a closed one. Every ARIA
 * relationship in the panel has to live in one ID scope, so accessibility wins
 * and the tamper-resistance is bought back other ways — a randomised element
 * name regenerated each init, and an observer that reverts page tampering.
 */

export interface ShadowHost {
  element: HTMLElement;
  root: ShadowRoot;
  setTheme: (theme: Theme) => void;
  destroy: () => void;
}

/**
 * A fresh name per init. A site cannot write a stylesheet or a
 * `querySelector`-and-remove loop against a selector it cannot predict, and a
 * fixed name would be trivially targetable across every install.
 */
function randomTagName(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const suffix = Array.from(bytes, (b) => b.toString(36))
    .join('')
    .slice(0, 10);
  // Custom element names must contain a hyphen and start with a letter.
  return `pa-${suffix}`;
}

/** Removed this many times in this window ⇒ the site is fighting us. */
const HOSTILE_REMOVAL_LIMIT = 3;
const HOSTILE_WINDOW_MS = 10_000;

export interface CreateHostOptions {
  /** Element whose background decides the theme. */
  themeAnchor: Element;
  /** Called when the site has removed the host too often to keep re-attaching. */
  onHostile?: () => void;
}

export function createShadowHost(options: CreateHostOptions): ShadowHost {
  const tag = randomTagName();
  // No custom element registration: we only need a hyphenated unknown tag,
  // and defining one would leave a permanent, enumerable trace in the registry.
  const element = document.createElement(tag);
  element.setAttribute('data-promptamp-host', '');

  // Language, for screen readers and hyphenation. Direction is deliberately
  // *not* set here: the positioning layer inside is a physical coordinate
  // frame, and flipping it moves every surface a viewport-width off-screen.
  // Each surface declares its own `dir` instead.
  element.setAttribute('lang', getLocale());

  // The host itself is layout-neutral; every surface inside positions itself.
  element.style.setProperty('all', 'initial');
  element.style.setProperty('position', 'absolute');
  element.style.setProperty('top', '0');
  element.style.setProperty('left', '0');
  element.style.setProperty('width', '0');
  element.style.setProperty('height', '0');

  const root = element.attachShadow({ mode: 'open' });

  const sheet = new CSSStyleSheet();
  sheet.replaceSync(TOKENS_CSS);
  root.adoptedStyleSheets = [sheet];

  document.body.append(element);

  const removals: number[] = [];
  let destroyed = false;

  /**
   * Re-attach if the page deletes us, and revert attribute tampering. Some
   * sites run "remove anything unexpected from body" sweeps that would
   * otherwise silently kill the button.
   */
  const guard = new MutationObserver(() => {
    if (destroyed) return;

    if (!element.isConnected) {
      const now = Date.now();
      removals.push(now);
      while (removals.length > 0 && now - removals[0]! > HOSTILE_WINDOW_MS) {
        removals.shift();
      }

      if (removals.length >= HOSTILE_REMOVAL_LIMIT) {
        // Re-attaching in a loop against a site that keeps removing us burns
        // CPU and accomplishes nothing. Concede the site.
        destroyed = true;
        guard.disconnect();
        options.onHostile?.();
        return;
      }

      document.body.append(element);
    }
  });
  guard.observe(document.body, { childList: true });

  const stopTheme = watchTheme(options.themeAnchor, (theme) => {
    element.setAttribute('data-theme', theme);
  });

  return {
    element,
    root,
    setTheme: (theme) => {
      element.setAttribute('data-theme', theme);
    },
    destroy: () => {
      destroyed = true;
      guard.disconnect();
      stopTheme();
      element.remove();
    },
  };
}

/**
 * Element construction helper.
 *
 * Every injected node goes through here, which is what makes the
 * Trusted-Types guarantee structural rather than a rule people remember:
 * there is no string-HTML parameter to misuse. Google and other sites enforce
 * Trusted Types, and a single `innerHTML` there throws and takes the whole UI
 * down.
 */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: {
    class?: string;
    text?: string;
    attrs?: Record<string, string>;
    style?: Partial<CSSStyleDeclaration>;
    children?: (Node | null | undefined)[];
  } = {},
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.class) node.className = props.class;
  if (props.text !== undefined) node.textContent = props.text;
  for (const [key, value] of Object.entries(props.attrs ?? {})) {
    node.setAttribute(key, value);
  }
  Object.assign(node.style, props.style ?? {});
  for (const child of props.children ?? []) {
    if (child) node.append(child);
  }
  return node;
}

/** Namespaced SVG builder — `createElement` produces an inert HTML element. */
export function svg(
  tag: string,
  attrs: Record<string, string> = {},
  children: Node[] = [],
): SVGElement {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attrs)) {
    node.setAttribute(key, value);
  }
  for (const child of children) node.append(child);
  return node;
}
