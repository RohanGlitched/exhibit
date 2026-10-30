import "server-only";
import type { Dispute } from "../paypal/disputes";
import { refundedCaptureId, type Capture, type Order, type Refund } from "../paypal/orders";
import type { Scenario } from "../shop/scenarios";
import { SHOP, listingFor, product } from "../shop/catalog";
import { day, dayTime, reasonLabel, usd, zonedToUtc } from "../format";

const STAGES: Record<string, string> = { INQUIRY: "Inquiry", CHARGEBACK: "Chargeback", PRE_ARBITRATION: "Pre-arbitration", ARBITRATION: "Arbitration" };
import type { Exhibit, Fact } from "./types";
import { cartDigest } from "../agentic/mandate";
import { agentLog, reviewAgentOrder } from "../agentic/review";
import type { AgentRun, AgentStep } from "../agentic/types";
import { SITE_URL } from "../site";

const INJECTION_NOTE =
  "The pour-over set's description carried a line addressed to AI shopping assistants, added by a compromised store app. The shop removed it after this order.";

/** One tool call of the buyer's agent, as a line of its log: the call, the agent's reason, what came back. */
function stepLine(st: AgentStep): string {
  const args = Object.entries(st.args)
    .filter(([k]) => k !== "message")
    .map(([, v]) => (typeof v === "string" ? `“${v}”` : String(v)))
    .join(", ");
  // A search reads as its list of hits; anything else as its first line (the listing itself is its own exhibit).
  const lines = st.result.split("\n");
  const result = st.tool === "search_catalog" ? `${lines[0]} ${lines.slice(1).join("; ")}` : lines[0];
  return `${st.n}. ${st.tool}(${args})${st.why ? `, because: ${st.why.replace(/\.$/, "")}` : ""}. Result: ${result}${st.ok || st.tool === "check_intent" ? "" : " (refused)"}`;
}

/** The tool calls, with the cardholder's messages placed before the agent signed its cart. */
function withConversation(lines: string[], steps: AgentStep[], said: string[], told: string[]): string[] {
  if (!said.length) return [...lines, ...told];
  const at = steps.findIndex((st) => st.tool === "sign_cart" || st.tool === "pay");
  const k = at < 0 ? lines.length : at;
  return [...lines.slice(0, k), ...said, ...lines.slice(k), ...told];
}

/**
 * Turns the records behind a case into numbered exhibits. PayPal records (the dispute, the order, the payment,
 * the tracker) are quoted as PayPal returned them. Store records (the order book, inbox, listing, policy and
 * the carrier's scans) come from the demo shop and say so.
 */

const AVS: Record<string, string> = {
  Y: "Street and ZIP match",
  X: "Street and 9-digit ZIP match",
  A: "Street matches, ZIP does not",
  Z: "ZIP matches, street does not",
  W: "9-digit ZIP matches, street does not",
  N: "Neither street nor ZIP match",
  U: "Address not checked by the bank",
  R: "Bank system unavailable, retry",
  S: "Card issuer does not support address checks",
  G: "Non-US issuer, not checked",
};
const CVV: Record<string, string> = { M: "Security code matched", N: "Security code did not match", P: "Not processed", U: "Not checked by the issuer", S: "Not present" };

const address = (a?: { address_line_1?: string; address_line_2?: string; admin_area_2?: string; admin_area_1?: string; postal_code?: string }) =>
  a ? [a.address_line_1, a.address_line_2, a.admin_area_2, `${a.admin_area_1 ?? ""} ${a.postal_code ?? ""}`.trim()].filter(Boolean).join(", ") : "—";

/** Story time: the store order happened `orderDaysAgo` days before the case was opened. */
export function storyClock(openedAt: string, s: Scenario) {
  const opened = new Date(openedAt).getTime();
  const orderAt = opened - s.orderDaysAgo * 86_400_000;
  const at = (dayN: number, hour: number) => {
    // The story's calendar day (its UTC date, as every record on file was written), at the shop's wall-clock
    // hour, so a scan reads the same on either side of the clock change.
    const u = new Date(orderAt + dayN * 86_400_000);
    return zonedToUtc(u.getUTCFullYear(), u.getUTCMonth() + 1, u.getUTCDate(), hour);
  };
  return { orderAt: new Date(orderAt), at };
}

