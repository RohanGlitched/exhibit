import "server-only";
import { allowed } from "../paypal/disputes";
import { decidedBy, filedDocument, followedReviewer, outcomeWords, ruledAt, rulingRequestOf, stageLine, stageOf, type DecidedBy, type Stage } from "./derive";
import { caseContext, type CaseContext } from "./service";
import { storyClock } from "./exhibits";
import { oddsFor } from "./verify";
import { reviewAgentOrder } from "../agentic/review";
import type { AgentView } from "../agentic/view";
import type { Brief, Exhibit, Filing } from "./types";
import { webhookView, type WebhookView } from "../webhooks/paypal";
import type { Hearing } from "./hearing";
import { requirementsFor, type RequirementsCard } from "./requirements";

/** What the buyer's agent did on an agent story, and who the mandate check holds responsible. */
function agentView(ctx: CaseContext): AgentView | null {
  const s = ctx.scenario;
  if (!s?.agent) return null;
  const clock = storyClock(ctx.record?.openedAt ?? ctx.dispute.create_time, s);
  const invoice = ctx.order?.purchase_units[0]?.invoice_id ?? ctx.invoiceId ?? "";
  const m = reviewAgentOrder(s, { run: ctx.record?.agent, invoiceId: invoice, orderAt: clock.orderAt, order: ctx.order });
  if (!m) return null;
  const run = m.run;
  const i = m.intent.mandate;
  return {
    request: i.request,
    item: i.item,
    limit: i.maxTotal,
    cardholder: i.cardholder,
    agentName: s.agent.name,
    verdict: m.verdict,
    checks: m.checks.map((c) => ({ label: c.label, ok: c.ok, detail: c.detail })),
    legacy: m.legacy,
    script: run ? undefined : s.agent.transcript,
    run: run
      ? {
          engine: run.engine,
          model: run.model,
          fallback: run.fallback,
          modelSteps: run.modelSteps,
          modelTold: run.modelTold,
          steps: run.steps,
          told: run.told,
          injection: Boolean(run.injection),
          digest: run.digest,
          orderId: run.orderId,
          ms: run.ms,
          intentKid: run.intent.kid,
          cartKid: run.cart.kid,
        }
      : undefined,
  };
}

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
  /** Who decided a case that is over: PayPal at Exhibit's request, the sandbox on its own, the deadline, or the seller. */
  decidedBy: DecidedBy | null;
  /** A ruling Exhibit asked for followed the simulated reviewer's verdict. */
  followedReviewer: boolean;
  /** How a won or lost case ended and who decided it, as a line and as the stamp's date line. */
  ending: { line: string; what: string; stamp: string } | null;
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
  /** When PayPal's webhook delivered the case and how soon the autopilot argued it; the latest event PayPal sent. */
  webhook: WebhookView | null;
  /** The latest cross-examination by the simulated reviewer. */
  hearing: Hearing | null;
  /** Agent stories: what the buyer's agent did, and who the mandate check holds responsible. */
  agent: AgentView | null;
  /** What the card network asks for on this reason code, and whether the exhibits hold it (lib/cases/requirements.ts). */
  requirements: RequirementsCard | null;
}

export async function caseView(id: string, visitor: string | null): Promise<CaseView> {
  const ctx = await caseContext(id);
  const d = ctx.dispute;
  const s = ctx.scenario;
  const where = stageOf(d, ctx.filings);
  const doc = filedDocument(d);
  const resolvedAt = d.status === "RESOLVED" ? (ruledAt(d) ?? d.update_time ?? null) : null;
  return {
    id: d.dispute_id,
    reason: d.reason,
    amount: d.dispute_amount,
    status: d.status,
    state: d.dispute_state ?? null,
    stage: d.dispute_life_cycle_stage ?? null,
    where,
    whereLine: stageLine(where, d, ctx.filings, resolvedAt),
    decidedBy: decidedBy(where, ctx.filings, resolvedAt),
    followedReviewer: followedReviewer(rulingRequestOf(ctx.filings, resolvedAt)),
    ending: outcomeWords(where, decidedBy(where, ctx.filings, resolvedAt), ruledAt(d) ?? resolvedAt),
    channel: d.dispute_channel ?? null,
    due: d.seller_response_due_date ?? null,
    created: d.create_time,
    outcome: d.dispute_outcome?.outcome_code ?? null,
    ruledAt: ruledAt(d),
    evidences: (d.evidences ?? []).map((e) => ({ type: e.evidence_type, source: e.source, date: e.date })),
    actions: [...allowed(d)].filter((a) => a !== "self"),
    exhibits: ctx.exhibits,
    // Briefs saved before the clamp could show a refund call with the seller ahead; show them as a new one would.
    brief: ctx.brief ? { ...ctx.brief, odds: oddsFor(ctx.brief.recommendation, ctx.brief.odds) } : null,
    filings: ctx.filings,
    filedPdf: doc ? { at: doc.at } : null,
    story: s ? { title: s.title, blurb: s.blurb, buyer: s.buyer.name } : null,
    invoiceId: ctx.invoiceId ?? null,
    mine: Boolean(visitor && ctx.record?.claimedBy === visitor),
    openedAt: ctx.record?.openedAt ?? d.create_time,
    // The page says the response is PayPal's only when it is: read back from the evidence PayPal holds.
    restored: ctx.brief?.engine === "paypal",
    webhook: webhookView(ctx.record),
    hearing: ctx.record?.hearing ?? null,
    agent: agentView(ctx),
    requirements: requirementsFor({ reason: d.reason, amount: d.dispute_amount.value, brand: s?.cardBrand, sandboxCode: s?.reasonCode }, ctx.exhibits),
  };
}
