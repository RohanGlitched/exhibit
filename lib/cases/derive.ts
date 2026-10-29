import type { Dispute, DisputeSummary, Evidence } from "../paypal/disputes";
import type { Order } from "../paypal/orders";
import { scenario as findScenario, storyForSku, type Scenario } from "../shop/scenarios";
import { day, dayTime, daysMissed, missedWords, shortDay, usd } from "../format";
import type { Filing } from "./types";

/**
 * PayPal is the source of truth for a case. Everything here reads a case's state from PayPal's own record
 * (the evidence the seller filed, the adjudications, the money that moved), so a case renders correctly even
 * when Exhibit's store has no note of it: a case filed before the store was lost, one filed outside Exhibit,
 * or one opened by an earlier probe. Pure functions, no I/O, so they're unit-tested.
 */

export type Stage = "open" | "waiting" | "lapsed" | "filed" | "refunded" | "won" | "lost" | "reviewing" | "other";

export const STAGE_LABEL: Record<Stage, string> = {
  open: "PayPal reviewing the chargeback",
  waiting: "Your move",
  lapsed: "Missed",
  filed: "Filed, PayPal reviewing",
  refunded: "Refunded",
  won: "Won",
  lost: "Lost",
  reviewing: "PayPal reviewing",
  other: "Other",
};

/** Evidence the seller filed (through Exhibit or anywhere else), oldest first. */
export const sellerEvidence = (d: Pick<Dispute, "evidences">): Evidence[] =>
  (d.evidences ?? []).filter((e) => e.source === "SUBMITTED_BY_SELLER").sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));

const words = (t: string) => t.toLowerCase().replace(/_/g, " ");

/** What the seller filed, as PayPal records it. */
export function paypalFilings(d: Pick<Dispute, "evidences" | "dispute_amount">): Filing[] {
  return sellerEvidence(d).map((e): Filing => {
    const action = e.action_info?.action ?? "";
    const at = e.date ?? "";
    if (action === "ACCEPT_CLAIM") {
      return { at, action: "accept", ok: true, by: "seller", source: "paypal", summary: `Accepted the claim; PayPal refunds ${usd(d.dispute_amount.value)} to the buyer` };
    }
    const docs = (e.documents ?? []).map((x) => x.name).filter(Boolean);
    const tracking = e.evidence_info?.tracking_info?.[0]?.tracking_number;
    const refunds = e.evidence_info?.refund_ids ?? [];
    const parts = [`Filed the response as ${words(e.evidence_type)}`];
    if (tracking) parts.push(`with tracking ${tracking}`);
    if (refunds.length) parts.push(`with refund ${refunds.join(", ")}`);
    if (docs.length) parts.push(`and ${docs.join(", ")}`);
    return { at, action: action === "PROVIDE_EVIDENCE" || !action ? "evidence" : "message", ok: true, by: "seller", source: "paypal", summary: parts.join(" ") };
  });
}

/**
 * Exhibit's own filings, plus anything PayPal holds that Exhibit didn't record (matched by action within
 * ten minutes, since Exhibit stamps its filing just after PayPal does).
 */
export function mergeFilings(own: Filing[], fromPayPal: Filing[]): Filing[] {
  const extra = fromPayPal.filter(
    (p) => !own.some((o) => o.action === p.action && Math.abs(new Date(o.at).getTime() - new Date(p.at).getTime()) < 10 * 60_000),
  );
  return [...own, ...extra].sort((a, b) => a.at.localeCompare(b.at));
}

type Resolvable = Partial<Pick<Dispute, "dispute_outcome" | "fund_movements">> &
  Pick<DisputeSummary, "status"> & { outcome?: string; seller_response_due_date?: string };

/** Won or lost, once PayPal has resolved the case. */
export function resolvedFor(d: Resolvable): "won" | "lost" | null {
  if (d.status !== "RESOLVED") return null;
  if (d.outcome === "WON") return "won";
  if (d.outcome === "LOST") return "lost";
  const code = d.dispute_outcome?.outcome_code;
  if (code === "RESOLVED_SELLER_FAVOUR" || code === "CANCELED_BY_BUYER") return "won";
  if (code === "RESOLVED_BUYER_FAVOUR" || code === "ACCEPTED") return "lost";
  // "Resolved with payout": PayPal paid the buyer. The seller lost only if the money was taken from them.
  if (code === "RESOLVED_WITH_PAYOUT") return d.fund_movements?.some((f) => f.reason === "DISPUTE_SETTLEMENT" && f.type === "DEBIT") ? "lost" : "won";
  return null;
}

