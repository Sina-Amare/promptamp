/**
 * Tier 4 — the MAIN-world adapter for Monaco and CodeMirror 6.
 *
 * Both keep their authoritative text in an internal model that no DOM event
 * reaches: writing to `.cm-content` or the Monaco view lines changes the
 * rendered pixels and is then overwritten on the editor's next render. The
 * only reliable path is calling the editor's own instance API — which lives in
 * the page's JavaScript world, unreachable from an isolated content script.
 *
 * A narrow static content script runs this adapter in MAIN world. The ordinary
 * content script talks to it through bounded read/replace messages and receives
 * exact model readback; no runtime code injection or broad permission exists.
 */

export type MainWorldEditorKind = 'codemirror' | 'monaco';

export interface MainWorldEditorResult {
  ok: boolean;
  kind: MainWorldEditorKind | null;
  value: string | null;
}

/**
 * Narrow read/replace operation used by the static MAIN-world bridge.
 *
 * It can only touch the currently focused CodeMirror/Monaco instance. There is
 * no selector input and no arbitrary function surface for a page to abuse.
 */
export function mainWorldEditorOperation(
  operation: 'read' | 'replace',
  text = '',
  rememberedTarget?: HTMLElement | null,
): MainWorldEditorResult {
  const active = rememberedTarget?.isConnected
    ? rememberedTarget
    : document.activeElement;
  if (!(active instanceof HTMLElement)) {
    return { ok: false, kind: null, value: null };
  }

  const cmHost = active.closest('.cm-editor') ?? active.closest('.cm-content');
  if (cmHost) {
    const view =
      findCodeMirrorView(active) ??
      findCodeMirrorView(cmHost.querySelector('.cm-content') ?? cmHost);
    if (view) {
      try {
        if (operation === 'replace') {
          view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: text },
          });
        }
        const value = view.state.doc.toString();
        return {
          ok: operation === 'read' || value === text,
          kind: 'codemirror',
          value,
        };
      } catch {
        return { ok: false, kind: 'codemirror', value: null };
      }
    }
  }

  const monacoHost = active.closest('.monaco-editor');
  if (monacoHost) {
    const monaco = (globalThis as { monaco?: MonacoNamespace }).monaco;
    const editors = monaco?.editor?.getEditors?.() ?? [];
    for (const editor of editors) {
      try {
        const node = editor.getDomNode?.();
        if (!node || !monacoHost.contains(node)) continue;
        const model = editor.getModel();
        if (!model) continue;
        if (operation === 'replace') {
          editor.executeEdits('promptamp', [
            {
              range: model.getFullModelRange(),
              text,
              forceMoveMarkers: true,
            },
          ]);
        }
        const value = editor.getValue?.() ?? model.getValue?.() ?? null;
        return {
          ok:
            typeof value === 'string' &&
            (operation === 'read' || value === text),
          kind: 'monaco',
          value,
        };
      } catch {
        // Try the next editor instance on the page.
      }
    }
    return { ok: false, kind: 'monaco', value: null };
  }

  return { ok: false, kind: null, value: null };

  function findCodeMirrorView(node: Element): CodeMirrorView | null {
    let current: Element | null = node;
    while (current) {
      for (const key of Object.keys(current)) {
        if (!key.startsWith('cm') && key !== 'CodeMirror') continue;
        const value = (current as unknown as Record<string, unknown>)[key];
        const candidate =
          asView(value) ?? asView((value as { view?: unknown })?.view);
        if (candidate) return candidate;
      }
      current = current.parentElement;
    }
    return null;
  }

  function asView(value: unknown): CodeMirrorView | null {
    if (typeof value !== 'object' || value === null) return null;
    const maybe = value as Partial<CodeMirrorView>;
    return typeof maybe.dispatch === 'function' &&
      typeof maybe.state?.doc?.length === 'number'
      ? (maybe as CodeMirrorView)
      : null;
  }
}

interface CodeMirrorView {
  state: { doc: { length: number; toString: () => string } };
  dispatch: (spec: {
    changes: { from: number; to: number; insert: string };
  }) => void;
}

interface MonacoEditorInstance {
  getDomNode?: () => Node | null;
  getModel: () => {
    getFullModelRange: () => unknown;
    getValue?: () => string;
  } | null;
  getValue?: () => string;
  executeEdits: (
    source: string,
    edits: { range: unknown; text: string; forceMoveMarkers: boolean }[],
  ) => void;
}

interface MonacoNamespace {
  editor?: { getEditors?: () => MonacoEditorInstance[] };
}
