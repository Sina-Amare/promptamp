// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFieldTracker } from '../lib/ui/tracker';

function box(left: number): DOMRect {
  return {
    left,
    top: 100,
    width: 400,
    height: 120,
    right: left + 400,
    bottom: 220,
    x: left,
    y: 100,
    toJSON: () => ({}),
  };
}

beforeEach(() => {
  document.body.replaceChildren();
  vi.stubGlobal('innerWidth', 1_200);
  vi.stubGlobal('innerHeight', 800);
  Object.defineProperty(document, 'elementsFromPoint', {
    configurable: true,
    value: () => [],
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('field tracker resource ownership', () => {
  it('leaves exactly one timer, observer set, and scroll listener after switches', () => {
    const resizeObservers = new Set<FakeResizeObserver>();
    const mutationObservers = new Set<FakeMutationObserver>();
    class FakeResizeObserver {
      constructor(_callback: ResizeObserverCallback) {
        resizeObservers.add(this);
      }
      observe(target: Element): void {
        void target;
      }
      unobserve(target: Element): void {
        void target;
      }
      disconnect(): void {
        resizeObservers.delete(this);
      }
    }
    class FakeMutationObserver {
      constructor(_callback: MutationCallback) {
        mutationObservers.add(this);
      }
      observe(target: Node, options?: MutationObserverInit): void {
        void target;
        void options;
      }
      takeRecords(): MutationRecord[] {
        return [];
      }
      disconnect(): void {
        mutationObservers.delete(this);
      }
    }
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    vi.stubGlobal('MutationObserver', FakeMutationObserver);

    let nextTimer = 0;
    const activeIntervals = new Set<number>();
    vi.spyOn(globalThis, 'setInterval').mockImplementation((() => {
      const id = ++nextTimer;
      activeIntervals.add(id);
      return id;
    }) as never);
    vi.spyOn(globalThis, 'clearInterval').mockImplementation(((id: number) => {
      activeIntervals.delete(id);
    }) as never);

    document.body.innerHTML = `
      <div id="scroll-a" style="overflow-x:auto;overflow-y:auto"><textarea id="a"></textarea></div>
      <div id="scroll-b" style="overflow-x:auto;overflow-y:auto"><textarea id="b"></textarea></div>`;
    const a = document.getElementById('a') as HTMLTextAreaElement;
    const b = document.getElementById('b') as HTMLTextAreaElement;
    const scrollA = document.getElementById('scroll-a')!;
    const scrollB = document.getElementById('scroll-b')!;
    a.getBoundingClientRect = () => box(100);
    b.getBoundingClientRect = () => box(600);
    scrollA.getBoundingClientRect = () => box(100);
    scrollB.getBoundingClientRect = () => box(600);
    const removeA = vi.spyOn(scrollA, 'removeEventListener');
    const addB = vi.spyOn(scrollB, 'addEventListener');

    const onAttach = vi.fn();
    const onDetach = vi.fn();
    const tracker = createFieldTracker(
      {
        onAttach,
        onDetach,
        onMove: () => undefined,
        onDraftChange: () => undefined,
        onTypingChange: () => undefined,
        onFieldTab: () => false,
      },
      {
        buttonSize: 40,
        isOwnNode: () => false,
        preferredCorner: () => null,
        pinnedOffset: () => null,
        isSuppressed: () => false,
      },
    );

    tracker.start();
    a.focus();
    a.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    b.focus();
    b.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));

    expect(onAttach).toHaveBeenCalledTimes(2);
    expect(onDetach).not.toHaveBeenCalled();
    expect(activeIntervals.size).toBe(1);
    expect(resizeObservers.size).toBe(1);
    expect(mutationObservers.size).toBe(1);
    expect(removeA).toHaveBeenCalledWith('scroll', expect.any(Function));
    expect(addB).toHaveBeenCalledWith(
      'scroll',
      expect.any(Function),
      expect.objectContaining({ passive: true }),
    );

    tracker.stop();
    expect(activeIntervals.size).toBe(0);
    expect(resizeObservers.size).toBe(0);
    expect(mutationObservers.size).toBe(0);
    expect(onDetach).toHaveBeenCalledTimes(1);
  });

  it('adopts an unfocused final hydration composer from the compatibility fallback', () => {
    class FakeResizeObserver {
      observe(): void {
        return;
      }
      disconnect(): void {
        return;
      }
    }
    class FakeMutationObserver {
      observe(): void {
        return;
      }
      disconnect(): void {
        return;
      }
    }
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    vi.stubGlobal('MutationObserver', FakeMutationObserver);

    let safetyTick = (): void => {
      throw new Error('The tracker interval was not installed.');
    };
    vi.spyOn(globalThis, 'setInterval').mockImplementation(((
      callback: () => void,
    ) => {
      safetyTick = callback;
      return 1;
    }) as never);
    vi.spyOn(globalThis, 'clearInterval').mockImplementation(() => undefined);

    const preload = document.createElement('textarea');
    const finalComposer = document.createElement('textarea');
    preload.getBoundingClientRect = () => box(100);
    finalComposer.getBoundingClientRect = () => box(560);
    document.body.append(preload);
    let compatibilityField: HTMLElement | null = preload;

    const onAttach = vi.fn();
    const tracker = createFieldTracker(
      {
        onAttach,
        onDetach: () => undefined,
        onMove: () => undefined,
        onDraftChange: () => undefined,
        onTypingChange: () => undefined,
        onFieldTab: () => false,
      },
      {
        buttonSize: 40,
        isOwnNode: () => false,
        preferredCorner: () => null,
        pinnedOffset: () => null,
        placementMode: () => 'external',
        fallbackField: () => compatibilityField,
        isSuppressed: () => false,
      },
    );

    tracker.start();
    expect(tracker.current()).toBe(preload);

    preload.remove();
    document.body.append(finalComposer);
    compatibilityField = finalComposer;
    safetyTick();

    expect(tracker.current()).toBe(finalComposer);
    expect(onAttach).toHaveBeenCalledTimes(2);
    tracker.stop();
  });

  it('hides the disc (onFieldLost) when its composer is removed and nothing replaces it', () => {
    class FakeResizeObserver {
      observe(): void {
        return;
      }
      disconnect(): void {
        return;
      }
    }
    class FakeMutationObserver {
      observe(): void {
        return;
      }
      disconnect(): void {
        return;
      }
    }
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    vi.stubGlobal('MutationObserver', FakeMutationObserver);

    let safetyTick = (): void => {
      throw new Error('The tracker interval was not installed.');
    };
    vi.spyOn(globalThis, 'setInterval').mockImplementation(((
      callback: () => void,
    ) => {
      safetyTick = callback;
      return 1;
    }) as never);
    vi.spyOn(globalThis, 'clearInterval').mockImplementation(() => undefined);

    const field = document.createElement('textarea');
    field.getBoundingClientRect = () => box(100);
    document.body.append(field);
    let fallback: HTMLElement | null = field;

    const onFieldLost = vi.fn();
    const onDetach = vi.fn();
    const tracker = createFieldTracker(
      {
        onAttach: vi.fn(),
        onDetach,
        onMove: () => undefined,
        onDraftChange: () => undefined,
        onTypingChange: () => undefined,
        onFieldTab: () => false,
        onFieldLost,
      },
      {
        buttonSize: 40,
        isOwnNode: () => false,
        preferredCorner: () => null,
        pinnedOffset: () => null,
        placementMode: () => 'external',
        fallbackField: () => fallback,
        isSuppressed: () => false,
      },
    );

    tracker.start();
    expect(tracker.current()).toBe(field);

    // SPA route change: the composer leaves the DOM and nothing replaces it.
    field.remove();
    fallback = null;
    safetyTick();

    expect(onFieldLost).toHaveBeenCalled(); // disc hidden while we wait
    expect(onDetach).not.toHaveBeenCalled(); // still inside the grace window
    tracker.stop();
  });
});
