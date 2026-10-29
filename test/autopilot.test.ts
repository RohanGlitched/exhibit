import { test } from "node:test";
import assert from "node:assert/strict";
import { HOUSE_RULES, checkerStrikes, decide, laneStoryFor, planDue, planFor, rulingDue, sinceWords, undoable, type DecideInput } from "../lib/cases/autopilot.ts";
import { routeFor } from "../lib/webhooks/paypal.ts";
import { inPool, untouched } from "../lib/cases/pool.ts";
import type { CaseRecord } from "../lib/cases/types.ts";

const NOW = Date.parse("2026-10-30T12:00:00Z");
const kept = (text: string) => ({ text, cites: ["A"], kept: true });
const hearing = (side: "seller" | "buyer", rulings: ("overruled" | "sustained")[] = [], after: "fight" | "accept" = side === "seller" ? "fight" : "accept") =>
  ({
    verdict: { side, reason: "r", by: "reviewer" },
    after,
    engine: "model",
    source: "draft",
    exchanges: rulings.map((ruling, i) => ({ objection: { n: i + 1, sentence: 0, text: "o", ground: "unsupported", pages: [] }, answer: { stance: "answer", text: "a", cites: [], kept: true, effect: "none" }, ruling, reason: "", ruledBy: "reviewer" })),
  }) as unknown as DecideInput["hearing"];
const fight = (extra: Partial<DecideInput> = {}): DecideInput => ({
  brief: { recommendation: "fight", sentences: [kept("Delivered on 4 Oct."), kept("Signed for.")] },
  hearing: hearing("seller", ["overruled", "sustained"]),
  amount: 104,
  due: new Date(NOW + 5 * 86_400_000).toISOString(),
  now: NOW,
  ...extra,
});

test("rule 2: a clean fight the draft hearing upholds is filed, after the undo window", () => {
  const d = decide(fight());
  assert.equal(d.action, "evidence");
  assert.equal(d.rule, 2);
  const p = planFor(fight());
  assert.equal(new Date(p.sendAfter).getTime() - NOW, HOUSE_RULES.undoMinutes * 60_000);
  assert.deepEqual(p.hearing, { side: "seller", objections: 2, overruled: 1, sustained: 1, engine: "model" });
  assert.ok(!planDue(p, NOW), "not inside the undo window");
  assert.ok(undoable(p, NOW));
  assert.ok(planDue(p, NOW + HOUSE_RULES.undoMinutes * 60_000));
  assert.ok(!planDue({ ...p, undone: { at: "x" } }, NOW + 3_600_000), "an undone plan is never sent");
  assert.ok(!planDue({ ...p, done: { at: "x", summary: "" } }, NOW + 3_600_000), "a sent plan isn't sent twice");
});

test("rule 2 holds back on a strike, a lost hearing, a near deadline or no hearing", () => {
  const struck = fight({ brief: { recommendation: "fight", sentences: [kept("a"), { text: "b", cites: ["A"], kept: false, why: "Not in Exhibit A" }] } });
  assert.match(decide(struck).reason, /struck 1 sentence/);
  const withdrawn = fight({ brief: { recommendation: "fight", sentences: [kept("a"), { text: "b", cites: ["A"], kept: false, why: "Withdrawn at the hearing after objection 1: x" }] } });
  assert.equal(decide(withdrawn).action, "evidence", "a sentence withdrawn at the hearing isn't a checker strike");
  assert.equal(checkerStrikes(withdrawn.brief), 0);
  assert.equal(decide(fight({ hearing: hearing("buyer", [], "fight") })).action, "queue");
  assert.equal(decide(fight({ hearing: null })).action, "queue");
  const near = decide(fight({ due: new Date(NOW + 30 * 3_600_000).toISOString() }));
  assert.equal(near.action, "queue");
  assert.match(near.reason, /Only 30 hours/);
});

test("rule 1: a small refund both the brief and the reviewer want is accepted; a large one waits", () => {
  const refund = (amount: number, side: "seller" | "buyer" = "buyer"): DecideInput => ({ ...fight(), brief: { recommendation: "accept", sentences: [kept("No tracking.")] }, hearing: hearing(side), amount });
  assert.deepEqual([decide(refund(27)).action, decide(refund(27)).rule], ["accept", 1]);
  assert.equal(decide(refund(180)).action, "queue");
  assert.equal(decide(refund(27, "seller")).action, "queue", "the reviewer disagreeing sends it to the seller");
  assert.equal(planFor(refund(27)).sendAfter, new Date(NOW + HOUSE_RULES.undoMinutes * 60_000).toISOString());
  const q = planFor(refund(180));
  assert.equal(q.sendAfter, new Date(NOW).toISOString(), "a queued case has no window");
  assert.ok(!planDue(q, NOW + 86_400_000));
  assert.ok(!undoable(q, NOW));
});

test("rule 5: the autopilot asks for a ruling at once on its lane, after two hours elsewhere, never twice", () => {
  const filings = [{ action: "evidence" as const, at: new Date(NOW - 30 * 60_000).toISOString(), ok: true }];
  assert.ok(rulingDue({ lane: true, filings, adjudicable: true, now: NOW }));
  assert.ok(!rulingDue({ lane: false, filings, adjudicable: true, now: NOW }));
  assert.ok(rulingDue({ lane: false, filings, adjudicable: true, now: NOW + 2 * 3_600_000 }));
  assert.ok(!rulingDue({ lane: true, filings, adjudicable: false, now: NOW }), "only once PayPal offers adjudicate");
  assert.ok(!rulingDue({ lane: true, filings: [...filings, { action: "ruling", at: "x", ok: true }], adjudicable: true, now: NOW }));
  assert.ok(!rulingDue({ lane: true, filings: [], adjudicable: true, now: NOW }), "nothing filed, nothing to rule on");
});

test("lane cases never count as pool stock, and the lane rotates through the stories", () => {
  const rec: CaseRecord = { disputeId: "PP-R-AAA-1", openedAt: "2026-10-30T00:00:00Z", filings: [], lane: "autopilot" };
  assert.ok(!untouched(rec));
  assert.ok(!inPool(rec));
  assert.ok(inPool({ ...rec, lane: undefined }));
  const days = Array.from({ length: 7 }, (_, i) => laneStoryFor(NOW + i * 86_400_000));
  assert.equal(new Set(days).size, 7);
});

test("webhook routing: CREATED argues, any later dispute event reads the case back, others are ignored", () => {
  assert.equal(routeFor("CUSTOMER.DISPUTE.CREATED"), "argue");
  assert.equal(routeFor("CUSTOMER.DISPUTE.UPDATED"), "refresh");
  assert.equal(routeFor("CUSTOMER.DISPUTE.RESOLVED"), "refresh");
  assert.equal(routeFor("PAYMENT.CAPTURE.COMPLETED"), "ignore");
});

test("time since the webhook, in words", () => {
  const t = "2026-10-30T12:00:00Z";
  assert.equal(sinceWords(t, "2026-10-30T12:00:41Z"), "41 s");
  assert.equal(sinceWords(t, "2026-10-30T12:52:00Z"), "52 min");
  assert.equal(sinceWords(t, "2026-10-30T15:05:00Z"), "3 h 5 min");
});
