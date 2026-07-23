import { DECLINE_SENTINEL, type ErrorKind } from '../messaging/protocol';
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
  'bad-model',
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

/**
 * The same directives, but attached to the model name instead of the draft.
 *
 * A fallback chain needs connections that behave *differently* on one draft —
 * the first fails, the second answers. A draft-level directive cannot express
 * that, because every connection sees the same draft. A model named
 * `mock-rate-limited` fails that way while `mock-1` beside it succeeds.
 */
const MODEL_DIRECTIVE = /^mock-([a-z-]+?)(?:-(\d+))?$/;

export const mockAdapter = async (req: ChatRequest): Promise<ChatResponse> => {
  const { user, signal, cred } = req;
  const fromDraft = DIRECTIVE.exec(user);
  const fromModel = MODEL_DIRECTIVE.exec(cred.model);

  // The draft wins: an e2e test that types a directive is being explicit about
  // this one request, whereas the model name is standing configuration.
  const directive =
    fromDraft ??
    (fromModel && ERROR_KINDS.has(fromModel[1] ?? '') ? fromModel : null);
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

  const text =
    command === 'decline'
      ? // Drives the "Nothing to enhance yet" note — a draft with no request.
        DECLINE_SENTINEL
      : command === 'identical'
        ? // Drives the "Already looks good" notice (UX-SPEC §2.2).
          draft
        : enhance(draft);

  // Stream it when the caller asked to, exactly as a real provider would — this
  // is the only place the smooth-reveal and decline-hold paths get exercised.
  if (req.onChunk) {
    for (const piece of chunkText(text)) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      req.onChunk(piece);
      await delay(15, signal);
    }
  }

  return withUsage(draft, text);
};

/** A few uneven pieces, like a network delivers — never split a surrogate pair. */
function chunkText(text: string): string[] {
  const points = [...text];
  const pieces: string[] = [];
  for (let i = 0; i < points.length; i += 7) {
    pieces.push(points.slice(i, i + 7).join(''));
  }
  return pieces.length > 0 ? pieces : [''];
}

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
