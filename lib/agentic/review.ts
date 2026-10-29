import type { Order } from "../paypal/orders";
import type { Scenario } from "../shop/scenarios";
import { CONVERSATION, consentOverride, type ConsentOverride } from "./consent";
import { publishedResolver } from "./keys";
import { legacyResolver, responsibility, verifyAgentOrder, type Check, type OrderFacts } from "./mandate";
import { legacyMandates, shipLine } from "./story";
import type { AgentRun, CartMandate, IntentMandate, Responsibility, Signed } from "./types";

/**
 * The mandate review of one agent-placed case: the mandates (kept on the record since the purchase, or rebuilt
 * for a case opened before 26 Oct 2026), every check against the PayPal order, and who is responsible. What the
 * cardholder told the agent in its log (consent withdrawn, an overage approved in writing) overrides the checks'
 * verdict; lib/agentic/consent.ts reads it.
 */
export interface MandateReview {
  intent: Signed<IntentMandate>;
  cart: Signed<CartMandate>;
  checks: Check[];
  verdict: Responsibility;
  /** Set when the cardholder's own words in the agent's log changed the verdict the checks gave. */
  consent?: ConsentOverride & { checks: Responsibility };
  legacy: boolean; // rebuilt with the order's stand-in keys
  run?: AgentRun;
}

export function orderFacts(order: Order | null | undefined): OrderFacts | null {
  const pu = order?.purchase_units[0];
  if (!order || !pu) return null;
  return {
    id: order.id,
    customId: pu.custom_id,
    total: pu.amount.value,
    shipTo: pu.shipping?.address ? shipLine(pu.shipping.address) : "",
    items: (pu.items ?? []).map((x) => ({ sku: x.sku, quantity: x.quantity })),
    createdAt: order.create_time,
  };
}

/**
 * The agent's log as the case shows it: the story's log, or, when the purchase was run through the agent's
 * tools, its messages with the cardholder (the tools log only the calls).
 */
export function agentLog(s: Scenario, run?: AgentRun): string[] {
  const t = s.agent?.transcript ?? [];
  return run ? t.filter((l) => CONVERSATION.test(l)) : t;
}

function judged(s: Scenario, checks: Check[], cart: Signed<CartMandate>, run?: AgentRun): Pick<MandateReview, "verdict" | "consent"> {
  const byChecks = responsibility(checks);
  const o = consentOverride(checks, byChecks, agentLog(s, run), cart.mandate.total);
  return o ? { verdict: o.verdict, consent: { ...o, checks: byChecks } } : { verdict: byChecks };
}

export function reviewAgentOrder(s: Scenario, o: { run?: AgentRun; invoiceId: string; orderAt: Date; order: Order | null | undefined }): MandateReview | null {
  if (!s.agent) return null;
  const facts = orderFacts(o.order);
  if (o.run) {
    const checks = verifyAgentOrder(o.run.intent, o.run.cart, facts, publishedResolver);
    return { intent: o.run.intent, cart: o.run.cart, checks, ...judged(s, checks, o.run.cart, o.run), legacy: false, run: o.run };
  }
  // A digest-bound order whose record is gone: its mandates were signed once and can't be rebuilt.
  if (facts?.customId?.startsWith("ap2:")) return null;
  const m = legacyMandates(s, o.invoiceId, o.orderAt);
  if (!m) return null;
  const checks = verifyAgentOrder(m.intent, m.cart, facts, legacyResolver(o.invoiceId));
  return { ...m, checks, ...judged(s, checks, m.cart), legacy: true };
}
