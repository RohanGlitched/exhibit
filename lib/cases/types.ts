/** Shared shapes for cases, exhibits and briefs. Safe to import from client components. */
import type { Hearing } from "./hearing";
import type { AgentRun } from "../agentic/types";
import type { HousePlan } from "./autopilot";

export interface Fact {
  label: string;
  value: string;
}

export type ExhibitKind = "claim" | "order" | "payment" | "refund" | "tracking" | "scans" | "inbox" | "history" | "listing" | "policy" | "note" | "mandate" | "check" | "transcript";

export interface Exhibit {
  id: string; // "A", "B", ...
  kind: ExhibitKind;
  title: string;
  source: string; // where it came from: "PayPal · GET /v2/checkout/orders/…" or "Store records"
  ref?: string; // the record id at the source
  facts: Fact[];
  lines?: string[]; // free text: messages, scans, policy wording
  sandbox?: string; // honest note when a record is simulated or re-created in the sandbox
}

export type Recommendation = "fight" | "offer" | "accept";

export interface BriefSentence {
  text: string;
  cites: string[];
  kept: boolean;
  why?: string; // why it was struck
  quote?: string; // the words from a cited exhibit the sentence rests on, as the model quoted them (checked verbatim)
  checked?: string[]; // the figures and names the checker matched to the record (kept sentences)
  unverified?: true; // kept, but nothing in it the checker can match: held only to its citation
  /** Set when the checker struck the sentence as first written and one re-cite attempt fixed it. */
  repaired?: { from: string; fromCites: string[]; why: string };
}

export interface TallyItem {
  side: "seller" | "buyer";
  point: string;
  weight: 1 | 2 | 3;
  cites: string[];
}

export interface Brief {
  recommendation: Recommendation;
  offerAmount?: string; // USD, for "offer"
  headline: string;
  sentences: BriefSentence[];
  tally: TallyItem[];
  odds: number; // 0..100, seller's chance from the tally
  buyerMessage?: string;
  evidenceTypes: string[];
  engine: "model" | "rules" | "paypal"; // paypal: read back from the response PayPal holds on file
  model?: string;
  ms: number;
  createdAt: string;
  tokens?: { input: number; output: number };
  retried?: boolean; // the model's first brief came back in the wrong shape and was asked for again
}

export interface Filing {
  at: string;
  action: "evidence" | "offer" | "accept" | "message" | "escalate" | "ruling";
  summary: string;
  ok: boolean;
  detail?: string;
  by: "seller" | "autopilot" | "sandbox";
  source?: "paypal"; // read from PayPal's record of the case, not Exhibit's
}

export interface CaseRecord {
  disputeId: string;
  scenarioId?: string;
  buyer?: number; // which of the story's customers placed the order (the name is on the sandbox card too)
  tracking?: string; // the tracking number it shipped under
  orderId?: string;
  captureId?: string;
  invoiceId?: string;
  openedAt: string; // when the case was opened in the sandbox
  claimedBy?: string; // short id of the browser that took it from the pool; unset while it waits in the pool
  claimedAt?: string;
  retired?: string; // why it left the house pool: PayPal closed it, or its deadline was about to pass
  refundId?: string; // a refund Exhibit made (accept, offer, or the duplicate-charge story)
  brief?: Brief;
  filings: Filing[];
  restored?: string; // when Exhibit rebuilt this record from PayPal's own (the store had lost it)
  /** Set when the webhook autopilot argued the case from PayPal's CUSTOMER.DISPUTE.CREATED delivery. */
  autopilot?: { eventId: string; receivedAt: string; arguedAt: string; briefAt: string; engine: Brief["engine"] };
  /** The latest dispute event PayPal delivered for this case, and the state Exhibit read back after it. */
  lastEvent?: { id: string; type: string; receivedAt: string; status: string; outcome?: string };
  /** Every dispute event PayPal delivered for this case after it was created, oldest first (at most 12). */
  events?: { id: string; type: string; receivedAt: string; status: string; outcome?: string }[];
  /** The seller's own lane: a case opened as the shop's traffic, which the autopilot works under the house rules. */
  lane?: "autopilot";
  /** What the autopilot decided under the house rules, and what it did (lib/cases/autopilot.ts). */
  house?: HousePlan;
  hearing?: Hearing; // the latest cross-examination by the simulated reviewer (kept for older readers)
  /** Every hearing held on the case, oldest first: on the draft and on the PDF PayPal holds (lib/cases/hearing-log.ts). Records saved before 30 Oct have only `hearing`. */
  hearings?: Hearing[];
  agent?: AgentRun; // an agent story: the signed mandates and the buyer agent's tool calls, kept from the purchase
}

/** One step the server streams while it argues a case. */
export type ArgueEvent =
  | { type: "status"; text: string }
  | { type: "exhibit"; exhibit: Exhibit }
  | { type: "sentence"; sentence: BriefSentence; index: number }
  | { type: "tally"; item: TallyItem }
  | { type: "brief"; brief: Brief }
  | { type: "error"; text: string };
