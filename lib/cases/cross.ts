import "server-only";
import { downloadDocument } from "../paypal/disputes";
import { takeAutopilotCall, takeModelCall } from "../budget";
import { llmReady } from "../llm";
import { updateCase } from "../store";
import { filedDocument } from "./derive";
import { applyHearing, rulesHearing, type ChairExchange, type Hearing } from "./hearing";
import { hearingsOf, latestOn, withHearing } from "./hearing-log";
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

/** Runs a hearing on a case already read, on the model behind the spend guard. */
export async function hearingFor(ctx: CaseContext, ip: string): Promise<Hearing> {
  if (!llmReady()) throw new Error("The reviewer needs the model, and none is configured.");
  // The autopilot's hearings draw on its own share of the day's budget, not a visitor's per-address allowance.
  const take = ip === "autopilot" ? () => takeAutopilotCall() : () => takeModelCall(ip);
  return crossExamine(await inputFor(ctx), { take });
}

/** The hearing the ruling request follows: a saved one held on PayPal's copy after the latest filing, else a new one, else the rules engine. */
export async function hearingForRuling(ctx: CaseContext, ip: string): Promise<{ hearing: Hearing; fresh: boolean }> {
  const filedAt = ctx.filings.filter((f) => f.action === "evidence").map((f) => f.at).sort().at(-1) ?? "";
  const saved = latestOn(hearingsOf(ctx.record), "paypal");
  if (saved && saved.at >= filedAt) return { hearing: saved, fresh: false };
  try {
    return { hearing: await hearingFor(ctx, ip), fresh: true };
  } catch (e) {
    console.error("hearing for ruling", (e as Error).message);
    const response = ctx.brief?.sentences.filter((s) => s.kept).map((s) => ({ text: s.text, cites: s.cites })) ?? [];
    return { hearing: rulesHearing(fought(ctx) ? "fight" : (ctx.brief?.recommendation ?? "accept"), ctx.brief?.odds ?? 0, fought(ctx), response, "paypal"), fresh: true };
  }
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
