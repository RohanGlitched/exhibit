import "server-only";
import { allowed } from "../paypal/disputes";
import { scenario } from "../shop/scenarios";
import { caseContext } from "./service";
import type { Brief, Exhibit, Filing } from "./types";

/** Everything the case page shows, as plain JSON (also used for the server render). */
export interface CaseView {
  id: string;
  reason: string;
  amount: { currency_code: string; value: string };
  status: string;
  state: string | null;
  stage: string | null;
  channel: string | null;
  due: string | null;
  created: string;
  outcome: string | null;
  evidences: { type: string; source?: string; date?: string }[];
  actions: string[];
  exhibits: Exhibit[];
  brief: Brief | null;
  filings: Filing[];
  story: { title: string; blurb: string; buyer: string } | null;
  invoiceId: string | null;
  mine: boolean;
  openedAt: string;
}

export async function caseView(id: string, visitor: string | null): Promise<CaseView> {
  const ctx = await caseContext(id);
  const d = ctx.dispute;
  const s = ctx.record?.scenarioId ? scenario(ctx.record.scenarioId) : undefined;
  return {
    id: d.dispute_id,
    reason: d.reason,
    amount: d.dispute_amount,
    status: d.status,
    state: d.dispute_state ?? null,
    stage: d.dispute_life_cycle_stage ?? null,
    channel: d.dispute_channel ?? null,
    due: d.seller_response_due_date ?? null,
    created: d.create_time,
    outcome: d.dispute_outcome?.outcome_code ?? null,
    evidences: (d.evidences ?? []).map((e) => ({ type: e.evidence_type, source: e.source, date: e.date })),
    actions: [...allowed(d)].filter((a) => a !== "self"),
    exhibits: ctx.exhibits,
    brief: ctx.record?.brief ?? null,
    filings: ctx.record?.filings ?? [],
    story: s ? { title: s.title, blurb: s.blurb, buyer: s.buyer.name } : null,
    invoiceId: ctx.record?.invoiceId ?? null,
    mine: Boolean(visitor && ctx.record?.claimedBy === visitor),
    openedAt: ctx.record?.openedAt ?? d.create_time,
  };
}
