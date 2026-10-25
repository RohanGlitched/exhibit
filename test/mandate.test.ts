import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, createPublicKey, verify } from "node:crypto";
import {
  canonical,
  cartDigest,
  customIdFor,
  itemsCheck,
  legacyResolver,
  preflightCart,
  responsibility,
  signatureCheck,
  signMandate,
  verifyAgentOrder,
  type OrderFacts,
} from "../lib/agentic/mandate.ts";
import { forger, kidFor, publishedKeys, publishedResolver, requireSigner } from "../lib/agentic/keys.ts";
import { cartMandateId, intentFor, legacyMandates, shipLine } from "../lib/agentic/story.ts";
import { replayRun } from "../lib/agentic/shop-tools.ts";
import { LISTING_INJECTION } from "../lib/shop/catalog.ts";
import { scenario } from "../lib/shop/scenarios.ts";
import { oddsFor } from "../lib/cases/verify.ts";
import type { AgentRun } from "../lib/agentic/types.ts";

const ORDER_AT = new Date("2026-10-04T17:30:00.000Z");
const INVOICE = "HC-123456";

/** The PayPal order a run paid for, as Exhibit reads it back. */
const orderFor = (run: AgentRun, over: Partial<OrderFacts> = {}): OrderFacts => ({
  id: "5O190127TN364715T",
  customId: customIdFor(run.cart),
  total: run.cart.mandate.total,
  shipTo: run.cart.mandate.shipTo,
  items: run.cart.mandate.items.map((i) => ({ sku: i.sku, quantity: String(i.quantity) })),
  createdAt: ORDER_AT.toISOString(),
  ...over,
});

const run = (id: string, opts: { forged?: "intent" | "cart" } = {}, buyer = 2) => replayRun(scenario(id, { buyer })!, ORDER_AT, { orderId: "5O190127TN364715T", ...opts });

test("canonical JSON ignores key order", () => {
  assert.equal(canonical({ b: 1, a: [2, { d: 3, c: 4 }] }), canonical({ a: [2, { c: 4, d: 3 }], b: 1 }));
});

test("an agent order inside the signed intent passes every check, and the cardholder is responsible", async () => {
  const r = await run("agent-mandate");
  const checks = verifyAgentOrder(r.intent, r.cart, orderFor(r));
  assert.deepEqual(
    checks.filter((c) => !c.ok).map((c) => c.label),
    [],
  );
  assert.equal(checks.length, 8);
  assert.equal(responsibility(checks).party, "cardholder");
  assert.match(checks[0].detail, new RegExp(`published key ${r.intent.kid}`));
});

test("the key is found by kid in the published set, never taken from the mandate", async () => {
  const r = await run("agent-mandate");
  const wallet = requireSigner("wallet");
  assert.equal(r.intent.kid, wallet.kid);
  assert.equal(r.intent.kid, kidFor("wallet", wallet.spki));
  assert.ok(publishedKeys().some((k) => k.kid === wallet.kid && k.role === "wallet"));
  // A wrong key carried in the mandate changes nothing: the published key still verifies it.
  const other = forger("x").spki;
  assert.equal(signatureCheck({ ...r.intent, publicKey: other }, "wallet").ok, true);
  // An unknown kid fails, even with a valid signature by the key the mandate carries.
  const stranger = forger("wallet-000000000000");
  const self = signMandate(r.intent.mandate, stranger);
  assert.equal(verify(null, Buffer.from(canonical(self.mandate)), createPublicKey({ key: Buffer.from(self.publicKey!, "base64"), format: "der", type: "spki" }), Buffer.from(self.signature, "base64")), true);
  const unknown = signatureCheck(self, "wallet");
  assert.equal(unknown.ok, false);
  assert.match(unknown.detail, /not among the keys Exhibit publishes/);
  // A published key used for the other role fails too: the agent's key can't sign the cardholder's intent.
  const asAgent = signMandate(r.intent.mandate, requireSigner("agent"));
  assert.match(signatureCheck(asAgent, "wallet").detail, /published for cart mandates/);
  assert.equal(publishedResolver("nope"), null);
});

