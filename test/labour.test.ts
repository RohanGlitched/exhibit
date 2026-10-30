import { test } from "node:test";
import assert from "node:assert/strict";
import { LABOUR, breakEvenWinRate, labourFor, pct } from "../lib/labour.ts";

test("the seller's time is an assumption shown at 15, 30 and 60 minutes", () => {
  assert.deepEqual([...LABOUR.minutes], [15, 30, 60]);
  assert.deepEqual(labourFor(100, 30, 25), { hours: 50, usd: 1250 });
  assert.deepEqual(labourFor(44, 15, 25), { hours: 11, usd: 275 });
});

test("break-even win rate: the time cost over the amount, the fee cancelling out", () => {
  assert.equal(pct(breakEvenWinRate(136, 30, 25)), "9%");
  assert.equal(pct(breakEvenWinRate(27, 60, 25)), "93%");
  assert.equal(breakEvenWinRate(10, 60, 25), 1, "capped at 100%");
  assert.equal(breakEvenWinRate(0, 15), 1);
});
