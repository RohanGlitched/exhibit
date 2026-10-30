import { checkSentence, citeList } from "./verify";
import type { Brief, BriefSentence, Exhibit, Recommendation } from "./types";
import { pressable, type RequirementsCard } from "./requirements";

/**
 * Cross-examination, the deterministic half. A second model plays PayPal's reviewer: it reads only the PDF
 * PayPal holds (or the one Exhibit would file), objects to the response sentence by sentence, and rules on
 * Exhibit's answers. Everything that decides an outcome is here, in pure functions with unit tests:
 * - an answer counts only if the same checker that guards the brief keeps it (every figure in the exhibits it
 *   cites); a struck answer is no answer, and the sentence it defended is withdrawn;
 * - a concession is always sustained, and either withdraws the sentence or flips Exhibit's call to refund;
 * - the reviewer's verdict stands unless Exhibit conceded the case or withdrew every sentence, which hands it
 *   to the buyer whatever the reviewer wrote.
 * Safe to import from client components.
 */

export type Ground = "unsupported" | "contradicted" | "omits" | "unanswered";

export const GROUNDS: Ground[] = ["unsupported", "contradicted", "omits", "unanswered"];

export const GROUND_LABEL: Record<Ground, string> = {
  unsupported: "the cited page doesn't show it",
  contradicted: "another page contradicts it",
  omits: "it leaves out what favours the buyer",
  unanswered: "it doesn't answer the claim",
};

export const MAX_OBJECTIONS = 4;

export type Side = "seller" | "buyer";

export interface Objection {
  n: number; // 1-based, as read out at the hearing
  sentence: number | null; // 0-based index into the response as read; null = the response as a whole
  text: string;
  ground: Ground;
  pages: string[]; // Bates labels the reviewer relied on, as printed on the PDF
  /** The requirements-card item it presses (lib/cases/requirements.ts), when it presses one. */
  requirement?: string;
  /** Raised by code from the requirements card because the reviewer left that item alone. */
  pressed?: true;
}

export interface Answer {
  stance: "answer" | "concede";
  text: string;
  cites: string[];
  kept: boolean; // the checker kept it (a concession is always "kept": it states no fact)
  why?: string; // why the checker struck it
  effect: "none" | "withdraw" | "refund"; // what a concession does
}

export type RulingWord = "sustained" | "overruled";

export interface Exchange {
  objection: Objection;
  answer: Answer;
  ruling: RulingWord;
  reason: string;
  ruledBy: "reviewer" | "checker" | "concession";
}

export interface Verdict {
  side: Side;
  reason: string;
  by: "reviewer" | "concession" | "rules";
  /** The verdict for the seller still rests on a point the hearing sustained against the seller, after one re-ask. */
  caveat?: string;
}

export interface Hearing {
  at: string;
  /** cross: objections and answers on a response; record: a second opinion on the exhibits alone (Exhibit advised a refund). */
  mode: "cross" | "record";
  /** What the reviewer read: the PDF PayPal holds for the case, or the PDF Exhibit would file. */
  source: "paypal" | "draft";
  pages: string[]; // Bates labels of every page read
  response: { text: string; cites: string[] }[];
  exchanges: Exchange[];
  call: Recommendation; // Exhibit's call going in
  after: Recommendation; // Exhibit's call once the concessions are applied
  withdrawn: number[]; // indexes into `response`
  flipped: boolean;
  verdict: Verdict;
  agrees: boolean; // the reviewer's verdict matches Exhibit's call going in
  engine: "model" | "rules";
  model?: string;
  ms: number;
  calls: number;
  tokens?: { input: number; output: number };
  /** The reviewer was asked once more: objections it left unruled, and sustained points its verdict leaned on. */
  reasked?: { unruled: number[]; rests: number[] };
  /** On the hearing a ruling request followed: how the repeat hearings of PayPal's copy split (lib/cases/hearing.ts tallyPanel). */
  panel?: Panel;
}

/**
 * Repeat hearings of one copy, before Exhibit asks PayPal for a ruling: the reviewer is one model call that can
 * land on either side of a close case, so the copy is heard up to three times and the ruling follows two that
 * agree. A verdict for the seller still resting on a point the hearing sustained (Verdict.caveat) is no clean vote
 * for the seller, so it counts as flagged, for neither side.
 */
