import { test } from "node:test";
import assert from "node:assert/strict";
import { HEARINGS_KEPT, draftHearingFor, hearingAnchor, hearingsOf, latestOn, withHearing } from "../lib/cases/hearing-log.ts";
import { houseAudit, rulingSide } from "../lib/cases/house-audit.ts";
import { refundedLate, stageLine } from "../lib/cases/derive.ts";
import { utcDay, utcShortDay, utcTime } from "../lib/format.ts";
import { HOUSE_RULES, type HousePlan } from "../lib/cases/autopilot.ts";
import type { Hearing } from "../lib/cases/hearing.ts";

const h = (at: string, source: Hearing["source"], side: "seller" | "buyer" = "seller", overruled = 0) =>
  ({
    at,
    source,
    mode: "cross",
    pages: [],
    response: [],
    exchanges: Array.from({ length: overruled }, () => ({ ruling: "overruled" })),
    call: "fight",
    after: side === "seller" ? "fight" : "accept",
    withdrawn: [],
    flipped: false,
    verdict: { side, reason: "r", by: "reviewer" },
    agrees: side === "seller",
    engine: "model",
    ms: 1,
    calls: 1,
  }) as unknown as Hearing;

test("every hearing is kept: an old record's single hearing is read, a new one is added beside it", () => {
  const draft = h("2026-10-30T10:00:00.000Z", "draft", "seller", 1);
  const pdf = h("2026-10-30T10:30:00.000Z", "paypal");
  assert.deepEqual(hearingsOf({ hearing: draft }).map((x) => x.at), [draft.at]);
  const r = withHearing({ hearing: draft }, pdf);
  assert.equal(r.hearing.at, pdf.at, "hearing stays the latest, for older readers");
  assert.deepEqual(r.hearings.map((x) => x.source), ["draft", "paypal"]);
  // The same hearing saved twice is kept once.
  assert.equal(hearingsOf({ ...r, hearing: pdf }).length, 2);
  assert.equal(latestOn(r.hearings, "draft")?.at, draft.at);
  assert.equal(latestOn(r.hearings, "paypal", "2026-10-30T10:10:00.000Z"), null);
  assert.equal(hearingAnchor(draft), "hearing-20261030T100000");
  assert.equal(draftHearingFor(r.hearings, "2026-10-30T10:00:20.000Z")?.at, draft.at);
});

test("over the cap, re-runs on PayPal's copy go before the draft hearing", () => {
  let r: { hearing?: Hearing; hearings?: Hearing[] } = { hearing: h("2026-10-30T09:00:00.000Z", "draft") };
  for (let i = 0; i < HEARINGS_KEPT + 2; i++) r = withHearing(r, h(`2026-10-30T1${i}:00:00.000Z`, "paypal"));
  const list = hearingsOf(r);
  assert.equal(list.length, HEARINGS_KEPT);
  assert.equal(list[0].source, "draft");
  assert.equal(list.at(-1)!.at, `2026-10-30T1${HEARINGS_KEPT + 1}:00:00.000Z`);
});

const GQZ_PLAN: HousePlan = {
  rules: "v1, 30 Oct 2026",
  action: "evidence",
  rule: 2,
  reason: "Nothing struck, the hearing on the draft ended for the seller, and the deadline is more than 48 hours away.",
  decidedAt: "2026-10-29T20:40:49.769Z",
  sendAfter: "2026-10-29T20:50:49.769Z",
  hearing: { side: "seller", objections: 2, overruled: 1, sustained: 1, engine: "model" },
  read: { at: "2026-10-29T20:40:37.461Z", status: "WAITING_FOR_SELLER_RESPONSE", due: "2026-11-09T04:59:59.000Z", tracking: "USPS 9405511206213825904898, shipped" },
  done: { at: "2026-10-29T20:57:12.166Z", summary: "Filed the response (4 sentences) and 10 exhibits as item description" },
};
const GQZ_RULING = {
  at: "2026-10-29T21:09:44.481Z",
  action: "ruling" as const,
  ok: true,
  summary: "Ruled by the simulated reviewer: The listing disclosed blue-to-green glaze variation",
  detail: "Asked the sandbox to rule for the seller, by the autopilot under house rule 5",
};

