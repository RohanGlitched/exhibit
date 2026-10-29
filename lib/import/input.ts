/**
 * What a seller sends from /import, the limits on it, and the check that turns it into a clean case or a list of
 * plain-English problems, each tied to the field it is about. Safe to import from client code: the page runs
 * the same check before it sends anything, and the route runs it again.
 */
import { parseDate, parseItems, parseMoney, parseScans, parseThread, type Item, type Message, type Scan, type When } from "./parse";

export const REASONS = {
  MERCHANDISE_OR_SERVICE_NOT_RECEIVED: "Not received",
  MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED: "Not as described",
  UNAUTHORISED: "Unauthorised",
  DUPLICATE_TRANSACTION: "Charged twice",
} as const;
export type ImportReason = keyof typeof REASONS;

export const NETWORKS = { VISA: "Visa chargeback", MASTERCARD: "Mastercard chargeback", AMEX: "Amex chargeback", PAYPAL: "PayPal claim (paid with a PayPal account)" } as const;
export type ImportNetwork = keyof typeof NETWORKS;

/** Everything the form holds, as strings, the way the page sends it. */
export interface ImportForm {
  order: { id: string; date: string; items: string; total: string; shipTo: string; buyer: string; email: string };
  dispute: { reason: string; network: string; amount: string; caseId: string; paymentId: string; respondBy: string; claim: string; last4: string };
  shipping: { carrier: string; tracking: string; onPayPal: boolean; scans: string };
  emails: string;
  extra: {
    listing: string;
    policy: string;
    notes: string;
    billing: string;
    avs: string;
    cvv: string;
    history: string;
    refundId: string;
    refundAmount: string;
    refundDate: string;
    secondPayment: string;
  };
}

