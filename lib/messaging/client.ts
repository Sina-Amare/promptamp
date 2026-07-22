import { browser } from '#imports';
import type { Request, ResponseFor } from './protocol';

/**
 * Typed `sendMessage` for the content script and extension pages.
 *
 * The generic ties each request's `type` to its response, so a handler that
 * returns the wrong shape is a compile error rather than an `undefined` that
 * surfaces three call sites away.
 */
export async function sendMessage<T extends Request>(
  message: T,
): Promise<ResponseFor<T['type']>> {
  const response: unknown = await browser.runtime.sendMessage(message);
  return response as ResponseFor<T['type']>;
}
