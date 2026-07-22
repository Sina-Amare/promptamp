import type { ProviderId } from '../storage/schemas';

/**
 * Every provider difference lives in this table, so adding one is a data change
 * rather than a new code path. Only two request shapes exist behind it:
 * OpenAI-compatible chat completions, and Anthropic's Messages API.
 */

export interface ProviderConfig {
  id: ProviderId;
  label: string;
  /** Which adapter builds the request. */
  kind: 'openai-compat' | 'anthropic' | 'mock';
  baseUrl: string;
  chatPath: string;
  authStyle: 'bearer' | 'x-api-key' | 'none';
  extraHeaders?: Record<string, string>;
  /**
   * Starting point only — the options page fetches the live list from
   * `modelsPath` and the user picks. Defaults are re-verified at Gate 1.
   */
  defaultModel: string;
  modelsPath?: string;
  /**
   * OpenAI moved to `max_completion_tokens`; every other OpenAI-compatible
   * server still expects `max_tokens`.
   */
  maxTokensField: 'max_tokens' | 'max_completion_tokens';
  /** Local runners have no key. Absence of a key is not a misconfiguration. */
  requiresKey: boolean;
  /** Local runners may be pointed somewhere else; remote hosts may not. */
  allowsCustomBaseUrl: boolean;
  /** Untagged — no referral parameters, ever (principle 12). */
  setupUrl: string;
}

export const PROVIDERS: Record<ProviderId, ProviderConfig> = {
  openai: {
    id: 'openai',
    label: 'OpenAI',
    kind: 'openai-compat',
    baseUrl: 'https://api.openai.com',
    chatPath: '/v1/chat/completions',
    authStyle: 'bearer',
    defaultModel: 'gpt-4o-mini',
    modelsPath: '/v1/models',
    maxTokensField: 'max_completion_tokens',
    requiresKey: true,
    allowsCustomBaseUrl: false,
    setupUrl: 'https://platform.openai.com/api-keys',
  },

  anthropic: {
    id: 'anthropic',
    label: 'Anthropic',
    kind: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    chatPath: '/v1/messages',
    authStyle: 'x-api-key',
    extraHeaders: {
      'anthropic-version': '2023-06-01',
      // Without this the API rejects requests whose Origin is an extension.
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    defaultModel: 'claude-opus-4-8',
    modelsPath: '/v1/models',
    maxTokensField: 'max_tokens',
    requiresKey: true,
    allowsCustomBaseUrl: false,
    setupUrl: 'https://console.anthropic.com/settings/keys',
  },

  groq: {
    id: 'groq',
    label: 'Groq',
    kind: 'openai-compat',
    baseUrl: 'https://api.groq.com',
    chatPath: '/openai/v1/chat/completions',
    authStyle: 'bearer',
    defaultModel: 'llama-3.3-70b-versatile',
    modelsPath: '/openai/v1/models',
    maxTokensField: 'max_tokens',
    requiresKey: true,
    allowsCustomBaseUrl: false,
    setupUrl: 'https://console.groq.com/keys',
  },

  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    kind: 'openai-compat',
    baseUrl: 'https://openrouter.ai',
    chatPath: '/api/v1/chat/completions',
    authStyle: 'bearer',
    defaultModel: 'openai/gpt-4o-mini',
    modelsPath: '/api/v1/models',
    maxTokensField: 'max_tokens',
    requiresKey: true,
    allowsCustomBaseUrl: false,
    setupUrl: 'https://openrouter.ai/keys',
  },

  gemini: {
    id: 'gemini',
    label: 'Google Gemini',
    kind: 'openai-compat',
    // Google ships an OpenAI-compatible surface, so Gemini needs no adapter.
    baseUrl: 'https://generativelanguage.googleapis.com',
    chatPath: '/v1beta/openai/chat/completions',
    authStyle: 'bearer',
    defaultModel: 'gemini-2.0-flash',
    modelsPath: '/v1beta/openai/models',
    maxTokensField: 'max_tokens',
    requiresKey: true,
    allowsCustomBaseUrl: false,
    setupUrl: 'https://aistudio.google.com/apikey',
  },

  ollama: {
    id: 'ollama',
    label: 'Ollama (local)',
    kind: 'openai-compat',
    baseUrl: 'http://localhost:11434',
    chatPath: '/v1/chat/completions',
    authStyle: 'none',
    defaultModel: 'llama3.2',
    modelsPath: '/v1/models',
    maxTokensField: 'max_tokens',
    requiresKey: false,
    allowsCustomBaseUrl: true,
    setupUrl: 'https://ollama.com/download',
  },

  lmstudio: {
    id: 'lmstudio',
    label: 'LM Studio (local)',
    kind: 'openai-compat',
    baseUrl: 'http://localhost:1234',
    chatPath: '/v1/chat/completions',
    authStyle: 'none',
    defaultModel: 'local-model',
    modelsPath: '/v1/models',
    maxTokensField: 'max_tokens',
    requiresKey: false,
    allowsCustomBaseUrl: true,
    setupUrl: 'https://lmstudio.ai/',
  },

  mock: {
    id: 'mock',
    label: 'Mock (offline)',
    kind: 'mock',
    baseUrl: 'about:blank',
    chatPath: '',
    authStyle: 'none',
    defaultModel: 'mock-1',
    maxTokensField: 'max_tokens',
    requiresKey: false,
    allowsCustomBaseUrl: false,
    setupUrl: '',
  },
};

/** Providers offered in the options UI. `mock` exists only for dev and e2e. */
export const USER_FACING_PROVIDERS: ProviderId[] = (
  Object.keys(PROVIDERS) as ProviderId[]
).filter((id) => id !== 'mock');

export function getProvider(id: ProviderId): ProviderConfig {
  return PROVIDERS[id];
}

/**
 * Ollama rejects cross-origin requests unless it was started with an allowed
 * origin, and the 403 it returns says nothing useful. Detect it and hand the
 * user the exact command instead.
 */
export function isOllamaOriginError(id: ProviderId, status: number): boolean {
  return (id === 'ollama' || id === 'lmstudio') && status === 403;
}

export const OLLAMA_ORIGIN_HINT =
  'Ollama blocked the request. Restart it with OLLAMA_ORIGINS="chrome-extension://*" to allow browser extensions.';
