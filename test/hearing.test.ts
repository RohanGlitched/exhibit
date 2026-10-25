import { test } from "node:test";
import assert from "node:assert/strict";
import {
  acceptRepairs,
  applyHearing,
  checkAnswers,
  hearingStats,
  normaliseObjections,
  repairLabel,
  ruleChair,
  rulesHearing,
  rulingRequest,
  settle,
  transcriptText,
  type Hearing,
  type Objection,
} from "../lib/cases/hearing.ts";
import type { Brief, Exhibit } from "../lib/cases/types.ts";

const text = (e: Exhibit) => [e.title, e.ref ?? "", ...e.facts.map((f) => `${f.label}: ${f.value}`), ...(e.lines ?? [])].join("\n");

const EX: Exhibit[] = [
  { id: "A", kind: "claim", title: "The buyer's claim: not received", source: "PayPal", facts: [{ label: "Amount disputed", value: "$104.00" }] },
  { id: "B", kind: "tracking", title: "Tracking on file with PayPal", source: "PayPal", facts: [{ label: "Tracking number", value: "9405511206213859470035" }] },
  { id: "C", kind: "scans", title: "USPS scan history", source: "USPS", facts: [], lines: ["27 Sep 2026, 13:00  Delivered, signed, San Francisco, CA 94109"] },
];

const RESPONSE = [
  { text: "We shipped it with tracking number 9405511206213859470035.", cites: ["B"] },
  { text: "USPS delivered it on 27 Sep 2026, 13:00, signed for.", cites: ["C"] },
];

const obj = (n: number, sentence: number | null, ground: Objection["ground"] = "unsupported"): Objection => ({ n, sentence, text: `Objection number ${n} text`, ground, pages: [] });

test("objections: at most four, numbered from one, sentence numbers checked and made 0-based", () => {
  const raw = [
    { sentence: 2, objection: "Which page shows the signature?", ground: "unsupported", pages: ["HC-000004", "page 2"] },
    { sentence: 9, objection: "Nothing answers the claim at all here.", ground: "bogus" },
    { sentence: 2, objection: "which page shows the signature?" }, // duplicate
    { sentence: 1, objection: "short" }, // too short
    { sentence: 1, objection: "Is the tracking number on the order?" },
    { sentence: 0, objection: "Does the response answer the claim?" },
    { sentence: 1, objection: "A fifth objection that should be dropped." },
  ];
  const o = normaliseObjections(raw, RESPONSE.length);
  assert.equal(o.length, 4);
  assert.deepEqual(o.map((x) => x.n), [1, 2, 3, 4]);
  assert.equal(o[0].sentence, 1);
  assert.deepEqual(o[0].pages, ["HC-000004"]);
  assert.equal(o[1].sentence, null); // 9 is out of range: the response as a whole
  assert.equal(o[1].ground, "unanswered"); // unknown ground on the whole response
  assert.equal(o[2].sentence, 0);
  assert.equal(o[3].sentence, null);
});

test("answers: checked by the same checker as the brief; a missing answer is a concession that changes nothing", () => {
  const o = [obj(1, 1), obj(2, 0), obj(3, null), obj(4, 1)];
  const a = checkAnswers(
    o,
    [
      { objection: 1, stance: "answer", text: "USPS shows it delivered and signed for on 27 Sep 2026.", cites: ["C"], effect: "none" },
      { objection: 2, stance: "answer", text: "We shipped it on 20 Sep 2026.", cites: ["B"], effect: "none" }, // date not in B
      { objection: 3, stance: "concede", text: "We can't show more.", cites: [], effect: "withdraw" }, // whole response: nothing to withdraw
    ],
    EX,
    text,
  );
  assert.equal(a[0].kept, true);
  assert.equal(a[1].kept, false);
  assert.match(a[1].why ?? "", /20 Sep 2026/);
  assert.equal(a[2].stance, "concede");
  assert.equal(a[2].effect, "none");
  assert.equal(a[3].stance, "concede");
  assert.equal(a[3].text, "No answer.");
});

