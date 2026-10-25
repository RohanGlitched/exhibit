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

/** Problems among cases still waiting on the seller near PayPal's deadline. */
export function deadlineProblems(near: NearDeadline[]): string[] {
  const out: string[] = [];
  for (const n of near) {
    if (n.dueInHours < 0) out.push(`${n.id} is ${Math.abs(n.dueInHours)} hours past PayPal's deadline and still shows as waiting on the seller (${n.kind}).`);
    else if (n.kind === "pool stock" && n.dueInHours < READY_HOURS) out.push(`${n.id} is pool stock inside ${READY_HOURS} hours of its deadline and should have retired.`);
  }
  return out;
}
