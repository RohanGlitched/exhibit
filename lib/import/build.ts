/**
 * Turns a pasted case into lettered exhibits, in the same shapes the PayPal-backed cases use, so the
 * requirements card, the checker and the brief read them the same way. Every exhibit says it came from the
 * seller's paste: Exhibit hasn't read it from PayPal or the carrier, and never files it. Safe to import from
 * client code (no server-only imports).
 */
import type { Exhibit, Fact } from "../cases/types";
import { requirementsFor, type RequirementsCard } from "../cases/requirements";
import { fmtUsd, fmtWhen, itemLine, messageLine, scanLine } from "./parse";
import { NETWORKS, REASONS, type Clean } from "./input";

export const PASTE = "From your paste, not read from PayPal";
const NOTE = "From your paste. Exhibit hasn't checked it against PayPal, the carrier or your store.";

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

const BRAND: Record<string, string> = { VISA: "Visa card", MASTERCARD: "Mastercard", AMEX: "American Express card" };

/** Everything an exhibit says, as one string (the same reading as lib/cases/exhibits.ts exhibitText). */
export function exhibitText(e: Exhibit): string {
  return [e.title, e.ref ?? "", ...e.facts.map((f) => `${f.label}: ${f.value}`), ...(e.lines ?? [])].join("\n");
}

const streetKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
/** Whether a billing address is the ship-to address: its first line and ZIP both appear in the ship-to. */
function sameAddress(billing: string, shipTo: string): boolean {
  const ship = streetKey(shipTo);
  const parts = billing.split(",").map(streetKey).filter(Boolean);
  const street = parts.find((p) => /\d/.test(p) && /[a-z]/.test(p)) ?? parts[0] ?? "";
  const zip = billing.match(/\b\d{5}\b/)?.[0];
  return Boolean(street) && ship.includes(street) && (!zip || ship.includes(zip));
}

export interface ImportedCase {
  head: { id: string; reason: string; amount: string; buyer: string; order: string };
  exhibits: Exhibit[];
  card: RequirementsCard | null;
  reason: Clean["dispute"]["reason"];
  network: Clean["dispute"]["network"];
  amount: string; // "46.00"
  caseId: string; // the PayPal case id, or a stand-in for the prompt
  canOffer: boolean; // a PayPal claim can take a partial-refund offer; a card chargeback can't
  notes: string[];
}

