import {
  deepActiveElement,
  qualifies,
  readValue,
  resolveDirection,
} from '../insertion/detect';
import { isEnhanceable } from '../enhance/assemble';
import type { ButtonCorner } from '../storage/schemas';
import { cornerPosition, isFieldVisible, placeButton } from './position';

/**
 * Watches which field has focus and keeps the button pinned to it.
 *
 * The performance budget (UX-SPEC §0.5) is the constraint that shapes this
 * file. Grammarly measured >90% CPU from reading layout 60 times a second, and
 * a prompt box is exactly where a user is typing fast. So the *expensive* work
 * — the placement ladder with its elementsFromPoint sampling — runs only on
 * focus, input, resize, settle, and a 1 Hz safety poll. During active
 * scrolling the disc glides: one getBoundingClientRect and pure corner math
 * per frame, keeping it glued to the field with zero lag, and the full
 * re-evaluation waits until the scroll settles.
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
  /**
   * Tab was pressed in the field. Return true to claim focus for the button.
   *
   * The host element lives at the end of `<body>`, so DOM order would put the
   * button somewhere arbitrary — usually after the entire page. UX-SPEC §6
   * requires it immediately after the field, and intercepting Tab achieves
   * that without inserting our node into the page's own layout.
   */
  onFieldTab: () => boolean;
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

/** How long after the last scroll event the glide stops and the ladder re-runs. */
const SCROLL_SETTLE_MS = 120;

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
  let fieldResize: ResizeObserver | null = null;
  // The corner chosen for the current field. Preferred on every reposition, so
  // a scroll cannot hop the disc between rungs as viewport geometry shifts —
  // it moves only when its corner genuinely stops fitting.
  let lastCorner: ReturnType<typeof placeButton>['corner'] | null = null;
  // The scroll glide: a rAF loop alive only while scroll events stream in.
  let scrollRaf = 0;
  let scrollSettle: ReturnType<typeof setTimeout> | undefined;

  function reposition(): void {
    if (!field) return;

    // React apps replace composer nodes wholesale on re-render; a tracked node
    // that left the DOM would keep a ghost button. Detach — the next focus or
    // pointer press re-attaches to the replacement.
    if (!field.isConnected) {
      detach();
      return;
    }

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
      lastCorner ?? options.preferredCorner(),
      options.isOwnNode,
    );
    lastCorner = placement.corner;
    callbacks.onMove(placement.point, placement.corner);
  }

  function attach(candidate: HTMLElement): void {
    clearTimeout(blurTimer);
    if (field === candidate) return;

    field = candidate;
    direction = resolveDirection(candidate);
    lastCorner = null; // a fresh field earns a fresh ladder walk

    const placement = placeButton(
      candidate,
      direction,
      options.buttonSize,
      options.preferredCorner(),
      options.isOwnNode,
    );
    lastCorner = placement.corner;

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
    // Chat composers grow as the draft wraps — with no scroll event fired, so
    // without this the disc sits at the field's *old* corner until the poll.
    fieldResize = new ResizeObserver(() => {
      reposition();
    });
    fieldResize.observe(candidate);
    pollTimer = setInterval(reposition, POLL_MS);
  }

  function detach(): void {
    if (!field) return;
    for (const target of scrollTargets) {
      target.removeEventListener('scroll', onScroll);
    }
    scrollTargets = [];
    fieldResize?.disconnect();
    fieldResize = null;
    lastCorner = null;
    if (scrollRaf !== 0) {
      cancelAnimationFrame(scrollRaf);
      scrollRaf = 0;
    }
    clearTimeout(scrollSettle);
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

  // Some editors take focus programmatically or swap their node under a live
  // focus, so focusin alone misses them. A press on a qualifying element is an
  // unambiguous signal — attach right there, no waiting.
  function onPointerDown(event: Event): void {
    if (options.isSuppressed()) return;
    const target = event.target as Element | null;
    const candidate = target?.closest('textarea, input, [contenteditable]');
    if (candidate && candidate !== field && qualifies(candidate)) {
      attach(candidate);
    }
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

  function onKeyDown(event: KeyboardEvent): void {
    if (!field || event.target !== field) return;
    // Forward Tab only. Shift+Tab must keep doing what the page expects, and
    // the panel handles its own focus wrap once it is open.
    if (event.key !== 'Tab' || event.shiftKey || event.defaultPrevented) return;
    if (callbacks.onFieldTab()) event.preventDefault();
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

  /**
   * The per-frame glide, alive only while scroll events are streaming. Pure
   * translation to the already-chosen corner — no ladder, no
   * elementsFromPoint — so it is cheap enough to run every frame, and the
   * disc can neither lag behind the composer nor hop to another corner
   * mid-scroll.
   */
  function glide(): void {
    scrollRaf = 0;
    if (!field || !lastCorner || !field.isConnected) return;
    const box = field.getBoundingClientRect();
    const point = cornerPosition(
      { top: box.top, left: box.left, width: box.width, height: box.height },
      lastCorner,
      direction,
      options.buttonSize,
    );
    callbacks.onMove(point, lastCorner);
    scrollRaf = requestAnimationFrame(glide);
  }

  function onScroll(): void {
    if (!field) return;
    if (scrollRaf === 0) scrollRaf = requestAnimationFrame(glide);
    clearTimeout(scrollSettle);
    scrollSettle = setTimeout(() => {
      if (scrollRaf !== 0) {
        cancelAnimationFrame(scrollRaf);
        scrollRaf = 0;
      }
      // One full re-evaluation (visibility, ladder, occupancy) at rest.
      reposition();
    }, SCROLL_SETTLE_MS);
  }

  function onResize(): void {
    reposition();
  }

  return {
    start: () => {
      document.addEventListener('focusin', onFocusIn, true);
      document.addEventListener('pointerdown', onPointerDown, true);
      document.addEventListener('focusout', onFocusOut, true);
      document.addEventListener('input', onInput, true);
      document.addEventListener('keydown', onKeyDown, true);
      globalThis.addEventListener('resize', onResize, { passive: true });
      globalThis.addEventListener('scroll', onScroll, { passive: true });

      // A field may already be focused when we load (bfcache, late injection).
      const active = deepActiveElement(document);
      if (!options.isSuppressed() && qualifies(active)) attach(active);
    },
    stop: () => {
      document.removeEventListener('focusin', onFocusIn, true);
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('focusout', onFocusOut, true);
      document.removeEventListener('input', onInput, true);
      document.removeEventListener('keydown', onKeyDown, true);
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
