/**
 * What the brief says under each sentence, from the checker's own fields. Pure and client-safe: the brief, the
 * hero and the desk's detail rows all word a sentence the same way.
 * - struck: the checker couldn't match it to the record it cites;
 * - withdrawn: Exhibit conceded it at the hearing on the draft (not a checker strike);
 * - checked: its figures and names were matched to the record;
 * - quoted: nothing in it to match, but the words it quotes were found, verbatim, in the exhibit it cites;
 * - unverified: neither, so it rests on its citation alone.
 */
import type { BriefSentence, Exhibit } from "./types";

export type SentenceKind = "struck" | "withdrawn" | "checked" | "quoted" | "unverified" | "kept";

export interface SentenceState {
  kind: SentenceKind;
  /** The exhibit a quoted sentence's words were found in. */
  exhibit?: string;
}

type Sentence = Pick<BriefSentence, "kept" | "why" | "cites" | "quote" | "checked" | "unverified">;

export const isWithdrawn = (s: Pick<BriefSentence, "kept" | "why">) => !s.kept && /^Withdrawn at the hearing/.test(s.why ?? "");

const norm = (t: string) =>
  t
    .toLowerCase()
    .replace(/[“”"‘’']/g, "")
    .replace(/\s+/g, " ")
    .trim();

/** An exhibit as plain text, for finding which cited exhibit holds a quote. */
const textOf = (e: Exhibit) => norm([e.title, e.ref ?? "", ...e.facts.map((f) => `${f.label}: ${f.value}`), ...(e.lines ?? [])].join("\n"));

/** Which of the cited exhibits holds the quoted words (each piece of a quote joined by an ellipsis, in one exhibit). */
export function quoteExhibit(quote: string, cites: string[], exhibits: Exhibit[] | undefined): string | undefined {
  if (cites.length === 1) return cites[0];
  const pieces = quote.split(/…|\.\.\./).map(norm).filter((p) => p.length > 0);
  if (!pieces.length || !exhibits?.length) return undefined;
  for (const c of cites) {
    const e = exhibits.find((x) => x.id === c);
    if (e && pieces.every((p) => textOf(e).includes(p))) return c;
  }
  return undefined;
}

export function sentenceState(s: Sentence, exhibits?: Exhibit[]): SentenceState {
  if (!s.kept) return { kind: isWithdrawn(s) ? "withdrawn" : "struck" };
  if (s.checked?.length) return { kind: "checked" };
  // A kept sentence's quote was found verbatim in a cited exhibit: the checker strikes it otherwise.
  if (s.quote) return { kind: "quoted", exhibit: quoteExhibit(s.quote, s.cites, exhibits) };
  if (s.unverified) return { kind: "unverified" };
  return { kind: "kept" };
}

/** The line under a sentence, or null when it needs none (a kept sentence whose figures matched shows them on hover). */
export function stateLine(s: Sentence & { why?: string }, state: SentenceState): string | null {
  switch (state.kind) {
    case "struck":
      return `Struck before filing: ${s.why ?? "it doesn't match the record it cites."}`;
    case "withdrawn": {
      // applyHearing writes "Withdrawn at the hearing after objection 2: <the objection>".
      const m = (s.why ?? "").match(/^Withdrawn at the hearing after (objection \d+): ([\s\S]+)$/);
      return m ? `Withdrawn at the hearing before filing, after ${m[1]}: ${m[2]}` : "Withdrawn at the hearing before filing; not a checker strike.";
    }
    case "quoted":
      return `Quote matched in Exhibit ${state.exhibit ?? s.cites.join(" or ")}`;
    case "unverified":
      return "Unverified: no figure or name in it to check, so it rests on its citation.";
    default:
      return null;
  }
}

export interface BriefCounts {
  kept: number;
  /** Struck by the checker; a sentence withdrawn at the hearing is not one. */
  struck: number;
  withdrawn: number;
  /** Kept sentences the checker matched to the record: by their figures and names, or by the words they quote. */
  checked: number;
  quoted: number;
  unverified: number;
}

export function briefCounts(sentences: Sentence[]): BriefCounts {
  const kinds = sentences.map((s) => sentenceState(s).kind);
  const n = (k: SentenceKind) => kinds.filter((x) => x === k).length;
  return {
    kept: sentences.filter((s) => s.kept).length,
    struck: n("struck"),
    withdrawn: n("withdrawn"),
    checked: n("checked") + n("quoted"),
    quoted: n("quoted"),
    unverified: n("unverified"),
  };
}
