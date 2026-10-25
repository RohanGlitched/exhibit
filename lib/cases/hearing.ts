import { checkSentence, citeList } from "./verify";
import type { Brief, BriefSentence, Exhibit, Recommendation } from "./types";

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
  raw: { sentence?: unknown; objection?: unknown; ground?: unknown; pages?: unknown }[] | undefined,
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
    out.push({ n: out.length + 1, sentence, text, ground, pages });
    if (out.length >= MAX_OBJECTIONS) break;
  }
  return out;
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
        flipReason ||= o.text;
      }
      if (answer.effect === "withdraw" && o.sentence !== null) withdrawn.add(o.sentence);
      const what = answer.effect === "refund" ? "Exhibit conceded the case and changed its call to refund" : answer.effect === "withdraw" ? "Exhibit conceded and withdrew the sentence" : "Exhibit conceded the point";
      return { objection: o, answer, ruling: "sustained", reason: what, ruledBy: "concession" };
    }
    if (!answer.kept) {
      if (o.sentence !== null) withdrawn.add(o.sentence);
      return { objection: o, answer, ruling: "sustained", reason: `The checker struck the answer (${(answer.why ?? "no record").replace(/\.$/, "")}), so the point stands unanswered`, ruledBy: "checker" };
    }
    const r = (i.rulings ?? []).find((x) => Number(x.objection) === o.n);
    const word: RulingWord = r?.ruling === "overruled" ? "overruled" : "sustained";
    const reason = clip(r?.reason, 300) || (r ? (word === "overruled" ? "The answer is backed by the record" : "The answer doesn't meet the objection") : "The reviewer didn't rule on it, so it is held against the seller");
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
  }
  return { exchanges, after, withdrawn: [...withdrawn].sort((a, b) => a - b), flipped, verdict, agrees: verdict.side === sideOfCall(i.call) };
}

/** A visitor's objection: no reviewer rules on it, so the checker and the concession decide. */
export function ruleChair(answer: Answer): { ruling: RulingWord; reason: string } {
  if (answer.stance === "concede") return { ruling: "sustained", reason: answer.effect === "refund" ? "Exhibit conceded the case" : answer.effect === "withdraw" ? "Exhibit conceded and would withdraw the sentence" : "Exhibit conceded the point" };
  if (!answer.kept) return { ruling: "sustained", reason: `The checker struck the answer: ${(answer.why ?? "no record").replace(/\.$/, "")}` };
  return { ruling: "overruled", reason: `Answered from Exhibit ${answer.cites.join(", ")}, and the checker found every figure there` };
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
export function rulingRequest(h: Pick<Hearing, "verdict">): { outcome: "SELLER_FAVOR" | "BUYER_FAVOR"; summary: string } {
  const reason = h.verdict.reason.replace(/[.\s]+$/, "");
  const who = h.verdict.by === "rules" ? "Ruled by the rules engine (no model reviewer was available)" : "Ruled by the simulated reviewer";
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
  if (h.withdrawn.length) lines.push(`Withdrawn: sentence ${h.withdrawn.map((w) => w + 1).join(", ")}.`);
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