export function buildCase(c: Clean): ImportedCase {
  const out: Omit<Exhibit, "id">[] = [];
  const { order: o, dispute: d, shipping: s, extra: x } = c;
  const reasonWords = REASONS[d.reason];

  // The claim, as the seller entered it.
  const claimFacts: Fact[] = [
    ...(d.caseId ? [{ label: "Case", value: d.caseId }] : []),
    { label: "Reason", value: reasonWords },
    { label: "Amount disputed", value: fmtUsd(d.amount) },
    { label: "Channel", value: d.network === "PAYPAL" ? "PayPal Resolution Center claim" : NETWORKS[d.network] },
    ...(d.respondBy ? [{ label: "Respond by", value: fmtWhen(d.respondBy) }] : []),
    ...(d.paymentId ? [{ label: "Payment", value: d.paymentId }] : []),
  ];
  out.push({
    kind: "claim",
    title: `The buyer's claim: ${reasonWords.toLowerCase()}`,
    source: `${PASTE} · the dispute as you entered it`,
    ...(d.caseId ? { ref: d.caseId } : {}),
    facts: claimFacts,
    lines: d.claim ? [d.claim] : [],
    sandbox: NOTE,
  });

  // The order.
  const paidWith = d.network === "PAYPAL" ? `PayPal account${o.email ? ` ${o.email}` : ""}` : `${BRAND[d.network]}${d.last4 ? ` ending ${d.last4}` : ""}`;
  out.push({
    kind: "order",
    title: "The order",
    source: `${PASTE} · your order export or form`,
    ref: o.id,
    facts: [
      { label: "Store order", value: o.id },
      { label: "Ordered", value: fmtWhen(o.when) },
      { label: "Total", value: fmtUsd(o.total) },
      { label: "Ship to", value: o.shipTo },
      { label: "Paid with", value: paidWith },
      { label: "Buyer", value: `${o.buyer}${o.email ? `, ${o.email}` : ""}` },
    ],
    lines: o.items.map(itemLine),
    sandbox: NOTE,
  });

  // The payment's checks, when the seller has them. A billing address is recorded only when it differs from the
  // ship-to, as the PayPal-backed cases do, since the fraud card reads its presence as "shipped elsewhere".
  const billingDiffers = x.billing && !sameAddress(x.billing, o.shipTo);
  if (d.paymentId || x.avs || x.cvv || billingDiffers) {
    const facts: Fact[] = [
      ...(d.paymentId ? [{ label: "Payment", value: d.paymentId }] : []),
      { label: "Gross", value: fmtUsd(o.total) },
      ...(x.avs ? [{ label: "Address check", value: `${x.avs}: ${AVS[x.avs] ?? "see your processor's codes"}` }] : []),
      ...(x.cvv ? [{ label: "Security code", value: `${x.cvv}: ${CVV[x.cvv] ?? "see your processor's codes"}` }] : []),
      ...(billingDiffers ? [{ label: "Billing address", value: x.billing! }] : []),
    ];
    out.push({ kind: "payment", title: "The payment", source: `${PASTE} · the payment details you entered`, ...(d.paymentId ? { ref: d.paymentId } : {}), facts, sandbox: NOTE });
  }

  // A refund of the duplicate, and the second charge itself.
  if (x.refund) {
    out.push({
      kind: "refund",
      title: "Refund of the duplicate charge",
      source: `${PASTE} · the refund you entered`,
      ref: x.refund.id,
      facts: [
        { label: "Refund", value: x.refund.id },
        { label: "Status", value: "Completed, as you entered it" },
        ...(x.refund.amount ? [{ label: "Amount", value: fmtUsd(x.refund.amount) }] : []),
        ...(x.secondPayment ? [{ label: "Refund of payment", value: x.secondPayment }] : []),
        ...(x.refund.when ? [{ label: "Refunded", value: fmtWhen(x.refund.when) }] : []),
      ],
      sandbox: NOTE,
    });
  }
  if (x.secondPayment) {
    out.push({
      kind: "payment",
      title: "The second charge",
      source: `${PASTE} · the second payment you entered`,
      ref: x.secondPayment,
      facts: [{ label: "Payment", value: x.secondPayment }, ...(x.refund ? [{ label: "Refund", value: x.refund.id }] : [])],
      sandbox: NOTE,
    });
  }

  // Tracking: on the PayPal order (as the seller says), then the carrier's scans as pasted.
  if (s.tracking && s.onPayPal) {
    out.push({
      kind: "tracking",
      title: "Tracking added to the PayPal order, as you say",
      source: `${PASTE} · you say this tracking number is on the PayPal transaction`,
      ref: s.tracking,
      facts: [
        { label: "Tracking number", value: s.tracking },
        { label: "Status", value: "Shipped" },
        { label: "Carrier", value: s.carrier ?? "—" },
      ],
      sandbox: NOTE,
    });
  }
  if (s.tracking) {
    const carrier = s.carrier ?? "Carrier";
    out.push({
      kind: "scans",
      title: s.scans.length ? `${carrier} scan history` : `${carrier} tracking, no scans pasted`,
      source: `${PASTE} · scans copied from ${carrier}'s tracking page`,
      ref: s.tracking,
      facts: [
        { label: "Tracking number", value: s.tracking },
        { label: "Carrier", value: carrier },
        { label: "Latest", value: s.scans.length ? s.scans[s.scans.length - 1].status : "No scans pasted" },
      ],
      lines: s.scans.map(scanLine),
      sandbox: NOTE,
    });
  }

  if (c.messages.length) {
    out.push({
      kind: "inbox",
      title: "Emails with the buyer",
      source: `${PASTE} · the email thread`,
      facts: [{ label: "Messages", value: String(c.messages.length) }],
      lines: c.messages.map(messageLine),
      sandbox: NOTE,
    });
  }
  if (x.listing) {
    out.push({
      kind: "listing",
      title: `Listing: ${o.items[0]?.name ?? "the item"}`,
      source: `${PASTE} · the listing text`,
      facts: o.items[0]?.price ? [{ label: "Price", value: fmtUsd(o.items[0].price) }] : [],
      lines: [x.listing.replace(/\s+/g, " ")],
      sandbox: NOTE,
    });
  }
  if (x.policy?.length) {
    out.push({ kind: "policy", title: "Your store's policy", source: `${PASTE} · the policy text`, facts: [], lines: x.policy, sandbox: NOTE });
  }
  if (x.history?.length) {
    out.push({
      kind: "history",
      title: "This customer's earlier orders",
      source: `${PASTE} · your order book`,
      facts: [
        { label: "Customer", value: `${o.buyer}${o.email ? `, ${o.email}` : ""}` },
        { label: "Earlier orders", value: String(x.history.length) },
      ],
      lines: x.history,
      sandbox: NOTE,
    });
  }
  if (x.notes?.length) {
    out.push({ kind: "note", title: "Your notes", source: `${PASTE} · your notes on the order`, facts: [], lines: x.notes, sandbox: NOTE });
  }

  const exhibits = out.map((e, i) => ({ ...e, id: String.fromCharCode(65 + i) }));
  const card = requirementsFor({ reason: d.reason, amount: d.amount, brand: d.network === "PAYPAL" ? null : d.network }, exhibits);
  // The card reads a tracker exhibit as "on file with PayPal"; here that rests on the seller's word.
  if (card) for (const i of card.items) i.detail = i.detail.replace(/on file with PayPal$/, "on the PayPal transaction, as you say");
  return {
    head: { id: d.caseId ?? `Order ${o.id}`, reason: reasonWords, amount: fmtUsd(d.amount), buyer: o.buyer, order: o.id },
    exhibits,
    card,
    reason: d.reason,
    network: d.network,
    amount: d.amount,
    caseId: d.caseId ?? `ORDER-${o.id.replace(/[^A-Za-z0-9]/g, "").toUpperCase()}`,
    canOffer: d.network === "PAYPAL",
    notes: c.notes,
  };
}
