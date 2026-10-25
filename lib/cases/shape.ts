/**
 * The brief's shape, checked in code. Bedrock's Converse API doesn't enforce a tool schema the way a strict
 * function call does, so argueWithModel (lib/cases/brief.ts) reads the tool input through these: arrays sent
 * as a JSON string are read back, a brief in the wrong shape is asked for once more, and a sentence in the
 * wrong shape is struck rather than guessed at.
 */

/** Arrays a model sometimes sends as a JSON string ("[{...}]") are read back as arrays. */
export function normaliseBrief(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const o = { ...(raw as Record<string, unknown>) };
  for (const k of ["tally", "response", "evidence_types"]) {
    if (typeof o[k] === "string") {
      try {
        o[k] = JSON.parse(o[k] as string);
      } catch {
        /* left as is; briefProblems reports it */
      }
    }
  }
  return o;
}

/** What is wrong with a brief's shape, field by field; empty when it matches the tool schema's required parts. */
export function briefProblems(raw: unknown, offerAllowed: boolean): string[] {
  if (!raw || typeof raw !== "object") return ["not an object"];
  const o = raw as Record<string, unknown>;
  const out: string[] = [];
  if (!(offerAllowed ? ["fight", "offer", "accept"] : ["fight", "accept"]).includes(o.recommendation as string)) out.push("recommendation");
  if (typeof o.headline !== "string") out.push("headline");
  if (!Array.isArray(o.tally)) out.push("tally");
  if (!Array.isArray(o.response) || o.response.length === 0) out.push("response");
  else if (!o.response.some((s) => s && typeof s === "object" && typeof (s as { text?: unknown }).text === "string")) out.push("response sentences");
  if (o.evidence_types !== undefined && !Array.isArray(o.evidence_types)) out.push("evidence_types");
  if (o.offer_amount !== undefined && o.offer_amount !== null && typeof o.offer_amount !== "number") out.push("offer_amount");
  return out;
}

export const WRONG_SHAPE = "The model sent this sentence in the wrong shape, so it can't be checked.";

/** Whether one response sentence is in the schema's shape: text, cites as letters (or one string of them), an optional quote. */
export function sentenceShaped(s: unknown): s is { text: string; cites: string[] | string; quote?: string | null } {
  if (!s || typeof s !== "object") return false;
  const x = s as { text?: unknown; cites?: unknown; quote?: unknown };
  return (
    typeof x.text === "string" &&
    (Array.isArray(x.cites) ? x.cites.every((c) => typeof c === "string") : typeof x.cites === "string") &&
    (x.quote === undefined || x.quote === null || typeof x.quote === "string")
  );
}
