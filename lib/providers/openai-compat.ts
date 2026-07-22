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
  const { config, cred, system, user, maxTokens, signal, onChunk, maxRetries } =
    req;

  if (config.requiresKey && !cred.apiKey) throw errorFor('bad-key');
  if (!cred.model) throw errorFor('bad-model', 'No model chosen.');

  const streaming = onChunk !== undefined;

  const body: Record<string, unknown> = {
    model: cred.model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    stream: streaming,
    // Ask for usage on the final SSE frame; providers that ignore this simply
    // return no usage, and the cost readout degrades to a token count.
    ...(streaming ? { stream_options: { include_usage: true } } : {}),
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
    maxRetries,
  );

  if (streaming) return readSse(response, onChunk);

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
 * Reads an OpenAI-style SSE body.
 *
 * Frames arrive split across network chunks, so a partial line has to be held
 * back rather than parsed — a half-frame is not malformed JSON to report, it is
 * simply not finished yet.
 */
async function readSse(
  response: Response,
  onChunk: (delta: string) => void,
): Promise<ChatResponse> {
  const body = response.body;
  if (!body) throw errorFor('network');

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let promptTokens: number | undefined;
  let completionTokens: number | undefined;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      // The tail is whatever has not been terminated yet.
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === '' || payload === '[DONE]') continue;

        let frame: StreamFrame;
        try {
          frame = JSON.parse(payload) as StreamFrame;
        } catch {
          continue;
        }

        const delta = frame.choices?.[0]?.delta?.content;
        if (typeof delta === 'string' && delta !== '') {
          text += delta;
          onChunk(delta);
        }
        if (frame.usage) {
          promptTokens = frame.usage.prompt_tokens ?? promptTokens;
          completionTokens = frame.usage.completion_tokens ?? completionTokens;
        }
      }
    }
  } finally {
    // Abort mid-stream leaves the reader open otherwise, which keeps the
    // connection — and on some providers the billing — alive.
    reader.cancel().catch(() => undefined);
  }

  if (!text.trim()) throw errorFor('refusal');

  return {
    text,
    ...(promptTokens === undefined ? {} : { promptTokens }),
    ...(completionTokens === undefined ? {} : { completionTokens }),
  };
}

interface StreamFrame {
  choices?: { delta?: { content?: unknown } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/**
 * Shared by both adapters. Retries only 429 and only twice (principle 10):
 * a paid API call fires on explicit user action, so an automatic retry storm
 * would spend the user's money without them asking.
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  config: ProviderConfig,
  maxRetries: number = MAX_RETRIES,
): Promise<Response> {
  let lastError: ProviderError | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, init);
    if (response.ok) return response;

    const bodyText = await response.text().catch(() => '');

    if (isOllamaOriginError(config.id, response.status)) {
      throw new ProviderError('network', OLLAMA_ORIGIN_HINT);
    }

    const kind = mapStatus(response.status, bodyText);
    const retryAfter = parseRetryAfter(response.headers.get('retry-after'));

    if (kind !== 'rate-limited' || attempt === maxRetries) {
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
