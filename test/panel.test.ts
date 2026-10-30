import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { objectionOrigin, panelHearing, panelNeeds, panelWords, rulesHearing, rulingRequest, settle, tallyPanel, type Hearing } from "../lib/cases/hearing.ts";
import { HEARINGS_KEPT, hearingsOf, withHearing } from "../lib/cases/hearing-log.ts";
import type { Exhibit } from "../lib/cases/types.ts";

// PP-R-BFL-10195216, the agent showcase, as the live desk served it: exhibits B, I, L and the hearing on PayPal's copy.
const BFL = JSON.parse(readFileSync(new URL("./fixtures/bfl-paypal-hearing.json", import.meta.url), "utf8")) as { exhibits: Exhibit[]; hearing: Hearing };

test("BFL's verdict, resting on its struck objection 1, is no clean vote for the seller on a ruling panel", () => {
  const h = BFL.hearing;
  const s = settle({ call: "fight", response: h.response, objections: h.exchanges.map((e) => e.objection), answers: h.exchanges.map((e) => e.answer), rulings: [], verdict: { side: "seller", reason: h.verdict.reason }, reasked: true });
  const p = tallyPanel([{ ...h, verdict: s.verdict }]);
  assert.deepEqual([p.seller, p.buyer, p.flagged, p.majority], [0, 0, 1, null]);
  assert.equal(panelNeeds(p), 1);
});


const heard = (at: string, side: "seller" | "buyer", caveat?: string): Hearing => ({
  ...rulesHearing("fight", 80, true, [], "paypal"),
  engine: "model",
  mode: "cross",
  at,
  verdict: { side, reason: side === "seller" ? "Delivered to the order's ZIP" : "No delivery on file", by: "reviewer", ...(caveat ? { caveat } : {}) },
});

test("the panel: two agreeing hearings decide, a split needs a third, and a caveated seller verdict counts for neither side", () => {
  const two = tallyPanel([heard("2026-10-30T10:00:00.001Z", "seller"), heard("2026-10-30T10:00:00.000Z", "seller")]);
  assert.deepEqual({ ...two, hearings: two.hearings.length }, { seller: 2, buyer: 0, flagged: 0, heard: 2, majority: "seller", hearings: 2 });
  assert.equal(panelNeeds(two), 0);
  assert.equal(panelWords(two), "2 of 2 hearings for the seller");

  assert.equal(panelNeeds(tallyPanel([])), 2);
  assert.equal(panelNeeds(tallyPanel([heard("2026-10-30T10:00:00Z", "buyer")])), 1);
  const split = tallyPanel([heard("2026-10-30T10:00:00Z", "seller"), heard("2026-10-30T10:00:01Z", "buyer")]);
  assert.equal(split.majority, null);
  assert.equal(panelNeeds(split), 1);

  const hs = [heard("2026-10-30T10:00:00Z", "seller"), heard("2026-10-30T10:00:01Z", "buyer"), heard("2026-10-30T10:00:20Z", "buyer")];
  const three = tallyPanel(hs);
  assert.equal(three.majority, "buyer");
  assert.equal(panelWords(three), "2 of 3 hearings for the buyer");
  const followed = panelHearing(hs, three)!;
  assert.equal(followed.at, "2026-10-30T10:00:20Z"); // the latest of the majority's hearings
  assert.equal(followed.panel?.buyer, 2);
  assert.equal(rulingRequest(followed).summary, "Ruled by the simulated reviewer, 2 of 3 hearings for the buyer: No delivery on file");
  assert.equal(rulingRequest(followed).outcome, "BUYER_FAVOR");

  // BFL's case: for the seller, but resting on a sustained point. With one clean vote each way there is no majority.
  const flagged = tallyPanel([heard("2026-10-30T10:00:00Z", "seller", "It rests on objection 1"), heard("2026-10-30T10:00:01Z", "seller"), heard("2026-10-30T10:00:02Z", "buyer")]);
  assert.deepEqual([flagged.seller, flagged.buyer, flagged.flagged, flagged.majority], [1, 1, 1, null]);
  assert.equal(panelNeeds(flagged), 0);
  assert.equal(panelHearing([], flagged), null);
  assert.match(panelWords(flagged), /^no two of 3 hearings agree \(1 for the seller, 1 for the buyer, 1 for the seller on a sustained point\)$/);
  // A fourth hearing on the record isn't counted: the panel is the first three after the filing.
  assert.equal(tallyPanel([...hs, heard("2026-10-30T11:00:00Z", "seller"), heard("2026-10-30T11:00:01Z", "seller")]).majority, "buyer");
});

test("a ruling's three hearings are all kept on the case, beside the drafts, with the card-pressed flag", () => {
  const draft = (at: string): Hearing => ({ ...heard(at, "seller"), source: "draft" });
  let r: { hearing?: Hearing; hearings?: Hearing[] } = {};
  for (const at of ["2026-10-29T23:00:14Z", "2026-10-29T23:03:06Z"]) r = withHearing(r, draft(at));
  for (const at of ["2026-10-29T23:32:34Z", "2026-10-30T01:00:00Z", "2026-10-30T02:00:00Z", "2026-10-30T03:00:00Z"]) r = withHearing(r, heard(at, "seller"));
  const pressedHearing = { ...BFL.hearing, at: "2026-10-30T09:00:00.000Z" };
  for (const h of [pressedHearing, { ...heard("2026-10-30T09:00:00.001Z", "buyer") }, { ...heard("2026-10-30T09:00:12Z", "seller"), panel: tallyPanel([]) }]) r = withHearing(r, h);
  const kept = hearingsOf(r);
  assert.ok(kept.length <= HEARINGS_KEPT);
  for (const at of ["2026-10-29T23:00:14Z", "2026-10-29T23:03:06Z", "2026-10-30T09:00:00.000Z", "2026-10-30T09:00:00.001Z", "2026-10-30T09:00:12Z"])
    assert.ok(kept.some((h) => h.at === at), `${at} kept`);
  assert.ok(kept.at(-1)!.panel);
  // The card-pressed flag survives the save, and the case page can say whose objection it was.
  const saved = kept.find((h) => h.at === "2026-10-30T09:00:00.000Z")!;
  assert.equal(saved.exchanges[0].objection.pressed, true);
  assert.equal(saved.exchanges[1].objection.pressed, undefined);
  assert.equal(objectionOrigin(saved, saved.exchanges[0].objection), "Put to proof from the requirements card, on an item the reviewer left alone.");
  assert.equal(objectionOrigin(saved, saved.exchanges[1].objection), null);
  assert.equal(objectionOrigin({ exchanges: [saved.exchanges[0]] }, saved.exchanges[0].objection), "Put to proof from the requirements card; the reviewer raised no objection of its own.");
});
