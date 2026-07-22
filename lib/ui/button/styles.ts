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
.pa-button-layer {
  position: absolute;
  top: 0;
  left: 0;
  z-index: var(--ph-z);
  /* The layer is a positioning frame only — clicks pass through to the page. */
  pointer-events: none;
}

.pa-button-wrap {
  position: absolute;
  width: var(--ph-btn-hit);
  height: var(--ph-btn-hit);
  display: grid;
  place-items: center;
  pointer-events: auto;
  /* Transparent padding turns a 28px disc into a 40px target — comfortably
     past WCAG 2.5.8's 24px floor without a 40px visual footprint. */
}

.pa-button {
  width: var(--ph-btn-size);
  height: var(--ph-btn-size);
  display: grid;
  place-items: center;
  border: 1px solid var(--ph-border);
  border-radius: var(--ph-radius-button);
  background: var(--ph-accent);
  color: var(--ph-accent-fg);
  box-shadow: var(--ph-shadow-button);
  cursor: pointer;
  opacity: 0.9;
  font: inherit;
  transition:
    opacity var(--ph-dur-micro) var(--ph-ease-standard),
    transform var(--ph-dur-micro) var(--ph-ease-standard);
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
  .pa-button-wrap:hover .pa-button {
    opacity: 1;
    transform: scale(1.05);
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
   without nagging — hiding it entirely makes the feature undiscoverable. */
.pa-button-wrap[data-state='ghost'] .pa-button {
  opacity: 0.4;
  cursor: default;
}

/* Actively typing: recede, never compete with composition. */
.pa-button-wrap[data-state='typing'] .pa-button {
  opacity: 0.35;
}

.pa-button-wrap[data-state='loading'] .pa-button {
  opacity: 1;
  cursor: pointer;
}

.pa-button-wrap[data-state='error'] .pa-button {
  border-color: var(--ph-danger);
  background: var(--ph-surface);
  color: var(--ph-danger);
  opacity: 1;
}

.pa-button-wrap[data-state='done'] .pa-button {
  opacity: 1;
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
  .pa-arc {
    animation: none;
  }
}

/* Profile indicator — 6px, no text, no count, no pulse. Every idle pixel is
   complaint surface. */
.pa-dot {
  position: absolute;
  inset-block-end: 5px;
  inset-inline-end: 5px;
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

/* Dismissal menu — the three-choice escape hatch from §1.5. */
.pa-menu {
  position: absolute;
  inset-block-start: calc(100% + 4px);
  inset-inline-end: 0;
  min-width: 190px;
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
