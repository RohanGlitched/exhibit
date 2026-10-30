import "server-only";
import { allowed } from "../paypal/disputes";
import { decidedBy, filedDocument, followedReviewer, outcomeWords, refundedLate, ruledAt, rulingRequestOf, stageLine, stageOf, type DecidedBy, type Stage } from "./derive";
import { caseContext, type CaseContext } from "./service";
import { storyClock } from "./exhibits";
import { oddsFor } from "./verify";
import { reviewAgentOrder } from "../agentic/review";
import type { AgentView } from "../agentic/view";
import type { Brief, Exhibit, Filing } from "./types";
import { webhookView, type WebhookView } from "../webhooks/paypal";
import type { Hearing } from "./hearing";
import { requirementsFor, type RequirementsCard } from "./requirements";
import { HOUSE_RULES, undoable, type HousePlan } from "./autopilot";
import { hearingsOf } from "./hearing-log";
import { houseAudit, rulingSide, type AuditLine } from "./house-audit";
import { utcDay, utcTime } from "../format";

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
          tokens: run.tokens,
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
  /** Every hearing kept on the case, oldest first (the draft's and PayPal's copy's); older records hold only the latest. */
  hearings: Hearing[];
  /** Refunded after PayPal's deadline had passed with nothing filed. */
  refundedLate: boolean;
  /** Agent stories: what the buyer's agent did, and who the mandate check holds responsible. */
  agent: AgentView | null;
  /** What the card network asks for on this reason code, and whether the exhibits hold it (lib/cases/requirements.ts). */
  requirements: RequirementsCard | null;
  /** The seller's own lane: what the autopilot decided under the house rules and what it sent, as audit lines. */
  house: HouseView | null;
  /** Honest notes about this case's record: a brief older than a fix, an agent story's stand-in keys, a sandbox that never rules. */
  notes: string[];
  /** A returning customer's earlier orders, re-created as sandbox card payments when the case was opened (disclosed on the page). */
  priorPayments: { ref: string; captureId: string; at: string }[] | null;
}

export interface HouseView {
  lane: boolean;
  plan: HousePlan | null;
  rules: { version: string; rules: { n: number; text: string }[] };
  undoable: boolean;
  audit: AuditLine[];
}

// The second charge got its own exhibit with the deploy of 29 Oct 2026, 20:13 UTC.
const FIX_DUPLICATE = "2026-10-29T20:13:00Z";
/** UNAUTHORISED agent cases the sandbox never opened for a ruling, and when Exhibit tried to move them. */
const STUCK_TRIED: Record<string, string> = { "PP-R-YTQ-10191473": "30 Oct 2026", "PP-R-OMG-10191469": "30 Oct 2026" };

function houseView(ctx: CaseContext): HouseView | null {
  const rec = ctx.record;
  if (!rec?.lane && !rec?.house && !ctx.filings.some((f) => f.action === "ruling" && /by the autopilot/.test(f.detail ?? ""))) return null;
  const p = rec?.house;
  return {
    lane: rec?.lane === "autopilot",
    plan: p ?? null,
    rules: { version: HOUSE_RULES.version, rules: HOUSE_RULES.rules.map((r) => ({ n: r.n, text: r.text })) },
    undoable: undoable(p, Date.now()),
    audit: houseAudit({
      rec,
      filings: ctx.filings,
      hearings: hearingsOf(rec),
      status: ctx.dispute.status,
      adjudicable: allowed(ctx.dispute).has("adjudicate"),
      repaired: ctx.brief?.sentences.filter((s) => s.kept && s.repaired).length ?? 0,
    }),
  };
}

function caseNotes(ctx: CaseContext, agent: AgentView | null): string[] {
  const notes: string[] = [];
  const d = ctx.dispute;
  const second = ctx.exhibits.find((e) => e.title === "The second charge, refunded");
  if (second && ctx.brief && ctx.brief.createdAt < FIX_DUPLICATE && !ctx.brief.sentences.some((s) => s.cites.includes(second.id))) {
    notes.push(`This brief was written on ${utcDay(ctx.brief.createdAt)}, before the second charge had its own exhibit (Exhibit ${second.id}, added 29 Oct 2026) and before the refund named the payment it credited. The response PayPal holds doesn't cite it.`);
  }
  if (agent?.legacy) {
    notes.push("Script, stand-in key: this case was opened before the live buyer agent (26 Oct 2026). Its agent log is the story's script, and its mandates were signed with keys derived from the order number, not the published ones. Cases opened since are bought by the live agent and signed with the keys at /.well-known/exhibit-keys.json.");
  }
  const filed = ctx.filings.filter((f) => f.action === "evidence").map((f) => f.at).sort()[0];
  if (d.reason === "UNAUTHORISED" && d.status === "UNDER_REVIEW" && filed && !allowed(d).has("adjudicate") && Date.now() - new Date(filed).getTime() > 3 * 86_400_000) {
    const tried = STUCK_TRIED[d.dispute_id];
    // A ruling request PayPal took (fileAction saves one only after the call went through) is said as such.
    const asked = ctx.filings.filter((f) => f.action === "ruling" && f.ok !== false).at(-1);
    const side = asked ? rulingSide(asked) : null;
    notes.push(
      (asked
        ? `Exhibit asked the sandbox to rule${side ? ` for the ${side}` : ""} on ${utcTime(asked.at)}, and PayPal took the request, but its sandbox hasn't ruled on this unauthorised-transaction chargeback since it was filed on ${utcDay(filed)}, and it offers no ruling now.`
        : `PayPal's sandbox hasn't opened this unauthorised-transaction chargeback for a ruling since it was filed on ${utcDay(filed)}. Exhibit will ask for the ruling the hearing on PayPal's copy reaches once PayPal opens it.`) +
        (tried ? ` On ${tried} Exhibit asked again through provide-supporting-info; the sandbox refused the call (HTTP 400, invalid request). The case stays under review.` : ""),
    );
  }
  return notes;
}

export async function caseView(id: string, visitor: string | null): Promise<CaseView> {
  const ctx = await caseContext(id);
  const d = ctx.dispute;
  const s = ctx.scenario;
  const where = stageOf(d, ctx.filings);
  const doc = filedDocument(d);
  const agent = agentView(ctx);
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
    hearing: hearingsOf(ctx.record).at(-1) ?? null,
    hearings: hearingsOf(ctx.record),
    refundedLate: where === "refunded" && refundedLate(ctx.filings, d.seller_response_due_date),
    agent,
    requirements: requirementsFor({ reason: d.reason, amount: d.dispute_amount.value, brand: s?.cardBrand, sandboxCode: s?.reasonCode }, ctx.exhibits),
    house: houseView(ctx),
    notes: caseNotes(ctx, agent),
    priorPayments: ctx.record?.priorPayments?.map((p) => ({ ref: p.ref, captureId: p.captureId, at: p.at })) ?? null,
  };
}