export const PANEL_SIZE = 3;
export const PANEL_MAJORITY = 2;

export interface Panel {
  seller: number;
  buyer: number;
  flagged: number;
  heard: number;
  /** The side two hearings agree on, or null. */
  majority: Side | null;
  /** When each hearing counted was held (Hearing.at), oldest first. */
  hearings: string[];
}

export const panelVote = (h: Pick<Hearing, "verdict">): Side | "flagged" => (h.verdict.side === "seller" && h.verdict.caveat ? "flagged" : h.verdict.side);

export function tallyPanel(hs: Pick<Hearing, "verdict" | "at">[]): Panel {
  const counted = [...hs].sort((a, b) => a.at.localeCompare(b.at)).slice(0, PANEL_SIZE);
  const votes = counted.map(panelVote);
  const seller = votes.filter((v) => v === "seller").length;
  const buyer = votes.filter((v) => v === "buyer").length;
  const majority: Side | null = seller >= PANEL_MAJORITY ? "seller" : buyer >= PANEL_MAJORITY ? "buyer" : null;
  return { seller, buyer, flagged: votes.length - seller - buyer, heard: counted.length, majority, hearings: counted.map((h) => h.at) };
}

/** How many more hearings the panel needs: none once two agree or three are heard, else enough to reach two, then one. */
export const panelNeeds = (p: Panel) => (p.majority || p.heard >= PANEL_SIZE ? 0 : Math.max(1, PANEL_MAJORITY - p.heard));

/** "2 of 3 hearings for the seller", "2 of 2 hearings for the buyer". */
export const panelWords = (p: Panel) =>
  p.majority
    ? `${p.majority === "seller" ? p.seller : p.buyer} of ${p.heard} hearings for the ${p.majority}`
    : `no two of ${p.heard} hearings agree (${[p.seller ? `${p.seller} for the seller` : "", p.buyer ? `${p.buyer} for the buyer` : "", p.flagged ? `${p.flagged} for the seller on a sustained point` : ""].filter(Boolean).join(", ")})`;

/** The hearing a majority ruling follows: the latest of the majority's hearings, with the panel on it. */
export function panelHearing<H extends Hearing>(hs: H[], p: Panel): H | null {
  if (!p.majority) return null;
  const h = hs.filter((x) => p.hearings.includes(x.at) && panelVote(x) === p.majority).sort((a, b) => a.at.localeCompare(b.at)).at(-1);
  return h ? { ...h, panel: p } : null;
}

/** Who raised an objection, as the case page says it: null for the reviewer's own, a line for one the card put. */
export function objectionOrigin(h: Pick<Hearing, "exchanges">, o: Pick<Objection, "pressed">): string | null {
  if (!o.pressed) return null;
  return h.exchanges.some((e) => !e.objection.pressed)
    ? "Put to proof from the requirements card, on an item the reviewer left alone."
    : "Put to proof from the requirements card; the reviewer raised no objection of its own.";
}

/** One objection a visitor raised from the reviewer's chair. Never saved. */
export interface ChairExchange {
  objection: Objection;
  answer: Answer;
  ruling: RulingWord;
  reason: string;
  ms: number;
  engine: "model";
}

export const sideOfCall = (r: Recommendation): Side => (r === "fight" ? "seller" : "buyer");

const clip = (s: unknown, n: number) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

