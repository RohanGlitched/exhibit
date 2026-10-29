import type { Hearing } from "./cases/hearing";
import type { DecidedBy, Stage } from "./cases/derive";
import type { Filing } from "./cases/types";

/**
 * Which case the landing hero shows, as a score. Pure, so the tests can check the order. A case PayPal ruled
 * for the seller at Exhibit's request, after a hearing on the filed PDF in which the reviewer objected and at
 * least one objection was overruled, comes first: it shows the whole loop. Then a win ruled at Exhibit's request
 * that followed the reviewer's verdict, then any win ruled at Exhibit's request, then a win the sandbox closed
 * by itself, then (as before) the "delivered" story, filed, argued by
 * the model.
 */
export interface RankInput {
  where: Stage | undefined;
  decidedBy: DecidedBy | null | undefined;
  scenarioId?: string;
  filings: (Pick<Filing, "action" | "at"> & Partial<Pick<Filing, "summary">>)[];
  engine?: string;
  hearing?: Pick<Hearing, "at" | "mode" | "exchanges"> | null;
}

/** The hearing had a real contest: at least one objection, and at least one of them overruled. */
export const contested = (h: Pick<Hearing, "mode" | "exchanges"> | null | undefined) =>
  Boolean(h && h.mode === "cross" && h.exchanges.length > 0 && h.exchanges.some((e) => e.ruling === "overruled"));

export function showcaseRank(c: RankInput): number {
  const won = c.where === "won";
  const asked = won && c.decidedBy === "requested";
  // The hearing the ruling followed: held before Exhibit asked the sandbox to rule.
  const ruling = c.filings.filter((f) => f.action === "ruling").at(-1);
  const heardFirst = asked && contested(c.hearing) && (!ruling || !c.hearing || c.hearing.at <= ruling.at);
  // A ruling that followed the simulated reviewer's verdict (asked since the hearing existed, 25 Oct).
  const followed = asked && Boolean(ruling?.summary && /^Ruled by the simulated reviewer/.test(ruling.summary));
  return (
    (heardFirst ? 64 : 0) +
    (asked ? 32 : 0) +
    (followed ? 16 : 0) +
    (won ? 8 : 0) +
    (c.scenarioId === "delivered" ? 4 : 0) +
    (c.filings.some((f) => f.action === "evidence") ? 2 : 0) +
    (c.engine === "model" ? 1 : 0)
  );
}

/**
 * The hero's line on how the shown case ended, true to who decided it: PayPal ruling at Exhibit's request
 * (after the simulated reviewer's verdict, when it was), or the sandbox closing it on its own.
 */
export function heroRulingLine(r: { where: "won" | "lost"; by: DecidedBy | null; reviewer: boolean; day: string | null }): string {
  const side = r.where === "won" ? "seller" : "buyer";
  const on = r.day ? ` on ${r.day}` : "";
  if (r.by === "requested") return `PayPal ruled for the ${side} at Exhibit's request${on}${r.reviewer ? ", following the simulated reviewer's verdict" : ""}.`;
  return `Closed for the ${side} by the sandbox on its own${r.day ? `, ${r.day}` : ""}.`;
}
