import { test } from "node:test";
import assert from "node:assert/strict";
import { draftHearingsNote, hearingTabs, outcomeMoney, pressedNote, priorPaymentsNote, readTimes, readsDiffer } from "../lib/cases/case-page.ts";
import { hearingAnchor } from "../lib/cases/hearing-log.ts";
import { struckWords } from "../lib/cases/house-audit.ts";
import { SHOWCASE_ID, pickShowcase } from "../lib/showcase-rank.ts";
import type { Hearing } from "../lib/cases/hearing.ts";

const h = (at: string, source: Hearing["source"]) => ({ at, source });

test("GQZ: the tab the ruling request followed opens first; the re-hearing after the ruling goes last, labelled", () => {
  // PP-R-GQZ-10195194: heard on PayPal's copy at 21:09, ruling asked 21:09:44, re-heard (for the buyer) at 22:53.
  const hearings = [h("2026-10-29T21:09:36.000Z", "paypal"), h("2026-10-29T22:53:03.393Z", "paypal")];
  const { tabs, open } = hearingTabs({ hearings, rulingAt: "2026-10-29T21:09:44.481Z", resolved: true });
  assert.equal(open, "2026-10-29T21:09:36.000Z");
  assert.deepEqual(
    tabs.map((t) => t.label),
    ["On the PDF PayPal holds", "Heard again after the ruling"],
  );
  assert.equal(tabs[1].afterRuling, true);
  // Still under review: the words say it was the request, not a ruling.
  assert.equal(hearingTabs({ hearings, rulingAt: "2026-10-29T21:09:44.481Z", resolved: false }).tabs[1].label, "Heard again after the ruling request");
});

test("with no ruling asked, the newest hearing opens first, as before", () => {
  const hearings = [h("2026-10-29T23:25:54.552Z", "draft"), h("2026-10-29T23:34:20.189Z", "paypal")];
  const { tabs, open } = hearingTabs({ hearings });
  assert.equal(open, "2026-10-29T23:34:20.189Z");
  assert.deepEqual(tabs.map((t) => t.label), ["On the PDF PayPal holds", "On the draft"]);
  assert.equal(hearingTabs({ hearings: [] }).open, null);
});

test("BFL: two hearings on the draft, one the autopilot's audit rests on, one heard again", () => {
  const first = h("2026-10-29T23:00:14.747Z", "draft");
  const again = h("2026-10-29T23:03:06.215Z", "draft");
  const pdf = h("2026-10-29T23:32:34.626Z", "paypal");
  const input = { hearings: [first, again, pdf], rulingAt: "2026-10-29T23:32:47.132Z", resolved: false, linked: [hearingAnchor(first), hearingAnchor(pdf)] };
  const { tabs, open } = hearingTabs(input);
  assert.equal(open, pdf.at);
  assert.deepEqual(tabs.map((t) => t.label), ["On the PDF PayPal holds", "Heard again on the draft", "On the draft"]);
  const note = draftHearingsNote(input)!;
  assert.match(note, /heard 2 times on the draft/);
  assert.match(note, /rests on the hearing at 23:00 UTC/);
  assert.match(note, /heard again on the draft at 23:03 UTC, not by the autopilot/);
  // One draft hearing: nothing to explain.
  assert.equal(draftHearingsNote({ hearings: [first, pdf], linked: [hearingAnchor(first)] }), null);
  // Nothing links them: said neutrally, with no claim about who asked.
  const neutral = draftHearingsNote({ hearings: [first, again] })!;
  assert.match(neutral, /first at 23:00 UTC, then again at 23:03 UTC/);
  assert.doesNotMatch(neutral, /autopilot/);
});

test("a card-pressed objection is marked, and says when the reviewer raised none of its own", () => {
  const card = { pressed: true as const };
  const own = {};
  assert.equal(pressedNote(own, [{ objection: own }]), null);
  // OHE: the only objection is the card's template.
  assert.equal(pressedNote(card, [{ objection: card }]), "Put to proof from the requirements card; the reviewer raised no objection of its own.");
  assert.equal(pressedNote(card, [{ objection: card }, { objection: own }]), "Put to proof from the requirements card, not raised by the reviewer.");
});