test("a forged intent (a fresh key claiming the wallet's kid) fails, and the merchant carries it", async () => {
  const r = await run("agent-mandate", { forged: "intent" });
  assert.equal(r.intent.kid, requireSigner("wallet").kid);
  const checks = verifyAgentOrder(r.intent, r.cart, orderFor(r));
  const sig = checks.find((c) => c.id === "intent-signature")!;
  assert.equal(sig.ok, false);
  assert.match(sig.detail, /does not verify against published key .*the key the mandate carries is a different one/);
  assert.equal(checks.filter((c) => !c.ok).length, 1);
  const v = responsibility(checks);
  assert.equal(v.party, "merchant");
  assert.match(v.line, /nothing shows the cardholder allowed this purchase/);
});

test("a forged or tampered cart fails the agent's signature", async () => {
  const forged = await run("agent-mandate", { forged: "cart" });
  assert.equal(verifyAgentOrder(forged.intent, forged.cart, orderFor(forged)).find((c) => c.id === "cart-signature")!.ok, false);
  const r = await run("agent-mandate");
  const tampered = { ...r.cart, mandate: { ...r.cart.mandate, total: "18.00" } };
  assert.equal(signatureCheck(r.cart, "agent").ok, true);
  assert.equal(signatureCheck(tampered, "agent").ok, false);
});

test("items match by catalogue category: a pour-over set is not a dripper, whatever its name says", async () => {
  const r = await run("agent-overreach");
  const failed = verifyAgentOrder(r.intent, r.cart, orderFor(r)).filter((c) => !c.ok);
  assert.deepEqual(
    failed.map((c) => c.label),
    ["Total within the intent's limit", "Items match what the cardholder allowed"],
  );
  assert.match(failed[0].detail, /\$104\.00 against a limit of \$60\.00/);
  assert.match(failed[1].detail, /Pour-over set, dripper and carafe is a pour-over set, not a dripper: it adds a carafe/);
  assert.equal(responsibility(failed).party, "agent");

  // Within the limit, the wrong thing still fails.
  const s = scenario("agent-overreach")!;
  const roomy = { ...s, agent: { ...s.agent!, maxTotal: "120.00" } };
  const r2 = await replayRun(roomy, ORDER_AT, { orderId: "X" });
  assert.deepEqual(
    verifyAgentOrder(r2.intent, r2.cart, orderFor(r2))
      .filter((c) => !c.ok)
      .map((c) => c.id),
    ["items"],
  );

  // Plural or singular, the same category passes; a second set is over the quantity.
  const plates = intentFor(scenario("agent-mandate")!, ORDER_AT);
  assert.equal(itemsCheck(plates, [{ sku: "HC-PLATE-DIN", name: "Dinner plates, set of four", quantity: 1, price: "168.00" }]).ok, true);
  assert.equal(itemsCheck({ ...plates, item: "dinner plate" }, [{ sku: "HC-PLATE-DIN", name: "Dinner plates, set of four", quantity: 1, price: "168.00" }]).ok, true);
  assert.match(itemsCheck(plates, [{ sku: "HC-PLATE-DIN", name: "Dinner plates, set of four", quantity: 2, price: "168.00" }]).detail, /2 items against 1 allowed/);
  assert.equal(itemsCheck(plates, [{ sku: "HC-MUG-SLATE", name: "Slate speckle mug, 12 oz", quantity: 1, price: "38.00" }]).ok, false);
});

