import "server-only";
import type { Dispute } from "../paypal/disputes";
import type { Capture, Order, Refund } from "../paypal/orders";
import type { Scenario } from "../shop/scenarios";
import { SHOP, product } from "../shop/catalog";
import { day, dayTime, reasonLabel, usd } from "../format";
import type { Exhibit, Fact } from "./types";

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
function storyClock(openedAt: string, s: Scenario) {
  const opened = new Date(openedAt).getTime();
  const orderAt = opened - s.orderDaysAgo * 86_400_000;
  const at = (dayN: number, hour: number) => {
    const d = new Date(orderAt + dayN * 86_400_000);
    d.setUTCHours(hour + 7, 0, 0, 0); // Portland local hour, near enough across DST for a story
    return d;
  };
  return { orderAt: new Date(orderAt), at };
}

export interface Sources {
  dispute: Dispute;
  order?: Order | null;
  capture?: Capture | null;
  scenario?: Scenario;
  openedAt: string;
  invoiceId?: string;
  refund?: Refund | null;
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
    { label: "Stage", value: d.dispute_life_cycle_stage === "INQUIRY" ? "Inquiry" : "Claim" },
    { label: "Channel", value: d.dispute_channel === "EXTERNAL" ? "Card issuer chargeback" : "PayPal Resolution Center" },
  ];
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
      { label: "Status", value: capture.status === "COMPLETED" ? "Completed" : capture.status },
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

  // A refund already made through PayPal (the duplicate charge).
  if (src.refund) {
    const r = src.refund;
    out.push({
      kind: "refund",
      title: "Refund of the duplicate charge",
      source: `PayPal Payments v2 · GET /v2/payments/refunds/${r.id}`,
      ref: r.id,
      facts: [
        { label: "Refund", value: r.id },
        { label: "Status", value: r.status === "COMPLETED" ? "Completed" : r.status },
        ...(r.amount ? [{ label: "Amount", value: usd(r.amount.value) }] : []),
        ...(r.create_time ? [{ label: "Refunded", value: dayTime(r.create_time) }] : []),
        ...(r.note_to_payer ? [{ label: "Note to buyer", value: r.note_to_payer }] : []),
      ],
      sandbox: s ? "Made in the sandbox when the case was opened; the story dates it the day after the order." : undefined,
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
        { label: "Tracking number", value: s?.carrier?.number ?? t.id.split("-").slice(1).join("-") },
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
      lines: [p.listing],
    });
    const policyLines =
      s.reason === "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED"
        ? [`Returns: ${SHOP.policies.returns}`, `Handmade variation: ${SHOP.policies.variation}`]
        : s.reason === "MERCHANDISE_OR_SERVICE_NOT_RECEIVED"
          ? [`Shipping: ${SHOP.policies.shipping}`]
          : [`Returns: ${SHOP.policies.returns}`];
    out.push({ kind: "policy", title: "Store policy shown at checkout", source: `Store policy · ${SHOP.site}/policies`, facts: [], lines: policyLines });
    out.push({
      kind: "history",
      title: "This customer's history",
      source: "Store order book",
      facts: [
        { label: "Customer", value: `${s.buyer.name}, ${s.buyer.email}` },
        { label: "Earlier orders", value: String(s.history.length) },
      ],
      lines: s.history.length ? s.history.map((h) => `${h.ref}, ${h.daysAgo} days ago: ${h.item}, ${h.total}. ${h.outcome}.`) : ["First order from this customer."],
    });
    if (s.notes.length) {
      out.push({ kind: "note", title: "Seller's notes", source: "Store order notes", facts: [], lines: s.notes });
    }
  }

  return out.map((e, i) => ({ ...e, id: String.fromCharCode(65 + i) }));
}

/** Everything an exhibit says, as one string, for checking that a sentence's figures really appear in it. */
export function exhibitText(e: Exhibit): string {
  return [e.title, e.ref ?? "", ...e.facts.map((f) => `${f.label}: ${f.value}`), ...(e.lines ?? [])].join("\n");
}
