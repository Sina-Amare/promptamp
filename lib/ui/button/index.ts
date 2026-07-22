import { el } from '../host';
import { CATEGORY_COLORS } from '../tokens';
import {
  alertIcon,
  checkIcon,
  closeIcon,
  honeIcon,
  loadingArc,
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
}

export interface ButtonHandle {
  wrap: HTMLElement;
  setState: (state: ButtonState) => void;
  setProfile: (name: string, category: string) => void;
  setInstant: (instant: boolean) => void;
  getState: () => ButtonState;
  destroy: () => void;
}

const LABELS: Record<ButtonState, string> = {
  ghost: 'Write a draft first',
  idle: 'Enhance draft — PromptAmp',
  typing: 'Enhance draft — PromptAmp',
  loading: 'Stop enhancing',
  done: 'Draft enhanced',
  error: 'Enhancement failed — try again',
};

const prefersReducedMotion = (): boolean =>
  globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function createButton(callbacks: ButtonCallbacks): ButtonHandle {
  let state: ButtonState = 'ghost';
  let profileName = '';
  let doneTimer: ReturnType<typeof setTimeout> | undefined;

  const iconSlot = el('span', { class: 'pa-icon' });
  iconSlot.append(honeIcon());

  const dot = el('span', { class: 'pa-dot' });

  const button = el('button', {
    class: 'pa-button',
    attrs: {
      type: 'button',
      'aria-label': LABELS.ghost,
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
    text: 'Write a draft first',
  });

  const dismiss = el('button', {
    class: 'pa-dismiss',
    attrs: {
      type: 'button',
      'aria-label': 'Hide PromptAmp',
      'aria-haspopup': 'menu',
    },
    children: [closeIcon()],
  });

  const wrap = el('div', {
    class: 'pa-button-wrap',
    attrs: { 'data-state': 'ghost', 'data-entering': 'true' },
    children: [button, dismiss, tooltip],
  });

  /* ── state machine ─────────────────────────────────────────────── */

  function render(): void {
    wrap.setAttribute('data-state', state);
    button.setAttribute('aria-label', LABELS[state]);
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
        return honeIcon();
    }
  }

  function tooltipText(): string {
    if (state === 'ghost') return 'Write a draft first';
    if (state === 'loading') return 'Stop enhancing';
    if (state === 'error') return 'Enhancement failed — try again';
    // U+2068/U+2069 isolate the profile name: a Latin brand token inside RTL
    // chrome would otherwise drag the rest of the line out of order. <bdi> is
    // not available here — a tooltip is a plain-string context.
    const profile = profileName ? ` · Profile: ⁨${profileName}⁩` : '';
    return `Enhance draft${profile} · Alt+E`;
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

  function closeMenu(): void {
    menu?.remove();
    menu = null;
    dismiss.setAttribute('aria-expanded', 'false');
  }

  function openMenu(): void {
    if (menu) {
      closeMenu();
      return;
    }

    const choice = (label: string, value: DismissChoice): HTMLElement =>
      el('li', {
        children: [
          (() => {
            const item = el('button', {
              attrs: { type: 'button', role: 'menuitem' },
              text: label,
            });
            item.addEventListener('click', () => {
              closeMenu();
              callbacks.onDismiss(value);
            });
            return item;
          })(),
        ],
      });

    menu = el('ul', {
      class: 'pa-menu',
      attrs: { role: 'menu', 'aria-label': 'Hide PromptAmp' },
      children: [
        choice('Hide until next visit', 'session'),
        choice('Hide on this site', 'site'),
        choice('Hide everywhere', 'everywhere'),
      ],
    });

    wrap.append(menu);
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
    setState,
    getState: () => state,
    setProfile: (name, category) => {
      profileName = name;
      dot.style.background = CATEGORY_COLORS[category] ?? 'transparent';
      tooltip.textContent = tooltipText();
    },
    setInstant: (instant) => {
      wrap.setAttribute('data-instant', instant ? 'true' : 'false');
      wrap.setAttribute('data-entering', instant ? 'false' : 'true');
    },
    destroy: () => {
      clearTimeout(doneTimer);
      closeMenu();
      wrap.remove();
    },
  };
}
