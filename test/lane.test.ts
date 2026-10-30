import { test } from "node:test";
import assert from "node:assert/strict";
import { laneRow, laneSummary, median, type LaneCaseIn } from "../lib/cases/lane-stats.ts";
import { atWinRate } from "../lib/eval/per100.ts";

const HOOK = "2026-10-29T20:00:00.000Z";
const at = (s: number) => new Date(Date.parse(HOOK) + s * 1000).toISOString();
const lane = (extra: Partial<LaneCaseIn> = {}): LaneCaseIn => ({
  id: "PP-R-AAA-1",
  reason: "UNAUTHORISED",
  status: "UNDER_REVIEW",
  where: "filed",
  webhook: { receivedAt: HOOK, arguedAt: at(9) },
  plan: { action: "evidence", rule: 2, decidedAt: at(120), done: { at: at(900) } },
  filings: [
    { at: at(900), action: "evidence", ok: true, by: "autopilot" },
    { at: at(1800), action: "ruling", ok: true, by: "sandbox", detail: "Asked the sandbox to rule for the seller, by the autopilot under house rule 5" },
  ],
  ...extra,
});

test("lane: a case the autopilot filed and asked a ruling on took no human step", () => {
  const r = laneRow(lane());
  assert.equal(r.decided, "file");
  assert.equal(r.toArguedS, 9);
  assert.equal(r.toDecidedS, 120);
  assert.deepEqual(r.sent, { what: "filed", by: "autopilot", at: at(900), afterS: 900 });
  assert.deepEqual(r.humanSteps, []);
});

test("lane: a seller's filing after the autopilot left the case is one human step; a hand-asked ruling is another", () => {
  const left = laneRow(lane({ plan: { action: "queue", rule: 3, decidedAt: at(120) }, filings: [{ at: at(360), action: "evidence", ok: true, by: "seller" }] }));
  assert.equal(left.decided, "left for the seller");
  assert.deepEqual(left.sent, { what: "filed", by: "seller", at: at(360), afterS: 360 });
  assert.deepEqual(left.humanSteps, ["filed by the seller"]);
  const asked = laneRow(lane({ filings: [{ at: at(900), action: "evidence", ok: true, by: "autopilot" }, { at: at(1000), action: "ruling", ok: true, by: "sandbox", detail: "Asked the sandbox to rule for the seller" }] }));
  assert.deepEqual(asked.humanSteps, ["ruling asked for by hand"]);
});

test("lane: a failed filing and an undo", () => {
  const r = laneRow(lane({ plan: { action: "accept", rule: 1, decidedAt: at(60), undone: { at: at(300) } }, filings: [{ at: at(200), action: "accept", ok: false, by: "autopilot" }] }));
  assert.equal(r.sent, null);
  assert.deepEqual(r.humanSteps, ["stopped in the undo window"]);
});

test("lane: the summary's medians and counts", () => {
  const rows = [
    laneRow(lane()),
    laneRow(lane({ id: "b", plan: { action: "accept", rule: 1, decidedAt: at(60), done: { at: at(700) } }, filings: [{ at: at(700), action: "accept", ok: true, by: "autopilot" }] })),
    laneRow(lane({ id: "c", plan: { action: "queue", rule: 3, decidedAt: at(240) }, filings: [{ at: at(3600), action: "evidence", ok: true, by: "seller" }] })),
  ];
  const s = laneSummary(rows);
  assert.equal(s.cases, 3);
  assert.equal(s.zeroHuman, 2);
  assert.equal(s.oneHuman, 1);
  assert.equal(s.medianToArguedS, 9);
  assert.equal(s.medianToDecidedMin, 2);
  assert.equal(s.filed, 2);
  assert.equal(s.medianToFiledMin, 37.5); // 15 min and 60 min
  assert.equal(s.medianToFiledByAutopilotMin, 15);
  assert.equal(s.refunded, 1);
  assert.equal(s.medianToRefundedMin, 11.7);
});

test("median", () => {
  assert.equal(median([]), null);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
});

test("per 100 at a stated win rate: kept scales with the rate, the fee does not", () => {
  // $4,743 kept per 100 when every correct fight is won, $2,000 in fees per 100.
  assert.deepEqual(atWinRate({ keptRaw: 4743, n: 100, fees: 2000 }, 0.3), { rate: 0.3, keptUsd: 1423, netUsd: -577 });
  assert.deepEqual(atWinRate({ keptRaw: 2656, n: 56, fees: 1120 }, 0.5), { rate: 0.5, keptUsd: 2371, netUsd: 371 });
  assert.deepEqual(atWinRate({ keptRaw: 0, n: 56, fees: 1120 }, 0.5), { rate: 0.5, keptUsd: 0, netUsd: -2000 });
});
