/** The deadline ladder's arithmetic, apart from its drawing so it can be tested. */

export interface Rung {
  id: string;
  days: number;
  amount: number | null;
  label: string;
}

export interface LadderGroups {
  /** Cases still inside PayPal's window, soonest deadline first (then the larger amount). */
  live: Rung[];
  /** Cases whose deadline passed with no answer, most recently missed first. */
  missed: Rung[];
  /** Live cases due within the urgent window, and the money on them. */
  urgent: { count: number; amount: number };
}

/**
 * Splits rungs into the seller's live moves and the deadlines already missed. A negative day count is a
 * deadline that has passed: it is never "due today", and it is not counted as urgent.
 */
export function splitLadder(rungs: Rung[], urgentDays: number): LadderGroups {
  const live = rungs.filter((r) => r.days >= 0).sort((a, b) => a.days - b.days || (b.amount ?? 0) - (a.amount ?? 0));
  const missed = rungs.filter((r) => r.days < 0).sort((a, b) => b.days - a.days || (b.amount ?? 0) - (a.amount ?? 0));
  const soon = live.filter((r) => r.days <= urgentDays);
  return { live, missed, urgent: { count: soon.length, amount: soon.reduce((s, r) => s + (r.amount ?? 0), 0) } };
}

/** Most missed cases listed by name before the rest are summed up. */
export const MISSED_SHOWN = 5;

/**
 * Canvas rows (Studio's 18 px tracks) the ladder needs for its rungs, so the widget is sized to what it
 * draws instead of a fixed block of empty paper.
 */
export function ladderRows(live: number, missed: number, maxRungs = 12): number {
  const shownLive = Math.min(live, maxRungs);
  const shownMissed = Math.min(missed, MISSED_SHOWN);
  let px = 92; // title, subtitle, the count line and padding
  px += live === 0 ? 56 : shownLive * 72 + (live > maxRungs ? 26 : 0) + 30; // rungs, "and N more", the scale note
  if (missed > 0) px += 44 + shownMissed * 30 + (missed > MISSED_SHOWN ? 24 : 0);
  return Math.max(16, Math.min(44, Math.ceil((px + 20) / 18)));
}
