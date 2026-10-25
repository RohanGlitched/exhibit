import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { PRODUCTS, SHOP, findProduct } from "../shop/catalog";
import { fingerprintOf, publishedResolver, type KeyResolver, type Signer, type TrustedKey } from "./keys";
import type { CartMandate, IntentMandate, Responsibility, Signed } from "./types";

export type { CartMandate, IntentMandate, Signed } from "./types";

/**
 * Orders placed by a buyer's AI shopping agent, AP2-style: the cardholder's wallet signs an INTENT mandate,
 * the agent platform signs the CART mandate its agent is about to pay for, and the PayPal order carries
 * "ap2:" + the SHA-256 of the signed cart in `custom_id`.
 *
 * When such a purchase is disputed ("I never authorised this", "my agent bought the wrong thing"), Exhibit
 * verifies deterministically: both Ed25519 signatures against the keys it publishes (found by kid; a key the
 * mandate carries itself is never trusted), the cart against the intent, and the PayPal order against the
 * cart. Then it says who is responsible: the cardholder, the agent, or the merchant. The model never decides
 * whether a signature is valid; it cites the verification.
 */

/** Canonical JSON (sorted keys) so a signature covers the content, not the key order. */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v as Record<string, unknown>)
      .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

export function signMandate<T>(mandate: T, s: Pick<Signer, "kid" | "privateKey" | "spki">): Signed<T> {
  const signature = sign(null, Buffer.from(canonical(mandate)), s.privateKey).toString("base64");
  return { mandate, alg: "EdDSA", kid: s.kid, signature, publicKey: s.spki };
}

/** The SHA-256 of a signed cart (mandate, kid and signature, canonical JSON), hex. */
export function cartDigest(cart: Signed<CartMandate>): string {
  return createHash("sha256")
    .update(canonical({ mandate: cart.mandate, alg: cart.alg, kid: cart.kid, signature: cart.signature }))
    .digest("hex");
}

/** What the PayPal order's custom_id carries for an agent purchase: 68 characters, under PayPal's 127. */
export const customIdFor = (cart: Signed<CartMandate>) => `ap2:${cartDigest(cart)}`;

/** An agent order's custom_id: the digest form, or the cart id older cases carried. */
export const AGENT_CUSTOM_ID = /^(ap2:[0-9a-f]{64}|cart_[0-9a-f]{12})$/;

/** A short fingerprint of a public key, the way wallets show one. */
export const fingerprint = fingerprintOf;

/* ───────── Older cases: stand-in keys derived from the order number ───────── */

// PKCS#8 DER prefix for an Ed25519 private key; the 32-byte seed follows.
const ED25519_PKCS8 = Buffer.from("302e020100300506032b657004220420", "hex");

/**
 * Cases opened before 26 Oct 2026 were signed with stand-in keys derived from the order number, rebuilt on
 * every read. They are verified against that derived key (never the one in the mandate) and the check says
 * plainly that it is not a published key. New cases are signed once, at purchase, with published keys.
 */
export function standInSigner(invoiceId: string, role: "wallet" | "agent"): Pick<Signer, "kid" | "privateKey" | "spki"> & { publicKey: ReturnType<typeof createPublicKey> } {
  const seedRole = role === "wallet" ? "cardholder" : "agent";
  const seed = createHash("sha256").update(`exhibit-sandbox-mandate:${seedRole}:${invoiceId}`).digest();
  const privateKey = createPrivateKey({ key: Buffer.concat([ED25519_PKCS8, seed]), format: "der", type: "pkcs8" });
  const publicKey = createPublicKey(privateKey);
  return { kid: `standin-${role}-${invoiceId}`, privateKey, publicKey, spki: publicKey.export({ format: "der", type: "spki" }).toString("base64") };
}

/** Published keys first, then this order's stand-in keys (older cases only). */
export const legacyResolver =
  (invoiceId: string): KeyResolver =>
  (kid) => {
    const hit = publishedResolver(kid);
    if (hit) return hit;
    for (const role of ["wallet", "agent"] as const) {
      const s = standInSigner(invoiceId, role);
      if (kid === s.kid) return { kid, role, key: s.publicKey, spki: s.spki, source: "standin" };
    }
    return null;
  };

