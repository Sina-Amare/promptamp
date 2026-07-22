import {
  MAX_RETRIES,
  ProviderError,
  backoffMs,
  errorFor,
  mapStatus,
  parseRetryAfter,
} from './errors';
import {
  OLLAMA_ORIGIN_HINT,
  isOllamaOriginError,
  type ProviderConfig,
} from './registry';
import type { ChatRequest, ChatResponse } from './types';

/**
 * One code path for OpenAI, Groq, OpenRouter, Gemini, Ollama, and LM Studio.
 *
 * They all speak `/chat/completions`; the only differences (host, path, auth
 * header, token-limit field name) are data in the registry. Non-streaming for
 * v1 — the panel reserves its height from the draft length anyway (UX-SPEC
 * §2.3), so streaming buys perceived latency, not correctness, and is a later
 * change behind this same function.
 */

interface CompletionChoice {
  message?: { content?: unknown };
  finish_reason?: string;
}

interface CompletionBody {
  choices?: CompletionChoice[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string; type?: string };
}

export function buildHeaders(
  config: ProviderConfig,
  apiKey: string | undefined,
): Headers {
  const headers = new Headers({ 'content-type': 'application/json' });
  for (const [k, v] of Object.entries(config.extraHeaders ?? {})) {
    headers.set(k, v);
  }
  if (config.authStyle === 'bearer' && apiKey) {
    headers.set('authorization', `Bearer ${apiKey}`);
  } else if (config.authStyle === 'x-api-key' && apiKey) {
    headers.set('x-api-key', apiKey);
  }
  return headers;
}

export function endpointFor(
  config: ProviderConfig,
  cred: { baseUrl?: string | undefined },
  path = config.chatPath,
): string {
  // Only local runners may be redirected; a custom host for a remote provider
  // would be a way to exfiltrate the key to somewhere the user didn't choose.
  const base =
    config.allowsCustomBaseUrl && cred.baseUrl ? cred.baseUrl : config.baseUrl;
  return new URL(path, base).toString();
}

export const openaiCompatAdapter = async (
  req: ChatRequest,
): Promise<ChatResponse> => {
  const { config, cred, system, user, maxTokens, signal } = req;

  if (config.requiresKey && !cred.apiKey) throw errorFor('bad-key');

  const body: Record<string, unknown> = {
    model: cred.model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    stream: false,
    [config.maxTokensField]: maxTokens,
  };

  const response = await fetchWithRetry(
    endpointFor(config, cred),
    {
      method: 'POST',
      headers: buildHeaders(config, cred.apiKey),
      body: JSON.stringify(body),
      signal,
    },
    config,
  );

  const parsed = (await response.json()) as CompletionBody;
  const raw = parsed.choices?.[0]?.message?.content;
  const text = typeof raw === 'string' ? raw : '';

  if (!text.trim()) {
    // A stop that produced nothing is a refusal in practice, whatever the
    // provider called it — surfacing "empty response" would help nobody.
    throw errorFor('refusal');
  }

  return {
    text,
    ...(parsed.usage?.prompt_tokens === undefined
      ? {}
      : { promptTokens: parsed.usage.prompt_tokens }),
    ...(parsed.usage?.completion_tokens === undefined
      ? {}
      : { completionTokens: parsed.usage.completion_tokens }),
  };
};

/**
 * Shared by both adapters. Retries only 429 and only twice (principle 10):
 * a paid API call fires on explicit user action, so an automatic retry storm
 * would spend the user's money without them asking.
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  config: ProviderConfig,
): Promise<Response> {
  let lastError: ProviderError | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const response = await fetch(url, init);
    if (response.ok) return response;

    const bodyText = await response.text().catch(() => '');

    if (isOllamaOriginError(config.id, response.status)) {
      throw new ProviderError('network', OLLAMA_ORIGIN_HINT);
    }

    const kind = mapStatus(response.status, bodyText);
    const retryAfter = parseRetryAfter(response.headers.get('retry-after'));

    if (kind !== 'rate-limited' || attempt === MAX_RETRIES) {
      throw new ProviderError(
        kind,
        detailFrom(bodyText) ?? `HTTP ${String(response.status)}`,
        retryAfter,
      );
    }

    lastError = new ProviderError(kind, 'Rate limited.', retryAfter);
    await sleep(backoffMs(attempt, retryAfter), init.signal ?? null);
  }

  throw lastError ?? errorFor('unknown');
}

/** Pull the provider's own message out; it is usually the most specific text. */
function detailFrom(bodyText: string): string | null {
  try {
    const parsed: unknown = JSON.parse(bodyText);
    if (typeof parsed === 'object' && parsed !== null && 'error' in parsed) {
      const err: unknown = parsed.error;
      if (typeof err === 'string') return err;
      if (typeof err === 'object' && err !== null && 'message' in err) {
        const msg: unknown = err.message;
        if (typeof msg === 'string') return msg;
      }
    }
  } catch {
    // Not JSON — HTML error pages and proxy responses land here.
  }
  return null;
}

function sleep(ms: number, signal: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