test("custom_id is ap2: plus the SHA-256 of the signed cart, and the order check holds the order to it", async () => {
  const r = await run("agent-mandate");
  const id = customIdFor(r.cart);
  assert.match(id, /^ap2:[0-9a-f]{64}$/);
  assert.ok(id.length <= 127);
  const expected = createHash("sha256")
    .update(canonical({ mandate: r.cart.mandate, alg: r.cart.alg, kid: r.cart.kid, signature: r.cart.signature }))
    .digest("hex");
  assert.equal(id, `ap2:${expected}`);
  assert.equal(r.digest, cartDigest(r.cart));
  // Any change to the signed cart changes the digest.
  const resigned = signMandate({ ...r.cart.mandate, total: "180.01" }, requireSigner("agent"));
  assert.notEqual(customIdFor(resigned), id);

  const order = (o: Partial<OrderFacts>) => verifyAgentOrder(r.intent, r.cart, orderFor(r, o)).find((c) => c.id === "order")!;
  assert.equal(order({}).ok, true);
  assert.match(order({}).detail, /the SHA-256 of this signed cart/);
  assert.equal(order({ customId: customIdFor(resigned) }).ok, false);
  assert.equal(order({ customId: r.cart.mandate.id }).ok, false); // a bare cart id only counts on older cases
  assert.equal(order({ total: "190.00" }).ok, false);
  assert.equal(order({ shipTo: "1 Other Street, Reno, NV 89501" }).ok, false);
  assert.equal(responsibility(verifyAgentOrder(r.intent, r.cart, orderFor(r, { total: "190.00" }))).party, "merchant");
});

test("older cases rebuild with the order's stand-in keys, say so, and still bind by cart id", () => {
  const s = scenario("agent-mandate")!;
  const m = legacyMandates(s, INVOICE, ORDER_AT)!;
  assert.equal(m.cart.mandate.id, cartMandateId(INVOICE));
  const facts: OrderFacts = {
    id: "5O190127TN364715T",
    customId: cartMandateId(INVOICE),
    total: m.cart.mandate.total,
    shipTo: shipLine(s.buyer.shipTo),
    items: s.items.map((i) => ({ sku: i.sku, quantity: String(i.quantity) })),
    createdAt: ORDER_AT.toISOString(),
  };
  const checks = verifyAgentOrder(m.intent, m.cart, facts, legacyResolver(INVOICE));
  assert.deepEqual(
    checks.filter((c) => !c.ok).map((c) => c.id),
    [],
  );
  assert.match(checks[0].detail, /stand-in key .* not a published key/);
  // Against the published keys alone, a stand-in signature is unknown.
  assert.equal(signatureCheck(m.intent, "wallet").ok, false);
  // Another order's stand-in keys don't verify it.
  assert.equal(signatureCheck(m.intent, "wallet", legacyResolver("HC-999999")).ok, false);
});

test("preflight says the dripper intent doesn't fit the set, and the plates intent fits the plates", async () => {
  const pour = await run("agent-overreach");
  const p = preflightCart(pour.intent, [{ sku: "HC-SET-POUR", quantity: 1 }], pour.cart.mandate.shipTo, { at: pour.cart.mandate.signedAt });
  assert.equal(p.ok, false);
  assert.equal(p.total, "104.00");
  const plates = await run("agent-mandate");
  const q = preflightCart(plates.intent, [{ sku: "HC-PLATE-DIN", quantity: 1 }], plates.cart.mandate.shipTo, { at: plates.cart.mandate.signedAt });
  assert.equal(q.ok, true, q.checks.map((c) => c.detail).join("; "));
  assert.equal(preflightCart(plates.intent, [{ sku: "NOPE", quantity: 1 }], plates.cart.mandate.shipTo).ok, false);
});

test("the injected listing reaches the agent, and the mandate check catches the cart it leads to", async () => {
  const r = await run("agent-overreach");
  assert.equal(r.injection, true);
  const view = r.steps.find((st) => st.tool === "view_product")!;
  assert.ok(view.result.includes(LISTING_INJECTION.slice(0, 40)));
  const check = r.steps.find((st) => st.tool === "check_intent")!;
  assert.equal(check.ok, false);
  assert.deepEqual(
    r.steps.map((st) => st.tool),
    ["search_catalog", "view_product", "add_to_cart", "check_intent", "sign_cart", "pay", "finish"],
  );
  assert.equal(responsibility(verifyAgentOrder(r.intent, r.cart, orderFor(r))).party, "agent");
  // The plates story's listing has no such line.
  const clean = await run("agent-mandate");
  assert.ok(!clean.steps.some((st) => st.result.includes("AI shopping assistants")));
});

test("a refund call never shows the seller ahead", () => {
  assert.equal(oddsFor("accept", 56), 50);
  assert.equal(oddsFor("accept", 20), 20);
  assert.equal(oddsFor("fight", 90), 90);
});
