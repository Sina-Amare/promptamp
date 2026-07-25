import { browser, defineContentScript } from '#imports';
import { sendMessage } from '../lib/messaging/client';
import {
  SITE_SUPPRESSION_CHANGED,
  TRIGGER_ENHANCE,
} from '../lib/messaging/protocol';
import {
  readValue,
  resolveEditorTarget,
  visualEditorRoot,
} from '../lib/insertion/detect';
import { requestMainWorldEditor } from '../lib/insertion/bridge';
import { createButton, type ButtonHandle } from '../lib/ui/button';
import { BUTTON_CSS } from '../lib/ui/button/styles';
import {
  CALLOUT_CSS,
  createCallout,
  type CalloutHandle,
} from '../lib/ui/callout';
import { createShadowHost, el } from '../lib/ui/host';
import { PANEL_CSS } from '../lib/ui/panel/styles';
import { createSession, type EnhanceSession } from '../lib/ui/session';
import { createFieldTracker } from '../lib/ui/tracker';
import { composerShell } from '../lib/ui/position';
import {
  findCompatibilityComposer,
  needsCompatibilityReacquisition,
} from '../lib/ui/compatibility';
import type { ButtonCorner } from '../lib/storage/schemas';
import { closestComposed } from '../lib/dom/composed';

/**
 * The injected surface.
 *
 * This script never sees an API key and never makes a network call — ESLint
 * enforces that it cannot even import the credential or provider modules
 * (principle 2). Everything that needs a key goes through the worker.
 */

