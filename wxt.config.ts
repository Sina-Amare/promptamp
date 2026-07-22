import { defineConfig } from 'wxt';

/**
 * Provider API hosts. Kept deliberately narrow and separate from the content
 * script's `<all_urls>` match list — the worker is the only thing that talks to
 * these, and reviewers can read this list in one glance.
 */
const PROVIDER_API_HOSTS = [
  'https://api.openai.com/*',
  'https://api.anthropic.com/*',
  'https://api.groq.com/*',
  'https://openrouter.ai/*',
  'https://generativelanguage.googleapis.com/*',
  // Local model runners (Ollama / LM Studio defaults).
  'http://localhost:11434/*',
  'http://127.0.0.1:11434/*',
  'http://localhost:1234/*',
  'http://127.0.0.1:1234/*',
];

export default defineConfig({
  // Explicit imports only. Auto-imports save keystrokes but cost auditability,
  // and this extension asks users to trust it with an API key.
  imports: false,

  manifest: {
    name: 'PromptAmp',
    short_name: 'PromptAmp',
    description:
      'Turn rough drafts into engineered prompts with one tap, in any text field. Bring your own API key — no backend, no telemetry.',
    version: '0.1.0',

    // Every size is emitted rather than left to the browser: Chrome scales
    // 128 down to 16 badly enough that a thin arc turns to grey mush.
    // Regenerate with `pnpm icons` after editing `assets/icon.svg`.
    icons: {
      16: 'icon/icon-16.png',
      32: 'icon/icon-32.png',
      48: 'icon/icon-48.png',
      128: 'icon/icon-128.png',
    },

    action: {
      default_title: 'PromptAmp',
      default_icon: {
        16: 'icon/icon-16.png',
        32: 'icon/icon-32.png',
        48: 'icon/icon-48.png',
        128: 'icon/icon-128.png',
      },
    },

    permissions: [
      'storage',
      'activeTab',
      'contextMenus',
      'commands',
      'scripting',
      'identity',
    ],

    host_permissions: PROVIDER_API_HOSTS,

    // For the "Custom (OpenAI-compatible)" provider only.
    //
    // Optional, not granted at install: the install-time prompt stays the
    // narrow list above, and a user who points PromptAmp at their own
    // endpoint grants exactly that one host, on a click, at the moment they
    // save it. Requesting every https host up front would be a far worse
    // trade for both the user and store review.
    optional_host_permissions: [
      'https://*/*',
      'http://localhost/*',
      'http://127.0.0.1/*',
    ],

    commands: {
      'enhance-prompt': {
        suggested_key: { default: 'Alt+E' },
        description: 'Enhance the prompt in the focused text field',
      },
    },

    browser_specific_settings: {
      gecko: {
        id: 'promptamp@sina-amare.github.io',
        // MV3 + `identity.launchWebAuthFlow` both need 115+.
        strict_min_version: '115.0',
        // AMO requires this from 2025-11-03. PromptAmp has no backend and
        // collects nothing for itself, but the draft text (websiteContent)
        // and the key used to authenticate (authenticationInfo) do leave the
        // browser — bound for the provider the user chose, nobody else.
        data_collection_permissions: {
          required: ['websiteContent', 'authenticationInfo'],
        },
      },
    },
  },
});
