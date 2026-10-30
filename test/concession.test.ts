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

test("an agent-bought not-received or not-as-described case needs the sentence tying the order to the cardholder", async () => {
  const { agentOrderItem } = await import("../lib/cases/requirements.ts");
  const ex = (id: string, kind: string, facts: { label: string; value: string }[] = []) => ({ id, kind, title: kind, source: "x", facts, lines: [] }) as never;
  assert.equal(agentOrderItem([ex("A", "claim")]), null, "not an agent purchase");
  const ok = agentOrderItem([ex("D", "mandate"), ex("E", "mandate"), ex("F", "check", [{ label: "Responsible", value: "Cardholder" }])])!;
  assert.equal(ok.status, "on file");
  assert.equal(ok.required, true);
  assert.deepEqual(ok.exhibits, ["F", "D", "E"]);
  assert.equal(agentOrderItem([ex("F", "check", [{ label: "Responsible", value: "Agent platform" }])])!.status, "missing");
});
