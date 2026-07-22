import { addHistoryEntry, getSettings } from '../storage/items';
import { getCredential } from '../storage/credentials';
import { chat } from '../providers';
import { estimateCostUsd } from '../providers/cost';
import { errorFor, toSafeError } from '../providers/errors';
import { checkSoftCap, recordRequest } from '../providers/softcap';
import type { EnhanceRequest, EnhanceResult } from '../messaging/protocol';
import { assemble } from './assemble';
import { clean } from './clean';
import { resolveProfile } from './resolve';

/**
 * One enhancement, worker-side.
 *
 * Runs only in the background worker — it reads API keys, which a content
 * script must never see. The AbortSignal is wired to the Port: when the user
 * presses Stop, the port disconnects, this aborts, and the in-flight fetch is
 * cancelled rather than left to bill quietly in the background.
 */

export interface RunContext {
  signal: AbortSignal;
  /** Announced before the request so the panel can render the profile chip. */
  onAccepted?: (profileId: string, auto: boolean) => void;
  /** Each delta as it arrives. Supplying this streams the request. */
  onChunk?: (delta: string) => void;
}

export async function runEnhancement(
  request: EnhanceRequest,
  context: RunContext,
): Promise<EnhanceResult> {
  const settings = await getSettings();

  if (!settings.activeProviderId) {
    throw errorFor('bad-key', 'Add a provider in PromptAmp settings.');
  }

  const cap = await checkSoftCap();
  if (cap.exceeded) {
    throw errorFor(
      'soft-cap',
      `${String(cap.count)} enhancements today (limit ${String(cap.limit)}).`,
    );
  }

  const { profile, auto } = await resolveProfile(
    request.origin,
    request.profileId,
  );
  context.onAccepted?.(profile.id, auto);

  const cred = await getCredential(settings.activeProviderId);
  if (!cred) throw errorFor('bad-key');

  // Throws before any network call if the draft is over the pre-flight limit,
  // so an over-long draft fails in milliseconds rather than after a paid trip.
  const { system, user, maxTokens } = assemble(
    profile,
    request.draft,
    request.adjust,
    settings.outputLanguageOverride,
  );

  const response = await chat(settings.activeProviderId, {
    cred,
    system,
    user,
    maxTokens,
    signal: context.signal,
    ...(context.onChunk ? { onChunk: context.onChunk } : {}),
  });

  // Client-side defence: the prompts forbid lead-ins and fences, and cheap
  // models emit them anyway.
  const { text } = clean(response.text, request.draft);

  await recordRequest();

  const costUsd = estimateCostUsd(
    settings.activeProviderId,
    cred.model,
    response.promptTokens,
    response.completionTokens,
  );

  const result: EnhanceResult = {
    text,
    profileId: profile.id,
    providerId: settings.activeProviderId,
    model: cred.model,
    ...(response.promptTokens === undefined
      ? {}
      : { promptTokens: response.promptTokens }),
    ...(response.completionTokens === undefined
      ? {}
      : { completionTokens: response.completionTokens }),
    ...(costUsd === undefined ? {} : { costUsd }),
  };

  // History is local-only and best-effort: failing to record must never fail
  // an enhancement the user already paid for.
  try {
    await addHistoryEntry({
      id: crypto.randomUUID(),
      at: Date.now(),
      origin: request.origin,
      profileId: profile.id,
      providerId: settings.activeProviderId,
      model: cred.model,
      original: request.draft,
      enhanced: text,
      ...(response.promptTokens === undefined
        ? {}
        : { promptTokens: response.promptTokens }),
      ...(response.completionTokens === undefined
        ? {}
        : { completionTokens: response.completionTokens }),
      ...(costUsd === undefined ? {} : { costUsd }),
    });
  } catch {
    // Storage full or unavailable — the result still stands.
  }

  return result;
}

export { toSafeError };