export const emptyForm = (): ImportForm => ({
  order: { id: "", date: "", items: "", total: "", shipTo: "", buyer: "", email: "" },
  dispute: { reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED", network: "VISA", amount: "", caseId: "", paymentId: "", respondBy: "", claim: "", last4: "" },
  shipping: { carrier: "", tracking: "", onPayPal: false, scans: "" },
  emails: "",
  extra: { listing: "", policy: "", notes: "", billing: "", avs: "", cvv: "", history: "", refundId: "", refundAmount: "", refundDate: "", secondPayment: "" },
});

/** Longest value each field takes, in characters. The whole request is capped too (MAX_BODY). */
export const LIMITS = {
  short: 80,
  line: 200,
  items: 2000,
  claim: 1500,
  scans: 6000,
  emails: 12000,
  extra: 2000,
  scanLines: 40,
  messages: 30,
  itemCount: 20,
};
export const MAX_BODY = 48_000;

export interface Clean {
  order: { id: string; when: When; items: Item[]; total: string; shipTo: string; buyer: string; email?: string };
  dispute: { reason: ImportReason; network: ImportNetwork; amount: string; caseId?: string; paymentId?: string; respondBy?: When; claim?: string; last4?: string };
  shipping: { carrier?: string; tracking?: string; onPayPal: boolean; scans: Scan[] };
  messages: Message[];
  extra: {
    listing?: string;
    policy?: string[];
    notes?: string[];
    billing?: string;
    avs?: string;
    cvv?: string;
    history?: string[];
    refund?: { id: string; amount?: string; when?: When };
    secondPayment?: string;
  };
  /** What Exhibit noticed while reading the paste (dates without a year, a thread pasted newest first...). */
  notes: string[];
}

export interface Problem {
  field: string; // "order.id", "shipping.scans"...
  message: string;
}

const str = (v: unknown) => (typeof v === "string" ? v.replace(/\u0000/g, "").trim() : "");
const lines = (s: string) => s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
const ID = /^[A-Za-z0-9][A-Za-z0-9 #._/-]{0,39}$/;

/** Checks a submitted form. Unknown keys are ignored; every value is read as text and held to its limit. */
export function validate(raw: unknown): { ok: true; input: Clean } | { ok: false; problems: Problem[] } {
  const problems: Problem[] = [];
  const bad = (field: string, message: string) => problems.push({ field, message });
  const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, Record<string, unknown> | unknown>;
  const sec = (k: string) => (typeof r[k] === "object" && r[k] !== null ? (r[k] as Record<string, unknown>) : {});
  const o = sec("order");
  const d = sec("dispute");
  const s = sec("shipping");
  const x = sec("extra");
  const capped = (field: string, v: unknown, max: number) => {
    const t = str(v);
    if (t.length > max) bad(field, `Keep this under ${max.toLocaleString("en-US")} characters (it has ${t.length.toLocaleString("en-US")}).`);
    return t.slice(0, max);
  };

  // The order.
  const id = capped("order.id", o.id, 40).replace(/^#/, "");
  if (!id) bad("order.id", "Add the order number from your store.");
  else if (!ID.test(id)) bad("order.id", "An order number is letters, digits and - _ . / # only.");
  const dateText = capped("order.date", o.date, LIMITS.short);
  const when = dateText ? parseDate(dateText) : null;
  if (!dateText) bad("order.date", "Add the date the order was placed.");
  else if (!when) bad("order.date", "Exhibit can't read that date. Try 3 Oct 2026 or 2026-10-03.");
  const year = when?.y;
  const itemsText = capped("order.items", o.items, LIMITS.items);
  const parsedItems = parseItems(itemsText);
  if (!itemsText) bad("order.items", "List what was bought, one item per line.");
  for (const e of parsedItems.errors) bad("order.items", e);
  if (parsedItems.items.length > LIMITS.itemCount) bad("order.items", `Up to ${LIMITS.itemCount} items.`);
  const totalText = capped("order.total", o.total, 20);
  const total = parseMoney(totalText);
  if (!totalText) bad("order.total", "Add the order total.");
  else if (!total) bad("order.total", "Write the total as an amount, like 46.00 or $46.00.");
  const shipTo = capped("order.shipTo", o.shipTo, LIMITS.line).replace(/\s*\n\s*/g, ", ");
  if (!shipTo) bad("order.shipTo", "Add the ship-to name and address.");
  const buyer = capped("order.buyer", o.buyer, LIMITS.short);
  if (!buyer) bad("order.buyer", "Add the buyer's name.");
  const email = capped("order.email", o.email, 120);
  if (email && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) bad("order.email", "That isn't an email address.");

  // The dispute.
  const reason = str(d.reason) as ImportReason;
  if (!(reason in REASONS)) bad("dispute.reason", "Pick the reason the buyer gave.");
  const network = str(d.network) as ImportNetwork;
  if (!(network in NETWORKS)) bad("dispute.network", "Pick how the buyer paid.");
  const amountText = capped("dispute.amount", d.amount, 20);
  const amount = amountText ? parseMoney(amountText) : total;
  if (amountText && !amount) bad("dispute.amount", "Write the disputed amount like 46.00.");
  if (amount && total && Number(amount) > Number(total) + 0.005) bad("dispute.amount", "The disputed amount is more than the order total.");
  const caseId = capped("dispute.caseId", d.caseId, 40);
  if (caseId && !/^[A-Za-z0-9][A-Za-z0-9-]{3,39}$/.test(caseId)) bad("dispute.caseId", "A case id is letters, digits and dashes, like PP-R-ABC-12345678.");
  const paymentId = capped("dispute.paymentId", d.paymentId, 40);
  if (paymentId && !/^[A-Za-z0-9-]{4,40}$/.test(paymentId)) bad("dispute.paymentId", "A transaction id is letters and digits, like 8MC585209K746392H.");
  const dueText = capped("dispute.respondBy", d.respondBy, LIMITS.short);
  const respondBy = dueText ? parseDate(dueText, year) : null;
  if (dueText && !respondBy) bad("dispute.respondBy", "Exhibit can't read that date. Try 20 Oct 2026.");
  const claim = capped("dispute.claim", d.claim, LIMITS.claim);
  const last4 = capped("dispute.last4", d.last4, 8);
  if (last4 && !/^\d{4}$/.test(last4)) bad("dispute.last4", "Just the last four digits of the card, or leave it empty.");

  // Shipping.
  const carrier = capped("shipping.carrier", s.carrier, 40);
  const tracking = capped("shipping.tracking", s.tracking, 40).replace(/\s+/g, "");
  if (tracking && !/^[A-Za-z0-9-]{6,40}$/.test(tracking)) bad("shipping.tracking", "A tracking number is 6 to 40 letters and digits.");
  if (tracking && !carrier) bad("shipping.carrier", "Name the carrier for this tracking number.");
  const scansText = capped("shipping.scans", s.scans, LIMITS.scans);
  const scans = scansText ? parseScans(scansText, year) : { scans: [], errors: [], notes: [] };
  for (const e of scans.errors.slice(0, 3)) bad("shipping.scans", e);
  if (scans.scans.length > LIMITS.scanLines) bad("shipping.scans", `Up to ${LIMITS.scanLines} scan lines.`);
  if (scans.scans.length && !tracking) bad("shipping.tracking", "Add the tracking number these scans belong to.");
  const onPayPal = s.onPayPal === true && Boolean(tracking);

  // The thread.
  const emailsText = capped("emails", r.emails, LIMITS.emails);
  const thread = emailsText ? parseThread(emailsText, { name: buyer, email, year }) : { messages: [], notes: [] };
  if (thread.messages.length > LIMITS.messages) bad("emails", `Up to ${LIMITS.messages} messages.`);

  // The records that matter for some reasons.
  const listing = capped("extra.listing", x.listing, LIMITS.extra);
  const policy = capped("extra.policy", x.policy, LIMITS.extra);
  const notes = capped("extra.notes", x.notes, LIMITS.extra);
  const billing = capped("extra.billing", x.billing, LIMITS.line).replace(/\s*\n\s*/g, ", ");
  const avs = capped("extra.avs", x.avs, 1).toUpperCase();
  if (avs && !/^[A-Z]$/.test(avs)) bad("extra.avs", "The address-check result is one letter, like Y or N.");
  const cvv = capped("extra.cvv", x.cvv, 1).toUpperCase();
  if (cvv && !/^[A-Z]$/.test(cvv)) bad("extra.cvv", "The security-code result is one letter, like M or N.");
  const history = capped("extra.history", x.history, LIMITS.extra);
  const refundId = capped("extra.refundId", x.refundId, 40);
  if (refundId && !/^[A-Za-z0-9-]{4,40}$/.test(refundId)) bad("extra.refundId", "A refund id is letters and digits.");
  const refundAmountText = capped("extra.refundAmount", x.refundAmount, 20);
  const refundAmount = refundAmountText ? parseMoney(refundAmountText) : null;
  if (refundAmountText && !refundAmount) bad("extra.refundAmount", "Write the refund like 46.00.");
  const refundDateText = capped("extra.refundDate", x.refundDate, LIMITS.short);
  const refundWhen = refundDateText ? parseDate(refundDateText, year) : null;
  if (refundDateText && !refundWhen) bad("extra.refundDate", "Exhibit can't read that date.");
  if ((refundAmountText || refundDateText) && !refundId) bad("extra.refundId", "Add the refund's id from PayPal, or leave the refund empty.");
  const secondPayment = capped("extra.secondPayment", x.secondPayment, 40);
  if (secondPayment && !/^[A-Za-z0-9-]{4,40}$/.test(secondPayment)) bad("extra.secondPayment", "A payment id is letters and digits.");

  if (problems.length || !when || !total || !amount) return { ok: false, problems };
  return {
    ok: true,
    input: {
      order: { id, when, items: parsedItems.items, total, shipTo, buyer, ...(email ? { email } : {}) },
      dispute: {
        reason,
        network,
        amount,
        ...(caseId ? { caseId: caseId.toUpperCase() } : {}),
        ...(paymentId ? { paymentId: paymentId.toUpperCase() } : {}),
        ...(respondBy ? { respondBy } : {}),
        ...(claim ? { claim } : {}),
        ...(last4 && network !== "PAYPAL" ? { last4 } : {}),
      },
      shipping: { ...(carrier ? { carrier } : {}), ...(tracking ? { tracking: tracking.toUpperCase() } : {}), onPayPal, scans: scans.scans },
      messages: thread.messages,
      extra: {
        ...(listing ? { listing } : {}),
        ...(policy ? { policy: lines(policy) } : {}),
        ...(notes ? { notes: lines(notes) } : {}),
        ...(billing ? { billing } : {}),
        ...(avs ? { avs } : {}),
        ...(cvv ? { cvv } : {}),
        ...(history ? { history: lines(history) } : {}),
        ...(refundId ? { refund: { id: refundId.toUpperCase(), ...(refundAmount ? { amount: refundAmount } : {}), ...(refundWhen ? { when: refundWhen } : {}) } } : {}),
        ...(secondPayment ? { secondPayment: secondPayment.toUpperCase() } : {}),
      },
      notes: [...scans.notes, ...thread.notes],
    },
  };
}

