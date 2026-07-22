import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import { handsOver } from '../lib/enhance/chain';
import { runEnhancement, safeErrorForEnhancement } from '../lib/enhance/run';
import { saveConnection } from '../lib/storage/credentials';
import type { ErrorKind } from '../lib/messaging/protocol';

/**
 * The fallback chain.
 *
 * Two things are being proved. The first is that a chain survives a failure
 * that belongs to one credential. The second matters more: that it does *not*
 * walk the chain for failures which belong to the draft or to the user —
 * retrying those spends the user's money to fail again, and in the case of a
 * refusal it would amount to shopping for a model that complies.
 */

const DRAFT = 'tips for a job interview please';

beforeEach(() => {
  fakeBrowser.reset();
});

/** Each connection is a mock whose *model name* decides how it behaves. */
async function chain(...models: string[]): Promise<void> {
  for (const [index, model] of models.entries()) {
    await saveConnection({
      id: `c${String(index)}`,
      providerId: 'mock',
      label: `mock-${String(index)}`,
      model,
    });
  }
}

function run(): ReturnType<typeof runEnhancement> {
  return runEnhancement(
    { draft: DRAFT, origin: 'https://example.com' },
    { signal: new AbortController().signal },
  );
}

describe('handover policy', () => {
  it.each<[ErrorKind, boolean]>([
    ['bad-key', true],
    ['bad-model', true],
    ['rate-limited', true],
    ['quota', true],
    ['network', true],
    ['unknown', true],
    ['too-long', false],
    ['soft-cap', false],
    ['cancelled', false],
    ['refusal', false],
  ])('%s hands over: %s', (kind, expected) => {
    expect(handsOver(kind)).toBe(expected);
  });
});

describe('fallback chain', () => {
  it('uses the first connection when it works', async () => {
    await chain('mock-1', 'mock-2');
    const result = await run();

    expect(result.connectionLabel).toBe('mock-0');
    expect(result.fellBackFrom).toBeUndefined();
  });

  it('falls back when the first is rate-limited', async () => {
    await chain('mock-rate-limited', 'mock-1');
    const result = await run();

    expect(result.connectionLabel).toBe('mock-1');
    expect(result.text.length).toBeGreaterThan(0);
  });

  it('reports which connection failed and which answered', async () => {
    // A silent switch hides that a key needs attention.
    await chain('mock-quota', 'mock-1');
    const result = await run();

    expect(result.fellBackFrom?.label).toBe('mock-0');
    expect(result.fellBackFrom?.kind).toBe('quota');
  });

  it('walks past several failures to reach a working connection', async () => {
    await chain('mock-bad-key', 'mock-network', 'mock-quota', 'mock-1');
    expect((await run()).connectionLabel).toBe('mock-3');
  });

  it('never shops for a model that will comply', async () => {
    // A refusal is the model's decision. Walking the chain until one accepts
    // is guardrail shopping, which this extension does not do (principle 12).
    await chain('mock-refusal', 'mock-1');
    await expect(run()).rejects.toMatchObject({ safe: { kind: 'refusal' } });
  });

  it('does not retry a draft-level failure on other connections', async () => {
    // Every model in the list would reject it identically.
    await chain('mock-too-long', 'mock-1');
    await expect(run()).rejects.toMatchObject({ safe: { kind: 'too-long' } });
  });

  it('stops immediately when the user cancels', async () => {
    await chain('mock-slow', 'mock-1');
    const controller = new AbortController();
    const promise = runEnhancement(
      { draft: DRAFT, origin: 'https://example.com' },
      { signal: controller.signal },
    );
    controller.abort();

    await expect(promise).rejects.toMatchObject({
      safe: { kind: 'cancelled' },
    });
  });

  it('summarises every attempt when the whole chain fails', async () => {
    await chain('mock-bad-key', 'mock-quota', 'mock-network');

    await expect(run()).rejects.toMatchObject({
      safe: {
        message: 'All 3 connections failed.',
        // The first actionable cause, not the last failure: fixing the key is
        // what restores service, and the last message would send the user to
        // check their internet instead.
        kind: 'bad-key',
        attempts: [
          { label: 'mock-0', kind: 'bad-key' },
          { label: 'mock-1', kind: 'quota' },
          { label: 'mock-2', kind: 'network' },
        ],
      },
    });
  });

  it('carries a remedy on every failure a user can act on', async () => {
    await chain('mock-bad-key');
    await expect(run()).rejects.toMatchObject({
      safe: { remedy: expect.stringContaining('re-paste the key') as string },
    });
  });

  it('tells the panel to discard a partial stream on handover', async () => {
    // Otherwise two half-answers render spliced together.
    await chain('mock-rate-limited', 'mock-1');
    const onReset = vi.fn();

    await runEnhancement(
      { draft: DRAFT, origin: 'https://example.com' },
      {
        signal: new AbortController().signal,
        onChunk: () => undefined,
        onReset,
      },
    );

    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it('asks for no key material to be configured before it will run', async () => {
    await expect(run()).rejects.toMatchObject({ kind: 'bad-key' });
  });
});

describe('mapping a chain failure for the panel', () => {
  it('keeps the remedy and the attempt list', async () => {
    // A plain `toSafeError` sees ChainFailure as an ordinary Error and
    // flattens it to kind:'unknown' plus a message, throwing away everything
    // the chain assembled. That is a silent regression the panel cannot show.
    await chain('mock-bad-key', 'mock-quota');

    const safe = await run().then(
      () => null,
      (err: unknown) => safeErrorForEnhancement(err),
    );

    expect(safe?.kind).toBe('bad-key');
    expect(safe?.remedy).toContain('re-paste the key');
    expect(safe?.attempts).toHaveLength(2);
  });

  it('still maps an ordinary provider failure', async () => {
    await chain('mock-network');
    const safe = await run().then(
      () => null,
      (err: unknown) => safeErrorForEnhancement(err),
    );

    expect(safe?.kind).toBe('network');
    expect(safe?.attempts).toBeUndefined();
  });
});
