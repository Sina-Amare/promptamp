import type {
  ModelInfo,
  ProviderTestResult,
  UsageInfo,
} from '../messaging/protocol';
import { getConnection } from '../storage/credentials';
import type { Connection, ProviderCred, ProviderId } from '../storage/schemas';
import { anthropicAdapter } from './anthropic';
import { errorFor, toSafeError } from './errors';
import { mockAdapter } from './mock';
import {
  buildHeaders,
  endpointFor,
  openaiCompatAdapter,
} from './openai-compat';
import { getProvider } from './registry';
import type { ChatAdapter, ChatRequest, ChatResponse } from './types';

export { PROVIDERS, USER_FACING_PROVIDERS, getProvider } from './registry';
export type { ProviderConfig } from './registry';
export type { ChatRequest, ChatResponse } from './types';

const ADAPTERS: Record<'openai-compat' | 'anthropic' | 'mock', ChatAdapter> = {
  'openai-compat': openaiCompatAdapter,
  anthropic: anthropicAdapter,
  mock: mockAdapter,
};

export function adapterFor(providerId: ProviderId): ChatAdapter {
  return ADAPTERS[getProvider(providerId).kind];
}

export async function chat(
  providerId: ProviderId,
  args: Omit<ChatRequest, 'config' | 'cred'> & { cred: ProviderCred },
): Promise<ChatResponse> {
  const config = getProvider(providerId);
  return adapterFor(providerId)({ ...args, config });
}

/**
 * Non-text models to keep out of the picker. PromptAmp edits prompts, so an
 * image, audio, embedding, moderation, or rerank model is never a valid choice
 * and only clutters a list that already runs to hundreds.
 *
 * This id heuristic is the fallback. Where the API reports modalities
 * (OpenRouter), that is used instead — see `isTextModel`.
 */
const NON_TEXT_MODEL =
  /(embed|whisper|transcrib|speech|\btts\b|audio|dall-?e|imagen|image|sdxl|stable-diffusion|\bflux\b|\bveo\b|\bsora\b|rerank|moderat|guard|\bocr\b)/i;

function isTextModel(
  id: string,
  outputModalities?: readonly string[],
): boolean {
  // Reliable when present (OpenRouter): keep only models that can output text.
  if (outputModalities && outputModalities.length > 0) {
    return outputModalities.includes('text');
  }
  return !NON_TEXT_MODEL.test(id);
}

export interface RawModel {
  id?: unknown;
  pricing?: { prompt?: unknown; completion?: unknown };
  architecture?: { output_modalities?: unknown };
}

/**
 * Turn a provider's raw `/models` payload into the picker's list: text models
 * only, sorted, with `free` set only where pricing is reported (OpenRouter).
 * Pure, so the filtering and free/paid split are unit-tested without a network.
 */
