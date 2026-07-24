import type { MainWorldEditorResult } from './main-world';

const CHANNEL = 'promptamp-editor-bridge-v1';
const REQUEST_SOURCE = 'promptamp-isolated';
const RESPONSE_SOURCE = 'promptamp-main';
const MAX_TEXT_LENGTH = 250_000;

interface BridgeRequest {
  channel: typeof CHANNEL;
  source: typeof REQUEST_SOURCE;
  id: string;
  operation: 'read' | 'replace';
  text?: string;
}

interface BridgeResponse {
  channel: typeof CHANNEL;
  source: typeof RESPONSE_SOURCE;
  id: string;
  result: MainWorldEditorResult;
}

export function isMainWorldBridgeRequest(
  value: unknown,
): value is BridgeRequest {
  if (typeof value !== 'object' || value === null) return false;
  const request = value as Partial<BridgeRequest>;
  return (
    request.channel === CHANNEL &&
    request.source === REQUEST_SOURCE &&
    typeof request.id === 'string' &&
    request.id.length >= 8 &&
    request.id.length <= 100 &&
    (request.operation === 'read' || request.operation === 'replace') &&
    (request.text === undefined ||
      (typeof request.text === 'string' &&
        request.text.length <= MAX_TEXT_LENGTH))
  );
}

export function makeMainWorldBridgeResponse(
  id: string,
  result: MainWorldEditorResult,
): BridgeResponse {
  return {
    channel: CHANNEL,
    source: RESPONSE_SOURCE,
    id,
    result,
  };
}

export function requestMainWorldEditor(
  operation: 'read' | 'replace',
  text?: string,
  timeoutMs = 1_500,
): Promise<MainWorldEditorResult> {
  if (text !== undefined && text.length > MAX_TEXT_LENGTH) {
    return Promise.resolve({ ok: false, kind: null, value: null });
  }

  const id = crypto.randomUUID();
  const request: BridgeRequest = {
    channel: CHANNEL,
    source: REQUEST_SOURCE,
    id,
    operation,
    ...(text === undefined ? {} : { text }),
  };

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: MainWorldEditorResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      resolve(result);
    };
    const onMessage = (event: MessageEvent<unknown>): void => {
      if (event.source !== window) return;
      if (typeof event.data !== 'object' || event.data === null) return;
      const response = event.data as Partial<BridgeResponse>;
      if (
        response.channel !== CHANNEL ||
        response.source !== RESPONSE_SOURCE ||
        response.id !== id ||
        !isEditorResult(response.result)
      ) {
        return;
      }
      finish(response.result);
    };
    const timer = setTimeout(() => {
      finish({ ok: false, kind: null, value: null });
    }, timeoutMs);

    window.addEventListener('message', onMessage);
    window.postMessage(request, '*');
  });
}

function isEditorResult(value: unknown): value is MainWorldEditorResult {
  if (typeof value !== 'object' || value === null) return false;
  const result = value as Partial<MainWorldEditorResult>;
  return (
    typeof result.ok === 'boolean' &&
    (result.kind === null ||
      result.kind === 'monaco' ||
      result.kind === 'codemirror') &&
    (result.value === null || typeof result.value === 'string')
  );
}
