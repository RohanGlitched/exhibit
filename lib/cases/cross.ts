import "server-only";
import { downloadDocument } from "../paypal/disputes";
import { takeAutopilotCall, takeModelCall } from "../budget";
import { llmReady } from "../llm";
import { updateCase } from "../store";
import { filedDocument } from "./derive";
import { PANEL_SIZE, applyHearing, panelHearing, panelNeeds, panelWords, rulesHearing, tallyPanel, type ChairExchange, type Hearing, type Panel } from "./hearing";
import { hearingsOf, withHearing } from "./hearing-log";
import { filedRecord, pdfLines, type FiledRecord } from "./pdftext";
import { briefPdf } from "./pdf";
import { answerVisitor, crossExamine, type HearingInput } from "./review";
import { caseContext, ensureRecord, type CaseContext } from "./service";
import type { Brief } from "./types";

/**
 * Cross-examination on a live case. The reviewer reads the PDF PayPal holds when the response has been filed
 * (downloaded from PayPal's document store and read back to text), or the PDF Exhibit would file when it
 * hasn't. A hearing on a draft can withdraw sentences or turn the call into a refund before anything is filed;
 * on a filed case its verdict is the outcome Exhibit asks the sandbox ruling for.
 */

const fought = (ctx: CaseContext) => ctx.filings.some((f) => f.action === "evidence");
const accepted = (ctx: CaseContext) => ctx.filings.some((f) => f.action === "accept");

/** What the reviewer reads, and whose copy it is. */
export async function readRecord(ctx: CaseContext): Promise<{ record: FiledRecord; source: Hearing["source"] }> {
  const doc = filedDocument(ctx.dispute);
  if (doc) {
    const record = filedRecord(await pdfLines(await downloadDocument(doc.url)));
    if (!record.exhibitPages.length) throw new Error("The PDF PayPal holds for this case has no exhibit pages Exhibit can read.");
    return { record, source: "paypal" };
  }
  if (fought(ctx)) throw new Error("PayPal holds this response without a PDF, so there is nothing for the reviewer to read.");
  if (!ctx.brief) throw new Error("Argue the case before calling the reviewer.");
  return { record: filedRecord(await pdfLines(await briefPdf(ctx.dispute, ctx.brief, ctx.exhibits, ctx.invoiceId))), source: "draft" };
}

async function inputFor(ctx: CaseContext): Promise<HearingInput> {
  if (!ctx.brief) throw new Error("Argue the case before calling the reviewer.");
  if (accepted(ctx)) throw new Error("The seller accepted this claim, so there is nothing left to cross-examine.");
  const { record, source } = await readRecord(ctx);
  const call = fought(ctx) ? "fight" : ctx.brief.recommendation === "fight" ? "fight" : "accept";
  return { dispute: ctx.dispute, exhibits: ctx.exhibits, record, source, call };
}

/** The spend guard a hearing draws on: the autopilot's own share of the day's budget, or the visitor's allowance. */
const takeFor = (ip: string) => (ip === "autopilot" ? () => takeAutopilotCall() : () => takeModelCall(ip));

/** Runs a hearing on a case already read, on the model behind the spend guard. */
export async function hearingFor(ctx: CaseContext, ip: string): Promise<Hearing> {
  if (!llmReady()) throw new Error("The reviewer needs the model, and none is configured.");
  return crossExamine(await inputFor(ctx), { take: takeFor(ip) });
}

export interface RulingPanel {
  /** The hearing the ruling follows (the panel on it), or null when no two hearings agree. */
  hearing: Hearing | null;
  /** Hearings held for this request, to be kept on the case beside the earlier ones. */
  fresh: Hearing[];
  panel: Panel | null;
  /** Why no ruling is asked for, when `hearing` is null. */
  held?: string;
}

/** A hearing time no other hearing on the record has: two held in parallel can start in the same millisecond. */
function uniqueAt(h: Hearing, taken: Set<string>): Hearing {
  let t = new Date(h.at).getTime();
  while (taken.has(new Date(t).toISOString())) t++;
  const at = new Date(t).toISOString();
  taken.add(at);
  return at === h.at ? h : { ...h, at };
}

