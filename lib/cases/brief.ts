import "server-only";
import { allowed, type Dispute } from "../paypal/disputes";
import { llmModel, llmReady, structured } from "../llm";
import { SHOP } from "../shop/catalog";
import { reasonLabel, usd } from "../format";
import { exhibitText } from "./exhibits";
import { checkSentence, checkTally, oddsFrom } from "./verify";
import type { Brief, BriefSentence, Exhibit, Recommendation, TallyItem } from "./types";

/**
 * Argues one case. The model sees only the numbered exhibits and must answer through one tool call: a
 * recommendation, a tally of points for each side, and the response to PayPal as sentences that each cite
 * exhibits. The server then checks every sentence against what it cites and strikes what it can't match.
 * Without a model (no key, budget spent, timeout) a rules engine writes a plainer brief from the same exhibits.
 */

interface ModelBrief {
  recommendation: Recommendation;
  offer_amount?: number;
  headline: string;
  tally: { side: "seller" | "buyer"; point: string; weight: number; cites: string[] }[];
  response: { text: string; cites: string[] }[];
  buyer_message?: string;
  evidence_types: string[];
}

function schema(canOffer: boolean) {
  return {
  type: "object",
  required: ["recommendation", "headline", "tally", "response", "evidence_types"],
  properties: {
    recommendation: {
      type: "string",
      enum: canOffer ? ["fight", "offer", "accept"] : ["fight", "accept"],
      description: canOffer
        ? "fight = contest with evidence; offer = propose a partial refund; accept = refund in full and close."
        : "fight = contest with evidence; accept = refund in full and close. (This is a card chargeback: partial refunds aren't possible.)",
    },
    ...(canOffer ? { offer_amount: { type: "number", description: "USD to refund when recommending an offer. Omit otherwise." } } : {}),
    headline: { type: "string", description: "One sentence for the seller: what happened and what to do. Under 22 words." },
    tally: {
      type: "array",
      description: "3 to 7 points, each one sentence, for the seller or the buyer, weighted 1 (minor) to 3 (decisive), citing exhibits.",
      items: {
        type: "object",
        required: ["side", "point", "weight", "cites"],
        properties: {
          side: { type: "string", enum: ["seller", "buyer"] },
          point: { type: "string" },
          weight: { type: "integer", minimum: 1, maximum: 3 },
          cites: { type: "array", items: { type: "string" } },
        },
      },
    },
    response: {
      type: "array",
      description:
        "The seller's written response to PayPal, 4 to 6 short sentences (under 30 words each) in the seller's voice (we/our), plain and factual. Put the exhibit letters that prove each sentence in `cites`, never in the text. For accept, explain the refund instead.",
      items: {
        type: "object",
        required: ["text", "cites"],
        properties: { text: { type: "string" }, cites: { type: "array", items: { type: "string" } } },
      },
    },
    buyer_message: { type: "string", description: "A short, kind message to the buyer (2-3 sentences), when it helps resolve the case. Omit otherwise." },
    evidence_types: {
      type: "array",
      items: { type: "string" },
      description: "PayPal evidence types to file, e.g. PROOF_OF_FULFILLMENT, PROOF_OF_DELIVERY_SIGNATURE, PROOF_OF_REFUND, ITEM_DESCRIPTION, RETURN_POLICY, OTHER.",
    },
  },
  };
}

function system(): string {
  return `You are Exhibit, the dispute desk for ${SHOP.name}, a small online shop that takes PayPal. You work for the seller, but you are honest: a seller who fights a case they should lose pays fees and loses goodwill, so recommend refunding when the records point that way.

Rules you never break:
- Use only facts in the numbered exhibits. Every response sentence and every tally point cites the exhibit letters that prove it.
- Copy figures exactly as the exhibits write them: amounts like $104.00, dates like 3 Oct 2026, times like 13:02, ids and tracking numbers in full. Never compute a new date or amount; never invent one.
- Exhibits marked as sandbox re-creations or simulations are still the case record; don't mention the sandbox in the response.
- How cases are usually decided: not received is won with tracking that shows delivery to the buyer's address (a signature is decisive) and lost without tracking. Not as described is usually won when the listing plainly disclosed the difference the buyer complains about and the seller offered a return; it is lost when the item really differs from the listing. In an inquiry a partial refund often settles it; a card chargeback can only be fought or refunded in full. Unauthorised is lost when signs point to a stolen card (first order, billing and shipping differ, shipped to a forwarder); fight only with strong proof the cardholder took part. Charged twice is won with proof the duplicate was refunded.
- Write the response for a PayPal reviewer: specific, calm, no adjectives, no legal threats, no apologies to PayPal.`;
}

