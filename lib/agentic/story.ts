import { createHash } from "node:crypto";
import type { Scenario } from "../shop/scenarios";
import { SHOP } from "../shop/catalog";
import { standInKey, signMandate, type CartMandate, type IntentMandate, type Signed } from "./mandate";

/**
 * The signed mandates behind an agent-placed order, rebuilt from the order's invoice number and the story:
 * the cardholder's intent (issued 25 minutes before the order, valid 48 hours) and the agent's cart (signed
 * two minutes before it). Same invoice, same mandates, same signatures, every time.
 */

const shortId = (prefix: string, invoiceId: string) => `${prefix}_${createHash("sha256").update(`${prefix}:${invoiceId}`).digest("hex").slice(0, 12)}`;

/** The cart mandate id the PayPal order carries in `custom_id`. */
export const cartMandateId = (invoiceId: string) => shortId("cart", invoiceId);

export const shipLine = (a: { address_line_1: string; admin_area_2: string; admin_area_1: string; postal_code: string }) =>
  `${a.address_line_1}, ${a.admin_area_2}, ${a.admin_area_1} ${a.postal_code}`;

export function agentMandates(s: Scenario, invoiceId: string, orderAt: Date): { intent: Signed<IntentMandate>; cart: Signed<CartMandate> } | null {
  if (!s.agent) return null;
  const issued = new Date(orderAt.getTime() - 25 * 60_000);
  const intent: IntentMandate = {
    type: "intent",
    id: shortId("intent", invoiceId),
    cardholder: s.buyer.name,
    agent: s.agent.name,
    request: s.agent.request,
    item: s.agent.item,
    maxTotal: s.agent.maxTotal,
    shipTo: s.agent.intentShipTo ?? shipLine(s.buyer.shipTo),
    merchant: "any",
    issuedAt: issued.toISOString(),
    expiresAt: new Date(issued.getTime() + (s.agent.validHours ?? 48) * 3_600_000).toISOString(),
  };
  const itemTotal = s.items.reduce((t, i) => t + Number(i.price) * i.quantity, 0);
  const cart: CartMandate = {
    type: "cart",
    id: cartMandateId(invoiceId),
    intentId: intent.id,
    agent: s.agent.name,
    merchant: SHOP.name,
    items: s.items.map((i) => ({ sku: i.sku, name: i.name, quantity: i.quantity, price: i.price })),
    shipping: s.shipping,
    total: (itemTotal + Number(s.shipping)).toFixed(2),
    shipTo: shipLine(s.buyer.shipTo),
    signedAt: new Date(orderAt.getTime() - 2 * 60_000).toISOString(),
  };
  return {
    intent: signMandate(intent, standInKey(invoiceId, "cardholder")),
    cart: signMandate(cart, standInKey(invoiceId, "agent")),
  };
}
