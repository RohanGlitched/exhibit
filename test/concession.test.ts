import { test } from "node:test";
import assert from "node:assert/strict";
import { SELF_ADMISSION } from "../lib/cases/verify.ts";
import { concessionLetter } from "../lib/cases/concession.ts";

test("the seller's own lapses stay out of filed sentences", () => {
  assert.ok(SELF_ADMISSION.test("We did not answer the buyer's two emails."));
  assert.ok(SELF_ADMISSION.test("We didn't reply before the chargeback."));
  assert.ok(SELF_ADMISSION.test("We never responded to the buyer."));
  assert.ok(!SELF_ADMISSION.test("We never received the return."));
  assert.ok(!SELF_ADMISSION.test("The buyer did not answer our offer."));
});

test("a concession letter on a card chargeback promises no second refund", () => {
  const t = concessionLetter("27.00", true);
  assert.match(t, /We accept the chargeback/);
  assert.match(t, /the disputed \$27\.00 remains with the cardholder/);
  assert.match(t, /no further refund will be issued/);
  assert.ok(!/will refund/i.test(t));
  assert.match(concessionLetter("46.00", false), /PayPal returns the disputed \$46\.00 to the buyer/);
});
