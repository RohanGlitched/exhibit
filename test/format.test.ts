import { test } from "node:test";
import assert from "node:assert/strict";
import { daysUntil } from "../lib/format.ts";

const NOW = Date.parse("2026-10-25T12:00:00Z");

test("days left counts down to the deadline and goes negative once it has passed", () => {
  assert.equal(daysUntil("2026-10-30T12:00:00Z", NOW), 5);
  assert.equal(daysUntil("2026-10-25T18:00:00Z", NOW), 1); // later today still counts as a day left
  assert.equal(daysUntil("2026-10-25T12:00:00Z", NOW), 0);
  assert.equal(daysUntil("2026-10-15T12:00:00Z", NOW), -10);
  assert.equal(daysUntil(undefined, NOW), null);
});
