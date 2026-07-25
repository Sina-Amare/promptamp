import { type MessageKey, t } from '../../i18n';
import { el } from '../host';
import { CATEGORY_COLORS } from '../tokens';
import {
  alertIcon,
  checkIcon,
  closeIcon,
  loadingArc,
  promptMark,
  restingDots,
} from './icon';

/**
 * The floating button — and the loading indicator, and the Stop control.
 *
 * It is deliberately all three. A separate spinner overlay is more chrome on a
 * page that is not ours, and the button is already exactly where the user is
 * looking. So the icon *is* the status machine (UX-SPEC §1.3).
 */

export type ButtonState =
  | 'ghost' // draft too short — present, disabled, teaching
  | 'idle'
  | 'typing'
  | 'loading'
  | 'done'
  | 'error';

export type DismissChoice = 'session' | 'site' | 'everywhere';

export interface ButtonCallbacks {
  onActivate: () => void;
  onStop: () => void;
  onDismiss: (choice: DismissChoice) => void;
  /** Remove this site's manual pin and return to automatic placement. */
  onResetPosition?: () => void;
  /** Read live state so a pin created after mount immediately gains a reset. */
  canResetPosition?: () => boolean;
  /**
   * The user dragged the control and released it at these viewport coordinates
   * (the wrap's top-left). Valid exterior positions near the composer persist;
   * unsafe drops reproject to its nearest clear edge.
   */
  onDragEnd?: (point: { top: number; left: number }) => void;
  /** Suspend automatic layout tracking once movement becomes a real drag. */
  onDragStart?: () => void;
  /** Resume automatic tracking when capture is cancelled before a drop. */
  onDragCancel?: () => void;
}

export interface ButtonHandle {
  wrap: HTMLElement;
  focus: () => void;
  setState: (state: ButtonState) => void;
  setProfile: (name: string, category: string) => void;
  setPlacement: (slot: string) => void;
  setInstant: (instant: boolean) => void;
  getState: () => ButtonState;
  destroy: () => void;
}

const LABELS: Record<ButtonState, MessageKey> = {
  ghost: 'button.tooShort',
  idle: 'button.idle',
  typing: 'button.idle',
  loading: 'button.loading',
  done: 'button.done',
  error: 'button.error',
};

