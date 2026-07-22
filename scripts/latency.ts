/**
 * Measures what the user actually waits for.
 *
 * Two different numbers matter, and they are not the same:
 *
 *   - **TTFT** (time to first token) is when the panel can start showing text.
 *   - **Total** is when the rewrite is finished.
 *
 * Non-streaming forces the user to wait for Total. Streaming lets them start
 * reading at TTFT. Before adding streaming complexity, this measures whether
 * the gap is actually worth it on the models people will really use.
 *
 *   pnpm latency
 */
import { readFileSync } from 'node:fs';
import { assemble } from '../lib/enhance/assemble';
import { builtinProfile } from '../lib/enhance/prompts';
import { buildHeaders, endpointFor } from '../lib/providers/openai-compat';
import { PROVIDERS } from '../lib/providers/registry';
import type { ProviderId } from '../lib/storage/schemas';

const DRAFT = 'tips for a job interview, i am nervous about the technical part';

function loadEnv(): Record<string, string> {
  try {
    const raw = readFileSync(new URL('../.env', import.meta.url), 'utf8');
    return Object.fromEntries(
      raw
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('#'))
        .map((l) => {
          const i = l.indexOf('=');
          return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
        }),
    );
  } catch {
    return {};
  }
}

interface Sample {
  ttftMs: number;
  totalMs: number;
  chars: number;
}

async function measure(
  providerId: ProviderId,
  apiKey: string,
  model: string,
  stream: boolean,
): Promise<Sample> {
  const config = PROVIDERS[providerId];
  const profile = builtinProfile('chat')!;
  const { system, user } = assemble(profile, DRAFT);

  const started = performance.now();
  const response = await fetch(endpointFor(config, {}), {
    method: 'POST',
    headers: buildHeaders(config, apiKey),
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      stream,
      [config.maxTokensField]: 2048,
    }),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${String(response.status)}`);
  }

  if (!stream) {
    const body = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const total = performance.now() - started;
    const text = body.choices?.[0]?.message?.content ?? '';
    // Non-streaming has no earlier signal: first text *is* the end.
    return { ttftMs: total, totalMs: total, chars: text.length };
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let ttft = 0;
  let chars = 0;
  let buffer = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const payload = line.slice(6).trim();
      if (payload === '[DONE]') continue;
      try {
        const parsed = JSON.parse(payload) as {
          choices?: { delta?: { content?: string } }[];
        };
        const delta = parsed.choices?.[0]?.delta?.content;
        if (delta) {
          if (ttft === 0) ttft = performance.now() - started;
          chars += delta.length;
        }
      } catch {
        // partial frame
      }
    }
  }

  return { ttftMs: ttft, totalMs: performance.now() - started, chars };
}

const env = loadEnv();
const targets: { label: string; id: ProviderId; key: string; model: string }[] =
  [];
if (env.GROQ_API_KEY) {
  targets.push({
    label: 'Groq llama-3.3-70b',
    id: 'groq',
    key: env.GROQ_API_KEY,
    model: 'llama-3.3-70b-versatile',
  });
}
if (env.OPENROUTER_API_KEY) {
  targets.push({
    label: 'OpenRouter gpt-4o-mini',
    id: 'openrouter',
    key: env.OPENROUTER_API_KEY,
    model: 'openai/gpt-4o-mini',
  });
}

console.log('draft:', DRAFT);
console.log('');

for (const target of targets) {
  for (const stream of [false, true]) {
    try {
      const s = await measure(target.id, target.key, target.model, stream);
      const mode = stream ? 'stream ' : 'blocking';
      console.log(
        `${target.label.padEnd(26)} ${mode}  TTFT ${String(Math.round(s.ttftMs)).padStart(5)}ms   total ${String(Math.round(s.totalMs)).padStart(5)}ms   ${String(s.chars)} chars`,
      );
    } catch (error) {
      console.log(
        `${target.label} ${stream ? 'stream' : 'blocking'} — ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    // Stay under Groq's per-minute token ceiling.
    await new Promise((r) => setTimeout(r, 16_000));
  }
}
