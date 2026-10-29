import type { BriefSentence, Exhibit, TallyItem } from "./types";

/**
 * "No claim without a record." A sentence survives only if it cites at least one real exhibit and:
 * - the words it quotes as its proof appear in an exhibit it cites;
 * - every figure and name in it appears in what it cites: amounts (however written), dates (with or without a
 *   year), times, ids and tracking numbers, ZIPs, city and state, carriers, who signed, counts, percentages;
 * - each clause rests on one record: a date and a place, an amount and a date, can't be taken from two
 *   different records and put together, and a date said to be a refund (delivery, order, email...) has to be
 *   the date of a refund in the record;
 * - it doesn't deny what its record says ("never delivered" against a delivery scan), or claim a signature no
 *   cited record shows.
 * Anything else is struck, with the reason shown in the brief. A sentence with nothing in it the checker can
 * match (no figure, no name) is kept but marked unverified: it is held only to its citation.
 */

const MONEY = /\$\s?\d[\d,]*(?:\.\d{2})?/g;
const DATE = /\b\d{1,2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{4}\b/g;
// The exhibits write "3 Oct 2026, 13:02"; a model may still write "October 3, 2026", "2026-10-03" or "1:02 pm".
const US_DATE = /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.? \d{1,2}(?:st|nd|rd|th)?,? \d{4}\b/g;
const ISO_DATE = /\b\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])\b/g;
const TIME = /\b\d{2}:\d{2}\b/g;
const TIME12 = /\b\d{1,2}(?::\d{2})?\s?[ap]\.?m\.?(?![a-z])/gi;
const DATETIME = /\b(\d{1,2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{4}),? (?:at )?(\d{2}:\d{2})\b/g;
const ID = /\b(?=[A-Z0-9-]*\d)(?=[A-Z0-9-]*[A-Z])[A-Z0-9-]{8,}\b|\b\d{9,}\b/g;

// Written another way: "140.00 USD", "USD 140", "104.00 dollars", a bare "104.00".
const USD = /\b(?:USD|US\$)\s?\d[\d,]*(?:\.\d{2})?\b|\b\d[\d,]*(?:\.\d{2})?\s?(?:USD|dollars)\b/gi;
const DECIMAL = /(?<![\d.])\d[\d,]*\.\d{2}(?![\d])/g;
const MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept|Sep|Oct|Nov|Dec";
// A date with no year ("9 Oct", "October 9th"): matched against the day and month of the dates on record.
const DAY_DM = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)? (?:of )?(${MONTHS})\\b\\.?`, "g");
const DAY_MD = new RegExp(`\\b(${MONTHS})\\.? (\\d{1,2})(?:st|nd|rd|th)?\\b`, "g");
const DAY_PAIR = /\b(\d{1,2})(?:st|nd|rd|th)?(?= ?(?:and|or|&|[-–,]) ?\d{1,2}(?:st|nd|rd|th)? ((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*) (\d{4})\b)/g;
const PERCENT =/\b\d+(?:\.\d+)?\s?(?:%|percent\b)/gi;
const ZIP = /\b\d{5}(?:-\d{4})?\b/g;
const STATES =
  "AL|AK|AZ|AR|CA|CO|CT|DE|DC|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY";
const PLACE = new RegExp(`\\b([A-Z][a-z]+(?:[ -][A-Z][a-z]+){0,2}), (${STATES})\\b`, "g");
// A signer is up to four capitalised words or initials ("D BROOKS", "J. R. Smith"). A full stop after a word ends
// the name: "signed for by D BROOKS. The order..." names D BROOKS, not "D BROOKS. The".
const NAME_PART = String.raw`(?:(?:Mr|Mrs|Ms|Dr)\.|[A-Z]\.|[A-Z][A-Za-z'’-]*)`;
const SIGNER = new RegExp(String.raw`\bsign(?:ed|ature)(?: for)? by (${NAME_PART}(?: ${NAME_PART}){0,3})`, "g");
const CARRIER = /\b(USPS|UPS|FedEx|Fed Ex|DHL|Royal Mail|Canada Post|OnTrac|LaserShip|Amazon Logistics|Purolator|Evri|Parcelforce|DPD|GLS)\b/g;
const NUMBER = /(?<![\w.$])\d+(?:\.\d+)?(?![\w]|\.\d)/g;
const NOT_A_COUNT = /\b3-?D[- ]?Secure\b|\b3DS\b|\b(?:sentences?|objections?) \d+(?:(?:,| and) \d+)*\b/gi;
const WORDS: Record<string, string | null> = {
  two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", ten: "10", eleven: "11", twelve: "12",
  twenty: "20", thirty: "30", forty: "40", fifty: "50", sixty: "60", seventy: "70", eighty: "80", ninety: "90",
  hundred: null, thousand: null, million: null,
};
const WORD = new RegExp(`\\b(${Object.keys(WORDS).join("|")})\\b`, "gi");

const norm = (s: string) =>
  s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/×/g, "x")
    .replace(/\s+/g, " ")
    .replace(/,(?=\d{3})/g, "")
    .toLowerCase();
const money = (s: string) => {
  const n = Number(s.replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n.toFixed(2) : s;
};
const MONTH_FULL: Record<string, string> = {
  january: "jan", february: "feb", march: "mar", april: "apr", june: "jun", july: "jul",
  august: "aug", september: "sep", october: "oct", november: "nov", december: "dec",
};
const MON = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const mon = (m: string) => MONTH_FULL[m.toLowerCase().replace(".", "")] ?? m.toLowerCase().slice(0, 3);

/** Any written date as "3 oct 2026", the form the exhibits use. */
export const normDate = (s: string) => {
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${Number(iso[3])} ${MON[Number(iso[2]) - 1]} ${iso[1]}`;
  const us = s.match(/^([A-Za-z]+)\.? (\d{1,2})(?:st|nd|rd|th)?,? (\d{4})$/);
  if (us) return `${Number(us[2])} ${mon(us[1])} ${us[3]}`;
  const [d, m, y] = s.toLowerCase().split(" ");
  return `${Number(d)} ${mon(m)} ${y}`;
};

/** Any written time as "13:02". */
export const normTime = (s: string) => {
  const t = s.match(/^(\d{1,2})(?::(\d{2}))?\s?([ap])/i);
  if (!t) return s;
  const h = (Number(t[1]) % 12) + (t[3].toLowerCase() === "p" ? 12 : 0);
  return `${String(h).padStart(2, "0")}:${t[2] ?? "00"}`;
};

export function figures(text: string) {
  return {
    money: [...text.matchAll(MONEY)].map((m) => m[0]),
    dates: [DATE, US_DATE, ISO_DATE].flatMap((re) => [...text.matchAll(re)].map((m) => m[0])),
    times: [TIME, TIME12].flatMap((re) => [...text.matchAll(re)].map((m) => m[0])),
    ids: [...text.matchAll(ID)].map((m) => m[0]),
  };
}

/* ───────────── What a sentence asserts ───────────── */

export type TokenKind = "money" | "date" | "day" | "time" | "id" | "percent" | "zip" | "place" | "signer" | "carrier" | "number" | "word";

export interface Token {
  kind: TokenKind;
  raw: string; // as written in the sentence
  key: string; // normalised, for matching against the record
  at: number; // where it starts in the sentence
}

/** Every checkable figure and name in a sentence, each read once (an amount's digits aren't read again as a count). */
export function tokens(text: string): Token[] {
  let rest = text;
  const out: Token[] = [];
  const take = (re: RegExp, kind: TokenKind, key: (m: RegExpMatchArray) => string, group = 0) => {
    for (const m of [...rest.matchAll(re)]) {
      const raw = m[group];
      if (!raw) continue;
      const at = m.index! + (group ? m[0].indexOf(raw) : 0);
      out.push({ kind, raw: raw.trim().replace(/[.,;:]+$/, ""), key: key(m), at });
      rest = rest.slice(0, m.index!) + " ".repeat(m[0].length) + rest.slice(m.index! + m[0].length);
    }
  };
  take(MONEY, "money", (m) => money(m[0]));
  take(USD, "money", (m) => money(m[0]));
  // "6 and 8 Oct 2026": the first day shares the month and year of the date after it.
  for (const m of [...rest.matchAll(DAY_PAIR)]) {
    out.push({ kind: "date", raw: `${m[1]} ${m[2]} ${m[3]}`, key: normDate(`${m[1]} ${m[2]} ${m[3]}`), at: m.index! });
    rest = rest.slice(0, m.index!) + " ".repeat(m[1].length) + rest.slice(m.index! + m[1].length);
  }
  take(DATE, "date", (m) => normDate(m[0]));
  take(US_DATE, "date", (m) => normDate(m[0]));
  take(ISO_DATE, "date", (m) => normDate(m[0]));
  take(DAY_DM, "day", (m) => `${Number(m[1])} ${mon(m[2])}`);
  take(DAY_MD, "day", (m) => `${Number(m[2])} ${mon(m[1])}`);
  take(TIME12, "time", (m) => normTime(m[0]));
  take(TIME, "time", (m) => m[0]);
  take(ID, "id", (m) => m[0].toLowerCase());
  take(DECIMAL, "money", (m) => money(m[0]));
  take(PERCENT, "percent", (m) => `${m[0].replace(/[^\d.]/g, "")}%`);
  take(ZIP, "zip", (m) => m[0]);
  take(PLACE, "place", (m) => norm(`${m[1]}, ${m[2]}`));
  take(SIGNER, "signer", (m) => norm(m[1].replace(/[.,'’]+$/, "")), 1);
  take(CARRIER, "carrier", (m) => norm(m[0]));
  // Names, not counts: "3-D Secure", and a hearing answer pointing at "sentence 2" or "objection 3".
  rest = rest.replace(NOT_A_COUNT, (m) => " ".repeat(m.length));
  take(NUMBER, "number", (m) => m[0]);
  take(WORD, "word", (m) => m[0].toLowerCase());
  return out.sort((a, b) => a.at - b.at);
}

/* ───────────── What the cited records hold ───────────── */

interface Unit {
  exhibit: string;
  kind?: string;
  line: boolean; // a message, scan or other line, rather than the title or a labelled fact
  text: string;
  n: string; // normalised
}

interface Held {
  hay: string; // everything the cited exhibits say, normalised
  counts: string; // the same with every date, time, amount, id and ZIP blanked, so "3" isn't found in "3 Oct"
  amounts: Set<string>;
  dates: Set<string>;
  days: Set<string>;
  units: Unit[]; // single facts and lines
  records: { exhibit: string; text: string }[]; // one record: an exhibit's facts, or one of its lines read with them
}

const amountsIn = (s: string) => new Set([...s.matchAll(MONEY), ...s.matchAll(USD), ...s.matchAll(DECIMAL)].map((m) => money(m[0])));
const datesIn = (s: string) => new Set([...s.matchAll(DATE), ...s.matchAll(US_DATE), ...s.matchAll(ISO_DATE)].map((m) => normDate(m[0])));
const countsIn = (s: string) => norm([MONEY, USD, DATE, US_DATE, ISO_DATE, TIME12, TIME, ID, DECIMAL, ZIP].reduce((t, re) => t.replace(re, " "), s));
const daysIn = (s: string) => new Set([...datesIn(s)].map((d) => d.split(" ").slice(0, 2).join(" ")));

function held(cited: Exhibit[], textOf: (e: Exhibit) => string): Held {
  const body = cited.map(textOf).join("\n");
  const units: Unit[] = [];
  const records: Held["records"] = [];
  for (const e of cited) {
    const structured = Array.isArray(e.facts);
    const head = structured ? [e.title, e.ref ?? "", ...e.facts.map((f) => `${f.label}: ${f.value}`)].filter(Boolean) : textOf(e).split("\n");
    const lines = structured ? (e.lines ?? []) : [];
    for (const t of head) units.push({ exhibit: e.id, kind: e.kind, line: !structured, text: t, n: norm(t) });
    for (const t of lines) units.push({ exhibit: e.id, kind: e.kind, line: true, text: t, n: norm(t) });
    const h = head.join("\n");
    records.push({ exhibit: e.id, text: h });
    for (const t of lines) records.push({ exhibit: e.id, text: `${h}\n${t}` });
  }
  return { hay: norm(body), counts: countsIn(body), amounts: amountsIn(body), dates: datesIn(body), days: daysIn(body), units, records };
}

/** Whether a figure or name appears in some text: `hay` normalised, `amounts`/`dates`/`days` read from it. */
function holds(t: Token, h: { hay: string; counts: string; amounts: Set<string>; dates: Set<string>; days: Set<string> }): boolean {
  switch (t.kind) {
    case "money":
      return h.amounts.has(t.key);
    case "date":
      return h.dates.has(t.key);
    case "day":
      return h.days.has(t.key);
    case "time":
    case "id":
    case "place":
    case "signer":
      return h.hay.includes(t.key);
    case "zip":
    case "carrier":
      return new RegExp(`(?<![\\w])${esc(t.key)}(?![\\w])`).test(h.hay);
    case "percent":
      return h.hay.replace(/\s?percent\b/g, "%").replace(/(\d)\s%/g, "$1%").includes(t.key);
    case "number":
      return new RegExp(`(?<![\\d.])${esc(t.key)}(?![\\d]|\\.\\d)`).test(h.counts);
    case "word": {
      const digit = WORDS[t.key];
      return new RegExp(`\\b${t.key}\\b`).test(h.hay) || (digit !== null && new RegExp(`(?<![\\d.])${digit}(?![\\d]|\\.\\d)`).test(h.counts));
    }
  }
}
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const view = (s: string) => ({ hay: norm(s), counts: countsIn(s), amounts: amountsIn(s), dates: datesIn(s), days: daysIn(s) });

/* ───────────── Clauses, events and denials ───────────── */

/** A clause: the stretch of a sentence one record has to carry. Split at conjunctions and clause punctuation. */
const BREAK = /;|:\s|\s[-–—]\s|[()]|,?\s(?:and|but|while|whereas|because|although|though|after|before|when|since|so|then|which|until|yet|whereas)\s/gi;
function clauses(text: string): { from: number; to: number; text: string }[] {
  const out: { from: number; to: number; text: string }[] = [];
  let from = 0;
  for (const m of text.matchAll(BREAK)) {
    out.push({ from, to: m.index!, text: text.slice(from, m.index!) });
    from = m.index! + m[0].length;
  }
  out.push({ from, to: text.length, text: text.slice(from) });
  return out.filter((c) => c.text.trim());
}

/** What a dated clause says happened, and what a record has to say for its date to be that event's date. */
const EVENTS: { name: string; says: RegExp; record: RegExp; kinds?: string[] }[] = [
  { name: "a refund", says: /\brefunded\b|\brefund (?:was|of)\b/i, record: /refund/i, kinds: ["refund"] },
  { name: "the refund being issued", says: /\bissued\b/i, record: /refund|issued|created|added/i, kinds: ["refund"] },
  { name: "a delivery", says: /\bdeliver(?:ed|y)\b|\barrived?\b|\bsigned for\b|\bleft (?:at|on|with|by)\b/i, record: /deliver|arriv|signed|attempt|picked up|found|left/i },
  { name: "a delivery attempt", says: /\battempt/i, record: /attempt/i },
  { name: "shipping", says: /\bshipped\b|\bdispatched\b|\bmailed\b|\bsent (?:the|it|your|their|her|his) (?:parcel|package|order|item|vase|set)\b|\baccepted the (?:parcel|package)\b|\bacceptance\b|\bposted\b/i, record: /ship|accepted|dispatch|transit|label|mail|post/i },
  { name: "the order", says: /\bordered\b|\bplaced\b|\bpurchased\b|\bbought\b/i, record: /order|placed|purchas|bought/i },
  { name: "the expiry", says: /\bexpir/i, record: /expir/i },
  { name: "the signing", says: /\bsigned (?:the|an?|its|their|her|his)\b/i, record: /sign/i },
  {
    name: "a message",
    says: /\b(?:wrote|written|emailed|email|messaged|message|told|contacted|reported|said|asked|complained|informed|replied|explained|notified|declined|agreed|confirmed|requested|sent (?:that|this|the|an?) (?:confirmation|email|message|note|reply))\b/i,
    record: /wrote|email|message/i,
    kinds: ["inbox", "claim"],
  },
];

/** What an amount is said to be, and what the record has to call it. */
const AMOUNTS: { name: string; says: RegExp; record: RegExp; kinds?: string[] }[] = [
  { name: "the disputed amount", says: /\bchargeback\b|\bdisputed?\b|\bclaim\b/gi, record: /disput|total|gross|amount/i },
  { name: "a refund", says: /\brefunded\b|\brefund (?:was|of|is|has)\b|(?<=\d )refund\b/gi, record: /refund/i, kinds: ["refund"] },
  { name: "the payment", says: /\bpayment\b|\bcharged?\b|\bcaptured?\b/gi, record: /total|gross|amount|payment|charge|captur|disput/i },
  { name: "the cart's total", says: /\bcart\b/gi, record: /total|limit/i },
  { name: "a fee", says: /\bfees?\b/gi, record: /fee/i },
  { name: "the net amount", says: /\bnet\b|\bproceeds\b/gi, record: /net/i },
  { name: "the limit", says: /\blimit(?:ed)?\b|\bcap(?:ped)?\b|\bup to \$|\bunder \$|\bat most\b/gi, record: /limit|under|up to|max/i },
  { name: "the total", says: /\btotal(?:l?ing|led|s)?\b/gi, record: /total|gross|amount/i },
  { name: "what was paid", says: /\bpaid\b|\bcost\b/gi, record: /total|gross|amount|paid|price|×/i },
];
/**
 * The role word nearest an amount in its clause, within a few words of it ("the $1.43 fee left net proceeds of
 * $25.57": fee, then net). An amount with no role word close by isn't held to one.
 */
function roleOf(clause: string, at: number) {
  let best: { role: (typeof AMOUNTS)[number]; d: number } | null = null;
  for (const role of AMOUNTS) {
    for (const m of clause.matchAll(role.says)) {
      const d = Math.abs(m.index! - at);
      if (d <= 28 && (!best || d < best.d)) best = { role, d };
    }
  }
  return best?.role ?? null;
}

/**
 * "never delivered", "not refunded", "no signature": a denial. "does not show delivery" is about the evidence,
 * and "did not require a signature" about a rule, so neither is a denial.
 */
const NEGATOR = /^(?:not|never|no|without|nor|neither|cannot|none)$|n't$/;
const EVIDENTIAL = /^(?:show|shows|showed|shown|establish|establishes|prove|proves|record|records|recorded|confirm|confirms|provide|provides|include|includes|mention|mentions|list|lists|indicate|indicates|reflect|reflects|support|supports|require|requires|required|need|needs|needed|call|calls|demand|demands|ask|asks|request|requests)$/;
const STEMS: { name: string; re: RegExp }[] = [
  { name: "delivered", re: /\b(?:deliver(?:ed|y|ies)?|arriv(?:ed|al|e|es)?)\b/gi },
  { name: "signed", re: /\bsign(?:ed|ature)\b/gi },
  { name: "refunded", re: /\brefund(?:ed)?\b/gi },
  { name: "shipped", re: /\bshipped\b/gi },
];
type Polarity = "yes" | "no" | "skip";
function polarity(text: string, re: RegExp): Polarity[] {
  const t = text.replace(/[’]/g, "'");
  return [...t.matchAll(re)].map((m) => {
    const before = t.slice(0, m.index!).toLowerCase().split(/[\s,]+/).filter(Boolean).slice(-4).map((w) => w.replace(/[^a-z']/g, ""));
    const neg = before.findLastIndex((w) => NEGATOR.test(w));
    if (neg < 0) return "yes";
    return before.slice(neg + 1).some((w) => EVIDENTIAL.test(w)) ? "skip" : "no";
  });
}
const REPORTING = /\b(?:reported|reports|says|said|claims|claimed|told|tells|wrote|writes|complained|asked|alleges|alleged|states|stated|disputes|disputed)\b/i;
const CLAUSE_DENIAL = /\b(?:no|not|never|cannot|can't|without|none|neither|nor|unable|lacks?)\b[^.;]*\bsign(?:ed|ature)\b/i;
const BACK_TO_SENDER = /\bto (?:the )?sender\b|\breturned to (?:the )?(?:shop|seller|merchant)\b/i;
const PARCEL_SIGNATURE =/\bsigned for\b|\bsignature\b/gi;
// A denial of these has to rest on a cited record that mentions them at all.
const DENIED_NEEDS_RECORD = new Set(["shipped", "delivered"]);
const FREE_TEXT = new Set(["note", "inbox", "transcript", "scans", "tracking"]);
const EVIDENCE_NOUNS = "confirmation|proof|record|records|scan|scans|tracking|receipt|evidence|information|update|updates|status|date|signature";

/* ───────────── The check ───────────── */

const strike = (text: string, cites: string[], why: string, quote?: string): BriefSentence => ({ text, cites, kept: false, why, ...(quote ? { quote } : {}) });
const clip = (s: string, n = 70) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** Exhibit letters as the model gave them: usually an array, sometimes one string ("B, D") or a bare letter. */
export function citeList(raw: unknown): string[] {
  const parts = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[\s,;&]+|\band\b/) : [];
  return [...new Set(parts.map((c) => String(c).replace(/^Exhibits?\s*/i, "").trim().toUpperCase()).filter((c) => /^[A-Z]$/.test(c)))];
}

/** The words a sentence quotes as its proof must be in an exhibit it cites (an ellipsis may join two pieces). */
function quoteFound(quote: string, cited: Exhibit[], textOf: (e: Exhibit) => string): boolean {
  // Each line of a quote that spans lines of the record is its own piece, as an ellipsis would make it.
  const pieces = quote
    .split(/\r?\n/)
    .map(norm)
    .join(" … ")
    .replace(/^["'\s]+|["'.\s]+$/g, "")
    .split(/\s?(?:\.\.\.|…)\s?/)
    .map((p) => p.trim().replace(/^["']|["']$/g, ""))
    .filter((p) => p.length > 0);
  if (!pieces.length) return true;
  return cited.some((e) => {
    const t = norm(textOf(e));
    return pieces.every((p) => t.includes(p));
  });
}

export function checkSentence(
  s: { text: string; cites: string[] | string; quote?: string | null },
  exhibits: Exhibit[],
  textOf: (e: Exhibit) => string,
): BriefSentence {
  const cites = citeList(s.cites);
  const quote = typeof s.quote === "string" && s.quote.trim() ? s.quote.trim() : undefined;
  const known = cites.filter((c) => exhibits.some((e) => e.id === c));
  if (!known.length) return strike(s.text, cites, "No exhibit cited.", quote);
  const unknown = cites.filter((c) => !known.includes(c));
  if (unknown.length) return strike(s.text, cites, `Cites Exhibit ${unknown.join(", ")}, which doesn't exist.`, quote);

  const cited = known.map((c) => exhibits.find((e) => e.id === c)!);
  const where = `Exhibit ${known.join(", ")}`;
  if (quote && !quoteFound(quote, cited, textOf)) return strike(s.text, known, `The words it quotes as proof aren't in ${where}: “${clip(quote)}”`, quote);

  const h = held(cited, textOf);

  // A date written with a time must match one record's date and time together, not two different records.
  for (const m of s.text.matchAll(DATETIME)) {
    const pair = `${normDate(m[1])}, ${m[2]}`;
    if (!h.hay.includes(pair)) return strike(s.text, known, `${m[1]}, ${m[2]} isn't in ${where}.`, quote);
  }

  // Every figure and name has to be in what the sentence cites.
  const toks = tokens(s.text);
  for (const t of toks) {
    if (holds(t, h)) continue;
    const what =
      t.kind === "signer" ? `${t.raw} as the person who signed` : t.kind === "carrier" ? `${t.raw} as the carrier` : t.kind === "zip" ? `ZIP ${t.raw}` : t.raw;
    return strike(s.text, known, `${what} isn't in ${where}.`, quote);
  }

  let before: { to: number; events: typeof EVENTS } | null = null;
  for (const c of clauses(s.text)) {
    const own = toks.filter((t) => t.at >= c.from && t.at < c.to);

    // One clause, one record: its dates, times, amounts, places and signer must all sit in a single record.
    const anchored = own.filter((t) => ["money", "date", "day", "time", "zip", "place", "signer"].includes(t.kind));
    if (anchored.length > 1) {
      const scored = h.records.map((r) => {
        const v = view(r.text);
        return { r, has: anchored.filter((t) => holds(t, v)) };
      });
      const best = scored.sort((a, b) => b.has.length - a.has.length)[0];
      if (best && best.has.length < anchored.length) {
        const missing = anchored.find((t) => !best.has.includes(t))!;
        const other = best.has[0];
        return strike(
          s.text,
          known,
          other
            ? `${other.raw} and ${missing.raw} come from different records in ${where}; one statement has to rest on one record.`
            : `${missing.raw} isn't in ${where}.`,
          quote,
        );
      }
    }

    // A date said to be a refund (a delivery, an email...) has to be the date of one in the record.
    // "delivered in Palo Alto and left at the front door on 4 Oct": a clause joined by "and" with no event word
    // of its own carries on the event of the clause before it.
    const named = EVENTS.filter((e) => e.says.test(c.text));
    const joined: boolean = before !== null && /^,?\s(?:and|then)\s$/i.test(s.text.slice(before.to, c.from));
    const events: typeof EVENTS = named.length ? named : joined ? before!.events : [];
    before = { to: c.to, events };
    if (events.length) {
      for (const t of own.filter((x) => x.kind === "date" || x.kind === "day")) {
        const at = h.units.filter((u) => holds(t, view(u.text)));
        if (!at.length) continue;
        const fits = at.some((u) => events.some((e) => e.record.test(u.text) || (u.line && e.kinds?.includes(u.kind ?? ""))));
        if (!fits) {
          const u = at[0];
          return strike(s.text, known, `${t.raw} is in Exhibit ${u.exhibit} as “${clip(u.text)}”, not as the date of ${events[0].name}.`, quote);
        }
      }
    }

    // An amount said to be the disputed amount (a refund, a fee, a limit...) has to be called that in the record.
    for (const t of own.filter((x) => x.kind === "money")) {
      const role = roleOf(c.text, t.at - c.from);
      if (!role) continue;
      const at = h.units.filter((u) => holds(t, view(u.text)));
      if (!at.length) continue;
      if (!at.some((u) => role.record.test(u.text) || role.kinds?.includes(u.kind ?? "")))
        return strike(s.text, known, `${t.raw} is in Exhibit ${at[0].exhibit} as “${clip(at[0].text)}”, not as ${role.name}.`, quote);
    }

    // A denial the record contradicts: the sentence says it never happened; every cited mention says it did.
    // Reported speech ("the buyer reported that it had not arrived") is someone's claim, not the seller's.
    const reported = REPORTING.test(s.text.slice(0, c.to));
    for (const stem of reported ? [] : STEMS) {
      const said = polarity(c.text, stem.re);
      if (!said.includes("no") || said.includes("yes")) continue;
      // "Delivered to sender" is a parcel coming back: it doesn't contradict "not delivered to the buyer".
      // Every line of an exhibit that records a return ("Latest: Delivered" included) is about the return.
      const returned = new Set(h.units.filter((u) => BACK_TO_SENDER.test(u.text)).map((u) => u.exhibit));
      const units = stem.name === "delivered" ? h.units.filter((u) => !returned.has(u.exhibit)) : h.units;
      const found = units.map((u) => ({ u, p: polarity(u.text, stem.re) })).filter((x) => x.p.length);
      const yes = found.filter((x) => x.p.includes("yes"));
      if (yes.length && !found.some((x) => x.p.includes("no"))) {
        return strike(s.text, known, `It says the parcel or payment wasn't ${stem.name}, but Exhibit ${yes[0].u.exhibit} says “${clip(yes[0].u.text)}”.`, quote);
      }
      // "We never shipped order HC-067211", citing only the order: a record that never mentions shipping or
      // delivery can't show that it didn't happen, so the denial rests on nothing.
      // A note or an email can say so in other words ("still on the studio shelf"), so only a denial that cites
      // nothing but structured records is held to this; "no delivery confirmation" is about the evidence.
      if (
        DENIED_NEEDS_RECORD.has(stem.name) &&
        !cited.some((e) => FREE_TEXT.has(e.kind)) &&
        !h.units.some((u) => polarity(u.text, stem.re).length) &&
        !new RegExp(`${stem.re.source}\\s+(?:${EVIDENCE_NOUNS})\\b`, "i").test(c.text)
      ) {
        return strike(s.text, known, `It says it wasn't ${stem.name}, but nothing in ${where} records the ${stem.name === "shipped" ? "shipping" : "delivery"} either way.`, quote);
      }
    }

    // A signature claimed for the parcel has to be on a cited record. "We have no record showing a signature"
    // and "we cannot provide a signature" deny one, however far the negation sits from the word.
    if (polarity(c.text, PARCEL_SIGNATURE).includes("yes") && !CLAUSE_DENIAL.test(c.text)) {
      const shown = h.units.some((u) => polarity(u.text, /\bsign(?:ed|ature)\b/gi).includes("yes"));
      if (!shown) return strike(s.text, known, `Nothing in ${where} shows a signature.`, quote);
    }
  }

  const checked = [...new Set(toks.map((t) => t.raw))];
  return {
    text: s.text,
    cites: known,
    kept: true,
    ...(quote ? { quote } : {}),
    checked,
    ...(checked.length ? {} : { unverified: true as const }),
  };
}

export function checkTally(items: TallyItem[], exhibits: Exhibit[]): TallyItem[] {
  return items
    .map((t) => ({ ...t, cites: citeList(t.cites).filter((c) => exhibits.some((e) => e.id === c)) }))
    .filter((t) => t.cites.length > 0 && (t.side === "seller" || t.side === "buyer"))
    .map((t) => ({ ...t, weight: Math.min(3, Math.max(1, Math.round(t.weight))) as 1 | 2 | 3 }));
}

/** The seller's chance from the tally: weight for the seller over all weight, kept between 3% and 97%. */
export function oddsFrom(items: TallyItem[]): number {
  const seller = items.filter((t) => t.side === "seller").reduce((s, t) => s + t.weight, 0);
  const buyer = items.filter((t) => t.side === "buyer").reduce((s, t) => s + t.weight, 0);
  if (seller + buyer === 0) return 50;
  return Math.max(3, Math.min(97, Math.round((100 * seller) / (seller + buyer))));
}

/** The seller's odds as shown: a refund call never shows the seller ahead, whatever the tally says. */
export const oddsFor = (recommendation: string, odds: number) => (recommendation === "accept" ? Math.min(50, odds) : odds);