test("answers: an answer that cites nothing is struck", () => {
  const [a] = checkAnswers([obj(1, 0)], [{ objection: 1, stance: "answer", text: "It was delivered.", cites: [] }], EX, text);
  assert.equal(a.kept, false);
  assert.equal(a.why, "No exhibit cited.");
});

test("settle: a struck answer is sustained and the sentence it defended is withdrawn; only the reviewer overrules", () => {
  const o = [obj(1, 0), obj(2, 1)];
  const answers = checkAnswers(
    o,
    [
      { objection: 1, stance: "answer", text: "Tracking 9405511206213859470099 is on file.", cites: ["B"] }, // wrong digits: struck
      { objection: 2, stance: "answer", text: "USPS shows it signed for on 27 Sep 2026.", cites: ["C"] },
    ],
    EX,
    text,
  );
  const s = settle({
    call: "fight",
    response: RESPONSE,
    objections: o,
    answers,
    rulings: [
      { objection: 1, ruling: "overruled", reason: "Fine" }, // ignored: the checker struck the answer
      { objection: 2, ruling: "overruled", reason: "The scan shows the signature." },
    ],
    verdict: { side: "seller", reason: "Delivery to the buyer's address is shown." },
  });
  assert.equal(s.exchanges[0].ruling, "sustained");
  assert.equal(s.exchanges[0].ruledBy, "checker");
  assert.equal(s.exchanges[1].ruling, "overruled");
  assert.deepEqual(s.withdrawn, [0]);
  assert.equal(s.verdict.side, "seller");
  assert.equal(s.verdict.by, "reviewer");
  assert.equal(s.verdict.reason, "Delivery to the buyer's address is shown");
  assert.equal(s.agrees, true);
  assert.equal(s.after, "fight");
});

test("settle: conceding the case flips the call to refund and hands the verdict to the buyer, whatever the reviewer wrote", () => {
  const o = [obj(1, 1)];
  const answers = checkAnswers(o, [{ objection: 1, stance: "concede", text: "The scans don't reach the buyer's ZIP.", effect: "refund" }], EX, text);
  const s = settle({ call: "fight", response: RESPONSE, objections: o, answers, verdict: { side: "seller", reason: "x" } });
  assert.equal(s.flipped, true);
  assert.equal(s.after, "accept");
  assert.equal(s.verdict.side, "buyer");
  assert.equal(s.verdict.by, "concession");
  assert.equal(s.exchanges[0].ruling, "sustained");
  assert.equal(s.agrees, false); // the reviewer's side differs from the call Exhibit came in with
});

