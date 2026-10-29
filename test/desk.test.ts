import { test } from "node:test";
import assert from "node:assert/strict";
import { arrange, callCell, callWords, groupKey, lateWord, matchesQuick, stakeByDay, type GroupHead } from "../components/desk/rows.ts";
import { deskCounts, deskTotals } from "../lib/desk-counts.ts";
import { briefCounts, quoteExhibit, sentenceState, stateLine } from "../lib/cases/sentence-state.ts";
import { showcaseRank } from "../lib/showcase-rank.ts";
import type { DeskRow } from "../lib/desk.ts";
import type { Exhibit } from "../lib/cases/types.ts";

const NOW = Date.parse("2026-10-30T12:00:00Z");

const row = (id: string, extra: Partial<DeskRow> = {}): DeskRow => ({
  id,
  reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
  amount: 100,
  currency: "USD",
  status: "UNDER_REVIEW",
  stage: "CHARGEBACK",
  where: "filed",
  whereLine: "",
  decidedBy: null,
  due: null,
  opened: "2026-10-29T10:00:00.000Z",
  updated: "2026-10-29T10:00:00.000Z",
  buyer: "Ada Park",
  story: "Delivered, signed for",
  storyId: "delivered",
  tag: null,
  recommendation: "fight",
  odds: 90,
  engine: "model",
  struck: 0,
  withdrawn: 0,
  checks: 3,
  sentences: 4,
  conceded: false,
  late: false,
  filed: "Filed the response (4 sentences)",
  filedAt: "2026-10-29T11:00:00.000Z",
  outcome: null,
  mine: false,
  pooled: false,
  retired: false,
  source: "exhibit",
  ...extra,
});

test("one count for the home page and the desk: the same rows give the same figures", () => {
  const rows = [
    row("WON1", { where: "won", decidedBy: "requested", status: "RESOLVED" }),
    row("WON2", { where: "won", decidedBy: "sandbox", status: "RESOLVED", sentences: null, struck: null, withdrawn: null }),
    row("REF", { where: "refunded", decidedBy: "seller", filed: "Accepted the claim; PayPal refunds $100.00 to the buyer" }),
    row("LIVE", { where: "waiting", status: "WAITING_FOR_SELLER_RESPONSE", due: "2026-11-05T00:00:00Z", filed: null, struck: 1, withdrawn: 1 }),
    row("MISS", { where: "lapsed", status: "WAITING_FOR_SELLER_RESPONSE", due: "2026-10-16T00:00:00Z", filed: null }),
    row("POOL", { where: "waiting", pooled: true }),
    row("PROBE", { where: "won", source: "probe" }),
  ];
  const t = deskTotals(rows);
  const c = deskCounts(rows);
  // The strip's counts are the totals' counts.
  for (const k of Object.keys(c) as (keyof typeof c)[]) assert.equal(t[k], c[k], k);
  assert.equal(t.won, 2, "a win with no brief on record still counts, on both pages");
  assert.equal(t.wonAsked, 1);
  assert.equal(t.refunded, 1);
  assert.equal(t.cases, 5);
  assert.equal(t.argued, 4);
  assert.equal(t.struck, 1);
  assert.equal(t.withdrawn, 1);
  // A missed deadline is not money in play; pool stock and probes are not the shop's.
  assert.equal(t.atStake, 100);
  assert.equal(t.filed, 1 + 1, "WON1 and WON2 hold a filed response; the refund is counted as refunded");
});

test("the desk's call follows a concession at the hearing on PayPal's copy (JWB)", () => {
  const jwb = { where: "filed" as const, recommendation: "accept" as const, odds: null, decidedBy: null, conceded: true };
  assert.deepEqual(callCell(jwb), { call: "Refund", balance: null, note: "conceded at the hearing" });
  assert.equal(callWords(jwb), "Refund; conceded at the hearing");
  // Once PayPal decides, who decided is said instead.
  assert.equal(callWords({ ...jwb, where: "lost", decidedBy: "requested" }), "Refund; ruled at Exhibit's request");
  assert.equal(lateWord({ where: "refunded", late: true }), "Refunded late");
  assert.equal(lateWord({ where: "refunded", late: false }), null);
});

test("grouping keeps each group under its header and each opened brief under its case, in the sorted order", () => {
  const cases = [
    row("A", { where: "won", decidedBy: "sandbox", status: "RESOLVED", amount: 50 }),
    row("B", { where: "waiting", status: "WAITING_FOR_SELLER_RESPONSE", due: "2026-11-02T00:00:00Z" }),
    row("C", { where: "won", decidedBy: "requested", status: "RESOLVED", amount: 70 }),
    row("D", { where: "waiting", status: "WAITING_FOR_SELLER_RESPONSE", due: "2026-10-20T00:00:00Z" }),
  ];
  assert.equal(groupKey(cases[3], "stage", NOW), "missed");
  const flat = arrange(cases, "none", new Set(["C"]), NOW).map((r) => r.id);
  assert.deepEqual(flat, ["A", "B", "C", "detail:C", "D"]);
  const byStage = arrange(cases, "stage", new Set(["A"]), NOW);
  assert.deepEqual(
    byStage.map((r) => r.id),
    ["group:waiting", "B", "group:missed", "D", "group:won", "A", "detail:A", "C"],
  );
  const won = byStage.find((r) => r.id === "group:won") as GroupHead;
  assert.equal(won.count, 2);
  assert.equal(won.amount, 120);
  const byDecider = arrange(cases, "decided", new Set(), NOW).map((r) => r.id);
  assert.deepEqual(byDecider, ["group:undecided", "B", "D", "group:requested", "C", "group:sandbox", "A"]);
});

