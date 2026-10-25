import "server-only";
import { structured } from "../llm";
import { reasonLabel, usd } from "../format";
import type { Dispute } from "../paypal/disputes";
import { exhibitText } from "./exhibits";
import { acceptRepairs } from "./hearing";
import type { Brief, Exhibit } from "./types";

/**
 * The bounded repair step. Before a brief is final, every sentence the checker struck goes back to the model
 * once, with the reason and the exhibits, for a re-cite. The repaired sentence replaces the struck one only if
 * the same checker keeps it (lib/cases/hearing.ts acceptRepairs); there is no second attempt.
 */

const TOOL = {
  name: "recite",
  description: "Re-cite the struck sentences to the exhibits that prove them.",
  schema: {
    type: "object",
    required: ["sentences"],
    properties: {
      sentences: {
        type: "array",
        items: {
          type: "object",
          required: ["index", "text", "cites"],
          properties: {
            index: { type: "integer", description: "The struck sentence's number." },
            text: { type: "string", description: "The sentence, true to the exhibits it cites. No exhibit letters in the text." },
            cites: { type: "array", items: { type: "string" }, description: "Exhibit letters that hold every figure in the sentence." },
          },
        },
        description: "One entry per struck sentence you can repair. Leave out any sentence no exhibit supports.",
      },
    },
  },
};

const SYSTEM = `You repair sentences in a seller's response to a PayPal chargeback. A checker struck each one because a figure or name in it (an amount, date, time, id, tracking number, ZIP, place, carrier or signer) isn't in the exhibits it cites, because one clause mixes figures from two different records, because a date or amount is presented as something the record says it isn't, because it denies what its record says, or because it cites no exhibit.
For each struck sentence: cite the exhibit letters that hold every figure and name it states, keep figures from different records in different sentences, and copy each figure exactly as that exhibit writes it. If a fact in the sentence appears in no exhibit, drop that fact; if nothing true is left, leave the sentence out. Never add a fact, and never compute a new date or amount.`;

export async function repairBrief(d: Dispute, brief: Brief, exhibits: Exhibit[]): Promise<{ brief: Brief; tried: number; fixed: number }> {
  const struck = brief.sentences.map((s, k) => ({ s, k })).filter(({ s }) => !s.kept);
  if (!struck.length) return { brief, tried: 0, fixed: 0 };
  const { value, usage } = await structured<{ sentences?: { index?: unknown; text?: unknown; cites?: unknown }[] }>({
    system: SYSTEM,
    prompt: `Case ${d.dispute_id}: ${reasonLabel(d.reason)}, ${usd(d.dispute_amount.value)} disputed.

Exhibits:
${exhibits.map((e) => `--- Exhibit ${e.id}: ${e.title} (${e.source})\n${exhibitText(e)}`).join("\n\n")}

Struck sentences:
${struck.map(({ s, k }) => `${k + 1}. ${s.text} [cited: ${s.cites.join(", ") || "nothing"}] Struck because: ${s.why}`).join("\n")}

Repair them with the recite tool.`,
    tool: TOOL,
    maxTokens: 2000,
    timeoutMs: 25_000,
  });
  const r = acceptRepairs(brief.sentences, value.sentences, exhibits, exhibitText);
  const tokens = usage && brief.tokens ? { input: brief.tokens.input + usage.inputTokens, output: brief.tokens.output + usage.outputTokens } : brief.tokens;
  return { brief: { ...brief, sentences: r.sentences, tokens }, tried: r.tried, fixed: r.fixed };
}
