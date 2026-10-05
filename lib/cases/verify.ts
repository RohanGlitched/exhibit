import type { BriefSentence, Exhibit, TallyItem } from "./types";

/**
 * "No claim without a record." A sentence survives only if it cites at least one real exhibit and every
 * figure in it (amounts, dates, times, ids, tracking numbers) appears in the exhibits it cites. Anything else
 * is struck, with the reason shown in the brief.
 */

const MONEY = /\$\s?\d[\d,]*(?:\.\d{2})?/g;
const DATE = /\b\d{1,2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{4}\b/g;
const TIME = /\b\d{2}:\d{2}\b/g;
const DATETIME = /\b(\d{1,2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{4}),? (?:at )?(\d{2}:\d{2})\b/g;
const ID = /\b(?=[A-Z0-9-]*\d)(?=[A-Z0-9-]*[A-Z])[A-Z0-9-]{8,}\b|\b\d{9,}\b/g;

const norm = (s: string) => s.replace(/\s+/g, " ").replace(/,(?=\d{3})/g, "").toLowerCase();
const money = (s: string) => {
  const n = Number(s.replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n.toFixed(2) : s;
};
const MONTH_FULL: Record<string, string> = {
  january: "jan", february: "feb", march: "mar", april: "apr", june: "jun", july: "jul",
  august: "aug", september: "sep", october: "oct", november: "nov", december: "dec",
};
const normDate = (s: string) => {
  const [d, m, y] = s.toLowerCase().split(" ");
  return `${d} ${MONTH_FULL[m] ?? m.slice(0, 3)} ${y}`;
};

export function figures(text: string) {
  return {
    money: [...text.matchAll(MONEY)].map((m) => m[0]),
    dates: [...text.matchAll(DATE)].map((m) => m[0]),
    times: [...text.matchAll(TIME)].map((m) => m[0]),
    ids: [...text.matchAll(ID)].map((m) => m[0]),
  };
}

export function checkSentence(
  s: { text: string; cites: string[] },
  exhibits: Exhibit[],
  textOf: (e: Exhibit) => string,
): BriefSentence {
  const cites = [...new Set((s.cites ?? []).map((c) => c.trim().toUpperCase()))];
  const known = cites.filter((c) => exhibits.some((e) => e.id === c));
  if (!known.length) return { text: s.text, cites, kept: false, why: "No exhibit cited." };
  const unknown = cites.filter((c) => !known.includes(c));
  if (unknown.length) return { text: s.text, cites, kept: false, why: `Cites Exhibit ${unknown.join(", ")}, which doesn't exist.` };

  const body = known.map((c) => textOf(exhibits.find((e) => e.id === c)!)).join("\n");
  const hay = norm(body);
  const amounts = new Set([...body.matchAll(MONEY)].map((m) => money(m[0])));
  const dates = new Set([...body.matchAll(DATE)].map((m) => normDate(m[0])));
  const f = figures(s.text);

  // A date written with a time must match one record's date and time together, not two different records.
  for (const m of s.text.matchAll(DATETIME)) {
    const pair = `${normDate(m[1])}, ${m[2]}`;
    if (!hay.includes(pair)) return { text: s.text, cites: known, kept: false, why: `${m[1]}, ${m[2]} isn't in Exhibit ${known.join(", ")}.` };
  }
  for (const m of f.money) if (!amounts.has(money(m))) return { text: s.text, cites: known, kept: false, why: `${m} isn't in Exhibit ${known.join(", ")}.` };
  for (const d of f.dates) if (!dates.has(normDate(d))) return { text: s.text, cites: known, kept: false, why: `${d} isn't in Exhibit ${known.join(", ")}.` };
  for (const t of f.times) if (!hay.includes(t)) return { text: s.text, cites: known, kept: false, why: `${t} isn't in Exhibit ${known.join(", ")}.` };
  for (const id of f.ids) if (!hay.includes(id.toLowerCase())) return { text: s.text, cites: known, kept: false, why: `${id} isn't in Exhibit ${known.join(", ")}.` };
  return { text: s.text, cites: known, kept: true };
}

export function checkTally(items: TallyItem[], exhibits: Exhibit[]): TallyItem[] {
  return items
    .map((t) => ({ ...t, cites: [...new Set((t.cites ?? []).map((c) => c.trim().toUpperCase()))].filter((c) => exhibits.some((e) => e.id === c)) }))
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
