/** The house pool, as pure rules: which cases count as stock, and which stories a refill opens first. */
import { isFiled } from "./guard";
import type { CaseRecord } from "./types";

/**
 * Nobody has worked the case: no visitor claimed it, nothing was filed, and its brief (if any) is the one the
 * webhook autopilot wrote the moment PayPal sent the case.
 */
export const untouched = (c: CaseRecord) =>
  !c.lane &&
  !c.claimedBy && !isFiled(c.filings) && (!c.brief || Boolean(c.autopilot && c.brief.createdAt === c.autopilot.briefAt));

/** Stock a visitor can be handed. */
export const inPool = (c: CaseRecord) => untouched(c) && !c.retired;

/**
 * The stories to open, in order: always the story with the least stock next (empty stories first, ties in
 * catalogue order), up to `target` each and `limit` in all.
 */
export function refillPlan(stock: Record<string, number>, stories: string[], target: number, limit: number): string[] {
  const have = new Map(stories.map((s) => [s, stock[s] ?? 0]));
  const plan: string[] = [];
  while (plan.length < limit) {
    let pick: string | null = null;
    for (const s of stories) if (have.get(s)! < target && (pick === null || have.get(s)! < have.get(pick)!)) pick = s;
    if (pick === null) break;
    plan.push(pick);
    have.set(pick, have.get(pick)! + 1);
  }
  return plan;
}