/** The reviewer's objections as the model gave them, cleaned: sentence numbers checked, duplicates and empties dropped, at most four. */
export function normaliseObjections(
  raw: { sentence?: unknown; objection?: unknown; ground?: unknown; pages?: unknown; requirement?: unknown }[] | undefined,
  responseLength: number,
): Objection[] {
  const out: Objection[] = [];
  for (const o of raw ?? []) {
    const text = clip(o.objection, 400);
    if (text.length < 8) continue;
    const num = Number(o.sentence);
    const sentence = Number.isInteger(num) && num >= 1 && num <= responseLength ? num - 1 : null;
    if (out.some((x) => x.sentence === sentence && x.text.toLowerCase() === text.toLowerCase())) continue;
    const ground = GROUNDS.includes(o.ground as Ground) ? (o.ground as Ground) : sentence === null ? "unanswered" : "unsupported";
    const pages = (Array.isArray(o.pages) ? o.pages : typeof o.pages === "string" ? o.pages.split(/[\s,;]+/) : [])
      .map((p) => String(p).toUpperCase().trim())
      .filter((p) => /^HC-\d{6}$/.test(p))
      .slice(0, 4);
    const requirement = typeof o.requirement === "string" && /^[a-z0-9-]{2,20}$/.test(o.requirement) && o.requirement !== "none" ? o.requirement : undefined;
    out.push({ n: out.length + 1, sentence, text, ground, pages, ...(requirement ? { requirement } : {}) });
    if (out.length >= MAX_OBJECTIONS) break;
  }
  return out;
}

/**
 * The reviewer's objections, pressed by the requirements card: every weak or missing item the response leans on
 * or the reason code requires gets an objection, the reviewer's own if it raised one on that item, else one from
 * the card. A fight the reviewer let through untouched is put to proof on the item it turns on. Card items come
 * first, then the reviewer's other objections, at most four in all.
 */
export function pressObjections(
  objections: Objection[],
  card: RequirementsCard | null,
  response: { text: string; cites: string[] }[],
  pageOf: (exhibit: string) => string | undefined,
): Objection[] {
  if (!card) return objections;
  const press = pressable(card, response);
  const pages = (ids: string[]) => ids.map(pageOf).filter((p): p is string => !!p).slice(0, 4);
  const onCard: Objection[] = [];
  for (const item of press) {
    const own = objections.find((o) => o.requirement === item.id);
    onCard.push(own ?? { n: 0, sentence: null, text: item.ask, ground: item.status === "missing" ? "unanswered" : "unsupported", pages: pages(item.exhibits), requirement: item.id, pressed: true });
  }
  const rest = objections.filter((o) => !onCard.includes(o));
  let all = [...onCard, ...rest];
  if (!all.length && response.length) {
    // Nothing weak on the card and no objection: make the seller show the item the case turns on.
    const decisive = card.items.find((i) => i.required && i.status === "on file") ?? card.items.find((i) => i.status === "on file");
    if (decisive)
      all = [{ n: 0, sentence: null, text: `Show on the pages ${decisive.need.toLowerCase()}: where exactly is it?`, ground: "unsupported", pages: pages(decisive.exhibits), requirement: decisive.id, pressed: true }];
  }
  return all.slice(0, MAX_OBJECTIONS).map((o, k) => ({ ...o, n: k + 1 }));
}

/**
 * Exhibit's answers, matched to the objections and run through the checker. A missing answer counts as a
 * concession that changes nothing; an answer with no exhibit cited is struck like any brief sentence.
 */
export function checkAnswers(
  objections: Objection[],
  raw: { objection?: unknown; stance?: unknown; text?: unknown; cites?: unknown; effect?: unknown }[] | undefined,
  exhibits: Exhibit[],
  textOf: (e: Exhibit) => string,
): Answer[] {
  return objections.map((o) => {
    const a = (raw ?? []).find((x) => Number(x.objection) === o.n);
    if (!a) return { stance: "concede", text: "No answer.", cites: [], kept: true, effect: "none" };
    const text = clip(a.text, 500) || (a.stance === "concede" ? "Conceded." : "");
    if (a.stance === "concede") {
      const effect = a.effect === "refund" ? "refund" : a.effect === "withdraw" && o.sentence !== null ? "withdraw" : "none";
      return { stance: "concede", text, cites: citeList(a.cites), kept: true, effect };
    }
    const c = checkSentence({ text, cites: (a.cites as string[] | string) ?? [] }, exhibits, textOf);
    return { stance: "answer", text, cites: c.cites, kept: c.kept, why: c.why, effect: "none" };
  });
}

export interface SettleInput {
  call: Recommendation;
  response: { text: string; cites: string[] }[];
  objections: Objection[];
  answers: Answer[];
  rulings?: { objection?: unknown; ruling?: unknown; reason?: unknown }[];
  verdict?: { side?: unknown; reason?: unknown };
  /** The reviewer was already asked a second time, so an objection still unruled is held against the seller. */
  reasked?: boolean;
}

