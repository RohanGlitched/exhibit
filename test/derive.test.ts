import { test } from "node:test";
import assert from "node:assert/strict";
import { filedDocument, mergeFilings, paypalFilings, resolvedFor, splitFiled, stageLine, stageOf, storyFromPayPal, trackerNumber } from "../lib/cases/derive.ts";
import { SCENARIOS, newCaseCast, scenario, storyForSku } from "../lib/shop/scenarios.ts";
import type { Dispute } from "../lib/paypal/disputes.ts";
import type { Order } from "../lib/paypal/orders.ts";

const money = (value: string) => ({ currency_code: "USD", value });

// Shapes copied from real sandbox responses (PP-R-OCC-10190303, PP-R-TVP-10190304, PP-R-NMS-10190311).
const filedEvidence = {
  evidence_type: "PROOF_OF_FULFILLMENT",
  source: "SUBMITTED_BY_SELLER",
  date: "2026-10-05T06:23:54.080Z",
  action_info: { action: "PROVIDE_EVIDENCE" },
  evidence_info: { tracking_info: [{ carrier_name: "USPS", tracking_number: "9405511206213859470035" }] },
  documents: [{ name: "response.pdf", url: "https://api-m.sandbox.paypal.com/v2/content/documents/DIS-010/files/1/download" }],
  notes: "We shipped store order HC-80948 to Maya Lindqvist. [B] USPS shows delivery on 27 Sep 2026, 13:00. [D, E]",
};
const created = { evidence_type: "CREATE", source: "SUBMITTED_BY_BUYER", date: "2026-10-05T05:58:35.147Z", notes: "Exhibit sandbox case" };
const accepted = { evidence_type: "OTHER", source: "SUBMITTED_BY_SELLER", date: "2026-10-05T06:23:12.855Z", action_info: { action: "ACCEPT_CLAIM" }, notes: "We accept." };

const base = (over: Partial<Dispute>): Dispute =>
  ({
    dispute_id: "PP-R-OCC-10190303",
    create_time: "2026-10-05T05:58:35.147Z",
    update_time: "2026-10-06T08:34:13.388Z",
    reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
    status: "UNDER_REVIEW",
    dispute_amount: money("104.00"),
    ...over,
  }) as Dispute;

test("a case PayPal holds the seller's evidence on is filed, even with no record in Exhibit's store", () => {
  const d = base({ evidences: [created, filedEvidence] });
  const filings = paypalFilings(d);
  assert.equal(filings.length, 1);
  assert.equal(filings[0].action, "evidence");
  assert.equal(filings[0].source, "paypal");
  assert.match(filings[0].summary, /proof of fulfillment with tracking 9405511206213859470035 and response\.pdf/);
  assert.equal(stageOf(d, filings), "filed");
});

test("the buyer's own CREATE entry is not a filing", () => {
  assert.equal(paypalFilings(base({ evidences: [created] })).length, 0);
  assert.equal(stageOf(base({ evidences: [created] }), []), "reviewing");
});

test("resolved with a payout but no settlement debit is a win (PayPal paid the buyer, the seller kept the money)", () => {
  const d = base({
    status: "RESOLVED",
    dispute_outcome: { outcome_code: "RESOLVED_WITH_PAYOUT", outcome_reason: "REPRESENTED_BY_PAYPAL" },
    fund_movements: [
      { party: "RECEIVER", type: "DEBIT", reason: "HOLD_PLACED", amount: money("104.00") },
      { party: "RECEIVER", type: "CREDIT", reason: "HOLD_RELEASED", amount: money("104.00") },
    ],
  });
  assert.equal(resolvedFor(d), "won");
  assert.equal(stageOf(d, [{ action: "evidence" }]), "won");
  assert.equal(stageLine("won", d, [{ action: "evidence" }]), "Won: the seller keeps $104.00");
});

test("a settlement debit from the seller is a loss; an acceptance is a refund, not a loss", () => {
  const d = base({
    status: "RESOLVED",
    dispute_amount: money("27.00"),
    dispute_outcome: { outcome_code: "RESOLVED_BUYER_FAVOUR" },
    fund_movements: [{ party: "RECEIVER", type: "DEBIT", reason: "DISPUTE_SETTLEMENT", amount: money("27.00") }],
    evidences: [created, accepted],
  });
  assert.equal(resolvedFor(d), "lost");
  const filings = paypalFilings(d);
  assert.equal(filings[0].action, "accept");
  assert.equal(stageOf(d, filings), "refunded");
  assert.equal(stageLine("lost", d, []), "Lost: no response before the deadline, $27.00 returned to the buyer");
});

test("the list endpoint's WON/LOST summary is read directly", () => {
  assert.equal(resolvedFor({ status: "RESOLVED", outcome: "WON" }), "won");
  assert.equal(resolvedFor({ status: "RESOLVED", outcome: "LOST" }), "lost");
  assert.equal(resolvedFor({ status: "UNDER_REVIEW", outcome: "WON" }), null);
});

