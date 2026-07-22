import type { ProviderCred } from '../storage/schemas';
import type { ProviderConfig } from './registry';

/**
 * The single call shape every adapter implements. Two roles only: a system
 * prompt we authored, and the user turn holding the `<draft>`-wrapped text.
 * Draft text never reaches the system role (principle 7).
 */
export interface ChatRequest {
  config: ProviderConfig;
  cred: ProviderCred;
  system: string;
  user: string;
  maxTokens: number;
  signal: AbortSignal;
  /**
   * Called with each delta as it arrives. Supplying this switches the request
   * to streaming.
   *
   * Measured on the real providers: streaming cuts time-to-first-text from
   * 2621 ms to 1068 ms on gpt-4o-mini. The total is unchanged — the user just
   * stops waiting on a blank panel and starts reading.
   */
  onChunk?: (delta: string) => void;
  /**
   * How many times to retry a 429 on this connection before giving up.
   * Defaults to `MAX_RETRIES`.
   *
   * Zero is the right value when another connection is waiting behind this
   * one: honouring a 60-second `Retry-After` twice means two minutes of
   * spinner before a fallback that would have answered immediately. Only the
   * last connection in a chain has nothing better to do than wait.
   */
  maxRetries?: number;
}

export interface ChatResponse {
  text: string;
  promptTokens?: number;
  completionTokens?: number;
}

export type ChatAdapter = (req: ChatRequest) => Promise<ChatResponse>;
