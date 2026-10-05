/** Formatting shared by server and client. Dates are always "3 Oct 2026" so the brief checker can match them. */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const TZ = "America/Los_Angeles"; // the shop is in Portland; every date in a case is the shop's local date

function parts(d: Date) {
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

export const day = (iso: string | Date) => {
  const p = parts(new Date(iso));
  return `${p.d} ${MONTHS[p.m - 1]} ${p.y}`;
};

export const dayTime = (iso: string | Date) => {
  const p = parts(new Date(iso));
  return `${p.d} ${MONTHS[p.m - 1]} ${p.y}, ${String(p.h).padStart(2, "0")}:${String(p.min).padStart(2, "0")}`;
};

export const shortDay = (iso: string | Date) => {
  const p = parts(new Date(iso));
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