export function parseModels(data: RawModel[]): ModelInfo[] {
  return data
    .flatMap((entry): ModelInfo[] => {
      if (typeof entry.id !== 'string') return [];

      const modalities = Array.isArray(entry.architecture?.output_modalities)
        ? (entry.architecture.output_modalities as unknown[]).filter(
            (m): m is string => typeof m === 'string',
          )
        : undefined;
      if (!isTextModel(entry.id, modalities)) return [];

      const info: ModelInfo = { id: entry.id };
      // A model is free only when both prompt and completion cost nothing —
      // some paid models zero one side but not the other.
      const p = entry.pricing;
      if (p && (p.prompt !== undefined || p.completion !== undefined)) {
        info.free = Number(p.prompt) === 0 && Number(p.completion) === 0;
      }
      return [info];
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * The provider's own model list, filtered to text models, so the picker shows
 * what the key can actually reach rather than a table we would keep current by
 * hand.
 */
export async function listModels(connectionId: string): Promise<ModelInfo[]> {
  const connection = await getConnection(connectionId);
  if (!connection) return [];
  const config = getProvider(connection.providerId);
  if (!config.modelsPath) return [];

  // Bounded: this runs inside the save flow, so a slow or unreachable provider
  // must not hang the page.
  let response: Response;
  try {
    response = await fetch(endpointFor(config, connection, config.modelsPath), {
      headers: buildHeaders(config, connection.apiKey),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return [];
  }
  if (!response.ok) return [];

  const body = (await response.json()) as { data?: RawModel[] };
  return parseModels(body.data ?? []);
}

/**
 * What a key's usage/quota looks like — as much as each provider's API is
 * willing to say, which is a lot for OpenRouter and nothing for Gemini.
 */
export async function fetchUsage(connectionId: string): Promise<UsageInfo> {
  const connection = await getConnection(connectionId);
  if (!connection) return { kind: 'unavailable' };

  // OpenRouter: a real key endpoint with spend, monthly usage, limit and the
  // free-tier flag — the one crystal-clear case.
  if (connection.providerId === 'openrouter' && connection.apiKey) {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/key', {
        headers: { Authorization: `Bearer ${connection.apiKey}` },
      });
      if (!res.ok) return { kind: 'unavailable' };
      const { data } = (await res.json()) as {
        data?: {
          usage?: number;
          usage_monthly?: number;
          limit?: number | null;
          limit_remaining?: number | null;
          is_free_tier?: boolean;
        };
      };
      return {
        kind: 'credit',
        freeTier: data?.is_free_tier ?? false,
        usedUsd: data?.usage ?? 0,
        usedMonthlyUsd: data?.usage_monthly ?? 0,
        limitUsd: data?.limit ?? null,
        remainingUsd: data?.limit_remaining ?? null,
      };
    } catch {
      return { kind: 'unavailable' };
    }
  }

  // Groq / OpenAI / Anthropic / custom: no balance endpoint, but a live request
  // carries rate-limit headers. Reuse the one-token Test call for it.
  const config = getProvider(connection.providerId);
  if (config.kind === 'openai-compat' || config.kind === 'anthropic') {
    const headers = await probeRateLimitHeaders(connection);
    if (headers) return headers;
  }

  // Gemini and local runners expose nothing about a key's quota.
  const hintUrl =
    connection.providerId === 'gemini'
      ? 'https://aistudio.google.com/app/apikey'
      : undefined;
  return hintUrl ? { kind: 'unavailable', hintUrl } : { kind: 'unavailable' };
}

/**
 * Read rate-limit headers off a minimal live request. Both the OpenAI-style
 * (`x-ratelimit-*`) and Anthropic-style (`anthropic-ratelimit-*`) names are
 * checked, since the two families spell them differently.
 */
async function probeRateLimitHeaders(
  connection: Connection,
): Promise<UsageInfo | null> {
  if (!connection.apiKey && getProvider(connection.providerId).requiresKey) {
    return null;
  }

  let h: Headers | null = null;
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, 12_000);
  try {
    await chat(connection.providerId, {
      cred: connection,
      system: 'Reply with the single word OK.',
      user: 'OK',
      maxTokens: 1,
      signal: controller.signal,
      maxRetries: 0,
      onHeaders: (headers) => {
        h = headers;
      },
    });
  } catch {
    // A refusal/too-long still delivered headers via onHeaders; any other
    // failure leaves h null and we report unavailable.
  } finally {
    clearTimeout(timer);
  }

  if (!h) return null;
  const headers: Headers = h;

  const num = (...names: string[]): number | undefined => {
    for (const n of names) {
      const v = headers.get(n);
      if (v !== null && v !== '' && Number.isFinite(Number(v))) {
        return Number(v);
      }
    }
    return undefined;
  };

  const requestsRemaining = num(
    'x-ratelimit-remaining-requests',
    'anthropic-ratelimit-requests-remaining',
  );
  const requestsLimit = num(
    'x-ratelimit-limit-requests',
    'anthropic-ratelimit-requests-limit',
  );
  const tokensRemaining = num(
    'x-ratelimit-remaining-tokens',
    'anthropic-ratelimit-tokens-remaining',
  );
  const tokensLimit = num(
    'x-ratelimit-limit-tokens',
    'anthropic-ratelimit-tokens-limit',
  );
  const resetSeconds = num('x-ratelimit-reset-requests', 'retry-after');

  // Nothing useful came back — report unavailable rather than an empty box.
  if (requestsRemaining === undefined && tokensRemaining === undefined) {
    return null;
  }

  // Built with conditional spreads to satisfy exactOptionalPropertyTypes.
  return {
    kind: 'rate',
    ...(requestsRemaining !== undefined ? { requestsRemaining } : {}),
    ...(requestsLimit !== undefined ? { requestsLimit } : {}),
    ...(tokensRemaining !== undefined ? { tokensRemaining } : {}),
    ...(tokensLimit !== undefined ? { tokensLimit } : {}),
    ...(resetSeconds !== undefined ? { resetSeconds } : {}),
  };
}

/**
 * "Test" in the options page. One token of output is enough to prove the key,
 * the host, and the model name all work — and it costs essentially nothing,
 * which matters when the user is paying to check their own setup.
 */
export async function testConnection(
  connectionId: string,
  opts: { apiKey?: string; model?: string; timeoutMs?: number } = {},
): Promise<ProviderTestResult> {
  const { apiKey, model, timeoutMs = 15_000 } = opts;
  const connection = await getConnection(connectionId);
  if (!connection) {
    return { ok: false, error: toSafeError(errorFor('bad-key')) };
  }

  // Test what the user is looking at, not only what is saved: a key or model
  // typed into the options form but not yet saved overrides the stored one, so
  // "Test" answers "does my current setup work?" without a save-first dance.
  const cred: Connection = {
    ...connection,
    ...(apiKey ? { apiKey } : {}),
    ...(model ? { model } : {}),
  };

  const config = getProvider(cred.providerId);
  if (config.requiresKey && !cred.apiKey) {
    return { ok: false, error: toSafeError(errorFor('bad-key')) };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    await chat(cred.providerId, {
      cred,
      system: 'Reply with the single word OK.',
      user: 'OK',
      maxTokens: 1,
      signal: controller.signal,
      // A test is a diagnosis, not a delivery: waiting out a 60-second
      // Retry-After tells the user nothing they cannot already see.
      maxRetries: 0,
    });
    return { ok: true, model: cred.model };
  } catch (err) {
    const safe = toSafeError(err);
    // max_tokens: 1 legitimately truncates the reply — that still proves the
    // credential works, which is the only thing this routine is asking.
    if (safe.kind === 'too-long' || safe.kind === 'refusal') {
      return { ok: true, model: cred.model };
    }
    return { ok: false, error: safe };
  } finally {
    clearTimeout(timer);
  }
}

export type { Connection };