const RULED = (r: { ruling?: unknown }) => r.ruling === "overruled" || r.ruling === "sustained";

/** Objections with an answer the checker kept that the reviewer gave no ruling on: they are asked again, once. */
export function unruledObjections(objections: Objection[], answers: Answer[], rulings: SettleInput["rulings"]): number[] {
  return objections
    .filter((o, k) => answers[k]?.stance === "answer" && answers[k].kept && !(rulings ?? []).some((r) => Number(r.objection) === o.n && RULED(r)))
    .map((o) => o.n);
}

/** What a requirements-card item is about, as a verdict's reason would put it. */
const TOPIC: Record<string, RegExp> = {
  return: /\breturns?\b|\breturn policy\b/i,
  returned: /\breturn(?:ed|s)?\b|\bkept\b|\bkeep(?:s|ing)?\b/i,
  disclosure: /\bdisclos|\bwarn|\bvar(?:y|ies|iation)\b|\bshifts?\b/i,
  listing: /\blisting\b|\bdescri/i,
  tracking: /\btracking\b|\btracker\b/i,
  delivered: /\bdeliver/i,
  window: /\bbefore the (?:dispute|case|claim)\b|\bin time\b|\bwithin \d+ days\b/i,
  address: /\baddress\b|\bZIP\b|\bpostal code\b/i,
  signature: /\bsign(?:ed|ature)\b/i,
  "avs-cvv": /\baddress check|\bsecurity[- ]code|\bAVS\b|\bCVV\b/i,
  "3ds": /3-?D[- ]?Secure|\b3DS\b|\bliability shift/i,
  prior: /\b(?:earlier|prior|previous|past) (?:undisputed )?orders?\b|\border history\b|\breturning customer\b/i,
  device: /\bdevice\b|\bIP\b/i,
  "ship-billing": /\bbilling\b/i,
  admission: /\badmit|\backnowledg|\brecogni[sz]e/i,
  mandate: /\bmandate\b|\bintent\b/i,
  credit: /\brefund(?:ed)?\b|\bcredit(?:ed)?\b/i,
  original: /\boriginal (?:charge|payment)\b/i,
};

const topicsIn = (text: string) => Object.keys(TOPIC).filter((k) => TOPIC[k].test(text));

/**
 * What an exchange is about, as TOPIC names it: the requirements-card item it presses, or, when it names none the
 * card knows, what its question asks about. An objection to the response as a whole is about whatever Exhibit put
 * up against it too: when the checker struck that answer, the subjects it named ("two earlier undisputed orders...
 * the same device and IP address") stand unproven at this hearing.
 */
export function exchangeTopics(e: Pick<Exchange, "objection" | "answer" | "ruledBy">): string[] {
  const req = e.objection.requirement;
  const own = req && TOPIC[req] ? [req] : [];
  const asked = !own.length || e.objection.sentence === null ? topicsIn(e.objection.text) : [];
  const struck = e.objection.sentence === null && e.ruledBy === "checker" && e.answer.stance === "answer" && !e.answer.kept ? topicsIn(e.answer.text) : [];
  return [...new Set([...own, ...asked, ...struck])];
}

/**
 * The points a verdict for the seller rests on that the hearing sustained against the seller: an objection
 * sustained by the reviewer, by the checker striking the answer, or by a concession that withdrew the sentence,
 * whose subject (exchangeTopics) the verdict's reason names. A concession that changes nothing doesn't count.
 */
export function restsOnSustained(verdict: Pick<Verdict, "side" | "reason" | "by">, exchanges: Exchange[]): Exchange[] {
  if (verdict.side !== "seller" || verdict.by !== "reviewer") return [];
  return exchanges.filter(
    (e) =>
      e.ruling === "sustained" &&
      !(e.ruledBy === "concession" && e.answer.effect === "none") &&
      exchangeTopics(e).some((t) => TOPIC[t].test(verdict.reason)),
  );
}

