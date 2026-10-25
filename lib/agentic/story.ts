import { createHash, randomBytes } from "node:crypto";
import type { Scenario } from "../shop/scenarios";
import { SHOP } from "../shop/catalog";
import { signMandate, standInSigner } from "./mandate";
import type { CartMandate, IntentMandate, Signed } from "./types";

/**
 * The mandates behind a story's agent-placed order. New cases sign them once, at purchase (lib/agentic/buyer.ts),
 * and keep them on the case record. Story time: the intent is issued 25 minutes before the store's order time
 * and stays valid 48 hours; the agent signs its cart two minutes before the order.
 */

const shortId = (prefix: string, invoiceId: string) => `${prefix}_${createHash("sha256").update(`${prefix}:${invoiceId}`).digest("hex").slice(0, 12)}`;
export const newMandateId = (prefix: "intent" | "cart") => `${prefix}_${randomBytes(6).toString("hex")}`;

/** The cart id older agent orders carried in `custom_id` (cases opened before 26 Oct 2026). */
export const cartMandateId = (invoiceId: string) => shortId("cart", invoiceId);

export const shipLine = (a: { address_line_1: string; admin_area_2: string; admin_area_1: string; postal_code: string }) =>
  `${a.address_line_1}, ${a.admin_area_2}, ${a.admin_area_1} ${a.postal_code}`;

export function intentFor(s: Scenario, orderAt: Date, id = newMandateId("intent")): IntentMandate {
  const a = s.agent!;
  const issued = new Date(orderAt.getTime() - 25 * 60_000);
  return {
    type: "intent",
    id,
    cardholder: s.buyer.name,
    agent: a.name,
    request: a.request,
    item: a.item,
    ...(a.quantity && a.quantity !== 1 ? { quantity: a.quantity } : {}),
    maxTotal: a.maxTotal,
    shipTo: a.intentShipTo ?? shipLine(s.buyer.shipTo),
    merchant: "any",
    issuedAt: issued.toISOString(),
    expiresAt: new Date(issued.getTime() + (a.validHours ?? 48) * 3_600_000).toISOString(),
  };
}

export function cartFor(
  s: Scenario,
  intent: IntentMandate,
  priced: { items: CartMandate["items"]; shipping: string; total: string },
  shipTo: string,
  orderAt: Date,
  id = newMandateId("cart"),
): CartMandate {
  return {
    type: "cart",
    id,
    intentId: intent.id,
    agent: s.agent!.name,
    merchant: SHOP.name,
    items: priced.items,
    shipping: priced.shipping,
    total: priced.total,
    shipTo,
    signedAt: new Date(orderAt.getTime() - 2 * 60_000).toISOString(),
  };
}

/**
 * The mandates of a case opened before 26 Oct 2026, rebuilt from its order number the way they were made then:
 * signed with stand-in keys derived from the invoice. Verified against those derived keys (by kid), and labelled
 * as such; never used for a new case.
 */
export function legacyMandates(s: Scenario, invoiceId: string, orderAt: Date): { intent: Signed<IntentMandate>; cart: Signed<CartMandate> } | null {
  if (!s.agent) return null;
  const intent = intentFor(s, orderAt, shortId("intent", invoiceId));
  const itemTotal = s.items.reduce((t, i) => t + Number(i.price) * i.quantity, 0);
  const cart = cartFor(
    s,
    intent,
    { items: s.items.map((i) => ({ sku: i.sku, name: i.name, quantity: i.quantity, price: i.price })), shipping: s.shipping, total: (itemTotal + Number(s.shipping)).toFixed(2) },
    shipLine(s.buyer.shipTo),
    orderAt,
    cartMandateId(invoiceId),
  );
  return { intent: signMandate(intent, standInSigner(invoiceId, "wallet")), cart: signMandate(cart, standInSigner(invoiceId, "agent")) };
}