test("settle: withdrawing every sentence loses the case; an unruled answer is held against the seller", () => {
  const o = [obj(1, 0), obj(2, 1)];
  const answers = checkAnswers(
    o,
    [
      { objection: 1, stance: "concede", text: "Withdrawn.", effect: "withdraw" },
      { objection: 2, stance: "concede", text: "Withdrawn too.", effect: "withdraw" },
    ],
    EX,
    text,
  );
  const s = settle({ call: "fight", response: RESPONSE, objections: o, answers, verdict: { side: "seller", reason: "x" } });
  assert.deepEqual(s.withdrawn, [0, 1]);
  assert.equal(s.verdict.side, "buyer");
  assert.equal(s.verdict.by, "concession");

  const kept = checkAnswers([obj(1, 1)], [{ objection: 1, stance: "answer", text: "USPS shows it signed for.", cites: ["C"] }], EX, text);
  const t = settle({ call: "fight", response: RESPONSE, objections: [obj(1, 1)], answers: kept, rulings: [], verdict: undefined });
  assert.equal(t.exchanges[0].ruling, "sustained");
  assert.match(t.exchanges[0].reason, /didn't rule/);
  assert.equal(t.verdict.side, "buyer"); // no verdict: the seller carries the burden
});

test("settle: no objections passes the reviewer's ruling through", () => {
  const s = settle({ call: "fight", response: RESPONSE, objections: [], answers: [], verdict: { side: "seller", reason: "Signed for at the buyer's address." } });
  assert.equal(s.exchanges.length, 0);
  assert.equal(s.verdict.side, "seller");
  assert.equal(s.agrees, true);
  const r = settle({ call: "accept", response: [], objections: [], answers: [], verdict: { side: "buyer", reason: "No tracking." } });
  assert.equal(r.agrees, true);
});

const brief = (over: Partial<Brief> = {}): Brief => ({
  recommendation: "fight",
  headline: "The records support the seller.",
  sentences: [
    { text: RESPONSE[0].text, cites: ["B"], kept: true },
    { text: "We delivered it on 1 Oct 2026.", cites: ["C"], kept: false, why: "1 Oct 2026 isn't in Exhibit C." },
    { text: RESPONSE[1].text, cites: ["C"], kept: true },
  ],
  tally: [],
  odds: 80,
  evidenceTypes: ["PROOF_OF_FULFILLMENT"],
  engine: "model",
  ms: 1,
  createdAt: "2026-10-25T00:00:00.000Z",
  ...over,
});

const hearing = (over: Partial<Hearing> = {}): Hearing => ({
  at: "2026-10-25T00:00:00.000Z",
  mode: "cross",
  source: "draft",
  pages: ["HC-000001", "HC-000002"],
  response: RESPONSE,
  exchanges: [
    {
      objection: obj(1, 1),
      answer: { stance: "concede", text: "We withdraw it.", cites: [], kept: true, effect: "withdraw" },
      ruling: "sustained",
      reason: "Exhibit conceded and withdrew the sentence",
      ruledBy: "concession",
    },
  ],
  call: "fight",
  after: "fight",
  withdrawn: [1],
  flipped: false,
  verdict: { side: "seller", reason: "The tracking is on file", by: "reviewer" },
  agrees: true,
  engine: "model",
  ms: 10,
  calls: 3,
  ...over,
});

test("applyHearing: a withdrawn response sentence maps onto the brief's kept sentences, skipping ones struck before", () => {
  const b = applyHearing(brief(), hearing());
  assert.equal(b.sentences[0].kept, true);
  assert.equal(b.sentences[1].why, "1 Oct 2026 isn't in Exhibit C."); // untouched
  assert.equal(b.sentences[2].kept, false);
  assert.match(b.sentences[2].why ?? "", /^Withdrawn at the hearing after objection 1/);
  assert.equal(b.recommendation, "fight");
});

test("applyHearing: a conceded case becomes a refund; a hearing on PayPal's copy changes nothing", () => {
  const flipped = applyHearing(brief(), hearing({ flipped: true, after: "accept", withdrawn: [], verdict: { side: "buyer", reason: "Exhibit conceded the case at the hearing: no signature", by: "concession" } }));
  assert.equal(flipped.recommendation, "accept");
  assert.equal(flipped.headline, "Conceded at the hearing: no signature. Refund and close it.");
  const filed = brief();
  assert.equal(applyHearing(filed, hearing({ source: "paypal" })), filed);
});

test("rulingRequest: the outcome follows the reviewer, and the case says who ruled", () => {
  assert.deepEqual(rulingRequest(hearing()), { outcome: "SELLER_FAVOR", summary: "Ruled by the simulated reviewer: The tracking is on file" });
  const lost = rulingRequest(hearing({ verdict: { side: "buyer", reason: "No page shows delivery.", by: "reviewer" } }));
  assert.equal(lost.outcome, "BUYER_FAVOR");
  assert.equal(lost.summary, "Ruled by the simulated reviewer: No page shows delivery");
  const rules = rulesHearing("fight", 70, true, RESPONSE, "paypal");
  assert.equal(rules.verdict.side, "seller");
  assert.match(rulingRequest(rules).summary, /^Ruled by the rules engine \(no model reviewer was available\): /);
  assert.equal(rulesHearing("fight", 40, true, RESPONSE, "paypal").verdict.side, "buyer");
  assert.equal(rulesHearing("accept", 90, false, [], "paypal").verdict.side, "buyer");
});

test("repair: a re-cite replaces a struck sentence only if the checker keeps it; kept sentences are never touched", () => {
  const b = brief({
    sentences: [
      { text: RESPONSE[0].text, cites: ["B"], kept: true },
      { text: "USPS delivered it on 27 Sep 2026, 13:00, signed for.", cites: ["B"], kept: false, why: "27 Sep 2026 isn't in Exhibit B." },
      { text: "We delivered it on 1 Oct 2026.", cites: ["C"], kept: false, why: "1 Oct 2026 isn't in Exhibit C." },
    ],
  });
  const r = acceptRepairs(
    b.sentences,
    [
      { index: 1, text: "Changed.", cites: ["A"] }, // a kept sentence: ignored
      { index: 2, text: "USPS delivered it on 27 Sep 2026, 13:00, signed for.", cites: ["C"] },
      { index: 3, text: "We delivered it on 2 Oct 2026.", cites: ["C"] }, // still not in C
    ],
    EX,
    text,
  );
  assert.equal(r.tried, 2);
  assert.equal(r.fixed, 1);
  assert.equal(r.sentences[0], b.sentences[0]);
  assert.equal(r.sentences[1].kept, true);
  assert.deepEqual(r.sentences[1].repaired, { from: b.sentences[1].text, fromCites: ["B"], why: "27 Sep 2026 isn't in Exhibit B." });
  assert.equal(repairLabel(r.sentences[1]), "Repaired: re-cited to Exhibit C");
  assert.equal(r.sentences[2].kept, false);
  assert.match(r.sentences[2].why ?? "", /One re-cite was tried and struck too: 2 Oct 2026 isn't in Exhibit C\./);
  assert.equal(repairLabel(r.sentences[0]), null);
});

test("repair: a reworded sentence is labelled as reworded", () => {
  const r = acceptRepairs([{ text: "Delivered on 1 Oct 2026.", cites: ["C"], kept: false, why: "x" }], [{ index: 1, text: "Delivered on 27 Sep 2026.", cites: "C" }], EX, text);
  assert.equal(repairLabel(r.sentences[0]), "Repaired: reworded and re-cited to Exhibit C");
});

test("the reviewer's chair: the checker and the concession rule, never the visitor's wording", () => {
  assert.equal(ruleChair({ stance: "answer", text: "x", cites: ["C"], kept: true, effect: "none" }).ruling, "overruled");
  assert.equal(ruleChair({ stance: "answer", text: "x", cites: ["C"], kept: false, why: "No exhibit cited.", effect: "none" }).ruling, "sustained");
  assert.equal(ruleChair({ stance: "concede", text: "x", cites: [], kept: true, effect: "refund" }).reason, "Exhibit conceded the case");
});

test("stats and transcript", () => {
  const h = hearing();
  const s = hearingStats([h, hearing({ mode: "record", exchanges: [], withdrawn: [], verdict: { side: "buyer", reason: "x", by: "reviewer" }, call: "accept", after: "accept" })]);
  assert.equal(s.hearings, 2);
  assert.equal(s.cross, 1);
  assert.equal(s.objections, 1);
  assert.equal(s.conceded, 1);
  assert.equal(s.sustained, 1);
  assert.equal(s.withdrawn, 1);
  assert.equal(s.agree, 2);
  const t = transcriptText(h);
  assert.match(t, /OBJECTION 1 to sentence 2/);
  assert.match(t, /SUSTAINED\. Exhibit conceded and withdrew the sentence\./);
  assert.match(t, /Verdict for the seller: The tracking is on file\./);
});
