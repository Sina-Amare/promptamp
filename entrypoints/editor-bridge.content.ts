import { defineContentScript } from '#imports';
import {
  isMainWorldBridgeRequest,
  makeMainWorldBridgeResponse,
} from '../lib/insertion/bridge';
import { mainWorldEditorOperation } from '../lib/insertion/main-world';

/**
 * A deliberately tiny MAIN-world surface for model-backed editors.
 *
 * The ordinary content script remains isolated. This static bridge exposes
 * only exact read/whole-model replace for the editor that already owns focus;
 * it cannot select arbitrary nodes, execute supplied code, access extension
 * storage, or reach provider credentials.
 */
export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_start',
  allFrames: true,
  world: 'MAIN',

  main() {
    // Clicking PromptAmp moves focus into its shadow button before the read
    // request crosses worlds. Remember the last model-backed editor so that
    // click does not erase the identity of the composer the user invoked.
    let activeEditor: HTMLElement | null = null;
    const remember = (candidate: EventTarget | null): void => {
      if (!(candidate instanceof HTMLElement)) return;
      if (!candidate.closest('.monaco-editor, .cm-editor')) return;
      activeEditor = candidate;
    };
    remember(document.activeElement);
    window.addEventListener(
      'focusin',
      (event) => {
        remember(event.target);
      },
      true,
    );

    window.addEventListener('message', (event: MessageEvent<unknown>) => {
      if (event.source !== window || !isMainWorldBridgeRequest(event.data)) {
        return;
      }
      const { id, operation, text = '' } = event.data;
      const result = mainWorldEditorOperation(operation, text, activeEditor);
      window.postMessage(makeMainWorldBridgeResponse(id, result), '*');
    });
  },
});
