import { BUILTIN_PROFILES } from '../../lib/enhance/prompts';
import { sendMessage } from '../../lib/messaging/client';
import { missingPermissions, requestPermission } from '../../lib/permissions';
import type { ConfiguredProvider } from '../../lib/messaging/protocol';
import { PROVIDERS, USER_FACING_PROVIDERS } from '../../lib/providers/registry';
import { formatCostUsd } from '../../lib/providers/cost';
import type {
  HistoryEntry,
  Profile,
  ProviderId,
} from '../../lib/storage/schemas';
import { el } from '../../lib/ui/host';

/**
 * The settings page.
 *
 * Built with `el()` rather than template strings — the same builder the
 * injected UI uses. It is not strictly required here (this is our own
 * document, not a Trusted-Types-enforcing host page), but having exactly one
 * way to construct DOM in the codebase means there is no innerHTML habit to
 * accidentally carry into the content script, where it would throw.
 *
 * Key material never reaches this page. Keys are written through the worker
 * and read back only as "a key is saved" — the field renders a placeholder,
 * never a value.
 */

type TabId = 'providers' | 'profiles' | 'behavior' | 'history' | 'about';

const TABS: { id: TabId; label: string }[] = [
  { id: 'providers', label: 'Providers' },
  { id: 'profiles', label: 'Profiles' },
  { id: 'behavior', label: 'Behavior' },
  { id: 'history', label: 'History' },
  { id: 'about', label: 'About' },
];

const tabBar = document.getElementById('tabs')!;
const panel = document.getElementById('panel')!;

let active: TabId = 'providers';

/**
 * A confirmation that has to survive the re-render that follows it.
 *
 * Saving changes state the whole tab depends on (which provider is active,
 * whether a key exists), so the tab is rebuilt — which would otherwise destroy
 * the "Saved" message the instant it appeared, leaving the user with no
 * feedback that anything happened.
 */
let flash: { cardTitle: string; text: string; kind: 'ok' | 'err' } | null =
  null;

function renderTabs(): void {
  tabBar.replaceChildren(
    ...TABS.map((tab) => {
      const button = el('button', {
        text: tab.label,
        attrs: {
          type: 'button',
          role: 'tab',
          'aria-selected': String(tab.id === active),
        },
      });
      button.addEventListener('click', () => {
        active = tab.id;
        renderTabs();
        void renderPanel();
      });
      return button;
    }),
  );
}

async function renderPanel(): Promise<void> {
  panel.replaceChildren(el('p', { class: 'empty', text: 'Loading…' }));
  switch (active) {
    case 'providers':
      panel.replaceChildren(await providersTab());
      break;
    case 'profiles':
      panel.replaceChildren(await profilesTab());
      break;
    case 'behavior':
      panel.replaceChildren(await behaviorTab());
      break;
    case 'history':
      panel.replaceChildren(await historyTab());
      break;
    case 'about':
      panel.replaceChildren(aboutTab());
      break;
  }
}

/* ── providers ──────────────────────────────────────────────────── */

/**
 * Disclosures a user genuinely needs *before* choosing a provider — not buried
 * in a FAQ. Google trains on free-tier Gemini traffic, and Ollama refuses
 * cross-origin requests until it is told not to.
 */
/** Suggestions only — the field takes any language the user types. */
const OUTPUT_LANGUAGES: readonly string[] = [
  'English',
  'Persian (فارسی)',
  'Arabic',
  'Spanish',
  'French',
  'German',
  'Portuguese',
  'Italian',
  'Turkish',
  'Russian',
  'Hindi',
  'Chinese (Simplified)',
  'Japanese',
  'Korean',
];

