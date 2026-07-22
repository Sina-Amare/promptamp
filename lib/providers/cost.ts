import type { ProviderId } from '../storage/schemas';

/**
 * Cost readout for the history view.
 *
 * Deliberately partial: only models whose published rates we actually know are
 * priced. Everything else reports token counts and no dollar figure. A wrong
 * number about the user's own money is worse than no number, and this table
 * cannot be kept current from inside an extension that has no backend.
 *
 * Rates are USD per million tokens, list price. Where a provider is running a
 * temporary discount we keep the sticker rate — over-stating a cost is the safe
 * direction to be wrong in.
 */

export interface TokenRate {
  inputPerMTok: number;
  outputPerMTok: number;
}

const ANTHROPIC_RATES: Record<string, TokenRate> = {
  'claude-fable-5': { inputPerMTok: 10, outputPerMTok: 50 },
  'claude-mythos-5': { inputPerMTok: 10, outputPerMTok: 50 },
  'claude-opus-4-8': { inputPerMTok: 5, outputPerMTok: 25 },
  'claude-opus-4-7': { inputPerMTok: 5, outputPerMTok: 25 },
  'claude-opus-4-6': { inputPerMTok: 5, outputPerMTok: 25 },
  'claude-sonnet-5': { inputPerMTok: 3, outputPerMTok: 15 },
  'claude-sonnet-4-6': { inputPerMTok: 3, outputPerMTok: 15 },
  'claude-haiku-4-5': { inputPerMTok: 1, outputPerMTok: 5 },
};

const RATES: Partial<Record<ProviderId, Record<string, TokenRate>>> = {
  anthropic: ANTHROPIC_RATES,
  // Local runners cost nothing to call.
  ollama: {},
  lmstudio: {},
  mock: {},
};

/** Local models run on the user's own hardware — the marginal cost is zero. */
const FREE_PROVIDERS: ReadonlySet<ProviderId> = new Set<ProviderId>([
  'ollama',
  'lmstudio',
  'mock',
]);

export function rateFor(
  providerId: ProviderId,
  model: string,
): TokenRate | undefined {
  if (FREE_PROVIDERS.has(providerId)) {
    return { inputPerMTok: 0, outputPerMTok: 0 };
  }
  return RATES[providerId]?.[model];
}

/**
 * Returns `undefined` when the model's rate is unknown, so callers render
 * "1,240 tokens" rather than inventing "$0.00".
 */
export function estimateCostUsd(
  providerId: ProviderId,
  model: string,
  promptTokens: number | undefined,
  completionTokens: number | undefined,
): number | undefined {
  const rate = rateFor(providerId, model);
  if (!rate) return undefined;
  if (promptTokens === undefined && completionTokens === undefined) {
    return undefined;
  }
  const input = ((promptTokens ?? 0) / 1_000_000) * rate.inputPerMTok;
  const output = ((completionTokens ?? 0) / 1_000_000) * rate.outputPerMTok;
  return input + output;
}

/**
 * A single enhancement costs a fraction of a cent, so two decimals would show
 * "$0.00" for every real call. Scale the precision to the magnitude instead.
 */
export function formatCostUsd(usd: number): string {
  if (usd === 0) return 'free';
  if (usd < 0.01) return `<$0.01`;
  return `$${usd.toFixed(2)}`;
}
