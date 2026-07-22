import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import { anthropicAdapter, flattenContent } from '../lib/providers/anthropic';
import { estimateCostUsd, formatCostUsd, rateFor } from '../lib/providers/cost';
import {
  ProviderError,
  backoffMs,
  mapStatus,
  parseRetryAfter,
  toSafeError,
} from '../lib/providers/errors';
import { hasPermission, originsFor } from '../lib/permissions';
import { mockAdapter } from '../lib/providers/mock';
import {
  buildHeaders,
  endpointFor,
  openaiCompatAdapter,
} from '../lib/providers/openai-compat';
import {
  PROVIDERS,
  USER_FACING_PROVIDERS,
  getProvider,
} from '../lib/providers/registry';
import {
  checkSoftCap,
  localDay,
  recordRequest,
} from '../lib/providers/softcap';
import type { ChatRequest } from '../lib/providers/types';
import { patchSettings } from '../lib/storage/items';
import type { ProviderCred, ProviderId } from '../lib/storage/schemas';

const CRED: ProviderCred = {
  apiKey: 'sk-test-abcdefghijklmnopqrst',
  model: 'test-model',
  authMethod: 'manual',
  addedAt: 0,
};

function request(providerId: ProviderId, over: Partial<ChatRequest> = {}) {
  return {
    config: getProvider(providerId),
    cred: CRED,
    system: 'You rewrite drafts.',
    user: '<draft>make a website</draft>',
    maxTokens: 1024,
    signal: new AbortController().signal,
    ...over,
  } satisfies ChatRequest;
}

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

/** Read the JSON body of the nth fetch call, asserting the call happened. */
function bodyOf(
  fetchMock: { mock: { calls: unknown[][] } },
  index = 0,
): Record<string, unknown> {
  const call = fetchMock.mock.calls[index];
  if (!call)
    throw new Error(`fetch was not called ${String(index + 1)} time(s)`);
  // Every adapter sends a JSON string body; anything else is a test bug.
  const init = call[1] as { body?: unknown } | undefined;
  if (typeof init?.body !== 'string') {
    throw new Error('expected a JSON string request body');
  }
  return JSON.parse(init.body) as Record<string, unknown>;
}

