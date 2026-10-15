import "server-only";
import { allowed } from "../paypal/disputes";
import { filedDocument, ruledAt, stageLine, stageOf, type Stage } from "./derive";
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
  /** Where the case stands, read from PayPal: open, waiting, filed, refunded, won, lost. */
  where: Stage;
  whereLine: string;
  channel: string | null;
  due: string | null;
  created: string;
  outcome: string | null;
  ruledAt: string | null;
  evidences: { type: string; source?: string; date?: string }[];
  actions: string[];
  exhibits: Exhibit[];
  brief: Brief | null;
  filings: Filing[];
  /** The PDF PayPal holds on file for this case, served through /api/cases/[id]/filed. */
  filedPdf: { at: string | null } | null;
  story: { title: string; blurb: string; buyer: string } | null;
  invoiceId: string | null;
  mine: boolean;
  openedAt: string;
  restored: boolean;
}

export async function caseView(id: string, visitor: string | null): Promise<CaseView> {
  const ctx = await caseContext(id);
  const d = ctx.dispute;
  const s = ctx.scenario;
  const where = stageOf(d, ctx.filings);
  const doc = filedDocument(d);
  return {
    id: d.dispute_id,
    reason: d.reason,
    amount: d.dispute_amount,
    status: d.status,
    state: d.dispute_state ?? null,
    stage: d.dispute_life_cycle_stage ?? null,
    where,
    whereLine: stageLine(where, d, ctx.filings),
    channel: d.dispute_channel ?? null,
    due: d.seller_response_due_date ?? null,
    created: d.create_time,
    outcome: d.dispute_outcome?.outcome_code ?? null,
    ruledAt: ruledAt(d),
    evidences: (d.evidences ?? []).map((e) => ({ type: e.evidence_type, source: e.source, date: e.date })),
    actions: [...allowed(d)].filter((a) => a !== "self"),
    exhibits: ctx.exhibits,
    brief: ctx.brief,
    filings: ctx.filings,
    filedPdf: doc ? { at: doc.at } : null,
    story: s ? { title: s.title, blurb: s.blurb, buyer: s.buyer.name } : null,
    invoiceId: ctx.invoiceId ?? null,
    mine: Boolean(visitor && ctx.record?.claimedBy === visitor),
    openedAt: ctx.record?.openedAt ?? d.create_time,
    restored: Boolean(ctx.record?.restored) || (!ctx.record && ctx.filings.some((f) => f.source === "paypal")),
  };
}
