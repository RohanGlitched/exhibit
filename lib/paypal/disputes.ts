import "server-only";
import { inputForm, paypal } from "./client";

export interface Money {
  currency_code: string;
  value: string;
}

export interface Link {
  href: string;
  rel: string;
  method?: string;
}

export type DisputeReason =
  | "MERCHANDISE_OR_SERVICE_NOT_RECEIVED"
  | "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED"
  | "UNAUTHORISED"
  | "CREDIT_NOT_PROCESSED"
  | "DUPLICATE_TRANSACTION"
  | "INCORRECT_AMOUNT"
  | "PAYMENT_BY_OTHER_MEANS"
  | "CANCELED_RECURRING_BILLING"
  | "PROBLEM_WITH_REMITTANCE"
  | "OTHER";

export type DisputeStatus =
  | "OPEN"
  | "WAITING_FOR_BUYER_RESPONSE"
  | "WAITING_FOR_SELLER_RESPONSE"
  | "UNDER_REVIEW"
  | "RESOLVED"
  | "OTHER";

export interface DisputeSummary {
  dispute_id: string;
  create_time: string;
  update_time: string;
  reason: DisputeReason;
  status: DisputeStatus;
  dispute_state?: string;
  dispute_amount: Money;
  dispute_life_cycle_stage?: string;
  dispute_channel?: string;
  seller_response_due_date?: string;
  outcome?: string;
  disputed_transactions?: { buyer_transaction_id?: string; seller_transaction_id?: string; seller?: { merchant_id?: string } }[];
  links?: Link[];
}

export interface DisputeMessage {
  posted_by: "BUYER" | "SELLER" | "ARBITER";
  time_posted: string;
  content?: string;
}

export interface Evidence {
  evidence_type: string;
  notes?: string;
  source?: string;
  date?: string;
  dispute_life_cycle_stage?: string;
  evidence_info?: { tracking_info?: { carrier_name?: string; tracking_number?: string }[]; refund_ids?: string[] };
  documents?: { name?: string; url?: string }[];
}

export interface Dispute extends DisputeSummary {
  disputed_transactions?: {
    buyer_transaction_id?: string;
    seller_transaction_id?: string;
    create_time?: string;
    transaction_status?: string;
    gross_amount?: Money;
    invoice_number?: string;
    custom?: string;
    buyer?: { name?: string; email?: string };
    seller?: { email?: string; merchant_id?: string; name?: string };
    items?: { item_name?: string; item_description?: string; item_quantity?: string; reason?: string }[];
    seller_protection_eligible?: boolean;
  }[];
  messages?: DisputeMessage[];
  evidences?: Evidence[];
  buyer_response_due_date?: string;
  offer?: { buyer_requested_amount?: Money; seller_offered_amount?: Money; offer_type?: string };
  refund_details?: { allowed_refund_amount?: Money };
  dispute_outcome?: { outcome_code?: string; amount_refunded?: Money };
  allowed_response_options?: {
    accept_claim?: { accept_claim_types?: string[] };
    make_offer?: { offer_types?: string[] };
    acknowledge_return_item?: { acknowledgement_types?: string[] };
  };
  extensions?: Record<string, unknown>;
}

/** The actions PayPal currently allows on a case, read from its HATEOAS links. */
export function allowed(d: Pick<Dispute, "links">): Set<string> {
  return new Set((d.links ?? []).map((l) => l.rel.replace(/-/g, "_")));
}

/** Newest first; `pages` follows PayPal's next links, 50 cases a page. */
export async function listDisputes(opts: { pageSize?: number; state?: string[]; pages?: number } = {}): Promise<DisputeSummary[]> {
  const q = new URLSearchParams({ page_size: String(opts.pageSize ?? 50) });
  if (opts.state?.length) q.set("dispute_state", opts.state.join(","));
  const out: DisputeSummary[] = [];
  let path: string | undefined = `/v1/customer/disputes?${q}`;
  for (let page = 0; path && page < (opts.pages ?? 1); page++) {
    const r: { items?: DisputeSummary[]; links?: Link[] } = await paypal(path, { what: "Listing disputes" });
    out.push(...(r.items ?? []));
    const next = r.links?.find((l) => l.rel === "next")?.href;
    path = next ? next.replace(/^https?:\/\/[^/]+/, "") : undefined;
  }
  return out;
}

