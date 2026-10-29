import { test } from "node:test";
import assert from "node:assert/strict";
import { decidedBy, followedReviewer, outcomeWords, rulingRequestOf, stageLine } from "../lib/cases/derive.ts";
import { callCell, callWords } from "../components/desk/rows.ts";
import { contested, heroRulingLine, showcaseRank } from "../lib/showcase-rank.ts";
import { splitDeadlines } from "../lib/health.ts";

const evidence = { action: "evidence" as const, at: "2026-10-15T09:01:52.019Z", ok: true, summary: "Filed the response (5 sentences)" };
const ruling = (at: string, summary = "Ruled by the simulated reviewer: signed delivery to the order's address") => ({ action: "ruling" as const, at, ok: true, summary });

test("a win is ruled at Exhibit's request only when Exhibit asked before PayPal resolved it", () => {
  // DCJ: asked 15 Oct 08:43, PayPal ruled 16 Oct 08:48.
  assert.equal(decidedBy("won", [evidence, ruling("2026-10-15T08:43:01.124Z")], "2026-10-16T08:48:03.713Z"), "requested");
  // JON: filed, never asked; the sandbox closed it on 16 Oct.
  assert.equal(decidedBy("won", [evidence], "2026-10-16T09:28:03.720Z"), "sandbox");
  // A request recorded after the resolution can't have decided it.
  assert.equal(decidedBy("lost", [evidence, ruling("2026-10-17T00:00:00.000Z")], "2026-10-16T14:52:53.425Z"), "sandbox");
  // A failed request doesn't count.
  assert.equal(decidedBy("won", [evidence, { ...ruling("2026-10-15T08:43:01.124Z"), ok: false }], "2026-10-16T08:48:03.713Z"), "sandbox");
  // Lost with nothing filed: the deadline decided it. A refund is the seller's own decision.
  assert.equal(decidedBy("lost", [], "2026-10-20T00:00:00.000Z"), "deadline");
  assert.equal(decidedBy("refunded", [{ action: "accept" }], null), "seller");
  assert.equal(decidedBy("filed", [evidence], null), null);
});

test("the ruling request says whether it followed the simulated reviewer", () => {
  assert.equal(followedReviewer(rulingRequestOf([evidence, ruling("2026-10-29T10:00:00.000Z")])), true);
  assert.equal(followedReviewer(rulingRequestOf([evidence, ruling("2026-10-15T08:43:01.124Z", "Asked the sandbox to rule for the seller, as the filed records support")])), false);
  assert.equal(followedReviewer(rulingRequestOf([evidence])), false);
});

