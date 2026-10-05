/** Shared shapes for cases, exhibits and briefs. Safe to import from client components. */

export interface Fact {
  label: string;
  value: string;
}

export type ExhibitKind = "claim" | "order" | "payment" | "refund" | "tracking" | "scans" | "inbox" | "history" | "listing" | "policy" | "note";

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
  engine: "model" | "rules";
  model?: string;
  ms: number;
  createdAt: string;
}

export interface Filing {
  at: string;
  action: "evidence" | "offer" | "accept" | "message" | "escalate" | "ruling";
  summary: string;
  ok: boolean;
  detail?: string;
  by: "seller" | "autopilot" | "sandbox";
}

export interface CaseRecord {
  disputeId: string;
  scenarioId?: string;
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
}

/** One step the server streams while it argues a case. */
export type ArgueEvent =
  | { type: "status"; text: string }
  | { type: "exhibit"; exhibit: Exhibit }
  | { type: "sentence"; sentence: BriefSentence; index: number }
  | { type: "tally"; item: TallyItem }
  | { type: "brief"; brief: Brief }
  | { type: "error"; text: string };
