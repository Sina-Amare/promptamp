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
}

export interface ChatResponse {
  text: string;
  promptTokens?: number;
  completionTokens?: number;
}

export type ChatAdapter = (req: ChatRequest) => Promise<ChatResponse>;
