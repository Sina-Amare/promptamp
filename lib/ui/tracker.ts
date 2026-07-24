import {
  classifyEditor,
  deepActiveElement,
  qualifies,
  readValue,
  resolveDirection,
  visualEditorRoot,
} from '../insertion/detect';
import { isEnhanceable } from '../enhance/assemble';
import type { ButtonCorner } from '../storage/schemas';
import {
  closestComposed,
  composedContains,
  composedParentElement,
  queryComposedAll,
} from '../dom/composed';
import {
  composerShell,
  isFieldVisible,
  isPlacementSafe,
  placeButton,
} from './position';
import type { ComposerPlacementMode } from './compatibility';

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
    /** True during scroll/drag-style motion; disables discrete easing. */
    instant?: boolean,
    /** False only when no collision-free complete hit target exists. */
    visible?: boolean,
    /** Stable slot identity, also used for placement-aware button styling. */
    slot?: string,
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
  /**
   * The exact per-site spot the user dragged the disc to (offset from the
   * field's bottom-right). Outranks every placement rule when set.
   */
  pinnedOffset: () => { dx: number; dy: number } | null;
  /** True while the user is dragging; observers must not fight their pointer. */
  isPlacementLocked?: () => boolean;
  /** Dedicated presentation for hosts whose action row hydrates in stages. */
  placementMode?: () => ComposerPlacementMode;
  /** Bounded compatibility reacquisition when final hydration loses focus. */
  fallbackField?: () => HTMLElement | null;
  /** Checked before any injection — a broken off switch is unforgivable. */
  isSuppressed: () => boolean;
}

/** Restores full opacity this long after the last keystroke (UX-SPEC §1.1). */
const TYPING_IDLE_MS = 1000;

/** Safety net for layout changes no event reports. Deliberately 1 Hz, not rAF. */
const POLL_MS = 1000;

/** How long after the last scroll event the glide stops and the ladder re-runs. */
const SCROLL_SETTLE_MS = 120;

/** Bounded recovery window for multi-stage framework hydration. */
const REPLACEMENT_GRACE_MS = 15_000;

/** Fast enough to be visually atomic, slow enough not to churn during boot. */
const REPLACEMENT_RETRY_MS = 100;

