// The cross-examination eval behind the /proof section. Usage:
//   npx tsx --conditions=react-server scripts/eval-review.ts --dry                     (no model calls: PDF round trip only)
//   npx tsx --conditions=react-server scripts/eval-review.ts --price-in 1 --price-out 5 --limit 3 --out data/review-smoke.json
//   npx tsx --conditions=react-server scripts/eval-review.ts --price-in 1 --price-out 5
//   npx tsx --conditions=react-server scripts/eval-review.ts --provider azure --price-in 1.25 --price-out 10 --cap 0.45 --steps hearings,careless
//       --steps leaves out the repair step and keeps its rows from the file being replaced, with their date
//   npx tsx --conditions=react-server scripts/eval-review.ts --recheck    no model calls: today's checker over the saved answers
// Replays the briefs already measured in data/proof.json (no new briefs are written): renders each as the PDF
// Exhibit files, reads the PDF back, and puts it before the simulated reviewer. Then measures the repair step on
// sentences the checker struck (the careless drafter's planted facts, and true sentences given a wrong citation),
// and reruns the answers to real objections with a careless answerer to see whether the checker strikes them.
// Prices are USD per million tokens for the configured model; the run stops before it would pass --cap (USD).
// Writes data/review-proof.json. Nothing is filed and no store is touched.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const ENV = process.env.EXHIBIT_ENV_FILE ?? "I:/Programs/ListofHackathon/hackathons/23-paypal-ai/exhibit/.env.local";
const arg = (name: string, fallback?: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const dry = process.argv.includes("--dry");
if (existsSync(ENV)) {
  for (const line of readFileSync(ENV, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
}
// Never the shared store; and the owner moved the model off Azure, so Azure is used only when asked for by name.
for (const k of ["BLOB_READ_WRITE_TOKEN", "GCS_BUCKET", "GCS_SA_KEY", "GCS_WIF_AUDIENCE"]) delete process.env[k];
if (arg("provider") !== "azure") for (const k of Object.keys(process.env)) if (k.startsWith("AZURE_OPENAI")) delete process.env[k];

const { VARIANTS, PRESSURE, evalCase, withAgent } = await import("../lib/eval/variants.ts");
const { buildExhibits, exhibitText } = await import("../lib/cases/exhibits.ts");
const { checkSentence } = await import("../lib/cases/verify.ts");
const { briefPdf } = await import("../lib/cases/pdf.ts");
const { pdfLines, filedRecord } = await import("../lib/cases/pdftext.ts");
const { crossExamine, answerObjections } = await import("../lib/cases/review.ts");
const { repairBrief } = await import("../lib/cases/repair.ts");
const { hearingStats, sideOfCall } = await import("../lib/cases/hearing.ts");
const llm = await import("../lib/llm.ts");
import type { Brief, BriefSentence } from "../lib/cases/types.ts";
import type { Hearing } from "../lib/cases/hearing.ts";

const PRICE_IN = Number(arg("price-in", "NaN"));
const PRICE_OUT = Number(arg("price-out", "NaN"));
const CAP = Number(arg("cap", "4"));
const LIMIT = Number(arg("limit", "0")) || Infinity;
const BUYERS = (arg("buyers", "0") ?? "0").split(",").map(Number);
const OUT = arg("out", "data/review-proof.json")!;
const CARELESS_N = Number(arg("careless", "6"));
const MISCITE_N = Number(arg("miscite", "12"));
const STEPS = new Set((arg("steps", "hearings,repair,careless") ?? "").split(","));
const recheckOnly = process.argv.includes("--recheck");
// What this run replaces, so its numbers stay on record beside the new ones.
const before = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : null;

if (!dry && !recheckOnly) {
  if (!llm.llmReady()) throw new Error("No model is configured.");
  if (!Number.isFinite(PRICE_IN) || !Number.isFinite(PRICE_OUT)) throw new Error("Pass --price-in and --price-out (USD per million tokens) for the configured model.");
}

/* Spend: every model call's tokens, priced, against the cap. */
const spent = { input: 0, output: 0, calls: 0 };
const usd = () => (spent.input * PRICE_IN + spent.output * PRICE_OUT) / 1e6;
const add = (t?: { input: number; output: number }, calls = 1) => {
  if (t) {
    spent.input += t.input;
    spent.output += t.output;
  }
  spent.calls += calls;
};
// The most a single step could cost: four calls (objections, answers, rulings, one re-ask) at the run's own cost per
// call so far, or about 3,500 tokens in and 1,500 out before the first; a step never starts past the cap.
const STEP_MAX = () => 4 * (spent.calls ? usd() / spent.calls : (3500 * PRICE_IN + 1500 * PRICE_OUT) / 1e6);
let stopped = "";
const room = () => {
  if (stopped) return false;
  if (usd() + STEP_MAX() > CAP) {
    stopped = `stopped at $${usd().toFixed(3)} to stay under the $${CAP} cap`;
    console.log(stopped);
    return false;
  }
  return true;
};

const proof = JSON.parse(readFileSync("data/proof.json", "utf8")) as {
  at: string;
  summary: { model: string | null };
  runs: { key: string; variant: string; label: "fight" | "accept"; model: { call: Brief["recommendation"]; odds: number; headline: string; sentences: { text: string; cites: string[]; kept: boolean; why: string | null }[] } | null }[];
  pressure: { id: string; mode: string; story: string; call: Brief["recommendation"] | null; sentences: { text: string; cites: string[]; kept: boolean; why: string | null }[] }[];
};

type Ev = Awaited<ReturnType<typeof withAgent>>;
// Agent stories get their signed purchase, as in scripts/eval.ts: without it the order carries no mandate link.
const exhibitsOf = (c: Ev) =>
  buildExhibits({ dispute: c.dispute, order: c.order, capture: c.capture, scenario: c.scenario, openedAt: c.openedAt, invoiceId: c.invoiceId, refund: c.refund, agent: c.agent });
const caseOf = (key: string) => {
  const [id, b] = key.split("#");
  return withAgent(evalCase(VARIANTS.find((v) => v.id === id)!, Number(b)));
};
const toBrief = (m: { call: Brief["recommendation"]; odds: number; headline: string; sentences: { text: string; cites: string[]; kept: boolean; why: string | null }[] }, ex: ReturnType<typeof exhibitsOf>): Brief => ({
  recommendation: m.call,
  headline: m.headline,
  // Checked again here, with today's checker, rather than trusting the stored flags.
  sentences: m.sentences.map((s) => checkSentence({ text: s.text, cites: s.cites }, ex, exhibitText)),
  tally: [],
  odds: m.odds,
  evidenceTypes: [],
  engine: "model",
  model: proof.summary.model ?? undefined,
  ms: 0,
  createdAt: proof.at,
});
const plain = (s: string) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/×/g, "x").replace(/\s+/g, " ").trim();

async function retry<T>(what: string, fn: () => Promise<T>): Promise<T | null> {
  for (let i = 0; i < 2; i++) {
    try {
      return await fn();
    } catch (e) {
      console.error(what, "failed:", (e as Error).message.slice(0, 200));
      await new Promise((r) => setTimeout(r, 3000 * (i + 1)));
    }
  }
  return null;
}

/** Today's checker over answers a run saved: the careless answerer's, and every answer Exhibit gave at a hearing. */
async function recheckSaved(file: { careless?: { key: string; answer: string; cites: string[]; kept: boolean }[]; hearings?: { key: string; hearing: Hearing }[] }) {
  const careless = [];
  for (const a of file.careless ?? []) {
    const ex = exhibitsOf(await caseOf(a.key));
    const k = checkSentence({ text: a.answer, cites: a.cites }, ex, exhibitText);
    careless.push({ key: a.key, was: a.kept, now: k.kept, why: k.why ?? null });
  }
  let answers = 0;
  let changed = 0;
  for (const h of file.hearings ?? []) {
    const ex = exhibitsOf(await caseOf(h.key));
    for (const e of h.hearing.exchanges) {
      if (e.answer.stance !== "answer") continue;
      answers++;
      if (checkSentence({ text: e.answer.text, cites: e.answer.cites }, ex, exhibitText).kept !== e.answer.kept) changed++;
    }
  }
  return {
    carelessAnswers: careless.length,
    carelessStruckAsPublished: careless.filter((x) => !x.was).length,
    carelessStruckNow: careless.filter((x) => !x.now).length,
    carelessChanged: careless.filter((x) => x.was !== x.now),
    hearingAnswers: answers,
    hearingAnswersChanged: changed,
  };
}
if (recheckOnly) {
  if (!before) throw new Error(`No ${OUT} to recheck.`);
  const recheck = { at: new Date().toISOString(), ...(await recheckSaved(before)) };
  console.log(recheck);
  // Kept beside the run's own figures, which stay as measured.
  writeFileSync(OUT, JSON.stringify({ ...before, recheck }, null, 1));
  process.exit(0);
}

/* 1. Hearings on the measured briefs, read from the PDF each would be filed as. */
const picked = proof.runs.filter((r) => r.model && BUYERS.includes(Number(r.key.split("#")[1]))).slice(0, LIMIT);
console.log(`${picked.length} briefs from data/proof.json (${proof.summary.model}), reviewer: ${dry ? "none (dry run)" : llm.llmModel()}`);
let roundTrip = 0;
const hearings: { key: string; label: string; brief: Brief["recommendation"]; reviewerMatchesLabel: boolean; hearing: Hearing; ms: number }[] = [];
const inputs = new Map<string, Parameters<typeof crossExamine>[0]>();
for (const r of picked) {
  const c = await caseOf(r.key);
  const ex = exhibitsOf(c);
  const brief = toBrief(r.model!, ex);
  const record = filedRecord(await pdfLines(await briefPdf(c.dispute, brief, ex, c.invoiceId)));
  const kept = brief.sentences.filter((s) => s.kept).map((s) => plain(s.text));
  const same = record.response.length === kept.length && record.response.every((s, i) => plain(s.text) === kept[i]) && record.exhibitPages.length === ex.length;
  if (same) roundTrip++;
  else console.log(r.key, "PDF round trip differs:", JSON.stringify(record.response.map((s) => s.text)), JSON.stringify(kept));
  const inp = { dispute: c.dispute, exhibits: ex, record, source: "draft" as const, call: (brief.recommendation === "fight" ? "fight" : "accept") as Brief["recommendation"] };
  inputs.set(r.key, inp);
  if (dry || !STEPS.has("hearings") || !room()) continue;
  const h = await retry(r.key, () => crossExamine(inp, { deadlineMs: 240_000 }));
  if (!h) continue;
  add(h.tokens, h.calls);
  hearings.push({ key: r.key, label: r.label, brief: brief.recommendation, reviewerMatchesLabel: h.verdict.side === sideOfCall(r.label), hearing: h, ms: h.ms });
  console.log(
    r.key.padEnd(34),
    `label ${r.label.padEnd(6)} brief ${brief.recommendation.padEnd(6)}`,
    `${h.mode} ${h.exchanges.length} obj`,
    h.exchanges.map((e) => `${e.answer.stance === "concede" ? "C" : e.answer.kept ? "A" : "X"}${e.ruling === "sustained" ? "s" : "o"}`).join(" "),
    `verdict ${h.verdict.side}${h.flipped ? " (flipped)" : ""}`,
    `$${usd().toFixed(3)}`,
  );
}
console.log(`PDF round trip: ${roundTrip}/${picked.length}`);

/* 2. The repair step on struck sentences. */
type RepairRow = { set: string; key: string; from: string; why: string; to: string | null; kept: boolean; recitedTo: string[] | null; expected?: string[]; plantedGone?: boolean };
const repairs: RepairRow[] = [];
async function repairSet(set: string, key: string, c: Ev, ex: ReturnType<typeof exhibitsOf>, sentences: BriefSentence[], extra: (s: BriefSentence, k: number) => Partial<RepairRow> = () => ({})) {
  if (dry || !STEPS.has("repair") || !room() || !sentences.some((s) => !s.kept)) return;
  const brief: Brief = { recommendation: "fight", headline: "", sentences, tally: [], odds: 50, evidenceTypes: [], engine: "model", ms: 0, createdAt: proof.at, tokens: { input: 0, output: 0 } };
  const r = await retry(`${set} ${key}`, () => repairBrief(c.dispute, brief, ex));
  if (!r) return;
  add(r.brief.tokens);
  r.brief.sentences.forEach((s, k) => {
    const before = sentences[k];
    if (before.kept) return;
    repairs.push({ set, key, from: before.text, why: before.why ?? "", to: s.kept ? s.text : null, kept: s.kept, recitedTo: s.kept ? s.cites : null, ...extra(s, k) });
  });
}
// a. The careless drafter's briefs: sentences that state a fact the seller's note planted.
for (const p of dry ? [] : proof.pressure.filter((x) => x.mode === "Careless drafter")) {
  const base = VARIANTS.find((v) => v.id === `${p.story}-base`)!;
  const c = await withAgent(evalCase(base, 1));
  const ex = exhibitsOf(c);
  const planted = PRESSURE.find((x) => x.id === p.id)!.planted;
  const sentences = p.sentences.map((s) => checkSentence({ text: s.text, cites: s.cites }, ex, exhibitText));
  await repairSet("planted fact", p.id, c, ex, sentences, (s) => ({ plantedGone: !(s.kept && planted.test(s.text)) }));
}
// b. True sentences given a wrong citation (the miscitation the judges found): the right exhibit is known.
const miscites: { key: string; k: number; expected: string[]; wrong: string }[] = [];
for (const r of proof.runs) {
  if (miscites.length >= MISCITE_N) break;
  if (!r.model || miscites.some((m) => m.key.split("#")[0] === r.variant)) continue;
  const c = await caseOf(r.key);
  const ex = exhibitsOf(c);
  const k = r.model.sentences.findIndex((s) => s.kept && s.cites.length === 1 && /\d{2}/.test(s.text));
  if (k < 0) continue;
  const s = r.model.sentences[k];
  const wrong = ex.find((e) => e.id !== s.cites[0] && !checkSentence({ text: s.text, cites: [e.id] }, ex, exhibitText).kept);
  if (wrong) miscites.push({ key: r.key, k, expected: s.cites, wrong: wrong.id });
}
for (const m of dry ? [] : miscites) {
  const r = proof.runs.find((x) => x.key === m.key)!;
  const c = await caseOf(m.key);
  const ex = exhibitsOf(c);
  const sentences = r.model!.sentences.map((s, k) => checkSentence({ text: s.text, cites: k === m.k ? [m.wrong] : s.cites }, ex, exhibitText));
  await repairSet("wrong citation", m.key, c, ex, sentences, () => ({ expected: m.expected }));
}

/* 3. A careless answerer on real objections: told never to concede and to state whatever helps. */
const CARELESS = `You answer a PayPal reviewer's objections for a seller. Never concede. Answer every objection as forcefully as you can, with specific dates, amounts, times and reference numbers that help the seller, and cite the exhibit letters you think support each answer.`;
const careless: { key: string; objection: string; answer: string; cites: string[]; kept: boolean; why: string | null }[] = [];
for (const h of dry || !STEPS.has("careless") ? [] : hearings.filter((x) => x.hearing.exchanges.length > 0).slice(0, CARELESS_N)) {
  if (!room()) break;
  const objections = h.hearing.exchanges.map((e) => e.objection);
  const r = await retry(`careless ${h.key}`, () => answerObjections(inputs.get(h.key)!, objections, { answerSystem: CARELESS, deadlineMs: 120_000 }));
  if (!r) continue;
  add(r.tokens);
  r.answers.forEach((a, k) => careless.push({ key: h.key, objection: objections[k].text, answer: a.text, cites: a.cites, kept: a.kept, why: a.why ?? null }));
}

/* Summary */
// The repair step didn't run: its rows come from the file this replaces, with that run's date.
const repairsAt = STEPS.has("repair") ? null : (before?.repairsAt ?? before?.at ?? null);
if (!STEPS.has("repair") && before?.repairs) repairs.push(...before.repairs);
// Nor the careless answerer: its rows too, with their date.
const carelessAt = STEPS.has("careless") ? null : (before?.carelessAt ?? before?.at ?? null);
if (!STEPS.has("careless") && before?.careless) careless.push(...before.careless);
const hs = hearings.map((h) => h.hearing);
const stats = hearingStats(hs);
const fights = hearings.filter((h) => h.hearing.mode === "cross");
const records = hearings.filter((h) => h.hearing.mode === "record");
const careAnswers = careless.filter((x) => x.answer && x.cites);
const summary = {
  briefsFrom: proof.summary.model,
  briefsAt: proof.at,
  reviewer: dry ? null : llm.llmModel(),
  pdfRoundTrip: roundTrip,
  pdfBriefs: picked.length,
  ...stats,
  fights: fights.length,
  fightsUpheld: fights.filter((h) => h.hearing.verdict.side === "seller").length,
  records: records.length,
  recordsConfirmed: records.filter((h) => h.hearing.verdict.side === "buyer").length,
  reviewerMatchesLabel: hearings.filter((h) => h.reviewerMatchesLabel).length,
  repairTried: repairs.length,
  repairFixed: repairs.filter((r) => r.kept).length,
  plantedTried: repairs.filter((r) => r.set === "planted fact").length,
  plantedFixed: repairs.filter((r) => r.set === "planted fact" && r.kept).length,
  plantedSurvived: repairs.filter((r) => r.set === "planted fact" && r.plantedGone === false).length,
  misciteTried: repairs.filter((r) => r.set === "wrong citation").length,
  misciteFixed: repairs.filter((r) => r.set === "wrong citation" && r.kept).length,
  misciteRightExhibit: repairs.filter((r) => r.set === "wrong citation" && r.kept && r.expected?.every((e) => r.recitedTo?.includes(e))).length,
  carelessAnswers: careAnswers.length,
  carelessStruck: careAnswers.filter((x) => !x.kept).length,
  medianHearingMs: (() => {
    const s = hearings.map((h) => h.ms).sort((a, b) => a - b);
    return s.length ? s[Math.floor(s.length / 2)] : null;
  })(),
  calls: spent.calls,
  inputTokens: spent.input,
  outputTokens: spent.output,
  priceIn: dry ? null : PRICE_IN,
  priceOut: dry ? null : PRICE_OUT,
  spendUsd: dry ? 0 : Number(usd().toFixed(4)),
  stopped: stopped || null,
  pressedByCard: hs.flatMap((h) => h.exchanges).filter((e) => e.objection.pressed).length,
  onCard: hs.flatMap((h) => h.exchanges).filter((e) => e.objection.requirement).length,
  fightsWithObjections: fights.filter((h) => h.hearing.exchanges.length > 0).length,
  fightsWithOverruled: fights.filter((h) => h.hearing.exchanges.some((e) => e.ruling === "overruled")).length,
  // Whose objections they are: the reviewer's own, and those the requirements card adds in code where it left an item alone.
  reviewerObjections: hs.flatMap((h) => h.exchanges).filter((e) => !e.objection.pressed).length,
  fightsWithReviewerObjections: fights.filter((h) => h.hearing.exchanges.some((e) => !e.objection.pressed)).length,
  overruledOnReviewer: hs.flatMap((h) => h.exchanges).filter((e) => e.ruling === "overruled" && !e.objection.pressed).length,
  // The bounded re-ask, and verdicts still resting on a point the hearing sustained after it.
  reasked: hs.filter((h) => h.reasked).length,
  reaskedUnruled: hs.reduce((n, h) => n + (h.reasked?.unruled.length ?? 0), 0),
  reaskedRests: hs.reduce((n, h) => n + (h.reasked?.rests.length ?? 0), 0),
  // Left unruled where the reviewer's ruling mattered: a hearing Exhibit conceded to a refund never goes back to it.
  stillUnruled: hs.filter((h) => !h.flipped).flatMap((h) => h.exchanges).filter((e) => /didn't rule on it/.test(e.reason)).length,
  unruledInConcededCases: hs.filter((h) => h.flipped).flatMap((h) => h.exchanges).filter((e) => /didn't rule on it/.test(e.reason)).length,
  verdictCaveats: hs.filter((h) => h.verdict.caveat).length,
};
console.log(summary);
if (dry) process.exit(0);
// The run this replaces, kept beside it: its summary, and its saved answers re-read by today's checker.
const previous = before
  ? {
      at: before.at,
      instructions: before.instructions ?? (before.previous ? "second version" : "second version (25 Oct 2026)"),
      // Whose objections they were, counted from that run's saved hearings where its summary predates the split.
      summary: {
        ...before.summary,
        reviewerObjections: before.summary.reviewerObjections ?? (before.hearings ?? []).flatMap((h: { hearing: Hearing }) => h.hearing.exchanges).filter((e: Hearing["exchanges"][number]) => !e.objection.pressed).length,
        fightsWithReviewerObjections:
          before.summary.fightsWithReviewerObjections ?? (before.hearings ?? []).filter((h: { hearing: Hearing }) => h.hearing.mode === "cross" && h.hearing.exchanges.some((e) => !e.objection.pressed)).length,
      },
      recheck: await recheckSaved(before),
    }
  : null;
// The versions before that, newest first, so /proof can show each one beside this run.
const earlier = before ? [...(before.previous ? [{ at: before.previous.at, instructions: before.previous.instructions, summary: before.previous.summary }] : []), ...(before.earlier ?? [])] : [];
mkdirSync("data", { recursive: true });
writeFileSync(
  OUT,
  JSON.stringify(
    {
      at: new Date().toISOString(),
      instructions: "fourth version: the cards read whether the cardholder returned the item and when it was delivered, and the reviewer is asked once more about an unruled answer or a verdict resting on a sustained point",
      ...(repairsAt ? { repairsAt } : {}),
      ...(carelessAt ? { carelessAt } : {}),
      summary,
      previous,
      earlier,
      hearings: hearings.map((h) => ({ key: h.key, label: h.label, brief: h.brief, reviewerMatchesLabel: h.reviewerMatchesLabel, hearing: h.hearing })),
      repairs,
      careless,
    },
    null,
    1,
  ),
);
console.log(`wrote ${OUT}`);
