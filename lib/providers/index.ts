import type { ProviderTestResult } from '../messaging/protocol';
import { getCredential } from '../storage/credentials';
import type { ProviderCred, ProviderId } from '../storage/schemas';
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
 * The provider's own model list, so the picker shows what the key can actually
 * reach rather than a table we would have to keep current by hand.
 */
export async function listModels(providerId: ProviderId): Promise<string[]> {
  const config = getProvider(providerId);
  const cred = await getCredential(providerId);
  if (!config.modelsPath || !cred) return [];

  const response = await fetch(endpointFor(config, cred, config.modelsPath), {
    headers: buildHeaders(config, cred.apiKey),
  });
  if (!response.ok) return [];

  const body = (await response.json()) as {
    data?: { id?: unknown }[];
  };
  return (body.data ?? [])
    .map((entry) => entry.id)
    .filter((id): id is string => typeof id === 'string')
    .sort((a, b) => a.localeCompare(b));
}

/**
 * "Test key" in the options page. One token of output is enough to prove the
 * key, the host, and the model name all work — and it costs essentially
 * nothing, which matters when the user is paying to check their own setup.
 */
export async function testProvider(
  providerId: ProviderId,
  timeoutMs = 15_000,
): Promise<ProviderTestResult> {
  const cred = await getCredential(providerId);
  const config = getProvider(providerId);

  if (!cred) {
    return { ok: false, error: toSafeError(errorFor('bad-key')) };
  }
  if (config.requiresKey && !cred.apiKey) {
    return { ok: false, error: toSafeError(errorFor('bad-key')) };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    await chat(providerId, {
      cred,
      system: 'Reply with the single word OK.',
      user: 'OK',
      maxTokens: 1,
      signal: controller.signal,
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
