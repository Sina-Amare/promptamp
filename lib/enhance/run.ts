import { addHistoryEntry, getSettings } from '../storage/items';
import { listConnections } from '../storage/credentials';
import { chat } from '../providers';
import { estimateCostUsd } from '../providers/cost';
import {
  MAX_RETRIES,
  errorFor,
  remedyFor,
  toSafeError,
} from '../providers/errors';
import { checkSoftCap, recordRequest } from '../providers/softcap';
import type {
  EnhanceRequest,
  EnhanceResult,
  SafeError,
} from '../messaging/protocol';
import type { Connection } from '../storage/schemas';
import { assemble } from './assemble';
import { type Attempt, handsOver } from './chain';
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
  /**
   * A connection failed part-way through streaming and the next one is
   * starting over. Whatever has been revealed so far is now the wrong half of
   * a different answer and has to be discarded — without this the panel would
   * show two rewrites spliced together.
   */
  onReset?: () => void;
}

export async function runEnhancement(
  request: EnhanceRequest,
  context: RunContext,
): Promise<EnhanceResult> {
  const settings = await getSettings();
  const connections = await listConnections();

  if (connections.length === 0) {
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

  // Throws before any network call if the draft is over the pre-flight limit,
  // so an over-long draft fails in milliseconds rather than after a paid trip.
  const { system, user, maxTokens } = assemble(
    profile,
    request.draft,
    request.adjust,
    settings.outputLanguageOverride,
  );

  const attempts: Attempt[] = [];

  for (const [index, connection] of connections.entries()) {
    const isLast = index === connections.length - 1;

    try {
      const response = await chat(connection.providerId, {
        cred: connection,
        system,
        user,
        maxTokens,
        signal: context.signal,
        // Waiting out a long Retry-After only makes sense when there is
        // nothing behind this connection to try instead.
        maxRetries: isLast ? MAX_RETRIES : 0,
        ...(context.onChunk ? { onChunk: context.onChunk } : {}),
      });

      return await finish({
        request,
        profileId: profile.id,
        connection,
        response,
        ...(attempts.length > 0
          ? {
              fellBackFrom: {
                label: attempts[0]!.label,
                kind: attempts[0]!.kind,
                message: attempts[0]!.message,
              },
            }
          : {}),
      });
    } catch (err) {
      const safe = toSafeError(err);
      attempts.push({
        connectionId: connection.id,
        label: connection.label,
        kind: safe.kind,
        message: safe.message,
      });

      // A draft-level or user-level failure repeats identically everywhere;
      // handing it down the chain would just spend money to fail again.
      if (!handsOver(safe.kind) || isLast) {
        throw new ChainFailure(chainError(safe, attempts));
      }

      context.onReset?.();
    }
  }

  // Unreachable: the loop either returns or throws. Kept so a future edit that
  // breaks that invariant fails loudly rather than returning undefined.
  throw errorFor('unknown');
}

/**
 * Carries an already-built `SafeError` through the throw, so the chain summary
 * (which connections were tried, and what each said) survives the trip to the
 * panel instead of being flattened back into one message.
 */
export class ChainFailure extends Error {
  readonly safe: SafeError;

  constructor(safe: SafeError) {
    super(safe.message);
    this.name = 'ChainFailure';
    this.safe = safe;
  }
}

/**
 * One connection failing is an error about that connection. Several failing is
 * a different situation, and flattening it to whatever the last one said hides
 * the useful half — "the key is bad" and "you are out of credit" need
 * different fixes, and the user has to see both to know which to do first.
 */
function chainError(last: SafeError, attempts: Attempt[]): SafeError {
  if (attempts.length <= 1) {
    return {
      ...last,
      ...(attempts[0] ? { connectionLabel: attempts[0].label } : {}),
    };
  }

  // The first distinct actionable cause, not the last failure: if the primary
  // key is revoked and the fallback is merely rate-limited, fixing the key is
  // what actually restores service.
  const primary = attempts.find((a) => a.kind !== 'unknown') ?? attempts[0]!;
  const remedy = remedyFor(primary.kind);

  return {
    kind: primary.kind,
    message: `All ${String(attempts.length)} connections failed.`,
    ...(remedy ? { remedy } : {}),
    ...(last.retryAfterSec === undefined
      ? {}
      : { retryAfterSec: last.retryAfterSec }),
    attempts: attempts.map((a) => ({
      label: a.label,
      kind: a.kind,
      message: a.message,
    })),
  };
}

interface FinishArgs {
  request: EnhanceRequest;
  profileId: string;
  connection: Connection;
  response: { text: string; promptTokens?: number; completionTokens?: number };
  fellBackFrom?: EnhanceResult['fellBackFrom'];
}

async function finish(args: FinishArgs): Promise<EnhanceResult> {
  const { request, profileId, connection, response, fellBackFrom } = args;

  // Client-side defence: the prompts forbid lead-ins and fences, and cheap
  // models emit them anyway.
  const { text, declined } = clean(response.text, request.draft);

  // Awaited: the soft cap is the only guard against a runaway loop spending
  // the user's money, and a dropped increment quietly weakens it.
  await recordRequest();

  // Nothing to rewrite: return a declined result the panel renders as a gentle
  // note. No history entry — there is no enhancement to keep.
  if (declined) {
    return {
      text: '',
      declined: true,
      profileId,
      providerId: connection.providerId,
      model: connection.model,
      connectionLabel: connection.label,
      ...(fellBackFrom ? { fellBackFrom } : {}),
    };
  }

  const costUsd = estimateCostUsd(
    connection.providerId,
    connection.model,
    response.promptTokens,
    response.completionTokens,
  );

  const tokens = {
    ...(response.promptTokens === undefined
      ? {}
      : { promptTokens: response.promptTokens }),
    ...(response.completionTokens === undefined
      ? {}
      : { completionTokens: response.completionTokens }),
    ...(costUsd === undefined ? {} : { costUsd }),
  };

  const result: EnhanceResult = {
    text,
    profileId,
    providerId: connection.providerId,
    model: connection.model,
    connectionLabel: connection.label,
    ...(fellBackFrom ? { fellBackFrom } : {}),
    ...tokens,
  };

  // History is local-only and best-effort: failing to record must never fail
  // an enhancement the user already paid for.
  void addHistoryEntry({
    id: crypto.randomUUID(),
    at: Date.now(),
    origin: request.origin,
    profileId,
    providerId: connection.providerId,
    model: connection.model,
    original: request.draft,
    enhanced: text,
    ...tokens,
  }).catch(() => undefined);

  return result;
}

/**
 * The one mapper the worker should call on an enhancement failure.
 *
 * `toSafeError` alone would see a `ChainFailure` as a plain Error and flatten
 * it to `kind: 'unknown'` with just its message — silently discarding the
 * remedy and the per-connection attempt list, which are the whole reason the
 * chain builds them.
 */
export function safeErrorForEnhancement(err: unknown): SafeError {
  return err instanceof ChainFailure ? err.safe : toSafeError(err);
}

export { toSafeError };
