import { browser } from '#imports';
import { sendMessage } from '../../lib/messaging/client';
import { el } from '../../lib/ui/host';

/**
 * Toolbar popup — four things, nothing else.
 *
 * This is also the *only* surface where a limit or an account matter may ever
 * appear. Nothing upsell-shaped goes near the button, the panel, or the
 * accept action (UX-SPEC §1.5) — attaching one to the moment a user is
 * accepting work is the pattern that gets extensions uninstalled.
 */

const PAUSE_MS = 60 * 60 * 1000;

const root = document.getElementById('root')!;

async function currentOrigin(): Promise<string | null> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) return null;
  try {
    const { protocol, origin } = new URL(tab.url);
    // chrome:// and about: pages have no content script and no site rule.
    return protocol.startsWith('http') ? origin : null;
  } catch {
    return null;
  }
}

async function render(): Promise<void> {
  const origin = await currentOrigin();
  const settings = await sendMessage({ type: 'settings:get' });
  const profiles = await sendMessage({ type: 'profiles:list' });
  const rule = origin
    ? await sendMessage({ type: 'siteRule:get', origin })
    : null;

  const paused =
    settings.pausedUntil !== null && settings.pausedUntil > Date.now();
  const status = el('p', { class: 'status' });

  /* Profile quick-switch — pins for this site, per UX-SPEC §3. */
  const profileSelect = el('select', {
    attrs: { 'aria-label': 'Profile for this site' },
  });
  profileSelect.append(
    el('option', { text: 'Automatic', attrs: { value: '' } }),
    ...profiles.map((profile) => {
      const option = el('option', {
        text: profile.name,
        attrs: { value: profile.id },
      });
      if (rule?.pinnedProfileId === profile.id) option.selected = true;
      return option;
    }),
  );
  profileSelect.disabled = !origin;
  profileSelect.addEventListener('change', () => {
    if (!origin) return;
    void (async () => {
      await sendMessage({
        type: 'siteRule:patch',
        origin,
        patch: { pinnedProfileId: profileSelect.value || null },
      });
      status.textContent = profileSelect.value
        ? 'Pinned for this site.'
        : 'Back to automatic.';
    })();
  });

  /* Pause — for screen shares. */
  const pause = el('button', {
    class: paused ? 'active' : '',
    text: paused ? 'Paused — resume now' : 'Pause on all sites for 1 hour',
    attrs: { type: 'button' },
  });
  pause.addEventListener('click', () => {
    void (async () => {
      await sendMessage({
        type: 'settings:patch',
        patch: { pausedUntil: paused ? null : Date.now() + PAUSE_MS },
      });
      await render();
    })();
  });

  /* Per-site hide, and the way back. */
  const hidden = rule?.hidden ?? false;
  const hideSite = el('button', {
    class: hidden ? 'active' : '',
    text: hidden ? 'Show on this site' : 'Hide on this site',
    attrs: { type: 'button' },
  });
  hideSite.disabled = !origin;
  hideSite.addEventListener('click', () => {
    if (!origin) return;
    void (async () => {
      await sendMessage({
        type: 'siteRule:patch',
        origin,
        patch: { hidden: !hidden },
      });
      await render();
    })();
  });

  /* The global off switch has to be reversible from here — that is the whole
     reason "Hide everywhere" is safe to offer on the button. */
  const globalToggle = el('button', {
    class: settings.globallyHidden ? 'active' : '',
    text: settings.globallyHidden
      ? 'Turn PromptAmp back on'
      : 'Hide everywhere',
    attrs: { type: 'button' },
  });
  globalToggle.addEventListener('click', () => {
    void (async () => {
      await sendMessage({
        type: 'settings:patch',
        patch: { globallyHidden: !settings.globallyHidden },
      });
      await render();
    })();
  });

  const openOptions = el('button', {
    text: 'Settings…',
    attrs: { type: 'button' },
  });
  openOptions.addEventListener('click', () => {
    void browser.runtime.openOptionsPage();
    globalThis.close();
  });

  // Without a provider nothing else in here can do anything, so say that
  // first rather than presenting controls that will silently do nothing.
  let setupPrompt: HTMLElement | null = null;
  if (settings.activeProviderId === null) {
    setupPrompt = el('button', {
      class: 'active',
      text: 'Add an API key to get started',
      attrs: { type: 'button' },
    });
    setupPrompt.addEventListener('click', () => {
      void browser.runtime.openOptionsPage();
      globalThis.close();
    });
  }

  const children: (Node | null)[] = [
    el('h1', { text: 'PromptAmp' }),
    el('p', { class: 'site', text: origin ?? 'Not available on this page' }),
    setupPrompt,
    el('label', {
      children: [el('span', { text: 'Profile on this site' }), profileSelect],
    }),
    el('hr'),
    pause,
    hideSite,
    globalToggle,
    el('hr'),
    openOptions,
    status,
  ];

  root.replaceChildren(...children.filter((node) => node !== null));
}

void render();
