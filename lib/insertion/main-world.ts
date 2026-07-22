/**
 * Tier 4 — the MAIN-world adapter for Monaco and CodeMirror 6.
 *
 * Both keep their authoritative text in an internal model that no DOM event
 * reaches: writing to `.cm-content` or the Monaco view lines changes the
 * rendered pixels and is then overwritten on the editor's next render. The
 * only reliable path is calling the editor's own instance API — which lives in
 * the page's JavaScript world, unreachable from an isolated content script.
 *
 * So this function is serialised and executed via
 * `scripting.executeScript({ world: 'MAIN' })` from the background worker.
 *
 * It must therefore be completely self-contained: no imports, no closure over
 * module scope, no TypeScript-only syntax that survives to runtime. Everything
 * it needs is passed as an argument.
 */

/**
 * Runs inside the host page. Returns true only if the editor's own API
 * accepted the text — the caller still verifies by read-back afterwards.
 */
export function mainWorldInsertFunction(text: string): boolean {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return false;

  // --- CodeMirror 6 ---------------------------------------------------
  // The DOM node carries a `cmView` back-reference to its EditorView.
  const cmHost = active.closest('.cm-editor') ?? active.closest('.cm-content');
  if (cmHost) {
    const view = findCodeMirrorView(cmHost);
    if (view) {
      try {
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: text },
        });
        return true;
      } catch {
        return false;
      }
    }
  }

  // --- Monaco ---------------------------------------------------------
  const monacoHost = active.closest('.monaco-editor');
  if (monacoHost) {
    const monaco = (globalThis as { monaco?: MonacoNamespace }).monaco;
    const editors = monaco?.editor?.getEditors?.() ?? [];
    for (const editor of editors) {
      try {
        if (!editor.getDomNode || !monacoHost.contains(editor.getDomNode())) {
          continue;
        }
        // executeEdits keeps Monaco's own undo stack, unlike setValue.
        const model = editor.getModel();
        if (!model) continue;
        editor.executeEdits('promptamp', [
          { range: model.getFullModelRange(), text, forceMoveMarkers: true },
        ]);
        return true;
      } catch {
        // Try the next editor instance on the page.
      }
    }
  }

  return false;

  function findCodeMirrorView(node: Element): CodeMirrorView | null {
    let current: Element | null = node;
    while (current) {
      const view = (current as { cmView?: { view?: CodeMirrorView } }).cmView
        ?.view;
      if (view?.dispatch) return view;
      current = current.parentElement;
    }
    // Some builds expose the view on the wrapper instead.
    const wrapper = node as { CodeMirror?: CodeMirrorView };
    return wrapper.CodeMirror?.dispatch ? wrapper.CodeMirror : null;
  }
}

interface CodeMirrorView {
  state: { doc: { length: number } };
  dispatch: (spec: {
    changes: { from: number; to: number; insert: string };
  }) => void;
}

interface MonacoEditorInstance {
  getDomNode?: () => Node | null;
  getModel: () => { getFullModelRange: () => unknown } | null;
  executeEdits: (
    source: string,
    edits: { range: unknown; text: string; forceMoveMarkers: boolean }[],
  ) => void;
}

interface MonacoNamespace {
  editor?: { getEditors?: () => MonacoEditorInstance[] };
}