/** Rules every exchange and the case. Only an answer the checker kept can be overruled, and only by the reviewer. */
export function settle(i: SettleInput): Pick<Hearing, "exchanges" | "after" | "withdrawn" | "flipped" | "verdict" | "agrees"> {
  const withdrawn = new Set<number>();
  let flipped = false;
  let flipReason = "";
  const exchanges: Exchange[] = i.objections.map((o, k) => {
    const answer = i.answers[k] ?? { stance: "concede", text: "No answer.", cites: [], kept: true, effect: "none" };
    if (answer.stance === "concede") {
      if (answer.effect === "refund") {
        flipped = true;
        flipReason ||= answer.text;
      }
      if (answer.effect === "withdraw" && o.sentence !== null) withdrawn.add(o.sentence);
      const what = answer.effect === "refund" ? "Exhibit conceded the case and changed its call to refund" : answer.effect === "withdraw" ? "Exhibit conceded and withdrew the sentence" : "Exhibit conceded the point";
      return { objection: o, answer, ruling: "sustained", reason: what, ruledBy: "concession" };
    }
    if (!answer.kept) {
      if (o.sentence !== null) withdrawn.add(o.sentence);
      return { objection: o, answer, ruling: "sustained", reason: `The checker struck the answer (${(answer.why ?? "no record").replace(/\.$/, "")}), so the point stands unanswered`, ruledBy: "checker" };
    }
    // The reviewer's ruling on this objection: one that says sustained or overruled (a later, re-asked one wins).
    const r = (i.rulings ?? []).filter((x) => Number(x.objection) === o.n && RULED(x)).at(-1);
    const word: RulingWord = r?.ruling === "overruled" ? "overruled" : "sustained";
    const reason =
      clip(r?.reason, 300) ||
      (r
        ? word === "overruled"
          ? "The answer is backed by the record"
          : "The answer doesn't meet the objection"
        : i.reasked
          ? "The reviewer didn't rule on it, asked twice, so it is held against the seller"
          : "The reviewer didn't rule on it, so it is held against the seller");
    return { objection: o, answer, ruling: word, reason, ruledBy: "reviewer" };
  });

  const remaining = i.response.filter((_, k) => !withdrawn.has(k)).length;
  const after: Recommendation = flipped ? "accept" : i.call;
  let verdict: Verdict;
  if (flipped) verdict = { side: "buyer", reason: `Exhibit conceded the case at the hearing: ${flipReason.replace(/[.?]$/, "")}`, by: "concession" };
  else if (i.call === "fight" && i.response.length > 0 && remaining === 0) verdict = { side: "buyer", reason: "Every sentence of the response was withdrawn at the hearing", by: "concession" };
  else {
    // No verdict from the reviewer is held against the seller, who carries the burden.
    const side: Side = i.verdict?.side === "seller" ? "seller" : "buyer";
    const reason = clip(i.verdict?.reason, 300).replace(/\.$/, "") || (side === "seller" ? "The filed records support the seller" : "The filed records don't carry the seller's case");
    verdict = { side, reason, by: "reviewer" };
    // A verdict for the seller that leans on a point the hearing sustained against the seller is flagged, not hidden.
    const rests = restsOnSustained(verdict, exchanges);
    if (rests.length) {
      const which = rests.map((e) => e.objection.n).join(" and ");
      verdict.caveat = `It rests on objection ${which}, which the hearing sustained against the seller`;
      verdict.reason = `${reason} (but objection ${which}, which this rests on, was sustained against the seller)`;
    }
  }
  return { exchanges, after, withdrawn: [...withdrawn].sort((a, b) => a - b), flipped, verdict, agrees: verdict.side === sideOfCall(i.call) };
}

/** A visitor's objection: no reviewer rules on it, so the checker and the concession decide. */
export function ruleChair(answer: Answer): { ruling: RulingWord; reason: string } {
  if (answer.stance === "concede") return { ruling: "sustained", reason: answer.effect === "refund" ? "Exhibit conceded the case" : answer.effect === "withdraw" ? "Exhibit conceded and would withdraw the sentence" : "Exhibit conceded the point" };
  if (!answer.kept) return { ruling: "sustained", reason: `The checker struck the answer: ${(answer.why ?? "no record").replace(/\.$/, "")}` };
  return { ruling: "overruled", reason: `Answered from Exhibit ${answer.cites.join(", ")}, and the checker kept the answer` };
}