/* ───────────────────────────── Checks ───────────────────────────── */

export type CheckId = "intent-signature" | "cart-signature" | "cart-intent" | "total" | "items" | "ship-to" | "window" | "order";

export interface Check {
  id: CheckId;
  label: string;
  ok: boolean;
  detail: string;
}

export interface OrderFacts {
  id: string;
  customId?: string;
  total: string;
  shipTo: string;
  items: { sku?: string; quantity: string | number }[];
  createdAt: string;
}

const money = (v: string | number) => `$${Number(v).toFixed(2)}`;

/** Checks one signature against the key Exhibit trusts for that kid and role. */
export function signatureCheck(s: Signed<unknown>, role: "wallet" | "agent", resolve: KeyResolver = publishedResolver): { ok: boolean; detail: string; key: TrustedKey | null } {
  const key = resolve(s.kid);
  const what = role === "wallet" ? "the cardholder's wallet" : "the agent platform";
  if (!key) return { ok: false, key, detail: `Signed with key ${s.kid}, which is not among the keys Exhibit publishes for ${what}` };
  if (key.role !== role) return { ok: false, key, detail: `Key ${s.kid} is published for ${key.role === "wallet" ? "intent" : "cart"} mandates, not this one` };
  let ok = false;
  try {
    ok = verify(null, Buffer.from(canonical(s.mandate)), key.key, Buffer.from(s.signature, "base64"));
  } catch {
    ok = false;
  }
  const carried = s.publicKey && s.publicKey !== key.spki ? "; the key the mandate carries is a different one" : "";
  if (!ok) return { ok, key, detail: `Signature does not verify against ${key.source === "published" ? "published" : "the"} key ${s.kid}${carried}` };
  const by =
    key.source === "published"
      ? `published key ${s.kid} (${fingerprint(key.spki)})`
      : key.source === "standin"
        ? `this order's sandbox stand-in key (${fingerprint(key.spki)}), derived from the order number as cases opened before 26 Oct 2026 were; not a published key`
        : `sample key ${s.kid}`;
  return { ok, key, detail: `Valid Ed25519 signature by ${by}` };
}

/** Lower case, punctuation out, plurals folded: "Dinner plates" and "dinner plate" are the same kind. */
const norm = (t: string) =>
  t
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .map((w) => (w.endsWith("ies") ? `${w.slice(0, -3)}y` : w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w))
    .join(" ");

/** "a dripper", "an oat mug", "dinner plates". */
const a = (t: string) => {
  const last = t.toLowerCase().trim().split(/\s+/).pop() ?? "";
  const plural = last.length > 3 && last.endsWith("s") && !last.endsWith("ss");
  return plural ? t : `${/^[aeiou]/i.test(t) ? "an" : "a"} ${t}`;
};

/** The cart's items against the intent, by the shop's catalogue category, not by a word in the item's name. */
export function itemsCheck(i: IntentMandate, items: CartMandate["items"]): Omit<Check, "id" | "label"> {
  const want = norm(i.item);
  const allowed = i.quantity ?? 1;
  const problems: string[] = [];
  for (const x of items) {
    const p = findProduct(x.sku);
    const kind = p?.kind ?? x.name;
    if (norm(kind) === want) continue;
    if (p?.contains.some((c) => norm(c) === want)) {
      const extra = [...new Set(p.contains.filter((c) => norm(c) !== want))];
      problems.push(`${x.name} is ${a(p.kind)}, not ${a(i.item)}: it adds ${extra.map(a).join(" and ")} the intent does not allow`);
    } else problems.push(`${x.name} is ${a(kind)}; the intent allows ${a(i.item)}`);
  }
  const units = items.reduce((n, x) => n + x.quantity, 0);
  if (units > allowed) problems.push(`${units} items against ${allowed} allowed`);
  if (!items.length) problems.push("the cart is empty");
  return {
    ok: problems.length === 0,
    detail: `Allowed: ${allowed > 1 ? `${allowed} × ` : ""}${i.item}. Cart: ${items.map((x) => `${x.quantity} × ${x.name}`).join(", ") || "nothing"}${problems.length ? `. ${problems.join("; ")}` : ""}`,
  };
}

