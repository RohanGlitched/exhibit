/** Formatting shared by server and client. Dates are always "3 Oct 2026" so the brief checker can match them. */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const TZ = "America/Los_Angeles"; // the shop is in Portland; every date in a case is the shop's local date

export function clockParts(d: Date) {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (t: string) => Number(f.find((p) => p.type === t)?.value);
  return { y: get("year"), m: get("month"), d: get("day"), h: get("hour"), min: get("minute") };
}

/** The instant when the shop's wall clock reads y-m-d h:min, on either side of a clock change. */
export function zonedToUtc(y: number, m: number, d: number, h: number, min = 0): Date {
  let t = Date.UTC(y, m - 1, d, h, min);
  for (let i = 0; i < 2; i++) {
    const p = clockParts(new Date(t));
    t += Date.UTC(y, m - 1, d, h, min) - Date.UTC(p.y, p.m - 1, p.d, p.h, p.min);
  }
  return new Date(t);
}

export const day = (iso: string | Date) => {
  const p = clockParts(new Date(iso));
  return `${p.d} ${MONTHS[p.m - 1]} ${p.y}`;
};

export const dayTime = (iso: string | Date) => {
  const p = clockParts(new Date(iso));
  return `${p.d} ${MONTHS[p.m - 1]} ${p.y}, ${String(p.h).padStart(2, "0")}:${String(p.min).padStart(2, "0")}`;
};

export const shortDay = (iso: string | Date) => {
  const p = clockParts(new Date(iso));
  return `${p.d} ${MONTHS[p.m - 1]}`;
};

export const usd = (v: string | number) =>
  `$${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const REASONS: Record<string, string> = {
  MERCHANDISE_OR_SERVICE_NOT_RECEIVED: "Not received",
  MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED: "Not as described",
  UNAUTHORISED: "Unauthorised",
  CREDIT_NOT_PROCESSED: "Refund not processed",
  DUPLICATE_TRANSACTION: "Charged twice",
  INCORRECT_AMOUNT: "Wrong amount",
  PAYMENT_BY_OTHER_MEANS: "Paid another way",
  CANCELED_RECURRING_BILLING: "Cancelled subscription",
  PROBLEM_WITH_REMITTANCE: "Remittance problem",
  OTHER: "Other",
};

export const reasonLabel = (r: string) => REASONS[r] ?? r.toLowerCase().replace(/_/g, " ");

export const STAGES: Record<string, string> = {
  INQUIRY: "Inquiry",
  CHARGEBACK: "Claim",
  PRE_ARBITRATION: "Pre-arbitration",
  ARBITRATION: "Arbitration",
};

export const STATUSES: Record<string, string> = {
  OPEN: "Open",
  WAITING_FOR_SELLER_RESPONSE: "Your move",
  WAITING_FOR_BUYER_RESPONSE: "Buyer's move",
  UNDER_REVIEW: "PayPal reviewing",
  RESOLVED: "Resolved",
  OTHER: "Other",
};

/** Whole days (can be negative) until an ISO time. */
export const daysUntil = (iso?: string, now = Date.now()) => (iso ? Math.ceil((new Date(iso).getTime() - now) / 86_400_000) : null);

const DAY_MS = 86_400_000;

/**
 * Whole days since PayPal's deadline passed, null while it hasn't. One rounding for every page that says
 * "missed N days ago" (the desk, its cards, the case line, the analytics ladder and grid): complete days
 * since the deadline, and at least 1, so a deadline that passed an hour ago is "a day ago", never "today".
 */
export function daysMissed(due: string | null | undefined, now = Date.now()): number | null {
  if (!due) return null;
  const late = now - new Date(due).getTime();
  return late > 0 ? Math.max(1, Math.floor(late / DAY_MS)) : null;
}

/**
 * Days on PayPal's clock as one signed number: days left while the deadline is ahead (0 when under a day is
 * left, otherwise counted up), and minus daysMissed once it has passed.
 */
export function daysToDue(due: string, now = Date.now()): number {
  const missed = daysMissed(due, now);
  if (missed !== null) return -missed;
  const ms = new Date(due).getTime() - now;
  return ms < DAY_MS ? 0 : Math.ceil(ms / DAY_MS);
}

/** "today" is never said of a passed deadline: "a day ago", "11 days ago". */
export const missedWords = (n: number) => (n <= 1 ? "a day ago" : `${n} days ago`);
