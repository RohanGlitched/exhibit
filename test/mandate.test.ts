import { test } from "node:test";
import assert from "node:assert/strict";
import { canonical, signatureValid, verifyAgentOrder } from "../lib/agentic/mandate.ts";
import { agentMandates, cartMandateId, shipLine } from "../lib/agentic/story.ts";
import { scenario } from "../lib/shop/scenarios.ts";

const ORDER_AT = new Date("2026-10-04T17:30:00.000Z");
const INVOICE = "HC-123456";

const orderFor = (s: NonNullable<ReturnType<typeof scenario>>, over: Partial<{ customId: string; total: string; shipTo: string }> = {}) => ({
  id: "5O190127TN364715T",
  customId: over.customId ?? cartMandateId(INVOICE),
  total: over.total ?? (s.items.reduce((t, i) => t + Number(i.price) * i.quantity, 0) + Number(s.shipping)).toFixed(2),
  shipTo: over.shipTo ?? shipLine(s.buyer.shipTo),
  items: s.items.map((i) => ({ sku: i.sku, quantity: String(i.quantity) })),
  createdAt: ORDER_AT.toISOString(),
});

test("canonical JSON ignores key order", () => {
  assert.equal(canonical({ b: 1, a: [2, { d: 3, c: 4 }] }), canonical({ a: [2, { c: 4, d: 3 }], b: 1 }));
});

test("an agent order inside the signed intent passes every check, the same way every time", () => {
  const s = scenario("agent-mandate", { buyer: 2 })!;
  const m = agentMandates(s, INVOICE, ORDER_AT)!;
  const again = agentMandates(s, INVOICE, ORDER_AT)!;
  assert.equal(m.cart.signature, again.cart.signature);
  const checks = verifyAgentOrder(m.intent, m.cart, orderFor(s));
  assert.deepEqual(
    checks.filter((c) => !c.ok).map((c) => c.label),
    [],
  );
  assert.equal(checks.length, 8);
});

test("a tampered cart no longer verifies", () => {
  const s = scenario("agent-mandate")!;
  const m = agentMandates(s, INVOICE, ORDER_AT)!;
  const forged = { ...m.cart, mandate: { ...m.cart.mandate, total: "18.00" } };
  assert.equal(signatureValid(m.cart), true);
  assert.equal(signatureValid(forged), false);
  // A signature from another order's key doesn't verify either.
  const other = agentMandates(s, "HC-999999", ORDER_AT)!;
  assert.equal(signatureValid({ ...m.cart, publicKey: other.cart.publicKey }), false);
});

test("the overreach story fails on the limit, and only on the limit", () => {
  const s = scenario("agent-overreach")!;
  const m = agentMandates(s, INVOICE, ORDER_AT)!;
  const failed = verifyAgentOrder(m.intent, m.cart, orderFor(s)).filter((c) => !c.ok);
  assert.deepEqual(
    failed.map((c) => c.label),
    ["Total within the intent's limit"],
  );
  assert.match(failed[0].detail, /\$104\.00 against a limit of \$60\.00/);
});

test("a PayPal order that doesn't carry the cart, or differs from it, fails the order check", () => {
  const s = scenario("agent-mandate")!;
  const m = agentMandates(s, INVOICE, ORDER_AT)!;
  const bad = (o: ReturnType<typeof orderFor>) => verifyAgentOrder(m.intent, m.cart, o).find((c) => c.label === "PayPal order matches the signed cart")!;
  assert.equal(bad(orderFor(s)).ok, true);
  assert.equal(bad(orderFor(s, { customId: "cart_000000000000" })).ok, false);
  assert.equal(bad(orderFor(s, { total: "190.00" })).ok, false);
  assert.equal(bad(orderFor(s, { shipTo: "1 Other Street, Reno, NV 89501" })).ok, false);
});
