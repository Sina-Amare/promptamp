/**
 * Button styles (UX-SPEC §1.3–1.5).
 *
 * Two rules shape almost everything here:
 *
 * 1. **Only `transform` and `opacity` animate.** Anything else runs off the
 *    compositor and shows up as jank on a page we do not control.
 * 2. **The backplate is fully opaque.** Never glass, never host-dependent.
 *    Contrast has to be guaranteed against a surface we supply, because the
 *    page behind us can be any colour at all.
 */
export const BUTTON_CSS = `
/*
 * Fixed and promoted to the top layer via the Popover API.
 *
 * A modal <dialog> makes the entire document outside it inert, and our host
 * lives in <body> — so a button anchored to a composer *inside* a dialog would
 * render but refuse every click. Top-layer elements stay interactive alongside
 * a modal dialog, which is the only way to support that case.
 *
 * Being fixed also means every coordinate here is viewport-relative, matching
 * getBoundingClientRect and elementsFromPoint with no scroll conversion.
 */
.pa-button-layer {
  position: fixed;
  inset: 0;
  width: 100vw;
  height: 100vh;
  z-index: var(--ph-z);
  margin: 0;
  padding: 0;
  border: 0;
  background: none;
  overflow: visible;
  /* The layer is a positioning frame only — clicks pass through to the page. */
  pointer-events: none;
  /*
   * A coordinate space, not text. Every surface inside is placed with a
   * translate3d of viewport coordinates taken from getBoundingClientRect, and
   * those are physical pixels from the left edge. Letting this box inherit
   * an rtl direction from the host moves each child's static origin to the
   * *right* edge, so the same translate puts the button a full viewport width
   * off-screen — which is exactly what happened the first time a Persian
   * interface met a real page.
   *
   * The surfaces re-declare their own direction; this frame stays physical.
   */
  direction: ltr;
}

/* The UA hides an unshown popover; ours is shown for the life of the script. */
.pa-button-layer:popover-open {
  display: block;
}

.pa-button-wrap[data-dragging='true'] {
  cursor: grabbing;
}

.pa-button-wrap[data-dragging='true'] .pa-button {
  opacity: 1;
  transform: scale(1.05);
}

.pa-button-wrap {
  position: absolute;
  width: var(--ph-btn-hit);
  height: var(--ph-btn-hit);
  display: grid;
  place-items: center;
  pointer-events: auto;
  touch-action: none;
  /* Transparent padding gives every visual treatment a complete 40px target —
     comfortably past WCAG 2.5.8's 24px floor. */
}

/*
 * Placement has two visual grammars:
 * - in a host action row, a quiet rounded utility key;
 * - outside, a tab physically attached to the composer's nearest edge.
 *
 * The hit target remains the same 40px square in both cases. Only our visual
 * backplate changes, so collision guarantees and pointer geometry are stable.
 */
.pa-button-wrap[data-placement='outside'][data-side='right'] {
  justify-items: start;
}
.pa-button-wrap[data-placement='outside'][data-side='left'] {
  justify-items: end;
}
.pa-button-wrap[data-placement='outside'][data-side='above'] {
  align-items: end;
}
.pa-button-wrap[data-placement='outside'][data-side='below'] {
  align-items: start;
}

/* Full placement recalculations ease over a few pixels; the per-frame scroll
   glide opts out so the control never trails behind its composer. */
.pa-button-wrap[data-positioned='true'][data-gliding='false']:not([data-dragging='true']) {
  transition: transform 120ms var(--ph-ease-standard);
}

.pa-button-wrap[data-gliding='true'],
.pa-button-wrap[data-dragging='true'] {
  transition: none;
}

.pa-button {
  position: relative;
  width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
  border: 1px solid var(--ph-border);
  border-radius: 9px;
  background: var(--ph-surface-raised);
  color: var(--ph-accent);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12);
  cursor: pointer;
  opacity: 0.94;
  font: inherit;
  transition:
    background-color var(--ph-dur-micro) var(--ph-ease-standard),
    color var(--ph-dur-micro) var(--ph-ease-standard),
    opacity var(--ph-dur-micro) var(--ph-ease-standard),
    transform var(--ph-dur-micro) var(--ph-ease-standard);
}

.pa-button-wrap[data-placement='outside'] .pa-button {
  width: 30px;
  height: 32px;
  background: var(--ph-surface);
  box-shadow: var(--ph-shadow-button);
}

.pa-button-wrap[data-placement='outside'][data-side='right'] .pa-button {
  border-left: 2px solid var(--ph-accent);
  border-radius: 0 10px 10px 0;
}
.pa-button-wrap[data-placement='outside'][data-side='left'] .pa-button {
  border-right: 2px solid var(--ph-accent);
  border-radius: 10px 0 0 10px;
}
.pa-button-wrap[data-placement='outside'][data-side='above'] .pa-button {
  width: 32px;
  height: 30px;
  border-bottom: 2px solid var(--ph-accent);
  border-radius: 10px 10px 0 0;
}
.pa-button-wrap[data-placement='outside'][data-side='below'] .pa-button {
  width: 32px;
  height: 30px;
  border-top: 2px solid var(--ph-accent);
  border-radius: 0 0 10px 10px;
}

/* Entrance: scale from 0.95, never from 0. A tool invoked this often has to
   feel instant — 500ms entrances read as sluggish. */
@keyframes pa-enter {
  from {
    opacity: 0;
    transform: scale(0.95);
  }
  to {
    opacity: 0.9;
    transform: scale(1);
  }
}

.pa-button-wrap[data-entering='true'] .pa-button {
  animation: pa-enter var(--ph-dur-enter) var(--ph-ease-out);
}

/* Keyboard-invoked surfaces never animate in — animating a high-frequency
   keyboard action is friction, not delight. */
.pa-button-wrap[data-instant='true'] .pa-button {
  animation: none;
}

/* Hover effects only where hovering is a real thing. */
@media (hover: hover) and (pointer: fine) {
  .pa-button-wrap:not([data-state='ghost']):hover .pa-button {
    background: var(--ph-accent);
    color: var(--ph-accent-fg);
    opacity: 1;
    transform: scale(1.04);
  }
}

.pa-button:focus-visible {
  outline: 2px solid var(--ph-accent);
  outline-offset: 2px;
  opacity: 1;
}

.pa-button:active {
  transform: scale(0.97);
}

/* Empty or too-short draft: present but plainly not ready. Discoverable
   without nagging — hiding it entirely makes the feature undiscoverable.
   0.55, not 0.4: the fainter value read as a rendering glitch on busy pages. */
.pa-button-wrap[data-state='ghost'] .pa-button {
  opacity: 0.55;
  cursor: default;
}

/* Actively typing: recede, never compete with composition. */
.pa-button-wrap[data-state='typing'] .pa-button {
  opacity: 0.5;
}

.pa-button-wrap[data-state='loading'] .pa-button {
  opacity: 1;
  cursor: pointer;
  background: var(--ph-accent);
  color: var(--ph-accent-fg);
}

.pa-button-wrap[data-state='error'] .pa-button {
  border-color: var(--ph-danger);
  background: var(--ph-surface);
  color: var(--ph-danger);
  opacity: 1;
}

/* The one amber moment on the disc: a warm "amplified" flash on success,
   echoing the logo's indicator. Dark ink on amber holds contrast. */
.pa-button-wrap[data-state='done'] .pa-button {
  opacity: 1;
  background: var(--ph-action);
  border-color: var(--ph-action);
  color: var(--ph-action-fg);
}

@keyframes pa-spin {
  to {
    transform: rotate(360deg);
  }
}

.pa-arc {
  animation: pa-spin 1.2s linear infinite;
  transform-origin: center;
}

@media (prefers-reduced-motion: reduce) {
  .pa-button-wrap {
    transition: none !important;
  }
  .pa-arc {
    animation: none;
  }
}

/* Profile indicator — 6px, no text, no count, no pulse. Every idle pixel is
   complaint surface. */
.pa-dot {
  position: absolute;
  inset-block-end: 2px;
  inset-inline-end: 2px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  border: 1px solid var(--ph-surface);
  pointer-events: none;
}

/* Dismissal ×, revealed on hover or focus only — no proximity expansion. */
.pa-dismiss {
  position: absolute;
  inset-block-start: 2px;
  inset-inline-end: 2px;
  width: 16px;
  height: 16px;
  display: none;
  place-items: center;
  padding: 0;
  border: 1px solid var(--ph-border);
  border-radius: 50%;
  background: var(--ph-surface);
  color: var(--ph-text-muted);
  cursor: pointer;
}

.pa-button-wrap:hover .pa-dismiss,
.pa-button-wrap:focus-within .pa-dismiss {
  display: grid;
}

.pa-dismiss:focus-visible {
  outline: 2px solid var(--ph-accent);
  outline-offset: 1px;
}

/* Tooltip. Plain-string context, so bidi isolation uses FSI…PDI rather than
   <bdi> — a directional token like "Midjourney" inside RTL chrome would
   otherwise reorder the whole line. */
.pa-tooltip {
  position: absolute;
  inset-block-end: calc(100% + 6px);
  inset-inline-end: 0;
  padding: 4px var(--ph-space-2);
  border-radius: var(--ph-radius-chip);
  background: var(--ph-text);
  color: var(--ph-surface);
  font: var(--ph-type-micro) var(--ph-font);
  white-space: nowrap;
  pointer-events: none;
  opacity: 0;
  transition: opacity var(--ph-dur-micro) var(--ph-ease-standard);
}

.pa-button-wrap:hover .pa-tooltip,
.pa-button-wrap:focus-within .pa-tooltip {
  opacity: 1;
}

/* Dismissal menu. JS projects it into viewport coordinates and flips/clamps
   it at every edge; max-height is the final guard for unusually short screens. */
.pa-menu {
  position: absolute;
  min-width: 190px;
  max-height: calc(100vh - 16px);
  overflow-y: auto;
  padding: var(--ph-space-1);
  border: 1px solid var(--ph-border);
  border-radius: var(--ph-radius-chip);
  background: var(--ph-surface);
  box-shadow: var(--ph-shadow-panel);
  font: var(--ph-type-body) var(--ph-font);
  color: var(--ph-text);
  list-style: none;
}

.pa-menu button {
  display: block;
  width: 100%;
  padding: var(--ph-space-2) var(--ph-space-3);
  border: 0;
  border-radius: 6px;
  background: none;
  color: inherit;
  font: inherit;
  font-size: 13px;
  text-align: start;
  cursor: pointer;
}

.pa-menu button:hover,
.pa-menu button:focus-visible {
  background: var(--ph-surface-raised);
  outline: none;
}

.pa-menu-cancel {
  margin-block-start: var(--ph-space-1);
  padding-block-start: var(--ph-space-1);
  border-block-start: 1px solid var(--ph-border);
}

.pa-visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}
`;
