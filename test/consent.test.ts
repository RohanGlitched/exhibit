import { test } from "node:test";
import assert from "node:assert/strict";
import { consentOverride, readConsent } from "../lib/agentic/consent.ts";
import { responsibility, type Check } from "../lib/agentic/mandate.ts";

const pass = (id: Check["id"]): Check => ({ id, label: id, ok: true, detail: "" });
const fail = (id: Check["id"]): Check => ({ id, label: id, ok: false, detail: "" });
const ALL: Check["id"][] = ["intent-signature", "cart-signature", "cart-intent", "total", "items", "ship-to", "window", "order"];
const checks = (...failed: Check["id"][]) => ALL.map((id) => (failed.includes(id) ? fail(id) : pass(id)));

const REVOKED = [
  "Searched 6 shops for handmade dinner plates.",
  "Asked the cardholder to confirm the slate speckle set before buying.",
  'Cardholder replied: "Hold off for now, I want to check with my partner first. Don\'t buy anything yet."',
  "The signed intent was still valid, so continued to checkout.",
  "Signed the cart mandate and paid with the cardholder's card through PayPal.",
];
const APPROVED = [
  "The set is $104.00 delivered, over the $60.00 limit, so asked the cardholder before buying.",
  'Cardholder replied: "Yes, get the set, the carafe is fine. Go ahead at $104."',
  "Signed the cart mandate and paid with the cardholder's card through PayPal.",
];

test("reads withdrawn consent and a written approval from the cardholder's own words", () => {
  assert.match(readConsent(REVOKED).withdrawn!, /^Hold off for now/);
  assert.equal(readConsent(REVOKED).approved, null);
  assert.deepEqual(readConsent(APPROVED).approved, { said: "Yes, get the set, the carafe is fine. Go ahead at $104.", amount: "$104" });
  // The agent's own words and the base story's log say nothing either way.
  assert.deepEqual(readConsent(["Told the cardholder: ordered the plates.", "Checked the cart against the signed intent."]), { withdrawn: null, approved: null });
  // The last thing the cardholder said decides.
  assert.equal(readConsent([REVOKED[2], 'Cardholder replied: "OK, go ahead and buy them."']).withdrawn, null);
});

test("withdrawn consent overrides a mandate check that passes", () => {
  const c = checks();
  const o = consentOverride(c, responsibility(c), REVOKED, "180.00");
  assert.equal(o?.kind, "withdrawn");
  assert.equal(o?.verdict.party, "agent");
  assert.match(o!.verdict.line, /withdrew consent before checkout/);
});

test("a written approval covers an overage and the item, nothing else", () => {
  const over = checks("total", "items");
  const o = consentOverride(over, responsibility(over), APPROVED, "104.00");
  assert.equal(o?.kind, "approved");
  assert.equal(o?.verdict.party, "cardholder");
  // Not a cart shipped elsewhere, a bad signature, or more than the amount the cardholder named.
  const elsewhere = checks("total", "ship-to");
  assert.equal(consentOverride(elsewhere, responsibility(elsewhere), APPROVED, "104.00"), null);
  const forged = checks("cart-signature");
  assert.equal(consentOverride(forged, responsibility(forged), APPROVED, "104.00"), null);
  assert.equal(consentOverride(over, responsibility(over), APPROVED, "140.00"), null);
});

test("no words from the cardholder leave the check's verdict alone", () => {
  const c = checks("total");
  assert.equal(consentOverride(c, responsibility(c), ["Signed the cart mandate and paid."], "104.00"), null);
});
