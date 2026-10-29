import "server-only";
import { unstable_cache } from "next/cache";
import { listCases } from "./store";
import { caseView } from "./cases/view";
import type { Exchange, Hearing } from "./cases/hearing";
import type { AgentStep } from "./agentic/types";

/**
 * Live material for two home-page sections, read from the case store and PayPal, never written by hand:
 * - a real hearing with OBJECTION, SUSTAINED and OVERRULED (a filed case's, on PayPal's own copy, preferred);
 * - the seller's lane case that went furthest without anyone touching it, with its audit lines, and the latest
 *   purchase the live buyer agent made, with its tool calls and the keys its mandates were signed with.
 */

export interface LiveHearing {
  caseId: string;
  title: string | null;
  source: Hearing["source"];
  at: string;
  verdict: Hearing["verdict"];
  exchanges: Exchange[];
  response: Hearing["response"];
  outcome: string | null;
}

export interface LiveLane {
  caseId: string;
  title: string | null;
  amount: string;
  where: string;
  whereLine: string;
  audit: { at: string; text: string }[];
}

export interface LiveAgent {
  caseId: string;
  cardholder: string | null;
  model: string | null;
  steps: Pick<AgentStep, "n" | "tool" | "ok" | "why" | "result">[];
  told: string | null;
  intentKid: string;
  cartKid: string;
  digest: string;
  orderId: string | null;
  checks: { label: string; ok: boolean }[];
  verdict: string | null;
}

const score = (h: Hearing) =>
  (h.exchanges.some((e) => e.ruling === "overruled") ? 8 : 0) +
  (h.exchanges.some((e) => e.ruling === "sustained") ? 4 : 0) +
  (h.source === "paypal" ? 2 : 0) +
  (h.verdict.side === "seller" ? 1 : 0);

export const homeLive = unstable_cache(
  async (): Promise<{ hearing: LiveHearing | null; lane: LiveLane | null; agent: LiveAgent | null }> => {
    const cases = await listCases().catch(() => []);
    // The hearing: any case's saved cross-examination with an overruled answer, best first, newest on ties.
    const heard = cases
      .filter((c) => c.hearing && c.hearing.mode === "cross" && c.hearing.engine === "model" && c.hearing.exchanges.length > 0)
      .sort((a, b) => score(b.hearing!) - score(a.hearing!) || b.hearing!.at.localeCompare(a.hearing!.at));
    const h = heard[0];
    let hearing: LiveHearing | null = null;
    if (h?.hearing) {
      const v = await caseView(h.disputeId, null).catch(() => null);
      hearing = {
        caseId: h.disputeId,
        title: v?.story?.title ?? null,
        source: h.hearing.source,
        at: h.hearing.at,
        verdict: h.hearing.verdict,
        exchanges: h.hearing.exchanges.slice(0, 3),
        response: h.hearing.response,
        outcome: v?.ending?.line ?? null,
      };
    }
    // The lane: the seller's case with the longest audit trail, newest on ties.
    const lanes = cases.filter((c) => c.lane === "autopilot" && c.house).sort((a, b) => {
      const steps = (c: typeof a) => (c.house?.done ? 2 : 0) + (c.filings.some((f) => f.action === "ruling") ? 2 : 0) + (c.events?.some((e) => e.type === "CUSTOMER.DISPUTE.RESOLVED") ? 3 : 0);
      return steps(b) - steps(a) || b.openedAt.localeCompare(a.openedAt);
    });
    let lane: LiveLane | null = null;
    if (lanes[0]) {
      const v = await caseView(lanes[0].disputeId, null).catch(() => null);
      if (v?.house) lane = { caseId: v.id, title: v.story?.title ?? null, amount: v.amount.value, where: v.where, whereLine: v.whereLine, audit: v.house.audit };
    }
    // The live buyer agent's latest purchase.
    const bought = cases
      .filter((c) => c.agent?.engine === "model" && c.agent.steps.length > 0)
      .sort((a, b) => b.agent!.startedAt.localeCompare(a.agent!.startedAt))[0];
    let agent: LiveAgent | null = null;
    if (bought?.agent) {
      const v = await caseView(bought.disputeId, null).catch(() => null);
      const r = bought.agent;
      agent = {
        caseId: bought.disputeId,
        cardholder: v?.agent?.cardholder ?? null,
        model: r.model ?? null,
        steps: r.steps.map((s) => ({ n: s.n, tool: s.tool, ok: s.ok, why: s.why, result: s.result.slice(0, 160) })),
        told: r.told ?? null,
        intentKid: r.intent.kid,
        cartKid: r.cart.kid,
        digest: r.digest,
        orderId: r.orderId ?? null,
        checks: (v?.agent?.checks ?? []).map((c) => ({ label: c.label, ok: c.ok })),
        verdict: v?.agent?.verdict.line ?? null,
      };
    }
    return { hearing, lane, agent };
  },
  ["home-live-v1"],
  { revalidate: 300 },
);