function prompt(d: Dispute, exhibits: Exhibit[]): string {
  return `Case ${d.dispute_id}: ${reasonLabel(d.reason)}, ${usd(d.dispute_amount.value)} disputed.

Exhibits:
${exhibits.map((e) => `--- Exhibit ${e.id}: ${e.title} (${e.source})\n${exhibitText(e)}${e.sandbox ? `\nNote: ${e.sandbox}` : ""}`).join("\n\n")}

Decide, then file the brief with the write_brief tool.`;
}

export const canOffer = (d: Dispute) => allowed(d).has("make_offer");

export async function argueWithModel(d: Dispute, exhibits: Exhibit[]): Promise<Brief> {
  const t0 = Date.now();
  const { value } = await structured<ModelBrief>({
    system: system(),
    prompt: prompt(d, exhibits),
    tool: { name: "write_brief", description: "File the brief for this dispute.", schema: schema(canOffer(d)) },
  });
  return finish(value, exhibits, "model", Date.now() - t0, d);
}

/** Exhibit marks are drawn from `cites`; drop any "(Exhibit B)" the model also wrote into the text. */
const unref = (t: string) =>
  t
    .replace(/\s*\((?:see\s+)?Exhibits?\s+[A-Z](?:\s*(?:,|and|&)\s*[A-Z])*\)/gi, "")
    .replace(/\s+/g, " ")
    .trim();

function finish(v: ModelBrief, exhibits: Exhibit[], engine: Brief["engine"], ms: number, d: Dispute): Brief {
  const sentences: BriefSentence[] = (v.response ?? []).map((s) => checkSentence({ ...s, text: unref(s.text) }, exhibits, exhibitText));
  const tally: TallyItem[] = checkTally(
    (v.tally ?? []).map((t) => ({ ...t, point: unref(t.point), weight: t.weight as 1 | 2 | 3 })),
    exhibits,
  );
  const max = Number(d.dispute_amount.value);
  const offer = v.recommendation === "offer" && v.offer_amount ? Math.min(max, Math.max(1, v.offer_amount)).toFixed(2) : undefined;
  return {
    recommendation: v.recommendation === "offer" && !offer ? "accept" : v.recommendation,
    offerAmount: offer,
    headline: v.headline,
    sentences,
    tally,
    odds: oddsFrom(tally),
    buyerMessage: v.buyer_message || undefined,
    evidenceTypes: (v.evidence_types ?? []).filter((t) => /^[A-Z_]{3,60}$/.test(t)).slice(0, 4),
    engine,
    model: engine === "model" ? llmModel() : undefined,
    ms,
    createdAt: new Date().toISOString(),
  };
}

