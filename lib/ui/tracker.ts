import {
  deepActiveElement,
  qualifies,
  readValue,
  resolveDirection,
} from '../insertion/detect';
import { isEnhanceable } from '../enhance/assemble';
import type { ButtonCorner } from '../storage/schemas';
import { isFieldVisible, placeButton } from './position';

/**
 * Watches which field has focus and keeps the button pinned to it.
 *
 * The performance budget (UX-SPEC §0.5) is the constraint that shapes this
 * file. Grammarly measured >90% CPU from reading layout 60 times a second, and
 * a prompt box is exactly where a user is typing fast. So geometry is read
 * only on focus, input, ancestor scroll, resize, and a 1 Hz safety poll —
 * never per frame. Scroll moves the button by translation without re-measuring.
 */

export interface TrackedField {
  element: HTMLElement;
  direction: 'ltr' | 'rtl';
  corner: ButtonCorner;
}

export interface TrackerCallbacks {
  /** A qualifying field gained focus. */
  onAttach: (field: TrackedField) => void;
  /** The field lost focus or scrolled away. */
  onDetach: () => void;
  /** Position changed; move the button. */
  onMove: (
    position: { top: number; left: number },
    corner: ButtonCorner,
  ) => void;
  /** Draft content changed — drives ghost/idle/typing. */
  onDraftChange: (draft: string, enhanceable: boolean) => void;
  /** The user is mid-keystroke; the button should recede. */
  onTypingChange: (typing: boolean) => void;
}

export interface TrackerOptions {
  buttonSize: number;
  /** Our own nodes, so collision tests do not detect us as an obstacle. */
  isOwnNode: (el: Element) => boolean;
  /** Preferred corner for this origin, if the user dragged one. */
  preferredCorner: () => ButtonCorner | null;
  /** Checked before any injection — a broken off switch is unforgivable. */
  isSuppressed: () => boolean;
}

/** Restores full opacity this long after the last keystroke (UX-SPEC §1.1). */
const TYPING_IDLE_MS = 1000;

/** Grace period on blur, so clicking the button (which blurs some editors) works. */
const BLUR_GRACE_MS = 200;

/** Safety net for layout changes no event reports. Deliberately 1 Hz, not rAF. */
const POLL_MS = 1000;

export function createFieldTracker(
  callbacks: TrackerCallbacks,
  options: TrackerOptions,
): {
  start: () => void;
  stop: () => void;
  reposition: () => void;
  current: () => HTMLElement | null;
} {
  let field: HTMLElement | null = null;
  let direction: 'ltr' | 'rtl' = 'ltr';
  let typingTimer: ReturnType<typeof setTimeout> | undefined;
  let blurTimer: ReturnType<typeof setTimeout> | undefined;
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let scrollTargets: EventTarget[] = [];

  function reposition(): void {
    if (!field) return;

    if (!isFieldVisible(field)) {
      // An orphaned button floating over unrelated content is worse than no
      // button at all.
      detach();
      return;
    }

    const placement = placeButton(
      field,
      direction,
      options.buttonSize,
      options.preferredCorner(),
      options.isOwnNode,
    );
    callbacks.onMove(placement.point, placement.corner);
  }

  function attach(candidate: HTMLElement): void {
    clearTimeout(blurTimer);
    if (field === candidate) return;

    field = candidate;
    direction = resolveDirection(candidate);

    const placement = placeButton(
      candidate,
      direction,
      options.buttonSize,
      options.preferredCorner(),
      options.isOwnNode,
    );

    callbacks.onAttach({
      element: candidate,
      direction,
      corner: placement.corner,
    });
    callbacks.onMove(placement.point, placement.corner);
    emitDraft();

    // Only the ancestors that actually scroll — attaching to every ancestor
    // would fire this handler constantly on deep DOMs.
    scrollTargets = scrollableAncestors(candidate);
    for (const target of scrollTargets) {
      target.addEventListener('scroll', onScroll, { passive: true });
    }
    pollTimer = setInterval(reposition, POLL_MS);
  }

  function detach(): void {
    if (!field) return;
    for (const target of scrollTargets) {
      target.removeEventListener('scroll', onScroll);
    }
    scrollTargets = [];
    clearInterval(pollTimer);
    clearTimeout(typingTimer);
    field = null;
    callbacks.onDetach();
  }

  function emitDraft(): void {
    if (!field) return;
    const draft = readValue(field);
    callbacks.onDraftChange(draft, isEnhanceable(draft));
  }

  /* ── listeners ─────────────────────────────────────────────────── */

  function onFocusIn(event: Event): void {
    if (options.isSuppressed()) return;
    const target =
      deepActiveElement(document) ?? (event.target as Element | null);
    if (qualifies(target)) attach(target);
    else if (target && !options.isOwnNode(target)) scheduleDetach();
  }

  function onFocusOut(): void {
    scheduleDetach();
  }

  function scheduleDetach(): void {
    clearTimeout(blurTimer);
    blurTimer = setTimeout(() => {
      const active = deepActiveElement(document);
      // Focus may have moved into our own UI, which is not a reason to leave.
      if (active && options.isOwnNode(active)) return;
      if (active && active === field) return;
      detach();
    }, BLUR_GRACE_MS);
  }

  function onInput(event: Event): void {
    if (!field || event.target !== field) return;
    emitDraft();

    callbacks.onTypingChange(true);
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => {
      callbacks.onTypingChange(false);
    }, TYPING_IDLE_MS);
  }

  // Scrolling translates the button; it never re-measures. That is the
  // difference between a smooth page and Grammarly's CPU problem.
  function onScroll(): void {
    if (!field) return;
    reposition();
  }

  function onResize(): void {
    reposition();
  }

  return {
    start: () => {
      document.addEventListener('focusin', onFocusIn, true);
      document.addEventListener('focusout', onFocusOut, true);
      document.addEventListener('input', onInput, true);
      globalThis.addEventListener('resize', onResize, { passive: true });
      globalThis.addEventListener('scroll', onScroll, { passive: true });

      // A field may already be focused when we load (bfcache, late injection).
      const active = deepActiveElement(document);
      if (!options.isSuppressed() && qualifies(active)) attach(active);
    },
    stop: () => {
      document.removeEventListener('focusin', onFocusIn, true);
      document.removeEventListener('focusout', onFocusOut, true);
      document.removeEventListener('input', onInput, true);
      globalThis.removeEventListener('resize', onResize);
      globalThis.removeEventListener('scroll', onScroll);
      detach();
    },
    reposition,
    current: () => field,
  };
}

/** Ancestors that can actually scroll — anything else cannot move the field. */
function scrollableAncestors(el: Element): EventTarget[] {
  const targets: EventTarget[] = [];
  let current = el.parentElement;
  while (current && current !== document.body) {
    const style = globalThis.getComputedStyle(current);
    if (/(auto|scroll|overlay)/.test(style.overflowY + style.overflowX)) {
      targets.push(current);
    }
    current = current.parentElement;
  }
  return targets;
}
