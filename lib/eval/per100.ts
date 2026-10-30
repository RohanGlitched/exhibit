/**
 * The per-100 tables' sensitivity rows: what a policy keeps per 100 disputes if only a share of the fights it
 * files on cases labelled fight are won. The share is an assumption the page states, not a measurement; a fight on a
 * case labelled refund still wins nothing, and PayPal's fee is counted on every case either way.
 */
export interface Per100Base {
  /** USD kept over the runs when every fight on a case labelled fight is won. */
  keptRaw: number;
  /** Runs in the set. */
  n: number;
  /** USD of PayPal's fee over the same runs. */
  fees: number;
}

export function atWinRate(b: Per100Base, rate: number) {
  const per100 = (x: number) => Math.round((x * 100) / b.n);
  return { rate, keptUsd: per100(rate * b.keptRaw), netUsd: per100(rate * b.keptRaw - b.fees) };
}

/** The win rates the sensitivity rows are shown at. */
export const WIN_RATES = [0.3, 0.5];
