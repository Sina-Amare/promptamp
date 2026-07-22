import type { ErrorKind } from '../messaging/protocol';
import { ProviderError, errorFor } from './errors';
import type { ChatRequest, ChatResponse } from './types';

/**
 * Deterministic offline provider. It is what dev mode and the entire e2e suite
 * run against: no key, no network, no flake, and the same output every time so
 * a Playwright assertion can compare exact strings.
 *
 * Error states (UX-SPEC §4) are impossible to exercise reliably against a real
 * API — you cannot ask OpenAI for a 429 on demand. So the mock reads directives
 * out of the draft itself: a draft containing `[[mock:rate-limited]]` fails
 * that way, every time. The directive is stripped before the echo, so tests can
 * assert on clean output.
 */

const DIRECTIVE = /\[\[mock:([a-z-]+)(?::(\d+))?\]\]/;

const ERROR_KINDS: ReadonlySet<string> = new Set<ErrorKind>([
  'bad-key',
  'rate-limited',
  'quota',
  'network',
  'refusal',
  'too-long',
  'soft-cap',
  'unknown',
]);

/** Latency floor so the 300 ms skeleton in UX-SPEC §2.3 actually gets exercised. */
export const MOCK_LATENCY_MS = 350;

export const mockAdapter = async (req: ChatRequest): Promise<ChatResponse> => {
  const { user, signal } = req;
  const directive = DIRECTIVE.exec(user);
  const command = directive?.[1];
  const arg = directive?.[2];

  if (command === 'slow') {
    // Long enough for a test to click Stop and assert the abort path.
    await delay(Number(arg ?? 10_000), signal);
  } else {
    await delay(MOCK_LATENCY_MS, signal);
  }

  if (command === 'empty') throw errorFor('refusal');

  if (command && ERROR_KINDS.has(command)) {
    throw new ProviderError(
      command as ErrorKind,
      `Mock provider simulated a ${command} failure.`,
      command === 'rate-limited' ? Number(arg ?? 20) : undefined,
    );
  }

  const draft = extractDraft(user).replace(DIRECTIVE, '').trim();

  if (command === 'identical') {
    // Drives the "Already looks good" notice (UX-SPEC §2.2).
    return withUsage(draft, draft);
  }

  return withUsage(draft, enhance(draft));
};

/**
 * A recognisable, deterministic transform — obviously "enhanced" to a human
 * reading a screenshot, and byte-stable for an assertion.
 */
function enhance(draft: string): string {
  if (!draft)
    return 'Describe what you need help with, and what a good answer looks like.';
  const trimmed = draft.replace(/\s+/g, ' ').trim();
  const capitalized = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  const punctuated = /[.!?]$/.test(capitalized)
    ? capitalized
    : `${capitalized}.`;
  return `${punctuated} Be specific and concise, and format the answer as a short list.`;
}

/** Pull the text back out of the <draft> wrapper the assembler added. */
export function extractDraft(user: string): string {
  const match = /<draft>([\s\S]*)<\/draft>/.exec(user);
  return match?.[1] ?? user;
}

function withUsage(draft: string, text: string): ChatResponse {
  // ~4 chars per token is close enough for a cost readout on a fake provider.
  return {
    text,
    promptTokens: Math.ceil(draft.length / 4),
    completionTokens: Math.ceil(text.length / 4),
  };
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    }
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
