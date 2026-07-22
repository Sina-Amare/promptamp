import { ADJUST_PRESETS } from '../../enhance/assemble';
import type { SafeError } from '../../messaging/protocol';
import { el } from '../host';
import { computeDiff, isUnchanged, renderDiff } from './diff';
import {
  alertIcon,
  chevronDown,
  chevronEnd,
  chevronStart,
  closeIcon,
  copyIcon,
} from './icons';

/**
 * The preview panel.
 *
 * **Nothing touches the draft until Accept.** That contract is the reason this
 * surface exists at all — Cursor users filed auto-apply-without-a-diff as a
 * regression bug, and DeepL's preview-before-apply is the pattern people
 * already trust. Everything here is read-only with respect to the host field
 * until the user presses Replace.
 */

export interface PanelVersion {
  text: string;
  /** How this version was produced — shown nowhere, used for the retry notice. */
  adjust?: string;
}

export interface PanelCallbacks {
  onAccept: (text: string) => void;
  onRetry: (adjust?: string) => void;
  onCopy: (text: string) => void;
  onDiscard: () => void;
  onStop: () => void;
  onProfileClick: () => void;
}

export interface PanelHandle {
  element: HTMLElement;
  showLoading: () => void;
  /**
   * Swap the skeleton for live text. Called on the first delta, so the user
   * starts reading roughly a second before the rewrite is finished.
   */
  beginStreaming: () => void;
  streamText: (partial: string) => void;
  showResult: (text: string, original: string) => void;
  showError: (error: SafeError) => void;
  showNotice: (message: string) => void;
  setProfile: (name: string, auto: boolean) => void;
  focusTitle: () => void;
  currentText: () => string;
  destroy: () => void;
}

/** UX-SPEC §2.2: regenerate branches, never overwrites. Three is the cap. */
const MAX_VERSIONS = 3;