const PROVIDER_NOTES: Partial<Record<ProviderId, string>> = {
  gemini:
    'Google may use free-tier API content to improve their models. Use a paid key if your drafts are sensitive.',
  ollama:
    'Ollama blocks browser extensions by default. Start it with OLLAMA_ORIGINS="chrome-extension://*" to allow PromptAmp.',
  lmstudio:
    'Enable the local server in LM Studio, and allow cross-origin requests in its server settings.',
  openrouter:
    'Connect signs you in without pasting a key — PromptAmp never sees your password.',
  custom:
    'Any endpoint that speaks the OpenAI chat-completions format: Together, Fireworks, DeepSeek, Mistral, xAI, Cerebras, Azure OpenAI, a self-hosted vLLM, or your own LiteLLM proxy. Enter the base URL and PromptAmp will ask your browser for permission to reach that host — and only that host.',
};

async function providersTab(): Promise<HTMLElement> {
  const configured = await sendMessage({ type: 'providers:list' });
  const settings = await sendMessage({ type: 'settings:get' });
  const byId = new Map(configured.map((c) => [c.providerId, c]));

  const stack = el('div', { class: 'stack' });

  // Firefox grants host permissions only on request. Without this, a valid key
  // fails every call and looks exactly like a bad key.
  const blocked = await missingPermissions(
    configured.map((c) => ({
      providerId: c.providerId,
      ...(c.baseUrl === undefined ? {} : { baseUrl: c.baseUrl }),
    })),
  );
  const savedBaseUrls = new Map(
    configured.map((c) => [c.providerId, c.baseUrl]),
  );
  for (const id of blocked) {
    stack.append(permissionCard(id, savedBaseUrls.get(id)));
  }

  for (const id of USER_FACING_PROVIDERS) {
    stack.append(providerCard(id, byId.get(id), settings.activeProviderId));
  }

  return stack;
}

