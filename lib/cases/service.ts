import "server-only";
import { acceptClaim, adjudicate, allowed, getDispute, makeOffer, provideEvidence, sendMessage, type Dispute, type EvidenceInput } from "../paypal/disputes";
import { getCapture, getOrder, getRefund, refundedCaptureId, type Capture, type Order } from "../paypal/orders";
import { scenario as findScenario, type Scenario } from "../shop/scenarios";
import { loadCase, saveCase, updateCase } from "../store";
import { takeModelCall } from "../budget";
import { usd } from "../format";
import { argueWithModel, argueWithRules, modelAvailable } from "./brief";
import { mergeFilings, paypalFilings, restoredNote, sellerEvidence, splitFiled, storyFromPayPal, trackerNumber } from "./derive";
import { buildExhibits, exhibitText } from "./exhibits";
import { checkSentence, oddsFor } from "./verify";
import { argueBlocked } from "./guard";
import { briefPdf } from "./pdf";
import { repairBrief } from "./repair";
import { rulingRequest } from "./hearing";
import { withHearing } from "./hearing-log";
import type { ArgueEvent, Brief, CaseRecord, Exhibit, Filing } from "./types";

export interface CaseContext {
  dispute: Dispute;
  record: CaseRecord | null;
  order: Order | null;
  capture: Capture | null;
  exhibits: Exhibit[];
  scenario?: Scenario;
  /** Exhibit's own filings merged with what PayPal holds as filed (PayPal wins when Exhibit has no note). */
  filings: Filing[];
  /** The brief Exhibit wrote, or the response PayPal holds, read back and re-checked, when Exhibit lost its copy. */
  brief: Brief | null;
  invoiceId?: string;
  refundId?: string;
  tracking?: string;
  buyerIndex?: number;
}

export async function caseContext(id: string): Promise<CaseContext> {
  const [dispute, record] = await Promise.all([getDispute(id), loadCase(id)]);
  const tx = dispute.disputed_transactions?.[0];
  const captureId = record?.captureId ?? tx?.seller_transaction_id;
  const capture = captureId ? await getCapture(captureId).catch(() => null) : null;
  const orderId = record?.orderId ?? capture?.supplementary_data?.related_ids?.order_id;
  // A duplicate-charge refund Exhibit made, or the one named in the evidence PayPal holds.
  const refundId = record?.refundId ?? sellerEvidence(dispute).flatMap((e) => e.evidence_info?.refund_ids ?? [])[0];
  const [order, refund] = await Promise.all([
    orderId ? getOrder(orderId).catch(() => null) : null,
    refundId ? getRefund(refundId).catch(() => null) : null,
  ]);
  // The payment the refund was made against (the duplicate charge's own capture), so it gets its own exhibit.
  const refundedId = refund ? refundedCaptureId(refund) : undefined;
  const refundedCapture = refundedId && refundedId !== captureId ? await getCapture(refundedId).catch(() => null) : null;
  const tracking = record?.tracking ?? trackerNumber(order, captureId);
  const scenario = record?.scenarioId
    ? findScenario(record.scenarioId, { buyer: record.buyer ?? tx?.buyer?.name ?? 0, tracking })
    : storyFromPayPal(dispute, order);
  const invoiceId = record?.invoiceId ?? order?.purchase_units[0]?.invoice_id ?? tx?.invoice_number;
  const exhibits = buildExhibits({
    dispute,
    order,
    capture,
    scenario,
    openedAt: record?.openedAt ?? dispute.create_time,
    invoiceId,
    refund,
    refundedCapture,
    agent: record?.agent,
  });
  const filings = mergeFilings(record?.filings ?? [], paypalFilings(dispute));
  const brief = record?.brief ?? restoredBrief(dispute, exhibits);
  return { dispute, record, order, capture, exhibits, scenario, filings, brief, invoiceId, refundId, tracking, buyerIndex: scenario?.buyerIndex };
}

/**
 * The response PayPal holds on file, split back into its cited sentences and re-checked against the same
 * exhibits; the tally is scored again by the rules engine (the model's own tally was in the lost record).
 */
function restoredBrief(d: Dispute, exhibits: Exhibit[]): Brief | null {
  const e = sellerEvidence(d).filter((x) => x.notes && (x.action_info?.action === "PROVIDE_EVIDENCE" || x.action_info?.action === "ACCEPT_CLAIM")).at(-1);
  if (!e?.notes) return null;
  const accepted = e.action_info?.action === "ACCEPT_CLAIM";
  const sentences = splitFiled(e.notes).map((x) => {
    const text = x.text.replace(/\s*\((?:see\s+)?Exhibits?\s+[A-Z](?:\s*(?:,|and|&)\s*[A-Z])*\)/gi, "").trim();
    // An acceptance note carries no exhibit marks: it is the seller's note, shown as filed.
    return x.cites.length ? checkSentence({ text, cites: x.cites }, exhibits, exhibitText) : { text, cites: [], kept: true };
  });
  const rules = argueWithRules(d, exhibits);
  return {
    recommendation: accepted ? "accept" : "fight",
    headline: `${restoredNote(e.date)}. ${accepted ? "The seller accepted the claim." : "The seller fought it with the records cited in each sentence."}`,
    sentences,
    tally: rules.tally,
    odds: oddsFor(accepted ? "accept" : "fight", rules.odds),
    evidenceTypes: [e.evidence_type],
    engine: "paypal",
    ms: 0,
    createdAt: e.date ?? d.update_time,
  };
}