/** Whole days since PayPal's deadline passed; null while it hasn't. The same count as every other page (lib/format.ts). */
export const daysPastDue = (due: string | null | undefined, now = Date.now()): number | null => daysMissed(due, now);

/**
 * Where a case stands, from PayPal's status and what was filed on it. A case still waiting on the seller after
 * its deadline is "lapsed": the sandbox never closes it, but no response can win it any more.
 */
export function stageOf(d: Resolvable, filings: Pick<Filing, "action">[], now = Date.now()): Stage {
  const accepted = filings.some((f) => f.action === "accept");
  const filed = filings.some((f) => f.action === "evidence");
  switch (d.status) {
    case "OPEN":
      return "open";
    case "WAITING_FOR_SELLER_RESPONSE":
      return daysPastDue(d.seller_response_due_date, now) !== null ? "lapsed" : "waiting";
    case "UNDER_REVIEW":
      return accepted ? "refunded" : filed ? "filed" : "reviewing";
    case "RESOLVED": {
      if (accepted) return "refunded";
      return resolvedFor(d) ?? "other";
    }
    default:
      return "other";
  }
}

/**
 * Who decided a case that is over. The sandbox rules only when asked (adjudicate), but it also closes filed
 * cases by itself, and that outcome says nothing about the filing. So a win or a loss counts as ruled at
 * Exhibit's request only when Exhibit's own record holds a ruling request made before PayPal resolved the
 * case; otherwise the sandbox closed it on its own (or, with nothing filed, after the deadline passed).
 * A refund is the seller's own decision.
 */
export type DecidedBy = "requested" | "sandbox" | "deadline" | "seller";

export const DECIDED_LABEL: Record<DecidedBy, string> = {
  requested: "Ruled at Exhibit's request",
  sandbox: "Closed by the sandbox on its own",
  deadline: "Closed after the deadline passed",
  seller: "Refunded by the seller",
};

type FilingLike = Pick<Filing, "action"> & Partial<Pick<Filing, "at" | "ok" | "summary">>;

/** The ruling request Exhibit made on a case, if it made one before PayPal resolved it. */
export function rulingRequestOf(filings: FilingLike[], resolvedAt?: string | null): FilingLike | null {
  const asked = filings.filter((f) => f.action === "ruling" && f.ok !== false && (!resolvedAt || !f.at || f.at <= resolvedAt));
  return asked.at(-1) ?? null;
}

export function decidedBy(stage: Stage, filings: FilingLike[], resolvedAt?: string | null): DecidedBy | null {
  if (stage === "refunded") return "seller";
  if (stage !== "won" && stage !== "lost") return null;
  if (rulingRequestOf(filings, resolvedAt)) return "requested";
  return filings.some((f) => f.action === "evidence") ? "sandbox" : "deadline";
}

/** Whether a ruling request followed the simulated reviewer's verdict (the line fileAction writes says so). */
export const followedReviewer = (ruling: FilingLike | null) => Boolean(ruling?.summary && /^Ruled by the simulated reviewer/.test(ruling.summary));

/**
 * How a decided case ended, saying who decided it, as one line and as a stamp's date line: "Closed for the
 * seller by the sandbox on its own, 16 Oct 2026" and "SANDBOX CLOSED 16 OCT", or "PayPal ruled for the seller
 * at Exhibit's request, 16 Oct 2026" and "PAYPAL RULED 16 OCT". Null while the case is undecided.
 */
export function outcomeWords(where: Stage, by: DecidedBy | null, at: string | null): { line: string; what: string; stamp: string } | null {
  if (where !== "won" && where !== "lost") return null;
  const side = where === "won" ? "seller" : "buyer";
  const date = at ? ` ${shortDay(at).toUpperCase()}` : "";
  const out = (what: string, stamp: string, tail = "") => ({ what: what + tail, line: `${what}${at ? `, ${day(at)}` : ""}${tail}`, stamp: stamp + date });
  if (by === "requested") return out(`PayPal ruled for the ${side} at Exhibit's request`, "PAYPAL RULED");
  if (by === "deadline") return out("Closed for the buyer after the deadline passed", "CLOSED");
  return out(`Closed for the ${side} by the sandbox on its own`, "SANDBOX CLOSED", "; nobody asked it to rule");
}

