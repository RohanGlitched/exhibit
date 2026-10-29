/** The arithmetic behind /api/health, kept pure so the tests can check it. */

const HOUR = 3_600_000;
/** A visitor is only handed a case with at least this long left before PayPal's deadline. */
export const READY_HOURS = 36;
/** The refill runs every two hours; older than this and the schedule has stopped. */
export const REFILL_STALE_HOURS = 3;

const round1 = (n: number) => Math.round(n * 10) / 10;
export const hoursUntil = (iso: string, now = Date.now()) => round1((new Date(iso).getTime() - now) / HOUR);
export const hoursSince = (iso: string, now = Date.now()) => round1((now - new Date(iso).getTime()) / HOUR);

/** Ready for a visitor: PayPal has passed it to the seller and 36 hours or more remain to answer. */
export function readyForVisitor(status: string | undefined, due: string | undefined | null, now = Date.now()): boolean {
  if (status !== "WAITING_FOR_SELLER_RESPONSE" || !due) return false;
  return (new Date(due).getTime() - now) / HOUR >= READY_HOURS;
}

export function refillProblem(lastRefillAt: string | null, now = Date.now()): string | null {
  if (!lastRefillAt) return "No pool refill on record yet.";
  const h = hoursSince(lastRefillAt, now);
  return h > REFILL_STALE_HOURS ? `The pool was last refilled ${h} hours ago; the refill runs every 2 hours.` : null;
}

export interface NearDeadline {
  id: string;
  dueInHours: number;
  kind: string;
}

/**
 * Problems among cases still waiting on the seller near PayPal's deadline. A case on the desk that missed its
 * deadline is not a fault (the desk shows it as missed, and the sandbox never closes it); pool stock that did
 * is, because the refill should have retired it first.
 */
export function deadlineProblems(near: NearDeadline[]): string[] {
  const out: string[] = [];
  for (const n of near) {
    if (n.dueInHours < 0 && n.kind === "pool stock") out.push(`${n.id} is pool stock ${Math.abs(n.dueInHours)} hours past PayPal's deadline and should have retired.`);
    else if (n.kind === "pool stock" && n.dueInHours < READY_HOURS) out.push(`${n.id} is pool stock inside ${READY_HOURS} hours of its deadline and should have retired.`);
  }
  return out;
}

/** How long after its deadline a missed case is still listed by id under nearDeadline. */
export const RECENT_MISS_HOURS = 24;

/** The kind of case the desk lists among its missed deadlines (pool stock and stray disputes are not on the desk). */
export const ON_THE_DESK = "on the desk";

/**
 * What /api/health lists by id: cases whose deadline is still ahead, or passed within the last day. Cases that
 * missed it longer ago are only counted (the desk shows them, folded, as missed), so the report stays about
 * deadlines that can still be met. `missed` counts what the desk counts: cases on the desk, not retired pool
 * stock or disputes Exhibit holds no record of; those are counted apart, by kind, in `missedElsewhere`.
 */
export function splitDeadlines(
  near: NearDeadline[],
  recentHours = RECENT_MISS_HOURS,
): { listed: NearDeadline[]; missed: number; missedLongAgo: number; missedElsewhere: Record<string, number> } {
  const listed = near.filter((n) => n.dueInHours >= -recentHours);
  const past = near.filter((n) => n.dueInHours < 0);
  const missedElsewhere: Record<string, number> = {};
  for (const n of past) if (n.kind !== ON_THE_DESK) missedElsewhere[n.kind] = (missedElsewhere[n.kind] ?? 0) + 1;
  return { listed, missed: past.filter((n) => n.kind === ON_THE_DESK).length, missedLongAgo: near.length - listed.length, missedElsewhere };
}