export const getDispute = (id: string) =>
  paypal<Dispute>(`/v1/customer/disputes/${encodeURIComponent(id)}`, { what: "Reading the dispute" });

const action = (id: string, verb: string) => `/v1/customer/disputes/${encodeURIComponent(id)}/${verb}`;

export interface EvidenceInput {
  evidence_type: string;
  notes?: string;
  evidence_info?: Evidence["evidence_info"];
  documents?: { name: string }[];
}

export async function provideEvidence(
  id: string,
  evidences: EvidenceInput[],
  files: { field: string; name: string; type: string; data: Uint8Array }[] = [],
) {
  return paypal(action(id, "provide-evidence"), { form: inputForm({ evidences }, files), what: "Filing the evidence" });
}

export const acceptClaim = (id: string, note: string, type = "REFUND", refund?: Money) =>
  paypal(action(id, "accept-claim"), {
    body: { note, accept_claim_type: type, ...(refund ? { refund_amount: refund } : {}) },
    what: "Accepting the claim",
  });

export const makeOffer = (id: string, note: string, amount: Money, type = "REFUND") =>
  paypal(action(id, "make-offer"), { body: { note, offer_type: type, offer_amount: amount }, what: "Making the offer" });

export const sendMessage = (id: string, message: string) =>
  paypal(action(id, "send-message"), { body: { message }, what: "Sending the message" });

export const escalate = (id: string, note: string) =>
  paypal(action(id, "escalate"), { body: { note }, what: "Escalating to a claim" });

/** Sandbox only: ask "PayPal" to decide a case that is UNDER_REVIEW. */
export const adjudicate = (id: string, outcome: "SELLER_FAVOR" | "BUYER_FAVOR") =>
  paypal(action(id, "adjudicate"), { body: { adjudication_outcome: outcome }, what: "Asking PayPal to decide" });

/** Sandbox only: put a case back to waiting for the seller (or buyer). */
export const requireEvidence = (id: string, who: "SELLER_EVIDENCE" | "BUYER_EVIDENCE") =>
  paypal(action(id, "require-evidence"), { body: { action: who }, what: "Reopening the case for evidence" });

/** Sandbox only: a card chargeback against one of our captures, with nothing but the merchant token. */
export async function simulateChargeback(opts: {
  captureId: string;
  amount: Money;
  reasonCode: string;
  cardBrand: "VISA" | "MASTERCARD" | "AMEX";
  merchantId: string;
}): Promise<string> {
  const now = new Date();
  const respondBy = new Date(now.getTime() + 10 * 86_400_000);
  const body = {
    adjacency: "PAYPAL",
    file_layout: "ATCK_CB",
    merchant_id: opts.merchantId,
    financial_institution: { processor: "FDMS" },
    transaction: { id_enc: opts.captureId, amount: opts.amount },
    instrument: {
      instrument_type: "CARD",
      card_brand: opts.cardBrand,
      credit_card_transaction_id: String(Date.now()).padEnd(16, "7").slice(0, 16),
      external: false,
    },
    dispute: {
      id: null,
      stage: "CHARGEBACK",
      response_date: respondBy.toISOString(),
      status: "2",
      amount: opts.amount,
      receive_date: now.toISOString(),
      event_code: "CHARGEBACK_INITIATED",
      money_movement_date: now.toISOString(),
      event_type: "DEBIT",
      chargeback_type: "REPORTED_TO_PROCESSOR",
      processor_info: {
        reference_number: Array.from(crypto.getRandomValues(new Uint8Array(23)), (b) => b % 10).join(""),
        reason_code: opts.reasonCode,
        notes: "Exhibit sandbox case",
      },
    },
  };
  const r = await paypal<{ dispute_id?: string; links?: Link[] }>("/v2/customer-support/process-chargeback", {
    body,
    what: "Opening a sandbox chargeback",
  });
  const id = r.dispute_id ?? r.links?.find((l) => l.rel === "self")?.href.split("/").pop();
  if (!id) throw new Error("PayPal opened the chargeback but returned no dispute id.");
  return id;
}