test("the case line and the stamp say who decided, once", () => {
  const d = { status: "RESOLVED" as const, dispute_amount: { currency_code: "USD", value: "104.00" } };
  assert.match(stageLine("won", d, [evidence], "2026-10-16T09:28:03.720Z"), /sandbox closed it for the seller on its own/);
  assert.match(stageLine("lost", d, [evidence, ruling("2026-10-15T00:00:00.000Z")], "2026-10-16T00:00:00.000Z"), /^Lost: PayPal ruled for the buyer at Exhibit's request/);
  const jon = outcomeWords("won", "sandbox", "2026-10-16T09:28:03.720Z")!;
  assert.equal(jon.line, "Closed for the seller by the sandbox on its own, 16 Oct 2026; nobody asked it to rule");
  assert.equal(jon.stamp, "SANDBOX CLOSED 16 OCT");
  const dcj = outcomeWords("won", "requested", "2026-10-16T08:48:03.713Z")!;
  assert.equal(dcj.what, "PayPal ruled for the seller at Exhibit's request");
  assert.equal(dcj.stamp, "PAYPAL RULED 16 OCT");
  assert.equal(outcomeWords("filed", null, null), null);
});

test("the desk shows the evidence balance only while a case is open, and who decided once it isn't", () => {
  const open = { where: "filed" as const, recommendation: "fight" as const, odds: 93, decidedBy: null };
  assert.deepEqual(callCell(open), { call: "Fight", balance: 93, note: null });
  assert.equal(callWords(open), "Fight, evidence balance 93%");
  const lost = { where: "lost" as const, recommendation: "fight" as const, odds: 97, decidedBy: "sandbox" as const };
  assert.deepEqual(callCell(lost), { call: "Fight", balance: null, note: "sandbox closed it on its own" });
  assert.equal(callWords(lost), "Fight; sandbox closed it on its own");
  assert.ok(!/97/.test(callWords(lost)!));
  assert.equal(callWords({ where: "won", recommendation: "fight", odds: 97, decidedBy: "requested" }), "Fight; ruled at Exhibit's request");
  assert.equal(callWords({ where: "refunded", recommendation: "accept", odds: 20, decidedBy: "seller" }), "Refund");
  assert.equal(callWords({ where: "waiting", recommendation: null, odds: null, decidedBy: null }), null);
});

const exchange = (ruling: "sustained" | "overruled") => ({ ruling }) as never;

test("the hero prefers a requested win after a contested hearing, then any requested win, then the rest", () => {
  const filed = [evidence];
  const asked = [evidence, ruling("2026-10-29T10:05:00.000Z")];
  const hearing = { at: "2026-10-29T10:00:00.000Z", mode: "cross" as const, exchanges: [exchange("sustained"), exchange("overruled")] };
  const quiet = { ...hearing, exchanges: [] };
  const best = showcaseRank({ where: "won", decidedBy: "requested", filings: asked, hearing });
  const askedQuiet = showcaseRank({ where: "won", decidedBy: "requested", scenarioId: "delivered", filings: asked, engine: "model", hearing: quiet });
  const byItself = showcaseRank({ where: "won", decidedBy: "sandbox", scenarioId: "delivered", filings: filed, engine: "model", hearing });
  const open = showcaseRank({ where: "filed", decidedBy: null, scenarioId: "delivered", filings: filed, engine: "model" });
  assert.ok(best > askedQuiet && askedQuiet > byItself && byItself > open);
  // A hearing held after the ruling request isn't the one the ruling followed.
  assert.ok(showcaseRank({ where: "won", decidedBy: "requested", filings: asked, hearing: { ...hearing, at: "2026-10-30T00:00:00.000Z" } }) < best);
  assert.equal(contested(hearing), true);
  assert.equal(contested({ ...hearing, exchanges: [exchange("sustained")] }), false);
  assert.equal(contested(quiet), false);
});

test("the hero line is true to who decided the shown case", () => {
  assert.equal(heroRulingLine({ where: "won", by: "sandbox", reviewer: false, day: "16 Oct 2026" }), "Closed for the seller by the sandbox on its own, 16 Oct 2026.");
  assert.equal(
    heroRulingLine({ where: "won", by: "requested", reviewer: true, day: "29 Oct 2026" }),
    "PayPal ruled for the seller at Exhibit's request on 29 Oct 2026, following the simulated reviewer's verdict.",
  );
  assert.equal(heroRulingLine({ where: "won", by: "requested", reviewer: false, day: "16 Oct 2026" }), "PayPal ruled for the seller at Exhibit's request on 16 Oct 2026.");
});

test("health lists deadlines still ahead or just missed, and only counts the long-dead ones", () => {
  const near = [
    { id: "LIVE", dueInHours: 30, kind: "pool stock" },
    { id: "JUST", dueInHours: -5, kind: "on the desk" },
    { id: "PCS", dueInHours: -272, kind: "on the desk" },
    { id: "OLD", dueInHours: -327, kind: "retired pool stock" },
  ];
  const s = splitDeadlines(near);
  assert.deepEqual(
    s.listed.map((n) => n.id),
    ["LIVE", "JUST"],
  );
  assert.equal(s.missed, 3);
  assert.equal(s.missedLongAgo, 2);
});

test("showcase: a win ruled at Exhibit's request after the reviewer's verdict outranks an older requested win of the 'delivered' story", () => {
  const followed = showcaseRank({ where: "won", decidedBy: "requested", scenarioId: "colour", filings: [{ action: "evidence", at: "2026-10-29T20:57:00Z" }, { action: "ruling", at: "2026-10-29T21:09:00Z", summary: "Ruled by the simulated reviewer: the listing disclosed it" }], engine: "model" });
  const old = showcaseRank({ where: "won", decidedBy: "requested", scenarioId: "delivered", filings: [{ action: "evidence", at: "2026-10-15T08:00:00Z" }, { action: "ruling", at: "2026-10-15T09:00:00Z", summary: "Asked the sandbox to rule" }], engine: "model" });
  assert.ok(followed > old);
});