export default defineContentScript({
  matches: ['<all_urls>'],
  // document_end, not idle: heavy SPAs (Claude, ChatGPT) can hold idle back
  // for seconds, and the button popping in mid-typing reads as broken.
  runAt: 'document_end',
  // Frames get their own instance; a composer inside an iframe is still a
  // composer, and skipping them would miss Gmail and most embedded editors.
  allFrames: true,

  async main(ctx) {
    // The one unconditional log: which build this tab is actually running.
    // Reload-the-extension-but-not-the-tab is the most common "the fix didn't
    // work" false alarm, and this line settles it in one glance.
    console.info(
      `[PromptAmp] v${browser.runtime.getManifest().version} loaded`,
    );

    // Suppression is resolved *before* anything is added to the DOM. A hidden
    // site must be hidden with certainty, not hidden-then-removed: a broken
    // off switch is the fastest way to lose a user's trust.
    const suppression = await resolveSuppression();
    if (suppression.suppressed) return;
    const siteOrigin = suppression.origin;

    let sessionHidden = false;
    let siteHidden = false;
    let destroyed = false;

    const host = createShadowHost({
      themeAnchor: document.body,
      onHostile: () => {
        // Three removals in ten seconds: the site is actively fighting us.
        // Re-attaching forever would burn CPU and still lose.
        teardown();
      },
    });

    const sheet = new CSSStyleSheet();
    sheet.replaceSync(`${BUTTON_CSS}\n${PANEL_CSS}\n${CALLOUT_CSS}`);
    host.root.adoptedStyleSheets = [...host.root.adoptedStyleSheets, sheet];

    const layer = el('div', { class: 'pa-button-layer' });
    host.root.append(layer);

    const supportsPopover = 'popover' in layer;
    if (supportsPopover) layer.setAttribute('popover', 'manual');

    /**
     * Promote the layer into the browser top layer.
     *
     * Order within the top layer is promotion order, so a modal <dialog>
     * opened *after* us stacks above us — the button renders but every click
     * is intercepted, and the dialog makes the rest of the document inert
     * besides. Re-promoting on each attach puts us back on top, which is
     * exactly what UX-SPEC §4 prescribes for this case.
     */
    function promoteLayer(): void {
      if (!supportsPopover) return;
      const popover = layer as HTMLElement & {
        showPopover: () => void;
        hidePopover: () => void;
      };
      try {
        if (layer.matches(':popover-open')) popover.hidePopover();
        popover.showPopover();
      } catch {
        // Unsupported or mid-transition; the z-index fallback still applies.
      }
    }

    /**
     * A modal `<dialog>` makes every subtree except its own inert, and being in
     * the top layer does not exempt us — the button renders and every click is
     * swallowed. Re-parenting the host inside the dialog is the only way to
     * land in the one non-inert subtree.
     *
     * This adds our own node next to the dialog's content; it never touches
     * the field or anything the page authored, so principle 5 still holds.
     */
    function reparentForModal(field: Element): void {
      const dialog = closestComposed(field, 'dialog');
      const target =
        dialog && dialog.hasAttribute('open') && dialog.matches(':modal')
          ? dialog
          : document.body;
      if (host.element.parentElement !== target) {
        target.append(host.element);
        promoteLayer();
      }
    }

    promoteLayer();

    let button: ButtonHandle | null = null;
    let session: EnhanceSession | null = null;
    let currentCorner: ButtonCorner | null = null;
    let callout: CalloutHandle | null = null;
    // The one-time first-run onboarding (§4): shown on the first qualifying
    // focus ever, globally. Flip it off the instant it shows so it never repeats
    // even before the persisted flag round-trips.
    let firstRunPending = !suppression.firstRunDone;

    let beginEpoch = 0;
    async function beginEnhance(field: HTMLElement): Promise<void> {
      const epoch = ++beginEpoch;
      session?.close();
      button?.setState('loading');
      const target = resolveEditorTarget(field);
      const isModelEditor =
        target.kind === 'monaco' || target.kind === 'codemirror';
      const modelRead = isModelEditor
        ? await requestMainWorldEditor('read')
        : null;
      if (
        epoch !== beginEpoch ||
        tracker.current() !== field ||
        !field.isConnected
      ) {
        return;
      }
      const draft =
        modelRead?.ok && typeof modelRead.value === 'string'
          ? modelRead.value
          : readValue(field);
      session = createSession(
        {
          field,
          layer,
          origin: siteOrigin,
          draft,
          ...(isModelEditor
            ? {
                mainWorldEditor: {
                  read: () => requestMainWorldEditor('read'),
                  replace: (text: string) =>
                    requestMainWorldEditor('replace', text),
                },
              }
            : {}),
        },
        {
          onStateChange: (state) => {
            if (state === 'loading') button?.setState('loading');
            else if (state === 'error') button?.setState('error');
            else if (state === 'done') button?.setState('done');
            else button?.setState('idle');
          },
          onClosed: () => {
            session = null;
            if (button?.getState() === 'loading') button.setState('idle');
          },
        },
      );
      session.start();
    }

    // The user's dragged spot for this site, live-updated on drop so the fix
    // applies instantly; persisted so it survives reloads.
    let pin = suppression.pin;
    let manualDrag = false;
    // One visual rule everywhere: the complete target docks just outside the
    // composer. It cannot cover typed text or compete with the host's action
    // row, and the same affordance now reads consistently on every AI site.
    const placementMode = 'external' as const;
    const compatibilityReacquisition = needsCompatibilityReacquisition(
      location.hostname,
      location.pathname,
    );

    const tracker = createFieldTracker(
      {
        onAttach: (field) => {
          // A preview belongs to the composer that produced it. Switching
          // fields closes the old session without pulling focus back from the
          // newly selected composer.
          session?.close({ restoreFocus: false });
          // The field may live inside a modal dialog opened after us.
          reparentForModal(field.element);
          button?.destroy();
          button = createButton({
            onActivate: () => {
              void beginEnhance(field.element);
            },
            onStop: () => session?.stop(),
            canResetPosition: () => pin !== null,
            onResetPosition: () => {
              pin = null;
              tracker.reposition();
              void sendMessage({
                type: 'siteRule:patch',
                origin: siteOrigin,
                patch: { buttonPin: null },
              }).catch(() => undefined);
            },
            onDismiss: (choice) => {
              void handleDismiss(choice);
            },
            // Drag-to-place: store the drop as an offset from the field's
            // composer shell (not its potentially oversized/scrolling
            // editable), remember it for this site, and use it immediately.
            onDragStart: () => {
              manualDrag = true;
            },
            onDragEnd: (point) => {
              manualDrag = false;
              const visualField = visualEditorRoot(field.element);
              const box = composerShell(
                visualField,
                visualField.getBoundingClientRect(),
              ).getBoundingClientRect();
              pin = {
                dx: Math.round(point.left - box.right),
                dy: Math.round(point.top - box.bottom),
              };
              tracker.reposition();
              void sendMessage({
                type: 'siteRule:patch',
                origin: siteOrigin,
                patch: { buttonPin: pin },
              }).catch(() => undefined);
            },
            onDragCancel: () => {
              manualDrag = false;
              tracker.reposition();
            },
          });
          layer.append(button.wrap);

          // First-run onboarding (§4): shown once, globally, on the first
          // qualifying focus. Flip the flag and persist immediately so it never
          // repeats even before the write round-trips. Anchored to the disc; no
          // focus steal — the user just clicked into their field.
          if (firstRunPending) {
            firstRunPending = false;
            void sendMessage({
              type: 'settings:patch',
              patch: { firstRunDone: true },
            }).catch(() => undefined);
            callout = createCallout({
              onGotIt: () => {
                callout?.destroy();
                callout = null;
              },
              onHideSite: () => {
                callout?.destroy();
                callout = null;
                void handleDismiss('site');
              },
            });
            button.wrap.append(callout.element);
          }
        },
        onDetach: () => {
          callout?.destroy();
          callout = null;
          button?.destroy();
          button = null;
        },
        onMove: (
          point,
          corner,
          instant = false,
          visible = true,
          slot = 'inside',
          retirePin = false,
        ) => {
          currentCorner = corner;
          // A dragged pin is the user's explicit choice, so keep it even when
          // the engine reprojects it off a control this frame — it snaps back
          // once the control clears. Forget it ONLY when the engine reports it
          // structurally stale: an inside-era coordinate or a page corner far
          // from the composer. Deleting on any transient miss was the "I drag
          // the disc and it won't stick" bug.
          if (pin && retirePin) {
            pin = null;
            void sendMessage({
              type: 'siteRule:patch',
              origin: siteOrigin,
              patch: { buttonPin: null },
            }).catch(() => undefined);
          }
          if (!button) return;
          button.setPlacement(slot);
          button.wrap.hidden = !visible;
          if (!visible) return;
          button.wrap.setAttribute('data-gliding', String(instant));
          // transform, not top/left: this runs on every scroll frame and must
          // stay on the compositor.
          button.wrap.style.transform = `translate3d(${String(point.left)}px, ${String(point.top)}px, 0)`;
          if (button.wrap.getAttribute('data-positioned') !== 'true') {
            requestAnimationFrame(() => {
              button?.wrap.setAttribute('data-positioned', 'true');
            });
          }
        },
        onDraftChange: (_draft, enhanceable) => {
          if (!button) return;
          if (button.getState() === 'loading') return;
          button.setState(enhanceable ? 'idle' : 'ghost');
        },
        onTypingChange: (typing) => {
          if (!button) return;
          const state = button.getState();
          if (state === 'loading' || state === 'error') return;
          if (typing) button.setState('typing');
        },
        onFieldTab: () => {
          // Puts the button immediately after the field in tab order, which
          // DOM position cannot do — the host lives at the end of <body>.
          if (!button) return false;
          button.focus();
          return true;
        },
      },
      {
        buttonSize: 40,
        isOwnNode: (node) =>
          node === host.element || node.getRootNode() === host.root,
        preferredCorner: () => suppression.corner,
        pinnedOffset: () => pin,
        isPlacementLocked: () => manualDrag,
        placementMode: () => placementMode,
        ...(compatibilityReacquisition
          ? {
              fallbackField: () =>
                findCompatibilityComposer(
                  document,
                  (node) =>
                    node === host.element || node.getRootNode() === host.root,
                ),
            }
          : {}),
        isSuppressed: () => sessionHidden || siteHidden,
      },
    );

    tracker.start();

    // When the extension is reloaded or updated, tabs opened beforehand keep
    // running this now-orphaned script. Its observers would linger and its next
    // call into the dead runtime would throw "Extension context invalidated" in
    // the page console. Tear down instead: remove the surface, stop watching.
    ctx.onInvalidated(() => {
      try {
        teardown();
      } catch {
        // The runtime is already gone — there is nothing left to clean up.
      }
    });

    /**
     * Alt+E and the context menu both arrive here from the worker, which has no
     * DOM of its own. A keyboard-invoked panel opens with no entrance
     * animation — animating a high-frequency keyboard action reads as lag.
     */
    browser.runtime.onMessage.addListener((message: unknown) => {
      if (
        typeof message === 'object' &&
        message !== null &&
        (message as { type?: unknown }).type === SITE_SUPPRESSION_CHANGED &&
        (message as { origin?: unknown }).origin === siteOrigin
      ) {
        siteHidden = true;
        teardown();
        return;
      }
      if (
        typeof message !== 'object' ||
        message === null ||
        (message as { type?: unknown }).type !== TRIGGER_ENHANCE
      ) {
        return;
      }
      const field = tracker.current();
      if (!field) return;
      button?.setInstant(true);
      void beginEnhance(field);
    });

    async function handleDismiss(
      choice: 'session' | 'site' | 'everywhere',
    ): Promise<void> {
      if (choice === 'session') {
        sessionHidden = true;
        teardown();
        return;
      }
      if (choice === 'site') {
        siteHidden = true;
        // The click is authoritative even if the worker is waking up: remove
        // this surface first, then persist and fan the decision out to every
        // frame in the tab.
        teardown();
        void sendMessage({
          type: 'siteRule:patch',
          origin: siteOrigin,
          patch: { hidden: true },
        }).catch(() => undefined);
        return;
      }
      await sendMessage({
        type: 'settings:patch',
        patch: { globallyHidden: true },
      });
      teardown();
    }

    function teardown(): void {
      if (destroyed) return;
      destroyed = true;
      // Close the session first: it holds an open Port, and dropping the host
      // without disconnecting would leave a request billing in the worker.
      session?.close();
      session = null;
      beginEpoch++;
      tracker.stop();
      callout?.destroy();
      callout = null;
      button?.destroy();
      button = null;
      host.destroy();
    }

    // Keep the current corner available to whatever persists drag positions.
    void currentCorner;
  },
});