/** A capture reads "pending" while a chargeback holds its funds; say so, or a delivered order looks unpaid. */
function paymentStatus(status: string, d: Dispute): string {
  if (status === "COMPLETED") return "Completed";
  const moves = d.fund_movements ?? [];
  const held = moves.some((m) => m.reason === "HOLD_PLACED") && !moves.some((m) => m.reason === "HOLD_RELEASED");
  if (status === "PENDING" && held) return "Completed, then held by PayPal while this case is open";
  return status.charAt(0) + status.slice(1).toLowerCase();
}

export interface Sources {
  dispute: Dispute;
  order?: Order | null;
  capture?: Capture | null;
  scenario?: Scenario;
  openedAt: string;
  invoiceId?: string;
  refund?: Refund | null;
  /** The capture the refund was made against, when it isn't the disputed one (the duplicate charge). */
  refundedCapture?: Capture | null;
  /** A returning customer's earlier orders, as real sandbox payments (CaseRecord.priorPayments). */
  priorPayments?: { ref: string; captureId: string }[];
  agent?: AgentRun; // an agent story's purchase, signed and kept on the case record
}

export function buildExhibits(src: Sources): Exhibit[] {
  const out: Omit<Exhibit, "id">[] = [];
  const { dispute: d, order, capture, scenario: s } = src;
  const tx = d.disputed_transactions?.[0];
  const clock = s ? storyClock(src.openedAt, s) : null;

  // The claim, as PayPal holds it.
  const claimFacts: Fact[] = [
    { label: "Case", value: d.dispute_id },
    { label: "Reason", value: reasonLabel(d.reason) },
    { label: "Amount disputed", value: usd(d.dispute_amount.value) },
    { label: "Stage", value: STAGES[d.dispute_life_cycle_stage ?? ""] ?? "Claim" },
    { label: "Channel", value: d.dispute_channel === "EXTERNAL" ? "Card issuer chargeback" : "PayPal Resolution Center" },
  ];
  // When the case opened: the requirements card holds a delivery to it (Visa 13.1 wants delivery before the dispute).
  if (d.create_time) claimFacts.push({ label: "Opened", value: day(d.create_time) });
  if (d.seller_response_due_date) claimFacts.push({ label: "Respond by", value: day(d.seller_response_due_date) });
  if (tx?.seller_transaction_id) claimFacts.push({ label: "Payment", value: tx.seller_transaction_id });
  if (tx?.seller_protection_eligible !== undefined) claimFacts.push({ label: "Seller Protection", value: tx.seller_protection_eligible ? "Eligible" : "Not eligible" });
  out.push({
    kind: "claim",
    title: `The buyer's claim: ${reasonLabel(d.reason).toLowerCase()}`,
    source: `PayPal Disputes API · GET /v1/customer/disputes/${d.dispute_id}`,
    ref: d.dispute_id,
    facts: claimFacts,
    lines: [
      ...(s ? [s.claim] : []),
      ...(d.messages ?? []).map((m) => `${m.posted_by === "BUYER" ? "Buyer" : m.posted_by === "SELLER" ? "Seller" : "PayPal"}, ${dayTime(m.time_posted)}: ${m.content ?? ""}`),
    ],
  });

  // The order and what was bought.
  if (order) {
    const pu = order.purchase_units[0];
    const items = (pu.items ?? []).map((i) => `${i.quantity} × ${i.name}, ${usd(i.unit_amount.value)}`);
    const card = order.payment_source?.card;
    const facts: Fact[] = [
      { label: "Order", value: order.id },
      { label: "Store order", value: pu.invoice_id ?? src.invoiceId ?? "—" },
      { label: "Total", value: usd(pu.amount.value) },
      { label: "Ship to", value: `${pu.shipping?.name?.full_name ?? ""}, ${address(pu.shipping?.address)}` },
    ];
    if (card) facts.push({ label: "Paid with", value: `${card.brand ?? "Card"} ending ${card.last_digits ?? "••••"} in the name of ${card.name ?? "—"}` });
    if (order.payment_source?.paypal) facts.push({ label: "Paid with", value: `PayPal account ${order.payment_source.paypal.email_address ?? ""}` });
    if (s && clock) facts.push({ label: "Ordered", value: dayTime(clock.orderAt) });
    out.push({
      kind: "order",
      title: "The order",
      source: `PayPal Orders v2 · GET /v2/checkout/orders/${order.id}`,
      ref: order.id,
      facts,
      lines: items,
      sandbox: s ? `Sandbox payment made on ${day(src.openedAt)} to re-create store order ${pu.invoice_id}. The order date comes from the store's records.` : undefined,
    });
  }

  // The payment and the issuer's checks.
  if (capture) {
    const pr = capture.processor_response;
    const facts: Fact[] = [
      { label: "Payment", value: capture.id },
      { label: "Status", value: paymentStatus(capture.status, d) },
      { label: "Gross", value: usd(capture.amount.value) },
    ];
    const br = capture.seller_receivable_breakdown;
    if (br?.paypal_fee) facts.push({ label: "PayPal fee", value: usd(br.paypal_fee.value) });
    if (br?.net_amount) facts.push({ label: "Net to seller", value: usd(br.net_amount.value) });
    if (pr?.avs_code) facts.push({ label: "Address check", value: `${pr.avs_code}: ${AVS[pr.avs_code] ?? "see PayPal docs"}` });
    if (pr?.cvv_code) facts.push({ label: "Security code", value: `${pr.cvv_code}: ${CVV[pr.cvv_code] ?? "see PayPal docs"}` });
    if (s && s.buyer.billing.address_line_1 !== s.buyer.shipTo.address_line_1) {
      facts.push({ label: "Billing address", value: address(s.buyer.billing) });
    }
    out.push({ kind: "payment", title: "The payment", source: `PayPal Payments v2 · GET /v2/payments/captures/${capture.id}`, ref: capture.id, facts });
  }

  // An order the buyer's shopping agent placed: the signed mandates, Exhibit's checks, and the agent's log.
  if (s?.agent && clock) {
    const invoice = order?.purchase_units[0]?.invoice_id ?? src.invoiceId ?? "";
    const m = reviewAgentOrder(s, { run: src.agent, invoiceId: invoice, orderAt: clock.orderAt, order });
    const bound = order?.purchase_units[0]?.custom_id;
    if (!m && bound?.startsWith("ap2:")) {
      out.push({
        kind: "note",
        title: "Signed cart not on file",
        source: "Exhibit's case record",
        facts: [{ label: "Order commits to", value: bound }],
        lines: ["The PayPal order carries the SHA-256 of the cart the agent signed, but Exhibit no longer holds the mandates, so they can't be checked."],
      });
    }
    if (m) {
      const i = m.intent.mandate;
      const c = m.cart.mandate;
      const sig = (id: "intent-signature" | "cart-signature") => (m.checks.find((x) => x.id === id)?.ok ? "Valid (Ed25519)" : "Does not verify");
      const keyNote = (who: string, kid: string) =>
        m.legacy
          ? `Signed in the sandbox with a stand-in key for ${who}, derived from the order number (cases opened before 26 Oct 2026).`
          : `Signed once, when the case was opened, by ${who} with demo key ${kid}, published at ${SITE_URL}/.well-known/exhibit-keys.json. Times follow the store's order clock.`;
      out.push({
        kind: "mandate",
        title: "Intent mandate, signed by the cardholder",
        source: `Buyer's agent platform · intent ${i.id}`,
        ref: i.id,
        facts: [
          { label: "Mandate", value: i.id },
          { label: "Cardholder", value: i.cardholder },
          { label: "Allowed", value: i.item },
          { label: "Limit", value: usd(i.maxTotal) },
          { label: "Ship to", value: i.shipTo },
          { label: "Issued", value: dayTime(i.issuedAt) },
          { label: "Expires", value: dayTime(i.expiresAt) },
          { label: "Signed with key", value: m.intent.kid },
          { label: "Signature", value: sig("intent-signature") },
        ],
        lines: [`Request: “${i.request}”`],
        sandbox: keyNote("the cardholder's wallet", m.intent.kid),
      });
      out.push({
        kind: "mandate",
        title: "Cart mandate, signed by the shopping agent",
        source: `Buyer's agent platform · cart ${c.id}`,
        ref: c.id,
        facts: [
          { label: "Mandate", value: c.id },
          { label: "Answers intent", value: c.intentId },
          { label: "Agent", value: c.agent },
          { label: "Total", value: usd(c.total) },
          { label: "Ship to", value: c.shipTo },
          { label: "Signed", value: dayTime(c.signedAt) },
          { label: "Signed with key", value: m.cart.kid },
          { label: "Signature", value: sig("cart-signature") },
          ...(m.legacy ? [] : [{ label: "SHA-256", value: cartDigest(m.cart) }]),
        ],
        lines: c.items.map((x) => `${x.quantity} × ${x.name}, ${usd(x.price)}`).concat(`Shipping ${usd(c.shipping)}`),
        sandbox: keyNote("the agent platform", m.cart.kid),
      });
      const checks = m.checks;
      out.push({
        kind: "check",
        title: "Mandate check by Exhibit",
        source: "Exhibit · signatures verified against the published keys, and the cart compared with the intent and the PayPal order, by code",
        facts: [
          { label: "Passed", value: `${checks.filter((x) => x.ok).length} of ${checks.length}` },
          { label: "Responsible", value: m.verdict.label },
        ],
        lines: [
          ...checks.map((x) => `${x.ok ? "Pass" : "Fail"}: ${x.label}. ${x.detail}.`),
          ...(m.consent
            ? [`The agent's log overrides the checks: ${m.consent.kind === "withdrawn" ? "the cardholder withdrew consent before checkout" : "the cardholder approved the cart in writing"}. On the checks alone: ${m.consent.checks.label}.`]
            : []),
          `Responsible: ${m.verdict.label}. ${m.verdict.line}`,
        ],
      });
      const run = m.run;
      if (run) {
        const told = run.told ? [`Told the cardholder: “${run.told}”`] : [];
        out.push({
          kind: "transcript",
          title: "What the buyer's agent did",
          source: `Buyer's agent platform · ${s.agent.name}, ${run.engine === "model" ? (run.model ?? "model") : "scripted agent"}`,
          facts: [
            { label: "Tool calls", value: String(run.steps.length) },
            { label: "Agent", value: run.engine === "model" ? `${run.model ?? "Model"} with tools` : "Scripted agent, same tools" },
            ...(run.fallback ? [{ label: "Why scripted", value: run.fallback.charAt(0).toUpperCase() + run.fallback.slice(1) }] : []),
          ],
          // The tools log only the calls; the agent's messages with the cardholder come before it signed the cart.
          lines: withConversation(run.steps.map(stepLine), run.steps, agentLog(s, run), told),
          sandbox:
            run.engine === "model"
              ? "A live run of the buyer's agent when the case was opened; the payment it made is real in the sandbox."
              : "The scripted agent replayed the story's purchase through the buyer agent's tools; the payment it made is real in the sandbox.",
        });
      } else {
        out.push({
          kind: "transcript",
          title: "The agent's log of the purchase",
          source: `Buyer's agent platform · ${s.agent.name}`,
          facts: [{ label: "Steps", value: String(s.agent.transcript.length) }],
          lines: s.agent.transcript,
          sandbox: "The agent's log is part of the story (cases opened before 26 Oct 2026); the payment it describes is real in the sandbox.",
        });
      }
    }
  }

  // A refund already made through PayPal (the duplicate charge). It names the capture it credited, so a reviewer
  // sees the money went back on the second charge, not the disputed one. Dated on the store's day, as the shop's
  // email to the buyer is (the refund itself was made in the sandbox when the case was opened).
  if (src.refund) {
    const r = src.refund;
    const parent = refundedCaptureId(r);
    const storyDay = s?.reason === "DUPLICATE_TRANSACTION" && clock ? clock.at(1, 9) : null;
    out.push({
      kind: "refund",
      title: "Refund of the duplicate charge",
      source: `PayPal Payments v2 · GET /v2/payments/refunds/${r.id}`,
      ref: r.id,
      facts: [
        { label: "Refund", value: r.id },
        { label: "Status", value: r.status === "COMPLETED" ? "Completed" : r.status },
        ...(r.amount ? [{ label: "Amount", value: usd(r.amount.value) }] : []),
        ...(parent ? [{ label: "Refund of payment", value: parent }] : []),
        ...(parent && capture && parent !== capture.id ? [{ label: "Disputed payment", value: `${capture.id}, not refunded` }] : []),
        ...(r.invoice_id ? [{ label: "Store order", value: r.invoice_id }] : []),
        ...(storyDay ? [{ label: "Refunded", value: dayTime(storyDay) }] : r.create_time ? [{ label: "Refunded", value: dayTime(r.create_time) }] : []),
        ...(r.note_to_payer ? [{ label: "Note to buyer", value: r.note_to_payer }] : []),
      ],
      sandbox: s
        ? `Made in the sandbox on ${dayTime(r.create_time ?? src.openedAt)}, when the case was opened; dated here on the store's day, the morning after the order, as the shop's email to the buyer is.`
        : undefined,
    });
  }

  // The tracker PayPal holds, then the carrier's own scans.
  const trackers = order?.purchase_units[0]?.shipping?.trackers ?? [];
  if (trackers.length) {
    const t = trackers[0];
    out.push({
      kind: "tracking",
      title: "Tracking on file with PayPal",
      source: `PayPal Orders v2 · trackers on order ${order!.id}`,
      ref: t.id,
      facts: [
        { label: "Tracking number", value: (capture && t.id.startsWith(`${capture.id}-`) ? t.id.slice(capture.id.length + 1) : undefined) ?? s?.carrier?.number ?? t.id.split("-").slice(1).join("-") },
        { label: "Status", value: t.status === "SHIPPED" ? "Shipped" : (t.status ?? "—") },
        { label: "Carrier", value: s?.carrier?.name ?? "—" },
        ...(s?.carrier ? [{ label: "Service", value: s.carrier.service }] : []),
        ...(t.create_time ? [{ label: "Added", value: dayTime(t.create_time) }] : []),
      ],
      sandbox: s ? "Tracker added in the sandbox when the case was opened." : undefined,
    });
  }
  if (s?.carrier && clock) {
    out.push({
      kind: "scans",
      title: `${s.carrier.name} scan history`,
      source: `${s.carrier.name} tracking · ${s.carrier.number}`,
      ref: s.carrier.number,
      facts: [{ label: "Latest", value: s.carrier.scans[s.carrier.scans.length - 1].status }],
      lines: s.carrier.scans.map((sc) => `${dayTime(clock.at(sc.day, sc.hour))}  ${sc.status}, ${sc.place}${sc.detail ? `. ${sc.detail}` : ""}`),
      sandbox: "Carrier scans are simulated: sandbox tracking numbers aren't real parcels.",
    });
  }

  if (s && clock) {
    if (s.inbox.length) {
      out.push({
        kind: "inbox",
        title: "Emails with the buyer",
        source: `Store inbox · ${SHOP.email}`,
        facts: [{ label: "Messages", value: String(s.inbox.length) }],
        lines: s.inbox.map((m) => `${dayTime(clock.at(m.day, m.hour))}, ${m.from === "buyer" ? s.buyer.name : SHOP.owner}: ${m.text}`),
      });
    }
    const p = product(s.items[0].sku);
    out.push({
      kind: "listing",
      title: `Listing: ${p.name}`,
      source: `Store listing · ${SHOP.site}/products/${p.sku.toLowerCase()}`,
      ref: p.sku,
      facts: [
        { label: "Price", value: usd(p.price) },
        { label: "Photos", value: String(p.photos) },
      ],
      lines: [s.listing ?? listingFor(p, Boolean(src.agent?.injection))],
    });
    const policyLines = s.policies
      ? s.policies
      : s.reason === "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED"
        ? [`Returns: ${SHOP.policies.returns}`, `Handmade variation: ${SHOP.policies.variation}`]
        : s.reason === "MERCHANDISE_OR_SERVICE_NOT_RECEIVED"
          ? [`Shipping: ${SHOP.policies.shipping}`]
          : [`Returns: ${SHOP.policies.returns}`];
    out.push({ kind: "policy", title: "Store policy shown at checkout", source: `Store policy · ${SHOP.site}/policies`, facts: [], lines: policyLines });
    const paid = new Map((src.priorPayments ?? []).map((p) => [p.ref, p.captureId]));
    out.push({
      kind: "history",
      title: "This customer's history",
      source: "Store order book",
      facts: [
        { label: "Customer", value: `${s.buyer.name}, ${s.buyer.email}` },
        { label: "Earlier orders", value: String(s.history.length) },
        ...(s.session ? [{ label: "This order's device", value: s.session.device }, { label: "This order's IP address", value: s.session.ip }] : []),
        ...s.history.filter((h) => paid.has(h.ref)).map((h) => ({ label: `PayPal payment for ${h.ref}`, value: paid.get(h.ref)! })),
      ],
      lines: s.history.length
        ? // Each earlier order on one line with its store date and, when it was re-created in the sandbox, its PayPal
          // payment, so a sentence about it rests on one record ("#1077, 146 days ago, ordered 5 Jun 2026: ...").
          s.history.map(
            (h) =>
              `${h.ref}, ${h.daysAgo} days ago, ordered ${day(clock.at(s.orderDaysAgo - h.daysAgo, 12))}: ${h.item}, ${h.total}. ${h.outcome}.${h.device ? ` Device ${h.device}, IP address ${h.ip}.` : ""}${paid.has(h.ref) ? ` PayPal payment ${paid.get(h.ref)}.` : ""}`,
          )
        : ["First order from this customer."],
      sandbox: paid.size
        ? `The earlier orders' PayPal payments were made in the sandbox when this case was opened, with the same card, and never disputed; the order book dates them on the store's day. Device ids and IP addresses are the store's checkout log.`
        : undefined,
    });
    const notes = src.agent?.injection ? [...s.notes, INJECTION_NOTE] : s.notes;
    if (notes.length) {
      out.push({ kind: "note", title: "Seller's notes", source: "Store order notes", facts: [], lines: notes });
    }
  }

  // The second charge itself, from PayPal. Added last so the letters cited by briefs written before it existed
  // (before 30 Oct 2026) still point at the same exhibits.
  const dup = src.refundedCapture;
  if (dup && dup.id !== capture?.id) {
    out.push({
      kind: "payment",
      title: "The second charge, refunded",
      source: `PayPal Payments v2 · GET /v2/payments/captures/${dup.id}`,
      ref: dup.id,
      facts: [
        { label: "Payment", value: dup.id },
        { label: "Status", value: dup.status === "REFUNDED" ? "Refunded in full" : dup.status === "PARTIALLY_REFUNDED" ? "Partly refunded" : paymentStatus(dup.status, d) },
        { label: "Gross", value: usd(dup.amount.value) },
        ...(dup.invoice_id ? [{ label: "Store order", value: dup.invoice_id }] : []),
        ...(s && clock ? [{ label: "Charged", value: dayTime(clock.orderAt) }] : []),
        ...(src.refund ? [{ label: "Refund", value: src.refund.id }] : []),
      ],
      sandbox: s ? `Charged in the sandbox on ${dayTime(dup.create_time)}, when the case was opened; dated here on the store's day, with the order it duplicates.` : undefined,
    });
  }

  return out.map((e, i) => ({ ...e, id: String.fromCharCode(65 + i) }));
}

/** Everything an exhibit says, as one string, for checking that a sentence's figures really appear in it. */
export function exhibitText(e: Exhibit): string {
  return [e.title, e.ref ?? "", ...e.facts.map((f) => `${f.label}: ${f.value}`), ...(e.lines ?? [])].join("\n");
}