const prefersReducedMotion = (): boolean =>
  globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function createButton(callbacks: ButtonCallbacks): ButtonHandle {
  let state: ButtonState = 'ghost';
  let profileName = '';
  let doneTimer: ReturnType<typeof setTimeout> | undefined;

  const iconSlot = el('span', { class: 'pa-icon' });
  iconSlot.append(promptMark());

  const dot = el('span', { class: 'pa-dot' });

  const button = el('button', {
    class: 'pa-button',
    attrs: {
      type: 'button',
      'aria-label': t(LABELS.ghost),
      'aria-haspopup': 'dialog',
      'aria-keyshortcuts': 'Alt+E',
      'aria-expanded': 'false',
      // aria-disabled, not disabled: a disabled button leaves the tab order
      // and takes its tooltip — the ghost state is meant to be discoverable.
      'aria-disabled': 'true',
    },
    children: [iconSlot, dot],
  });

  const tooltip = el('span', {
    class: 'pa-tooltip',
    attrs: { role: 'tooltip', id: 'pa-tip' },
    text: t('button.tooShort'),
  });

  const dismiss = el('button', {
    class: 'pa-dismiss',
    attrs: {
      type: 'button',
      'aria-label': t('button.dismiss'),
      'aria-haspopup': 'menu',
    },
    children: [closeIcon()],
  });

  const wrap = el('div', {
    class: 'pa-button-wrap',
    attrs: {
      'data-state': 'ghost',
      'data-entering': 'true',
      'data-placement': 'inside',
    },
    children: [button, dismiss, tooltip],
  });

  /* ── drag to place ─────────────────────────────────────────────── */

  // A press that moves less than the threshold is a click; past it, the click
  // is swallowed so a drop never fires an enhance. The tracker validates the
  // released point against the composer before it becomes persistent.
  const DRAG_THRESHOLD = 5;
  let suppressClick = false;
  let suppressClickTimer: ReturnType<typeof setTimeout> | undefined;
  let cancelActiveDrag: (() => void) | null = null;

  wrap.addEventListener('pointerdown', (event) => {
    // A prior drop's click-swallow guard is stale once a new press begins — its
    // click has already fired or never will. Clearing it here stops a
    // main-thread stall from carrying the guard into this gesture and eating a
    // real click, on the disc or a dismiss-menu item.
    suppressClick = false;
    clearTimeout(suppressClickTimer);
    if (event.button !== 0) return;
    if ((event.target as Element).closest('.pa-dismiss, .pa-menu, .pa-callout'))
      return;
    cancelActiveDrag?.();
    const startX = event.clientX;
    const startY = event.clientY;
    const startRect = wrap.getBoundingClientRect();
    const pointerId = event.pointerId;
    let dragging = false;
    let finished = false;

    const onMove = (ev: PointerEvent): void => {
      if (ev.pointerId !== pointerId || finished) return;
      if (
        !dragging &&
        Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD
      ) {
        return;
      }
      if (!dragging) {
        dragging = true;
        callbacks.onDragStart?.();
        try {
          // Capture only after this has become a drag. Capturing the initial
          // press on the wrapper retargets pointerup away from the inner
          // button in Chromium, which prevents an ordinary click from firing.
          wrap.setPointerCapture(pointerId);
        } catch {
          // Window-level listeners below still guarantee cleanup.
        }
        wrap.setAttribute('data-dragging', 'true');
      }
      const left = Math.min(
        Math.max(0, startRect.left + ev.clientX - startX),
        globalThis.innerWidth - startRect.width,
      );
      const top = Math.min(
        Math.max(0, startRect.top + ev.clientY - startY),
        globalThis.innerHeight - startRect.height,
      );
      wrap.style.transform = `translate3d(${String(Math.round(left))}px, ${String(Math.round(top))}px, 0)`;
    };

    const cleanup = (): void => {
      if (finished) return;
      finished = true;
      globalThis.removeEventListener('pointermove', onMove, true);
      globalThis.removeEventListener('pointerup', onUp, true);
      globalThis.removeEventListener('pointercancel', onCancel, true);
      wrap.removeEventListener('lostpointercapture', onLostCapture);
      wrap.removeAttribute('data-dragging');
      if (wrap.hasPointerCapture(pointerId)) {
        try {
          wrap.releasePointerCapture(pointerId);
        } catch {
          // The browser may already have released it during cancellation.
        }
      }
      if (cancelActiveDrag === cleanup) cancelActiveDrag = null;
    };

    const finish = (commit: boolean): void => {
      if (finished) return;
      if (commit && dragging) {
        // Swallow only the synthetic click belonging to this drop. The timer
        // clears the guard before a later intentional click.
        suppressClick = true;
        clearTimeout(suppressClickTimer);
        suppressClickTimer = setTimeout(() => {
          suppressClick = false;
        }, 0);
        const rect = wrap.getBoundingClientRect();
        callbacks.onDragEnd?.({ top: rect.top, left: rect.left });
      } else if (dragging) {
        callbacks.onDragCancel?.();
      }
      cleanup();
    };

    function onUp(ev: PointerEvent): void {
      if (ev.pointerId !== pointerId) return;
      finish(true);
    }
    function onCancel(ev: PointerEvent): void {
      if (ev.pointerId !== pointerId) return;
      finish(false);
    }
    function onLostCapture(ev: PointerEvent): void {
      if (ev.pointerId !== pointerId) return;
      finish(false);
    }

    cancelActiveDrag = cleanup;
    // Window capture listeners see the release even if a non-drag press ends
    // outside the target, so no stale pointer state survives to the next click.
    globalThis.addEventListener('pointermove', onMove, true);
    globalThis.addEventListener('pointerup', onUp, true);
    globalThis.addEventListener('pointercancel', onCancel, true);
    wrap.addEventListener('lostpointercapture', onLostCapture);
  });

  wrap.addEventListener(
    'click',
    (event) => {
      if (suppressClick) {
        suppressClick = false;
        clearTimeout(suppressClickTimer);
        event.stopPropagation();
        event.preventDefault();
      }
    },
    { capture: true },
  );

  /* ── state machine ─────────────────────────────────────────────── */

  function render(): void {
    wrap.setAttribute('data-state', state);
    button.setAttribute('aria-label', t(LABELS[state]));
    button.setAttribute('aria-disabled', state === 'ghost' ? 'true' : 'false');
    // aria-busy tells a screen reader the control is working; it is cleared in
    // every exit path, because forgetting to reset it silences the region for
    // the rest of the session.
    button.setAttribute('aria-busy', state === 'loading' ? 'true' : 'false');

    iconSlot.replaceChildren(iconFor(state));
    tooltip.textContent = tooltipText();
  }

  function iconFor(next: ButtonState): SVGElement {
    switch (next) {
      case 'loading':
        return prefersReducedMotion() ? restingDots() : loadingArc();
      case 'done':
        return checkIcon();
      case 'error':
        return alertIcon();
      case 'ghost':
      case 'idle':
      case 'typing':
        return promptMark();
    }
  }

  function tooltipText(): string {
    if (state === 'ghost') return t('button.tooShort');
    if (state === 'loading') return t('button.loading');
    if (state === 'error') return t('button.error');

    return t('button.tip', {
      profile: profileName ? t('button.tipProfile', { name: profileName }) : '',
    });
  }

  function setState(next: ButtonState): void {
    if (next === state) return;
    clearTimeout(doneTimer);
    state = next;
    render();

    if (next === 'done') {
      // A brief confirmation, then back to work. Long-lived success states are
      // just more chrome.
      doneTimer = setTimeout(() => {
        if (state === 'done') setState('idle');
      }, 300);
    }
  }

  /* ── interaction ───────────────────────────────────────────────── */

  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (state === 'ghost') return;
    if (state === 'loading') callbacks.onStop();
    else callbacks.onActivate();
  });

  // Some editors blur on mousedown; taking the press without focus movement
  // keeps the field's selection intact for the insertion that follows.
  button.addEventListener('mousedown', (event) => {
    event.preventDefault();
  });

  /* ── dismissal (§1.5) ──────────────────────────────────────────── */

  let menu: HTMLElement | null = null;
  let menuPositionRaf = 0;
  let menuCleanup: (() => void) | null = null;

  function positionMenu(): void {
    if (!menu) return;
    const anchor = wrap.getBoundingClientRect();
    const menuBox = menu.getBoundingClientRect();
    const margin = 8;
    const gap = 4;
    const maximumLeft = Math.max(
      margin,
      globalThis.innerWidth - margin - menuBox.width,
    );
    const left = Math.min(
      Math.max(margin, anchor.right - menuBox.width),
      maximumLeft,
    );
    const below = anchor.bottom + gap;
    const above = anchor.top - gap - menuBox.height;
    const preferredTop =
      below + menuBox.height <= globalThis.innerHeight - margin ||
      above < margin
        ? below
        : above;
    const maximumTop = Math.max(
      margin,
      globalThis.innerHeight - margin - menuBox.height,
    );
    const top = Math.min(Math.max(margin, preferredTop), maximumTop);

    // The menu remains a child of the wrapper for focus ownership, while its
    // coordinates are projected back from viewport space. This works with the
    // wrapper's translate3d positioning and flips above near the screen edge.
    menu.style.inset = 'auto';
    menu.style.left = `${String(left - anchor.left)}px`;
    menu.style.top = `${String(top - anchor.top)}px`;
  }

  function scheduleMenuPosition(): void {
    if (!menu || menuPositionRaf !== 0) return;
    menuPositionRaf = requestAnimationFrame(() => {
      menuPositionRaf = 0;
      positionMenu();
    });
  }

  function closeMenu(): void {
    if (menuPositionRaf !== 0) {
      cancelAnimationFrame(menuPositionRaf);
      menuPositionRaf = 0;
    }
    globalThis.removeEventListener('resize', scheduleMenuPosition);
    globalThis.removeEventListener('scroll', scheduleMenuPosition, true);
    menuCleanup?.();
    menuCleanup = null;
    menu?.remove();
    menu = null;
    dismiss.setAttribute('aria-expanded', 'false');
  }

  function openMenu(): void {
    if (menu) {
      closeMenu();
      return;
    }

    const choice = (
      label: string,
      value: DismissChoice | 'reset' | 'cancel',
      className?: string,
    ): HTMLElement =>
      el('li', {
        ...(className ? { class: className } : {}),
        children: [
          (() => {
            const item = el('button', {
              attrs: { type: 'button', role: 'menuitem' },
              text: label,
            });
            item.addEventListener('click', () => {
              closeMenu();
              if (value === 'reset') callbacks.onResetPosition?.();
              else if (value === 'cancel') button.focus();
              else callbacks.onDismiss(value);
            });
            return item;
          })(),
        ],
      });

    menu = el('ul', {
      class: 'pa-menu',
      attrs: { role: 'menu', 'aria-label': t('button.dismiss') },
      children: [
        callbacks.onResetPosition && callbacks.canResetPosition?.()
          ? choice(t('menu.resetPosition'), 'reset')
          : null,
        choice(t('menu.hideUntilReload'), 'session'),
        choice(t('menu.hideOnSite'), 'site'),
        choice(t('menu.hideEverywhere'), 'everywhere'),
        choice(t('menu.cancel'), 'cancel', 'pa-menu-cancel'),
      ].filter((node): node is HTMLElement => node !== null),
    });

    menu.style.visibility = 'hidden';
    wrap.append(menu);
    positionMenu();
    menu.style.removeProperty('visibility');
    globalThis.addEventListener('resize', scheduleMenuPosition, {
      passive: true,
    });
    globalThis.addEventListener('scroll', scheduleMenuPosition, {
      capture: true,
      passive: true,
    });
    // Light dismiss: any pointer outside the menu or the × closes it. Use
    // composedPath(), not target — a shadow-tree event is retargeted to the
    // host by the time it reaches the document, so target is never the menu
    // and a contains() check would fire on the menu's own clicks.
    const onOutside = (event: Event): void => {
      const path = event.composedPath();
      if (menu && (path.includes(menu) || path.includes(dismiss))) return;
      closeMenu();
    };
    document.addEventListener('pointerdown', onOutside, true);
    menuCleanup = () => {
      document.removeEventListener('pointerdown', onOutside, true);
    };
    dismiss.setAttribute('aria-expanded', 'true');
    menu.querySelector('button')?.focus();
  }

  dismiss.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    openMenu();
  });

  // Esc on the button hides for the session (§1.5) — the de-facto pattern
  // users already expect from extensions in this space.
  wrap.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    if (menu) closeMenu();
    else callbacks.onDismiss('session');
  });

  render();

  return {
    wrap,
    focus: () => {
      button.focus();
    },
    setState,
    getState: () => state,
    setProfile: (name, category) => {
      profileName = name;
      dot.style.background = CATEGORY_COLORS[category] ?? 'transparent';
      tooltip.textContent = tooltipText();
    },
    setPlacement: (slot) => {
      wrap.setAttribute('data-slot', slot);
      const side = (['right', 'left', 'above', 'below'] as const).find(
        (candidate) => slot.includes(`outside-${candidate}`),
      );
      wrap.setAttribute(
        'data-placement',
        side ? 'outside' : slot === 'hidden' ? 'hidden' : 'inside',
      );
      if (side) wrap.setAttribute('data-side', side);
      else wrap.removeAttribute('data-side');
      scheduleMenuPosition();
    },
    setInstant: (instant) => {
      wrap.setAttribute('data-instant', instant ? 'true' : 'false');
      wrap.setAttribute('data-entering', instant ? 'false' : 'true');
    },
    destroy: () => {
      clearTimeout(doneTimer);
      clearTimeout(suppressClickTimer);
      cancelActiveDrag?.();
      closeMenu();
      wrap.remove();
    },
  };
}
