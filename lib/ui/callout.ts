import { t } from '../i18n';
import { el } from './host';

/**
 * The first-run callout (UX-SPEC §4).
 *
 * Shown once, on the first qualifying focus *ever* (global, not per-site),
 * anchored to the disc. It is the entire onboarding: it names the feature, its
 * shortcut, and — deliberately — teaches the per-site escape hatch before the
 * feature, so a user who does not want it learns how to turn it off first.
 *
 * No animation loops, no sparkles (§4). Built with el()/textContent only, so it
 * stays Trusted-Types-safe like every other injected surface. It never touches
 * credentials or providers; the two actions are relayed to the content script.
 */
export interface CalloutCallbacks {
  /** The user acknowledged; remember it and never show the callout again. */
  onGotIt: () => void;
  /** The per-site opt-out, learned in the intro itself. */
  onHideSite: () => void;
}

export interface CalloutHandle {
  element: HTMLElement;
  focus: () => void;
  destroy: () => void;
}

export function createCallout(callbacks: CalloutCallbacks): CalloutHandle {
  const gotIt = el('button', {
    class: 'pa-callout-primary',
    attrs: { type: 'button' },
    text: t('callout.gotIt'),
  });
  gotIt.addEventListener('click', () => callbacks.onGotIt());

  const hide = el('button', {
    class: 'pa-callout-secondary',
    attrs: { type: 'button' },
    text: t('menu.hideOnSite'),
  });
  hide.addEventListener('click', () => callbacks.onHideSite());

  const element = el('div', {
    class: 'pa-callout',
    attrs: {
      role: 'dialog',
      'aria-label': t('callout.body'),
    },
    children: [
      el('p', { class: 'pa-callout-body', text: t('callout.body') }),
      el('div', {
        class: 'pa-callout-actions',
        children: [gotIt, hide],
      }),
    ],
  });

  // Escape dismisses it the same as "Got it" — the least-destructive default.
  element.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    callbacks.onGotIt();
  });

  return {
    element,
    focus: () => gotIt.focus(),
    destroy: () => element.remove(),
  };
}

export const CALLOUT_CSS = `
/*
 * Anchored above the disc, aligned to its inline-end so a 240px box opens back
 * across the composer rather than off the screen edge. pointer-events:auto
 * because the layer it lives in is a click-through coordinate frame.
 */
.pa-callout {
  position: absolute;
  inset-block-end: calc(100% + 10px);
  inset-inline-end: 0;
  width: 240px;
  box-sizing: border-box;
  padding: var(--ph-space-3);
  border: 1px solid var(--ph-border);
  border-radius: var(--ph-radius-panel, 14px);
  background: var(--ph-surface);
  color: var(--ph-text);
  box-shadow: var(--ph-shadow-panel);
  font: var(--ph-type-body) var(--ph-font);
  pointer-events: auto;
  direction: ltr;
  text-align: start;
}

.pa-callout-body {
  margin: 0 0 var(--ph-space-2);
  color: var(--ph-text);
  line-height: 1.4;
}

.pa-callout-actions {
  display: flex;
  gap: var(--ph-space-2);
  flex-wrap: wrap;
}

.pa-callout-primary,
.pa-callout-secondary {
  border: 1px solid var(--ph-border);
  border-radius: var(--ph-radius-chip, 8px);
  padding: 6px var(--ph-space-3);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}

.pa-callout-primary {
  background: var(--ph-accent);
  border-color: var(--ph-accent);
  color: var(--ph-accent-fg);
}

.pa-callout-secondary {
  background: none;
  color: var(--ph-text-muted);
}

.pa-callout-primary:focus-visible,
.pa-callout-secondary:focus-visible {
  outline: 2px solid var(--ph-accent);
  outline-offset: 2px;
}
`;
