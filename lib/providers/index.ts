import type { ProviderTestResult } from '../messaging/protocol';
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
 * The provider's own model list, so the picker shows what the key can actually
 * reach rather than a table we would have to keep current by hand.
 */
export async function listModels(connectionId: string): Promise<string[]> {
  const connection = await getConnection(connectionId);
  if (!connection) return [];
  const config = getProvider(connection.providerId);
  if (!config.modelsPath) return [];

  const response = await fetch(
    endpointFor(config, connection, config.modelsPath),
    { headers: buildHeaders(config, connection.apiKey) },
  );
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
 * "Test" in the options page. One token of output is enough to prove the key,
 * the host, and the model name all work — and it costs essentially nothing,
 * which matters when the user is paying to check their own setup.
 */
export async function testConnection(
  connectionId: string,
  timeoutMs = 15_000,
): Promise<ProviderTestResult> {
  const connection = await getConnection(connectionId);
  if (!connection) {
    return { ok: false, error: toSafeError(errorFor('bad-key')) };
  }

  const config = getProvider(connection.providerId);
  if (config.requiresKey && !connection.apiKey) {
    return { ok: false, error: toSafeError(errorFor('bad-key')) };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    await chat(connection.providerId, {
      cred: connection,
      system: 'Reply with the single word OK.',
      user: 'OK',
      maxTokens: 1,
      signal: controller.signal,
      // A test is a diagnosis, not a delivery: waiting out a 60-second
      // Retry-After tells the user nothing they cannot already see.
      maxRetries: 0,
    });
    return { ok: true, model: connection.model };
  } catch (err) {
    const safe = toSafeError(err);
    // max_tokens: 1 legitimately truncates the reply — that still proves the
    // credential works, which is the only thing this routine is asking.
    if (safe.kind === 'too-long' || safe.kind === 'refusal') {
      return { ok: true, model: connection.model };
    }
    return { ok: false, error: safe };
  } finally {
    clearTimeout(timer);
  }
}

export type { Connection };
