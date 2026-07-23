import {
  computePosition,
  autoUpdate,
  flip,
  offset,
  shift,
} from '@floating-ui/dom';
import { browser } from '#imports';
import { insertText } from '../insertion/engine';
import { readValue } from '../insertion/detect';
import {
  takeSnapshot,
  restoreField,
  type FieldSnapshot,
} from '../insertion/snapshot';
import {
  ENHANCE_PORT,
  type EnhanceServerMessage,
  type SafeError,
} from '../messaging/protocol';
import { sendMessage } from '../messaging/client';
import { t } from '../i18n';
import { el } from './host';
import { createPanel, type PanelHandle } from './panel';
import { createSmoothStream, type SmoothStream } from './panel/stream';

/**
 * One enhancement, from button press to accepted insertion.
 *
 * Owns the latency script (UX-SPEC §2.3), which is mostly about *not* showing
 * things: the button acknowledges at 0 ms, nothing else appears for 300 ms so
 * a fast response never flashes a skeleton, and only then does the panel open
 * at a reserved height.
 */

/** Below this a response is fast enough that showing a skeleton is noise. */
const SKELETON_DELAY_MS = 300;

/** Gmail-style transient. Long enough to notice, short enough not to linger. */
const UNDO_WINDOW_MS = 10_000;

export interface SessionCallbacks {
  onStateChange: (state: 'loading' | 'idle' | 'done' | 'error') => void;
  onClosed: () => void;
}

export interface SessionDeps {
  field: HTMLElement;
  layer: HTMLElement;
  origin: string;
  mainWorldInsert: (text: string) => Promise<boolean>;
}

export interface EnhanceSession {
  start: (adjust?: string) => void;
  stop: () => void;
  close: () => void;
}