beforeEach(() => {
  fakeBrowser.reset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('registry', () => {
  it('exposes every provider except mock to users', () => {
    expect(USER_FACING_PROVIDERS).not.toContain('mock');
    expect(USER_FACING_PROVIDERS).toHaveLength(
      Object.keys(PROVIDERS).length - 1,
    );
  });

  it('never sends a key to a host the user did not choose', () => {
    // Only local runners may be redirected. Allowing a custom base URL for a
    // remote provider would be an exfiltration path for the API key.
    for (const config of Object.values(PROVIDERS)) {
      if (config.allowsCustomBaseUrl) {
        expect(['ollama', 'lmstudio']).toContain(config.id);
      }
    }
  });

  it('carries no referral or tracking parameters on setup links', () => {
    for (const config of Object.values(PROVIDERS)) {
      if (!config.setupUrl) continue;
      expect(config.setupUrl).not.toMatch(/[?&](ref|utm_|via|aff)/i);
    }
  });

  it('requires a key for every remote provider', () => {
    for (const config of Object.values(PROVIDERS)) {
      const isLocal = ['ollama', 'lmstudio', 'mock'].includes(config.id);
      expect(config.requiresKey).toBe(!isLocal);
    }
  });

  it('sends the Anthropic browser-access and version headers', () => {
    const headers = buildHeaders(getProvider('anthropic'), 'sk-ant-key');
    expect(headers.get('anthropic-version')).toBe('2023-06-01');
    expect(headers.get('anthropic-dangerous-direct-browser-access')).toBe(
      'true',
    );
    expect(headers.get('x-api-key')).toBe('sk-ant-key');
    expect(headers.get('authorization')).toBeNull();
  });

  it('uses bearer auth for OpenAI-compatible providers', () => {
    const headers = buildHeaders(getProvider('groq'), 'gsk_key');
    expect(headers.get('authorization')).toBe('Bearer gsk_key');
    expect(headers.get('x-api-key')).toBeNull();
  });

  it('sends no auth header for local runners', () => {
    const headers = buildHeaders(getProvider('ollama'), undefined);
    expect(headers.get('authorization')).toBeNull();
    expect(headers.get('x-api-key')).toBeNull();
  });

  it('honours a custom base URL only for local runners', () => {
    expect(
      endpointFor(getProvider('ollama'), { baseUrl: 'http://box:9999' }),
    ).toBe('http://box:9999/v1/chat/completions');
    expect(
      endpointFor(getProvider('openai'), { baseUrl: 'https://evil.example' }),
    ).toBe('https://api.openai.com/v1/chat/completions');
  });
});

describe('error mapping', () => {
  it.each([
    [401, '', 'bad-key'],
    [403, '', 'bad-key'],
    [402, '', 'quota'],
    [429, 'slow down', 'rate-limited'],
    [429, 'insufficient credit', 'quota'],
    [413, '', 'too-long'],
    [500, '', 'network'],
    [503, '', 'network'],
    [400, 'context length exceeded', 'too-long'],
    [418, '', 'unknown'],
  ])('maps %i to %s', (status, body, expected) => {
    expect(mapStatus(status, body)).toBe(expected);
  });

  it('parses Retry-After given as seconds', () => {
    expect(parseRetryAfter('20')).toBe(20);
  });

  it('parses Retry-After given as an HTTP date', () => {
    const future = new Date(Date.now() + 30_000).toUTCString();
    expect(parseRetryAfter(future)).toBeGreaterThan(25);
  });

  it('ignores an unparseable Retry-After', () => {
    expect(parseRetryAfter('soon')).toBeUndefined();
    expect(parseRetryAfter(null)).toBeUndefined();
  });

  it('reports an aborted request as cancelled, not as a failure', () => {
    const safe = toSafeError(new DOMException('Aborted', 'AbortError'));
    expect(safe.kind).toBe('cancelled');
  });

  it('reports a fetch TypeError as a network problem', () => {
    expect(toSafeError(new TypeError('Failed to fetch')).kind).toBe('network');
  });

  it('redacts key material on the way to the panel', () => {
    const err = new ProviderError(
      'bad-key',
      'bad key sk-test-abcdefghijklmnop',
    );
    expect(err.toSafeError().message).not.toContain('sk-test-abcdefghijklmnop');
    expect(err.toSafeError().message).toContain('[redacted]');
  });

  it("prefers the provider's Retry-After over exponential backoff", () => {
    expect(backoffMs(0, 20)).toBe(20_000);
    expect(backoffMs(0)).toBe(1000);
    expect(backoffMs(3)).toBe(8000);
  });
});

describe('openai-compat adapter', () => {
  it('sends system and user as separate roles', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        choices: [{ message: { content: 'better draft' } }],
        usage: { prompt_tokens: 10, completion_tokens: 4 },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await openaiCompatAdapter(request('groq'));

    expect(result.text).toBe('better draft');
    expect(result.promptTokens).toBe(10);
    expect(result.completionTokens).toBe(4);

    const body = bodyOf(fetchMock);
    expect(body.messages).toEqual([
      { role: 'system', content: 'You rewrite drafts.' },
      { role: 'user', content: '<draft>make a website</draft>' },
    ]);
    expect(body.stream).toBe(false);
  });

  it('uses max_completion_tokens for OpenAI and max_tokens elsewhere', async () => {
    // A Response body can only be read once, so build a fresh one per call.
    const fetchMock = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(
          jsonResponse({ choices: [{ message: { content: 'x' } }] }),
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    await openaiCompatAdapter(request('openai'));
    await openaiCompatAdapter(request('groq'));

    const openaiBody = bodyOf(fetchMock, 0);
    const groqBody = bodyOf(fetchMock, 1);
    expect(openaiBody.max_completion_tokens).toBe(1024);
    expect(openaiBody.max_tokens).toBeUndefined();
    expect(groqBody.max_tokens).toBe(1024);
  });

  it('retries a 429 at most twice, then surfaces it', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response('{"error":{"message":"slow down"}}', { status: 429 }),
      );
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((cb: () => void) => {
      cb();
      return 0;
    }) as never);

    await expect(openaiCompatAdapter(request('groq'))).rejects.toMatchObject({
      kind: 'rate-limited',
    });
    // Never more than 3 calls total: paid requests fire on user action only.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does not retry a 401', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('{}', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(openaiCompatAdapter(request('groq'))).rejects.toMatchObject({
      kind: 'bad-key',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('turns an Ollama 403 into origin guidance', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('forbidden', { status: 403 })),
    );

    await expect(
      openaiCompatAdapter(
        request('ollama', { cred: { ...CRED, apiKey: undefined } }),
      ),
    ).rejects.toThrow(/OLLAMA_ORIGINS/);
  });

  it('treats an empty completion as a refusal', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ choices: [{ message: { content: '   ' } }] }),
        ),
    );

    await expect(openaiCompatAdapter(request('groq'))).rejects.toMatchObject({
      kind: 'refusal',
    });
  });

  it('fails before the network when a required key is missing', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      openaiCompatAdapter(
        request('groq', { cred: { ...CRED, apiKey: undefined } }),
      ),
    ).rejects.toMatchObject({ kind: 'bad-key' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('anthropic adapter', () => {
  it('puts the system prompt in the top-level field, not a message', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        content: [{ type: 'text', text: 'better draft' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 12, output_tokens: 5 },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await anthropicAdapter(request('anthropic'));

    expect(result.text).toBe('better draft');
    expect(result.promptTokens).toBe(12);
    expect(result.completionTokens).toBe(5);

    const body = bodyOf(fetchMock);
    expect(body.system).toBe('You rewrite drafts.');
    expect(body.messages).toEqual([
      { role: 'user', content: '<draft>make a website</draft>' },
    ]);
    expect(body.max_tokens).toBe(1024);
  });

  it('never sends sampling parameters', async () => {
    // Current Claude models reject temperature/top_p/top_k with a 400.
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ content: [{ type: 'text', text: 'ok' }] }),
      );
    vi.stubGlobal('fetch', fetchMock);

    await anthropicAdapter(request('anthropic'));

    const body = bodyOf(fetchMock);
    expect(body).not.toHaveProperty('temperature');
    expect(body).not.toHaveProperty('top_p');
    expect(body).not.toHaveProperty('top_k');
    expect(body).not.toHaveProperty('thinking');
  });

  it('handles a refusal returned as HTTP 200 with empty content', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ content: [], stop_reason: 'refusal' }),
        ),
    );

    await expect(anthropicAdapter(request('anthropic'))).rejects.toMatchObject({
      kind: 'refusal',
    });
  });

  it('rejects a truncated rewrite rather than returning half a prompt', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          content: [{ type: 'text', text: 'half a rewri' }],
          stop_reason: 'max_tokens',
        }),
      ),
    );

    await expect(anthropicAdapter(request('anthropic'))).rejects.toMatchObject({
      kind: 'too-long',
    });
  });

  it('flattens multiple text blocks and ignores other block types', () => {
    expect(
      flattenContent([
        { type: 'thinking', text: 'ignore me' },
        { type: 'text', text: 'part one ' },
        { type: 'text', text: 'part two' },
      ]),
    ).toBe('part one part two');
    expect(flattenContent(undefined)).toBe('');
  });
});

