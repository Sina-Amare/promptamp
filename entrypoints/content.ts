import { defineContentScript } from '#imports';
import { sendMessage } from '../lib/messaging/client';
import { createButton, type ButtonHandle } from '../lib/ui/button';
import { BUTTON_CSS } from '../lib/ui/button/styles';
import { createShadowHost, el } from '../lib/ui/host';
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

  async main() {
    // Suppression is resolved *before* anything is added to the DOM. A hidden
    // site must be hidden with certainty, not hidden-then-removed: a broken
    // off switch is the fastest way to lose a user's trust.
    const suppression = await loadSuppression();
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
    sheet.replaceSync(BUTTON_CSS);
    host.root.adoptedStyleSheets = [...host.root.adoptedStyleSheets, sheet];

    const layer = el('div', { class: 'pa-button-layer' });
    host.root.append(layer);

    let button: ButtonHandle | null = null;
    let currentCorner: ButtonCorner | null = null;

    const tracker = createFieldTracker(
      {
        onAttach: () => {
          button?.destroy();
          button = createButton({
            onActivate: () => {
              // Phase 6 replaces this with the preview panel. Nothing may
              // touch the draft before an explicit Accept, so there is
              // deliberately no insertion path wired here yet.
              button?.setState('loading');
            },
            onStop: () => button?.setState('idle'),
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
async function loadSuppression(): Promise<Suppression> {
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
    // The worker is unreachable (still starting, or the extension is being
    // updated). Staying quiet is the safe default — appearing without knowing
    // whether the user hid us is the failure that matters.
    return { suppressed: true, corner: null };
  }
}
