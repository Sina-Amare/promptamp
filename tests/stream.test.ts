// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSmoothStream } from '../lib/ui/panel/stream';

/**
 * The smooth reveal decouples network arrival from rendering, so the two
 * things worth proving are: it never renders text that did not arrive, and it
 * always lands on exactly the full text.
 */

let frames: (() => void)[] = [];

beforeEach(() => {
  frames = [];
  vi.stubGlobal('requestAnimationFrame', (cb: () => void) => {
    frames.push(cb);
    return frames.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Run queued frames until the buffer drains, with a runaway guard. */
function drain(): void {
  for (let i = 0; i < 500 && frames.length > 0; i++) {
    const next = frames.shift();
    next?.();
  }
}

describe('smooth stream', () => {
  it('reveals progressively rather than all at once', () => {
    const seen: string[] = [];
    const stream = createSmoothStream((text) => seen.push(text));

    stream.push('The quick brown fox jumps over the lazy dog.');
    drain();

    // More than one render means it was actually paced.
    expect(seen.length).toBeGreaterThan(1);
    expect(seen.at(-1)).toBe('The quick brown fox jumps over the lazy dog.');
  });

  it('never renders text that has not arrived', () => {
    const seen: string[] = [];
    const stream = createSmoothStream((text) => seen.push(text));

    stream.push('Hello ');
    drain();
    // Everything rendered so far is a prefix of what was pushed.
    for (const text of seen) expect('Hello '.startsWith(text)).toBe(true);
  });

  it('accumulates across bursts, which is how networks deliver', () => {
    const seen: string[] = [];
    const stream = createSmoothStream((text) => seen.push(text));

    stream.push('one ');
    drain();
    stream.push('two ');
    drain();
    stream.push('three');
    drain();

    expect(seen.at(-1)).toBe('one two three');
  });

  it('lands on the exact full text when the stream ends mid-reveal', () => {
    const seen: string[] = [];
    const stream = createSmoothStream((text) => seen.push(text));

    // A long push with no frames run: the reveal has not started catching up.
    stream.push('x'.repeat(400));
    stream.finish();

    expect(seen.at(-1)).toBe('x'.repeat(400));
  });

  it('renders nothing further once cancelled', () => {
    const seen: string[] = [];
    const stream = createSmoothStream((text) => seen.push(text));

    stream.push('partial text here');
    stream.cancel();
    drain();
    const afterCancel = seen.length;

    stream.push('should not appear');
    drain();
    expect(seen.length).toBe(afterCancel);
  });

  it('applies text immediately under prefers-reduced-motion', () => {
    // Progressive reveal is motion, and the spec allows no partial compliance.
    vi.stubGlobal('matchMedia', () => ({ matches: true }));

    const seen: string[] = [];
    const stream = createSmoothStream((text) => seen.push(text));
    stream.push('all at once');

    // No frames needed: it rendered synchronously.
    expect(seen).toEqual(['all at once']);
    expect(frames).toHaveLength(0);
  });
});
