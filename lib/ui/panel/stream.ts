/**
 * Smooth streaming reveal.
 *
 * Network deltas do not arrive evenly. A provider sends a burst of ten tokens,
 * then nothing for 300 ms, then another burst — rendering each one the instant
 * it lands looks like stuttering, and stuttering reads as *slow* even when the
 * numbers say otherwise.
 *
 * So arrivals and rendering are decoupled: chunks go into a buffer, and a
 * single animation frame loop drains it at a steady, slightly-ahead pace. The
 * text appears at a readable, even rate, and finishes exactly when the stream
 * does.
 *
 * Under `prefers-reduced-motion` the whole mechanism is bypassed and text is
 * applied immediately — progressive reveal is motion, and the spec allows no
 * partial compliance.
 */

export interface SmoothStream {
  /** Queue a delta from the network. */
  push: (delta: string) => void;
  /** Flush everything at once — used when the stream completes. */
  finish: () => void;
  /** Abandon the buffer without rendering it. */
  cancel: () => void;
}

/**
 * How far ahead of the render the buffer may run before catching up.
 *
 * Drains a fixed fraction of whatever is pending each frame, so a big backlog
 * accelerates and a trickle stays gentle. Chosen to look continuous at 60 fps
 * without lagging visibly behind a fast model.
 */
const DRAIN_FRACTION = 0.22;

/** Always emit at least this many characters per frame, so it never stalls. */
const MIN_PER_FRAME = 2;

export function createSmoothStream(
  render: (text: string) => void,
): SmoothStream {
  let pending = '';
  let shown = '';
  let frame = 0;
  let finished = false;

  const reduced = globalThis.matchMedia?.(
    '(prefers-reduced-motion: reduce)',
  ).matches;

  function tick(): void {
    frame = 0;
    if (pending.length === 0) {
      if (!finished) return;
      return;
    }

    const take = Math.max(
      MIN_PER_FRAME,
      Math.ceil(pending.length * DRAIN_FRACTION),
    );
    shown += pending.slice(0, take);
    pending = pending.slice(take);
    render(shown);

    if (pending.length > 0) schedule();
  }

  function schedule(): void {
    if (frame !== 0) return;
    frame = globalThis.requestAnimationFrame(tick);
  }

  return {
    push: (delta) => {
      if (finished) return;
      if (reduced) {
        // No progressive reveal at all: apply and move on.
        shown += delta;
        render(shown);
        return;
      }
      pending += delta;
      schedule();
    },

    finish: () => {
      finished = true;
      if (frame !== 0) {
        globalThis.cancelAnimationFrame(frame);
        frame = 0;
      }
      if (pending.length > 0) {
        shown += pending;
        pending = '';
        render(shown);
      }
    },

    cancel: () => {
      finished = true;
      pending = '';
      if (frame !== 0) {
        globalThis.cancelAnimationFrame(frame);
        frame = 0;
      }
    },
  };
}
