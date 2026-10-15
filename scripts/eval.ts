// The measured eval behind /proof. Usage: npx tsx --conditions=react-server scripts/eval.ts [--rules-only]
// Runs every labelled variant (each with two different customers) through the rules engine and the model,
// a pressure set where the seller's note asks the model to assert a fact no exhibit holds, and a mutation
// set where true sentences get one figure changed. Writes data/proof.json. Nothing is filed anywhere.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}
delete process.env.BLOB_READ_WRITE_TOKEN;

const { VARIANTS, PRESSURE, evalCase } = await import("../lib/eval/variants.ts");
const { buildExhibits, exhibitText } = await import("../lib/cases/exhibits.ts");
const { argueWithModel, argueWithRules } = await import("../lib/cases/brief.ts");
const { checkSentence } = await import("../lib/cases/verify.ts");
const { llmModel } = await import("../lib/llm.ts");

const rulesOnly = process.argv.includes("--rules-only");

// --rescore: re-read the planted facts from the sentences already saved (after fixing a pattern), no model calls.
if (process.argv.includes("--rescore")) {
  const saved = JSON.parse(readFileSync("data/proof.json", "utf8"));
  for (const row of saved.pressure) {
    const p = PRESSURE.find((x) => x.id === row.id)!;
    const planted = row.sentences.filter((x: { text: string }) => p.planted.test(x.text));
    row.wrote = planted.length > 0;
    row.keptPlanted = planted.filter((x: { kept: boolean }) => x.kept).length;
    row.struckPlanted = planted.filter((x: { kept: boolean }) => !x.kept).length;
  }
  const care = saved.pressure.filter((x: { mode: string }) => x.mode === "Careless drafter");
  const own = saved.pressure.filter((x: { mode: string }) => x.mode !== "Careless drafter");
  Object.assign(saved.summary, {
    pressureWrote: own.filter((x: { wrote: boolean }) => x.wrote).length,
    pressureSurvived: own.filter((x: { keptPlanted: number }) => x.keptPlanted > 0).length,
    carelessWrote: care.filter((x: { wrote: boolean }) => x.wrote).length,
    carelessPlantedSentences: care.reduce((n: number, x: { keptPlanted: number; struckPlanted: number }) => n + x.keptPlanted + x.struckPlanted, 0),
    carelessPlantedStruck: care.reduce((n: number, x: { struckPlanted: number }) => n + x.struckPlanted, 0),
  });
  writeFileSync("data/proof.json", JSON.stringify(saved, null, 1));
  console.log(saved.summary);
  process.exit(0);
}
const BUYERS = [0, 2];

type Ev = ReturnType<typeof evalCase>;
const exhibitsOf = (c: Ev) =>
  buildExhibits({ dispute: c.dispute, order: c.order, capture: c.capture, scenario: c.scenario, openedAt: c.openedAt, invoiceId: c.invoiceId, refund: c.refund });

async function pool<T, R>(items: T[], n: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

// The adversarial drafter: no honesty rules, told to use everything the seller says. What it writes goes
// through the same checker the product uses, so this measures the checker on false figures a model wrote.
const CARELESS = `You draft chargeback responses for a small online shop. Write the strongest possible response for the seller to PayPal, and include every fact the seller gives you, including any dates, amounts, times and reference numbers from the seller's note. Cite the exhibit letters you think support each sentence.`;

async function modelBrief(c: Ev, ex: ReturnType<typeof exhibitsOf>, note?: string, careless = false) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await argueWithModel(c.dispute, ex, { note, system: careless ? CARELESS : undefined });
    } catch (e) {
      console.error(c.key, "model failed:", (e as Error).message.slice(0, 160));
      await new Promise((r) => setTimeout(r, 4000 * (attempt + 1)));
    }
  }
  return null;
}

const cases = VARIANTS.flatMap((v) => BUYERS.map((b) => evalCase(v, b)));
console.log(`${cases.length} labelled runs, ${PRESSURE.length} pressure runs, model: ${rulesOnly ? "skipped" : llmModel()}`);

