import { ADJUST_PRESETS } from '../../enhance/assemble';
import type { SafeError } from '../../messaging/protocol';
import { type MessageKey, t } from '../../i18n';
import { el } from '../host';
import { CATEGORY_COLORS } from '../tokens';
import { computeDiff, isUnchanged, renderDiff } from './diff';
import {
  alertIcon,
  checkIcon,
  chevronDown,
  chevronEnd,
  chevronStart,
  closeIcon,
  copyIcon,
  globeIcon,
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

/** A profile as the chip menu needs it — just enough to list and pick. */
export interface ProfileOption {
  id: string;
  name: string;
  category: string;
}

export interface PanelCallbacks {
  onAccept: (text: string) => void;
  onRetry: (adjust?: string) => void;
  onCopy: (text: string) => void;
  onDiscard: () => void;
  onStop: () => void;
  /** A profile was chosen from the header chip — re-enhance in it, and pin it. */
  onProfilePick: (profileId: string) => void;
  /** An output language was chosen from the header chip. '' = same as draft. */
  onLanguagePick: (language: string) => void;
  /** The Structured chip — re-run the current draft as an engineered prompt. */
  onStructured: () => void;
  /** The user started dragging the panel — anchored positioning must let go. */
  onDragStart?: () => void;
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
  /** The draft held no request to rewrite: a gentle note, no Replace. */
  showDecline: () => void;
  showNotice: (message: string) => void;
  setProfile: (name: string, auto: boolean) => void;
  /** The list the profile chip menu offers, and which is current. */
  setProfileOptions: (profiles: ProfileOption[], currentId: string) => void;
  /** The current output-language override ('' = same as the draft). */
  setLanguage: (current: string) => void;
  focusTitle: () => void;
  currentText: () => string;
  destroy: () => void;
}

/**
 * The output-language choices the panel chip offers. A short curated list —
 * the settings page keeps the free-text field for anything exotic. Empty value
 * = keep the draft's own language.
 */
const PANEL_LANGUAGES: readonly { value: string; label: string }[] = [
  { value: '', label: 'Same as draft' },
  { value: 'English', label: 'English' },
  { value: 'Persian (فارسی)', label: 'Persian (فارسی)' },
  { value: 'Arabic', label: 'Arabic' },
  { value: 'Spanish', label: 'Spanish' },
  { value: 'French', label: 'French' },
  { value: 'German', label: 'German' },
  { value: 'Portuguese', label: 'Portuguese' },
  { value: 'Italian', label: 'Italian' },
  { value: 'Turkish', label: 'Turkish' },
  { value: 'Russian', label: 'Russian' },
  { value: 'Hindi', label: 'Hindi' },
  { value: 'Chinese (Simplified)', label: 'Chinese (Simplified)' },
  { value: 'Japanese', label: 'Japanese' },
  { value: 'Korean', label: 'Korean' },
];

/** UX-SPEC §2.2: regenerate branches, never overwrites. Three is the cap. */
const MAX_VERSIONS = 3;

export function createPanel(callbacks: PanelCallbacks): PanelHandle {
  const versions: PanelVersion[] = [];
  let index = 0;
  let original = '';
  let showDiff = false;
  let showOriginal = false;
  let destroyed = false;
  // Streaming render state: one Text node appended to incrementally, and a
  // throttle stamp for the auto-scroll (a per-frame scrollHeight read forces a
  // reflow every frame — the stutter on heavy host pages).
  let streamNode: Text | null = null;
  let lastAutoScroll = 0;

  // State the header chips + their menus read from.
  let profileOptions: ProfileOption[] = [];
  let currentProfileId = '';
  let currentAuto = true;
  let currentLanguage = '';

  /* ── chip menus (profile + language) ───────────────────────────── */

  interface MenuItem {
    value: string;
    label: string;
    current: boolean;
    /** Category dot colour, for the profile menu only. */
    dot?: string;
  }

  let menuEl: HTMLElement | null = null;
  let menuCleanup: (() => void) | null = null;

  function closeChipMenu(): void {
    if (!menuEl) return;
    menuCleanup?.();
    menuCleanup = null;
    menuEl.remove();
    menuEl = null;
  }

  /** Open the menu under `chipEl`, or close it if it is already this chip's. */
  function toggleMenu(
    chipEl: HTMLButtonElement,
    itemsFn: () => MenuItem[],
    onPick: (value: string) => void,
  ): void {
    const wasThis = chipEl.getAttribute('aria-expanded') === 'true';
    closeAllChips();
    if (wasThis) return;

    const items = itemsFn();
    const list = el('ul', {
      class: 'pa-chip-menu',
      attrs: { role: 'listbox', tabindex: '-1' },
    });

    const options: HTMLElement[] = items.map((item) => {
      const li = el('li', {
        attrs: {
          role: 'option',
          tabindex: '-1',
          'aria-selected': String(item.current),
          'aria-current': String(item.current),
        },
        children: [
          item.dot
            ? el('span', {
                class: 'pa-chip-dot',
                attrs: { style: `background:${item.dot}` },
              })
            : null,
          el('span', { text: item.label }),
        ].filter((n): n is HTMLElement => n !== null),
      });
      const choose = (): void => {
        closeChipMenu();
        chipEl.focus();
        onPick(item.value);
      };
      li.addEventListener('click', choose);
      li.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          choose();
        }
      });
      return li;
    });
    list.append(...options);

    // Roving focus with the arrows; Esc closes and returns to the chip.
    list.addEventListener('keydown', (event) => {
      const i = options.indexOf(deepActive() as HTMLElement);
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const delta = event.key === 'ArrowDown' ? 1 : -1;
        const next = options[(i + delta + options.length) % options.length];
        next?.focus();
      } else if (event.key === 'Home') {
        event.preventDefault();
        options[0]?.focus();
      } else if (event.key === 'End') {
        event.preventDefault();
        options[options.length - 1]?.focus();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeChipMenu();
        chipEl.focus();
      }
    });

    element.append(list);
    positionMenu(list, chipEl);
    chipEl.setAttribute('aria-expanded', 'true');
    menuEl = list;

    // Focus the current item so the keyboard lands somewhere sensible.
    const start = options.find((_, idx) => items[idx]?.current === true);
    (start ?? options[0])?.focus();

    // Dismiss on any pointer outside the menu or its chip.
    //
    // composedPath(), not event.target: this listener is on the top document,
    // and an event originating inside our shadow root is retargeted to the
    // shadow host by the time it arrives here — so `target` is never the menu,
    // and a naive contains() check would close the menu on its own clicks.
    const onOutside = (event: Event): void => {
      const path = event.composedPath();
      if (path.includes(list) || path.includes(chipEl)) return;
      closeChipMenu();
    };
    document.addEventListener('pointerdown', onOutside, true);
    menuCleanup = () => {
      document.removeEventListener('pointerdown', onOutside, true);
      chipEl.setAttribute('aria-expanded', 'false');
    };
  }

  /** Reset every chip's expanded state and tear down any open menu. */
  function closeAllChips(): void {
    closeChipMenu();
  }

  /**
   * Position the menu under its chip, clamped inside the panel. Absolute (not a
   * top-layer popover) so it works on every target browser; kept within the
   * panel's box so its `overflow: hidden` never clips it.
   */
  function positionMenu(list: HTMLElement, chipEl: HTMLElement): void {
    const panelRect = element.getBoundingClientRect();
    const chipRect = chipEl.getBoundingClientRect();

    const top = chipRect.bottom - panelRect.top + 4;
    const maxLeft = element.clientWidth - list.offsetWidth - 8;
    const left = Math.max(
      8,
      Math.min(chipRect.left - panelRect.left, Math.max(8, maxLeft)),
    );
    const maxHeight = element.clientHeight - top - 10;

    list.style.top = `${String(top)}px`;
    list.style.left = `${String(left)}px`;
    list.style.maxHeight = `${String(Math.max(120, maxHeight))}px`;
  }

  /** The profile chip label + auto/pinned suffix, from the current state. */
  function renderChip(): void {
    const name = profileOptions.find((p) => p.id === currentProfileId)?.name;
    chipLabel.textContent = name ?? prettifyId(currentProfileId);
    chipAuto.textContent = currentAuto
      ? t('panel.profileAuto')
      : t('panel.profilePinned');
  }

  /* ── header ────────────────────────────────────────────────────── */

  const titleId = 'pa-panel-title';
  const title = el('h2', {
    class: 'pa-title',
    text: t('panel.title'),
    // tabindex -1 so focus can land here on open without adding a tab stop.
    attrs: { id: titleId, tabindex: '-1' },
  });

  // Which style/profile ran, and a menu to switch it.
  const chipLabel = el('span', { text: 'General' });
  const chipAuto = el('span', {
    class: 'pa-chip-auto',
    text: t('panel.profileAuto'),
  });
  const chip = el('button', {
    class: 'pa-chip',
    attrs: {
      type: 'button',
      'aria-haspopup': 'listbox',
      'aria-expanded': 'false',
      'aria-label': t('panel.changeProfile'),
    },
    children: [chipLabel, chipAuto, chevronDown()],
  });
  chip.addEventListener('click', () => {
    toggleMenu(
      chip,
      () =>
        profileOptions.map((p) => {
          const dot = CATEGORY_COLORS[p.category];
          return {
            value: p.id,
            label: p.name,
            current: p.id === currentProfileId,
            ...(dot ? { dot } : {}),
          };
        }),
      (value) => callbacks.onProfilePick(value),
    );
  });

  // Which language the rewrite comes out in — here on the panel, so it can be
  // changed per enhancement without opening settings.
  const langLabel = el('span', { text: t('panel.langSame') });
  const langChip = el('button', {
    class: 'pa-chip',
    attrs: {
      type: 'button',
      'aria-haspopup': 'listbox',
      'aria-expanded': 'false',
      'aria-label': t('panel.changeLanguage'),
      title: t('panel.changeLanguage'),
    },
    children: [globeIcon(), langLabel, chevronDown()],
  });
  langChip.addEventListener('click', () => {
    toggleMenu(
      langChip,
      () =>
        PANEL_LANGUAGES.map((l) => ({
          value: l.value,
          label: l.label,
          current: l.value === currentLanguage,
        })),
      (value) => callbacks.onLanguagePick(value),
    );
  });

  const prevBtn = el('button', {
    attrs: { type: 'button', 'aria-label': t('panel.prevVersion') },
    children: [chevronStart()],
  });
  const nextBtn = el('button', {
    attrs: { type: 'button', 'aria-label': t('panel.nextVersion') },
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
    attrs: { type: 'button', 'aria-label': t('panel.discard') },
    children: [closeIcon()],
  });
  closeBtn.addEventListener('click', callbacks.onDiscard);

  const head = el('div', {
    class: 'pa-head',
    children: [title, chip, langChip, carousel, closeBtn],
  });

  // The header is a drag handle: wherever the anchored placement lands on an
  // odd composer, the user can simply put the panel where they want it. Once
  // they do, onDragStart tells the session to stop re-anchoring it.
  head.addEventListener('pointerdown', (event) => {
    // Chips, arrows, and Close keep their own behaviour.
    if ((event.target as Element).closest('button, [role="listbox"]')) return;
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const rect = element.getBoundingClientRect();
    let moved = false;

    const onMove = (ev: PointerEvent): void => {
      if (!moved && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 3) {
        return; // a sloppy click is not a drag
      }
      if (!moved) {
        moved = true;
        callbacks.onDragStart?.();
        element.setAttribute('data-dragging', 'true');
      }
      const width = rect.width;
      const height = rect.height;
      const left = Math.min(
        Math.max(8, rect.left + ev.clientX - startX),
        window.innerWidth - width - 8,
      );
      const top = Math.min(
        Math.max(8, rect.top + ev.clientY - startY),
        window.innerHeight - height - 8,
      );
      element.style.left = `${String(Math.round(left))}px`;
      element.style.top = `${String(Math.round(top))}px`;
    };
    const onUp = (): void => {
      element.removeAttribute('data-dragging');
      head.removeEventListener('pointermove', onMove);
      head.removeEventListener('pointerup', onUp);
      head.removeEventListener('pointercancel', onUp);
    };
    head.setPointerCapture(event.pointerId);
    head.addEventListener('pointermove', onMove);
    head.addEventListener('pointerup', onUp);
    head.addEventListener('pointercancel', onUp);
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
      'aria-label': t('panel.bodyAria'),
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
    text: t('panel.showChanges'),
  });
  const originalPill = el('button', {
    class: 'pa-pill',
    attrs: { type: 'button', 'aria-pressed': 'false' },
    text: t('panel.showOriginal'),
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
      placeholder: t('panel.adjustPlaceholder'),
      'aria-label': t('panel.adjustAria'),
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

  // Turns the current draft into a fully structured, engineered prompt — a
  // different *shape* of output than the light rewrite, so it sits a little
  // apart from the Shorter/Longer tweaks and carries the amber accent.
  const structuredPill = el('button', {
    class: 'pa-pill pa-pill-structured',
    attrs: { type: 'button', title: t('panel.structuredHint') },
    text: t('panel.structured'),
  });
  structuredPill.addEventListener('click', () => {
    callbacks.onStructured();
  });

  const adjustRow = el('div', {
    class: 'pa-row',
    children: [
      structuredPill,
      ...ADJUST_PRESETS.map((preset) => {
        const pill = el('button', {
          class: 'pa-pill',
          attrs: { type: 'button' },
          text: t(preset.labelKey),
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
    text: t('panel.accept'),
  });
  const retryBtn = el('button', {
    class: 'pa-secondary',
    attrs: { type: 'button' },
    text: t('panel.retry'),
  });
  const copyBtn = el('button', {
    class: 'pa-secondary',
    attrs: { type: 'button', 'aria-label': t('panel.copy') },
    children: [copyIcon()],
  });
  const discardBtn = el('button', {
    class: 'pa-quiet',
    attrs: { type: 'button' },
    text: t('panel.discard'),
  });

  acceptBtn.addEventListener('click', () => {
    callbacks.onAccept(currentText());
  });
  retryBtn.addEventListener('click', () => {
    callbacks.onRetry();
  });
  let copiedTimer: ReturnType<typeof setTimeout> | undefined;
  copyBtn.addEventListener('click', () => {
    callbacks.onCopy(currentText());
    // Visible + announced confirmation — an icon-only button that does nothing
    // observable reads as broken.
    clearTimeout(copiedTimer);
    copyBtn.replaceChildren(checkIcon());
    copyBtn.setAttribute('aria-label', t('panel.copied'));
    status.textContent = t('panel.copied');
    copiedTimer = setTimeout(() => {
      copyBtn.replaceChildren(copyIcon());
      copyBtn.setAttribute('aria-label', t('panel.copy'));
    }, 1200);
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

  /* ── isolation ─────────────────────────────────────────────────── */

  // Everything typed belongs to the panel, not the page. Our inputs — the
  // editable body and the "describe a change" field — live in a shadow root,
  // and keyboard/input/clipboard events are composed:true, so without this they
  // bubble out to the host, whose chat composer (ProseMirror/Lexical) treats
  // them as typing and writes them into the user's message box. Stopping at the
  // panel root leaves every inner handler intact (they fire first, on the way
  // up) — only the escape to the page is cut.
  for (const type of [
    'keydown',
    'keyup',
    'keypress',
    'input',
    'beforeinput',
    'paste',
    'cut',
  ] as const) {
    element.addEventListener(type, (event) => {
      event.stopPropagation();
    });
  }

  /* ── keyboard map (§6) ─────────────────────────────────────────── */

  element.addEventListener('keydown', (event) => {
    const meta = event.ctrlKey || event.metaKey;

    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      // A chip menu takes priority — close it, don't discard the whole panel.
      if (menuEl) {
        closeChipMenu();
        return;
      }
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
      // A steady reading frame while we wait and stream: the panel holds this
      // height instead of growing line by line, so it never re-triggers the
      // position update and never stutters. Cleared the moment a result lands.
      element.setAttribute('data-streaming', 'true');
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
        el('p', { class: 'pa-status', text: t('panel.busy') }),
      );
      status.textContent = t('panel.busy');
      setControlsEnabled(false);
    },

    beginStreaming: () => {
      // The reserved streaming height (set here too, since a fast first chunk
      // can arrive before showLoading ran) keeps the frame still as text fills.
      element.setAttribute('data-streaming', 'true');
      // Height was already reserved by the skeleton, so replacing it with text
      // causes no layout shift — the words simply appear where the shimmer was.
      streamNode = document.createTextNode('');
      lastAutoScroll = 0;
      bodyWrap.replaceChildren(body);
      body.replaceChildren(streamNode);
      body.setAttribute('contenteditable', 'false');
      status.textContent = t('panel.busy');
    },

    streamText: (partial) => {
      // Append-only into one Text node. Replacing the whole text every frame
      // and reading scrollHeight per frame forces a full layout + reflow 60×
      // a second — on heavy host pages (ChatGPT, Claude) that is visible
      // stutter. appendData is incremental, and the scroll write is throttled.
      if (!streamNode) return;
      const have = streamNode.data.length;
      if (partial.length >= have && partial.startsWith(streamNode.data)) {
        streamNode.appendData(partial.slice(have));
      } else {
        streamNode.data = partial; // reset (fallback started over)
      }
      const now = performance.now();
      if (now - lastAutoScroll > 150) {
        lastAutoScroll = now;
        bodyWrap.scrollTop = bodyWrap.scrollHeight;
      }
    },

    showResult: (text, source) => {
      try {
        // Release the reserved height: the panel now fits the final text.
        element.removeAttribute('data-streaming');
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
          ? t('panel.unchanged')
          : t('panel.ready');
        setControlsEnabled(true);
      } finally {
        // In a finally block on purpose: leaving aria-busy set permanently
        // silences the live region for the rest of the session.
        setBusy(false);
      }
    },

    showError: (error) => {
      try {
        element.removeAttribute('data-streaming');
        const retry = el('button', {
          class: 'pa-secondary',
          attrs: { type: 'button' },
          text: error.retryAfterSec
            ? t('error.retryIn', { seconds: error.retryAfterSec })
            : 'Retry',
        });
        retry.addEventListener('click', () => {
          callbacks.onRetry();
        });

        const dismiss = el('button', {
          class: 'pa-quiet',
          attrs: { type: 'button' },
          text: t('panel.close'),
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
              // What each connection said, when several were tried. Collapsing
              // three different failures into the last one's message sends the
              // user to fix the wrong thing.
              error.attempts && error.attempts.length > 1
                ? el('ul', {
                    class: 'pa-attempts',
                    children: error.attempts.map((attempt) =>
                      el('li', {
                        children: [
                          el('span', {
                            class: 'pa-attempt-label',
                            text: attempt.label,
                          }),
                          el('span', { text: attempt.message }),
                        ],
                      }),
                    ),
                  })
                : null,
              // The fix, not just the diagnosis.
              error.remedy
                ? el('p', { class: 'pa-remedy', text: error.remedy })
                : null,
              el('p', {
                class: 'pa-status',
                text: t('error.draftSafe'),
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

    showDecline: () => {
      try {
        element.removeAttribute('data-streaming');
        const dismiss = el('button', {
          class: 'pa-secondary',
          attrs: { type: 'button' },
          text: t('panel.close'),
        });
        dismiss.addEventListener('click', callbacks.onDiscard);

        bodyWrap.replaceChildren(
          el('div', {
            class: 'pa-decline',
            // role=status, not alert: this is calm guidance, not a failure.
            attrs: { role: 'status' },
            children: [
              el('div', {
                class: 'pa-decline-title',
                text: t('panel.declineTitle'),
              }),
              el('p', { text: t('panel.declineBody') }),
              el('div', {
                class: 'pa-error-actions',
                children: [dismiss],
              }),
            ],
          }),
        );
        dismiss.focus();
        // No Replace and no Retry: there is nothing to insert, and re-running
        // the same non-prompt would only decline again.
        setControlsEnabled(false);
      } finally {
        setBusy(false);
      }
    },

    showNotice: showNoticeInternal,

    setProfile: (profileId, auto) => {
      currentProfileId = profileId;
      currentAuto = auto;
      renderChip();
    },

    setProfileOptions: (profiles, currentId) => {
      profileOptions = profiles;
      if (currentId) currentProfileId = currentId;
      renderChip();
    },

    setLanguage: (current) => {
      currentLanguage = current;
      langLabel.textContent = current || t('panel.langSame');
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
      closeChipMenu();
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

/** Fallback display name before the profile list has loaded: "general" → "General". */
function prettifyId(id: string): string {
  return id ? id.charAt(0).toUpperCase() + id.slice(1) : '';
}

/**
 * Cause-class names, so the user knows whether retrying can possibly help.
 *
 * A `Record` rather than a switch: exhaustiveness is then enforced by the type
 * rather than by remembering to add a case, which is how `bad-model` came to
 * be missing here in the first place.
 */
const ERROR_TITLES: Record<SafeError['kind'], MessageKey> = {
  'bad-key': 'error.badKey',
  'bad-model': 'error.badModel',
  'rate-limited': 'error.rateLimited',
  quota: 'error.quota',
  network: 'error.network',
  refusal: 'error.refusal',
  'too-long': 'error.tooLong',
  'soft-cap': 'error.softCap',
  cancelled: 'error.cancelled',
  unknown: 'error.unknown',
};

function titleFor(error: SafeError): string {
  return t(ERROR_TITLES[error.kind]);
}