/**
 * A hearing on a draft changes the brief before anything is filed: withdrawn sentences are struck with the
 * objection as the reason, and a conceded case becomes a refund. A hearing on a filed case changes nothing
 * PayPal holds; its verdict is what the ruling request follows.
 */
export function applyHearing(brief: Brief, h: Hearing): Brief {
  if (h.source !== "draft" || h.mode !== "cross") return brief;
  const keptIdx = brief.sentences.map((s, k) => (s.kept ? k : -1)).filter((k) => k >= 0);
  const sentences: BriefSentence[] = brief.sentences.map((s) => ({ ...s }));
  for (const w of h.withdrawn) {
    const k = keptIdx[w];
    if (k === undefined) continue;
    const ex = h.exchanges.find((e) => e.objection.sentence === w);
    sentences[k] = { ...sentences[k], kept: false, why: ex ? `Withdrawn at the hearing after objection ${ex.objection.n}: ${ex.objection.text}` : "Withdrawn at the hearing." };
  }
  if (!h.flipped) return { ...brief, sentences };
  return {
    ...brief,
    sentences,
    recommendation: "accept",
    offerAmount: undefined,
    headline: `Conceded at the hearing: ${h.verdict.reason.replace(/^Exhibit conceded the case at the hearing: /, "")}. Refund and close it.`,
  };
}

/** The outcome Exhibit asks the sandbox for, and the line the case shows. */
export function rulingRequest(h: Pick<Hearing, "verdict" | "panel">): { outcome: "SELLER_FAVOR" | "BUYER_FAVOR"; summary: string } {
  const reason = h.verdict.reason.replace(/[.\s]+$/, "");
  const who =
    h.verdict.by === "rules"
      ? "Ruled by the rules engine (no model reviewer was available)"
      : `Ruled by the simulated reviewer${h.panel?.majority ? `, ${panelWords(h.panel)}` : ""}`;
  return { outcome: h.verdict.side === "seller" ? "SELLER_FAVOR" : "BUYER_FAVOR", summary: `${who}: ${reason}` };
}

/** Without a model the ruling follows the filing, as it did before cross-examination, and says so. */
export function rulesHearing(call: Recommendation, odds: number, fought: boolean, response: Hearing["response"], source: Hearing["source"]): Hearing {
  const side: Side = fought && odds >= 50 ? "seller" : "buyer";
  return {
    at: new Date().toISOString(),
    mode: call === "accept" ? "record" : "cross",
    source,
    pages: [],
    response,
    exchanges: [],
    call,
    after: call,
    withdrawn: [],
    flipped: false,
    verdict: { side, reason: side === "seller" ? `the filed response holds ${odds}% of the evidence balance for the seller` : fought ? `the filed response holds only ${odds}% of the evidence balance for the seller` : "the seller accepted the claim", by: "rules" },
    agrees: side === sideOfCall(call),
    engine: "rules",
    ms: 0,
    calls: 0,
  };
}

/**
 * The bounded repair step: each sentence the checker struck gets one re-cite from the model. A repaired
 * sentence replaces the struck one only if the same checker keeps it; otherwise the strike stands, noting
 * that the re-cite failed too. Kept sentences are never touched.
 */
export function acceptRepairs(
  sentences: BriefSentence[],
  repairs: { index?: unknown; text?: unknown; cites?: unknown }[] | undefined,
  exhibits: Exhibit[],
  textOf: (e: Exhibit) => string,
): { sentences: BriefSentence[]; tried: number; fixed: number } {
  let tried = 0;
  let fixed = 0;
  const out = sentences.map((s, k) => {
    if (s.kept) return s;
    const r = (repairs ?? []).find((x) => Number(x.index) === k + 1);
    const text = clip(r?.text, 400);
    if (!r || !text) return s;
    tried++;
    const c = checkSentence({ text, cites: (r.cites as string[] | string) ?? [] }, exhibits, textOf);
    if (!c.kept) return { ...s, why: `${s.why ?? "Struck."} One re-cite was tried and struck too: ${c.why}` };
    fixed++;
    return { text: c.text, cites: c.cites, kept: true, repaired: { from: s.text, fromCites: s.cites, why: s.why ?? "Struck." } };
  });
  return { sentences: out, tried, fixed };
}

