import { BUILTIN_PROFILES } from '../../lib/enhance/prompts';
import { type MessageKey, t } from '../../lib/i18n';
import { sendMessage } from '../../lib/messaging/client';
import { missingPermissions, requestPermission } from '../../lib/permissions';
import type {
  ConfiguredConnection,
  ModelInfo,
  UsageInfo,
} from '../../lib/messaging/protocol';
import { PROVIDERS, USER_FACING_PROVIDERS } from '../../lib/providers/registry';
import { formatCostUsd } from '../../lib/providers/cost';
import type {
  HistoryEntry,
  Profile,
  ProviderId,
} from '../../lib/storage/schemas';
import { el, svg } from '../../lib/ui/host';

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

const TABS: { id: TabId; key: MessageKey }[] = [
  { id: 'providers', key: 'tab.providers' },
  { id: 'profiles', key: 'tab.profiles' },
  { id: 'behavior', key: 'tab.behavior' },
  { id: 'history', key: 'tab.history' },
  { id: 'about', key: 'tab.about' },
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
        text: t(tab.key),
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

/** The tab currently painted — so a re-render of the *same* tab can keep the
 * user's scroll position, while a genuine tab switch still starts at the top. */
let renderedTab: TabId | null = null;

async function renderPanel(): Promise<void> {
  // Saving rebuilds the whole tab; without this the page snaps to the top and
  // the user has to scroll back down to the card they were working in.
  const sameTab = renderedTab === active;
  const scrollY = window.scrollY;

  panel.replaceChildren(el('p', { class: 'empty', text: t('common.loading') }));
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

  renderedTab = active;
  if (sameTab) window.scrollTo(0, scrollY);
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

/**
 * A connection is one credential: a provider, a key, and a model.
 *
 * The list is ordered, and the order is the fallback order — first entry runs,
 * later entries take over when it cannot. That is why reordering is a visible
 * control rather than a consequence of when things were added.
 */
async function providersTab(): Promise<HTMLElement> {
  const connections = await sendMessage({ type: 'connections:list' });

  const stack = el('div', { class: 'stack' });
  stack.append(el('p', { class: 'section-intro', text: t('intro.providers') }));

  // Firefox grants host permissions only on request. Without this, a valid key
  // fails every call and looks exactly like a bad key.
  const blocked = await missingPermissions(
    connections.map((c) => ({
      providerId: c.providerId,
      ...(c.baseUrl === undefined ? {} : { baseUrl: c.baseUrl }),
    })),
  );
  const savedBaseUrls = new Map(
    connections.map((c) => [c.providerId, c.baseUrl]),
  );
  for (const id of blocked) {
    stack.append(permissionCard(id, savedBaseUrls.get(id)));
  }

  stack.append(chainSummary(connections));

  connections.forEach((connection, index) => {
    stack.append(connectionCard(connection, index, connections));
  });

  stack.append(addConnectionCard(connections));

  return stack;
}

/**
 * Firefox does not grant host permissions at install time, so a perfectly good
 * key fails every call until the user allows the host — and the failure looks
 * exactly like a bad key. This card is what makes the difference visible.
 */
function permissionCard(id: ProviderId, baseUrl?: string): HTMLElement {
  const config = PROVIDERS[id];
  const host = hostnameOf(baseUrl ?? config.baseUrl);

  const grant = el('button', {
    class: 'primary',
    text: t('conn.permissionGrant', { host }),
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
        text: t('conn.permissionTitle', { provider: config.label }),
      }),
      el('p', {
        class: 'notice',
        text: t('conn.permissionBody', { host }),
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

/**
 * States the rule the ordering encodes, once, where the ordering is.
 *
 * Also the one place the multi-account question gets an honest answer. A user
 * adding several keys at one provider deserves to know their provider's terms
 * before they discover them by being suspended — and saying so plainly is also
 * what keeps this feature legible as resilience rather than quota evasion.
 */
function chainSummary(connections: ConfiguredConnection[]): HTMLElement {
  const sameProvider = connections.some(
    (c, i) => connections.findIndex((o) => o.providerId === c.providerId) !== i,
  );

  return el('section', {
    class: 'card',
    children: [
      el('span', { class: 'card-title', text: t('conn.heading') }),
      el('p', {
        class: 'hint',
        text:
          connections.length > 1
            ? 'PromptAmp uses the first connection. If it is rate-limited, out of credit, unreachable, or its key is rejected, the next one takes over automatically and the panel tells you it switched.'
            : 'Add a second connection and PromptAmp will fall back to it automatically when the first is rate-limited, out of credit, or unreachable.',
      }),
      sameProvider
        ? el('p', {
            class: 'notice',
            text: 'You have more than one connection to the same provider. That is fine for separate keys you genuinely hold — a free key and a paid one, or work and personal. Most providers do prohibit creating extra free accounts to get around their limits, and enforcement is on your account, so check their terms.',
          })
        : null,
    ],
  });
}

/**
 * Fetched model lists and usage, cached so they survive the re-render a save
 * triggers and are not re-fetched on every paint. Keyed by connection id.
 */
const modelCache = new Map<string, ModelInfo[]>();
const usageCache = new Map<string, UsageInfo>();

/**
 * Fetch this connection's models into the cache. Pure cache populator — it
 * never renders or flashes, so callers repaint only the slot that changed and
 * a typed-but-unsaved key elsewhere in the card is never wiped. Returns whether
 * a non-empty list came back.
 */
async function loadModelsFor(connectionId: string): Promise<boolean> {
  try {
    const models = await sendMessage({
      type: 'connection:models',
      connectionId,
    });
    modelCache.set(connectionId, models);
    return models.length > 0;
  } catch {
    return false;
  }
}

/** Fetch this connection's usage into the cache. Cache-only; see above. */
async function loadUsageFor(connectionId: string): Promise<boolean> {
  try {
    usageCache.set(
      connectionId,
      await sendMessage({ type: 'connection:usage', connectionId }),
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * A bare <select> of the cached models — free and paid split into their own
 * groups where the provider reports pricing (OpenRouter), otherwise one group.
 * No placeholder option and no change listener: the caller owns both, because
 * it also injects the "current" and "custom" options and drives the source of
 * truth (the model text input).
 */
function buildModelSelect(models: ModelInfo[]): HTMLSelectElement {
  const opt = (m: ModelInfo): HTMLElement =>
    el('option', { text: m.id, attrs: { value: m.id } });

  const select = el('select', { attrs: { 'aria-label': t('common.model') } });
  if (models.some((m) => m.free !== undefined)) {
    const free = models.filter((m) => m.free);
    const paid = models.filter((m) => !m.free);
    if (free.length) {
      select.append(
        el('optgroup', {
          attrs: { label: `Free (${String(free.length)})` },
          children: free.map(opt),
        }),
      );
    }
    if (paid.length) {
      select.append(
        el('optgroup', {
          attrs: { label: `Paid (${String(paid.length)})` },
          children: paid.map(opt),
        }),
      );
    }
  } else {
    select.append(
      el('optgroup', {
        attrs: { label: `Models (${String(models.length)})` },
        children: models.map(opt),
      }),
    );
  }
  return select;
}

/**
 * The usage readout as text + optional link + a health signal — as much as the
 * provider's API is willing to say. `health` drives the status dot: `warn` when
 * a balance or rate window is nearly exhausted, `muted` when nothing is
 * reported, `ok` otherwise. Spends no amber — the dot is semantic only.
 */
function usageReadout(u: UsageInfo): {
  text: string;
  link: HTMLElement | null;
  health: 'ok' | 'warn' | 'muted';
} {
  const money = (n: number): string => `$${n.toFixed(n < 1 ? 4 : 2)}`;
  const low = (remaining: number, limit: number): boolean =>
    remaining === 0 || (limit > 0 && remaining / limit < 0.15);

  let text: string;
  let link: HTMLElement | null = null;
  let health: 'ok' | 'warn' | 'muted' = 'ok';

  if (u.kind === 'credit') {
    if (u.limitUsd !== null && u.remainingUsd !== null) {
      // A funded account — a dollar balance is the meaningful number.
      text = `${money(u.remainingUsd)} of ${money(u.limitUsd)} credit left`;
      if (low(u.remainingUsd, u.limitUsd)) health = 'warn';
    } else if (u.freeTier) {
      // On the free tier, spend is meaningless — what matters is the per-day
      // request cap, which OpenRouter does not expose through its API. Say that
      // honestly and send the user to where the live count actually lives.
      text = 'Free tier — free models are capped per day.';
      link = el('a', {
        text: ' See your usage →',
        attrs: {
          href: 'https://openrouter.ai/activity',
          target: '_blank',
          rel: 'noreferrer',
        },
      });
    } else {
      text = `${money(u.usedMonthlyUsd)} used this month`;
    }
  } else if (u.kind === 'rate') {
    const parts: string[] = [];
    if (u.requestsRemaining !== undefined) {
      parts.push(
        u.requestsLimit !== undefined
          ? `${String(u.requestsRemaining)} of ${String(u.requestsLimit)} requests left`
          : `${String(u.requestsRemaining)} requests left`,
      );
      if (
        u.requestsLimit !== undefined
          ? low(u.requestsRemaining, u.requestsLimit)
          : u.requestsRemaining === 0
      ) {
        health = 'warn';
      }
    }
    if (u.tokensRemaining !== undefined) {
      parts.push(`${u.tokensRemaining.toLocaleString()} tokens left`);
    }
    if (u.resetSeconds !== undefined) {
      parts.push(`resets in ${String(Math.round(u.resetSeconds))}s`);
    }
    text = parts.join(' · ') || 'Rate limits reported';
  } else {
    text = "This provider's API doesn't report usage.";
    health = 'muted';
    if (u.hintUrl) {
      link = el('a', {
        text: ' Check in Google AI Studio →',
        attrs: { href: u.hintUrl, target: '_blank', rel: 'noreferrer' },
      });
    }
  }

  return { text, link, health };
}

function connectionCard(
  connection: ConfiguredConnection,
  index: number,
  all: ConfiguredConnection[],
): HTMLElement {
  const config = PROVIDERS[connection.providerId];
  const status = el('p', { class: 'status' });

  if (flash?.cardTitle === connection.id) {
    status.textContent = flash.text;
    status.className = `status ${flash.kind}`;
    flash = null;
  }

  const labelInput = el('input', {
    attrs: { type: 'text', maxlength: '48', spellcheck: 'false' },
  });
  labelInput.value = connection.label;

  const keyInput = el('input', {
    attrs: {
      type: 'password',
      autocomplete: 'off',
      spellcheck: 'false',
      // The saved key is never sent back to this page — only the fact of it.
      placeholder: connection.hasKey ? '•••••••• saved' : 'Paste your API key',
    },
  });

  // The single source of truth for the chosen model. It is never rebuilt — the
  // model <select> is a shortcut that writes into it — so a typed-but-unsaved
  // custom id survives every in-place repaint. Shown alone only when there is
  // no list to pick from, or when the user asks to type a custom id.
  const modelInput = el('input', {
    class: 'reveal',
    attrs: {
      type: 'text',
      spellcheck: 'false',
      placeholder: config.defaultModel,
      'aria-label': t('common.model'),
    },
  });
  modelInput.value = connection.model;
  modelInput.addEventListener('change', () => {
    modelInput.value = modelInput.value.trim();
  });

  const baseUrlInput = el('input', {
    attrs: { type: 'url', placeholder: config.baseUrl, spellcheck: 'false' },
  });
  if (connection.baseUrl) baseUrlInput.value = connection.baseUrl;

  const setStatus = (text: string, kind: '' | 'ok' | 'err' | 'info'): void => {
    status.textContent = text;
    status.className = `status ${kind}`;
  };

  const save = el('button', {
    class: 'primary',
    text: t('common.save'),
    attrs: { type: 'button' },
  });
  save.addEventListener('click', () => {
    void (async () => {
      // In-flight feedback: the button itself says what is happening and a
      // second click cannot double-submit. The re-render on completion
      // restores it.
      save.disabled = true;
      save.textContent = t('common.saving');
      setStatus(t('common.saving'), '');
      const keyInputHadValue = keyInput.value.trim().length > 0;

      // A user-supplied host is not covered by the manifest, so ask for it
      // here — inside the click, which is the only place Firefox allows it.
      if (config.allowsCustomBaseUrl && baseUrlInput.value.trim()) {
        const granted = await requestPermission(
          connection.providerId,
          baseUrlInput.value.trim(),
        );
        if (!granted) {
          setStatus(t('conn.permissionDenied'), 'err');
        }
      }

      await sendMessage({
        type: 'connection:save',
        connection: {
          id: connection.id,
          providerId: connection.providerId,
          label: labelInput.value.trim() || config.label,
          // An empty field means "keep the stored key", never "erase it".
          ...(keyInput.value ? { apiKey: keyInput.value } : {}),
          model: modelInput.value.trim() || config.defaultModel,
          ...(config.allowsCustomBaseUrl && baseUrlInput.value
            ? { baseUrl: baseUrlInput.value.trim() }
            : {}),
        },
      });
      keyInput.value = '';

      // The moment a key is in place, fetch the model list so the user picks
      // from a real dropdown instead of typing an id. Populate the cache first,
      // then flash "Saved" and repaint once — the re-render reads the cache and
      // shows the dropdown, and a failed fetch quietly leaves the text field.
      const hasKey = keyInputHadValue || connection.hasKey;
      if (hasKey || !config.requiresKey) {
        await loadModelsFor(connection.id);
      }

      flash = { cardTitle: connection.id, text: t('common.saved'), kind: 'ok' };
      await renderPanel();
    })();
  });

  const test = el('button', {
    class: 'secondary',
    text: t('common.test'),
    attrs: { type: 'button' },
  });
  test.addEventListener('click', () => {
    void (async () => {
      // Test what the user is looking at. A typed-but-unsaved key is tested as
      // the candidate, so "Test before Save" just works. With no key anywhere,
      // say so as calm guidance — never a red "rejected".
      const typedKey = keyInput.value.trim();
      if (!typedKey && !connection.hasKey && config.requiresKey) {
        setStatus(t('conn.testNeedsKey'), 'info');
        return;
      }
      // In-flight feedback on the button itself; no double-fire.
      test.disabled = true;
      test.textContent = t('common.testing');
      setStatus(t('common.testing'), '');
      try {
        const result = await sendMessage({
          type: 'connection:test',
          connectionId: connection.id,
          ...(typedKey ? { apiKey: typedKey } : {}),
          ...(modelInput.value.trim()
            ? { model: modelInput.value.trim() }
            : {}),
        });
        setStatus(
          result.ok
            ? t('conn.working', { model: result.model ?? '' })
            : [result.error?.message, result.error?.remedy]
                .filter(Boolean)
                .join(' '),
          result.ok ? 'ok' : 'err',
        );
      } finally {
        test.disabled = false;
        test.textContent = t('common.test');
      }
    })();
  });

  // ── The model control + usage: one self-contained "connection health"
  // instrument. Reload and Check-usage repaint only their own slot — never the
  // whole panel — so a typed-but-unsaved key elsewhere in the card survives.
  const control = el('div', { class: 'field-control' });
  const caption = el('p', { class: 'field-note' });
  const reloadLabel = el('span');
  const reload = el('button', {
    class: 'link-btn',
    attrs: { type: 'button' },
    children: [
      el('span', {
        class: 'reload-icon',
        children: [
          svg('svg', { viewBox: '0 0 16 16', width: '12', height: '12' }, [
            svg('path', {
              d: 'M13 8a5 5 0 1 1-1.5-3.5M13 2v3h-3',
              fill: 'none',
              stroke: 'currentColor',
              'stroke-width': '1.6',
              'stroke-linecap': 'round',
              'stroke-linejoin': 'round',
            }),
          ]),
        ],
      }),
      reloadLabel,
    ],
  });
  const usageRow = el('div', { class: 'usage-row' });
  const health = el('div', {
    class: 'conn-health',
    children: [
      el('div', {
        class: 'field-head',
        children: [
          el('span', { class: 'field-label', text: t('common.model') }),
          reload,
        ],
      }),
      control,
      caption,
      usageRow,
    ],
  });

  // Repaints ONLY the model control + its caption, from the cache. One of
  // {select, text input} is in the DOM at a time — never both (the old
  // duplicate). A saved/typed id absent from the list is kept as a "· current"
  // option so it can never silently vanish.
  function paintModel(): void {
    const models = modelCache.get(connection.id);
    const canLoad = connection.hasKey || !config.requiresKey;
    reloadLabel.textContent = models?.length
      ? t('conn.reloadModels')
      : t('conn.loadModels');
    reload.disabled = !canLoad;
    health.classList.remove('loading');

    if (!models?.length) {
      control.replaceChildren(modelInput);
      caption.replaceChildren(
        el('span', {
          text: canLoad ? t('conn.modelHintLoad') : t('conn.modelHintKey'),
        }),
      );
      return;
    }

    const select = buildModelSelect(models);
    const inList = models.some((m) => m.id === modelInput.value);
    if (!inList && modelInput.value) {
      select.insertBefore(
        el('option', {
          text: `${modelInput.value} · current`,
          attrs: { value: modelInput.value },
        }),
        select.firstChild,
      );
    }
    select.append(
      el('option', {
        text: t('conn.modelCustom'),
        attrs: { value: '__custom__' },
      }),
    );
    select.value = modelInput.value;
    control.replaceChildren(select);
    caption.replaceChildren(
      el('span', { text: t('conn.modelsFound', { n: String(models.length) }) }),
    );

    select.addEventListener('change', () => {
      if (select.value === '__custom__') {
        // Leaving a listed pick starts a fresh field; an already-typed custom
        // id is kept.
        modelInput.value = inList ? '' : modelInput.value;
        control.replaceChildren(modelInput);
        modelInput.focus();
        const back = el('button', {
          class: 'link-btn',
          text: t('conn.modelFromList'),
          attrs: { type: 'button' },
        });
        back.addEventListener('click', paintModel);
        caption.replaceChildren(back);
      } else {
        modelInput.value = select.value;
      }
    });
  }

  // Repaints ONLY the usage row: a health dot, the readout, and a Check-usage /
  // Refresh action pinned to the trailing edge.
  function paintUsage(): void {
    const u = usageCache.get(connection.id);
    const check = el('button', {
      class: 'link-btn',
      attrs: { type: 'button' },
      text: u ? t('conn.checkUsageRefresh') : t('conn.checkUsage'),
    });
    check.addEventListener('click', () => {
      check.disabled = true;
      check.textContent = t('conn.checkingUsage');
      void (async () => {
        const ok = await loadUsageFor(connection.id);
        if (!ok) setStatus(t('conn.usageError'), 'err');
        paintUsage();
      })();
    });
    if (!u) {
      usageRow.replaceChildren(
        el('span', { class: 'usage-dot muted' }),
        el('span', { class: 'usage-text', text: '—' }),
        check,
      );
      return;
    }
    const { text, link, health: dot } = usageReadout(u);
    usageRow.replaceChildren(
      el('span', { class: `usage-dot ${dot}` }),
      el('span', { class: 'usage-text', text }),
      ...(link ? [link] : []),
      check,
    );
  }

  reload.addEventListener('click', () => {
    if (reload.disabled) return;
    reloadLabel.textContent = t('conn.loadingModels');
    reload.disabled = true;
    health.classList.add('loading');
    void (async () => {
      const ok = await loadModelsFor(connection.id);
      if (!ok) setStatus(t('conn.modelsError'), 'err');
      paintModel();
    })();
  });

  paintModel();
  paintUsage();

  const remove = el('button', {
    class: 'danger',
    text: t('common.remove'),
    attrs: { type: 'button' },
  });
  remove.addEventListener('click', () => {
    void (async () => {
      await sendMessage({
        type: 'connection:delete',
        connectionId: connection.id,
      });
      await renderPanel();
    })();
  });

  const actions = el('div', {
    class: 'row actions',
    children: [save, test, remove],
  });

  // Everything the common case (one key, a known provider with a sensible
  // default model) does not need is tucked behind a native disclosure — Name,
  // the custom Server URL, and the model fetcher. Collapsed by default, so a
  // fresh card shows four controls, not eight.
  const advanced = el('details', {
    class: 'advanced',
    children: [
      el('summary', { text: t('conn.advanced') }),
      el('div', {
        class: 'advanced-body',
        children: [
          el('label', {
            children: [el('span', { text: t('common.name') }), labelInput],
          }),
          config.allowsCustomBaseUrl
            ? el('label', {
                children: [
                  el('span', { text: t('conn.serverUrl') }),
                  baseUrlInput,
                ],
              })
            : null,
        ],
      }),
    ],
  });

  return el('section', {
    class: 'card',
    children: [
      el('div', {
        class: 'card-head',
        children: [
          el('span', { class: 'card-title', text: connection.label }),
          el('span', {
            class: index === 0 ? 'badge' : 'badge muted',
            text:
              index === 0
                ? t('conn.primary')
                : t('conn.fallback', { n: index }),
          }),
          connection.authMethod === 'oauth'
            ? el('span', { class: 'badge muted', text: t('conn.connected') })
            : null,
          reorderControls(connection, index, all),
        ],
      }),
      PROVIDER_NOTES[connection.providerId]
        ? el('p', {
            class: 'notice',
            text: PROVIDER_NOTES[connection.providerId]!,
          })
        : null,
      config.requiresKey || config.keyOptional
        ? el('label', {
            children: [
              el('span', {
                text: config.requiresKey
                  ? t('conn.apiKey')
                  : t('conn.apiKeyOptional'),
              }),
              keyInput,
              el('span', {
                class: 'hint',
                text: t('conn.keyStorage'),
              }),
            ],
          })
        : null,
      health,
      actions,
      status,
      advanced,
      config.setupUrl
        ? el('p', {
            class: 'hint',
            children: [
              el('a', {
                text: t('conn.getKey', { provider: config.label }),
                attrs: {
                  href: config.setupUrl,
                  target: '_blank',
                  rel: 'noreferrer',
                },
              }),
            ],
          })
        : null,
    ],
  });
}

/**
 * Buttons rather than drag-and-drop. Reordering a three-item list is not worth
 * a pointer-only interaction that a keyboard or screen-reader user cannot
 * perform at all.
 */
function reorderControls(
  connection: ConfiguredConnection,
  index: number,
  all: ConfiguredConnection[],
): HTMLElement {
  const move = (delta: number): void => {
    void (async () => {
      const ids = all.map((c) => c.id);
      const [moved] = ids.splice(index, 1);
      ids.splice(index + delta, 0, moved!);
      await sendMessage({ type: 'connections:reorder', ids });
      await renderPanel();
    })();
  };

  const up = el('button', {
    class: 'quiet',
    text: '↑',
    attrs: {
      type: 'button',
      title: t('conn.moveEarlier', { name: connection.label }),
      'aria-label': t('conn.moveEarlier', { name: connection.label }),
    },
  });
  up.disabled = index === 0;
  up.addEventListener('click', () => {
    move(-1);
  });

  const down = el('button', {
    class: 'quiet',
    text: '↓',
    attrs: {
      type: 'button',
      title: t('conn.moveLater', { name: connection.label }),
      'aria-label': t('conn.moveLater', { name: connection.label }),
    },
  });
  down.disabled = index === all.length - 1;
  down.addEventListener('click', () => {
    move(1);
  });

  return el('div', { class: 'reorder', children: [up, down] });
}

function addConnectionCard(existing: ConfiguredConnection[]): HTMLElement {
  const picker = el('select', {
    attrs: { 'aria-label': t('conn.addProvider') },
  });
  for (const id of USER_FACING_PROVIDERS) {
    picker.append(
      el('option', { text: PROVIDERS[id].label, attrs: { value: id } }),
    );
  }

  const add = el('button', {
    class: 'primary',
    text: t('conn.addButton'),
    attrs: { type: 'button' },
  });
  add.addEventListener('click', () => {
    void (async () => {
      const providerId = picker.value as ProviderId;
      const config = PROVIDERS[providerId];
      // Numbered only when it would otherwise collide, so the common case of
      // one key per provider gets a clean name.
      const sameProvider = existing.filter(
        (c) => c.providerId === providerId,
      ).length;
      await sendMessage({
        type: 'connection:save',
        connection: {
          id: crypto.randomUUID(),
          providerId,
          label: sameProvider
            ? `${config.label} ${String(sameProvider + 1)}`
            : config.label,
          model: config.defaultModel,
        },
      });
      await renderPanel();
    })();
  });

  const connect = el('button', {
    class: 'secondary',
    text: t('conn.oauthButton'),
    attrs: { type: 'button' },
  });
  const connectStatus = el('p', { class: 'status' });
  connect.addEventListener('click', () => {
    void (async () => {
      connectStatus.textContent = t('conn.oauthOpening');
      connectStatus.className = 'status';
      const result = await sendMessage({
        type: 'connection:connectOpenRouter',
      });
      connectStatus.textContent = result.ok
        ? t('conn.oauthDone')
        : (result.error?.message ?? t('common.failed'));
      connectStatus.className = `status ${result.ok ? 'ok' : 'err'}`;
      if (result.ok) await renderPanel();
    })();
  });

  return el('section', {
    class: 'card',
    children: [
      el('span', { class: 'card-title', text: t('conn.add') }),
      el('p', {
        class: 'hint',
        text: t('conn.addHint'),
      }),
      el('div', { class: 'row', children: [picker, add] }),
      el('p', {
        class: 'hint',
        text: t('conn.oauthHint'),
      }),
      el('div', { class: 'row', children: [connect] }),
      connectStatus,
    ],
  });
}

/* ── profiles ───────────────────────────────────────────────────── */

async function profilesTab(): Promise<HTMLElement> {
  const profiles = await sendMessage({ type: 'profiles:list' });
  const custom = profiles.filter((p) => !p.builtIn);
  const status = el('p', { class: 'status' });

  const importArea = el('textarea', {
    attrs: { placeholder: t('profiles.importPlaceholder') },
  });

  const importBtn = el('button', {
    class: 'secondary',
    text: t('profiles.import'),
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
        status.textContent = t('profiles.importBadJson');
        status.className = 'status err';
      }
    })();
  });

  const exportBtn = el('button', {
    class: 'quiet',
    text: t('profiles.export'),
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
      el('p', { class: 'section-intro', text: t('intro.profiles') }),
      el('section', {
        class: 'card',
        children: [
          el('span', { class: 'card-title', text: t('profiles.builtin') }),
          el('p', {
            class: 'hint',
            text: t('profiles.builtinHint'),
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
          el('span', { class: 'card-title', text: t('profiles.mine') }),
          custom.length === 0
            ? el('p', { class: 'empty', text: t('profiles.empty') })
            : el('div', {
                class: 'list',
                children: custom.map((profile) => customRow(profile)),
              }),
        ],
      }),
      el('section', {
        class: 'card',
        children: [
          el('span', { class: 'card-title', text: t('profiles.transfer') }),
          importArea,
          el('div', { class: 'row', children: [importBtn, exportBtn] }),
          status,
        ],
      }),
    ],
  });
}

function builtinRow(profile: Profile, custom: Profile[]): HTMLElement {
  const customize = el('button', {
    class: 'secondary',
    text: t('profiles.fork'),
    attrs: { type: 'button' },
  });
  customize.addEventListener('click', () => {
    void (async () => {
      // A distinct id, so the copy is a new profile and the built-in survives
      // the next update untouched.
      let id = `${profile.id}-copy`;
      let n = 2;
      while (custom.some((p) => p.id === id))
        id = `${profile.id}-copy-${String(n++)}`;

      const copy: Profile = {
        ...profile,
        id,
        name: t('profiles.copySuffix', { name: profile.name }),
        builtIn: false,
      };
      await sendMessage({ type: 'profiles:save', profile: copy });
      // Open the editor straight away — "customize" means "edit", so drop the
      // user where the editing actually happens instead of in a list.
      panel.replaceChildren(profileEditor(copy));
    })();
  });

  return el('div', {
    class: 'list-item',
    children: [
      el('span', { text: `${profile.name} — ${profile.description}` }),
      customize,
    ],
  });
}

function customRow(profile: Profile): HTMLElement {
  const edit = el('button', {
    class: 'secondary',
    text: t('common.edit'),
    attrs: { type: 'button' },
  });
  const remove = el('button', {
    class: 'danger',
    text: t('common.delete'),
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
    text: t('common.save'),
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
        status.textContent = t('profiles.saveFailed');
        status.className = 'status err';
      }
    })();
  });

  const back = el('button', {
    class: 'quiet',
    text: t('common.back'),
    attrs: { type: 'button' },
  });
  back.addEventListener('click', () => {
    void renderPanel();
  });

  return el('section', {
    class: 'card',
    children: [
      el('span', {
        class: 'card-title',
        text: t('profiles.editTitle', { name: profile.name }),
      }),
      el('label', { children: [el('span', { text: t('common.name') }), name] }),
      el('label', {
        children: [
          el('span', { text: t('profiles.description') }),
          description,
        ],
      }),
      el('label', {
        children: [el('span', { text: t('profiles.systemPrompt') }), prompt],
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
    t('behavior.autoProfile'),
    settings.autoProfile,
    (checked) => ({ autoProfile: checked }),
  );

  const globallyHidden = checkbox(
    t('behavior.hideEverywhere'),
    settings.globallyHidden,
    (checked) => ({ globallyHidden: checked }),
  );

  const historyEnabled = checkbox(
    t('behavior.keepHistory'),
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

  // A reliable native <select> beats a datalist combobox (which renders
  // inconsistently and often shows nothing on click). An "Other…" option
  // reveals a text field, so "Brazilian Portuguese" or "formal Japanese" —
  // which no fixed list contains — are still one type away.
  const OTHER = '__other__';
  const savedLang = settings.outputLanguageOverride;

  const langSelect = el('select', {
    attrs: { 'aria-label': t('behavior.outputLanguage') },
  });
  langSelect.append(
    el('option', {
      text: t('behavior.outputLanguagePlaceholder'),
      attrs: { value: '' },
    }),
    ...OUTPUT_LANGUAGES.map((name) =>
      el('option', { text: name, attrs: { value: name } }),
    ),
    el('option', { text: t('lang.other'), attrs: { value: OTHER } }),
  );

  const langOther = el('input', {
    class: 'reveal',
    attrs: {
      type: 'text',
      spellcheck: 'false',
      maxlength: '40',
      placeholder: t('lang.otherPlaceholder'),
      'aria-label': t('behavior.outputLanguage'),
    },
  });
  langOther.hidden = true;

  // Initial state — a previously-saved custom language reopens on "Other…" with
  // its input shown and pre-filled, so nothing ever looks lost.
  if (!savedLang) {
    langSelect.value = '';
  } else if (OUTPUT_LANGUAGES.includes(savedLang)) {
    langSelect.value = savedLang;
  } else {
    langSelect.value = OTHER;
    langOther.value = savedLang;
    langOther.hidden = false;
  }

  const patchLang = (value: string): void => {
    void sendMessage({
      type: 'settings:patch',
      patch: { outputLanguageOverride: value },
    });
  };

  langSelect.addEventListener('change', () => {
    if (langSelect.value === OTHER) {
      langOther.hidden = false;
      langOther.focus(); // wait for the typed value before patching
    } else {
      langOther.hidden = true;
      langOther.value = '';
      patchLang(langSelect.value); // '' = same as draft, or a curated language
    }
  });
  langOther.addEventListener('change', () => {
    const value = langOther.value.trim();
    if (!value) {
      // Emptied under "Other…" honestly means "same as my draft".
      langSelect.value = '';
      langOther.hidden = true;
    }
    patchLang(value);
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
      el('p', { class: 'section-intro', text: t('intro.behavior') }),
      el('section', {
        class: 'card',
        children: [
          el('span', { class: 'card-title', text: t('behavior.general') }),
          autoProfile,
          el('label', {
            children: [
              el('span', { text: t('behavior.defaultProfile') }),
              defaultProfile,
            ],
          }),
          el('label', {
            children: [
              el('span', { text: t('behavior.outputLanguage') }),
              langSelect,
              langOther,
              el('span', {
                class: 'hint',
                text: t('behavior.outputLanguageHint'),
              }),
            ],
          }),
          globallyHidden,
        ],
      }),
      el('section', {
        class: 'card',
        children: [
          el('span', { class: 'card-title', text: t('behavior.limits') }),
          el('label', {
            children: [
              el('span', { text: t('behavior.dailyLimit') }),
              softCap,
              el('span', {
                class: 'hint',
                text: t('behavior.dailyLimitHint'),
              }),
            ],
          }),
          historyEnabled,
        ],
      }),
      el('section', {
        class: 'card',
        children: [
          el('span', { class: 'card-title', text: t('behavior.hiddenSites') }),
          hiddenOrigins.length === 0
            ? el('p', {
                class: 'empty',
                text: t('behavior.hiddenNone'),
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
          el('span', { class: 'card-title', text: t('behavior.shortcut') }),
          el('p', {
            class: 'hint',
            text: t('behavior.shortcutHint'),
          }),
        ],
      }),
    ],
  });
}

function hiddenRow(origin: string): HTMLElement {
  const restore = el('button', {
    class: 'secondary',
    text: t('behavior.showAgain'),
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
    attrs: { type: 'text', placeholder: t('history.search') },
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
        ? [el('p', { class: 'empty', text: t('history.empty') })]
        : matching.map(historyEntry)),
    );
  };

  search.addEventListener('input', () => {
    paint(search.value);
  });
  paint('');

  const exportBtn = el('button', {
    class: 'secondary',
    text: t('history.export'),
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
    text: t('history.clear'),
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
      el('p', { class: 'section-intro', text: t('intro.history') }),
      el('section', {
        class: 'card',
        children: [
          el('p', {
            class: 'hint',
            text: t('history.local'),
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
          el('span', { class: 'card-title', text: t('about.privacy') }),
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
          el('span', { class: 'card-title', text: t('about.openSource') }),
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
