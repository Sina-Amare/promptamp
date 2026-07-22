import { ProviderError, errorFor } from './errors';
import { buildHeaders, endpointFor, fetchWithRetry } from './openai-compat';
import type { ChatRequest, ChatResponse } from './types';

/**
 * Anthropic's Messages API differs from the OpenAI shape in four ways that
 * matter here:
 *
 * 1. The system prompt is a top-level `system` field, not a message role.
 * 2. `max_tokens` is required, not optional.
 * 3. The reply is an array of content blocks, so text must be flattened.
 * 4. A declined request returns **HTTP 200** with `stop_reason: "refusal"` —
 *    reading `content[0]` without checking that first would blow up on an
 *    empty array.
 *
 * Note what is deliberately absent: no `temperature`, `top_p`, or `top_k`.
 * Current Claude models reject those with a 400, and a rewrite task has no use
 * for them. `thinking` is likewise omitted — the models run without it, which
 * is what a sub-second rewrite wants.
 */

interface AnthropicContentBlock {
  type: string;
  text?: string;
}

interface AnthropicBody {
  content?: AnthropicContentBlock[];
  stop_reason?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
}

export const anthropicAdapter = async (
  req: ChatRequest,
): Promise<ChatResponse> => {
  const { config, cred, system, user, maxTokens, signal, onChunk } = req;

  if (!cred.apiKey) throw errorFor('bad-key');

  const streaming = onChunk !== undefined;

  const response = await fetchWithRetry(
    endpointFor(config, cred),
    {
      method: 'POST',
      headers: buildHeaders(config, cred.apiKey),
      body: JSON.stringify({
        model: cred.model,
        max_tokens: maxTokens,
        // A cache breakpoint on the system prompt, which is byte-identical on
        // every call — exactly the shape caching wants.
        //
        // Measured honestly: these prompts run ~1.1k tokens, which is *below*
        // the minimum cacheable prefix on most current models (2048, and 4096
        // on Opus-tier), so today this is usually a no-op. It is kept because
        // it costs nothing when it does not apply, it already works on models
        // with a lower threshold, and it starts paying the moment a profile's
        // prompt grows past the floor. What it must never become is a claimed
        // speed-up nobody measured.
        system: [
          { type: 'text', text: system, cache_control: { type: 'ephemeral' } },
        ],
        messages: [{ role: 'user', content: user }],
        ...(streaming ? { stream: true } : {}),
      }),
      signal,
    },
    config,
  );

  if (streaming) return readAnthropicSse(response, onChunk);

  const parsed = (await response.json()) as AnthropicBody;

  // Check the stop reason before touching content: a refusal returns 200 with
  // an empty (pre-output) or partial (mid-stream) content array.
  if (parsed.stop_reason === 'refusal') {
    throw new ProviderError(
      'refusal',
      'The model declined to rewrite this draft.',
    );
  }

  const text = flattenContent(parsed.content);

  if (!text.trim()) throw errorFor('refusal');

  if (parsed.stop_reason === 'max_tokens') {
    // Better to fail than to hand back a rewrite that stops mid-sentence —
    // the draft stays untouched either way (principle 8).
    throw errorFor('too-long', 'The rewrite was cut off. Try a shorter draft.');
  }

  return {
    text,
    ...(parsed.usage?.input_tokens === undefined
      ? {}
      : { promptTokens: parsed.usage.input_tokens }),
    ...(parsed.usage?.output_tokens === undefined
      ? {}
      : { completionTokens: parsed.usage.output_tokens }),
  };
};

/**
 * Reads Anthropic's SSE stream.
 *
 * The wire format differs from OpenAI's: deltas arrive as
 * `content_block_delta` frames with a `text_delta`, and usage is split across
 * `message_start` (input) and `message_delta` (output). A refusal still has to
 * be caught here — it arrives as a `stop_reason` on a perfectly successful
 * stream, not as an error.
 */
async function readAnthropicSse(
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
  let stopReason: string | undefined;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload) continue;

        let frame: AnthropicFrame;
        try {
          frame = JSON.parse(payload) as AnthropicFrame;
        } catch {
          continue;
        }

        if (
          frame.type === 'content_block_delta' &&
          frame.delta?.type === 'text_delta' &&
          typeof frame.delta.text === 'string'
        ) {
          text += frame.delta.text;
          onChunk(frame.delta.text);
        }

        if (frame.type === 'message_start' && frame.message?.usage) {
          // Cache reads count separately; both are input the user paid for.
          const usage = frame.message.usage;
          promptTokens =
            (usage.input_tokens ?? 0) +
            (usage.cache_read_input_tokens ?? 0) +
            (usage.cache_creation_input_tokens ?? 0);
        }

        if (frame.type === 'message_delta') {
          completionTokens = frame.usage?.output_tokens ?? completionTokens;
          stopReason = frame.delta?.stop_reason ?? stopReason;
        }
      }
    }
  } finally {
    reader.cancel().catch(() => undefined);
  }

  if (stopReason === 'refusal') {
    throw new ProviderError(
      'refusal',
      'The model declined to rewrite this draft.',
    );
  }
  if (!text.trim()) throw errorFor('refusal');
  if (stopReason === 'max_tokens') {
    throw errorFor('too-long', 'The rewrite was cut off. Try a shorter draft.');
  }

  return {
    text,
    ...(promptTokens === undefined ? {} : { promptTokens }),
    ...(completionTokens === undefined ? {} : { completionTokens }),
  };
}

interface AnthropicFrame {
  type?: string;
  delta?: { type?: string; text?: unknown; stop_reason?: string };
  message?: {
    usage?: {
      input_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
  };
  usage?: { output_tokens?: number };
}

/** Concatenate text blocks; ignore any other block type the API adds later. */
export function flattenContent(
  content: AnthropicContentBlock[] | undefined,
): string {
  if (!Array.isArray(content)) return '';
  return content
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text ?? '')
    .join('');
}