test("toolkit reads carry their time, and older ones sit in the drafting window", () => {
  const read = { tool: "get_dispute", args: {}, ms: 1148, ok: true, summary: "UNDER_REVIEW, CHARGEBACK, $180.00" };
  const brief = { createdAt: "2026-10-29T22:57:20.810Z", ms: 9_000 };
  const old = readTimes([read], brief);
  assert.deepEqual(old.each, [null]);
  assert.equal(old.window, "29 Oct 2026, between 22:57:11 and 22:57:20 UTC, while the brief was drafted");
  const fresh = readTimes([{ ...read, at: "2026-10-31T10:00:01.500Z" }], brief);
  assert.deepEqual(fresh.each, ["10:00:01 UTC"]);
  assert.equal(fresh.window, null);
});

test("BFL: the drafter's UNDER_REVIEW and the autopilot's later 'waiting for seller response' are explained", () => {
  const read = { tool: "get_dispute", args: {}, ms: 1148, ok: true, summary: "UNDER_REVIEW, CHARGEBACK, $180.00" };
  const note = readsDiffer([read], { createdAt: "2026-10-29T22:57:20.810Z" }, { at: "2026-10-29T23:00:11.644Z", status: "WAITING_FOR_SELLER_RESPONSE" })!;
  assert.match(note, /read under review, before PayPal handed the case to the seller/);
  assert.match(note, /again at 23:00 UTC, when PayPal showed it waiting for seller response/);
  assert.equal(readsDiffer([read], { createdAt: "2026-10-29T22:57:20.810Z" }, { at: "2026-10-29T23:00:11.644Z", status: "UNDER_REVIEW" }), null);
  assert.equal(readsDiffer([read], { createdAt: "2026-10-29T22:57:20.810Z" }, null), null);
});

test("OHE: the outcome line and the ledger say the same money, fee included", () => {
  const won = outcomeMoney("won", 46, true)!;
  assert.equal(won.net, 26);
  assert.equal(won.line, "won, the seller keeps the $46.00; $26.00 after PayPal's $20.00 fee, charged either way");
  assert.equal(outcomeMoney("lost", 46, true)!.net, -20);
  assert.equal(outcomeMoney("refunded", 46, false)!.net, -15);
  assert.equal(outcomeMoney("filed", 46, true), null);
});

test("OHE: 'Nothing struck' becomes 'nothing left struck' when the checker repaired a sentence", () => {
  const reason = "Nothing struck, the hearing on the draft ended for the seller, and the deadline is more than 48 hours away.";
  assert.equal(struckWords(reason, 0), reason);
  assert.match(struckWords(reason, 1), /^Nothing left struck \(1 sentence repaired: struck as first written, kept once rewritten from the record\), the hearing/);
  assert.match(struckWords(reason, 2), /2 sentences repaired/);
});

test("BFL: the re-created earlier orders are disclosed with their store ages and capture ids", () => {
  const exhibits = [
    { id: "L", kind: "history" as const, lines: ["#1031, 211 days ago: Mug, $40.00. Delivered, never disputed.", "#1077, 146 days ago: Plate, $52.00. Delivered, never disputed."] },
  ];
  const note = priorPaymentsNote(
    [
      { ref: "#1031", captureId: "98G26150E1354900K", at: "2026-10-29T22:53:20.000Z" },
      { ref: "#1077", captureId: "10U84625FJ391084A", at: "2026-10-29T22:53:25.000Z" },
    ],
    exhibits,
  )!;
  assert.match(note, /^The 2 earlier orders in Exhibit L were re-created as sandbox card payments on 29 Oct 2026, the day this case was opened/);
  assert.match(note, /#1031 \(211 days old in the store's log\), capture 98G26150E1354900K and #1077 \(146 days old/);
  assert.match(note, /Their ages come from the store's checkout log, not from PayPal/);
  assert.equal(priorPaymentsNote(null, exhibits), null);
  assert.equal(priorPaymentsNote([], exhibits), null);
});

test("the hero is pinned to the flagship while it is won at Exhibit's request, else the ranking picks", () => {
  assert.equal(SHOWCASE_ID, "PP-R-HWG-10195220");
  const top = { id: "PP-R-OHE-10195198", where: "won" as const, decidedBy: "requested" as const };
  const flag = { id: SHOWCASE_ID, where: "won" as const, decidedBy: "requested" as const };
  assert.equal(pickShowcase([top, flag])?.id, SHOWCASE_ID);
  assert.equal(pickShowcase([top, { ...flag, decidedBy: "sandbox" as const }])?.id, top.id);
  assert.equal(pickShowcase([top, { ...flag, where: "filed" as const }])?.id, top.id);
  assert.equal(pickShowcase([top], "PP-R-XXX-1")?.id, top.id);
  assert.equal(pickShowcase([top, flag], "")?.id, top.id);
  assert.equal(pickShowcase([]), null);
});
