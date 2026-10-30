import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkAnswers, type Hearing } from "../lib/cases/hearing.ts";
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
