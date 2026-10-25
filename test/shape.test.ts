import { test } from "node:test";
import assert from "node:assert/strict";
import { briefProblems, normaliseBrief, sentenceShaped } from "../lib/cases/shape.ts";

const good = {
  recommendation: "fight",
  offer_amount: null,
  headline: "USPS shows it signed for. File the evidence.",
  tally: [{ side: "seller", point: "Signed for.", weight: 3, cites: ["E"] }],
  response: [{ text: "USPS delivered it on 4 Oct 2026.", cites: ["E"], quote: "Delivered, signed" }],
  buyer_message: null,
  evidence_types: ["PROOF_OF_FULFILLMENT"],
};

test("a brief in the tool's shape has no problems", () => {
  assert.deepEqual(briefProblems(good, false), []);
});

test("a brief in the wrong shape is caught field by field", () => {
  assert.deepEqual(briefProblems(null, false), ["not an object"]);
  assert.deepEqual(briefProblems({ ...good, recommendation: "offer" }, false), ["recommendation"]); // no offers on a chargeback
  assert.deepEqual(briefProblems({ ...good, recommendation: "offer" }, true), []);
  assert.deepEqual(briefProblems({ ...good, response: [] }, false), ["response"]);
  assert.deepEqual(briefProblems({ ...good, response: [{ cites: ["E"] }] }, false), ["response sentences"]);
  assert.deepEqual(briefProblems({ ...good, tally: "Signed for." , offer_amount: "20" }, false), ["tally", "offer_amount"]);
});

test("arrays sent as a JSON string are read back", () => {
  const raw = { ...good, response: JSON.stringify(good.response), tally: JSON.stringify(good.tally) };
  assert.deepEqual(briefProblems(raw, false), ["tally", "response"]);
  assert.deepEqual(briefProblems(normaliseBrief(raw), false), []);
  assert.deepEqual(briefProblems(normaliseBrief({ ...good, response: "[not json" }), false), ["response"]);
});

test("one sentence's shape: text, letters, an optional quote", () => {
  assert.equal(sentenceShaped({ text: "x", cites: ["E"] }), true);
  assert.equal(sentenceShaped({ text: "x", cites: "B, E", quote: null }), true);
  assert.equal(sentenceShaped({ text: "x", cites: [1] }), false);
  assert.equal(sentenceShaped({ text: 3, cites: ["E"] }), false);
  assert.equal(sentenceShaped({ text: "x", cites: ["E"], quote: 5 }), false);
});