/** A plain brief from fixed rules, used when the model is unavailable. Same exhibits, same checks. */
export function argueWithRules(d: Dispute, exhibits: Exhibit[]): Brief {
  const t0 = Date.now();
  const by = (k: Exhibit["kind"]) => exhibits.find((e) => e.kind === k);
  const fact = (e: Exhibit | undefined, label: string) => e?.facts.find((f) => f.label === label)?.value;
  const claim = by("claim")!;
  const order = by("order");
  const scans = by("scans");
  const tracking = by("tracking");
  const listing = by("listing");
  const notes = by("note");
  const history = by("history");
  const payment = by("payment");
  const lastScan = scans?.lines?.[scans.lines.length - 1] ?? "";
  const delivered = /Delivered/.test(lastScan);
  const signed = /signed/i.test(lastScan);
  const amount = usd(d.dispute_amount.value);
  const tally: ModelBrief["tally"] = [];
  const response: ModelBrief["response"] = [];
  let rec: Recommendation = "fight";
  let offer: number | undefined;
  const evidence: string[] = [];

  if (order) response.push({ text: `The buyer paid ${fact(order, "Total")} for order ${fact(order, "Store order")}.`, cites: [order.id] });

  switch (d.reason) {
    case "MERCHANDISE_OR_SERVICE_NOT_RECEIVED":
      if (scans && delivered) {
        tally.push({ side: "seller", point: `The carrier shows the parcel delivered${signed ? " and signed for" : ""}.`, weight: 3, cites: [scans.id] });
        if (tracking) tally.push({ side: "seller", point: "Tracking was on file with PayPal.", weight: 1, cites: [tracking.id] });
        response.push({ text: `We shipped it with ${fact(tracking, "Carrier") ?? "tracking"}, tracking number ${fact(tracking, "Tracking number")}.`, cites: [tracking?.id ?? scans.id] });
        response.push({ text: `The carrier's last scan reads: ${lastScan.replace(/\s+/g, " ")}.`, cites: [scans.id] });
        evidence.push("PROOF_OF_FULFILLMENT");
        if (signed) evidence.push("PROOF_OF_DELIVERY_SIGNATURE");
      } else {
        rec = "accept";
        tally.push({ side: "buyer", point: "There is no tracking to show the parcel arrived.", weight: 3, cites: [claim.id] });
        if (notes) tally.push({ side: "buyer", point: "The store's notes confirm it shipped without tracking.", weight: 2, cites: [notes.id] });
        response.push({ text: `We can't show delivery for this order, so we are refunding ${amount} in full.`, cites: [claim.id] });
        evidence.push("PROOF_OF_REFUND");
      }
      break;
    case "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED": {
      const policy = by("policy");
      if (canOffer(d)) {
        rec = "offer";
        offer = Math.round(Number(d.dispute_amount.value) * 0.3);
      }
      if (listing) tally.push({ side: "seller", point: "The listing describes how the item can vary.", weight: 2, cites: [listing.id] });
      if (policy) tally.push({ side: "seller", point: "A 30-day return was available.", weight: 1, cites: [policy.id] });
      tally.push({ side: "buyer", point: "The buyer says the item differs from what they expected.", weight: 2, cites: [claim.id] });
      if (listing) response.push({ text: `Our listing says: ${listing.lines?.[0]}`, cites: [listing.id] });
      if (policy) response.push({ text: policy.lines?.[0] ?? "Returns were offered.", cites: [policy.id] });
      if (rec === "offer") response.push({ text: `We are offering a partial refund so the buyer can keep the item without paying for a return.`, cites: [claim.id] });
      evidence.push("ITEM_DESCRIPTION", "RETURN_POLICY");
      break;
    }
    case "UNAUTHORISED": {
      const billing = fact(payment, "Billing address");
      const first = /First order/.test(history?.lines?.join(" ") ?? "");
      if (billing) tally.push({ side: "buyer", point: "Billing and shipping addresses differ.", weight: 2, cites: [payment!.id] });
      if (first && history) tally.push({ side: "buyer", point: "It was this customer's first order.", weight: 1, cites: [history.id] });
      if (notes) tally.push({ side: "buyer", point: "It shipped to a parcel-forwarding warehouse.", weight: 3, cites: [notes.id] });
      if (scans && signed) tally.push({ side: "seller", point: "The parcel was signed for at the shipping address.", weight: 1, cites: [scans.id] });
      rec = tally.filter((t) => t.side === "buyer").length >= 2 ? "accept" : "fight";
      response.push({
        text: rec === "accept" ? `The order shows signs of a stolen card, so we are accepting the claim and refunding ${amount}.` : `The order was delivered to the cardholder's address.`,
        cites: [claim.id],
      });
      evidence.push(rec === "accept" ? "PROOF_OF_REFUND" : "PROOF_OF_FULFILLMENT");
      break;
    }
    case "DUPLICATE_TRANSACTION": {
      const refund = by("refund");
      if (refund) {
        tally.push({ side: "seller", point: "PayPal shows the duplicate charge refunded in full.", weight: 3, cites: [refund.id] });
        response.push({ text: `The duplicate charge was refunded in full: refund ${fact(refund, "Refund")}, ${fact(refund, "Amount")}.`, cites: [refund.id] });
        response.push({ text: `This case disputes the original payment ${fact(payment, "Payment") ?? ""}, for the order the buyer received.`.replace("  ", " "), cites: payment ? [payment.id] : [claim.id] });
        if (scans && delivered) response.push({ text: `The carrier's last scan reads: ${lastScan.replace(/\s+/g, " ")}.`, cites: [scans.id] });
      } else if (notes) {
        tally.push({ side: "seller", point: "The second charge was already refunded.", weight: 3, cites: [notes.id] });
        response.push({ text: notes.lines?.[0] ?? "The duplicate charge was refunded.", cites: [notes.id] });
      }
      evidence.push("PROOF_OF_REFUND");
      break;
    }
    default:
      rec = "accept";
      tally.push({ side: "buyer", point: `The claim is ${reasonLabel(d.reason).toLowerCase()}.`, weight: 1, cites: [claim.id] });
      response.push({ text: `We are refunding ${amount}.`, cites: [claim.id] });
  }

  const headline =
    rec === "fight" ? "The records support the seller. File the evidence." : rec === "offer" ? "A partial refund should settle this without a return." : "The records favour the buyer. Refund and close it.";
  return finish(
    { recommendation: rec, offer_amount: offer, headline, tally, response, evidence_types: evidence },
    exhibits,
    "rules",
    Date.now() - t0,
    d,
  );
}

export const modelAvailable = llmReady;