/** A record for a case Exhibit holds no note of, rebuilt from PayPal, so what happens next is saved. */
export async function ensureRecord(ctx: CaseContext): Promise<CaseRecord> {
  if (ctx.record) return ctx.record;
  const rec: CaseRecord = {
    disputeId: ctx.dispute.dispute_id,
    scenarioId: ctx.scenario?.id,
    buyer: ctx.scenario?.buyerIndex,
    tracking: ctx.tracking,
    orderId: ctx.order?.id,
    captureId: ctx.capture?.id ?? ctx.dispute.disputed_transactions?.[0]?.seller_transaction_id,
    invoiceId: ctx.invoiceId,
    openedAt: ctx.dispute.create_time,
    claimedAt: new Date().toISOString(),
    claimedBy: "restored",
    refundId: ctx.refundId,
    filings: ctx.filings,
    restored: new Date().toISOString(),
  };
  if (ctx.brief?.engine === "paypal") rec.brief = ctx.brief;
  await saveCase(rec);
  ctx.record = rec;
  return rec;
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface ArgueOptions {
  ip: string;
  paced: boolean;
  /** Decided by the caller (the webhook autopilot keeps to its own share of the budget); else per visitor. */
  useModel?: boolean;
  /** Set by the webhook autopilot: the delivery it argues from. It never replaces a brief someone else wrote. */
  autopilot?: { eventId: string; receivedAt: string };
}

/**
 * Argues a case and streams each step: exhibits as they're gathered, then the brief sentence by sentence.
 * The pacing between events is presentation only; every exhibit and sentence is real when it is sent.
 * A filed or resolved case keeps its brief: argue() refuses it.
 */
export async function* argue(id: string, opts: ArgueOptions): AsyncGenerator<ArgueEvent> {
  yield { type: "status", text: "Reading the case from PayPal" };
  let ctx: CaseContext;
  try {
    ctx = await caseContext(id);
  } catch (e) {
    yield { type: "error", text: (e as Error).message };
    return;
  }
  const blocked = argueBlocked(ctx.dispute.status, ctx.filings);
  if (blocked) {
    yield { type: "error", text: blocked };
    return;
  }
  for (const exhibit of ctx.exhibits) {
    yield { type: "exhibit", exhibit };
    if (opts.paced) await pause(140);
  }

  let brief: Brief;
  const useModel = modelAvailable() && (opts.useModel ?? (await takeModelCall(opts.ip)));
  if (useModel) {
    yield { type: "status", text: "Weighing the records" };
    try {
      // The autopilot (PayPal's webhook, the seller's lane) lets the model read the case through PayPal's Agent
      // Toolkit first; a visitor watching the brief stream gets it from the exhibits at once.
      brief = await argueWithModel(ctx.dispute, ctx.exhibits, { toolkit: Boolean(opts.autopilot) });
    } catch (e) {
      console.error("model brief failed", (e as Error).message);
      yield { type: "status", text: "The model didn't answer, so the rules engine is writing the brief" };
      brief = argueWithRules(ctx.dispute, ctx.exhibits);
    }
  } else {
    yield { type: "status", text: "Writing the brief with the rules engine" };
    brief = argueWithRules(ctx.dispute, ctx.exhibits);
  }

  // The bounded repair step: struck sentences get one re-cite, kept only if the checker keeps it.
  if (brief.engine === "model" && brief.sentences.some((s) => !s.kept) && (await takeModelCall(opts.ip))) {
    yield { type: "status", text: "Re-citing the struck sentences once" };
    brief = await repairBrief(ctx.dispute, brief, ctx.exhibits)
      .then((r) => r.brief)
      .catch((e) => {
        console.error("repair failed", (e as Error).message);
        return brief;
      });
  }

  for (const [index, sentence] of brief.sentences.entries()) {
    yield { type: "sentence", sentence, index };
    if (opts.paced) await pause(sentence.kept ? 420 : 650);
  }
  for (const item of brief.tally) {
    yield { type: "tally", item };
    if (opts.paced) await pause(120);
  }
  await ensureRecord(ctx).catch((e) => console.error("record", (e as Error).message));
  const auto = opts.autopilot;
  await updateCase(id, (r) => {
    // Checked again on the stored record: a filing that landed while the brief was being written wins.
    if (argueBlocked(undefined, r.filings)) return null;
    if (auto && r.brief) return null; // a visitor argued it first: keep theirs
    return auto ? { ...r, brief, autopilot: { ...auto, arguedAt: new Date().toISOString(), briefAt: brief.createdAt, engine: brief.engine } } : { ...r, brief };
  }).catch(() => null);
  yield { type: "brief", brief };
}

export type FileAction = "evidence" | "accept" | "offer" | "message" | "ruling";

/** Does what the seller approved, through the Disputes API, and records it on the case. */
export async function fileAction(id: string, action: FileAction, by: Filing["by"] = "seller", opts: { ip?: string } = {}): Promise<Filing> {
  const ctx = await caseContext(id);
  const brief = ctx.brief;
  if (!brief) throw new Error("Argue the case before filing anything.");
  await ensureRecord(ctx);
  const can = allowed(ctx.dispute);
  const kept = brief.sentences.filter((s) => s.kept);
  const response = kept.map((s) => `${s.text} [${s.cites.join(", ")}]`).join(" ");
  let filing: Filing;

  if (action === "ruling") {
    // Sandbox only: nobody at PayPal reads sandbox evidence, so the simulated reviewer does. It cross-examines the
    // PDF PayPal holds (or a hearing already held on it after the filing is reused), and its verdict is the
    // outcome Exhibit asks for. Without a model the rules engine decides from the filing, and the case says so.
    if (!can.has("adjudicate")) throw new Error("PayPal hasn't opened this case for a ruling yet. It usually takes about 20 minutes after filing.");
    const { hearingForRuling } = await import("./cross");
    const { hearing, fresh } = await hearingForRuling(ctx, opts.ip ?? "ruling");
    const { outcome, summary } = rulingRequest(hearing);
    await adjudicate(id, outcome);
    const f: Filing = {
      at: new Date().toISOString(),
      action: "ruling",
      ok: true,
      by: "sandbox",
      summary,
      detail: `Asked the sandbox to rule ${outcome === "SELLER_FAVOR" ? "for the seller" : "for the buyer"}${by === "autopilot" ? ", by the autopilot under house rule 5" : ""}`,
    };
    // The hearing the ruling followed is kept beside the earlier ones (the draft's included), so each stays readable.
    await updateCase(id, (r) => ({ ...(fresh && hearing.engine === "model" ? withHearing(r, hearing) : r), filings: [...r.filings, f] }));
    return f;
  }

  if (action === "evidence") {
    if (!can.has("provide_evidence")) throw new Error("PayPal isn't taking evidence on this case right now.");
    const pdf = await briefPdf(ctx.dispute, brief, ctx.exhibits, ctx.invoiceId);
    const tracking = ctx.exhibits.find((e) => e.kind === "tracking");
    const number = tracking?.facts.find((f) => f.label === "Tracking number")?.value;
    const carrier = tracking?.facts.find((f) => f.label === "Carrier")?.value;
    // PayPal takes one evidence entry per call unless each names an item, so file the strongest type with
    // everything attached: the response as notes, tracking or refund details, and the PDF of all exhibits.
    const types = brief.evidenceTypes.length ? brief.evidenceTypes : ["OTHER"];
    const primary = types.find((t) => t === "PROOF_OF_FULFILLMENT" || t === "PROOF_OF_REFUND") ?? types[0];
    const evidence: EvidenceInput = { evidence_type: primary, notes: response.slice(0, 2000), documents: [{ name: "response.pdf" }] };
    if (number && carrier && primary !== "PROOF_OF_REFUND") evidence.evidence_info = { tracking_info: [{ carrier_name: carrier, tracking_number: number }] };
    if (primary === "PROOF_OF_REFUND" && ctx.refundId) evidence.evidence_info = { refund_ids: [ctx.refundId] };
    const evidences = [evidence];
    await provideEvidence(id, evidences, [{ field: "file1", name: "response.pdf", type: "application/pdf", data: pdf }]);
    filing = { at: new Date().toISOString(), action, ok: true, by, summary: `Filed the response (${kept.length} sentences) and ${ctx.exhibits.length} exhibits as ${primary.toLowerCase().replace(/_/g, " ")}` };
  } else if (action === "accept") {
    if (!can.has("accept_claim")) throw new Error("PayPal isn't taking an acceptance on this case right now.");
    const note = kept.map((s) => s.text).join(" ").slice(0, 2000) || "We accept the claim and refund in full.";
    await acceptClaim(id, note, "REFUND");
    filing = { at: new Date().toISOString(), action, ok: true, by, summary: `Accepted the claim; PayPal refunds ${usd(ctx.dispute.dispute_amount.value)} to the buyer` };
  } else if (action === "offer") {
    if (!can.has("make_offer") || !brief.offerAmount) throw new Error("Offers are only possible while a case is an inquiry.");
    await makeOffer(id, brief.buyerMessage ?? "We'd like to offer a partial refund so you can keep the item.", { currency_code: "USD", value: brief.offerAmount });
    filing = { at: new Date().toISOString(), action, ok: true, by, summary: `Offered ${usd(brief.offerAmount)}` };
  } else {
    if (!can.has("send_message") || !brief.buyerMessage) throw new Error("Messages are only possible while a case is an inquiry.");
    await sendMessage(id, brief.buyerMessage);
    filing = { at: new Date().toISOString(), action, ok: true, by, summary: "Sent the buyer a message" };
  }
  await updateCase(id, (r) => ({ ...r, filings: [...r.filings, filing] }));
  return filing;
}