export function createPanel(callbacks: PanelCallbacks): PanelHandle {
  const versions: PanelVersion[] = [];
  let index = 0;
  let original = '';
  let showDiff = false;
  let showOriginal = false;
  let destroyed = false;

  /* ── header ────────────────────────────────────────────────────── */

  const titleId = 'pa-panel-title';
  const title = el('h2', {
    class: 'pa-title',
    text: 'Enhanced draft',
    // tabindex -1 so focus can land here on open without adding a tab stop.
    attrs: { id: titleId, tabindex: '-1' },
  });

  const chipLabel = el('span', { text: 'General' });
  const chipAuto = el('span', { class: 'pa-chip-auto', text: ' · auto' });
  const chip = el('button', {
    class: 'pa-chip',
    attrs: {
      type: 'button',
      'aria-haspopup': 'listbox',
      'aria-label': 'Change profile',
    },
    children: [chipLabel, chipAuto, chevronDown()],
  });
  chip.addEventListener('click', callbacks.onProfileClick);

  const prevBtn = el('button', {
    attrs: { type: 'button', 'aria-label': 'Previous version' },
    children: [chevronStart()],
  });
  const nextBtn = el('button', {
    attrs: { type: 'button', 'aria-label': 'Next version' },
    children: [chevronEnd()],
  });
  const counter = el('span', { text: '' });
  const carousel = el('div', {
    class: 'pa-carousel',
    attrs: { hidden: 'until-found' },
    children: [prevBtn, counter, nextBtn],
  });
  carousel.hidden = true;

  prevBtn.addEventListener('click', () => {
    step(-1);
  });
  nextBtn.addEventListener('click', () => {
    step(1);
  });

  const closeBtn = el('button', {
    class: 'pa-icon-btn',
    attrs: { type: 'button', 'aria-label': 'Discard' },
    children: [closeIcon()],
  });
  closeBtn.addEventListener('click', callbacks.onDiscard);

  const head = el('div', {
    class: 'pa-head',
    children: [title, chip, carousel, closeBtn],
  });

  /* ── body ──────────────────────────────────────────────────────── */

  const body = el('div', {
    class: 'pa-body',
    attrs: {
      // Editable in place: users treat a suggestion as a starting point, and
      // making them accept-then-edit is a needless extra step.
      contenteditable: 'true',
      role: 'textbox',
      'aria-multiline': 'true',
      'aria-label': 'Enhanced draft, editable',
      // First-strong detection per block: a Persian draft resolves RTL while
      // an English image prompt in the same panel resolves LTR, with no
      // special-casing.
      dir: 'auto',
      spellcheck: 'false',
    },
  });

  const bodyWrap = el('div', { class: 'pa-body-wrap', children: [body] });

  // Polite, not assertive: this narrates progress, it does not interrupt.
  const status = el('div', {
    class: 'pa-sr-only',
    attrs: { role: 'status', 'aria-live': 'polite' },
  });

  /* ── toggle pills ──────────────────────────────────────────────── */

  const diffPill = el('button', {
    class: 'pa-pill',
    attrs: { type: 'button', 'aria-pressed': 'false' },
    text: 'Show changes',
  });
  const originalPill = el('button', {
    class: 'pa-pill',
    attrs: { type: 'button', 'aria-pressed': 'false' },
    text: 'Original',
  });

  diffPill.addEventListener('click', () => {
    showDiff = !showDiff;
    if (showDiff) showOriginal = false;
    renderBody();
  });
  originalPill.addEventListener('click', () => {
    showOriginal = !showOriginal;
    if (showOriginal) showDiff = false;
    renderBody();
  });

  const toggleRow = el('div', {
    class: 'pa-row',
    children: [diffPill, originalPill],
  });

  /* ── adjust row ────────────────────────────────────────────────── */

  const adjustInput = el('input', {
    class: 'pa-adjust-input',
    attrs: {
      type: 'text',
      placeholder: 'Describe a change…',
      'aria-label': 'Describe a change',
    },
  });

  adjustInput.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const value = adjustInput.value.trim();
    if (!value) return;
    adjustInput.value = '';
    callbacks.onRetry(value);
  });

  const adjustRow = el('div', {
    class: 'pa-row',
    children: [
      ...ADJUST_PRESETS.map((preset) => {
        const pill = el('button', {
          class: 'pa-pill',
          attrs: { type: 'button' },
          text: preset.label,
        });
        pill.addEventListener('click', () => {
          callbacks.onRetry(preset.instruction);
        });
        return pill;
      }),
      adjustInput,
    ],
  });

  /* ── action row ────────────────────────────────────────────────── */

  const acceptBtn = el('button', {
    class: 'pa-primary',
    attrs: { type: 'button' },
    // "Replace draft", not "Insert below" — inserting below makes no sense in
    // a prompt box.
    text: 'Replace draft',
  });
  const retryBtn = el('button', {
    class: 'pa-secondary',
    attrs: { type: 'button' },
    text: 'Retry',
  });
  const copyBtn = el('button', {
    class: 'pa-secondary',
    attrs: { type: 'button', 'aria-label': 'Copy' },
    children: [copyIcon()],
  });
  const discardBtn = el('button', {
    class: 'pa-quiet',
    attrs: { type: 'button' },
    text: 'Discard',
  });

  acceptBtn.addEventListener('click', () => {
    callbacks.onAccept(currentText());
  });
  retryBtn.addEventListener('click', () => {
    callbacks.onRetry();
  });
  copyBtn.addEventListener('click', () => {
    callbacks.onCopy(currentText());
  });
  discardBtn.addEventListener('click', callbacks.onDiscard);

  const actionRow = el('div', {
    class: 'pa-actions',
    children: [acceptBtn, retryBtn, copyBtn, discardBtn],
  });

  /* ── panel ─────────────────────────────────────────────────────── */

  const element = el('div', {
    class: 'pa-panel',
    attrs: {
      role: 'dialog',
      'aria-labelledby': titleId,
      // Deliberately no aria-modal: the host page stays visible and usable,
      // and claiming modality would hide it from screen readers entirely.
      tabindex: '-1',
    },
    children: [head, bodyWrap, status, toggleRow, adjustRow, actionRow],
  });

  // Top layer, so no amount of host `overflow: hidden`, transformed ancestors
  // or z-index escalation can clip us. `manual`, not `auto`: light-dismiss on
  // focus-out strands screen-reader users who navigate away without realising
  // the content closed.
  if ('popover' in element) {
    element.setAttribute('popover', 'manual');
  }

  /* ── keyboard map (§6) ─────────────────────────────────────────── */

  element.addEventListener('keydown', (event) => {
    const meta = event.ctrlKey || event.metaKey;

    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      callbacks.onDiscard();
      return;
    }
    // Plain Enter is reserved — the body is editable.
    if (meta && event.key === 'Enter') {
      event.preventDefault();
      callbacks.onAccept(currentText());
      return;
    }
    if (meta && !event.shiftKey && event.key.toLowerCase() === 'r') {
      event.preventDefault();
      callbacks.onRetry();
      return;
    }
    if (meta && event.shiftKey && event.key.toLowerCase() === 'c') {
      event.preventDefault();
      callbacks.onCopy(currentText());
      return;
    }
    if (event.key === 'Tab') {
      trapFocus(event);
      return;
    }
    // Arrows drive the carousel only while the carousel itself has focus —
    // anywhere else they must stay available for caret movement in the
    // editable body.
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      if (!carousel.contains(event.target as Node)) return;
      event.preventDefault();
      // Mirrored in RTL chrome: "next" is whichever arrow points forward.
      const forward =
        getComputedStyle(element).direction === 'rtl'
          ? event.key === 'ArrowLeft'
          : event.key === 'ArrowRight';
      step(forward ? 1 : -1);
    }
  });

  /** Tab wraps inside the panel; the host page keeps its own tab order. */
  function trapFocus(event: KeyboardEvent): void {
    const focusable = [
      ...element.querySelectorAll<HTMLElement>(FOCUSABLE),
    ].filter(
      (node) => !node.hasAttribute('disabled') && node.offsetParent !== null,
    );
    if (focusable.length === 0) return;

    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    const active = deepActive();

    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  /* ── rendering ─────────────────────────────────────────────────── */

  function currentText(): string {
    // The body is editable, so the live DOM is the source of truth — the user
    // may have refined it before accepting.
    if (showDiff || showOriginal) return versions[index]?.text ?? '';
    return body.innerText;
  }

  function renderBody(): void {
    const version = versions[index];
    if (!version) return;

    diffPill.setAttribute('aria-pressed', String(showDiff));
    originalPill.setAttribute('aria-pressed', String(showOriginal));
    // Editing while viewing a diff or the original would silently discard the
    // edit on toggle back, so the body is read-only in those modes.
    body.setAttribute(
      'contenteditable',
      showDiff || showOriginal ? 'false' : 'true',
    );

    if (showOriginal) {
      body.replaceChildren(document.createTextNode(original));
      return;
    }
    if (showDiff) {
      body.replaceChildren(renderDiff(computeDiff(original, version.text)));
      return;
    }
    body.replaceChildren(document.createTextNode(version.text));
  }

  function renderCarousel(): void {
    carousel.hidden = versions.length < 2;
    counter.textContent = `${String(index + 1)} of ${String(versions.length)}`;
    prevBtn.disabled = index === 0;
    nextBtn.disabled = index === versions.length - 1;
  }

  function step(delta: number): void {
    const next = index + delta;
    if (next < 0 || next >= versions.length) return;
    index = next;
    renderCarousel();
    renderBody();
  }

  function setBusy(busy: boolean): void {
    bodyWrap.setAttribute('aria-busy', busy ? 'true' : 'false');
  }

  /* ── public surface ────────────────────────────────────────────── */

  return {
    element,

    showLoading: () => {
      setBusy(true);
      // Reserved height, three lines at decreasing widths — no spinner, and
      // the label carries no end punctuation.
      body.replaceChildren();
      bodyWrap.replaceChildren(
        el('div', {
          class: 'pa-skeleton',
          children: [
            el('div', { class: 'pa-skeleton-line' }),
            el('div', { class: 'pa-skeleton-line' }),
            el('div', { class: 'pa-skeleton-line' }),
          ],
        }),
        el('p', { class: 'pa-status', text: 'Enhancing draft' }),
      );
      status.textContent = 'Enhancing draft';
      setControlsEnabled(false);
    },

    beginStreaming: () => {
      // Height was already reserved by the skeleton, so replacing it with text
      // causes no layout shift — the words simply appear where the shimmer was.
      bodyWrap.replaceChildren(body);
      body.replaceChildren();
      body.setAttribute('contenteditable', 'false');
      status.textContent = 'Enhancing draft';
    },

    streamText: (partial) => {
      // textContent, not append: the smooth renderer hands over the whole
      // string each frame, which keeps the DOM to a single text node.
      body.textContent = partial;
    },

    showResult: (text, source) => {
      try {
        original = source;

        const previous = versions[index]?.text;
        if (previous !== undefined && normalise(previous) === normalise(text)) {
          // Silent no-op regeneration reads as broken. Say so instead.
          showNoticeInternal(
            'Already looks good — try Adjust for a different direction.',
          );
          return;
        }

        // Branching: a retry adds a version, it never overwrites one.
        versions.push({ text });
        if (versions.length > MAX_VERSIONS) versions.shift();
        index = versions.length - 1;

        bodyWrap.replaceChildren(body);
        showDiff = false;
        showOriginal = false;
        renderBody();
        renderCarousel();

        body.setAttribute('data-fresh', 'true');
        setTimeout(() => body.removeAttribute('data-fresh'), 250);

        status.textContent = isUnchanged(computeDiff(original, text))
          ? 'This already reads well'
          : 'Enhanced version ready';
        setControlsEnabled(true);
      } finally {
        // In a finally block on purpose: leaving aria-busy set permanently
        // silences the live region for the rest of the session.
        setBusy(false);
      }
    },

    showError: (error) => {
      try {
        const retry = el('button', {
          class: 'pa-secondary',
          attrs: { type: 'button' },
          text: error.retryAfterSec
            ? `Retry in ${String(error.retryAfterSec)}s`
            : 'Retry',
        });
        retry.addEventListener('click', () => {
          callbacks.onRetry();
        });

        const dismiss = el('button', {
          class: 'pa-quiet',
          attrs: { type: 'button' },
          text: 'Close',
        });
        dismiss.addEventListener('click', callbacks.onDiscard);

        bodyWrap.replaceChildren(
          el('div', {
            class: 'pa-error',
            // role=alert so it is announced without the user hunting for it.
            attrs: { role: 'alert' },
            children: [
              el('div', {
                class: 'pa-error-title',
                children: [alertIcon(), el('span', { text: titleFor(error) })],
              }),
              el('p', { text: error.message }),
              el('p', {
                class: 'pa-status',
                text: 'Your draft is unchanged.',
              }),
              el('div', {
                class: 'pa-error-actions',
                children: [retry, dismiss],
              }),
            ],
          }),
        );
        // Focus the recovery action, not the message.
        retry.focus();
        setControlsEnabled(false);
      } finally {
        setBusy(false);
      }
    },

    showNotice: showNoticeInternal,

    setProfile: (name, auto) => {
      chipLabel.textContent = name;
      chipAuto.textContent = auto ? ' · auto' : ' · pinned';
    },

    focusTitle: () => {
      // APG: least-destructive-first. Focusing Replace would put a
      // draft-destroying action one Enter away from a user who just arrived.
      title.focus();
    },

    currentText,

    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      if ('hidePopover' in element) {
        try {
          (element as HTMLElement & { hidePopover: () => void }).hidePopover();
        } catch {
          // Not showing; nothing to hide.
        }
      }
      element.remove();
    },
  };

  function showNoticeInternal(message: string): void {
    const existing = element.querySelector('.pa-notice');
    existing?.remove();
    toggleRow.before(el('p', { class: 'pa-notice', text: message }));
    status.textContent = message;
    setControlsEnabled(true);
    setBusy(false);
  }

  function setControlsEnabled(enabled: boolean): void {
    for (const control of [
      acceptBtn,
      retryBtn,
      copyBtn,
      diffPill,
      originalPill,
    ]) {
      control.toggleAttribute('disabled', !enabled);
    }
  }
}

const FOCUSABLE =
  'button:not([disabled]), [href], input, select, textarea, [contenteditable="true"], [tabindex]:not([tabindex="-1"])';

/** activeElement stops at a shadow host, so descend to the real target. */
function deepActive(): Element | null {
  let node: Element | null = document.activeElement;
  while (node?.shadowRoot?.activeElement) {
    node = node.shadowRoot.activeElement;
  }
  return node;
}

function normalise(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Cause-class names, so the user knows whether retrying can possibly help. */
function titleFor(error: SafeError): string {
  switch (error.kind) {
    case 'bad-key':
      return 'API key problem';
    case 'rate-limited':
      return 'Rate limited';
    case 'quota':
      return 'Out of quota';
    case 'network':
      return 'Connection problem';
    case 'refusal':
      return 'Model declined';
    case 'too-long':
      return 'Draft too long';
    case 'soft-cap':
      return 'Daily limit reached';
    case 'cancelled':
      return 'Cancelled';
    case 'unknown':
      return 'Something went wrong';
  }
}
