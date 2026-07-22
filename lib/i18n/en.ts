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
  'button.tooShort': 'Write a draft first',
  'button.dismiss': 'Hide PromptAmp',

  /* ── the dismissal menu (§1.5) ────────────────────────────────── */
  'menu.hideUntilReload': 'Hide until next visit',
  'menu.hideOnSite': 'Hide on this site',
  'menu.hideEverywhere': 'Hide everywhere',
  'menu.settings': 'PromptAmp settings…',

  /* ── the preview panel (§2) ───────────────────────────────────── */
  'panel.title': 'Enhanced draft',
  'panel.bodyAria': 'Enhanced draft, editable',
  'panel.close': 'Close',
  'panel.changeProfile': 'Change profile',
  'panel.prevVersion': 'Previous version',
  'panel.nextVersion': 'Next version',
  'panel.busy': 'Enhancing draft',
  'panel.ready': 'Enhanced version ready',
  'panel.unchanged': 'This already reads well',
  'panel.accept': 'Replace draft',
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
  'panel.profileAuto': ' · auto',

  /* ── undo (§2.5) ──────────────────────────────────────────────── */
  'undo.replaced': 'Draft replaced',
  'undo.action': 'Undo',
  'undo.announce': 'Draft replaced — press Undo to restore.',

  /* ── errors (§4) ──────────────────────────────────────────────── */
  'error.badKey': 'API key problem',
  'error.badModel': 'Model unavailable',
  'error.rateLimited': 'Rate limited',
  'error.quota': 'Out of quota',
  'error.network': 'Connection problem',
  'error.refusal': 'Model declined',
  'error.tooLong': 'Draft too long',
  'error.softCap': 'Daily limit reached',
  'error.cancelled': 'Cancelled',
  'error.unknown': 'Something went wrong',
  'error.draftSafe': 'Your draft is unchanged.',
  'error.retryIn': 'Retry in {seconds}s',
  'error.fellBack': '{failed} failed — used {used} instead.',
  'error.noInsert':
    "This site's editor doesn't allow direct insertion — copy instead.",
  'error.copiedInstead':
    "This site's editor doesn't allow direct insertion — copied instead.",

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
  'tab.providers': 'Providers',
  'tab.profiles': 'Profiles',
  'tab.behavior': 'Behavior',
  'tab.history': 'History',
  'tab.about': 'About',
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
  'conn.loadModels': 'Load models',
  'conn.modelsFound': '{n} models available',
  'conn.modelsNone': 'No models returned',
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
    'Improved with each update, so they are read-only. Fork one to customise it.',
  'profiles.mine': 'Your profiles',
  'profiles.empty': 'No custom profiles yet.',
  'profiles.fork': 'Fork',
  'profiles.copySuffix': '{name} (copy)',
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
  'behavior.general': 'General',
  'behavior.autoProfile': 'Pick a profile automatically from the site',
  'behavior.defaultProfile': 'Default profile',
  'behavior.hideEverywhere': 'Hide PromptAmp everywhere',
  'behavior.outputLanguage': 'Enhanced prompt language',
  'behavior.outputLanguagePlaceholder': 'Same language as my draft',
  'behavior.outputLanguageHint':
    'Write your draft in any language and get the enhanced prompt in this one. Leave it empty to keep your draft’s language — image and video prompts still go out in English, which is what those models are trained on.',
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
    'PromptAmp has no servers. Your drafts go directly from your browser to the provider you chose, using your key. Nothing is collected, and there is no analytics of any kind.',
  'about.keyBody':
    'Your API key is stored in this browser’s local extension storage, never synced, and readable only by the background worker — never by the script running on web pages.',
  'about.historyBody':
    'History stays on this device and can be cleared at any time.',
  'about.openSource': 'Open source',
  'about.mit': 'MIT licensed. Read every line at ',
} as const;

export type MessageKey = keyof typeof en;
export type Messages = Record<MessageKey, string>;
