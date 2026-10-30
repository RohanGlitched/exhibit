import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkAnswers, exchangeTopics, restsOnSustained, settle, type Hearing } from "../lib/cases/hearing.ts";
import { checkSentence } from "../lib/cases/verify.ts";
import type { Exhibit } from "../lib/cases/types.ts";

const text = (e: Exhibit) => [e.title, e.ref ?? "", ...e.facts.map((f) => `${f.label}: ${f.value}`), ...(e.lines ?? [])].join("\n");

// PP-R-BFL-10195216, the agent showcase, as the live desk served it: exhibits B, I, L and the hearing on PayPal's copy.
const BFL = JSON.parse(readFileSync(new URL("./fixtures/bfl-paypal-hearing.json", import.meta.url), "utf8")) as { exhibits: Exhibit[]; hearing: Hearing };

test("BFL objection 1: the compelling-evidence answer the checker struck for '120' is kept now that Exhibit L's 146 and 211 days fall in its range", () => {
  const ex = BFL.hearing.exchanges[0];
  assert.equal(ex.answer.kept, false);
  assert.equal(ex.answer.why, "120 isn't in Exhibit L, I, B.");
  const now = checkSentence({ text: ex.answer.text, cites: ex.answer.cites }, BFL.exhibits, text);
  assert.equal(now.kept, true, now.why);
  assert.ok(now.checked?.includes("120 to 365 days"));
  // The same answer through the hearing's own path.
  const [answer] = checkAnswers([ex.objection], [{ objection: 1, stance: "answer", text: ex.answer.text, cites: ex.answer.cites }], BFL.exhibits, text);
  assert.equal(answer.kept, true);
});

test("a stated range holds only when a cited record has a value inside it", () => {
  const keep = (t: string) => checkSentence({ text: t, cites: ["L"] }, BFL.exhibits, text);
  assert.equal(keep("Both earlier orders are between 120 and 365 days old.").kept, true);
  assert.equal(keep("Both earlier orders are 120-365 days old.").kept, true);
  const early = keep("Both earlier orders are 10 to 90 days old.");
  assert.equal(early.kept, false);
  assert.equal(early.why, "A span of 10 to 90 days isn't in Exhibit L.");
  assert.equal(keep("Both earlier orders are between 300 and 365 days old.").why, "A span of 300 to 365 days isn't in Exhibit L.");
  // A range of another unit isn't met by days.
  assert.equal(keep("The earlier orders are 4 to 8 months old.").kept, false);
});
test("BFL's verdict for the seller rests on objection 1, the struck answer to the response as a whole, and is flagged", () => {
  const h = BFL.hearing;
  assert.equal(h.exchanges[0].objection.sentence, null);
  assert.equal(h.exchanges[0].ruledBy, "checker");
  // What the struck answer put up: the earlier orders, the device and IP, the signed delivery.
  const topics = exchangeTopics(h.exchanges[0]);
  for (const t of ["mandate", "prior", "device"]) assert.ok(topics.includes(t), `${t} in ${topics}`);
  // The verdict as the reviewer wrote it: "Two earlier undisputed orders share this order's device and IP...".
  assert.deepEqual(restsOnSustained(h.verdict, h.exchanges).map((e) => e.objection.n), [1]);
  // Objection 2 was conceded with no effect: it doesn't count.
  assert.ok(!restsOnSustained(h.verdict, h.exchanges).some((e) => e.objection.n === 2));
  // Settled again from the transcript, the verdict carries the caveat a ruling request can't ignore.
  const objections = h.exchanges.map((e) => e.objection);
  const answers = h.exchanges.map((e) => e.answer);
  const s = settle({ call: "fight", response: h.response, objections, answers, rulings: [], verdict: { side: "seller", reason: h.verdict.reason }, reasked: true });
  assert.match(s.verdict.caveat ?? "", /objection 1/);
});

test("an objection to the response as a whole with no card item is read from its question", () => {
  const e = {
    objection: { n: 1, sentence: null, text: "Where is the tracking that shows it was delivered at all?", ground: "unanswered" as const, pages: [] },
    answer: { stance: "answer" as const, text: "USPS shows it delivered.", cites: ["C"], kept: false, why: "No.", effect: "none" as const },
    ruling: "sustained" as const,
    reason: "struck",
    ruledBy: "checker" as const,
  };
  assert.ok(exchangeTopics(e).includes("tracking"));
  assert.ok(exchangeTopics(e).includes("delivered"));
  assert.equal(restsOnSustained({ side: "seller", reason: "The parcel was delivered to the buyer's ZIP", by: "reviewer" }, [e]).length, 1);
  assert.equal(restsOnSustained({ side: "seller", reason: "The listing disclosed the glaze", by: "reviewer" }, [e]).length, 0);
});