export function createSession(
  deps: SessionDeps,
  callbacks: SessionCallbacks,
): EnhanceSession {
  const draft = readValue(deps.field);
  // Captured before anything happens, so "Restore original" and the Undo pill
  // can put back exactly what the user had — directional marks included.
  const snapshot: FieldSnapshot = takeSnapshot(deps.field);

  let port: ReturnType<typeof browser.runtime.connect> | null = null;
  let panel: PanelHandle | null = null;
  let skeletonTimer: ReturnType<typeof setTimeout> | undefined;
  let cleanupPosition: (() => void) | undefined;
  let stream: SmoothStream | null = null;
  let closed = false;
  let chipsLoaded = false;
  // The Structured chip is a one-off transform, not a profile change — so its
  // run must leave the profile chip showing the site's persistent profile,
  // exactly like the Shorter/Longer adjust chips do.
  let structuredOneOff = false;

  /**
   * Populate the panel's profile + language chips. One round trip, once — the
   * chips fall back to the `accepted` echo if this races or fails, so a slow
   * worker just means an empty menu for a moment, never a broken panel.
   */
  function loadChips(target: PanelHandle): void {
    if (chipsLoaded) return;
    chipsLoaded = true;
    void (async () => {
      try {
        const [profiles, settings] = await Promise.all([
          sendMessage({ type: 'profiles:list' }),
          sendMessage({ type: 'settings:get' }),
        ]);
        target.setProfileOptions(
          profiles.map((p) => ({
            id: p.id,
            name: p.name,
            category: p.category,
          })),
          '',
        );
        target.setLanguage(settings.outputLanguageOverride);
      } catch {
        // Best effort; the chips still work off the accepted echo.
      }
    })();
  }

  function ensurePanel(): PanelHandle {
    if (panel) return panel;

    panel = createPanel({
      onAccept: (text) => {
        void accept(text);
      },
      onRetry: (adjust) => {
        run(adjust ? { adjust } : {});
      },
      onCopy: (text) => {
        void navigator.clipboard.writeText(text);
      },
      onDiscard: close,
      onStop: stop,
      // A profile chosen from the chip: pin it for this site (so it sticks) and
      // re-run in it now. `profileId` on the run wins the race against the pin.
      onProfilePick: (profileId) => {
        void (async () => {
          try {
            await sendMessage({
              type: 'siteRule:patch',
              origin: deps.origin,
              patch: { pinnedProfileId: profileId },
            });
          } catch {
            // The run below still uses profileId; the pin is only persistence.
          }
          run({ profileId });
        })();
      },
      // Output language chosen from the chip: persist it (so it is remembered)
      // and re-run — the worker reads the setting fresh each run.
      onLanguagePick: (language) => {
        void (async () => {
          try {
            await sendMessage({
              type: 'settings:patch',
              patch: { outputLanguageOverride: language },
            });
          } catch {
            // ignore — a failed patch just means the language did not change
          }
          panel?.setLanguage(language);
          run({});
        })();
      },
      // One-off: structure the current draft without changing the site default.
      onStructured: () => {
        structuredOneOff = true;
        run({ profileId: 'structured' });
      },
    });

    loadChips(panel);
    deps.layer.append(panel.element);

    if ('showPopover' in panel.element) {
      try {
        (
          panel.element as HTMLElement & { showPopover: () => void }
        ).showPopover();
      } catch {
        // Already shown, or popover unsupported — the z-index fallback in the
        // stylesheet covers the latter.
      }
    }

    // Above the field by preference: chat composers sit at the viewport
    // bottom, and below would flow off-screen.
    cleanupPosition = autoUpdate(
      deps.field,
      panel.element,
      () => {
        if (!panel) return;
        void computePosition(deps.field, panel.element, {
          placement: 'top',
          // Fixed, to match the top-layer button layer this sits inside —
          // every coordinate in the injected UI is viewport-relative.
          strategy: 'fixed',
          middleware: [
            // A real gap from the composer — 10px read as touching it.
            offset(14),
            // Flip to whichever side has more room, not just the opposite one,
            // so a composer with little space above does not shove the panel
            // half over itself.
            flip({ fallbackAxisSideDirection: 'end' }),
            shift({ padding: 8 }),
          ],
        }).then(({ x, y }) => {
          if (!panel) return;
          Object.assign(panel.element.style, {
            transform: `translate3d(${String(x)}px, ${String(y)}px, 0)`,
          });
        });
      },
      // Per-frame updates are exactly the CPU problem the budget forbids.
      { animationFrame: false },
    );

    panel.focusTitle();
    return panel;
  }

  interface RunOptions {
    /** Free-text or preset adjustment for a regenerate. */
    adjust?: string;
    /** Force a specific profile for this run (chip pick, or the Structured chip). */
    profileId?: string;
  }

  function run(opts: RunOptions = {}): void {
    if (closed) return;
    stopPort();
    callbacks.onStateChange('loading');

    // Nothing visible for 300 ms — a sub-second response should never flash a
    // loading state.
    clearTimeout(skeletonTimer);
    skeletonTimer = setTimeout(() => {
      if (closed) return;
      ensurePanel().showLoading();
    }, SKELETON_DELAY_MS);

    port = browser.runtime.connect({ name: ENHANCE_PORT });

    port.onMessage.addListener((raw: unknown) => {
      const message = raw as EnhanceServerMessage;

      switch (message.type) {
        case 'accepted':
          // Keep the chip on the persistent profile for a Structured one-off.
          if (structuredOneOff) {
            structuredOneOff = false;
          } else {
            ensurePanel().setProfile(message.profileId, message.auto);
          }
          break;

        case 'chunk': {
          // First delta wins the race against the skeleton timer: if the
          // model answered fast, the user never sees a loading state at all.
          clearTimeout(skeletonTimer);
          const panelRef = ensurePanel();
          if (!stream) {
            panelRef.beginStreaming();
            stream = createSmoothStream((partial) => {
              panelRef.streamText(partial);
            });
          }
          stream.push(message.text);
          break;
        }

        case 'reset':
          // A fallback connection is starting over. Drop the partial reveal
          // and go back to loading rather than splicing two answers.
          stream?.cancel();
          stream = null;
          ensurePanel().showLoading();
          break;

        case 'done':
          clearTimeout(skeletonTimer);
          // Land on the exact final text — the smooth reveal may still be a
          // few characters behind the network when the stream ends.
          stream?.finish();
          stream = null;
          callbacks.onStateChange('idle');
          ensurePanel().showResult(message.result.text, draft);
          // A silent switch would hide both that a key needs attention and
          // that a different model wrote this.
          if (message.result.fellBackFrom) {
            ensurePanel().showNotice(
              t('error.fellBack', {
                failed: message.result.fellBackFrom.label,
                used: message.result.connectionLabel,
              }),
            );
          }
          break;

        case 'error':
          clearTimeout(skeletonTimer);
          stream?.cancel();
          stream = null;
          handleError(message.error);
          break;
      }
    });

    port.onDisconnect.addListener(() => {
      port = null;
    });

    port.postMessage({
      type: 'start',
      draft,
      origin: deps.origin,
      ...(opts.adjust ? { adjust: opts.adjust } : {}),
      ...(opts.profileId ? { profileId: opts.profileId } : {}),
    });
  }

  function handleError(error: SafeError): void {
    if (error.kind === 'cancelled') {
      close();
      return;
    }
    callbacks.onStateChange('error');
    // The panel may never have opened (a fast failure), so open it to carry
    // the message — errors are never page-level toasts.
    ensurePanel().showError(error);
  }

  async function accept(text: string): Promise<void> {
    const outcome = await insertText(deps.field, text, {
      mainWorldInsert: deps.mainWorldInsert,
    });

    if (!outcome.ok) {
      ensurePanel().showError({
        kind: 'unknown',
        message: t('error.noInsert'),
      });
      return;
    }

    if (outcome.clipboardFallback) {
      ensurePanel().showNotice(t('error.copiedInstead'));
      return;
    }

    callbacks.onStateChange('done');
    showUndoPill();
    close();
  }

  /**
   * Belt and braces on top of the host's native Ctrl+Z, which tier 1 preserves.
   * A user who has just watched their draft get replaced should not have to
   * know which undo stack they are in.
   */
  function showUndoPill(): void {
    const announce = el('span', {
      class: 'pa-sr-only',
      attrs: { role: 'status', 'aria-live': 'polite' },
      text: t('undo.announce'),
    });

    const undo = el('button', {
      attrs: { type: 'button' },
      text: t('undo.action'),
    });
    const pill = el('div', {
      class: 'pa-undo',
      children: [el('span', { text: t('undo.replaced') }), undo, announce],
    });

    // Viewport coordinates: getBoundingClientRect already returns them, and
    // the layer this sits in is fixed.
    const box = deps.field.getBoundingClientRect();
    pill.style.transform = `translate3d(${String(box.left)}px, ${String(
      box.bottom + 8,
    )}px, 0)`;

    deps.layer.append(pill);

    const dismiss = (): void => {
      clearTimeout(timer);
      pill.remove();
    };
    const timer = setTimeout(dismiss, UNDO_WINDOW_MS);

    undo.addEventListener('click', () => {
      restoreField(deps.field, snapshot);
      deps.field.focus();
      dismiss();
    });
  }

  function stopPort(): void {
    clearTimeout(skeletonTimer);
    port?.disconnect();
    port = null;
  }

  function stop(): void {
    stopPort();
    callbacks.onStateChange('idle');
  }

  function close(): void {
    if (closed) return;
    closed = true;
    stream?.cancel();
    stream = null;
    stopPort();
    cleanupPosition?.();
    panel?.destroy();
    panel = null;
    // Focus returns to the field with its selection intact — the panel is not
    // a place to be stranded.
    deps.field.focus();
    callbacks.onClosed();
  }

  return {
    // The public entry point is a thin wrapper over `run`, which also handles
    // the internal profile/language/structured re-runs.
    start: (adjust?: string) => {
      run(adjust ? { adjust } : {});
    },
    stop,
    close,
  };
}
