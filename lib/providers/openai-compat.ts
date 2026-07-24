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
    // Provider-specific fields first, so the essentials below always win.
    ...(config.extraBody ?? {}),
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

  // Diagnostic: shows the outgoing shape (never the key) so a stuck provider is
  // debuggable from the service-worker console — e.g. whether reasoning_effort
  // is actually being sent to Gemini.
  console.info('[PromptAmp] →', config.id, {
    model: body.model,
    stream: body.stream,
    reasoning_effort: body.reasoning_effort,
    [config.maxTokensField]: maxTokens,
  });

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
    req.onRetryWait,
  );

  console.info(
    '[PromptAmp] ←',
    config.id,
    response.status,
    response.ok ? 'ok' : 'FAILED',
  );

  req.onHeaders?.(response.headers);
  req.onActivity?.();

  if (streaming) {
    return readSse(response, onChunk, req.onActivity);
  }

  const parsed = (await response.json()) as CompletionBody;
  if (parsed.error) throw errorFromEmbeddedFrame(parsed.error);
  const finishReason = parsed.choices?.[0]?.finish_reason;
  assertCompleteFinish(finishReason);
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
  onActivity?: () => void,
): Promise<ChatResponse> {
  const body = response.body;
  if (!body) throw errorFor('network');

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let promptTokens: number | undefined;
  let completionTokens: number | undefined;
  let finishReason: string | undefined;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      // The tail is whatever has not been terminated yet.
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        processSseLine(line);
      }
    }
    buffer += decoder.decode();
    processSseLine(buffer);
  } finally {
    // Abort mid-stream leaves the reader open otherwise, which keeps the
    // connection — and on some providers the billing — alive.
    reader.cancel().catch(() => undefined);
  }

  assertCompleteFinish(finishReason);
  if (!text.trim()) throw errorFor('refusal');

  return {
    text,
    ...(promptTokens === undefined ? {} : { promptTokens }),
    ...(completionTokens === undefined ? {} : { completionTokens }),
  };

  function processSseLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) return;
    const payload = trimmed.slice(5).trim();
    if (payload === '' || payload === '[DONE]') return;

    let frame: StreamFrame;
    try {
      frame = JSON.parse(payload) as StreamFrame;
    } catch {
      return;
    }
    onActivity?.();
    if (frame.error) throw errorFromEmbeddedFrame(frame.error);

    const choice = frame.choices?.[0];
    finishReason = choice?.finish_reason ?? finishReason;
    const delta = choice?.delta?.content;
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

interface StreamFrame {
  choices?: {
    delta?: { content?: unknown };
    finish_reason?: string | null;
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: unknown;
}

function assertCompleteFinish(reason: string | null | undefined): void {
  if (reason === 'length' || reason === 'max_tokens') {
    throw errorFor('too-long', 'The rewrite was cut off. Try a shorter draft.');
  }
  if (
    reason === 'content_filter' ||
    reason === 'content-filter' ||
    reason === 'refusal'
  ) {
    throw errorFor('refusal');
  }
}

/**
 * Successful HTTP responses can still carry provider errors inside JSON/SSE.
 * Classify those with the same actionable kinds as ordinary HTTP failures.
 */
export function errorFromEmbeddedFrame(value: unknown): ProviderError {
  const record =
    typeof value === 'object' && value !== null
      ? (value as Record<string, unknown>)
      : {};
  const message =
    typeof value === 'string'
      ? value
      : typeof record.message === 'string'
        ? record.message
        : 'The provider returned an error while streaming.';
  const code =
    typeof record.type === 'string'
      ? record.type
      : typeof record.code === 'string'
        ? record.code
        : '';
  const detail = `${code} ${message}`;
  const status = typeof record.status === 'number' ? record.status : undefined;
  let kind =
    status === undefined ? mapStatus(0, detail) : mapStatus(status, detail);

  if (/auth|api.?key|unauthor|forbidden/i.test(detail)) kind = 'bad-key';
  else if (/quota|credit|billing|insufficient/i.test(detail)) kind = 'quota';
  else if (/rate.?limit|too many requests/i.test(detail)) kind = 'rate-limited';
  else if (
    /model.+(?:not|invalid|unknown|unavailable)|invalid.+model/i.test(detail)
  )
    kind = 'bad-model';
  else if (/context|too long|max(?:imum)?.*token/i.test(detail))
    kind = 'too-long';
  else if (/content.?filter|moderation|refusal|refused/i.test(detail))
    kind = 'refusal';
  else if (/overload|server|network|unavailable|timeout/i.test(detail))
    kind = 'network';

  return new ProviderError(kind, message);
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
  onRetryWait?: (delayMs: number) => void,
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
    const delayMs = backoffMs(attempt, retryAfter);
    onRetryWait?.(delayMs);
    await sleep(delayMs, init.signal ?? null);
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