test("GQZ: the draft hearing the PDF hearing overwrote says its transcript wasn't kept; the ruling links to PayPal's copy", () => {
  const pdf = h("2026-10-29T21:09:36.000Z", "paypal");
  const audit = houseAudit({
    rec: { autopilot: { eventId: "e", receivedAt: "2026-10-29T20:39:34.000Z", arguedAt: "2026-10-29T20:39:44.265Z", briefAt: "x", engine: "model" }, house: GQZ_PLAN, events: [] },
    filings: [{ at: "2026-10-29T20:57:12.166Z", action: "evidence", ok: true, summary: "Filed" }, GQZ_RULING],
    hearings: [pdf],
    status: "RESOLVED",
    adjudicable: false,
  });
  const heard = audit.find((a) => a.text.startsWith("Heard on the draft"))!;
  assert.equal(heard.hearing, undefined);
  assert.equal(heard.missing, "transcript not kept (recorded before 30 Oct)");
  const ruling = audit.find((a) => a.text.startsWith("Ruling asked for"))!;
  assert.equal(ruling.hearing, hearingAnchor(pdf));
  assert.match(ruling.text, /under house rule 5: Ruled by the simulated reviewer/);
  // The toolkit read gives PayPal's deadline in UTC.
  assert.match(audit.find((a) => a.text.startsWith("Read through"))!.text, /due 9 Nov 2026, 04:59 UTC/);
  // With the draft hearing kept, the line links to it instead.
  const draft = h("2026-10-29T20:40:40.000Z", "draft", "seller", 1);
  const kept = houseAudit({ rec: { house: GQZ_PLAN }, filings: [], hearings: [draft, pdf], status: "RESOLVED", adjudicable: false });
  assert.equal(kept.find((a) => a.text.startsWith("Heard on the draft"))!.hearing, hearingAnchor(draft));
});

test("JWB: a ruling PayPal took but never made is said as asked and pending, not as ruled", () => {
  const jwb = {
    at: "2026-10-29T20:14:21.219Z",
    action: "ruling" as const,
    ok: true,
    summary: "Ruled by the simulated reviewer: Exhibit conceded the case at the hearing: No 3-D Secure result",
    detail: "Asked the sandbox to rule for the buyer, by the autopilot under house rule 5",
  };
  assert.equal(rulingSide(jwb), "buyer");
  const audit = houseAudit({ rec: null, filings: [{ at: "2026-10-25T12:30:25.343Z", action: "evidence", ok: true, summary: "Filed" }, jwb], hearings: [], status: "UNDER_REVIEW", adjudicable: false });
  assert.equal(audit.length, 1);
  assert.match(audit[0].text, /for the buyer: .*PayPal took the request but hasn't ruled; the case is still under review$/);
});

test("a filed lane case PayPal hasn't opened for a ruling says what the autopilot will ask for", () => {
  const pdf = h("2026-10-30T11:00:00.000Z", "paypal", "buyer");
  const audit = houseAudit({
    rec: { house: { ...GQZ_PLAN, done: { at: "2026-10-30T10:00:00.000Z", summary: "Filed" } } },
    filings: [{ at: "2026-10-30T10:00:00.000Z", action: "evidence", ok: true, summary: "Filed" }],
    hearings: [pdf],
    status: "UNDER_REVIEW",
    adjudicable: false,
  });
  const will = audit.find((a) => a.text.startsWith("Will ask"))!;
  assert.match(will.text, /^Will ask for a ruling for the buyer once PayPal opens it \(house rule 5\)/);
  assert.equal(will.hearing, hearingAnchor(pdf));
  assert.ok(!audit.some((a) => a.text.startsWith("Ruling asked for")));
});

test("a refund after a missed deadline reads as one, from the filings and PayPal's due date", () => {
  const due = "2026-10-16T03:59:59.000Z";
  const late = [{ action: "accept" as const, at: "2026-10-30T12:00:00.000Z", ok: true }];
  assert.equal(refundedLate(late, due), true);
  assert.equal(refundedLate([{ action: "accept" as const, at: "2026-10-15T12:00:00.000Z", ok: true }], due), false);
  assert.equal(refundedLate(late, null), false);
  // Filed in time, then refunded later: not a missed deadline.
  assert.equal(refundedLate([{ action: "evidence" as const, at: "2026-10-15T00:00:00.000Z" }, ...late], due), false);
  const d = { status: "RESOLVED" as const, dispute_amount: { value: "48.00", currency_code: "USD" }, seller_response_due_date: due };
  assert.match(stageLine("refunded", d, late), /^Refunded after the deadline passed: nothing was filed in time/);
  assert.equal(stageLine("refunded", d, [{ action: "accept", at: "2026-10-15T12:00:00.000Z" }]), "Refunded: the seller accepted, $48.00 back to the buyer");
});

test("case pages give real events in UTC, and the house rules are dated on or before their first use", () => {
  // 20:57 UTC is 13:57 in Portland; the page says the UTC time, labelled.
  assert.equal(utcTime("2026-10-29T20:57:12.166Z"), "29 Oct 2026, 20:57 UTC");
  assert.equal(utcDay("2026-11-09T04:59:59.000Z"), "9 Nov 2026");
  assert.equal(utcShortDay("2026-11-09T04:59:59.000Z"), "9 Nov");
  const first = GQZ_PLAN.decidedAt.slice(0, 10);
  const dated = new Date(`${HOUSE_RULES.version.replace(/^v\d+, /, "")} UTC`).toISOString().slice(0, 10);
  assert.ok(dated <= first, `${HOUSE_RULES.version} is dated after its first use on ${first}`);
});
