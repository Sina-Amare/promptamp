/**
 * Design tokens, verbatim from UX-SPEC §5.
 *
 * Shipped as a string rather than a .css file because the stylesheet is
 * adopted into a shadow root via `CSSStyleSheet.replaceSync` — no network
 * fetch, no FOUC, and nothing for the host page's CSS to reach.
 *
 * Every colour pair was contrast-validated *per theme*: a combination that
 * passes on white can fail on dark grey, so light and dark were checked
 * independently rather than derived from one another.
 */
export const TOKENS_CSS = `
:host {
  /* Panel body — opaque, because text sits on it. */
  --ph-surface: #FFFFFF;
  --ph-surface-frame: rgba(255, 255, 255, 0.72);
  --ph-surface-raised: #F6F6F9;
  --ph-border: rgba(0, 0, 0, 0.14);
  --ph-text: #1A1A21;          /* 15.2:1 */
  --ph-text-muted: #5C5C66;    /*  5.9:1 */
  /* Emerald brand. Deep enough for AA as text: #047857 on white ≈ 5.1:1, so
     links and the inline actions pass color-contrast; white on it (the disc
     icon) is the same 5.1:1. */
  --ph-accent: #047857;
  --ph-accent-fg: #FFFFFF;
  /* The "amplify" accent, from the logo. Amber is light, so its foreground is
     dark ink — #1A1A21 on #F59E0B ≈ 9:1. Reserved for the single commit action
     (Replace draft) and the done confirmation; teal stays the brand colour. */
  --ph-action: #F59E0B;
  --ph-action-fg: #1A1A21;
  --ph-action-hover: #D97706;
  --ph-danger: #B3261E;
  --ph-diff-add-bg: #DCFCE7;
  --ph-diff-add-fg: #14532D;
  --ph-diff-del-bg: #FEE2E2;
  --ph-diff-del-fg: #7F1D1D;
  --ph-shadow-button: 0 1px 3px rgba(0, 0, 0, 0.18);
  --ph-shadow-panel: 0 8px 30px rgba(0, 0, 0, 0.16);

  /* Shape */
  --ph-radius-button: 9999px;
  --ph-radius-panel: 16px;
  --ph-radius-chip: 8px;

  /* 4px grid, logical properties only */
  --ph-space-1: 4px;
  --ph-space-2: 8px;
  --ph-space-3: 12px;
  --ph-space-4: 16px;
  --ph-space-5: 24px;

  /* The disc is 28px; the hit area is 40px, via transparent padding. */
  --ph-btn-size: 28px;
  --ph-btn-hit: 40px;

  --ph-type-body: 14px/1.55;
  --ph-type-title: 13px/1.3;
  --ph-type-micro: 11px/1.4;
  --ph-font: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  /* Vazirmatn if the user has it — Arabic-script rendering is materially
     better with it, and we never load a webfont into someone else's page. */
  --ph-font-arabic: 'Vazirmatn', var(--ph-font);

  --ph-dur-micro: 120ms;
  --ph-dur-enter: 150ms;
  --ph-dur-panel: 200ms;
  --ph-dur-fade-result: 200ms;
  --ph-ease-out: cubic-bezier(0.23, 1, 0.32, 1);
  --ph-ease-standard: ease;
  --ph-ease-move: cubic-bezier(0.645, 0.045, 0.355, 1);

  /* Above every documented z-index war. Only a fallback: the panel is
     promoted to the browser top layer via the Popover API where available. */
  --ph-z: 2147483647;
}

:host([data-theme='dark']) {
  --ph-surface: #1C1C22;
  --ph-surface-frame: rgba(28, 28, 34, 0.72);
  --ph-surface-raised: #26262E;
  --ph-border: rgba(255, 255, 255, 0.16);
  --ph-text: #EDEDF2;          /* 13.9:1 */
  --ph-text-muted: #A2A2AE;    /*  6.4:1 */
  /* Emerald-400 reads bright and clean on the dark surface; near-black ink. */
  --ph-accent: #34D399;
  --ph-accent-fg: #04281B;
  /* Amber-400 reads brighter on the dark surface; dark ink foreground holds. */
  --ph-action: #FBBF24;
  --ph-action-fg: #1A1A21;
  --ph-action-hover: #F59E0B;
  --ph-danger: #F2827A;
  --ph-diff-add-bg: #14321F;
  --ph-diff-add-fg: #86EFAC;
  --ph-diff-del-bg: #3A1815;
  --ph-diff-del-fg: #FCA5A5;
  --ph-shadow-button: 0 1px 3px rgba(0, 0, 0, 0.5);
  --ph-shadow-panel: 0 8px 30px rgba(0, 0, 0, 0.55);
}

/* Reset only inside our root; the host page is never touched. */
*,
*::before,
*::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

/*
 * No partial compliance: every duration collapses. Opacity-only fades of
 * =150ms survive because they carry no motion, which is the distinction the
 * spec draws — a fade is not movement.
 */
@media (prefers-reduced-motion: reduce) {
  :host {
    --ph-dur-micro: 0ms;
    --ph-dur-enter: 0ms;
    --ph-dur-panel: 0ms;
    --ph-dur-move: 0ms;
  }

  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}

/* Glass is decorative; drop it when the user asked for contrast. */
@media (prefers-contrast: more) {
  :host {
    --ph-surface-frame: var(--ph-surface);
    --ph-border: currentColor;
  }
}

@media (forced-colors: active) {
  :host {
    --ph-surface: Canvas;
    --ph-surface-frame: Canvas;
    --ph-surface-raised: Canvas;
    --ph-text: CanvasText;
    --ph-text-muted: CanvasText;
    --ph-border: CanvasText;
    --ph-accent: Highlight;
    --ph-accent-fg: HighlightText;
    --ph-action: Highlight;
    --ph-action-fg: HighlightText;
  }
}
`;

/** Profile-category dot colours for the 6 px indicator (UX-SPEC §1.6). */
export const CATEGORY_COLORS: Record<string, string> = {
  chat: '#2DD4BF',
  image: '#A78BFA',
  video: '#F472B6',
  coding: '#60A5FA',
  learning: '#34D399',
  writing: '#FBBF24',
};