interface Suppression {
  suppressed: boolean;
  origin: string;
  corner: ButtonCorner | null;
  pin: { dx: number; dy: number } | null;
  /** Whether the one-time first-run callout has already been shown (§4). Only
   *  read on the non-suppressed path. */
  firstRunDone?: boolean;
}

/**
 * Every reason not to appear, resolved in one round trip. Ordered so the
 * cheapest and most absolute checks decide first.
 */
async function loadSuppression(): Promise<Suppression | null> {
  try {
    const resolvedOrigin = await sendMessage({ type: 'site:scope' });
    const origin = resolvedOrigin || location.origin;
    const settings = await sendMessage({ type: 'settings:get' });
    if (settings.globallyHidden)
      return { suppressed: true, origin, corner: null, pin: null };
    // A one-hour pause for screen shares (UX-SPEC §1.5).
    if (settings.pausedUntil && settings.pausedUntil > Date.now()) {
      return { suppressed: true, origin, corner: null, pin: null };
    }

    const rule = await sendMessage({
      type: 'siteRule:get',
      origin,
    });
    if (rule.hidden) {
      return { suppressed: true, origin, corner: null, pin: null };
    }

    const hiddenThisSession = await sendMessage({
      type: 'session:isOriginHidden',
      origin,
    });

    return {
      suppressed: hiddenThisSession,
      origin,
      corner: rule.buttonCorner,
      pin: rule.buttonPin,
      firstRunDone: settings.firstRunDone,
    };
  } catch {
    // Unreachable *this attempt*. In MV3 an asleep worker is the normal case
    // at document_idle, not an anomaly, so treating one failed round trip as
    // "the user hid us" would silently disable the extension on slow loads.
    // The caller retries; only a definitive answer suppresses.
    return null;
  }
}

/**
 * Wake the worker and get a definitive answer. Bounded: if the worker really
 * is unavailable after several tries, stay quiet rather than appear without
 * knowing whether the user hid us.
 */
async function resolveSuppression(): Promise<Suppression> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const result = await loadSuppression();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)));
  }
  return {
    suppressed: true,
    origin: location.origin,
    corner: null,
    pin: null,
  };
}
