import {
  isEditable,
  isLocked,
  qualifies,
  visualEditorRoot,
} from '../insertion/detect';
import {
  closestComposed,
  composedParentElement,
  queryComposedAll,
} from '../dom/composed';
import { isFieldVisible } from './position';

export type ComposerPlacementMode = 'auto' | 'external';

const EDITABLE_SELECTOR =
  'textarea, input, [contenteditable]:not([contenteditable="false"])';
const PROMPT_WORDS =
  /\b(ask|chat|compose|create|describe|gemini|message|prompt|send|type|write)\b/i;

/**
 * Gemini and Flow hydrate their composer in multiple stages and do not always
 * restore focus to the final editor. They need document-level reacquisition;
 * other sites remain on the cheaper focus-led tracker.
 */
export function needsCompatibilityReacquisition(
  hostname: string,
  pathname: string,
): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (host === 'gemini.google.com') return true;
  if (
    (host === 'labs.google' || host === 'labs.google.com') &&
    /^\/fx\/tools\/flow(?:\/|$)/i.test(pathname)
  ) {
    return true;
  }
  return false;
}

/**
 * Find the live prompt editor after a Google SPA has replaced the element that
 * originally held focus.
 *
 * This is intentionally limited to the two compatibility origins above. The
 * normal cross-site tracker remains focus-led, while this bounded composed-DOM
 * scan lets Gemini/Flow recover when final hydration does not restore focus.
 */
export function findCompatibilityComposer(
  root: Document,
  ignore: (element: Element) => boolean = () => false,
): HTMLElement | null {
  let best: { element: HTMLElement; score: number } | null = null;

  for (const candidate of queryComposedAll<HTMLElement>(
    root,
    EDITABLE_SELECTOR,
  )) {
    if (ignore(candidate) || !isCompatibilityCandidate(candidate)) continue;
    const score = compatibilityScore(candidate);
    if (!best || score > best.score) best = { element: candidate, score };
  }

  return best?.element ?? null;
}

function isCompatibilityCandidate(element: HTMLElement): boolean {
  if (
    !isEditable(element) ||
    isLocked(element) ||
    // Gemini explicitly opts out of Grammarly on its final Quill node. That
    // attribute belongs to another extension and must not suppress PromptAmp;
    // only our own host opt-out remains authoritative here.
    closestComposed(element, '[data-promptamp="false"]') !== null ||
    !element.isConnected
  ) {
    return false;
  }

  const visual = visualEditorRoot(element);
  const rect = visual.getBoundingClientRect();
  // Gemini has shipped a 16–24px editor line inside an 80px visual pill. Keep
  // this relaxed gate local to the compatibility origins; global detection
  // remains strict enough to exclude ordinary form fields.
  if (
    !qualifies(element) &&
    (rect.width < 240 || rect.height < 12 || rect.height > 600)
  ) {
    return false;
  }
  if (!isFieldVisible(visual)) return false;

  let current: Element | null = visual;
  for (let hops = 0; current && hops < 12; hops++) {
    const style = globalThis.getComputedStyle(current);
    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      Number.parseFloat(style.opacity || '1') === 0 ||
      current.hasAttribute('hidden') ||
      current.getAttribute('aria-hidden') === 'true'
    ) {
      return false;
    }
    current = composedParentElement(current);
  }
  return true;
}

function compatibilityScore(element: HTMLElement): number {
  const visual = visualEditorRoot(element);
  const rect = visual.getBoundingClientRect();
  const hint = accessibleHint(element);
  let score = rect.bottom * 2 + Math.min(rect.width, 1_200);

  // Prompt composers are typically wide and live in the lower half of the
  // workspace. This separates Flow's bottom composer from its top search box.
  if (rect.width >= globalThis.innerWidth * 0.3) score += 500;
  if (rect.bottom >= globalThis.innerHeight * 0.45) score += 750;
  if (element.matches('textarea, [contenteditable]')) score += 500;
  if (element.getAttribute('role') === 'textbox') score += 500;
  if (element.getAttribute('aria-multiline') === 'true') score += 300;
  if (PROMPT_WORDS.test(hint)) score += 3_000;
  if (closestComposed(element, 'header, nav, [role="search"]')) score -= 4_000;

  return score;
}

function accessibleHint(element: HTMLElement): string {
  const labelledBy = element.getAttribute('aria-labelledby') ?? '';
  const labels = labelledBy
    .split(/\s+/)
    .filter(Boolean)
    .map((id) => element.ownerDocument.getElementById(id)?.textContent ?? '')
    .join(' ');
  const value =
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement
      ? `${element.placeholder} ${element.name}`
      : '';
  return [
    element.getAttribute('aria-label') ?? '',
    element.getAttribute('data-placeholder') ?? '',
    value,
    labels,
  ].join(' ');
}
