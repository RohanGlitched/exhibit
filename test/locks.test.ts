import { test } from "node:test";
import assert from "node:assert/strict";
import { PITCH_CASES, lockedCases, publicWriteBlocked, shopRequest } from "../lib/cases/locks.ts";

test("the cases the pitch points to are read-only for public and MCP writes; a visitor's own case is not", () => {
  const locked = lockedCases("PP-R-NEW-1", undefined);
  for (const id of PITCH_CASES) assert.ok(publicWriteBlocked(id, null, "file", locked), id);
  assert.ok(publicWriteBlocked("PP-R-NEW-1", null, "file", locked), "an id added through EXHIBIT_LOCKED_CASES");
  assert.match(publicWriteBlocked("PP-R-HWG-10195220", null, "hearing", locked)!, /re-heard/);
  assert.equal(publicWriteBlocked("PP-R-ABC-10199999", { lane: undefined }, "file", locked), null);
});

test("the seller's lane is the autopilot's: public writes are refused there too", () => {
  assert.match(publicWriteBlocked("PP-R-EBA-10195233", { lane: "autopilot" }, "file", new Set())!, /seller's lane/);
  assert.match(publicWriteBlocked("PP-R-EBA-10195233", { lane: "autopilot" }, "argue", new Set())!, /re-argued/);
});

test("the shop's own calls carry the cron secret; nothing else counts as one", () => {
  const req = (h?: string) => new Request("https://x.test/", { method: "POST", headers: h ? { authorization: h } : {} });
  assert.equal(shopRequest(req("Bearer s3cret"), "s3cret"), true);
  assert.equal(shopRequest(req("Bearer nope"), "s3cret"), false);
  assert.equal(shopRequest(req(), "s3cret"), false);
  assert.equal(shopRequest(req("Bearer undefined"), undefined), false);
});