/** The intent's limits against a cart (total, items, ship-to, when). Shared by the full check and the preflight. */
function intentChecks(i: IntentMandate, c: Pick<CartMandate, "items" | "total" | "shipTo" | "signedAt">, when: string): Check[] {
  const withinTotal = Number(c.total) <= Number(i.maxTotal);
  const items = itemsCheck(i, c.items);
  const inTime = new Date(c.signedAt) >= new Date(i.issuedAt) && new Date(c.signedAt) <= new Date(i.expiresAt);
  return [
    { id: "total", label: "Total within the intent's limit", ok: withinTotal, detail: `${money(c.total)} against a limit of ${money(i.maxTotal)}` },
    { id: "items", label: "Items match what the cardholder allowed", ...items },
    { id: "ship-to", label: "Ship-to matches the intent", ok: c.shipTo === i.shipTo, detail: c.shipTo === i.shipTo ? c.shipTo : `Cart ships to ${c.shipTo}; intent says ${i.shipTo}` },
    { id: "window", label: "Bought while the intent was valid", ok: inTime, detail: inTime ? `${when} inside the intent's window` : `${when} outside the intent's window` },
  ];
}

/** Every deterministic check on an agent-placed order, in the order a reviewer would read them. */
export function verifyAgentOrder(intent: Signed<IntentMandate>, cart: Signed<CartMandate>, order: OrderFacts | null, resolve: KeyResolver = publishedResolver): Check[] {
  const i = intent.mandate;
  const c = cart.mandate;
  const is = signatureCheck(intent, "wallet", resolve);
  const cs = signatureCheck(cart, "agent", resolve);
  const checks: Check[] = [
    { id: "intent-signature", label: "Cardholder's signature on the intent", ok: is.ok, detail: is.detail },
    { id: "cart-signature", label: "Agent's signature on the cart", ok: cs.ok, detail: cs.detail },
    { id: "cart-intent", label: "Cart answers this intent", ok: c.intentId === i.id, detail: c.intentId === i.id ? `Cart ${c.id} names intent ${i.id}` : `Cart names intent ${c.intentId}, not ${i.id}` },
    ...intentChecks(i, c, "Cart signed"),
  ];
  if (order) {
    const digest = customIdFor(cart);
    // Older cases carried the cart's id instead of its digest.
    const legacy = cs.key?.source === "standin" && order.customId === c.id;
    const bound = order.customId === digest || legacy;
    const sameTotal = Number(order.total) === Number(c.total);
    const sameItems = c.items.every((x) => order.items.some((o) => o.sku === x.sku && Number(o.quantity) === x.quantity)) && order.items.length === c.items.length;
    checks.push({
      id: "order",
      label: "PayPal order matches the signed cart",
      ok: bound && sameTotal && sameItems && order.shipTo === c.shipTo,
      detail: [
        bound
          ? legacy
            ? `order ${order.id} carries cart ${c.id}`
            : `order ${order.id} carries ap2:${digest.slice(4, 16)}…, the SHA-256 of this signed cart`
          : `order ${order.id} carries ${order.customId ? order.customId.slice(0, 20) : "no cart"}, not this cart's digest`,
        sameTotal ? `total ${money(order.total)}` : `order total ${money(order.total)} vs cart ${money(c.total)}`,
        sameItems ? "same items" : "different items",
        order.shipTo === c.shipTo ? "same ship-to" : "different ship-to",
      ].join("; "),
    });
  }
  return checks;
}

const PARTY = { cardholder: "Cardholder", agent: "Buyer's agent platform", merchant: "Merchant" } as const;

/**
 * Who answers for the order, from the checks alone:
 * - a signature that doesn't verify against a published key: nothing proves anyone authorised it, so the merchant;
 * - a PayPal order that differs from the signed cart: the merchant charged for something nobody signed;
 * - a validly signed cart that breaks the signed intent: the agent (its platform signed a cart outside its mandate);
 * - everything holds: the cardholder, who authorised this exact cart through their agent.
 */
