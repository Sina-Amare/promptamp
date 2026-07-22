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
}

export interface ChatResponse {
  text: string;
  promptTokens?: number;
  completionTokens?: number;
}

export type ChatAdapter = (req: ChatRequest) => Promise<ChatResponse>;
