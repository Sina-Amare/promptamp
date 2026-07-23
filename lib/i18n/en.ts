/**
 * The message catalogue, and the source of truth for its shape.
 *
 * Every other locale is typed against `Messages`, so a missing or misspelled
 * key is a build error rather than a blank label somebody notices in a
 * screenshot. English is not a fallback for the others — it is the schema.
 *
 * Deliberately not `browser.i18n`: that resolves against the *browser's*
 * locale and cannot be changed at runtime, but PromptAmp lets the user pick
 * their UI language independently (a Persian speaker on an English browser is
 * exactly the case that motivated the setting).
 *
 * Placeholders are `{name}`. Interpolation is positional-free on purpose —
 * translated sentences reorder, and a `%s` cannot.
 */

export const en = {
  /* ── the injected button (UX-SPEC §1) ─────────────────────────── */
  'button.tooShort': 'Write a prompt first',
  'button.dismiss': 'Hide PromptAmp',
  'button.idle': 'Enhance prompt — PromptAmp',
  'button.loading': 'Stop enhancing',
  'button.done': 'Prompt enhanced',
  'button.error': 'Enhancement failed — try again',
  'button.tip': 'Enhance prompt{profile} · Alt+E',
  /**
   * U+2068/U+2069 isolate the profile name. A Latin brand token sitting in a
   * line of other text can otherwise drag the surrounding words out of order;
   * `<bdi>` is unavailable because a tooltip is a plain-string context.
   */
  'button.tipProfile': ' · Profile: ⁨{name}⁩',

  /* ── the dismissal menu (§1.5) ────────────────────────────────── */
  'menu.hideUntilReload': 'Hide until next visit',
  'menu.hideOnSite': 'Hide on this site',
  'menu.hideEverywhere': 'Hide everywhere',
  'menu.settings': 'PromptAmp settings…',

  /* ── the preview panel (§2) ───────────────────────────────────── */
  'panel.title': 'Enhanced prompt',
  'panel.bodyAria': 'Enhanced prompt, editable',
  'panel.close': 'Close',
  'panel.changeProfile': 'Change profile',
  'panel.prevVersion': 'Previous version',
  'panel.nextVersion': 'Next version',
  'panel.busy': 'Enhancing prompt',
  'panel.ready': 'Enhanced version ready',
  'panel.unchanged': 'This already reads well',
  'panel.declineTitle': 'Nothing to enhance yet',
  'panel.declineBody':
    'This doesn’t look like a prompt yet. Type what you want to ask or make, then enhance it — your prompt is untouched.',
  'panel.accept': 'Replace prompt',
  'panel.copy': 'Copy',
  'panel.retry': 'Retry',
  'panel.discard': 'Discard',
  'panel.showChanges': 'Show changes',
  'panel.showOriginal': 'Original',
  'panel.adjustPlaceholder': 'Describe a change…',
  'panel.adjustAria': 'Describe a change',
  'panel.adjustShorter': 'Shorter',
  'panel.adjustLonger': 'Longer',
  'panel.adjustSpecific': 'More specific',
  'panel.structured': 'Structured',
  'panel.structuredHint':
    'Rewrite as a full structured prompt — role, task, requirements, output format',
  'panel.profileAuto': ' · auto',
  'panel.profilePinned': ' · pinned',
  'panel.copied': 'Copied',
  'panel.changeLanguage': 'Output language',
  'panel.langSame': 'Same as my text',

  /* ── errors (§4) ──────────────────────────────────────────────── */
  'error.badKey': 'API key problem',
  'error.badModel': 'Model unavailable',
  'error.rateLimited': 'Rate limited',
  'error.quota': 'Out of quota',
  'error.network': 'Connection problem',
  'error.refusal': 'Model declined',
  'error.tooLong': 'Prompt too long',
  'error.softCap': 'Daily limit reached',
  'error.cancelled': 'Cancelled',
  'error.unknown': 'Something went wrong',
  'error.draftSafe': 'Your prompt is unchanged.',
  'error.retryIn': 'Retry in {seconds}s',
  'error.fellBack': '{failed} failed — used {used} instead.',
  'error.noInsert':
    "This site's editor doesn't allow direct insertion — copy instead.",
  'error.copiedInstead':
    "This site's editor doesn't allow direct insertion — copied instead.",
  'error.reloaded': 'PromptAmp was updated. Refresh this page to use it.',

  /* ── popup ────────────────────────────────────────────────────── */
  'popup.setup': 'Add an API key to get started',
  'popup.profileHere': 'Profile on this site',
  'popup.profileAria': 'Profile for this site',
  'popup.profileAuto': 'Automatic',
  'popup.profilePinned': 'Pinned for this site.',
  'popup.profileUnpinned': 'Back to automatic.',
  'popup.hideHere': 'Hide on this site',
  'popup.showHere': 'Show on this site',
  'popup.pauseHour': 'Pause on all sites for 1 hour',
  'popup.resume': 'Paused — resume now',
  'popup.hideEverywhere': 'Hide everywhere',
  'popup.turnBackOn': 'Turn PromptAmp back on',
  'popup.settings': 'Settings…',
  'popup.notAvailable': 'Not available on this page',

  /* ── options: chrome ──────────────────────────────────────────── */
  'tab.providers': 'AI keys',
  'tab.profiles': 'Profiles',
  'tab.behavior': 'Preferences',
  'tab.history': 'History',
  'tab.about': 'About',

  /* Plain-language intro at the top of each settings tab — what it is FOR. */
  'intro.providers':
    'PromptAmp works with your own AI key — your prompts go straight to that AI, never through a server of ours. Add a provider and paste its key to get started. Add more than one and it automatically falls back when the first is busy or out of credit.',
  'intro.profiles':
    'A profile is how PromptAmp rewrites your prompt — a different one for chatting, image prompts, code, and so on. It picks the right profile for each site automatically. To change how one writes, make your own copy.',
  'intro.behavior':
    'Everyday options: the profile and language PromptAmp uses by default, a daily limit so it can’t run up your bill, and where to switch it off.',
  'intro.history': 'Every enhancement you have run, kept on this device only.',
  'common.save': 'Save',
  'common.saved': 'Saved',
  'common.saving': 'Saving…',
  'common.remove': 'Remove',
  'common.delete': 'Delete',
  'common.edit': 'Edit',
  'common.back': 'Back',
  'common.test': 'Test',
  'common.testing': 'Testing…',
  'common.loading': 'Loading…',
  'common.failed': 'Failed',
  'common.name': 'Name',
  'common.model': 'Model',

  /* ── options: connections ─────────────────────────────────────── */
  'conn.heading': 'Connections',
  'conn.chainOne':
    'Add a second connection and PromptAmp will fall back to it automatically when the first is rate-limited, out of credit, or unreachable.',
  'conn.chainMany':
    'PromptAmp uses the first connection. If it is rate-limited, out of credit, unreachable, or its key is rejected, the next one takes over automatically and the panel tells you it switched.',
  'conn.sameProviderWarning':
    'You have more than one connection to the same provider. That is fine for separate keys you genuinely hold — a free key and a paid one, or work and personal. Most providers do prohibit creating extra free accounts to get around their limits, and enforcement is on your account, so check their terms.',
  'conn.primary': 'Primary',
  'conn.fallback': 'Fallback {n}',
  'conn.connected': 'Connected',
  'conn.moveEarlier': 'Move {name} earlier in the fallback order',
  'conn.moveLater': 'Move {name} later in the fallback order',
  'conn.add': 'Add a connection',
  'conn.addButton': 'Add connection',
  'conn.addHint':
    'Each connection is one key and one model. Add as many as you like — they run in the order above.',
  'conn.addProvider': 'Provider for the new connection',
  'conn.oauthHint': 'Or sign in to OpenRouter without pasting a key:',
  'conn.oauthButton': 'Connect with OpenRouter',
  'conn.oauthOpening': 'Opening OpenRouter…',
  'conn.oauthDone': 'Connected',
  'conn.apiKey': 'API key',
  'conn.apiKeyOptional': 'API key (if required)',
  'conn.apiKeyPlaceholder': 'Paste your API key',
  'conn.apiKeySaved': '•••••••• saved',
  'conn.keyStorage':
    'Stored on this device only, readable only by the background worker.',
  'conn.serverUrl': 'Server URL',
  'conn.advanced': 'Advanced',
  'conn.loadModels': 'Load models',
  'conn.reloadModels': 'Reload models',
  'conn.loadingModels': 'Loading models…',
  'conn.modelsError': 'Could not load models — check the key or server URL.',
  'conn.checkUsage': 'Check usage',
  'conn.checkUsageRefresh': 'Refresh',
  'conn.checkingUsage': 'Checking…',
  'conn.usageError': 'Could not read usage.',
  'conn.modelsFound': '{n} models available',
  'conn.modelsNone': 'No models returned',
  /* The model control: one select when a list is loaded, else a text field. */
  'conn.modelCustom': 'Enter a model ID…',
  'conn.modelFromList': 'Choose from list',
  'conn.modelHintLoad': 'Type a model ID, or load the list to pick one.',
  'conn.modelHintKey': 'Save your key, then load the model list.',
  'conn.testNeedsKey': 'Add your API key first.',
  'conn.working': 'Working — {model}',
  'conn.getKey': 'Get a {provider} key →',
  'conn.permissionTitle': '{provider} needs your permission',
  'conn.permissionBody':
    'Your browser has not yet allowed PromptAmp to reach {host}. Until you allow it, requests will fail even though your key is correct.',
  'conn.permissionGrant': 'Allow access to {host}',
  'conn.permissionDenied':
    'Saved, but your browser declined access to that host — requests will fail until you allow it.',

  /* ── options: profiles ────────────────────────────────────────── */
  'profiles.builtin': 'Built-in profiles',
  'profiles.builtinHint':
    'These come with PromptAmp and get better with each update, so they can’t be edited directly. To change how one writes, press Customize to make your own editable copy.',
  'profiles.mine': 'Your custom profiles',
  'profiles.empty':
    'None yet — press Customize on a profile above to make one you can edit.',
  'profiles.fork': 'Customize',
  'profiles.copySuffix': '{name} (my copy)',
  'profiles.transfer': 'Import / export',
  'profiles.import': 'Import',
  'profiles.export': 'Export custom profiles',
  'profiles.importPlaceholder': 'Paste an exported profiles JSON here…',
  'profiles.imported': 'Imported {n} profile(s)',
  'profiles.importBadJson': 'That is not valid JSON.',
  'profiles.description': 'Description',
  'profiles.systemPrompt': 'System prompt',
  'profiles.editTitle': 'Edit {name}',
  'profiles.saveFailed': 'Could not save — check the name and prompt length.',

  /* ── options: behavior ────────────────────────────────────────── */
  'behavior.general': 'Defaults',
  'behavior.autoProfile': 'Automatically pick the best profile for each site',
  'behavior.defaultProfile': 'Default profile (used when auto-pick is off)',
  'behavior.hideEverywhere': 'Hide PromptAmp everywhere',
  'behavior.outputLanguage': 'Enhanced prompt language',
  'behavior.outputLanguagePlaceholder': 'Same language as my text',
  'lang.other': 'Other…',
  'lang.otherPlaceholder': 'e.g. Brazilian Portuguese',
  'behavior.outputLanguageHint':
    'Write your prompt in any language and get the enhanced prompt in this one. Leave it empty to keep your draft’s language — image and video prompts still go out in English, which is what those models are trained on.',
  'behavior.uiLanguage': 'PromptAmp’s own language',
  'behavior.uiLanguageAuto': 'Match my browser',
  'behavior.limits': 'Limits',
  'behavior.dailyLimit': 'Daily enhancement limit',
  'behavior.dailyLimitHint':
    'A guard against runaway usage on your own key. 0 turns it off.',
  'behavior.keepHistory': 'Keep a local history of enhancements',
  'behavior.hiddenSites': 'Hidden sites',
  'behavior.hiddenNone': 'PromptAmp is not hidden anywhere.',
  'behavior.showAgain': 'Show again',
  'behavior.shortcut': 'Keyboard shortcut',
  'behavior.shortcutHint':
    'Alt+E enhances the focused field. Change it at chrome://extensions/shortcuts.',

  /* ── options: history ─────────────────────────────────────────── */
  'history.local':
    'History lives on this device only. It is never uploaded anywhere.',
  'history.search': 'Search your history…',
  'history.export': 'Export',
  'history.clear': 'Clear history',
  'history.empty': 'Nothing here yet.',
  'history.tokens': '{n} tokens',

  /* ── options: about ───────────────────────────────────────────── */
  'about.privacy': 'Privacy',
  'about.privacyBody':
    'PromptAmp has no servers. Your prompts go directly from your browser to the provider you chose, using your key. Nothing is collected, and there is no analytics of any kind.',
  'about.keyBody':
    'Your API key is stored in this browser’s local extension storage, never synced, and readable only by the background worker — never by the script running on web pages.',
  'about.historyBody':
    'History stays on this device and can be cleared at any time.',
  'about.openSource': 'Open source',
  'about.mit': 'MIT licensed. Read every line at ',
} as const;

export type MessageKey = keyof typeof en;
export type Messages = Record<MessageKey, string>;