/** "Re-cited to Exhibit C", or "Reworded to match Exhibit C" when the text changed as well. */
export function repairLabel(s: BriefSentence): string | null {
  if (!s.repaired) return null;
  const to = `Exhibit${s.cites.length > 1 ? "s" : ""} ${s.cites.join(", ")}`;
  return s.repaired.from.trim() === s.text.trim() ? `Repaired: re-cited to ${to}` : `Repaired: reworded and re-cited to ${to}`;
}

/** The hearing as plain text, for the MCP tool. */
export function transcriptText(h: Hearing): string {
  const lines: string[] = [];
  lines.push(
    h.mode === "record"
      ? `Second opinion on the record (${h.pages.length} pages of the ${h.source === "paypal" ? "PDF PayPal holds" : "PDF Exhibit would file"}).`
      : `Cross-examination on the ${h.source === "paypal" ? "PDF PayPal holds" : "PDF Exhibit would file"} (${h.pages.length} pages, ${h.response.length} response sentences).`,
  );
  for (const e of h.exchanges) {
    const target = e.objection.sentence === null ? "the response as a whole" : `sentence ${e.objection.sentence + 1}: "${h.response[e.objection.sentence]?.text ?? ""}"`;
    lines.push(`OBJECTION ${e.objection.n} to ${target} (${GROUND_LABEL[e.objection.ground]}${e.objection.pages.length ? `; ${e.objection.pages.join(", ")}` : ""})`);
    lines.push(`Q. ${e.objection.text}`);
    if (e.answer.stance === "concede") lines.push(`A. (concedes) ${e.answer.text}`);
    else lines.push(`A. ${e.answer.text} [${e.answer.cites.join(", ")}]${e.answer.kept ? "" : ` (struck by the checker: ${e.answer.why})`}`);
    lines.push(`${e.ruling.toUpperCase()}. ${e.reason}.`);
  }
  if (h.withdrawn.length)
    lines.push(
      h.source === "paypal"
        ? `Sentence ${h.withdrawn.map((w) => w + 1).join(", ")} conceded at the hearing; still in the PDF PayPal holds.`
        : `Withdrawn: sentence ${h.withdrawn.map((w) => w + 1).join(", ")}.`,
    );
  if (h.flipped) lines.push("Exhibit changed its call to refund.");
  lines.push(`Verdict for the ${h.verdict.side}: ${h.verdict.reason}.`);
  lines.push(h.agrees ? "The reviewer agrees with Exhibit's call." : "The reviewer disagrees with Exhibit's call.");
  return lines.join("\n");
}

export interface HearingStats {
  hearings: number;
  cross: number;
  objections: number;
  answered: number;
  answersKept: number;
  answersStruck: number;
  conceded: number;
  overruled: number;
  sustained: number;
  withdrawn: number;
  flipped: number;
  agree: number;
  agreeAfter: number;
}

/** Totals over a set of hearings, for /proof. */
export function hearingStats(hs: Hearing[]): HearingStats {
  const ex = hs.flatMap((h) => h.exchanges);
  return {
    hearings: hs.length,
    cross: hs.filter((h) => h.mode === "cross").length,
    objections: ex.length,
    answered: ex.filter((e) => e.answer.stance === "answer").length,
    answersKept: ex.filter((e) => e.answer.stance === "answer" && e.answer.kept).length,
    answersStruck: ex.filter((e) => e.answer.stance === "answer" && !e.answer.kept).length,
    conceded: ex.filter((e) => e.answer.stance === "concede").length,
    overruled: ex.filter((e) => e.ruling === "overruled").length,
    sustained: ex.filter((e) => e.ruling === "sustained").length,
    withdrawn: hs.reduce((n, h) => n + h.withdrawn.length, 0),
    flipped: hs.filter((h) => h.flipped).length,
    agree: hs.filter((h) => h.agrees).length,
    agreeAfter: hs.filter((h) => h.verdict.side === sideOfCall(h.after)).length,
  };
}