describe('mock adapter', () => {
  it('is deterministic for the same draft', async () => {
    const a = await mockAdapter(request('mock'));
    const b = await mockAdapter(request('mock'));
    expect(a.text).toBe(b.text);
    expect(a.text).toContain('Make a website.');
  });

  it('unwraps the draft tags', async () => {
    const result = await mockAdapter(request('mock'));
    expect(result.text).not.toContain('<draft>');
  });

  it.each([
    ['rate-limited', 'rate-limited'],
    ['bad-key', 'bad-key'],
    ['quota', 'quota'],
    ['network', 'network'],
    ['refusal', 'refusal'],
    ['too-long', 'too-long'],
  ])('simulates a %s failure on request', async (directive, kind) => {
    await expect(
      mockAdapter(
        request('mock', { user: `<draft>hi [[mock:${directive}]]</draft>` }),
      ),
    ).rejects.toMatchObject({ kind });
  });

  it('returns the draft unchanged for the already-good case', async () => {
    const result = await mockAdapter(
      request('mock', {
        user: '<draft>already great [[mock:identical]]</draft>',
      }),
    );
    expect(result.text).toBe('already great');
  });

  it('aborts promptly when the port disconnects', async () => {
    const controller = new AbortController();
    const promise = mockAdapter(
      request('mock', {
        user: '<draft>slow one [[mock:slow:5000]]</draft>',
        signal: controller.signal,
      }),
    );
    controller.abort();
    await expect(promise).rejects.toThrow(/abort/i);
  });

  it('reports token usage so the cost path is exercised offline', async () => {
    const result = await mockAdapter(request('mock'));
    expect(result.promptTokens).toBeGreaterThan(0);
    expect(result.completionTokens).toBeGreaterThan(0);
  });
});

