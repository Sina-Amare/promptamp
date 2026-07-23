/**
 * Preview panel styles (UX-SPEC §2).
 *
 * Two doctrines run through this file:
 *
 * **Glass on the frame, never under text.** `backdrop-filter` looks good on a
 * panel edge and is actively hostile behind body copy — the contrast ratio
 * becomes whatever the page happens to be showing. So the body sits on an
 * opaque surface and only the frame is translucent, with a solid fallback
 * wherever blur is unavailable or the user asked for more contrast.
 *
 * **Stacked, not side-by-side.** An anchored popover cannot afford two panes,
 * and a left/right split mirrors confusingly in RTL. Everything is one column.
 */
export const PANEL_CSS = `
.pa-panel {
  position: absolute;
  z-index: var(--ph-z);
  /* The layer this sits in is pointer-events:none so the page stays clickable
     around the button. Without re-enabling them here the whole panel is
     click-through: visible, and every control dead. */
  pointer-events: auto;
  inline-size: min(560px, calc(100vw - 32px));
  min-inline-size: 320px;
  max-block-size: 50vh;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--ph-border);
  border-radius: var(--ph-radius-panel);
  background: var(--ph-surface-frame);
  box-shadow: var(--ph-shadow-panel);
  color: var(--ph-text);
  font: var(--ph-type-body) var(--ph-font);
  overflow: hidden;
  /* Reset the UA popover defaults; we position this ourselves. */
  margin: 0;
  padding: 0;
  inset: auto;
}

@supports (backdrop-filter: blur(16px)) {
  .pa-panel {
    backdrop-filter: blur(16px);
  }
}

/* Blur unavailable, or the user asked for contrast: go solid. */
@supports not (backdrop-filter: blur(16px)) {
  .pa-panel {
    background: var(--ph-surface);
  }
}

@media (prefers-contrast: more), (forced-colors: active) {
  .pa-panel {
    background: var(--ph-surface);
    backdrop-filter: none;
  }
}

.pa-panel:focus-visible,
.pa-panel *:focus-visible {
  outline: 2px solid var(--ph-accent);
  outline-offset: 2px;
}

@keyframes pa-panel-in {
  from {
    opacity: 0;
    transform: translateY(4px) scale(0.99);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

.pa-panel[data-animate='true'] {
  animation: pa-panel-in var(--ph-dur-panel) var(--ph-ease-out);
}

/* ── header ────────────────────────────────────────────────────── */

.pa-head {
  display: flex;
  align-items: center;
  gap: var(--ph-space-2);
  padding: var(--ph-space-3) var(--ph-space-4);
  border-block-end: 1px solid var(--ph-border);
}

.pa-title {
  font: 600 var(--ph-type-title) var(--ph-font);
  letter-spacing: -0.005em;
  margin-inline-end: auto;
}

.pa-title:focus {
  outline: none;
}

.pa-chip {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: var(--ph-space-1);
  padding: 3px var(--ph-space-2);
  border: 1px solid var(--ph-border);
  border-radius: var(--ph-radius-chip);
  background: var(--ph-surface-raised);
  color: var(--ph-text);
  font: var(--ph-type-micro) var(--ph-font);
  cursor: pointer;
  transition: background var(--ph-dur-micro) var(--ph-ease-standard);
}

.pa-chip:hover {
  background: var(--ph-border);
}

.pa-chip[aria-expanded='true'] {
  border-color: var(--ph-accent);
}

.pa-chip-auto {
  color: var(--ph-text-muted);
}

/* A small dot ahead of a profile name in the menu, tinted by category. */
.pa-chip-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex: none;
}

/*
 * The chip dropdown (profile picker, output-language picker). One component,
 * two uses. Appended to the panel and positioned by JS (top/left clamped
 * inside the panel), so the panel's overflow:hidden — needed for the rounded
 * corners — never clips it, and no top-layer popover is required.
 */
.pa-chip-menu {
  position: absolute;
  z-index: var(--ph-z);
  inline-size: max-content;
  min-inline-size: 180px;
  max-inline-size: calc(100% - 16px);
  overflow-y: auto;
  padding: var(--ph-space-1);
  border: 1px solid var(--ph-border);
  border-radius: var(--ph-radius-chip);
  background: var(--ph-surface);
  box-shadow: var(--ph-shadow-panel);
  list-style: none;
}

.pa-chip-menu li {
  display: flex;
  align-items: center;
  gap: var(--ph-space-2);
  padding: 6px var(--ph-space-2);
  border-radius: 6px;
  color: var(--ph-text);
  font: var(--ph-type-micro) var(--ph-font);
  cursor: pointer;
}

.pa-chip-menu li:hover,
.pa-chip-menu li[aria-selected='true'] {
  background: var(--ph-surface-raised);
}

.pa-chip-menu li[aria-current='true'] {
  font-weight: 600;
}

.pa-chip-menu li:focus-visible {
  outline: 2px solid var(--ph-accent);
  outline-offset: -2px;
}

.pa-carousel {
  display: flex;
  align-items: center;
  gap: 2px;
  font: var(--ph-type-micro) var(--ph-font);
  color: var(--ph-text-muted);
}

.pa-carousel button {
  width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 6px;
  background: none;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.pa-carousel button:disabled {
  opacity: 0.35;
  cursor: default;
}

/* Only directional glyphs mirror — never the checkmark, spinner, or logo. */
:host([dir='rtl']) .pa-carousel button svg {
  transform: scaleX(-1);
}

.pa-icon-btn {
  width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 6px;
  background: none;
  color: var(--ph-text-muted);
  cursor: pointer;
}

.pa-icon-btn {
  transition:
    background var(--ph-dur-micro) var(--ph-ease-standard),
    transform var(--ph-dur-micro) var(--ph-ease-standard);
}

.pa-icon-btn:hover {
  background: var(--ph-surface-raised);
  color: var(--ph-text);
}

.pa-icon-btn:active {
  transform: scale(0.94);
}

/* ── body ──────────────────────────────────────────────────────── */

.pa-body-wrap {
  flex: 1;
  min-block-size: 0;
  overflow-y: auto;
  /* Opaque: text never sits on glass. */
  background: var(--ph-surface);
}

.pa-body {
  padding: var(--ph-space-4);
  min-block-size: 72px;
  font: var(--ph-type-body) var(--ph-font);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  outline: none;
}

/* Arabic-script content renders materially better with Vazirmatn when the
   user happens to have it; we never load a webfont into someone else's page. */
.pa-body:lang(fa),
.pa-body:lang(ar) {
  font-family: var(--ph-font-arabic);
}

.pa-ins {
  background: var(--ph-diff-add-bg);
  color: var(--ph-diff-add-fg);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.pa-del {
  background: var(--ph-diff-del-bg);
  color: var(--ph-diff-del-fg);
  text-decoration: line-through;
}

/* ── loading (§2.3) ────────────────────────────────────────────── */

.pa-skeleton {
  display: grid;
  gap: var(--ph-space-2);
  padding: var(--ph-space-4);
}

.pa-skeleton-line {
  height: 12px;
  border-radius: 6px;
  background: linear-gradient(
    90deg,
    var(--ph-surface-raised) 0%,
    var(--ph-border) 50%,
    var(--ph-surface-raised) 100%
  );
  background-size: 200% 100%;
  animation: pa-shimmer 1.4s linear infinite;
}

/* Decreasing widths read as text rather than as loading bars. */
.pa-skeleton-line:nth-child(1) { width: 96%; }
.pa-skeleton-line:nth-child(2) { width: 88%; }
.pa-skeleton-line:nth-child(3) { width: 62%; }

@keyframes pa-shimmer {
  to {
    background-position: -200% 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .pa-skeleton-line {
    animation: none;
    background: var(--ph-surface-raised);
  }
}

.pa-status {
  padding: 0 var(--ph-space-4) var(--ph-space-3);
  color: var(--ph-text-muted);
  font: var(--ph-type-micro) var(--ph-font);
}

@keyframes pa-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

.pa-body[data-fresh='true'] {
  animation: pa-fade-in var(--ph-dur-fade-result) var(--ph-ease-standard);
}

/* ── toggles, adjust, actions ──────────────────────────────────── */

.pa-row {
  display: flex;
  align-items: center;
  gap: var(--ph-space-2);
  padding: var(--ph-space-2) var(--ph-space-4);
  border-block-start: 1px solid var(--ph-border);
  flex-wrap: wrap;
}

.pa-pill {
  padding: 4px var(--ph-space-3);
  border: 1px solid var(--ph-border);
  border-radius: var(--ph-radius-chip);
  background: var(--ph-surface-raised);
  color: var(--ph-text-muted);
  font: var(--ph-type-micro) var(--ph-font);
  cursor: pointer;
  transition:
    background var(--ph-dur-micro) var(--ph-ease-standard),
    color var(--ph-dur-micro) var(--ph-ease-standard),
    transform var(--ph-dur-micro) var(--ph-ease-standard);
}

.pa-pill:hover {
  border-color: var(--ph-accent);
  color: var(--ph-text);
}

.pa-pill:active {
  transform: scale(0.97);
}

.pa-pill[aria-pressed='true'] {
  background: var(--ph-accent);
  border-color: var(--ph-accent);
  color: var(--ph-accent-fg);
}

/* The Structured chip carries the amber "amplify" accent on hover, marking it
   as the one pill that changes the *shape* of the output, not just a tweak. */
.pa-pill.pa-pill-structured:hover {
  border-color: var(--ph-action);
  color: var(--ph-text);
}

.pa-adjust-input {
  flex: 1;
  min-inline-size: 140px;
  padding: 5px var(--ph-space-3);
  border: 1px solid var(--ph-border);
  border-radius: var(--ph-radius-chip);
  background: var(--ph-surface);
  color: var(--ph-text);
  font: var(--ph-type-micro) var(--ph-font);
}

.pa-actions {
  display: flex;
  align-items: center;
  gap: var(--ph-space-2);
  padding: var(--ph-space-3) var(--ph-space-4);
  border-block-start: 1px solid var(--ph-border);
  background: var(--ph-surface);
}

/* Exactly one visually-primary element on the surface — the amber "amplify"
   commit, per the logo's accent. Dark ink on amber holds contrast. */
.pa-primary {
  padding: 7px var(--ph-space-4);
  border: 1px solid var(--ph-action);
  border-radius: var(--ph-radius-chip);
  background: var(--ph-action);
  color: var(--ph-action-fg);
  font: 600 var(--ph-type-micro) var(--ph-font);
  cursor: pointer;
  transition:
    background var(--ph-dur-micro) var(--ph-ease-standard),
    transform var(--ph-dur-micro) var(--ph-ease-standard);
}

.pa-primary:hover {
  background: var(--ph-action-hover);
  border-color: var(--ph-action-hover);
}

.pa-primary:active {
  transform: scale(0.98);
}

.pa-secondary {
  padding: 7px var(--ph-space-3);
  border: 1px solid var(--ph-border);
  border-radius: var(--ph-radius-chip);
  background: none;
  color: var(--ph-text);
  font: var(--ph-type-micro) var(--ph-font);
  cursor: pointer;
  transition:
    background var(--ph-dur-micro) var(--ph-ease-standard),
    transform var(--ph-dur-micro) var(--ph-ease-standard);
}

.pa-secondary:hover {
  background: var(--ph-surface-raised);
}

.pa-secondary:active {
  transform: scale(0.98);
}

.pa-quiet {
  margin-inline-start: auto;
  padding: 7px var(--ph-space-2);
  border: 0;
  background: none;
  color: var(--ph-text-muted);
  font: var(--ph-type-micro) var(--ph-font);
  cursor: pointer;
}

.pa-quiet:hover {
  color: var(--ph-text);
}

/* ── errors (§4) ───────────────────────────────────────────────── */

.pa-error {
  display: grid;
  gap: var(--ph-space-2);
  padding: var(--ph-space-4);
  color: var(--ph-text);
  font: var(--ph-type-body) var(--ph-font);
}

.pa-error-title {
  display: flex;
  align-items: center;
  gap: var(--ph-space-2);
  color: var(--ph-danger);
  font-weight: 600;
  font-size: 13px;
}

/* The fix. Given the same weight as the diagnosis, because it is the half the
   user is actually looking for. */
.pa-remedy {
  padding: var(--ph-space-2) var(--ph-space-3);
  border-inline-start: 2px solid var(--ph-accent);
  border-radius: 0 var(--ph-radius-chip) var(--ph-radius-chip) 0;
  background: var(--ph-surface-raised);
  color: var(--ph-text);
  font-size: 12px;
  line-height: 1.5;
}

/* One line per connection that was tried, so three different failures stay
   three different failures. */
.pa-attempts {
  display: grid;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
  color: var(--ph-text-muted);
  font-size: 11px;
}

.pa-attempts li {
  display: flex;
  gap: var(--ph-space-2);
}

.pa-attempt-label {
  flex: none;
  max-width: 40%;
  overflow: hidden;
  color: var(--ph-text);
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
}

.pa-error-actions {
  display: flex;
  gap: var(--ph-space-2);
}

/* ── undo pill (§2.5) ──────────────────────────────────────────── */

.pa-undo {
  position: absolute;
  z-index: var(--ph-z);
  /* Same reason as the panel — an Undo button nobody can press is worse than
     no Undo button at all. */
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: var(--ph-space-2);
  padding: 6px var(--ph-space-3);
  border: 1px solid var(--ph-border);
  border-radius: 9999px;
  background: var(--ph-surface);
  box-shadow: var(--ph-shadow-button);
  color: var(--ph-text);
  font: var(--ph-type-micro) var(--ph-font);
  white-space: nowrap;
}

.pa-undo button {
  border: 0;
  background: none;
  color: var(--ph-accent);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}

.pa-sr-only {
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

.pa-notice {
  padding: var(--ph-space-2) var(--ph-space-4);
  color: var(--ph-text-muted);
  font: var(--ph-type-micro) var(--ph-font);
}
`;