test("the sparkline: money opened per UTC day over two weeks, and the part still at stake", () => {
  const days = stakeByDay(
    [
      { opened: "2026-10-30T01:00:00Z", amount: 40, where: "waiting" },
      { opened: "2026-10-30T09:00:00Z", amount: 60, where: "won" },
      { opened: "2026-10-17T09:00:00Z", amount: 10, where: "filed" },
      { opened: "2026-10-01T09:00:00Z", amount: 999, where: "waiting" },
    ],
    NOW,
    14,
  );
  assert.equal(days.length, 14);
  assert.equal(days[0].day, "2026-10-17");
  assert.deepEqual(days.at(-1), { day: "2026-10-30", opened: 100, atStake: 40 });
  assert.deepEqual(days[0], { day: "2026-10-17", opened: 10, atStake: 10 });
  assert.equal(
    days.reduce((n, d) => n + d.opened, 0),
    110,
  );
});

test("the desk's quick filter reads what a row shows", () => {
  const r = row("PP-R-GQZ-10195194", { buyer: "Mara Lind", reason: "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED", story: "Greener than the photos" });
  const label = (x: string) => (x === "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED" ? "Not as described" : x);
  assert.ok(matchesQuick(r, "gqz", label));
  assert.ok(matchesQuick(r, "mara", label));
  assert.ok(matchesQuick(r, "not as desc", label));
  assert.ok(matchesQuick(r, "", label));
  assert.ok(!matchesQuick(r, "signed", label));
});

const EXHIBITS = [
  { id: "F", kind: "inbox", title: "Emails with the buyer", source: "Store", facts: [], lines: ["Seller: You're welcome to return them within 30 days for a refund."] },
  { id: "H", kind: "policy", title: "Store policy shown at checkout", source: "Store", facts: [], lines: ["Glaze colour and speckling vary from kiln to kiln."] },
] as Exhibit[];

test("a kept sentence whose quote matched its exhibit says so; one with nothing to match stays unverified", () => {
  // GQZ's brief, as saved: one withdrawn at the hearing, one checked, three quote-matched.
  const sentences = [
    { kept: false, cites: ["G"], quote: "colour shifts", why: "Withdrawn at the hearing after objection 1: Where do the pages disclose it?" },
    { kept: true, cites: ["F"], quote: "The bowls arrived safely", checked: [], unverified: true as const },
    { kept: true, cites: ["F"], quote: "You're welcome to return them", checked: ["30"] },
    { kept: true, cites: ["H"], quote: "Glaze colour and speckling vary", checked: [], unverified: true as const },
    { kept: true, cites: ["J"], checked: [], unverified: true as const },
    { kept: false, cites: ["B"], why: "$30 isn't in Exhibit B." },
  ];
  const kinds = sentences.map((s) => sentenceState(s, EXHIBITS).kind);
  assert.deepEqual(kinds, ["withdrawn", "quoted", "checked", "quoted", "unverified", "struck"]);
  assert.equal(stateLine(sentences[1], sentenceState(sentences[1], EXHIBITS)), "Quote matched in Exhibit F");
  assert.match(stateLine(sentences[0], sentenceState(sentences[0]))!, /^Withdrawn at the hearing before filing, after objection 1: /);
  assert.match(stateLine(sentences[4], sentenceState(sentences[4]))!, /^Unverified: no figure or name/);
  assert.deepEqual(briefCounts(sentences), { kept: 4, struck: 1, withdrawn: 1, checked: 3, quoted: 2, unverified: 1 });
  // Two cites: the exhibit that holds the words is named.
  assert.equal(quoteExhibit("speckling vary from kiln", ["F", "H"], EXHIBITS), "H");
  assert.equal(quoteExhibit("nowhere", ["F", "H"], EXHIBITS), undefined);
});

test("within a tier, the hero whose brief the checker matched more of wins; tiers keep their order", () => {
  const asked = [
    { action: "evidence" as const, at: "2026-10-29T20:57:00Z" },
    { action: "ruling" as const, at: "2026-10-29T21:09:00Z", summary: "Ruled by the simulated reviewer: the listing disclosed it" },
  ];
  const more = showcaseRank({ where: "won", decidedBy: "requested", filings: asked, checks: 4 });
  const fewer = showcaseRank({ where: "won", decidedBy: "requested", filings: asked, checks: 1, scenarioId: "delivered", engine: "model" });
  assert.ok(more > fewer);
  // A win the sandbox closed on its own never outranks a requested one, however much was checked.
  const byItself = showcaseRank({ where: "won", decidedBy: "sandbox", filings: [asked[0]], checks: 99, scenarioId: "delivered", engine: "model" });
  assert.ok(fewer > byItself);
});