describe('cost', () => {
  it('prices a known Anthropic model', () => {
    const usd = estimateCostUsd('anthropic', 'claude-opus-4-8', 1_000_000, 0);
    expect(usd).toBeCloseTo(5);
  });

  it('adds input and output at their separate rates', () => {
    const usd = estimateCostUsd(
      'anthropic',
      'claude-haiku-4-5',
      1_000_000,
      1_000_000,
    );
    expect(usd).toBeCloseTo(6); // $1 in + $5 out
  });

  it('returns undefined rather than inventing a price', () => {
    expect(
      estimateCostUsd('openai', 'gpt-4o-mini', 1000, 1000),
    ).toBeUndefined();
    expect(
      estimateCostUsd('anthropic', 'some-future-model', 1000, 1000),
    ).toBeUndefined();
  });

  it('treats local runners as free', () => {
    expect(rateFor('ollama', 'llama3.2')).toEqual({
      inputPerMTok: 0,
      outputPerMTok: 0,
    });
    expect(estimateCostUsd('ollama', 'llama3.2', 5000, 5000)).toBe(0);
  });

  it('never renders a real cost as $0.00', () => {
    expect(formatCostUsd(0)).toBe('free');
    expect(formatCostUsd(0.0004)).toBe('<$0.01');
    expect(formatCostUsd(1.235)).toBe('$1.24');
  });
});

describe('host permissions', () => {
  it('derives the exact host pattern each provider needs', () => {
    expect(originsFor('openai')).toEqual(['https://api.openai.com/*']);
    expect(originsFor('anthropic')).toEqual(['https://api.anthropic.com/*']);
    expect(originsFor('ollama')).toEqual(['http://localhost/*']);
  });

  it('asks for nothing on behalf of the mock provider', () => {
    expect(originsFor('mock')).toEqual([]);
  });

  it('never requests a wildcard host', () => {
    // A broad grant here would undo the narrow host list in the manifest.
    for (const id of USER_FACING_PROVIDERS) {
      for (const origin of originsFor(id)) {
        expect(origin).not.toBe('<all_urls>');
        expect(origin).not.toMatch(/^\*:\/\//);
        expect(origin).not.toMatch(/^https?:\/\/\*\//);
      }
    }
  });

  it('treats a browser without the API as already granted', async () => {
    // Chrome grants host_permissions at install; only Firefox MV3 defers them.
    vi.stubGlobal('chrome', {});
    await expect(hasPermission('mock')).resolves.toBe(true);
    vi.unstubAllGlobals();
  });
});

describe('soft cap', () => {
  it('starts at zero and is not exceeded', async () => {
    const status = await checkSoftCap();
    expect(status.count).toBe(0);
    expect(status.exceeded).toBe(false);
  });

  it('counts requests and trips at the limit', async () => {
    await patchSettings({ softCapPerDay: 2 });
    await recordRequest();
    expect((await checkSoftCap()).exceeded).toBe(false);
    await recordRequest();
    expect((await checkSoftCap()).exceeded).toBe(true);
  });

  it('resets on the next calendar day', async () => {
    await patchSettings({ softCapPerDay: 1 });
    const today = new Date('2026-07-22T10:00:00');
    await recordRequest(today);
    expect((await checkSoftCap(today)).exceeded).toBe(true);

    const tomorrow = new Date('2026-07-23T10:00:00');
    expect((await checkSoftCap(tomorrow)).exceeded).toBe(false);
  });

  it('is disabled when the limit is zero', async () => {
    await patchSettings({ softCapPerDay: 0 });
    for (let i = 0; i < 50; i++) await recordRequest();
    expect((await checkSoftCap()).exceeded).toBe(false);
  });

  it('uses the local calendar day, not UTC', () => {
    // 23:30 local on the 22nd is the 22nd, even where UTC has rolled over.
    expect(localDay(new Date(2026, 6, 22, 23, 30))).toBe('2026-07-22');
  });
});
