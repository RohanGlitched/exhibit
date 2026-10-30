import { test } from "node:test";
import assert from "node:assert/strict";
import { knownCases, ladderCrossFilter, ladderSelection, replayIds } from "../components/studio/ladder-filter.ts";
import { LADDER_THREAD } from "../components/studio/saved-ladder.ts";
import { LADDER_THREAD_ID, SAVED_THREAD_ID, seededHistory } from "../components/studio/history.ts";

test("filter_ladder writes the ladder's selection into the page's cross-filter, keeping other widgets'", () => {
  const other = { "stake-by-reason": [{ type: "value" as const, group: 0, field: { id: "cases.reason" }, values: ["Unauthorised"] }] };
  const on = ladderCrossFilter({ values: other }, ["PP-R-DIX-10194390", "PP-R-VXA-10194375"]);
  assert.deepEqual(on.values?.ladder, [{ type: "value", group: 0, field: { id: "cases.caseId" }, values: ["PP-R-DIX-10194390", "PP-R-VXA-10194375"] }]);
  assert.deepEqual(on.values?.["stake-by-reason"], other["stake-by-reason"]);
  assert.deepEqual(ladderSelection(on), ["PP-R-DIX-10194390", "PP-R-VXA-10194375"]);
  const off = ladderCrossFilter(on, []);
  assert.equal(off.values?.ladder, undefined);
  assert.deepEqual(ladderSelection(off), []);
  assert.deepEqual(ladderSelection(undefined), []);
});

test("only case ids the desk holds are filtered or opened", () => {
  const desk = [{ caseId: "PP-R-DIX-10194390" }, { caseId: "PP-R-VXA-10194375" }];
  assert.deepEqual(knownCases([" pp-r-dix-10194390", "PP-R-DIX-10194390", "PP-R-NOPE-1"], desk), { kept: ["PP-R-DIX-10194390"], unknown: ["PP-R-NOPE-1"] });
  assert.deepEqual(knownCases([], desk), { kept: [], unknown: [] });
});

test("the recorded ladder run: it filtered and opened through the analyst's own tools, and replays only live cases", () => {
  const calls = LADDER_THREAD.messages.flatMap((m) => m.parts).filter((p) => p.type === "tool_call").map((p) => (p as { toolCall: { name: string } }).toolCall.name);
  assert.ok(calls.includes("deadline_ladder"));
  assert.ok(calls.includes("filter_ladder"));
  assert.ok(calls.includes("open_case"));
  const desk = [
    { caseId: "PP-R-DIX-10194390", daysLeft: 2 },
    { caseId: "PP-R-VXA-10194375", daysLeft: null }, // answered since: off the ladder
  ];
  assert.deepEqual(replayIds(LADDER_THREAD.messages as never, desk), ["PP-R-DIX-10194390"]);
  assert.deepEqual(replayIds(LADDER_THREAD.messages as never, []), []);
});

test("the analyst's panel holds both recordings; the Money one opens first, and opening a saved one is heard", async () => {
  const heard: string[] = [];
  const h = seededHistory((id) => heard.push(id));
  const list = await h.listThreads();
  assert.deepEqual(list.map((t) => t.threadId), [LADDER_THREAD_ID, SAVED_THREAD_ID]);
  assert.ok((await h.loadThread(LADDER_THREAD_ID))?.messages.length);
  assert.deepEqual(heard, [LADDER_THREAD_ID]);
  await h.saveThread({ summary: { threadId: "t1", agentId: "exhibit-analyst", title: "x", updatedAt: 5 }, messages: [] });
  await h.loadThread("t1");
  assert.deepEqual(heard, [LADDER_THREAD_ID], "a visitor's own conversation is not a recording");
});
