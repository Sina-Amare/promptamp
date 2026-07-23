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
  DECLINE_SENTINEL,
  ENHANCE_PORT,
  type EnhanceServerMessage,
  type SafeError,
} from '../messaging/protocol';
import { sendMessage } from '../messaging/client';
import { t } from '../i18n';
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

  let port: ReturnType<typeof browser.runtime.connect> | null = null;
  let panel: PanelHandle | null = null;
  let skeletonTimer: ReturnType<typeof setTimeout> | undefined;
  let cleanupPosition: (() => void) | undefined;
  let stream: SmoothStream | null = null;
  // Raw text seen so far this run, so a decline (which begins with a bracket no
  // rewrite starts with) can be held back before it ever reaches the panel.
  let rawSoFar = '';
  // Diagnostic: logged once per run so a stuck enhancement is visible in the
  // page console — did it start, did tokens arrive, did it finish or error?
  let firstChunkSeen = false;
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
      // The user dragged the panel — their placement wins. Stop re-anchoring
      // it to the field, or the next scroll would snap it back.
      onDragStart: () => {
        cleanupPosition?.();
        cleanupPosition = undefined;
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
          // Fixed, so the coordinates are viewport-relative and unambiguous
          // even after showPopover() promotes the panel to the top layer.
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
          // Position with left/top, never transform: the panel is a top-layer
          // popover whose entrance animation animates `transform`, and the two
          // must not fight (that fight is what threw the panel to the top of the
          // page). With position:fixed these are viewport coordinates.
          Object.assign(panel.element.style, {
            left: `${String(Math.round(x))}px`,
            top: `${String(Math.round(y))}px`,
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
    rawSoFar = '';
    firstChunkSeen = false;
    console.info('[PromptAmp] enhance start', {
      origin: deps.origin,
      profileId: opts.profileId ?? 'auto',
      ...(opts.adjust ? { adjust: opts.adjust } : {}),
    });
    callbacks.onStateChange('loading');

    // Nothing visible for 300 ms — a sub-second response should never flash a
    // loading state.
    clearTimeout(skeletonTimer);
    skeletonTimer = setTimeout(() => {
      if (closed) return;
      ensurePanel().showLoading();
    }, SKELETON_DELAY_MS);

    try {
      port = browser.runtime.connect({ name: ENHANCE_PORT });
    } catch {
      // The extension was reloaded out from under this tab, so the runtime is
      // gone. Say so plainly instead of throwing into the page's console.
      clearTimeout(skeletonTimer);
      handleError({ kind: 'unknown', message: t('error.reloaded') });
      return;
    }

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
          if (!firstChunkSeen) {
            firstChunkSeen = true;
            console.info('[PromptAmp] streaming…');
          }
          rawSoFar += message.text;
          // Hold the reveal back only while the output could still be the
          // decline sentinel. A real rewrite never starts with its leading
          // bracket, so it diverges on the first character and streams with no
          // delay; only a decline is withheld, so it never flashes on screen.
          if (!stream && DECLINE_SENTINEL.startsWith(rawSoFar.trimStart())) {
            break;
          }
          const panelRef = ensurePanel();
          if (!stream) {
            panelRef.beginStreaming();
            stream = createSmoothStream((partial) => {
              panelRef.streamText(partial);
            });
            // Flush everything held so far, not just this delta.
            stream.push(rawSoFar);
          } else {
            stream.push(message.text);
          }
          break;
        }

        case 'reset':
          // A fallback connection is starting over. Drop the partial reveal
          // and go back to loading rather than splicing two answers.
          stream?.cancel();
          stream = null;
          rawSoFar = '';
          ensurePanel().showLoading();
          break;

        case 'done':
          clearTimeout(skeletonTimer);
          console.info(
            '[PromptAmp] done',
            message.result.declined
              ? 'declined'
              : `${String(message.result.text.length)} chars via ${message.result.model}`,
          );
          // Land on the exact final text — the smooth reveal may still be a
          // few characters behind the network when the stream ends.
          stream?.finish();
          stream = null;
          callbacks.onStateChange('idle');
          // Nothing to rewrite: a gentle note, the draft left untouched — never
          // a fabricated "I need help" prompt.
          if (message.result.declined) {
            ensurePanel().showDecline();
            break;
          }
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
          console.warn(
            '[PromptAmp] error',
            message.error.kind,
            message.error.message,
          );
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

    // No confirmation pill — user verdict: it read as noise. The button's done
    // flash is the acknowledgement, and tier-1 insertion keeps the host's own
    // Ctrl+Z working as the undo path.
    callbacks.onStateChange('done');
    close();
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
