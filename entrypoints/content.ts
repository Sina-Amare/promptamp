import { browser, defineContentScript } from '#imports';
import { sendMessage } from '../lib/messaging/client';
import { TRIGGER_ENHANCE } from '../lib/messaging/protocol';
import { createButton, type ButtonHandle } from '../lib/ui/button';
import { BUTTON_CSS } from '../lib/ui/button/styles';
import { createShadowHost, el } from '../lib/ui/host';
import { PANEL_CSS } from '../lib/ui/panel/styles';
import { createSession, type EnhanceSession } from '../lib/ui/session';
import { createFieldTracker } from '../lib/ui/tracker';
import type { ButtonCorner } from '../lib/storage/schemas';

/**
 * The injected surface.
 *
 * This script never sees an API key and never makes a network call — ESLint
 * enforces that it cannot even import the credential or provider modules
 * (principle 2). Everything that needs a key goes through the worker.
 */

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  // Frames get their own instance; a composer inside an iframe is still a
  // composer, and skipping them would miss Gmail and most embedded editors.
  allFrames: true,

  async main(ctx) {
    // Suppression is resolved *before* anything is added to the DOM. A hidden
    // site must be hidden with certainty, not hidden-then-removed: a broken
    // off switch is the fastest way to lose a user's trust.
    const suppression = await resolveSuppression();
    if (suppression.suppressed) return;

    let sessionHidden = false;
    let siteHidden = false;

    const host = createShadowHost({
      themeAnchor: document.body,
      onHostile: () => {
        // Three removals in ten seconds: the site is actively fighting us.
        // Re-attaching forever would burn CPU and still lose.
        teardown();
      },
    });

    const sheet = new CSSStyleSheet();
    sheet.replaceSync(`${BUTTON_CSS}\n${PANEL_CSS}`);
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
      const dialog = field.closest('dialog');
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

    /**
     * Tier 4 needs the page's own JavaScript world, which a content script
     * cannot reach — so it is asked for via the worker's scripting API.
     */
    const mainWorldInsert = async (text: string): Promise<boolean> => {
      try {
        return await sendMessage({
          type: 'insert:mainWorld',
          text,
        });
      } catch {
        return false;
      }
    };

    function beginEnhance(field: HTMLElement): void {
      session?.close();
      session = createSession(
        { field, layer, origin: location.origin, mainWorldInsert },
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

    const tracker = createFieldTracker(
      {
        onAttach: (field) => {
          // The field may live inside a modal dialog opened after us.
          reparentForModal(field.element);
          button?.destroy();
          button = createButton({
            onActivate: () => {
              beginEnhance(field.element);
            },
            onStop: () => session?.stop(),
            onDismiss: (choice) => {
              void handleDismiss(choice);
            },
          });
          layer.append(button.wrap);
        },
        onDetach: () => {
          button?.destroy();
          button = null;
        },
        onMove: (point, corner) => {
          currentCorner = corner;
          if (!button) return;
          // transform, not top/left: this runs on every scroll frame and must
          // stay on the compositor.
          button.wrap.style.transform = `translate3d(${String(point.left)}px, ${String(point.top)}px, 0)`;
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
          host.element.contains(node) || node === host.element,
        preferredCorner: () => suppression.corner,
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
        typeof message !== 'object' ||
        message === null ||
        (message as { type?: unknown }).type !== TRIGGER_ENHANCE
      ) {
        return;
      }
      const field = tracker.current();
      if (!field) return;
      button?.setInstant(true);
      beginEnhance(field);
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
        await sendMessage({
          type: 'siteRule:patch',
          origin: location.origin,
          patch: { hidden: true },
        });
        teardown();
        return;
      }
      await sendMessage({
        type: 'settings:patch',
        patch: { globallyHidden: true },
      });
      teardown();
    }

    function teardown(): void {
      // Close the session first: it holds an open Port, and dropping the host
      // without disconnecting would leave a request billing in the worker.
      session?.close();
      session = null;
      tracker.stop();
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
  corner: ButtonCorner | null;
}

/**
 * Every reason not to appear, resolved in one round trip. Ordered so the
 * cheapest and most absolute checks decide first.
 */
async function loadSuppression(): Promise<Suppression | null> {
  try {
    const settings = await sendMessage({ type: 'settings:get' });
    if (settings.globallyHidden) return { suppressed: true, corner: null };
    // A one-hour pause for screen shares (UX-SPEC §1.5).
    if (settings.pausedUntil && settings.pausedUntil > Date.now()) {
      return { suppressed: true, corner: null };
    }

    const rule = await sendMessage({
      type: 'siteRule:get',
      origin: location.origin,
    });
    if (rule.hidden) return { suppressed: true, corner: null };

    const hiddenThisSession = await sendMessage({
      type: 'session:isOriginHidden',
      origin: location.origin,
    });

    return {
      suppressed: hiddenThisSession,
      corner: rule.buttonCorner,
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
  return { suppressed: true, corner: null };
}
