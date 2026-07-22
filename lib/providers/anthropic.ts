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
  const { config, cred, system, user, maxTokens, signal } = req;

  if (!cred.apiKey) throw errorFor('bad-key');

  const response = await fetchWithRetry(
    endpointFor(config, cred),
    {
      method: 'POST',
      headers: buildHeaders(config, cred.apiKey),
      body: JSON.stringify({
        model: cred.model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: user }],
      }),
      signal,
    },
    config,
  );

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