function permissionCard(id: ProviderId, baseUrl?: string): HTMLElement {
  const config = PROVIDERS[id];
  const host = hostnameOf(baseUrl ?? config.baseUrl);

  const grant = el('button', {
    class: 'primary',
    text: `Allow access to ${host}`,
    attrs: { type: 'button' },
  });
  // Must be a real click: Firefox rejects a permission request that did not
  // come from a user gesture.
  grant.addEventListener('click', () => {
    void (async () => {
      await requestPermission(id, baseUrl);
      await renderPanel();
    })();
  });

  return el('section', {
    class: 'card',
    children: [
      el('span', {
        class: 'card-title',
        text: `${config.label} needs your permission`,
      }),
      el('p', {
        class: 'notice',
        text: `Your browser has not yet allowed PromptAmp to reach ${host}. Until you allow it, requests will fail even though your key is correct.`,
      }),
      grant,
    ],
  });
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function providerCard(
  id: ProviderId,
  saved: ConfiguredProvider | undefined,
  activeProvider: ProviderId | null,
): HTMLElement {
  const config = PROVIDERS[id];
  const status = el('p', { class: 'status' });

  if (flash?.cardTitle === config.label) {
    status.textContent = flash.text;
    status.className = `status ${flash.kind}`;
    flash = null;
  }

  const keyInput = el('input', {
    attrs: {
      type: 'password',
      autocomplete: 'off',
      spellcheck: 'false',
      // The saved key is never sent back to this page — only the fact of it.
      placeholder: saved?.hasKey ? '•••••••• saved' : 'Paste your API key',
    },
  });

  const modelInput = el('input', {
    attrs: { type: 'text', list: `${id}-models`, spellcheck: 'false' },
  });
  modelInput.value = saved?.model ?? config.defaultModel;

  const modelList = el('datalist', { attrs: { id: `${id}-models` } });

  const baseUrlInput = el('input', {
    attrs: { type: 'url', placeholder: config.baseUrl, spellcheck: 'false' },
  });
  if (saved?.baseUrl) baseUrlInput.value = saved.baseUrl;

  const setStatus = (text: string, kind: '' | 'ok' | 'err'): void => {
    status.textContent = text;
    status.className = `status ${kind}`;
  };

  const save = el('button', {
    class: 'primary',
    text: 'Save',
    attrs: { type: 'button' },
  });
  save.addEventListener('click', () => {
    void (async () => {
      setStatus('Saving…', '');

      // A user-supplied host is not covered by the manifest, so ask for it
      // here — inside the click, which is the only place Firefox allows it.
      if (config.allowsCustomBaseUrl && baseUrlInput.value.trim()) {
        const granted = await requestPermission(id, baseUrlInput.value.trim());
        if (!granted) {
          setStatus(
            'Saved, but your browser declined access to that host — requests will fail until you allow it.',
            'err',
          );
        }
      }

      await sendMessage({
        type: 'provider:save',
        providerId: id,
        ...(keyInput.value ? { apiKey: keyInput.value } : {}),
        model: modelInput.value.trim() || config.defaultModel,
        ...(config.allowsCustomBaseUrl && baseUrlInput.value
          ? { baseUrl: baseUrlInput.value.trim() }
          : {}),
      });
      keyInput.value = '';
      // Survives the rebuild below, which is what actually shows the user
      // their key was stored.
      flash = { cardTitle: config.label, text: 'Saved', kind: 'ok' };
      await renderPanel();
    })();
  });

  const test = el('button', {
    class: 'secondary',
    text: 'Test',
    attrs: { type: 'button' },
  });
  test.addEventListener('click', () => {
    void (async () => {
      setStatus('Testing…', '');
      const result = await sendMessage({
        type: 'provider:test',
        providerId: id,
      });
      setStatus(
        result.ok
          ? `Working — ${result.model ?? 'ready'}`
          : (result.error?.message ?? 'Failed'),
        result.ok ? 'ok' : 'err',
      );
    })();
  });

  const fetchModels = el('button', {
    class: 'quiet',
    text: 'Load models',
    attrs: { type: 'button' },
  });
  fetchModels.addEventListener('click', () => {
    void (async () => {
      setStatus('Loading models…', '');
      const models = await sendMessage({
        type: 'provider:models',
        providerId: id,
      });
      modelList.replaceChildren(
        ...models.map((m) => el('option', { attrs: { value: m } })),
      );
      setStatus(
        models.length
          ? `${String(models.length)} models available`
          : 'No models returned',
        models.length ? 'ok' : 'err',
      );
    })();
  });

  const actions = el('div', {
    class: 'row',
    children: [save, test, fetchModels],
  });

  if (saved) {
    const remove = el('button', {
      class: 'danger',
      text: 'Remove',
      attrs: { type: 'button' },
    });
    remove.addEventListener('click', () => {
      void (async () => {
        await sendMessage({ type: 'provider:delete', providerId: id });
        await renderPanel();
      })();
    });
    actions.append(remove);

    if (activeProvider !== id) {
      const makeActive = el('button', {
        class: 'secondary',
        text: 'Use this provider',
        attrs: { type: 'button' },
      });
      makeActive.addEventListener('click', () => {
        void (async () => {
          await sendMessage({
            type: 'settings:patch',
            patch: { activeProviderId: id },
          });
          await renderPanel();
        })();
      });
      actions.append(makeActive);
    }
  }

  if (id === 'openrouter') {
    const connect = el('button', {
      class: 'secondary',
      text: 'Connect with OpenRouter',
      attrs: { type: 'button' },
    });
    connect.addEventListener('click', () => {
      void (async () => {
        setStatus('Opening OpenRouter…', '');
        const result = await sendMessage({
          type: 'provider:connectOpenRouter',
        });
        setStatus(
          result.ok ? 'Connected' : (result.error?.message ?? 'Failed'),
          result.ok ? 'ok' : 'err',
        );
        if (result.ok) await renderPanel();
      })();
    });
    actions.prepend(connect);
  }

  const note = PROVIDER_NOTES[id];

  return el('section', {
    class: 'card',
    children: [
      el('div', {
        class: 'card-head',
        children: [
          el('span', { class: 'card-title', text: config.label }),
          activeProvider === id
            ? el('span', { class: 'badge', text: 'Active' })
            : null,
          saved?.authMethod === 'oauth'
            ? el('span', { class: 'badge muted', text: 'Connected' })
            : null,
        ],
      }),
      note ? el('p', { class: 'notice', text: note }) : null,
      config.requiresKey || config.keyOptional
        ? el('label', {
            children: [
              el('span', {
                text: config.requiresKey ? 'API key' : 'API key (if required)',
              }),
              keyInput,
              el('span', {
                class: 'hint',
                text: 'Stored on this device only, readable only by the background worker.',
              }),
            ],
          })
        : null,
      el('div', {
        class: 'row',
        children: [
          el('label', {
            children: [el('span', { text: 'Model' }), modelInput, modelList],
          }),
          config.allowsCustomBaseUrl
            ? el('label', {
                children: [el('span', { text: 'Server URL' }), baseUrlInput],
              })
            : null,
        ],
      }),
      actions,
      status,
      config.setupUrl
        ? el('p', {
            class: 'hint',
            children: [
              (() => {
                const link = el('a', {
                  text: `Get a ${config.label} key →`,
                  attrs: {
                    href: config.setupUrl,
                    target: '_blank',
                    rel: 'noreferrer',
                  },
                });
                return link;
              })(),
            ],
          })
        : null,
    ],
  });
}

/* ── profiles ───────────────────────────────────────────────────── */

async function profilesTab(): Promise<HTMLElement> {
  const profiles = await sendMessage({ type: 'profiles:list' });
  const custom = profiles.filter((p) => !p.builtIn);
  const status = el('p', { class: 'status' });

  const importArea = el('textarea', {
    attrs: { placeholder: 'Paste an exported profiles JSON here…' },
  });

  const importBtn = el('button', {
    class: 'secondary',
    text: 'Import',
    attrs: { type: 'button' },
  });
  importBtn.addEventListener('click', () => {
    void (async () => {
      try {
        const result = await sendMessage({
          type: 'profiles:import',
          json: importArea.value,
        });
        if (result.error) {
          status.textContent = result.error;
          status.className = 'status err';
          return;
        }
        status.textContent = `Imported ${String(result.added)} profile(s)`;
        status.className = 'status ok';
        importArea.value = '';
        await renderPanel();
      } catch {
        status.textContent = 'That is not valid JSON.';
        status.className = 'status err';
      }
    })();
  });

  const exportBtn = el('button', {
    class: 'quiet',
    text: 'Export custom profiles',
    attrs: { type: 'button' },
  });
  exportBtn.addEventListener('click', () => {
    void (async () => {
      const json = await sendMessage({ type: 'profiles:export' });
      download('promptamp-profiles.json', json);
    })();
  });

  return el('div', {
    class: 'stack',
    children: [
      el('section', {
        class: 'card',
        children: [
          el('span', { class: 'card-title', text: 'Built-in profiles' }),
          el('p', {
            class: 'hint',
            text: 'Improved with each update, so they are read-only. Fork one to customise it.',
          }),
          el('div', {
            class: 'list',
            children: BUILTIN_PROFILES.map((profile) =>
              builtinRow(profile, custom),
            ),
          }),
        ],
      }),
      el('section', {
        class: 'card',
        children: [
          el('span', { class: 'card-title', text: 'Your profiles' }),
          custom.length === 0
            ? el('p', { class: 'empty', text: 'No custom profiles yet.' })
            : el('div', {
                class: 'list',
                children: custom.map((profile) => customRow(profile)),
              }),
        ],
      }),
      el('section', {
        class: 'card',
        children: [
          el('span', { class: 'card-title', text: 'Import / export' }),
          importArea,
          el('div', { class: 'row', children: [importBtn, exportBtn] }),
          status,
        ],
      }),
    ],
  });
}

function builtinRow(profile: Profile, custom: Profile[]): HTMLElement {
  const fork = el('button', {
    class: 'secondary',
    text: 'Fork',
    attrs: { type: 'button' },
  });
  fork.addEventListener('click', () => {
    void (async () => {
      // A distinct id, so the fork is a new profile and the built-in survives
      // the next update untouched.
      let id = `${profile.id}-copy`;
      let n = 2;
      while (custom.some((p) => p.id === id))
        id = `${profile.id}-copy-${String(n++)}`;

      await sendMessage({
        type: 'profiles:save',
        profile: {
          ...profile,
          id,
          name: `${profile.name} (copy)`,
          builtIn: false,
        },
      });
      await renderPanel();
    })();
  });

  return el('div', {
    class: 'list-item',
    children: [
      el('span', { text: `${profile.name} — ${profile.description}` }),
      fork,
    ],
  });
}

function customRow(profile: Profile): HTMLElement {
  const edit = el('button', {
    class: 'secondary',
    text: 'Edit',
    attrs: { type: 'button' },
  });
  const remove = el('button', {
    class: 'danger',
    text: 'Delete',
    attrs: { type: 'button' },
  });

  remove.addEventListener('click', () => {
    void (async () => {
      await sendMessage({ type: 'profiles:delete', profileId: profile.id });
      await renderPanel();
    })();
  });

  edit.addEventListener('click', () => {
    const editor = profileEditor(profile);
    panel.replaceChildren(editor);
  });

  return el('div', {
    class: 'list-item',
    children: [el('span', { text: profile.name }), edit, remove],
  });
}

function profileEditor(profile: Profile): HTMLElement {
  const name = el('input', { attrs: { type: 'text' } });
  name.value = profile.name;
  const description = el('input', { attrs: { type: 'text' } });
  description.value = profile.description;
  const prompt = el('textarea');
  prompt.value = profile.systemPrompt;
  prompt.style.minHeight = '320px';
  const status = el('p', { class: 'status' });

  const save = el('button', {
    class: 'primary',
    text: 'Save',
    attrs: { type: 'button' },
  });
  save.addEventListener('click', () => {
    void (async () => {
      try {
        await sendMessage({
          type: 'profiles:save',
          profile: {
            ...profile,
            name: name.value.trim(),
            description: description.value.trim(),
            systemPrompt: prompt.value,
            builtIn: false,
          },
        });
        await renderPanel();
      } catch {
        status.textContent =
          'Could not save — check the name and prompt length.';
        status.className = 'status err';
      }
    })();
  });

  const back = el('button', {
    class: 'quiet',
    text: 'Back',
    attrs: { type: 'button' },
  });
  back.addEventListener('click', () => {
    void renderPanel();
  });

  return el('section', {
    class: 'card',
    children: [
      el('span', { class: 'card-title', text: `Edit ${profile.name}` }),
      el('label', { children: [el('span', { text: 'Name' }), name] }),
      el('label', {
        children: [el('span', { text: 'Description' }), description],
      }),
      el('label', {
        children: [el('span', { text: 'System prompt' }), prompt],
      }),
      el('div', { class: 'row', children: [save, back] }),
      status,
    ],
  });
}

/* ── behavior ───────────────────────────────────────────────────── */

async function behaviorTab(): Promise<HTMLElement> {
  const settings = await sendMessage({ type: 'settings:get' });
  const rules = await sendMessage({ type: 'siteRules:list' });
  const profiles = await sendMessage({ type: 'profiles:list' });

  const autoProfile = checkbox(
    'Pick a profile automatically from the site',
    settings.autoProfile,
    (checked) => ({ autoProfile: checked }),
  );

  const globallyHidden = checkbox(
    'Hide PromptAmp everywhere',
    settings.globallyHidden,
    (checked) => ({ globallyHidden: checked }),
  );

  const historyEnabled = checkbox(
    'Keep a local history of enhancements',
    settings.historyEnabled,
    (checked) => ({ historyEnabled: checked }),
  );

  const defaultProfile = el('select');
  for (const profile of profiles) {
    const option = el('option', {
      text: profile.name,
      attrs: { value: profile.id },
    });
    if (profile.id === settings.defaultProfileId) option.selected = true;
    defaultProfile.append(option);
  }
  defaultProfile.addEventListener('change', () => {
    void sendMessage({
      type: 'settings:patch',
      patch: { defaultProfileId: defaultProfile.value },
    });
  });

  // A combobox rather than a select: "Brazilian Portuguese" and "formal
  // Japanese" are reasonable answers, and no fixed list contains them.
  const outputLanguage = el('input', {
    attrs: {
      type: 'text',
      list: 'pa-output-languages',
      spellcheck: 'false',
      maxlength: '40',
      placeholder: 'Same language as my draft',
    },
  });
  outputLanguage.value = settings.outputLanguageOverride;
  outputLanguage.addEventListener('change', () => {
    void sendMessage({
      type: 'settings:patch',
      patch: { outputLanguageOverride: outputLanguage.value.trim() },
    });
  });

  const languageList = el('datalist', {
    attrs: { id: 'pa-output-languages' },
    children: OUTPUT_LANGUAGES.map((name) =>
      el('option', { attrs: { value: name } }),
    ),
  });

  const softCap = el('input', {
    attrs: { type: 'number', min: '0', max: '10000' },
  });
  softCap.value = String(settings.softCapPerDay);
  softCap.addEventListener('change', () => {
    void sendMessage({
      type: 'settings:patch',
      patch: { softCapPerDay: Number(softCap.value) || 0 },
    });
  });

  const hiddenOrigins = Object.entries(rules).filter(([, rule]) => rule.hidden);

  return el('div', {
    class: 'stack',
    children: [
      el('section', {
        class: 'card',
        children: [
          el('span', { class: 'card-title', text: 'General' }),
          autoProfile,
          el('label', {
            children: [el('span', { text: 'Default profile' }), defaultProfile],
          }),
          el('label', {
            children: [
              el('span', { text: 'Enhanced prompt language' }),
              outputLanguage,
              languageList,
              el('span', {
                class: 'hint',
                text: 'Write your draft in any language and get the enhanced prompt in this one. Leave it empty to keep your draft’s language — image and video prompts still go out in English, which is what those models are trained on.',
              }),
            ],
          }),
          globallyHidden,
        ],
      }),
      el('section', {
        class: 'card',
        children: [
          el('span', { class: 'card-title', text: 'Limits' }),
          el('label', {
            children: [
              el('span', { text: 'Daily enhancement limit' }),
              softCap,
              el('span', {
                class: 'hint',
                text: 'A guard against runaway usage on your own key. 0 turns it off.',
              }),
            ],
          }),
          historyEnabled,
        ],
      }),
      el('section', {
        class: 'card',
        children: [
          el('span', { class: 'card-title', text: 'Hidden sites' }),
          hiddenOrigins.length === 0
            ? el('p', {
                class: 'empty',
                text: 'PromptAmp is not hidden anywhere.',
              })
            : el('div', {
                class: 'list',
                children: hiddenOrigins.map(([origin]) => hiddenRow(origin)),
              }),
        ],
      }),
      el('section', {
        class: 'card',
        children: [
          el('span', { class: 'card-title', text: 'Keyboard shortcut' }),
          el('p', {
            class: 'hint',
            text: 'Alt+E enhances the focused field. Change it at chrome://extensions/shortcuts.',
          }),
        ],
      }),
    ],
  });
}

function hiddenRow(origin: string): HTMLElement {
  const restore = el('button', {
    class: 'secondary',
    text: 'Show again',
    attrs: { type: 'button' },
  });
  restore.addEventListener('click', () => {
    void (async () => {
      await sendMessage({
        type: 'siteRule:patch',
        origin,
        patch: { hidden: false },
      });
      await renderPanel();
    })();
  });
  return el('div', {
    class: 'list-item',
    children: [el('span', { text: origin }), restore],
  });
}

function checkbox(
  label: string,
  checked: boolean,
  patch: (checked: boolean) => Record<string, unknown>,
): HTMLElement {
  const input = el('input', { attrs: { type: 'checkbox' } });
  input.checked = checked;
  input.addEventListener('change', () => {
    void sendMessage({
      type: 'settings:patch',
      patch: patch(input.checked) as never,
    });
  });
  return el('label', {
    class: 'switch',
    children: [input, el('span', { text: label })],
  });
}

/* ── history ────────────────────────────────────────────────────── */

async function historyTab(): Promise<HTMLElement> {
  const entries = await sendMessage({ type: 'history:list' });

  const search = el('input', {
    attrs: { type: 'text', placeholder: 'Search your history…' },
  });
  const list = el('div', { class: 'stack' });

  const paint = (query: string): void => {
    const needle = query.trim().toLowerCase();
    const matching = needle
      ? entries.filter(
          (e) =>
            e.original.toLowerCase().includes(needle) ||
            e.enhanced.toLowerCase().includes(needle),
        )
      : entries;

    list.replaceChildren(
      ...(matching.length === 0
        ? [el('p', { class: 'empty', text: 'Nothing here yet.' })]
        : matching.map(historyEntry)),
    );
  };

  search.addEventListener('input', () => {
    paint(search.value);
  });
  paint('');

  const exportBtn = el('button', {
    class: 'secondary',
    text: 'Export',
    attrs: { type: 'button' },
  });
  exportBtn.addEventListener('click', () => {
    void (async () => {
      download(
        'promptamp-history.json',
        await sendMessage({ type: 'history:export' }),
      );
    })();
  });

  const clear = el('button', {
    class: 'danger',
    text: 'Clear history',
    attrs: { type: 'button' },
  });
  clear.addEventListener('click', () => {
    void (async () => {
      await sendMessage({ type: 'history:clear' });
      await renderPanel();
    })();
  });

  return el('div', {
    class: 'stack',
    children: [
      el('section', {
        class: 'card',
        children: [
          el('p', {
            class: 'hint',
            text: 'History lives on this device only. It is never uploaded anywhere.',
          }),
          search,
          el('div', { class: 'row', children: [exportBtn, clear] }),
        ],
      }),
      list,
    ],
  });
}

function historyEntry(entry: HistoryEntry): HTMLElement {
  const meta = [
    new Date(entry.at).toLocaleString(),
    entry.origin,
    entry.profileId,
    entry.model,
    entry.costUsd === undefined
      ? `${String((entry.promptTokens ?? 0) + (entry.completionTokens ?? 0))} tokens`
      : formatCostUsd(entry.costUsd),
  ];

  return el('article', {
    class: 'history-entry',
    children: [
      el('div', {
        class: 'history-meta',
        children: meta.map((text) => el('span', { text })),
      }),
      el('p', {
        class: 'history-text original',
        text: entry.original,
        attrs: { dir: 'auto' },
      }),
      el('p', {
        class: 'history-text',
        text: entry.enhanced,
        attrs: { dir: 'auto' },
      }),
    ],
  });
}

/* ── about ──────────────────────────────────────────────────────── */

function aboutTab(): HTMLElement {
  return el('div', {
    class: 'stack',
    children: [
      el('section', {
        class: 'card',
        children: [
          el('span', { class: 'card-title', text: 'Privacy' }),
          el('p', {
            class: 'hint',
            text: 'PromptAmp has no servers. Your drafts go directly from your browser to the provider you chose, using your key. Nothing is collected, and there is no analytics of any kind.',
          }),
          el('p', {
            class: 'hint',
            text: 'Your API key is stored in this browser’s local extension storage, never synced, and readable only by the background worker — never by the script running on web pages.',
          }),
          el('p', {
            class: 'hint',
            text: 'History stays on this device and can be cleared at any time.',
          }),
        ],
      }),
      el('section', {
        class: 'card',
        children: [
          el('span', { class: 'card-title', text: 'Open source' }),
          el('p', {
            class: 'hint',
            children: [
              el('span', { text: 'MIT licensed. Read every line at ' }),
              el('a', {
                text: 'github.com/Sina-Amare/promptamp',
                attrs: {
                  href: 'https://github.com/Sina-Amare/promptamp',
                  target: '_blank',
                  rel: 'noreferrer',
                },
              }),
              el('span', { text: '.' }),
            ],
          }),
        ],
      }),
    ],
  });
}

/* ── helpers ────────────────────────────────────────────────────── */

function download(filename: string, contents: string): void {
  const url = URL.createObjectURL(
    new Blob([contents], { type: 'application/json' }),
  );
  const link = el('a', { attrs: { href: url, download: filename } });
  link.click();
  URL.revokeObjectURL(url);
}

renderTabs();
void renderPanel();
