/**
 * Shapes for agent-placed orders. Types only, so client components can import them.
 *
 * AP2-style: the cardholder's wallet signs an INTENT mandate (what the agent may buy, up to what total,
 * shipped where, until when), the buyer's agent platform signs a CART mandate (the exact cart it is about to
 * pay for), and the PayPal order commits to that signed cart with "ap2:" + its SHA-256 in `custom_id`.
 */

export interface IntentMandate {
  type: "intent";
  id: string;
  cardholder: string;
  agent: string;
  request: string; // what the cardholder asked for, in their words
  item: string; // the kind of item allowed, matched against the shop's catalogue category, not the item's name
  quantity?: number; // how many of it (default 1)
  maxTotal: string; // USD, including shipping
  shipTo: string;
  merchant: string;
  issuedAt: string;
  expiresAt: string;
}

export interface CartMandate {
  type: "cart";
  id: string;
  intentId: string;
  agent: string;
  merchant: string;
  items: { sku: string; name: string; quantity: number; price: string }[];
  shipping: string;
  total: string;
  shipTo: string;
  signedAt: string;
}

/** A signed mandate. The verifier finds the key by `kid` in Exhibit's published key set, never from the mandate. */
export interface Signed<T> {
  mandate: T;
  alg: "EdDSA";
  kid: string;
  signature: string; // base64 Ed25519 over the canonical JSON of `mandate`
  publicKey?: string; // base64 SPKI the signer says it used: shown for reference, never trusted
}

export type Party = "cardholder" | "agent" | "merchant";

export interface Responsibility {
  party: Party;
  label: string; // "Cardholder", "Buyer's agent platform", "Merchant"
  line: string; // one sentence on why
}

/** One tool call the buyer's agent made. */
export interface AgentStep {
  n: number;
  tool: string;
  args: Record<string, string | number>;
  result: string; // what the tool returned, as the agent saw it (shortened)
  ok: boolean; // false when the tool refused or a check failed
  why?: string; // the agent's own one-line reason for the call
  ms: number; // since the run started
}

/** A purchase the buyer's agent made for a story, kept on the case record. Signed once, at purchase. */
export interface AgentRun {
  engine: "model" | "scripted";
  model?: string;
  /** Why the scripted agent placed the order instead of the model (budget, error, the model refused). */
  fallback?: string;
  /** What the model did before the fallback took over, when it ran at all. */
  modelSteps?: AgentStep[];
  modelTold?: string;
  steps: AgentStep[];
  told?: string; // what the agent told the cardholder at the end
  injection?: boolean; // the listing the agent read carried an instruction aimed at shopping agents
  intent: Signed<IntentMandate>;
  cart: Signed<CartMandate>;
  digest: string; // hex SHA-256 of the signed cart; the order's custom_id is "ap2:" + digest
  orderId?: string;
  startedAt: string;
  ms: number;
  tokens?: { input: number; output: number };
}
