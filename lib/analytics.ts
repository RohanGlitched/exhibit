import "server-only";
import { unstable_cache } from "next/cache";
import { deskRows, type DeskRow } from "./desk";
import { listCases } from "./store";
import { REASONS, day } from "./format";
import type { Stage } from "./cases/derive";

/**
 * Flat rows for the analytics dashboard (AG Studio): one per shop case on the sandbox account, from the same
 * source as the desk (PayPal's dispute list and what PayPal holds as filed), plus the brief Exhibit wrote.
 * Plain values only (strings, numbers, ISO dates), so Studio's data engine can group, filter and chart them.
 */
export interface CaseFact {
  caseId: string;
  story: string;
  reason: string;
  amount: number;
  stage: string; // "Your move", "Filed", "Won", "Lost", "Refunded", "PayPal reviewing"
  stageKey: Stage;
  outcome: "Won" | "Lost" | "Refunded" | "Pending";
  call: "Fight" | "Refund" | "Not argued";
  engine: "Model" | "Rules engine" | "Read back from PayPal" | "Not argued";
  odds: number | null; // the seller's chance from the brief's tally
  sentences: number;
  struck: number;
  evidenceType: string; // what was filed, e.g. "Proof of fulfillment"
  buyer: string;
  opened: string; // ISO date of the dispute
  openedDay: string; // "5 Oct 2026"
  filed: string | null;
  due: string | null;
  daysLeft: number | null; // days to PayPal's deadline while it's the seller's move
  kept: number; // money the seller kept (won)
  refunded: number; // money returned by accepting
  lostAmount: number; // money lost after fighting or not answering
  atStake: number; // still undecided
}

// A missed deadline loses the money as surely as a ruling does; the stage says which it was.
const OUTCOME: Partial<Record<Stage, CaseFact["outcome"]>> = { won: "Won", lost: "Lost", lapsed: "Lost", refunded: "Refunded" };
const STAGE: Record<Stage, string> = {
  open: "PayPal reviewing",
  waiting: "Your move",
  lapsed: "Missed deadline",
  filed: "Filed",
  refunded: "Refunded",
  won: "Won",
  lost: "Lost",
  reviewing: "PayPal reviewing",
  other: "Other",
};

const evidenceWords = (summary: string | null) => {
  const m = summary?.match(/as (proof of [a-z ]+?|other|item description|return policy)(?: with| and|$|\))/i);
  if (m) return m[1].charAt(0).toUpperCase() + m[1].slice(1);
  if (summary?.startsWith("Accepted")) return "Accepted the claim";
  return summary ? "Other" : "Nothing filed";
};

function fact(r: DeskRow, sentences: number, struck: number, evidence: string | null): CaseFact {
  const outcome = OUTCOME[r.where] ?? "Pending";
  const daysLeft = r.due && r.where === "waiting" ? Math.ceil((new Date(r.due).getTime() - Date.now()) / 86_400_000) : null;
  return {
    caseId: r.id,
    story: r.story?.replace(/[“”]/g, "") ?? "Other",
    reason: REASONS[r.reason] ?? r.reason,
    amount: r.amount,
    stage: STAGE[r.where],
    stageKey: r.where,
    outcome,
    call: r.recommendation === "fight" ? "Fight" : r.recommendation === "accept" ? "Refund" : "Not argued",
    engine: r.engine === "model" ? "Model" : r.engine === "rules" ? "Rules engine" : r.engine === "paypal" || (r.source === "paypal" && r.filed) ? "Read back from PayPal" : "Not argued",
    odds: r.odds,
    sentences,
    struck,
    evidenceType: evidenceWords(evidence ?? r.filed),
    buyer: r.buyer ?? "",
    opened: r.opened,
    openedDay: day(r.opened),
    filed: r.filedAt,
    due: r.due,
    daysLeft,
    kept: outcome === "Won" ? r.amount : 0,
    refunded: outcome === "Refunded" ? r.amount : 0,
    lostAmount: outcome === "Lost" ? r.amount : 0,
    atStake: outcome === "Pending" ? r.amount : 0,
  };
}

export interface SentenceFact {
  caseId: string;
  story: string;
  engine: string;
  kept: "Kept" | "Struck";
  why: string; // why the checker struck it ("" when kept)
  cites: number;
  argued: string; // ISO time the brief was written
  arguedDay: string;
}

/** Every case on the desk, and every sentence Exhibit has written and checked. Cached for a minute. */
export const analytics = unstable_cache(
  async (): Promise<{ cases: CaseFact[]; sentences: SentenceFact[]; at: string }> => {
    const [rows, records] = await Promise.all([deskRows(null), listCases()]);
    const byId = new Map(records.map((r) => [r.disputeId, r]));
    const shop = rows.filter((r) => !r.pooled && !r.retired && r.source !== "probe");
    const cases = shop.map((r) => {
      const brief = byId.get(r.id)?.brief;
      const evidence = byId.get(r.id)?.filings.filter((f) => f.action === "evidence" || f.action === "accept").at(-1)?.summary ?? null;
      return fact(r, brief?.sentences.length ?? 0, brief?.sentences.filter((s) => !s.kept).length ?? 0, evidence);
    });
    const sentences: SentenceFact[] = shop.flatMap((r) => {
      const brief = byId.get(r.id)?.brief;
      if (!brief) return [];
      return brief.sentences.map((s) => ({
        caseId: r.id,
        story: r.story?.replace(/[“”]/g, "") ?? "Other",
        engine: brief.engine === "model" ? "Model" : brief.engine === "rules" ? "Rules engine" : "Read back from PayPal",
        kept: s.kept ? ("Kept" as const) : ("Struck" as const),
        why: s.kept ? "" : (s.why ?? ""),
        cites: s.cites.length,
        argued: brief.createdAt,
        arguedDay: day(brief.createdAt),
      }));
    });
    return { cases, sentences, at: new Date().toISOString() };
  },
  ["analytics-v1"],
  { revalidate: 60 },
);
