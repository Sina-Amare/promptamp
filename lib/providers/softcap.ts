import { getSettings, softCapItem, getSoftCap } from '../storage/items';

/**
 * A local, per-day request counter.
 *
 * This is not billing enforcement — it is a guard against the user's own key
 * quietly running up a bill because a shortcut got held down or a page loop
 * re-triggered enhancement. It counts locally, resets on the calendar day, and
 * asks for confirmation once the threshold is passed rather than hard-blocking.
 */

/** Local calendar day, not UTC — "today" should mean the user's today. */
export function localDay(now: Date): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${String(year)}-${month}-${day}`;
}

export interface SoftCapStatus {
  /** Requests already made today. */
  count: number;
  /** 0 means the cap is disabled. */
  limit: number;
  /** True once the user is at or past the limit. */
  exceeded: boolean;
}

export async function checkSoftCap(now = new Date()): Promise<SoftCapStatus> {
  const settings = await getSettings();
  const counter = await getSoftCap();
  const today = localDay(now);
  // A stale day means the counter belongs to a previous day; treat it as zero
  // without writing, so a read never has a side effect.
  const count = counter.day === today ? counter.count : 0;
  const limit = settings.softCapPerDay;

  return { count, limit, exceeded: limit > 0 && count >= limit };
}

/** Call once per accepted request, after the soft cap has been cleared. */
export async function recordRequest(now = new Date()): Promise<number> {
  const today = localDay(now);
  const counter = await getSoftCap();
  const next = counter.day === today ? counter.count + 1 : 1;
  await softCapItem.setValue({ day: today, count: next });
  return next;
}