/** One line on how the case ended or where it is, for the case page and the desk. */
export function stageLine(
  stage: Stage,
  d: Resolvable & Pick<DisputeSummary, "dispute_amount">,
  filings: FilingLike[],
  resolvedAt?: string | null,
  now = Date.now(),
): string {
  const amount = usd(d.dispute_amount.value);
  const by = decidedBy(stage, filings, resolvedAt);
  switch (stage) {
    case "won":
      return by === "requested"
        ? `Won: PayPal ruled for the seller at Exhibit's request; the seller keeps ${amount}`
        : `Won: the sandbox closed it for the seller on its own, nobody asked it to rule; the seller keeps ${amount}`;
    case "lost":
      if (by === "deadline") return `Lost: no response before the deadline, ${amount} returned to the buyer`;
      return by === "requested"
        ? `Lost: PayPal ruled for the buyer at Exhibit's request; ${amount} returned to the buyer`
        : `Lost: the sandbox closed it for the buyer on its own, nobody asked it to rule; ${amount} returned to the buyer`;
    case "refunded":
      return d.status === "RESOLVED" ? `Refunded: the seller accepted, ${amount} back to the buyer` : `Refund accepted; PayPal is closing the case`;
    case "filed":
      return "Filed with PayPal; under review";
    case "open":
      return "PayPal is reviewing the chargeback before it reaches the seller";
    case "waiting":
      return "Waiting on the seller";
    case "lapsed": {
      const n = daysPastDue(d.seller_response_due_date, now) ?? 1;
      return `Missed: PayPal's deadline passed ${missedWords(n)}; the sandbox keeps the case open, but no response can win it now`;
    }
    case "reviewing":
      return "PayPal reviewing";
    default:
      return d.status.toLowerCase().replace(/_/g, " ");
  }
}

/** When PayPal decided the case, if it has. */
export const ruledAt = (d: Pick<Dispute, "adjudications">) => (d.adjudications ?? []).map((a) => a.adjudication_time).sort().at(-1) ?? null;

/** The PDF filed with the latest evidence, as PayPal stores it. */
export const filedDocument = (d: Pick<Dispute, "evidences">) => {
  const e = sellerEvidence(d).filter((x) => x.documents?.some((doc) => doc.url)).at(-1);
  const doc = e?.documents?.find((x) => x.url);
  return doc?.url ? { url: doc.url, name: doc.name ?? "response.pdf", at: e?.date ?? null } : null;
};

/** The tracking number on the order's PayPal tracker (trackers are ids of the form "<capture>-<number>"). */
export function trackerNumber(order: Order | null | undefined, captureId?: string): string | undefined {
  const t = order?.purchase_units[0]?.shipping?.trackers?.[0];
  if (!t?.id) return undefined;
  if (captureId && t.id.startsWith(`${captureId}-`)) return t.id.slice(captureId.length + 1);
  return t.id.split("-").slice(1).join("-") || undefined;
}

/**
 * Which story (and which of its customers) a case is, read from PayPal: a Halden Ceramics invoice, the
 * product on the disputed transaction and the name on the card. Undefined for disputes Exhibit didn't open.
 */
export function storyFromPayPal(d: Dispute, order?: Order | null): Scenario | undefined {
  const tx = d.disputed_transactions?.[0];
  const invoice = tx?.invoice_number ?? order?.purchase_units[0]?.invoice_id;
  if (!invoice || !/^HC-\d/.test(invoice)) return undefined;
  const sku = tx?.items?.[0]?.item_id ?? order?.purchase_units[0]?.items?.[0]?.sku;
  // An order placed by a shopping agent carries "ap2:" + the SHA-256 of its signed cart in custom_id (older ones: the cart id).
  const agent = /^(ap2:[0-9a-f]{64}|cart_[0-9a-f]{12})$/.test(order?.purchase_units[0]?.custom_id ?? tx?.custom ?? "");
  const base = storyForSku(sku, d.reason, agent);
  if (!base) return undefined;
  const name = tx?.buyer?.name ?? order?.purchase_units[0]?.shipping?.name?.full_name;
  return findScenario(base.id, { buyer: name ?? 0, tracking: trackerNumber(order, tx?.seller_transaction_id) });
}

/** Splits a filed response ("We shipped it. [B] USPS shows delivery. [D, E]") back into its cited sentences. */
export function splitFiled(notes: string): { text: string; cites: string[] }[] {
  const out: { text: string; cites: string[] }[] = [];
  const re = /([^[\]]+?)\s*\[([A-Z](?:\s*,\s*[A-Z])*)\]/g;
  let last = 0;
  for (const m of notes.matchAll(re)) {
    out.push({ text: m[1].trim(), cites: m[2].split(",").map((c) => c.trim()) });
    last = (m.index ?? 0) + m[0].length;
  }
  const rest = notes.slice(last).trim();
  if (rest) for (const t of rest.split(/(?<=[.!?])\s+(?=[A-Z])/)) if (t.trim()) out.push({ text: t.trim(), cites: [] });
  return out;
}

export const restoredNote = (at: string | undefined) => (at ? `Read back from the response PayPal holds, filed ${dayTime(at)}` : "Read back from PayPal's record");