export function responsibility(checks: Check[]): Responsibility {
  const failed = (id: CheckId) => checks.some((c) => c.id === id && !c.ok);
  if (failed("intent-signature"))
    return { party: "merchant", label: PARTY.merchant, line: "The intent is not signed by a key the cardholder's wallet publishes, so nothing shows the cardholder allowed this purchase. The merchant carries an order it took without that proof." };
  if (failed("cart-signature"))
    return { party: "merchant", label: PARTY.merchant, line: "The cart is not signed by the agent platform's published key, so it can't be held against the agent. The merchant carries the order." };
  if (failed("order")) return { party: "merchant", label: PARTY.merchant, line: "The PayPal order does not match the cart the agent signed, so the merchant charged for something nobody signed." };
  const BROKE: Partial<Record<CheckId, string>> = {
    "cart-intent": "answers a different intent",
    total: "over the limit",
    items: "not the item allowed",
    "ship-to": "shipped somewhere else",
    window: "signed outside the intent's window",
  };
  const broke = checks.filter((c) => BROKE[c.id] && !c.ok).map((c) => BROKE[c.id]!);
  if (broke.length)
    return {
      party: "agent",
      label: PARTY.agent,
      line: `The agent platform signed a cart outside the cardholder's intent: ${broke.join(", ")}. Refund the cardholder; the signed cart is the record to recover the loss from the agent platform.`,
    };
  return { party: "cardholder", label: PARTY.cardholder, line: "The cardholder's signed intent covers this exact cart and the PayPal order matches it: the cardholder authorised the purchase through their agent." };
}

/* ───────────────────────── Carts and preflight ───────────────────────── */

/** A cart priced from the shop's catalogue: one parcel, so shipping is the dearest item's. */
export function priceCart(items: { sku: string; quantity: number }[]): { items: CartMandate["items"]; shipping: string; total: string; unknown: string[] } {
  const unknown: string[] = [];
  const priced = items.flatMap((x) => {
    const p = findProduct(x.sku);
    if (!p) {
      unknown.push(x.sku);
      return [];
    }
    return [{ sku: p.sku, name: p.name, quantity: Math.max(1, Math.round(x.quantity)), price: p.price }];
  });
  const shipping = priced.length ? Math.max(...priced.map((x) => Number(findProduct(x.sku)!.shipping))) : 0;
  const itemTotal = priced.reduce((t, x) => t + Number(x.price) * x.quantity, 0);
  return { items: priced, shipping: shipping.toFixed(2), total: (itemTotal + shipping).toFixed(2), unknown };
}

/**
 * Would this cart fit the signed intent, before anything is signed or paid? The intent's signature, then its
 * limits on the priced cart. What the buyer agent's check_intent tool and the MCP preflight_cart tool run.
 */
export function preflightCart(
  intent: Signed<IntentMandate>,
  items: { sku: string; quantity: number }[],
  shipTo: string,
  opts: { at?: string; resolve?: KeyResolver } = {},
): { ok: boolean; checks: Check[]; total: string; shipping: string; unknown: string[]; items: CartMandate["items"] } {
  const priced = priceCart(items);
  const is = signatureCheck(intent, "wallet", opts.resolve);
  const at = opts.at ?? new Date().toISOString();
  const checks: Check[] = [
    { id: "intent-signature", label: "Cardholder's signature on the intent", ok: is.ok, detail: is.detail },
    ...intentChecks(intent.mandate, { items: priced.items, total: priced.total, shipTo, signedAt: at }, "Now is"),
  ];
  if (priced.unknown.length) checks.push({ id: "items", label: "Items are in the shop's catalogue", ok: false, detail: `Not sold by ${SHOP.name}: ${priced.unknown.join(", ")}` });
  return { ok: checks.every((c) => c.ok), checks, ...priced };
}

export const CATALOGUE_SKUS = PRODUCTS.map((p) => p.sku);