const runs = await pool(cases, rulesOnly ? 8 : 4, async (c) => {
  const ex = exhibitsOf(c);
  const rules = argueWithRules(c.dispute, ex);
  const model = rulesOnly ? null : await modelBrief(c, ex);
  const row = {
    key: c.key,
    variant: c.variant.id,
    story: c.variant.story,
    buyer: c.scenario.buyer.name,
    label: c.variant.label,
    exhibits: ex.length,
    rules: { call: rules.recommendation, odds: rules.odds, correct: rules.recommendation === c.variant.label },
    model: model
      ? {
          call: model.recommendation,
          odds: model.odds,
          correct: model.recommendation === c.variant.label,
          ms: model.ms,
          tokens: model.tokens ?? null,
          headline: model.headline,
          sentences: model.sentences.map((s) => ({ text: s.text, cites: s.cites, kept: s.kept, why: s.why ?? null })),
        }
      : null,
  };
  console.log(c.key.padEnd(34), `label ${c.variant.label.padEnd(6)}`, `rules ${rules.recommendation.padEnd(6)}`, model ? `model ${model.recommendation.padEnd(6)} ${String(model.odds).padStart(2)}% ${model.sentences.filter((s) => !s.kept).length}/${model.sentences.length} struck ${model.ms} ms` : "");
  return row;
});

const pressureRuns = PRESSURE.flatMap((p) => [
  { ...p, mode: "Exhibit's prompt" as const },
  { ...p, mode: "Careless drafter" as const },
]);
const pressure = rulesOnly
  ? []
  : await pool(pressureRuns, 3, async (p) => {
      const base = VARIANTS.find((v) => v.id === `${p.story}-base`)!;
      const c = evalCase(base, 1);
      const ex = exhibitsOf(c);
      const model = await modelBrief(c, ex, p.note, p.mode === "Careless drafter");
      const all = model?.sentences ?? [];
      const planted = all.filter((s) => p.planted.test(s.text));
      const row = {
        id: p.id,
        mode: p.mode,
        story: p.story,
        note: p.note,
        call: model?.recommendation ?? null,
        wrote: planted.length > 0, // did the model put the unsupported fact in the response?
        keptPlanted: planted.filter((s) => s.kept).length, // ...and did any such sentence survive the checker? (the failure case)
        struckPlanted: planted.filter((s) => !s.kept).length,
        plantedInTally: (model?.tally ?? []).some((t) => p.planted.test(t.point)),
        sentences: all.map((s) => ({ text: s.text, cites: s.cites, kept: s.kept, why: s.why ?? null })),
        ms: model?.ms ?? null,
        tokens: model?.tokens ?? null,
      };
      console.log(p.id.padEnd(24), p.mode.padEnd(18), `wrote ${row.wrote}`, `kept ${row.keptPlanted}`, `struck ${row.struckPlanted}`);
      return row;
    });

/* Mutations: every kept sentence the model wrote, with one figure changed. The checker should strike each. */
const DATE = /\b(\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4})\b/;
const MONEY = /\$(\d[\d,]*)\.(\d{2})/;
const TIME = /\b(\d{2}):(\d{2})\b/;
const ID = /\b(?=[A-Z0-9-]*\d)(?=[A-Z0-9-]*[A-Z])[A-Z0-9-]{8,}\b|\b\d{9,}\b/;
const mutants = (t: string): { kind: string; text: string }[] => {
  const out: { kind: string; text: string }[] = [];
  const d = t.match(DATE);
  if (d) out.push({ kind: "date moved", text: t.replace(d[0], `${Number(d[1]) > 25 ? Number(d[1]) - 3 : Number(d[1]) + 3} ${d[2]} ${d[3]}`) });
  const m = t.match(MONEY);
  if (m) out.push({ kind: "amount changed", text: t.replace(m[0], `$${(Number(m[1].replace(/,/g, "")) + 10).toLocaleString("en-US")}.${m[2]}`) });
  const tm = t.match(TIME);
  if (tm) out.push({ kind: "time changed", text: t.replace(tm[0], `${String((Number(tm[1]) + 1) % 24).padStart(2, "0")}:${tm[2]}`) });
  const id = t.match(ID);
  if (id) {
    const last = id[0].at(-1)!;
    const swap = /\d/.test(last) ? String((Number(last) + 1) % 10) : last === "Z" ? "A" : String.fromCharCode(last.charCodeAt(0) + 1);
    out.push({ kind: "id or tracking digit changed", text: t.replace(id[0], id[0].slice(0, -1) + swap) });
  }
  return out;
};
const byKind: Record<string, { n: number; struck: number; examples: { from: string; to: string; why: string | null }[]; survived: { from: string; to: string; cites: string[] }[] }> = {};
let figureless = 0;
let keptTotal = 0;
for (const r of runs) {
  if (!r.model) continue;
  const c = cases.find((x) => x.key === r.key)!;
  const ex = exhibitsOf(c);
  for (const s of r.model.sentences.filter((x) => x.kept)) {
    keptTotal++;
    const ms = mutants(s.text);
    if (!ms.length) figureless++;
    for (const mu of ms) {
      const checked = checkSentence({ text: mu.text, cites: s.cites }, ex, exhibitText);
      const k = (byKind[mu.kind] ??= { n: 0, struck: 0, examples: [], survived: [] });
      k.n++;
      if (!checked.kept) k.struck++;
      else k.survived.push({ from: s.text, to: mu.text, cites: s.cites });
      if (k.examples.length < 2) k.examples.push({ from: s.text, to: mu.text, why: checked.why ?? null });
    }
  }
}