test("statuses before a filing map to open and waiting", () => {
  assert.equal(stageOf(base({ status: "OPEN" }), []), "open");
  assert.equal(stageOf(base({ status: "WAITING_FOR_SELLER_RESPONSE" }), []), "waiting");
});

test("Exhibit's own filing and PayPal's copy of it are merged, not doubled", () => {
  const own = [{ at: "2026-10-05T06:24:01.000Z", action: "evidence" as const, summary: "Filed the response (6 sentences)", ok: true, by: "seller" as const }];
  const merged = mergeFilings(own, paypalFilings(base({ evidences: [filedEvidence] })));
  assert.equal(merged.length, 1);
  assert.equal(merged[0].summary, "Filed the response (6 sentences)");
  const later = mergeFilings(own, paypalFilings(base({ evidences: [{ ...accepted, date: "2026-10-07T00:00:00.000Z" }] })));
  assert.equal(later.length, 2);
});

test("a filed response splits back into its cited sentences", () => {
  const parts = splitFiled(filedEvidence.notes);
  assert.deepEqual(parts, [
    { text: "We shipped store order HC-80948 to Maya Lindqvist.", cites: ["B"] },
    { text: "USPS shows delivery on 27 Sep 2026, 13:00.", cites: ["D", "E"] },
  ]);
  assert.deepEqual(splitFiled("We accept the chargeback. We did not answer the emails."), [
    { text: "We accept the chargeback.", cites: [] },
    { text: "We did not answer the emails.", cites: [] },
  ]);
});

test("the filed PDF link comes from the seller's latest evidence", () => {
  assert.equal(filedDocument(base({ evidences: [created, filedEvidence] }))?.name, "response.pdf");
  assert.equal(filedDocument(base({ evidences: [created, accepted] })), null);
});

test("a story and its customer are read back from PayPal: invoice, product and the name on the card", () => {
  const order = {
    id: "8WV32866A66422647",
    status: "COMPLETED",
    create_time: "",
    intent: "CAPTURE",
    purchase_units: [{ invoice_id: "HC-80987", amount: money("46.00"), shipping: { trackers: [{ id: "4LX46692B2912382K-9405511206213859470066" }] } }],
  } as Order;
  const d = base({
    reason: "DUPLICATE_TRANSACTION",
    disputed_transactions: [{ seller_transaction_id: "4LX46692B2912382K", invoice_number: "HC-80987", buyer: { name: "Lucy Tran" }, items: [{ item_id: "HC-MUG-SLATE" }] }],
  });
  assert.equal(trackerNumber(order, "4LX46692B2912382K"), "9405511206213859470066");
  const s = storyFromPayPal(d, order)!;
  assert.equal(s.id, "duplicate");
  assert.equal(s.buyer.name, "Lucy Tran");
  assert.match(s.carrier!.scans.at(-1)!.place, /Arlington, VA 22201/);
  // A probe dispute with no shop invoice is not one of the stories.
  assert.equal(storyFromPayPal(base({ disputed_transactions: [{ invoice_number: "PROBE-1", items: [{ item_id: "HC-MUG-SLATE" }] }] })), undefined);
});

test("every story has five distinct customers, and their text names the right one", () => {
  for (const s of SCENARIOS) {
    assert.equal(new Set(s.buyers.map((b) => b.name)).size, 5, s.id);
    assert.equal(new Set(s.buyers.map((b) => b.email)).size, 5, s.id);
    for (let i = 0; i < 5; i++) {
      const c = scenario(s.id, { buyer: i })!;
      const text = JSON.stringify([c.inbox, c.carrier?.scans ?? [], c.notes]);
      assert.doesNotMatch(text, /\{(first|signature|city|billingState)\}/, `${s.id} #${i}`);
    }
  }
  const jonah = scenario("delivered", { buyer: "Jonah Whitaker" })!;
  assert.match(jonah.carrier!.scans.at(-1)!.detail!, /Signed for by J WHITAKER/);
  assert.match(jonah.inbox[1].text, /^Hi Jonah,/);
  assert.equal(scenario("delivered", { buyer: "Nobody Here" })!.buyer.name, "Maya Lindqvist");
  // The first customer reads exactly as the stories did before customers varied.
  assert.match(scenario("delivered")!.carrier!.scans.at(-1)!.detail!, /Signed for by M LINDQVIST at front desk/);
  assert.match(scenario("fraud")!.notes[1], /billing address is in Ohio\.$/);
});

test("a new case gets a customer and a 22-digit USPS-shaped tracking number", () => {
  const s = scenario("delivered")!;
  for (let i = 0; i < 20; i++) {
    const c = newCaseCast(s);
    assert.ok(c.buyer >= 0 && c.buyer < 5);
    assert.match(c.tracking!, /^9405511206213\d{9}$/);
  }
  assert.equal(newCaseCast(scenario("untracked")!).tracking, undefined);
  assert.equal(storyForSku("HC-VASE-TALL")?.id, "untracked");
});
