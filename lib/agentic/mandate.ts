import { createHash, createPrivateKey, createPublicKey, sign, verify, type KeyObject } from "node:crypto";

/**
 * Orders placed by a buyer's AI shopping agent, AP2-style: the cardholder signs an INTENT mandate (what the
 * agent may buy, up to what total, shipped where, until when), the agent signs a CART mandate (the exact
 * cart it is about to pay for), and the PayPal order carries the cart mandate's id in `custom_id`.
 *
 * When such a purchase is disputed ("I never authorised this", "my agent bought the wrong thing"), Exhibit
 * verifies deterministically: both Ed25519 signatures, the cart against the PayPal order, and the cart
 * against the intent. The model never decides whether a signature is valid; it cites the verification.
 *
 * Sandbox stand-ins: the cardholder's wallet key and the agent's key are derived from the order's invoice
 * number, so a case can be rebuilt from PayPal alone. In production these would be the wallet's and the
 * agent platform's own keys.
 */

export interface IntentMandate {
  type: "intent";
  id: string;
  cardholder: string;
  agent: string;
  request: string; // what the cardholder asked for, in their words
  item: string; // the kind of item allowed
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

export interface Signed<T> {
  mandate: T;
  publicKey: string; // base64 SPKI DER
  signature: string; // base64
}

/** Canonical JSON (sorted keys) so a signature covers the content, not the key order. */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v as Record<string, unknown>)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

// PKCS#8 DER prefix for an Ed25519 private key; the 32-byte seed follows.
const ED25519_PKCS8 = Buffer.from("302e020100300506032b657004220420", "hex");

/** The stand-in key for a role on an order (see the note above). */
export function standInKey(invoiceId: string, role: "cardholder" | "agent"): { privateKey: KeyObject; publicKey: string } {
  const seed = createHash("sha256").update(`exhibit-sandbox-mandate:${role}:${invoiceId}`).digest();
  const privateKey = createPrivateKey({ key: Buffer.concat([ED25519_PKCS8, seed]), format: "der", type: "pkcs8" });
  const publicKey = createPublicKey(privateKey).export({ format: "der", type: "spki" }).toString("base64");
  return { privateKey, publicKey };
}

export function signMandate<T>(mandate: T, key: { privateKey: KeyObject; publicKey: string }): Signed<T> {
  const signature = sign(null, Buffer.from(canonical(mandate)), key.privateKey).toString("base64");
  return { mandate, publicKey: key.publicKey, signature };
}

export function signatureValid(s: Signed<unknown>): boolean {
  try {
    const key = createPublicKey({ key: Buffer.from(s.publicKey, "base64"), format: "der", type: "spki" });
    return verify(null, Buffer.from(canonical(s.mandate)), key, Buffer.from(s.signature, "base64"));
  } catch {
    return false;
  }
}

/** A short fingerprint of a public key, the way wallets show one. */
export const fingerprint = (publicKey: string) =>
  createHash("sha256").update(Buffer.from(publicKey, "base64")).digest("hex").slice(0, 16).replace(/(.{4})(?!$)/g, "$1:");

export interface OrderFacts {
  id: string;
  customId?: string;
  total: string;
  shipTo: string;
  items: { sku?: string; quantity: string | number }[];
  createdAt: string;
}

export interface Check {
  label: string;
  ok: boolean;
  detail: string;
}

const money = (v: string | number) => `$${Number(v).toFixed(2)}`;

/** Every deterministic check on an agent-placed order, in the order a reviewer would read them. */
export function verifyAgentOrder(intent: Signed<IntentMandate>, cart: Signed<CartMandate>, order: OrderFacts | null): Check[] {
  const i = intent.mandate;
  const c = cart.mandate;
  const checks: Check[] = [
    { label: "Cardholder's signature on the intent", ok: signatureValid(intent), detail: signatureValid(intent) ? `Valid Ed25519 signature by key ${fingerprint(intent.publicKey)}` : "Signature does not verify" },
    { label: "Agent's signature on the cart", ok: signatureValid(cart), detail: signatureValid(cart) ? `Valid Ed25519 signature by key ${fingerprint(cart.publicKey)}` : "Signature does not verify" },
    { label: "Cart answers this intent", ok: c.intentId === i.id, detail: c.intentId === i.id ? `Cart ${c.id} names intent ${i.id}` : `Cart names intent ${c.intentId}, not ${i.id}` },
  ];
  const withinTotal = Number(c.total) <= Number(i.maxTotal);
  checks.push({ label: "Total within the intent's limit", ok: withinTotal, detail: `${money(c.total)} against a limit of ${money(i.maxTotal)}` });
  const itemOk = c.items.every((x) => x.name.toLowerCase().includes(i.item.toLowerCase()));
  checks.push({ label: "Items match what the cardholder allowed", ok: itemOk, detail: `Allowed: ${i.item}. Cart: ${c.items.map((x) => `${x.quantity} × ${x.name}`).join(", ")}` });
  checks.push({ label: "Ship-to matches the intent", ok: c.shipTo === i.shipTo, detail: c.shipTo === i.shipTo ? c.shipTo : `Cart ships to ${c.shipTo}; intent says ${i.shipTo}` });
  const inTime = new Date(c.signedAt) >= new Date(i.issuedAt) && new Date(c.signedAt) <= new Date(i.expiresAt);
  checks.push({ label: "Bought while the intent was valid", ok: inTime, detail: inTime ? "Cart signed inside the intent's window" : "Cart signed outside the intent's window" });
  if (order) {
    const sameTotal = Number(order.total) === Number(c.total);
    const sameItems = c.items.every((x) => order.items.some((o) => o.sku === x.sku && Number(o.quantity) === x.quantity)) && order.items.length === c.items.length;
    const sameId = order.customId === c.id;
    checks.push({
      label: "PayPal order matches the signed cart",
      ok: sameTotal && sameItems && sameId && order.shipTo === c.shipTo,
      detail: [
        sameId ? `order ${order.id} carries cart ${c.id}` : `order ${order.id} carries ${order.customId ?? "no cart id"}`,
        sameTotal ? `total ${money(order.total)}` : `order total ${money(order.total)} vs cart ${money(c.total)}`,
        sameItems ? "same items" : "different items",
        order.shipTo === c.shipTo ? "same ship-to" : "different ship-to",
      ].join("; "),
    });
  }
  return checks;
}