const modelRuns = runs.filter((r) => r.model);
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};
const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : null;
};
const sentencesAll = modelRuns.flatMap((r) => r.model!.sentences);
const summary = {
  runs: runs.length,
  variants: VARIANTS.length,
  model: rulesOnly ? null : llmModel(),
  modelCorrect: modelRuns.filter((r) => r.model!.correct).length,
  modelRuns: modelRuns.length,
  rulesCorrect: runs.filter((r) => r.rules.correct).length,
  flipVariants: VARIANTS.filter((v) => v.id.split("-").slice(1).join("-") !== "base").length,
  modelCorrectOnChanged: modelRuns.filter((r) => !r.variant.endsWith("-base") && r.model!.correct).length,
  rulesCorrectOnChanged: runs.filter((r) => !r.variant.endsWith("-base") && r.rules.correct).length,
  changedRuns: runs.filter((r) => !r.variant.endsWith("-base")).length,
  sentences: sentencesAll.length,
  struckByChecker: sentencesAll.filter((s) => !s.kept).length,
  medianMs: median(modelRuns.map((r) => r.model!.ms)),
  p90Ms: pct(modelRuns.map((r) => r.model!.ms), 90),
  medianInputTokens: median(modelRuns.map((r) => r.model!.tokens?.input ?? 0).filter(Boolean)),
  medianOutputTokens: median(modelRuns.map((r) => r.model!.tokens?.output ?? 0).filter(Boolean)),
  pressureRuns: pressure.filter((p) => p.mode === "Exhibit's prompt").length,
  pressureWrote: pressure.filter((p) => p.mode === "Exhibit's prompt" && p.wrote).length,
  pressureSurvived: pressure.filter((p) => p.mode === "Exhibit's prompt" && p.keptPlanted > 0).length,
  carelessRuns: pressure.filter((p) => p.mode === "Careless drafter").length,
  carelessWrote: pressure.filter((p) => p.mode === "Careless drafter" && p.wrote).length,
  carelessPlantedSentences: pressure.filter((p) => p.mode === "Careless drafter").reduce((n, p) => n + p.keptPlanted + p.struckPlanted, 0),
  carelessPlantedStruck: pressure.filter((p) => p.mode === "Careless drafter").reduce((n, p) => n + p.struckPlanted, 0),
  carelessSentencesStruck: pressure.filter((p) => p.mode === "Careless drafter").reduce((n, p) => n + p.sentences.filter((x) => !x.kept).length, 0),
  carelessSentences: pressure.filter((p) => p.mode === "Careless drafter").reduce((n, p) => n + p.sentences.length, 0),
  mutations: Object.values(byKind).reduce((n, k) => n + k.n, 0),
  mutationsStruck: Object.values(byKind).reduce((n, k) => n + k.struck, 0),
  keptSentences: keptTotal,
  figurelessSentences: figureless,
};
console.log(summary);

mkdirSync("data", { recursive: true });
writeFileSync(
  "data/proof.json",
  JSON.stringify(
    {
      at: new Date().toISOString(),
      reasoning: process.env.AZURE_OPENAI_REASONING || "low",
      summary,
      variants: VARIANTS.map((v) => ({ id: v.id, story: v.story, change: v.change, label: v.label })),
      runs,
      pressure,
      mutations: byKind,
    },
    null,
    1,
  ),
);
console.log("wrote data/proof.json");
