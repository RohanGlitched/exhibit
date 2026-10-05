import { test } from "node:test";
import assert from "node:assert/strict";
import { checkSentence, checkTally, figures, oddsFrom } from "../lib/cases/verify.ts";
import type { Exhibit } from "../lib/cases/types.ts";

const text = (e: Exhibit) => [e.title, e.ref ?? "", ...e.facts.map((f) => `${f.label}: ${f.value}`), ...(e.lines ?? [])].join("\n");

const EX: Exhibit[] = [
  {
    id: "A",
    kind: "claim",
    title: "The buyer's claim: not received",
    source: "PayPal",
    ref: "PP-R-OCC-10190303",
    facts: [
      { label: "Case", value: "PP-R-OCC-10190303" },
      { label: "Amount disputed", value: "$104.00" },
    ],
  },
  {
    id: "E",
    kind: "scans",
    title: "USPS scan history",
    source: "USPS",
    facts: [],
    lines: ["25 Sep 2026, 23:00  In transit, Sacramento", "27 Sep 2026, 13:00  Delivered, signed, San Francisco, CA 94109"],
  },
  {
    id: "D",
    kind: "tracking",
    title: "Tracking on file with PayPal",
    source: "PayPal",
    facts: [{ label: "Tracking number", value: "9405511206213859470035" }],
  },
];

test("keeps a sentence whose figures all appear in what it cites", () => {
  const s = checkSentence({ text: "USPS delivered it on 27 Sep 2026, 13:00, signed for.", cites: ["E"] }, EX, text);
  assert.equal(s.kept, true);
});

test("strikes a sentence with no citation", () => {
  const s = checkSentence({ text: "We shipped it promptly.", cites: [] }, EX, text);
  assert.equal(s.kept, false);
  assert.match(s.why!, /No exhibit cited/);
});

test("strikes a citation to an exhibit that doesn't exist", () => {
  const s = checkSentence({ text: "It was delivered.", cites: ["Z"] }, EX, text);
  assert.equal(s.kept, false);
});

test("strikes a wrong amount", () => {
  const s = checkSentence({ text: "The buyer disputes $140.00.", cites: ["A"] }, EX, text);
  assert.equal(s.kept, false);
  assert.match(s.why!, /\$140\.00/);
});

test("accepts an amount written without cents or with a comma", () => {
  assert.equal(checkSentence({ text: "The buyer disputes $104.", cites: ["A"] }, EX, text).kept, true);
});

test("strikes a date that only exists in another exhibit", () => {
  const s = checkSentence({ text: "It was delivered on 27 Sep 2026.", cites: ["A"] }, EX, text);
  assert.equal(s.kept, false);
});

test("strikes a date and time taken from two different scans", () => {
  const s = checkSentence({ text: "USPS delivered it on 25 Sep 2026, 13:00.", cites: ["E"] }, EX, text);
  assert.equal(s.kept, false);
  assert.match(s.why!, /25 Sep 2026, 13:00/);
});

test("accepts full month names for a date in the exhibit", () => {
  assert.equal(checkSentence({ text: "It arrived on 27 September 2026.", cites: ["E"] }, EX, text).kept, true);
});

test("reads a date written the American way or as ISO", () => {
  assert.equal(checkSentence({ text: "It arrived on September 27, 2026.", cites: ["E"] }, EX, text).kept, true);
  assert.equal(checkSentence({ text: "It arrived on Sept. 27th, 2026.", cites: ["E"] }, EX, text).kept, true);
  assert.equal(checkSentence({ text: "It arrived on 2026-09-27.", cites: ["E"] }, EX, text).kept, true);
  const s = checkSentence({ text: "It arrived on Sep 29, 2026.", cites: ["E"] }, EX, text);
  assert.equal(s.kept, false);
  assert.match(s.why!, /Sep 29, 2026/);
  assert.equal(checkSentence({ text: "It arrived on 2026-09-29.", cites: ["E"] }, EX, text).kept, false);
});

test("reads a 12-hour time", () => {
  assert.equal(checkSentence({ text: "USPS delivered it at 1:00 pm.", cites: ["E"] }, EX, text).kept, true);
  assert.equal(checkSentence({ text: "USPS delivered it at 1 p.m.", cites: ["E"] }, EX, text).kept, true);
  assert.equal(checkSentence({ text: "USPS delivered it at 11:00 am.", cites: ["E"] }, EX, text).kept, false);
  assert.equal(checkSentence({ text: "USPS delivered it at 11 PM.", cites: ["E"] }, EX, text).kept, true);
});

test("strikes a tracking number with one digit changed", () => {
  const s = checkSentence({ text: "Tracking number 9405511206213859470036 shows it shipped.", cites: ["D"] }, EX, text);
  assert.equal(s.kept, false);
});

test("finds figures in a sentence", () => {
  const f = figures("Refund 6ED91706RN309632X of $46.00 on 4 Oct 2026, 22:59.");
  assert.deepEqual(f.money, ["$46.00"]);
  assert.deepEqual(f.dates, ["4 Oct 2026"]);
  assert.deepEqual(f.times, ["22:59"]);
  assert.deepEqual(f.ids, ["6ED91706RN309632X"]);
});

test("drops tally points without a real citation and clamps weights", () => {
  const t = checkTally(
    [
      { side: "seller", point: "Delivered", weight: 5 as 3, cites: ["E"] },
      { side: "buyer", point: "Says not received", weight: 0 as 1, cites: ["Q"] },
    ],
    EX,
  );
  assert.equal(t.length, 1);
  assert.equal(t[0].weight, 3);
});

test("odds follow the weight on each side and stay off the extremes", () => {
  assert.equal(oddsFrom([]), 50);
  assert.equal(oddsFrom([{ side: "seller", point: "", weight: 3, cites: ["E"] }]), 97);
  assert.equal(
    oddsFrom([
      { side: "seller", point: "", weight: 3, cites: ["E"] },
      { side: "buyer", point: "", weight: 1, cites: ["A"] },
    ]),
    75,
  );
});
