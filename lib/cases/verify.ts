import type { BriefSentence, Exhibit, TallyItem } from "./types";

/**
 * "No claim without a record." A sentence survives only if it cites at least one real exhibit and every
 * figure in it (amounts, dates, times, ids, tracking numbers) appears in the exhibits it cites. Anything else
 * is struck, with the reason shown in the brief.
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

const norm = (s: string) => s.replace(/\s+/g, " ").replace(/,(?=\d{3})/g, "").toLowerCase();
const money = (s: string) => {
  const n = Number(s.replace(/[$,\s]/g, ""));
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
  for (const t of f.times) if (!hay.includes(normTime(t))) return { text: s.text, cites: known, kept: false, why: `${t} isn't in Exhibit ${known.join(", ")}.` };
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