/**
 * The hearings the ruling request follows. PayPal's copy is heard up to three times, counting model hearings
 * already saved on it since the latest filing: two at once, and a third only when those two split. The ruling is
 * asked for only on two that agree (lib/cases/hearing.ts tallyPanel); otherwise the case is left for the seller,
 * with the hearings held so far kept so the next try picks up where this one stopped. Without any model configured
 * the rules engine decides from the filing, as before, and says so.
 */
export async function hearingForRuling(ctx: CaseContext, ip: string, opts: { deadlineMs?: number } = {}): Promise<RulingPanel> {
  const t0 = Date.now();
  const deadline = opts.deadlineMs ?? 50_000;
  const filedAt = ctx.filings.filter((f) => f.action === "evidence").map((f) => f.at).sort().at(-1) ?? "";
  const kept = hearingsOf(ctx.record);
  const saved = kept.filter((h) => h.source === "paypal" && h.engine === "model" && h.at >= filedAt);
  if (!llmReady() && !saved.length) {
    const response = ctx.brief?.sentences.filter((s) => s.kept).map((s) => ({ text: s.text, cites: s.cites })) ?? [];
    return { hearing: rulesHearing(fought(ctx) ? "fight" : (ctx.brief?.recommendation ?? "accept"), ctx.brief?.odds ?? 0, fought(ctx), response, "paypal"), fresh: [], panel: null };
  }
  const fresh: Hearing[] = [];
  const taken = new Set(kept.map((h) => h.at));
  let panel = tallyPanel(saved);
  let stopped = "";
  let input: HearingInput | null = null;
  while (panelNeeds(panel) > 0 && llmReady()) {
    const left = deadline - (Date.now() - t0);
    // A hearing takes 6 to 20 seconds; one that can't finish in time isn't started.
    if (left < 20_000) {
      stopped = "out of time for another hearing in this request";
      break;
    }
    try {
      input ??= await inputFor(ctx);
    } catch (e) {
      stopped = (e as Error).message.replace(/\.$/, "");
      break;
    }
    const inp = input;
    // In parallel, so two hearings take the time of one; one that fails doesn't lose the other.
    const held = await Promise.allSettled(Array.from({ length: panelNeeds(panel) }, () => crossExamine(inp, { take: takeFor(ip), deadlineMs: left - 2_000 })));
    for (const r of held) if (r.status === "fulfilled") fresh.push(uniqueAt(r.value, taken));
    panel = tallyPanel([...saved, ...fresh]);
    const failed = held.find((r): r is PromiseRejectedResult => r.status === "rejected");
    if (failed) {
      stopped = String((failed.reason as Error)?.message ?? failed.reason).replace(/\.$/, "");
      console.error("hearing for ruling", stopped);
      break;
    }
  }
  const hearing = panelHearing([...saved, ...fresh], panel);
  if (hearing) return { hearing, fresh, panel };
  const held = `Left for the seller: the simulated reviewer's hearings on PayPal's copy ${panel.heard ? panelWords(panel) : "couldn't be held"}${stopped ? `, and ${panel.heard < PANEL_SIZE ? "the next hearing couldn't be held" : "no more are held"} (${stopped})` : ""}. Exhibit asks for a ruling only when two hearings agree.`;
  return { hearing: null, fresh, panel: panel.heard ? panel : null, held };
}

/** POST /api/cases/[id]/review: cross-examines the case and saves the hearing beside the earlier ones (and, on a draft, the brief it changed). */
export async function reviewCase(id: string, ip: string): Promise<{ hearing: Hearing; brief: Brief | null }> {
  const ctx = await caseContext(id);
  const hearing = await hearingFor(ctx, ip);
  await ensureRecord(ctx);
  const saved = await updateCase(id, (r) => {
    const brief = r.brief ?? ctx.brief ?? undefined;
    return { ...withHearing(r, hearing), brief: brief && hearing.source === "draft" ? applyHearing(brief, hearing) : brief };
  });
  return { hearing, brief: saved?.brief ?? ctx.brief };
}

/** POST /api/cases/[id]/object: a visitor's objection, answered and checked. Nothing is saved or filed. */
export async function objectCase(id: string, text: string, sentence: number | null, ip: string): Promise<ChairExchange> {
  if (!llmReady()) throw new Error("Exhibit needs the model to answer, and none is configured.");
  const ctx = await caseContext(id);
  return answerVisitor(await inputFor(ctx), text, sentence, { take: () => takeModelCall(ip), deadlineMs: 40_000 });
}
