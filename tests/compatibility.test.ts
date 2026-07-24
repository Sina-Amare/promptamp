// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  findCompatibilityComposer,
  placementModeForLocation,
} from '../lib/ui/compatibility';

function rect(
  left: number,
  top: number,
  width: number,
  height: number,
): DOMRect {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  };
}

beforeEach(() => {
  document.body.replaceChildren();
  vi.stubGlobal('innerWidth', 1_920);
  vi.stubGlobal('innerHeight', 1_000);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('composer compatibility mode', () => {
  it.each([
    ['gemini.google.com', '/app', 'external'],
    ['gemini.google.com.', '/app', 'external'],
    ['labs.google', '/fx/tools/flow/project/123', 'external'],
    ['labs.google.com', '/fx/tools/flow', 'external'],
    ['labs.google', '/other', 'auto'],
    ['chatgpt.com', '/', 'auto'],
  ] as const)('maps %s%s to %s', (host, path, expected) => {
    expect(placementModeForLocation(host, path)).toBe(expected);
  });

  it('selects the final visible prompt after an unfocused hydration replacement', () => {
    const preload = document.createElement('textarea');
    preload.setAttribute('aria-label', 'Ask Gemini');
    preload.style.opacity = '0';
    preload.getBoundingClientRect = () => rect(540, 480, 720, 24);

    const search = document.createElement('input');
    search.type = 'search';
    search.setAttribute('aria-label', 'Search media');
    search.getBoundingClientRect = () => rect(680, 10, 430, 40);

    const prompt = document.createElement('input');
    prompt.type = 'text';
    prompt.setAttribute('aria-label', 'What do you want to create?');
    // Gemini/Flow may opt out of Grammarly during final hydration. That
    // third-party flag must not suppress PromptAmp's compatibility launcher.
    prompt.setAttribute('data-gramm', 'false');
    prompt.getBoundingClientRect = () => rect(660, 860, 600, 24);
    document.body.append(preload, search, prompt);

    expect(findCompatibilityComposer(document)).toBe(prompt);
  });

  it('continues to honor PromptAmp own explicit opt-out', () => {
    const prompt = document.createElement('textarea');
    prompt.setAttribute('aria-label', 'Ask Gemini');
    prompt.setAttribute('data-promptamp', 'false');
    prompt.getBoundingClientRect = () => rect(500, 500, 620, 64);
    document.body.append(prompt);

    expect(findCompatibilityComposer(document)).toBeNull();
  });

  it('searches open shadow roots and ignores PromptAmp-owned candidates', () => {
    const host = document.createElement('input-area-v2');
    const shadow = host.attachShadow({ mode: 'open' });
    const editor = document.createElement('textarea');
    editor.setAttribute('aria-label', 'Ask Gemini');
    editor.getBoundingClientRect = () => rect(600, 500, 620, 24);
    shadow.append(editor);
    document.body.append(host);

    expect(findCompatibilityComposer(document)).toBe(editor);
    expect(findCompatibilityComposer(document, (node) => node === editor)).toBe(
      null,
    );
  });
});