export function createFieldTracker(
  callbacks: TrackerCallbacks,
  options: TrackerOptions,
): {
  start: () => void;
  stop: () => void;
  reposition: () => void;
  current: () => HTMLElement | null;
} {
  let started = false;
  let field: HTMLElement | null = null;
  let direction: 'ltr' | 'rtl' = 'ltr';
  let typingTimer: ReturnType<typeof setTimeout> | undefined;
  let emitTimer: ReturnType<typeof setTimeout> | undefined;
  let safetyTimer: ReturnType<typeof setInterval> | undefined;
  let scrollTargets: EventTarget[] = [];
  let fieldResize: ResizeObserver | null = null;
  let fieldMutation: MutationObserver | null = null;
  let mutationRoot: Element | null = null;
  let mutationRaf = 0;
  let replacementTimer: ReturnType<typeof setTimeout> | undefined;
  let replacementDeadline = 0;
  let replacementRecords: MutationRecord[] = [];
  let anchor: Element | null = null;
  let fieldKind: ReturnType<typeof classifyEditor> = 'unknown';
  let fieldTag = '';
  let replacementRect: RectSnapshot | null = null;
  // The corner chosen for the current field. Preferred on every reposition, so
  // a scroll cannot hop the disc between rungs as viewport geometry shifts —
  // it moves only when its corner genuinely stops fitting.
  let lastCorner: ReturnType<typeof placeButton>['corner'] | null = null;
  let lastVisible = false;
  let lastSlot = 'hidden';
  // The disc's exact offset from the composer SHELL's bottom-left at the last
  // full placement. The editable itself may scroll or be much taller than the
  // clipped composer; tying movement to it is what pulled the icon into text.
  let lastOffset: { dx: number; dy: number } | null = null;
  // The scroll glide: a rAF loop alive only while scroll events stream in.
  let scrollRaf = 0;
  let scrollSettle: ReturnType<typeof setTimeout> | undefined;

  /**
   * Reconstruct a user-dragged pin relative to the composer shell. `placeButton`
   * accepts it when safe and otherwise reprojects it to the nearest valid
   * composer slot after resize, zoom, reload, or a host layout change.
   */
  function pinnedPoint(): { top: number; left: number } | null {
    if (!field) return null;
    const pin = options.pinnedOffset();
    if (!pin) return null;
    const size = options.buttonSize;
    const visualField = visualEditorRoot(field);
    const box = composerShell(
      visualField,
      visualField.getBoundingClientRect(),
    ).getBoundingClientRect();
    return {
      top: Math.min(
        Math.max(0, box.bottom + pin.dy),
        Math.max(0, globalThis.innerHeight - size),
      ),
      left: Math.min(
        Math.max(0, box.right + pin.dx),
        Math.max(0, globalThis.innerWidth - size),
      ),
    };
  }

  function rememberPlacement(placement: ReturnType<typeof placeButton>): void {
    const box = placement.anchor.getBoundingClientRect();
    lastCorner = placement.corner;
    lastVisible = placement.visible;
    lastSlot = placement.slot;
    lastOffset = {
      dx: placement.point.left - box.left,
      dy: placement.point.top - box.bottom,
    };
    replacementRect = snapshotRect(box);
    observeGeometry(placement.anchor);
  }

  function observeGeometry(nextAnchor: Element): void {
    if (!field || (anchor === nextAnchor && fieldResize)) return;
    anchor = nextAnchor;
    fieldResize?.disconnect();
    fieldResize = new ResizeObserver(() => {
      reposition();
    });
    fieldResize.observe(field);
    if (nextAnchor !== field) fieldResize.observe(nextAnchor);

    fieldMutation?.disconnect();
    fieldMutation = new MutationObserver((records) => {
      const trackedField = field;
      if (!trackedField?.isConnected) {
        recoverReplacedField(records);
        return;
      }
      if (
        !records.some((record) =>
          mutationAffectsPlacement(record, trackedField),
        )
      ) {
        return;
      }
      if (mutationRaf !== 0) return;
      mutationRaf = requestAnimationFrame(() => {
        mutationRaf = 0;
        reposition();
      });
    });
    mutationRoot = composedParentElement(nextAnchor) ?? nextAnchor;
    const mutationOptions: MutationObserverInit = {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        'class',
        'style',
        'hidden',
        'aria-hidden',
        'role',
        'tabindex',
        'disabled',
      ],
    };
    fieldMutation.observe(mutationRoot, mutationOptions);

    // MutationObserver does not cross shadow boundaries. Observe every open
    // root between the editor and its visual shell in addition to the stable
    // light-DOM parent that can report replacement of the custom element.
    const observedShadowRoots = new Set<ShadowRoot>();
    let current: Element | null = field;
    while (current) {
      const root = current.getRootNode();
      if (root instanceof ShadowRoot && !observedShadowRoots.has(root)) {
        observedShadowRoots.add(root);
        fieldMutation.observe(root, mutationOptions);
      }
      if (current === nextAnchor) break;
      current = composedParentElement(current);
    }
  }

  function reposition(): void {
    if (!field) return;

    // React apps replace composer nodes wholesale during hydration. Search the
    // same composed composer for its successor instead of permanently losing
    // the affordance when focus is not restored.
    if (!field.isConnected) {
      recoverReplacedField([]);
      return;
    }

    if (!isFieldVisible(field)) {
      // An orphaned button floating over unrelated content is worse than no
      // button at all.
      detach();
      return;
    }
    if (options.isPlacementLocked?.()) return;

    const pinned = pinnedPoint();
    if (!pinned && lastVisible && lastCorner && lastOffset) {
      const box = (
        anchor ??
        composerShell(
          visualEditorRoot(field),
          visualEditorRoot(field).getBoundingClientRect(),
        )
      ).getBoundingClientRect();
      const previous = {
        top: box.bottom + lastOffset.dy,
        left: box.left + lastOffset.dx,
      };
      if (
        isPlacementSafe(field, previous, options.buttonSize, options.isOwnNode)
      ) {
        callbacks.onMove(previous, lastCorner, false, true, lastSlot);
        return;
      }
    }

    const placement = placeButton(
      field,
      direction,
      options.buttonSize,
      lastCorner ?? options.preferredCorner(),
      options.isOwnNode,
      pinned,
      options.placementMode?.() ?? 'auto',
    );
    rememberPlacement(placement);
    callbacks.onMove(
      placement.point,
      placement.corner,
      false,
      placement.visible,
      placement.slot,
    );
  }

  function attach(candidate: HTMLElement): void {
    if (field === candidate) return;

    // Switching composers must release the old observer/listener/timer set
    // before its handles are overwritten. Keep the visual handoff atomic:
    // onAttach replaces the old button in the same turn, so no detach flash.
    releaseField(false);
    field = candidate;
    direction = resolveDirection(candidate);
    fieldKind = classifyEditor(candidate);
    fieldTag = candidate.tagName;
    lastCorner = null; // a fresh field earns a fresh walk

    const pinned = pinnedPoint();
    const placement = placeButton(
      candidate,
      direction,
      options.buttonSize,
      options.preferredCorner(),
      options.isOwnNode,
      pinned,
      options.placementMode?.() ?? 'auto',
    );
    rememberPlacement(placement);

    callbacks.onAttach({
      element: candidate,
      direction,
      corner: placement.corner,
    });
    callbacks.onMove(
      placement.point,
      placement.corner,
      false,
      placement.visible,
      placement.slot,
    );
    emitDraft();

    // Only the ancestors that actually scroll — attaching to every ancestor
    // would fire this handler constantly on deep DOMs.
    scrollTargets = scrollableAncestors(candidate);
    for (const target of scrollTargets) {
      target.addEventListener('scroll', onScroll, { passive: true });
    }
  }

  function releaseField(notify: boolean): void {
    if (!field) return;
    for (const target of scrollTargets) {
      target.removeEventListener('scroll', onScroll);
    }
    scrollTargets = [];
    fieldResize?.disconnect();
    fieldResize = null;
    fieldMutation?.disconnect();
    fieldMutation = null;
    mutationRoot = null;
    anchor = null;
    fieldKind = 'unknown';
    fieldTag = '';
    replacementRect = null;
    clearReplacementSearch();
    lastCorner = null;
    lastVisible = false;
    lastSlot = 'hidden';
    lastOffset = null;
    if (mutationRaf !== 0) {
      cancelAnimationFrame(mutationRaf);
      mutationRaf = 0;
    }
    if (scrollRaf !== 0) {
      cancelAnimationFrame(scrollRaf);
      scrollRaf = 0;
    }
    clearTimeout(scrollSettle);
    clearTimeout(typingTimer);
    clearTimeout(emitTimer);
    field = null;
    if (notify) callbacks.onDetach();
  }

  function detach(): void {
    releaseField(true);
  }

  /**
   * Adopt a replacement editor even when a framework creates the light-DOM
   * host and its shadow-root editor in separate tasks.
   *
   * The previous one-frame retry lost Gemini after slow hydration. A bounded
   * composed-tree search survives delayed Angular boot without retaining
   * observers indefinitely when a composer is genuinely removed.
   */
  function recoverReplacedField(records: MutationRecord[]): void {
    const trackedField = field;
    if (!trackedField || trackedField.isConnected) return;
    replacementRecords.push(...records);
    if (replacementDeadline === 0) {
      replacementDeadline = Date.now() + REPLACEMENT_GRACE_MS;
    }
    clearTimeout(replacementTimer);

    const active = deepActiveElement(document);
    const replacement = qualifies(active)
      ? active
      : (findReplacementField(
          replacementRecords,
          mutationRoot,
          trackedField,
          fieldKind,
          fieldTag,
          replacementRect,
        ) ??
        options.fallbackField?.() ??
        null);
    replacementRecords = [];
    if (replacement) {
      attach(replacement);
      return;
    }
    if (Date.now() >= replacementDeadline) {
      detach();
      return;
    }
    replacementTimer = setTimeout(
      () => recoverReplacedField([]),
      REPLACEMENT_RETRY_MS,
    );
  }

  function clearReplacementSearch(): void {
    clearTimeout(replacementTimer);
    replacementTimer = undefined;
    replacementDeadline = 0;
    replacementRecords = [];
  }

  function emitDraft(): void {
    if (!field) return;
    const draft = readValue(field);
    callbacks.onDraftChange(draft, isEnhanceable(draft));
  }

  /* ── listeners ─────────────────────────────────────────────────── */

  /**
   * Resolve the editable that actually owns focus, not merely the event's
   * retargeted element.
   *
   * Web components can retarget focus to their custom-element host, and rich
   * editors often dispatch from a nested paragraph/span rather than the
   * contenteditable root. Search upward first, then through the seed's open
   * shadow subtree. Never scan the whole document here: on an unfocused Google
   * SPA that would turn a one-hertz safety check into thousands of DOM reads.
   */
  function editableFromSeed(seed: Element | null): HTMLElement | null {
    if (!seed) return null;
    if (qualifies(seed)) return seed;

    const owner = closestComposed<HTMLElement>(seed, EDITABLE_SELECTOR);
    if (owner && qualifies(owner)) return owner;

    if (
      seed === document.body ||
      seed === document.documentElement ||
      !seed.isConnected
    ) {
      return null;
    }
    for (const candidate of queryComposedAll<HTMLElement>(
      seed,
      EDITABLE_SELECTOR,
    )) {
      if (qualifies(candidate)) return candidate;
    }
    return null;
  }

  function focusedEditable(event?: Event): HTMLElement | null {
    const path = event?.composedPath() ?? [];
    for (const node of path) {
      if (!(node instanceof Element)) continue;
      const candidate = editableFromSeed(node);
      if (candidate) return candidate;
    }

    const active = editableFromSeed(deepActiveElement(document));
    if (active) return active;

    const selectionNode = document.getSelection()?.focusNode ?? null;
    const selectionElement =
      selectionNode instanceof Element
        ? selectionNode
        : (selectionNode?.parentElement ?? null);
    return editableFromSeed(selectionElement);
  }

  /**
   * One tracker-owned timer covers both jobs:
   *
   * - while attached, validate geometry and refresh draft state;
   * - while unattached, acquire an editor that became eligible after focus.
   *
   * The second branch is essential for staged hydration. Gemini and Flow can
   * focus a zero-sized/short-lived editor and only give it its final geometry
   * later, without dispatching another focus event. Starting the old poll only
   * after attach made that state impossible to recover from.
   */
  function safetyTick(): void {
    if (!started || options.isSuppressed()) return;
    const fallback = options.fallbackField?.() ?? null;
    if (fallback && fallback !== field) {
      attach(fallback);
      return;
    }
    if (field) {
      reposition();
      emitDraft();
      return;
    }
    const candidate = focusedEditable() ?? fallback;
    if (candidate) attach(candidate);
  }

  function eventComesFromOwnSurface(event: Event): boolean {
    return event
      .composedPath()
      .some((node) => node instanceof Element && options.isOwnNode(node));
  }

  function onFocusIn(event: Event): void {
    if (options.isSuppressed() || eventComesFromOwnSurface(event)) return;
    // Focus on another qualifying composer switches the disc there. Focus on
    // anything else changes nothing — the disc is a fixture of its composer.
    const candidate = focusedEditable(event);
    if (candidate) attach(candidate);
  }

  // Some editors take focus programmatically or swap their node under a live
  // focus, so focusin alone misses them. A press on a qualifying element is an
  // unambiguous signal — attach right there, no waiting.
  function onPointerDown(event: Event): void {
    if (options.isSuppressed() || eventComesFromOwnSurface(event)) return;
    const candidate = focusedEditable(event);
    if (candidate && candidate !== field) attach(candidate);
  }

  function onFocusOut(): void {
    // Deliberately nothing. The disc is a fixture of the composer, NOT of
    // focus: clicking DevTools, a scrollbar, or page chrome used to detach it
    // — which read as "the icon randomly disappears on long drafts" in live
    // testing (the user compared two screenshots of the same page, one with
    // the disc and one without; the difference was only where focus sat).
    // The disc now leaves only when its field leaves the DOM or its viewport
    // (reposition/poll handle that), or when another composer takes focus.
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (!eventBelongsToField(event, field)) return;
    // Forward Tab only. Shift+Tab must keep doing what the page expects, and
    // the panel handles its own focus wrap once it is open.
    if (event.key !== 'Tab' || event.shiftKey || event.defaultPrevented) return;
    if (callbacks.onFieldTab()) event.preventDefault();
  }

  function onInput(event: Event): void {
    // Contains, not equals: rich editors (ProseMirror, Lexical) fire input on
    // inner nodes, and a paste that targeted one never matched — so pasted
    // text didn't enable the button until the user typed a character.
    if (!eventBelongsToField(event, field)) return;
    emitDraft();
    // Rich editors (ProseMirror) apply a paste AFTER the input event fires, so
    // a single synchronous read sees the old value. Read again shortly after.
    clearTimeout(emitTimer);
    emitTimer = setTimeout(emitDraft, 150);

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
    if (
      !field ||
      !lastVisible ||
      !lastCorner ||
      !lastOffset ||
      !anchor ||
      !field.isConnected ||
      options.isPlacementLocked?.()
    ) {
      return;
    }
    const box = anchor.getBoundingClientRect();
    // The exact placed offset, re-applied — never re-derived — so the disc is
    // pixel-glued to its slot while the field moves.
    callbacks.onMove(
      { top: box.bottom + lastOffset.dy, left: box.left + lastOffset.dx },
      lastCorner,
      true,
      true,
      lastSlot,
    );
    scrollRaf = requestAnimationFrame(glide);
  }

  function onScroll(): void {
    if (!field || options.isPlacementLocked?.()) return;
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
      if (started) return;
      started = true;
      document.addEventListener('focusin', onFocusIn, true);
      document.addEventListener('pointerdown', onPointerDown, true);
      document.addEventListener('focusout', onFocusOut, true);
      document.addEventListener('input', onInput, true);
      document.addEventListener('keydown', onKeyDown, true);
      globalThis.addEventListener('resize', onResize, { passive: true });
      globalThis.addEventListener('scroll', onScroll, { passive: true });

      // A field may already be focused when we load (bfcache, late injection).
      if (!options.isSuppressed()) {
        const active = focusedEditable() ?? options.fallbackField?.() ?? null;
        if (active) attach(active);
      }
      safetyTimer = setInterval(safetyTick, POLL_MS);
    },
    stop: () => {
      if (!started) return;
      started = false;
      document.removeEventListener('focusin', onFocusIn, true);
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('focusout', onFocusOut, true);
      document.removeEventListener('input', onInput, true);
      document.removeEventListener('keydown', onKeyDown, true);
      globalThis.removeEventListener('resize', onResize);
      globalThis.removeEventListener('scroll', onScroll);
      detach();
      clearInterval(safetyTimer);
      safetyTimer = undefined;
    },
    reposition,
    current: () => field,
  };
}

