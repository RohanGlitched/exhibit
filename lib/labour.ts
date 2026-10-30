/**
 * The seller's own time, which the per-100 tables otherwise count only in responses. There is no sourced figure
 * for how long a seller spends writing one chargeback response, so these are labelled assumptions, shown at three
 * lengths, and one assumed hourly value of a small seller's time. Pure and client-safe.
 */
export const LABOUR = {
  /** Minutes one response takes the seller to gather and write, without Exhibit: an assumption, shown at each. */
  minutes: [15, 30, 60] as const,
  /** An assumed value of an hour of the seller's time, in US dollars. */
  usdPerHour: 25,
};

/** What the seller's time on `responses` responses comes to, in hours and dollars, at `minutes` each. */
export function labourFor(responses: number, minutes: number, usdPerHour = LABOUR.usdPerHour) {
  const hours = (responses * minutes) / 60;
  return { hours, usd: Math.round(hours * usdPerHour) };
}

/**
 * The chance of winning above which fighting one case beats refunding it, counting the seller's time. PayPal's fee
 * is charged either way, so it cancels: fight when p × amount > time cost, so p* = time cost / amount (at most 1).
 */
export function breakEvenWinRate(amount: number, minutes: number, usdPerHour = LABOUR.usdPerHour): number {
  if (!(amount > 0)) return 1;
  return Math.min(1, ((minutes / 60) * usdPerHour) / amount);
}

export const pct = (p: number) => `${Math.round(p * 100)}%`;
