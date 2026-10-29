import { test } from "node:test";
import assert from "node:assert/strict";
import { daysMissed, daysToDue, daysUntil, missedWords } from "../lib/format.ts";

const NOW = Date.parse("2026-10-25T12:00:00Z");

test("days left counts down to the deadline and goes negative once it has passed", () => {
  assert.equal(daysUntil("2026-10-30T12:00:00Z", NOW), 5);
  assert.equal(daysUntil("2026-10-25T18:00:00Z", NOW), 1); // later today still counts as a day left
  assert.equal(daysUntil("2026-10-25T12:00:00Z", NOW), 0);
  assert.equal(daysUntil("2026-10-15T12:00:00Z", NOW), -10);
  assert.equal(daysUntil(undefined, NOW), null);
});

test("one count of missed days for every page: whole days since the deadline, at least one", () => {
  const DAY = 86_400_000;
  // PCS: due 19 Oct 03:59 UTC, read on 30 Oct 12:00 UTC is 11 days and 8 hours late.
  const now = Date.parse("2026-10-30T12:00:00Z");
  assert.equal(daysMissed("2026-10-19T03:59:59.000Z", now), 11);
  assert.equal(daysToDue("2026-10-19T03:59:59.000Z", now), -11);
  assert.equal(daysMissed("2026-10-16T03:59:59.000Z", now), 14);
  // An hour late is "a day ago", never "today"; not yet due is null.
  assert.equal(daysMissed(new Date(now - 3600_000).toISOString(), now), 1);
  assert.equal(daysMissed(new Date(now + 3600_000).toISOString(), now), null);
  assert.equal(daysMissed(null, now), null);
  // Ahead: under a day is 0 ("today"), otherwise counted up.
  assert.equal(daysToDue(new Date(now + 5 * 3600_000).toISOString(), now), 0);
  assert.equal(daysToDue(new Date(now + 2.5 * DAY).toISOString(), now), 3);
  assert.equal(missedWords(1), "a day ago");
  assert.equal(missedWords(11), "11 days ago");
});