/** Ancestors that can actually scroll — anything else cannot move the field. */
function scrollableAncestors(el: Element): EventTarget[] {
  const targets: EventTarget[] = [];
  let current = composedParentElement(el);
  while (current && current !== document.body) {
    const style = globalThis.getComputedStyle(current);
    if (/(auto|scroll|overlay)/.test(style.overflowY + style.overflowX)) {
      targets.push(current);
    }
    current = composedParentElement(current);
  }
  return targets;
}

const PLACEMENT_CONTROL_SELECTOR =
  'button, [role="button"], [role="menuitem"], [aria-haspopup]';
const EDITABLE_SELECTOR =
  'textarea, input, [contenteditable]:not([contenteditable="false"])';

interface RectSnapshot {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
}

function snapshotRect(rect: DOMRect): RectSnapshot {
  return {
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    left: rect.left,
    width: rect.width,
    height: rect.height,
  };
}

/**
 * Framework hydration often removes the focused editor and inserts an
 * equivalent node without restoring DOM focus. Adopt the nearest qualifying
 * replacement from the same mutation before detaching, so the button never
 * flashes or disappears. This is deliberately capability-based rather than a
 * Gemini selector; React/Lexical/ProseMirror composers all do the same thing.
 */
function findReplacementField(
  records: MutationRecord[],
  root: Element | null,
  previous: HTMLElement | null,
  previousKind: ReturnType<typeof classifyEditor>,
  previousTag: string,
  previousRect: RectSnapshot | null,
): HTMLElement | null {
  const added = new Set<HTMLElement>();
  const collect = (node: Node): void => {
    if (!(node instanceof Element)) return;
    if (node.matches(EDITABLE_SELECTOR) && qualifies(node)) added.add(node);
    for (const candidate of queryComposedAll(node, EDITABLE_SELECTOR)) {
      if (qualifies(candidate)) added.add(candidate);
    }
  };
  for (const record of records) {
    for (const node of record.addedNodes) collect(node);
  }

  // Some frameworks mutate an ancestor in a separate observer record. Search
  // the small composer parent we already observe only when the added nodes did
  // not contain an eligible editor.
  if (added.size === 0 && root?.isConnected) {
    collect(root);
  }

  let best: { field: HTMLElement; score: number } | null = null;
  for (const candidate of added) {
    if (candidate === previous || !candidate.isConnected) continue;
    const visual = visualEditorRoot(candidate);
    const candidateRect = snapshotRect(
      composerShell(
        visual,
        visual.getBoundingClientRect(),
      ).getBoundingClientRect(),
    );

    let score = 0;
    if (previousRect) {
      const gapX = Math.max(
        previousRect.left - candidateRect.right,
        candidateRect.left - previousRect.right,
        0,
      );
      const gapY = Math.max(
        previousRect.top - candidateRect.bottom,
        candidateRect.top - previousRect.bottom,
        0,
      );
      const edgeGap = Math.hypot(gapX, gapY);
      const maximumGap = Math.max(240, previousRect.width / 2);
      if (edgeGap > maximumGap) continue;
      const previousCenterX = previousRect.left + previousRect.width / 2;
      const previousCenterY = previousRect.top + previousRect.height / 2;
      const candidateCenterX = candidateRect.left + candidateRect.width / 2;
      const candidateCenterY = candidateRect.top + candidateRect.height / 2;
      score +=
        edgeGap * 1_000 +
        Math.hypot(
          candidateCenterX - previousCenterX,
          candidateCenterY - previousCenterY,
        );
    }
    if (classifyEditor(candidate) !== previousKind) score += 100_000;
    if (candidate.tagName !== previousTag) score += 25_000;
    if (!best || score < best.score) best = { field: candidate, score };
  }
  return best?.field ?? null;
}

/**
 * Ignore ordinary rich-editor text mutations, but react to controls or shell
 * structure arriving after focus. Gemini adds its Pro picker this way; without
 * this handoff it paints directly over PromptAmp's already-selected slot.
 */
function mutationAffectsPlacement(
  record: MutationRecord,
  field: HTMLElement,
): boolean {
  const target = record.target instanceof Element ? record.target : null;
  if (record.type === 'attributes') {
    return target !== null && !composedContains(field, target);
  }

  const containsControl = (node: Node): boolean =>
    node instanceof Element &&
    (node.matches(PLACEMENT_CONTROL_SELECTOR) ||
      queryComposedAll(node, PLACEMENT_CONTROL_SELECTOR).length > 0);

  if ([...record.addedNodes, ...record.removedNodes].some(containsControl)) {
    return true;
  }

  // Structural changes outside the editable can alter clipping, row layout,
  // or the composer shell. Inside the editable they are ordinary typing.
  return target !== null && !composedContains(field, target);
}

function eventBelongsToField(event: Event, field: HTMLElement | null): boolean {
  if (!field) return false;
  if (event.composedPath().includes(field)) return true;
  const target = event.target;
  return target instanceof Element && composedContains(field, target);
}
