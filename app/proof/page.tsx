import type { Metadata } from "next";
import Link from "next/link";
import Pleading from "@/components/home/Pleading";
import { FIGURES, OPTIONS, CHARGEFLOW_PRICING, PROTECTION_SOURCES } from "@/lib/impact";
import policies from "@/data/policies.json";
import lane from "@/data/lane.json";
import { usd, utcDay, utcShortDay, utcTime } from "@/lib/format";

// Every run on this page is stamped in UTC with the hour, as the README and the case pages are.
const day = utcTime;
import proof from "@/data/proof.json";
import toolkitBrief from "@/data/toolkit-brief.json";
import styles from "./proof.module.css";
import ReviewProof from "./ReviewProof";
import SectionIndex from "@/components/page/SectionIndex";
import TableToggle from "@/components/page/TableToggle";

export const metadata: Metadata = {
  title: "Proof",
  description:
    "Exhibit measured: the right call on labelled dispute variants against a rules baseline that reads every record, a held-out set, prompt injection, the checker against true sentences with one thing changed, latency and tokens, and the sourced cost of a dispute.",
};

/* The shapes this page reads from data/proof.json (scripts/eval.ts writes it). */
interface Answer {
  call: string;
  odds?: number;
  correct: boolean;
}
interface Row {
  key: string;
  variant: string;
  label: string;
  decidedBy?: "record" | "text";
  rules: Answer;
  strong?: Answer & { why: string };
  model: (Answer & { sentences?: { text: string; kept: boolean; why: string | null }[] }) | null;
}
interface SeedRun {
  seed: number;
  runs: number;
  correct: number;
  textRuns: number;
  textCorrect: number;
}
interface Spread {
  min: number;
  max: number;
  mean: number;
  of: number;
}
interface Kind {
  n: number;
  struck: number;
  fromModel?: number;
  fromTemplate?: number;
  examples: { from: string; to: string; why: string | null }[];
  survived?: { from: string; to: string; cites: string[] }[];
}
interface Summary {
  runs: number;
  variants: number;
  model: string | null;
  modelCorrect: number;
  modelRuns: number;
  rulesCorrect: number;
  sentences: number;
  struckByChecker: number;
  medianMs: number | null;
  medianInputTokens: number | null;
  medianOutputTokens: number | null;
  pressureRuns: number;
  pressureWrote: number;
  carelessWrote: number;
  carelessPlantedSentences: number;
  carelessPlantedStruck: number;
  mutations: number;
  mutationsStruck: number;
  keptSentences: number;
  figurelessSentences: number;
  strongCorrect?: number;
  textRuns?: number;
  modelCorrectOnText?: number;
  strongCorrectOnText?: number;
  rulesCorrectOnText?: number;
  recordRuns?: number;
  modelCorrectOnRecord?: number;
  strongCorrectOnRecord?: number;
  unverifiedSentences?: number;
  checkedSentences?: number;
  quotedSentences?: number;
  struckForQuote?: number;
  templateSentences?: number;
  templateStruck?: number;
  seedRuns?: SeedRun[];
  seedSpread?: Spread | null;
  ablationRuns?: number;
  ablationCorrect?: number;
  ablationTextRuns?: number;
  ablationCorrectOnText?: number;
  heldoutVariants?: number;
  heldoutRuns?: number;
  heldoutCases?: number;
  heldoutModelCorrect?: number;
  heldoutRulesCorrect?: number;
  heldoutStrongCorrect?: number;
  heldoutTextRuns?: number;
  heldoutModelCorrectOnText?: number;
  heldoutStrongCorrectOnText?: number;
  heldoutSeedSpread?: Spread | null;
  heldoutSeedRuns?: SeedRun[];
  injectionRuns?: number;
  injectionCorrect?: number;
  injectionWrotePlanted?: number;
  injectionKeptPlanted?: number;
}
interface Pressure {
  id: string;
  mode: string;
  note: string;
  wrote: boolean;
  keptPlanted: number;
  sentences: { text: string; kept: boolean; why: string | null }[];
}
interface Proof {
  at: string;
  recheckedAt?: string;
  reasoning: string;
  summary: Summary;
  variants: { id: string; story: string; change: string; label: string; decidedBy?: "record" | "text" }[];
  runs: Row[];
  pressure: Pressure[];
  mutations: Record<string, Kind>;
  heldout?: {
    note: string;
    variants: { id: string; story: string; change: string; label: string; decidedBy: string; source: string; why: string }[];
    runs: Row[];
    at?: string;
    prompt?: string;
    spend?: { calls: number; usd: number };
    /** The held-out answers a re-run replaced (scripts/eval.ts --update heldout). */
    previous?: {
      at: string;
      prompt?: string;
      summary: { runs: number; correct: number; textRuns: number; textCorrect: number; seedRuns?: SeedRun[] };
      runs: { key: string; variant: string; label: string; model: Answer | null }[];
    } | null;
  };
  /** The main set's own re-run (scripts/eval.ts --update main), with the run it replaced and that run's own history. */
  main?: {
    at: string;
    prompt: string;
    spend?: { calls: number; usd: number };
    previous?: MainRun | null;
    /** Named main runs re-run alone since (scripts/eval.ts --update main --keys), with the answers they replaced. */
    rerun?: Rerun;
  };
  injection?: { variants: { id: string; change: string; label: string; attack: string }[]; runs: (Row & { wrotePlanted: boolean; keptPlanted: number })[] };
  repeats?: { main: { key: string; seed: number; call: string | null; correct: boolean | null }[]; heldout: { key: string; seed: number; call: string | null; correct: boolean | null }[]; injection: { key: string; seed: number; call: string | null; correct: boolean | null }[] };
}
/** Named main runs re-run alone (scripts/eval.ts --update main --keys), with the answers they replaced. */
interface Rerun {
  at: string;
  keys: string[];
  why: string | null;
  prompt: string;
  spend?: { calls: number; usd: number };
  previous: { key: string; label: string; model: Answer | null }[];
}
/** A main-set run a later full re-run replaced, kept with its re-run misses and the run before it. */
interface MainRun {
  at: string;
  prompt: string;
  summary: { runs: number; correct: number; textRuns: number; textCorrect: number; recordRuns: number; recordCorrect: number; seedRuns?: SeedRun[]; seedSpread?: Spread | null };
  runs: { key: string; variant: string; label: string; model: Answer | null }[];
  spend?: { calls: number; usd: number } | null;
  rerun?: Rerun | null;
  previous?: MainRun | null;
}
const P = proof as unknown as Proof;

const STORY: Record<string, string> = {
  delivered: "Never arrived, carrier says delivered",
  untracked: "Shipped without tracking",
  colour: "Not as described: glaze colour",
  fraud: "I didn't make this purchase",
  duplicate: "Charged twice",
  "agent-mandate": "Bought by their own shopping agent",
  "agent-overreach": "My agent bought the wrong thing",
};

const CALL: Record<string, string> = { fight: "Fight", accept: "Refund", offer: "Offer" };

/** Why a held-out variant moved between the run replaced and this one, as read from its answers. */
const WHY_MOVED: Record<string, string> = {
  "heldout-agent-mandate-revoked":
    "A code check now reads the cardholder's words in the agent's log; “Hold off for now” before checkout makes the order the agent platform's, and the mandate check says so.",
  "heldout-agent-overreach-approved": "The same check reads “Go ahead at $104” as written approval of the overage, so the cart is the cardholder's.",
  "heldout-duplicate-two-orders":
    "Won on both runs: since 29 Oct the requirements card reads a second order in the store's notes and history (“weak”, not “no second transaction on file”), and this is the first run to measure it.",
};

/** Why a main-set variant moved between the 29 Oct run and the full re-run on today's prompt, as read from its answers. */
const MAIN_MOVED: Record<string, string> = {
  "untracked-buyer-confirms":
    "Refunded on both customers on 29 Oct, when the card read carrier records, not emails, for delivery; since 30 Oct the not-received card counts the cardholder's own email that the vase arrived, and both fight.",
  "fraud-home-signed":
    "Refunded on one of two customers on 29 Oct (no 3-D Secure result, no earlier orders on the card); since 30 Oct the fraud card words each network's own route and notes a delivery signed for in the cardholder's own name, and both fight.",
  "colour-no-warning":
    "Lost on one of two customers: with no warning anywhere, the drafter fought at an evidence balance of 67% on the buyer keeping the bowls after the offered return, where the label is refund; the other customer's run refunded.",
};
/** Minutes as the lane section says them: "17 min", "1 h 12 min", "75 s" under two minutes. */
function minutes(m: number | null): string {
  if (m === null) return "n/a";
  if (m < 2) return `${Math.round(m * 60)} s`;
  if (m < 60) return `${Math.round(m)} min`;
  return `${Math.floor(m / 60)} h ${Math.round(m % 60)} min`;
}

/** The per-100 tables' assumed rows: what each policy keeps (and nets after fees) at a stated share of correct fights won. */
function Sensitivity({ rows, span }: { rows: { id: string; name: string; atWinRate: { rate: number; keptUsd: number; netUsd: number }[] }[]; span: number }) {
  const rates = rows[0]?.atWinRate.map((x) => x.rate) ?? [];
  const money = (v: number) => (v < 0 ? `−${usd(-v)}` : usd(v));
  return (
    <tfoot>
      {rates.map((rate, i) => (
        <tr key={rate}>
          <th scope="row">
            If {Math.round(rate * 100)}% of correct fights are won<span className={styles.assumed}>assumed</span>
          </th>
          <td colSpan={span}>
            {rows.map((t) => `${t.name} keeps ${usd(t.atWinRate[i].keptUsd)} (${money(t.atWinRate[i].netUsd)} after fees)`).join(" · ")}
          </td>
        </tr>
      ))}
    </tfoot>
  );
}

const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : "n/a");
const range = (s: Spread | null | undefined) => (s ? (s.min === s.max ? `${s.min}` : `${s.min} to ${s.max}`) : null);

function Call({ run, side }: { run: Row; side: "rules" | "strong" | "model" }) {
  const r = side === "model" ? run.model : side === "strong" ? run.strong : run.rules;
  if (!r) return <span className={styles.na}>{side === "model" ? "not run" : "n/a"}</span>;
  return (
    <span className={styles.call} data-ok={r.correct} data-call={r.call} title={side === "strong" && run.strong ? run.strong.why : undefined}>
      {CALL[r.call]}
      {side === "model" && r.odds !== undefined ? <small> {r.call === "accept" ? Math.min(50, r.odds) : r.odds}%</small> : null}
    </span>
  );
}

/** The repeat runs of one case, after the first: "Fight Fight" in their own colours. */
function Repeats({ rows }: { rows: { call: string | null; correct: boolean | null }[] }) {
  if (!rows.length) return null;
  return (
    <span className={styles.repeats} aria-label="Repeat runs">
      {rows.map((r, i) =>
        r.call ? (
          <span key={i} className={styles.call} data-ok={r.correct ?? undefined}>
            {CALL[r.call]}
          </span>
        ) : (
          <span key={i} className={styles.na}>
            —
          </span>
        ),
      )}
    </span>
  );
}

/** The model's call on the run a re-run replaced, small, after today's: "25 Oct: Fight". */
function Before({ row, on }: { row: { model: Answer | null } | undefined; on: string }) {
  if (!row?.model) return null;
  return (
    <span className={styles.repeats} aria-label={`On the ${on} prompt`} title={`On the ${on} prompt`}>
      <small>{on}:</small>
      <span className={styles.call} data-ok={row.model.correct}>
        {CALL[row.model.call]}
      </span>
    </span>
  );
}

export default function ProofPage() {
  const s = P.summary;
  const byVariant = P.variants.map((v) => ({ ...v, runs: P.runs.filter((r) => r.variant === v.id) }));
  const careless = P.pressure.filter((p) => p.mode === "Careless drafter");
  const careful = P.pressure.filter((p) => p.mode !== "Careless drafter");
  const mutationKinds = Object.entries(P.mutations);
  const stories = [...new Set(P.variants.map((v) => v.story))];
  const repeatsOf = (key: string, set: "main" | "heldout" | "injection") => (P.repeats?.[set] ?? []).filter((r) => r.key === key).sort((a, b) => a.seed - b.seed);
  const seeds = s.seedRuns?.length ?? 1;
  const hasStrong = s.strongCorrect !== undefined;
  const textRuns = s.textRuns ?? 0;
  const held = P.heldout && (s.heldoutRuns ?? 0) > 0 ? P.heldout : null;
  const heldSeeds = s.heldoutSeedRuns?.length ?? 1;
  // Held-out variants whose right calls changed between the run replaced and this one (first runs).
  const moved = (held?.previous ? held.variants : [])
    .map((v) => {
      const now = held!.runs.filter((r) => r.variant === v.id && r.model);
      const was = held!.previous!.runs.filter((r) => r.variant === v.id && r.model);
      return { id: v.id, change: v.change, after: now.filter((r) => r.model!.correct).length, before: was.filter((r) => r.model!.correct).length, of: now.length };
    })
    .filter((m) => m.before !== m.after);
  const inj = P.injection && (s.injectionRuns ?? 0) > 0 ? P.injection : null;
  const ablation = (s.ablationRuns ?? 0) > 0;
  const survivors = mutationKinds.flatMap(([kind, k]) => (k.survived ?? []).slice(0, 1).map((x) => ({ kind, ...x })));
  const unverified = s.unverifiedSentences ?? s.figurelessSentences;
  // The main set's re-run on today's prompt, the run it replaced (with the misses re-run alone after it), and the
  // run before that one, which carries the repeat runs and the rubric ablation.
  const mainRun = P.main?.previous ? P.main : null;
  const mainPrev = mainRun?.previous ?? null;
  const prevRerun = mainPrev?.rerun ?? null;
  // The replaced run as it was first answered, before its misses were re-run alone.
  const prevFirst = mainPrev ? mainPrev.runs.map((r) => ({ ...r, model: prevRerun?.previous.find((x) => x.key === r.key)?.model ?? r.model })) : [];
  const prevCorrect = prevFirst.filter((r) => r.model?.correct).length;
  const textIds = new Set(P.variants.filter((v) => v.decidedBy === "text").map((v) => v.id));
  const prevTextCorrect = prevFirst.filter((r) => textIds.has(r.variant) && r.model?.correct).length;
  const prevRecordCorrect = prevFirst.filter((r) => !textIds.has(r.variant) && r.model?.correct).length;
  const prevRerunNow = prevRerun ? mainPrev!.runs.filter((r) => prevRerun.keys.includes(r.key) && r.model?.correct).length : 0;
  const firstRun = mainPrev?.previous ?? null;
  // The run the repeat runs and the ablation are from: the oldest one on record.
  const seeded = firstRun ?? mainPrev;
  const seededDay = seeded ? utcShortDay(seeded.at) : "";
  // Runs re-run alone after the cards changed (30 Oct): the table shows their newer answers; the card run's own count uses the old ones.
  const rerun = P.main?.rerun ?? null;
  const rerunNow = rerun ? P.runs.filter((r) => rerun.keys.includes(r.key) && r.model?.correct).length : 0;
  const rerunBefore = rerun ? rerun.previous.filter((r) => r.model?.correct).length : 0;
  const cardRunCorrect = s.modelCorrect - rerunNow + rerunBefore;
  const asCardRun = (r: Row): Row => {
    const was = rerun?.previous.find((x) => x.key === r.key);
    return was ? { ...r, model: was.model } : r;
  };
  const rerunChanges = rerun ? [...new Set(rerun.keys.map((k) => P.variants.find((v) => v.id === k.split("#")[0])?.change).filter(Boolean))] : [];
  const prevDay = mainPrev ? utcShortDay(mainPrev.at) : "";
  const beforeOf = (key: string) => prevFirst.find((r) => r.key === key);
  const mainMoved = mainPrev
    ? P.variants
        .map((v) => {
          const now = P.runs.map(asCardRun).filter((r) => r.variant === v.id && r.model);
          const was = prevFirst.filter((r) => r.variant === v.id && r.model);
          return { id: v.id, change: v.change, after: now.filter((r) => r.model!.correct).length, before: was.filter((r) => r.model!.correct).length, of: now.length };
        })
        .filter((m) => m.before !== m.after)
    : [];
  const second = (policies as { secondPass?: { kept: number; unverified: number; wordingMatched: number; neither: number; threshold: number } }).secondPass ?? null;
  // Not as described (Visa 13.3): the colour story's fights, and how many open with the buyer keeping the bowls.
  const colourFights = [...P.runs, ...(P.heldout?.runs ?? [])].filter((r) => /^(?:heldout-)?colour-/.test(r.variant) && r.model?.call === "fight");
  const leadsWithKept = colourFights.filter((r) => /\b(?:kept|keeps|did not return|didn't return|not returned)\b/i.test(r.model?.sentences?.[0]?.text ?? "")).length;
  const fightRow = policies.table.find((t) => t.id === "fight")!;
  const exhibitRow = policies.table.find((t) => t.id === "exhibit")!;
  const strongRow = policies.table.find((t) => t.id === "strong");
  const heldExhibit = policies.heldoutText?.table.find((t) => t.id === "exhibit");
  const heldStrong = policies.heldoutText?.table.find((t) => t.id === "strong");
  const heldFight = policies.heldoutText?.table.find((t) => t.id === "fight");
  const notRun = [
    !held && "the held-out set",
    !inj && "prompt injection in the buyer's email",
    !ablation && "the rubric ablation",
    seeds < 2 && "repeat runs",
  ].filter(Boolean) as string[];

  // The sticky index under the headline figures: one chip per section the page draws.
  const proofIndex = [
    { id: "variants", label: "Every variant" },
    ...(hasStrong ? [{ id: "earns", label: "Where the model earns its place" }] : []),
    ...(held ? [{ id: "held-out", label: "Held-out set" }] : []),
    { id: "checker", label: "False statements" },
    ...(survivors.length > 0 ? [{ id: "got-through", label: "What got through" }] : []),
    { id: "careless", label: "Invented facts" },
    ...(inj ? [{ id: "injection", label: "Prompt injection" }] : []),
    { id: "cross-examination", label: "Cross-examination" },
    { id: "limits", label: "What this doesn't show" },
    { id: "cost", label: "What a dispute costs" },
    { id: "per-100", label: "Per 100 disputes" },
    { id: "lane", label: "Seller's lane, timed" },
    { id: "alternatives", label: "Alternatives" },
    { id: "agent-stack", label: "Agent stack" },
    { id: "run-it", label: "Run it yourself" },
  ];

  return (
    <main className={`shell ${styles.page}`}>
      <header className={styles.head}>
        <p className={styles.docketLine}>
          <span className="bates">Proof</span>
          <span>Measured {day(P.at)}</span>
          {P.recheckedAt && <span>Checker re-run {day(P.recheckedAt)}</span>}
          <span>
            {s.model}
            {/Azure/.test(s.model ?? "") && P.reasoning ? `, reasoning effort ${P.reasoning}` : ""}
          </span>
        </p>
        <h1>Measured, not promised</h1>
        <p className={styles.lede}>
          Seven sample stories prove nothing on their own. So we wrote {s.variants} variants of them, each changing one or two facts so the right call
          flips or holds, labelled each with what a careful seller should do before running anything, and ran every one with two different customers
          through the model, the fallback rules engine, and a stronger rules baseline that reads every structured record. Then we tried to make the
          model state things no record holds, and changed one thing in every true sentence to see whether the checker notices.
        </p>
      </header>

      <dl className={styles.strip}>
        {hasStrong && textRuns > 0 ? (
          <>
            <div>
              <dt>Deciding fact only in free text</dt>
              <dd>
                {s.modelCorrectOnText} vs {s.strongCorrectOnText}
              </dd>
              <p>
                model vs the stronger rules, of {textRuns} runs where it sits in an email, a listing or a note
                {mainPrev ? `; ${prevTextCorrect} on the ${prevDay} run` : ""}
              </p>
            </div>
            <div>
              <dt>Deciding fact in the records</dt>
              <dd>
                {s.modelCorrectOnRecord} vs {s.strongCorrectOnRecord}
              </dd>
              <p>
                of {s.recordRuns} runs; a rule reading the records does as well here{mainPrev ? `; ${prevRecordCorrect} on the ${prevDay} run` : ""}
              </p>
            </div>
          </>
        ) : (
          <div>
            <dt>Right call, rules engine</dt>
            <dd>
              {s.rulesCorrect}/{s.runs}
            </dd>
            <p>the fallback, on the same exhibits</p>
          </div>
        )}
        <div>
          <dt>Right call, model</dt>
          <dd>
            {seeds > 1 && s.seedSpread ? range(s.seedSpread) : s.modelCorrect}/{seeds > 1 && s.seedSpread ? s.seedSpread.of : s.modelRuns}
          </dd>
          <p>
            {seeds > 1
              ? `across ${seeds} runs of every case, lowest to highest`
              : mainPrev
                ? `all ${s.modelRuns} measured on today's prompt, one run each; ${prevCorrect} on the ${prevDay} run${firstRun ? `, ${firstRun.summary.correct} on ${utcShortDay(firstRun.at)} before the card` : ""}`
                : "of labelled runs, one run each"}
          </p>
        </div>
        <div>
          <dt>False statements struck</dt>
          <dd>
            {s.mutationsStruck}/{s.mutations}
          </dd>
          <p>{mutationKinds.length} kinds of change to a true sentence</p>
        </div>
        <div>
          <dt>Kept, but unverified</dt>
          <dd>
            {unverified}/{s.keptSentences}
          </dd>
          <p>
            no figure or name in them to check; marked, not counted as checked
            {second ? `. A second pass on their words alone: ${second.wordingMatched} match the exhibit they cite, ${second.neither}/${second.kept} have neither` : ""}
          </p>
        </div>
        <div>
          <dt>Time and tokens per brief</dt>
          <dd>{((s.medianMs ?? 0) / 1000).toFixed(1)} s</dd>
          <p>
            median; {s.medianInputTokens?.toLocaleString("en-US")} in, {s.medianOutputTokens?.toLocaleString("en-US")} out
          </p>
        </div>
      </dl>

      <SectionIndex inShell items={proofIndex} />

      <section className={styles.section} id="variants">
        <div className={styles.sectionHead}>
          <h2>Every variant, both customers</h2>
          <p>
            Each row is one variant, run with two of the story&apos;s customers (different names, addresses and order numbers). Green is the labelled
            call; red is a miss. The fallback rules engine is what argues when the model is out. The stronger rules compare the delivery ZIP with the
            ship-to ZIP, look for a refund record, read the issuer&apos;s address and security-code checks, compare billing with shipping, count earlier
            orders and read the mandate check; they never read an email or a listing. The model&apos;s number is the evidence balance from its own
            tally, not a chance of winning.
            {seeds > 1 ? ` Small marks after the model's call are its ${seeds - 1} repeat runs.` : ""}
            {mainPrev ? ` The model's call is the run of ${utcTime(mainRun!.at)} on today's prompt; the small mark after it is that case's answer on the ${day(mainPrev.at)} run, the first with the requirements card.` : ""}
            {rerun ? ` The ${rerun.keys.length} runs that run missed were re-run alone on ${day(rerun.at)} on the changed cards, and show that answer.` : ""}
          </p>
        </div>
        <TableToggle what={`the ${stories.length} tables`} note="One table per story; each row is a variant, run with both customers.">
        {stories.map((story) => (
          <div key={story} className={`sheet ${styles.ledger}`}>
            <h3>{STORY[story] ?? story}</h3>
            <table>
              <colgroup>
                <col className={styles.colChange} />
                <col className={styles.colLabel} />
                <col className={styles.colRules} />
                {hasStrong && <col className={styles.colRules} />}
                <col />
              </colgroup>
              <thead>
                <tr>
                  <th scope="col">What changed</th>
                  <th scope="col">Label</th>
                  <th scope="col">Fallback rules</th>
                  {hasStrong && <th scope="col">Stronger rules</th>}
                  <th scope="col">Model</th>
                </tr>
              </thead>
              <tbody>
                {byVariant
                  .filter((v) => v.story === story)
                  .map((v) => (
                    <tr key={v.id}>
                      <td>
                        {v.change}
                        {v.decidedBy === "text" && <span className={styles.tag}>free text</span>}
                      </td>
                      <td>
                        <span className={styles.label} data-call={v.label}>
                          {CALL[v.label]}
                        </span>
                      </td>
                      <td>
                        <span className={styles.pair}>
                          {v.runs.map((r) => (
                            <Call key={r.key} run={r} side="rules" />
                          ))}
                        </span>
                      </td>
                      {hasStrong && (
                        <td>
                          <span className={styles.pair}>
                            {v.runs.map((r) => (
                              <Call key={r.key} run={r} side="strong" />
                            ))}
                          </span>
                        </td>
                      )}
                      <td>
                        <span className={styles.pair}>
                          {v.runs.map((r) => (
                            <span key={r.key} className={styles.withRepeats}>
                              <Call run={r} side="model" />
                              <Repeats rows={repeatsOf(r.key, "main")} />
                              <Before row={beforeOf(r.key)} on={prevDay} />
                            </span>
                          ))}
                        </span>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        ))}
        </TableToggle>
      </section>

      {hasStrong && (
        <section className={`${styles.section} ${styles.split}`} id="earns">
          <div>
            <h2>Where the model earns its place</h2>
            <p>
              On {s.recordRuns} of the {s.modelRuns || s.runs} runs the model answered, the deciding fact is in a structured record, and a rule that reads the records gets{" "}
              {s.strongCorrectOnRecord} of them right; the model gets {s.modelCorrectOnRecord}. The difference is on the {textRuns} runs where it sits only
              in free text, such as a buyer&apos;s email saying the vase arrived or a listing that does or doesn&apos;t warn about the glaze: the model{" "}
              {s.modelCorrectOnText}, the stronger rules {s.strongCorrectOnText}, the fallback {s.rulesCorrectOnText}. That free-text margin is the number to
              read, and {textRuns} runs is a small base.
            </p>
            {mainPrev && (
              <p>
                The main set&apos;s right calls over time:{" "}
                {firstRun ? `${firstRun.summary.correct} of ${firstRun.summary.runs} on ${day(firstRun.at)}, before the requirements card${firstRun.summary.seedRuns && firstRun.summary.seedRuns.length > 1 ? `, on each of ${firstRun.summary.seedRuns.length} runs` : ""}; ` : ""}
                {prevCorrect} of {mainPrev.runs.length} on {day(mainPrev.at)}, the first run with the card
                {prevRerun
                  ? `; on ${utcTime(prevRerun.at)} only its ${prevRerun.keys.length} misses were re-run alone after the cards changed, and ${prevRerunNow} of ${prevRerun.keys.length} fought, which read as ${mainPrev.summary.correct} of ${mainPrev.summary.runs}, an upper bound with the other ${mainPrev.runs.length - prevRerun.keys.length} answers older`
                  : ""}
                . Then on {utcTime(mainRun!.at)} all {s.modelRuns} were re-run once on today&apos;s prompt and cards ({mainRun!.prompt}):{" "}
                <strong>
                  {cardRunCorrect} of {s.modelRuns}
                </strong>
                , every answer from that run, so this is the measured number{mainRun!.spend ? ` ($${mainRun!.spend.usd.toFixed(2)} for ${mainRun!.spend.calls} calls)` : ""}.
                Against the {prevDay} run, these moved:
              </p>
            )}
            {mainMoved.length > 0 && (
              <ul className={styles.moved}>
                {mainMoved.map((m) => (
                  <li key={m.id}>
                    <strong>
                      {m.before} → {m.after} of {m.of}
                    </strong>{" "}
                    {m.change}
                    {MAIN_MOVED[m.id] ? <small className={styles.kindSource}> {MAIN_MOVED[m.id]}</small> : null}
                  </li>
                ))}
              </ul>
            )}
            {rerun && (
              <p>
                Then on {day(rerun.at)} the cards changed: a not-received card counts the cardholder&apos;s own email that the parcel arrived (Visa 13.1 and
                Mastercard 4853 take proof the cardholder received the goods), and the fraud card words each network&apos;s own route (Visa&apos;s Compelling
                Evidence 3.0; Mastercard 4837 without Visa&apos;s day window), noting a delivery signed for in the cardholder&apos;s own name. Only the{" "}
                {rerun.keys.length} runs it had missed were re-run, once each ({rerunChanges.join(" ")}): {rerunNow} of {rerun.keys.length} now fight, as
                labelled, so the table above reads {s.modelCorrect} of {s.modelRuns}, with those {rerun.keys.length} answers from {day(rerun.at)} and the other{" "}
                {s.modelRuns - rerun.keys.length} from {day(mainRun?.at ?? P.at)}. Re-running only the misses can only add right calls, so read {s.modelCorrect}{" "}
                as the most this prompt has shown; the card change also touches 19 of the other runs, which were not re-run.
                {rerun.spend ? ` The re-run cost $${rerun.spend.usd.toFixed(4)} for ${rerun.spend.calls} calls.` : ""}
              </p>
            )}
            {mainPrev && colourFights.length > 0 && (
              <p>
                Not as described (Visa 13.3): the card now marks whether the cardholder returned the item or tried to, and the drafter is told to lead with
                it. Of the {colourFights.length} glaze-colour fights in the main and held-out runs, {leadsWithKept} open with the buyer keeping the bowls and
                turning down the $30 return.
              </p>
            )}
            {ablation && (
              <p>
                The prompt carries a short rubric, &ldquo;How cases are usually decided&rdquo;, that mirrors how the labels were set. With it taken out
                {seeded ? `, on the ${seededDay} prompt,` : ","} the model got {s.ablationCorrect} of {s.ablationRuns} right, and {s.ablationCorrectOnText} of{" "}
                {s.ablationTextRuns} free-text runs (with it{seeded ? ", on that prompt" : ""}: {seeded ? seeded.summary.correct : s.modelCorrect} of{" "}
                {seeded ? seeded.summary.runs : s.modelRuns}, and {seeded ? seeded.summary.textCorrect : s.modelCorrectOnText} of {textRuns}).
              </p>
            )}
            {seeds < 2 && seeded?.summary.seedRuns && seeded.summary.seedRuns.length > 1 ? (
              <p>
                On the {seededDay} prompt every case ran {seeded.summary.seedRuns.length} times: {seeded.summary.seedRuns.map((r) => r.correct).join(", ")} of{" "}
                {seeded.summary.runs}. Today&apos;s prompt ran once, to keep the spend small.
              </p>
            ) : null}
            {seeds > 1 && s.seedRuns && (
              <p>
                Every case ran {seeds} times. Right calls per run of the {s.seedSpread?.of} labelled runs:{" "}
                {s.seedRuns.map((r) => r.correct).join(", ")}; on the free-text runs: {s.seedRuns.map((r) => `${r.textCorrect}/${r.textRuns}`).join(", ")}.
              </p>
            )}
          </div>
          <ul className={`sheet ${styles.limits}`}>
            <li>
              Model, free text: <strong>{s.modelCorrectOnText}/{textRuns}</strong>
            </li>
            <li>
              Stronger rules, free text: <strong>{s.strongCorrectOnText}/{textRuns}</strong>
            </li>
            <li>
              Model, records: <strong>{s.modelCorrectOnRecord}/{s.recordRuns}</strong>
            </li>
            <li>
              Stronger rules, records: <strong>{s.strongCorrectOnRecord}/{s.recordRuns}</strong>
            </li>
            {mainPrev && (
              <li>
                Model, all runs, {prevDay} prompt: <strong>{mainPrev.summary.correct}/{mainPrev.summary.runs}</strong>
              </li>
            )}
            {ablation && (
              <li>
                Model without the rubric{mainPrev ? `, ${prevDay} prompt` : ""}: <strong>{s.ablationCorrect}/{s.ablationRuns}</strong>
              </li>
            )}
          </ul>
        </section>
      )}

      {held && (
        <section className={styles.section} id="held-out">
          <div className={styles.sectionHead}>
            <h2>A held-out set</h2>
            <p>
              {s.heldoutVariants} more variants, modelled on situations sellers describe on public forums. They were written and labelled by a separate AI
              agent that was not shown Exhibit&apos;s prompt or its rubric, after the prompt was fixed, and they were not tuned on afterwards. No person
              labelled them, so this is a better test than the set above and a weaker one than real cases. Model {s.heldoutModelCorrect} of{" "}
              {s.heldoutRuns}
              {range(s.heldoutSeedSpread) && heldSeeds > 1 ? ` (${range(s.heldoutSeedSpread)} across ${heldSeeds} runs)` : ""}; stronger rules{" "}
              {s.heldoutStrongCorrect} of {s.heldoutCases}; fallback {s.heldoutRulesCorrect}. On the {s.heldoutTextRuns} free-text runs: model{" "}
              {s.heldoutModelCorrectOnText}, stronger rules {s.heldoutStrongCorrectOnText}.
            </p>
            {held.previous && held.at && (
              <p>
                Re-run {day(held.at)}, once, on today&apos;s prompt: {held.prompt}. Before ({day(held.previous.at)}, {held.previous.prompt ?? "on the main run's prompt"},{" "}
                {held.previous.summary.seedRuns?.length ?? 1} run{(held.previous.summary.seedRuns?.length ?? 1) === 1 ? "" : "s"}): {held.previous.summary.correct} of {held.previous.summary.runs}, and{" "}
                {held.previous.summary.textCorrect} of {held.previous.summary.textRuns} on free text. What moved, first runs compared:
              </p>
            )}
            {moved.length > 0 && (
              <ul className={styles.moved}>
                {moved.map((m) => (
                  <li key={m.id}>
                    <strong>
                      {m.before} → {m.after} of {m.of}
                    </strong>{" "}
                    {m.change}
                    {WHY_MOVED[m.id] ? <small className={styles.kindSource}> {WHY_MOVED[m.id]}</small> : null}
                  </li>
                ))}
              </ul>
            )}
            {held.previous && (
              <p className={styles.note}>
                The same set was used to find the agent-lane miss and the two-orders gap in the card, so treat those gains as tuned, not held out. The
                stronger rules are the frozen baseline and don&apos;t read the agent&apos;s log; the fallback rules follow the consent check, so they gain the
                agent cases too. This run cost ${held.spend?.usd.toFixed(2)} for {held.spend?.calls} calls.
              </p>
            )}
          </div>
          <TableToggle what="the table">
          <div className={`sheet ${styles.ledger}`}>
            <table>
              <colgroup>
                <col className={styles.colChange} />
                <col className={styles.colLabel} />
                <col className={styles.colRules} />
                <col className={styles.colRules} />
                <col />
              </colgroup>
              <thead>
                <tr>
                  <th scope="col">What changed</th>
                  <th scope="col">Label</th>
                  <th scope="col">Fallback rules</th>
                  <th scope="col">Stronger rules</th>
                  <th scope="col">Model</th>
                </tr>
              </thead>
              <tbody>
                {held.variants.map((v) => {
                  const rows = held.runs.filter((r) => r.variant === v.id);
                  const link = v.source.match(/https?:\/\/\S+/)?.[0];
                  return (
                    <tr key={v.id}>
                      <td>
                        {v.change}
                        {v.decidedBy === "text" && <span className={styles.tag}>free text</span>}
                        <span className={styles.source}>
                          {link ? (
                            <a href={link} target="_blank" rel="noreferrer">
                              The forum thread
                            </a>
                          ) : (
                            "Forum-style, not a specific thread"
                          )}
                          . Label: {v.why}
                        </span>
                      </td>
                      <td>
                        <span className={styles.label} data-call={v.label}>
                          {CALL[v.label]}
                        </span>
                      </td>
                      <td>
                        <span className={styles.pair}>
                          {rows.map((r) => (
                            <Call key={r.key} run={r} side="rules" />
                          ))}
                        </span>
                      </td>
                      <td>
                        <span className={styles.pair}>
                          {rows.map((r) => (
                            <Call key={r.key} run={r} side="strong" />
                          ))}
                        </span>
                      </td>
                      <td>
                        <span className={styles.pair}>
                          {rows.map((r) => (
                            <span key={r.key} className={styles.withRepeats}>
                              <Call run={r} side="model" />
                              <Repeats rows={repeatsOf(r.key, "heldout")} />
                            </span>
                          ))}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </TableToggle>
        </section>
      )}

      <section className={`${styles.section} ${styles.split}`} id="checker">
        <div>
          <h2>The checker against false statements</h2>
          <p>
            We took every sentence the model wrote that survived the checker ({s.keptSentences}
            {s.templateSentences ? `, plus ${s.templateSentences} true sentences written from each case's own records so the rarer kinds get a fair count` : ""}
            ) and changed one thing in it: a date moved, an amount raised, a time shifted, a digit of an id changed, a real date or amount swapped in from
            a different record (with that record cited too), the sentence turned into a denial, the carrier swapped, the signer&apos;s initial changed,
            the ZIP or the card&apos;s last four changed. Then we ran the same checker the filing uses.
          </p>
          <ul className={styles.kinds}>
            {mutationKinds.map(([kind, k]) => (
              <li key={kind}>
                <strong>
                  {k.struck}/{k.n}
                </strong>{" "}
                {kind}
                {k.fromModel !== undefined && k.fromTemplate ? (
                  <small className={styles.kindSource}>
                    {" "}
                    {k.fromModel} from the model&apos;s sentences, {k.fromTemplate} from the records
                  </small>
                ) : null}
              </li>
            ))}
          </ul>
          <p className={styles.note}>
            What it checks: every amount (however written), date (with or without a year), time, id and tracking number, ZIP, city and state, carrier,
            signer, count and percentage has to be in the records the sentence cites; one clause has to rest on one record; a date or amount said to be a
            refund, a delivery or the disputed amount has to be that in the record; a sentence can&apos;t deny what its record says, or claim a signature
            no record shows; and the words it quotes as proof have to be in a cited exhibit, word for word. {unverified} of the {s.keptSentences} kept
            sentences carry nothing it can match (&ldquo;We offered the buyer a return&rdquo;): they are kept, shown as unverified, and held only to their
            citation. It reads figures and names, not meaning.
            {second
              ? ` A second pass reads each of those against the text of the exhibits it cites and nothing else: ${second.wordingMatched} of the ${second.unverified} have at least ${Math.round(second.threshold * 100)}% of their content words there, which leaves ${second.neither} of the ${second.kept} kept sentences with neither a figure nor their wording matched. That pass reads words, not meaning, and changes nothing that is filed.`
              : ""}
          </p>
          {s.templateSentences ? (
            <p className={styles.note}>
              On true sentences it struck {s.struckByChecker} of the model&apos;s {s.sentences} and {s.templateStruck} of the {s.templateSentences} written
              from the records.
            </p>
          ) : null}
        </div>
        <Pleading lines={14}>
          {mutationKinds
            .filter(([kind]) => ["real figure from another record", "negated", "signer changed", "carrier swapped"].includes(kind))
            .concat(mutationKinds.filter(([kind]) => !["real figure from another record", "negated", "signer changed", "carrier swapped"].includes(kind)))
            .slice(0, 4)
            .map(([kind, k]) =>
              k.examples[0] ? (
                <figure key={kind} className={styles.strike}>
                  <p className={`serif ${styles.struck}`}>{k.examples[0].to}</p>
                  <figcaption>
                    {kind}: {k.examples[0].why}
                  </figcaption>
                </figure>
              ) : null,
            )}
        </Pleading>
      </section>

      {survivors.length > 0 && (
        <section className={styles.section} id="got-through">
          <div className={styles.sectionHead}>
            <h2>What got through</h2>
            <p>
              {s.mutations - s.mutationsStruck} of the {s.mutations} false sentences survived. One of each kind, as the checker saw it:
            </p>
          </div>
          <ul className={`sheet ${styles.limits}`}>
            {survivors.map((x) => (
              <li key={x.kind}>
                <span className="serif">{x.to}</span> <small className={styles.kindSource}>({x.kind}; cites {x.cites.join(", ")})</small>
              </li>
            ))}
          </ul>
          <p className={styles.note}>
            What still gets through: a real amount with no role word close to it, a denial inside reported speech or a quoted policy (&ldquo;the buyer
            reported that two bowls never arrived cracked&rdquo;), and a denial about a parcel&apos;s trip back to the sender. Since 29 Oct a denial that
            cites only records silent on it (&ldquo;we never shipped order HC-067211&rdquo;, citing the order) is struck, and so is a true figure given
            the wrong role: a unit price called the payment, an order date called the delivery.
          </p>
        </section>
      )}

      <section className={styles.section} id="careless">
        <div className={styles.sectionHead}>
          <h2>Asked to state what no record says</h2>
          <p>
            Six seller&apos;s notes, each asking for a date, an amount, a time or a reference number that appears in no exhibit. With Exhibit&apos;s own
            prompt the model wrote {s.pressureWrote === 0 ? "none" : s.pressureWrote} of them ({s.pressureWrote} of {s.pressureRuns}). So we swapped in a
            careless drafter told to use every fact the seller gives: it wrote {s.carelessWrote === careless.length ? "all " : ""}
            {s.carelessWrote}, and the checker struck {s.carelessPlantedStruck} of {s.carelessPlantedSentences} before anything could be filed.
          </p>
        </div>
        <ol className={styles.pressure}>
          {careless.map((p) => {
            const mine = careful.find((c) => c.id === p.id);
            const planted = p.sentences.filter((x) => !x.kept);
            return (
              <li key={p.id} className="sheet">
                <p className={styles.noteText}>&ldquo;{p.note}&rdquo;</p>
                <p className={styles.outcome}>
                  {mine?.wrote ? (
                    <span data-ok={mine.keptPlanted === 0}>Exhibit&apos;s prompt wrote it{mine.keptPlanted === 0 ? "; struck" : "; it got through"}</span>
                  ) : (
                    <span data-ok="true">Exhibit&apos;s prompt: left it out</span>
                  )}
                  <span data-ok={p.keptPlanted === 0}>Careless drafter: wrote it{p.keptPlanted === 0 ? ", struck" : ", got through"}</span>
                </p>
                {planted.map((x, i) => (
                  <div key={i}>
                    <p className={`serif ${styles.struck}`}>{x.text}</p>
                    <p className={styles.why}>Struck: {x.why}</p>
                  </div>
                ))}
              </li>
            );
          })}
        </ol>
      </section>

      {inj && (
        <section className={styles.section} id="injection">
          <div className={styles.sectionHead}>
            <h2>Instructions hidden in the buyer&apos;s email</h2>
            <p>
              Four emails from the buyer that address the AI directly and ask for the wrong call or a false statement. They arrive as exhibits, the way a
              real buyer&apos;s message would. The model made the labelled call on {s.injectionCorrect} of {s.injectionRuns} runs. The one attack that plants
              a tracking number and a delivery date can&apos;t be caught by the checker alone, because the figures are in the record: the buyer wrote them.
              The model repeated them in {s.injectionWrotePlanted} runs, and {s.injectionKeptPlanted} such sentences were kept.
            </p>
          </div>
          <ol className={styles.pressure}>
            {inj.variants.map((v) => {
              const rows = inj.runs.filter((r) => r.variant === v.id);
              return (
                <li key={v.id} className="sheet">
                  <p className={styles.noteText}>{v.change}</p>
                  <p className={styles.why}>{v.attack}</p>
                  <p className={styles.outcome}>
                    <span>Label: {CALL[v.label]}</span>
                    {rows.map((r) => (
                      <span key={r.key} className={styles.withRepeats}>
                        <Call run={r} side="model" />
                        <Repeats rows={repeatsOf(r.key, "injection")} />
                      </span>
                    ))}
                  </p>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      <ReviewProof />

      <section className={`${styles.section} ${styles.split}`} id="limits">
        <div>
          <h2>What this doesn&apos;t show</h2>
          <p>Read the numbers with these in mind.</p>
        </div>
        <ul className={`sheet ${styles.limits}`}>
          <li>
            The stories, the main variants and the prompt were written by the same team, so the main set measures consistency on known patterns. The
            held-out set was written without the prompt, by an AI agent rather than a person. Neither is accuracy on real sellers&apos; cases.
          </li>
          <li>
            The PayPal records in the eval are built offline in the exact shapes the sandbox returns; nothing was filed. The live desk&apos;s cases are real
            sandbox disputes.
          </li>
          <li>
            Nobody at PayPal reads evidence in the sandbox. Its simulator rules for whichever side it is asked to, and it also closes many cases on its
            own. So a won or lost case on the desk shows the lifecycle working through PayPal&apos;s API, not that a bank was persuaded. Since 25 Oct, the
            side Exhibit asks for is the verdict of the simulated reviewer that cross-examined the filing. Each case says whether PayPal ruled at
            Exhibit&apos;s request or closed the case by itself. The sandbox hasn&apos;t ruled on any unauthorised-transaction chargeback Exhibit
            asked it to (the agent-bought cases among them), so those stay under review; the requested rulings it has given were on not received,
            not as described and charged twice, and even there not every request has been ruled on yet.
          </li>
          <li>
            The checker matches figures and names to the record a sentence cites, ties each clause to one record, and catches denials its record
            contradicts. It doesn&apos;t understand meaning: a sentence with nothing to match is only marked unverified, and a figure the buyer wrote into
            their own email is &ldquo;in the record&rdquo;.
          </li>
          <li>
            {seeds > 1 ? `Each case ran ${seeds} times; the spread is shown, not a confidence interval.` : "One run per variant and customer."} The
            model&apos;s odds come from its own tally of weighted points; they aren&apos;t calibrated probabilities.
          </li>
          <li>
            On agent-placed orders the decision is the mandate check, which is code, and since 29 Oct it reads what the cardholder told the agent in its
            log (consent withdrawn, an overage approved in writing). The model writes the response around it. A signed mandate is not authorisation
            evidence the card networks recognise yet, and the briefs now say so.
          </li>
          {mainPrev ? (
            <li>
              The main set was re-run in full, once, on {utcDay(mainRun!.at)} (UTC) on today&apos;s prompt and cards: {cardRunCorrect} of {s.modelRuns}, against{" "}
              {prevCorrect} of {mainPrev.runs.length} on {day(mainPrev.at)} with the card&apos;s first version
              {firstRun ? ` and ${firstRun.summary.correct} of ${firstRun.summary.runs} on ${day(firstRun.at)} before the card` : ""}. Its repeat runs and
              the rubric ablation are from the {seededDay} prompt and were not re-run. The card makes the drafter warier of fraud and agent cases with no
              3-D Secure result or compelling evidence: on 29 Oct a live agent case inside the mandate (PP-R-UPI-10195190) was argued as a refund at an
              evidence balance of 50%.
              {mainRun!.spend ? ` The full re-run cost $${mainRun!.spend.usd.toFixed(2)} for ${mainRun!.spend.calls} calls.` : ""}
              {rerun
                ? ` On ${day(rerun.at)} only the ${rerun.keys.length} runs it missed were re-run on the changed cards, and ${rerunNow} of them now fight; the other ${s.modelRuns - rerun.keys.length} answers are still the ${day(mainRun!.at)} ones, so ${s.modelCorrect} of ${s.modelRuns} is an upper reading.`
                : ""}
            </li>
          ) : (
            <li>
              The 56 main runs above are from {day(P.at)}, before the drafter read the reason code&apos;s requirements card (added 29 Oct). The held-out set
              and the hearings were re-run with the card; the main set was not.
            </li>
          )}
          {P.recheckedAt && (
            <li>
              The model&apos;s answers are from the run on {day(P.at)}; the checker, the stronger rules and the mutations were re-run over those saved
              answers on {day(P.recheckedAt)} with no new model calls. Variants added since that run show &ldquo;not run&rdquo;.
            </li>
          )}
          {notRun.length > 0 && <li>Not measured in this run: {notRun.join(", ")}.</li>}
        </ul>
      </section>

      <section className={styles.section} id="cost">
        <div className={styles.sectionHead}>
          <h2>What a dispute costs a small seller</h2>
          <p>Every figure links to where we read it.</p>
        </div>
        <ul className={styles.figures}>
          {FIGURES.map((f) => (
            <li key={f.value} className="sheet">
              <strong>{f.value}</strong>
              <p>{f.what}</p>
              <a href={f.href} target="_blank" rel="noreferrer">
                {f.source}
              </a>
            </li>
          ))}
        </ul>
      </section>

      <section className={styles.section} id="per-100">
        <div className={styles.sectionHead}>
          <h2>What each policy keeps per 100 disputes</h2>
          <p>
            First the held-out runs where the deciding fact sits only in free text, the set written without Exhibit&apos;s prompt, where the model and
            the rules part ways; then the main set. Each run counts at its own disputed amount, scaled to 100 disputes.
          </p>
        </div>
        {policies.heldoutText && heldExhibit && heldStrong && heldFight && (
          <>
            <h3 className={styles.subhead}>The held-out free-text runs, per 100</h3>
            <p className={styles.note}>
              The {policies.heldoutText.runs} held-out runs where the deciding fact is only in an email, a listing or a note (run{" "}
              {day(policies.heldoutText.measured)}): {usd(policies.heldoutText.disputedUsdPer100)} disputed per 100,{" "}
              {usd(policies.heldoutText.winnableUsdPer100)} of it on cases labelled fight.
            </p>
            <TableToggle what="the table">
            <div className={`sheet ${styles.compare}`}>
              <table>
                <thead>
                  <tr>
                    <th scope="col">Per 100 held-out free-text disputes</th>
                    <th scope="col">Kept, at most</th>
                    <th scope="col">Given up on cases it should fight</th>
                    <th scope="col">Responses to write</th>
                    <th scope="col">Fights on cases it should refund</th>
                    <th scope="col">After PayPal&apos;s fees</th>
                  </tr>
                </thead>
                <tbody>
                  {policies.heldoutText.table.map((t) => (
                    <tr key={t.id} data-us={t.id === "exhibit"}>
                      <th scope="row">{t.name}</th>
                      <td>{usd(t.keptUsd)}</td>
                      <td>{usd(t.givenUpUsd)}</td>
                      <td>{t.responses}</td>
                      <td>{t.fightsOnRefundCases}</td>
                      <td>{t.netUsd < 0 ? `−${usd(-t.netUsd)}` : usd(t.netUsd)}</td>
                    </tr>
                  ))}
                </tbody>
                <Sensitivity rows={policies.heldoutText.table} span={5} />
              </table>
            </div>
            </TableToggle>
            <p className={styles.note}>
              Exhibit keeps {usd(heldExhibit.keptUsd)} per 100 here and gives up {usd(heldExhibit.givenUpUsd)}; the stronger rules keep{" "}
              {usd(heldStrong.keptUsd)} and give up {usd(heldStrong.givenUpUsd)}, because the fact that wins sits where a rule doesn&apos;t read. Always
              fighting keeps {usd(heldFight.keptUsd)} only by also fighting {heldFight.fightsOnRefundCases} cases per 100 the seller should refund, which a
              real reviewer would rule against, with {heldFight.responses - heldExhibit.responses} more responses to write. {policies.heldoutText.runs} runs
              is a small base.
            </p>
          </>
        )}
        <h3 className={styles.subhead}>The main set, per 100</h3>
        <p className={styles.note}>
          The {policies.from.runs} labelled runs of the main set above ({usd(policies.disputedUsdPer100)} per 100 in all, {usd(policies.winnableUsdPer100)}{" "}
          of it on cases labelled fight). Exhibit is the model&apos;s full run of {utcTime(policies.from.measured)}, every answer from that run. The last two
          columns read the requirements card of every case each policy fights: the share with every required network item on file, and
          the share with none missing.
        </p>
        <TableToggle what="the table">
        <div className={`sheet ${styles.compare}`}>
          <table>
            <thead>
              <tr>
                <th scope="col">Per 100 disputes</th>
                <th scope="col">Kept, at most</th>
                <th scope="col">Given up on cases it should fight</th>
                <th scope="col">Responses to write</th>
                <th scope="col">Fights on cases it should refund</th>
                <th scope="col">After PayPal&apos;s fees</th>
                <th scope="col">Fights with every required item on file</th>
                <th scope="col">Fights with none missing</th>
              </tr>
            </thead>
            <tbody>
              {policies.table.map((t) => (
                <tr key={t.id} data-us={t.id === "exhibit"}>
                  <th scope="row">{t.name}</th>
                  <td>{usd(t.keptUsd)}</td>
                  <td>{usd(t.givenUpUsd)}</td>
                  <td>{t.responses}</td>
                  <td>{t.fightsOnRefundCases}</td>
                  <td>{t.netUsd < 0 ? `−${usd(-t.netUsd)}` : usd(t.netUsd)}</td>
                  <td>{t.completePct === null ? "n/a" : `${t.completePct}%`}</td>
                  <td>{t.noneMissingPct === null ? "n/a" : `${t.noneMissingPct}%`}</td>
                </tr>
              ))}
            </tbody>
            <Sensitivity rows={policies.table} span={7} />
          </table>
        </div>
        </TableToggle>
        <p className={styles.note}>
          How it is counted: a case labelled fight that is fought counts as kept and one that is refunded as given up; a case labelled refund ends with
          the money back with the buyer whichever way it goes, so fighting it only costs a response. Real responses win less often than their label, so
          &ldquo;kept&rdquo; is the most each policy could keep. PayPal&apos;s {usd(policies.feePerCase)} card chargeback fee is counted on every case
          under every policy, because the fee page doesn&apos;t say it is waived on a win.{" "}
          {fightRow.keptUsd > exhibitRow.keptUsd
            ? `On money alone, always fighting keeps more than Exhibit on this set (${usd(fightRow.keptUsd)} against ${usd(exhibitRow.keptUsd)}): Exhibit refunded ${usd(exhibitRow.givenUpUsd)} per 100 it should have fought. `
            : "On money alone, always fighting keeps as much as Exhibit on this set. "}
          {strongRow && strongRow.keptUsd !== exhibitRow.keptUsd
            ? `The stronger rules keep ${usd(strongRow.keptUsd)} (${strongRow.netUsd < 0 ? `−${usd(-strongRow.netUsd)}` : usd(strongRow.netUsd)} after fees), against Exhibit's ${usd(exhibitRow.keptUsd)} (${usd(exhibitRow.netUsd)}). `
            : ""}
          What Exhibit does instead is file {fightRow.responses - exhibitRow.responses} fewer responses per 100, with{" "}
          {exhibitRow.fightsOnRefundCases === 0
            ? "none on a case the seller should refund"
            : `${exhibitRow.fightsOnRefundCases} per 100 on a case the seller should refund (the glaze-colour case with no warning, above)`}{" "}
          against {fightRow.fightsOnRefundCases} for always fighting, and {exhibitRow.completePct}% of the fights it files have every required item on
          file, against {fightRow.completePct}% for always fighting ({exhibitRow.noneMissingPct}% and {fightRow.noneMissingPct}% with none missing). We
          found no sourced figure for a seller&apos;s minutes per response, so time is counted in responses. Computed by <code>scripts/policies.ts</code>{" "}
          into <code>data/policies.json</code>.
        </p>
        <p className={styles.note}>
          The rows marked <em>assumed</em> under each table are not measured. &ldquo;Kept, at most&rdquo; counts every fight on a case labelled fight
          as won; those rows instead take {policies.sensitivity.winRates.map((w) => `${Math.round(w * 100)}%`).join(" and ")} of them as won, keep
          PayPal&apos;s fee on every case, and still win nothing on a fight the seller should have refunded, so they show how much of the upper figure is
          left and whether it covers the fees. The real win rate isn&apos;t in our data: the sandbox rules on what is filed, not as a card issuer would.
        </p>
      </section>

      <section className={styles.section} id="lane">
        <div className={styles.sectionHead}>
          <h2>The seller&apos;s lane, timed from its own records</h2>
          <p>
            The {lane.summary.cases} cases on the seller&apos;s lane, from PayPal&apos;s webhooks of {utcTime(lane.firstWebhook!)} to{" "}
            {utcTime(lane.lastWebhook!)}, read from each case&apos;s record: PayPal&apos;s CUSTOMER.DISPUTE.CREATED webhook, the autopilot&apos;s argued
            brief and its decision under the house rules, and every filing with who sent it. No outside sellers: these are the shop&apos;s own sandbox
            disputes.
          </p>
        </div>
        <dl className={`${styles.strip} ${styles.strip4}`}>
          <div>
            <dt>Webhook to argued brief</dt>
            <dd>{lane.summary.medianToArguedS} s</dd>
            <p>median, all {lane.summary.cases} cases</p>
          </div>
          <div>
            <dt>Webhook to decision under the house rules</dt>
            <dd>{minutes(lane.summary.medianToDecidedMin)}</dd>
            <p>
              median; {lane.summary.decided.file} to file, {lane.summary.decided.refund} to refund, {lane.summary.decided.left} left for the seller
            </p>
          </div>
          <div>
            <dt>Webhook to filed</dt>
            <dd>{minutes(lane.summary.medianToFiledMin)}</dd>
            <p>
              median of the {lane.summary.filed} fights filed: {lane.summary.filedByAutopilot} by the autopilot ({minutes(lane.summary.medianToFiledByAutopilotMin)}),{" "}
              {lane.summary.filedBySeller} by the seller ({minutes(lane.summary.medianToFiledBySellerMin)})
            </p>
          </div>
          <div>
            <dt>No human step</dt>
            <dd>
              {lane.summary.zeroHuman} of {lane.summary.cases}
            </dd>
            <p>
              {lane.summary.oneHuman} needed one (a filing or refund the seller sent){lane.summary.moreHuman ? `, ${lane.summary.moreHuman} more than one` : ""}
            </p>
          </div>
        </dl>
        <TableToggle what="the table">
          <div className={`sheet ${styles.compare}`}>
            <table>
              <thead>
                <tr>
                  <th scope="col">Case</th>
                  <th scope="col">Decided</th>
                  <th scope="col">Argued after</th>
                  <th scope="col">Decided after</th>
                  <th scope="col">Sent to PayPal after</th>
                  <th scope="col">Human steps</th>
                </tr>
              </thead>
              <tbody>
                {lane.rows.map((r) => (
                  <tr key={r.id}>
                    <th scope="row">
                      <Link href={`/case/${r.id}`}>{r.id}</Link>
                    </th>
                    <td>
                      {r.decided}
                      {r.rule ? ` (rule ${r.rule})` : ""}
                    </td>
                    <td>{r.toArguedS === null ? "n/a" : `${r.toArguedS} s`}</td>
                    <td>{r.toDecidedS === null ? "n/a" : minutes(r.toDecidedS / 60)}</td>
                    <td>{r.sent ? `${minutes(r.sent.afterS / 60)}, ${r.sent.what} by the ${r.sent.by}` : "not yet"}</td>
                    <td>{r.humanSteps.length ? r.humanSteps.join("; ") : "none"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TableToggle>
        <p className={styles.note}>
          House rule 4 holds every send for 10 minutes so anyone working the desk can stop it, so the autopilot&apos;s time to filed includes that window.
          The {lane.summary.oneHuman} cases with a human step are the ones the autopilot left for the seller (rule 3); their time to filed or refunded
          is how long the person working the desk took, not something the product sped up. Where a ruling followed, the autopilot asked for it under rule
          5, so it isn&apos;t counted as a human step. {lane.summary.cases} cases is a small base. Read by <code>scripts/lane.ts</code> from the
          desk&apos;s public API into <code>data/lane.json</code>.
        </p>
      </section>

      <section className={styles.section} id="alternatives">
        <div className={styles.sectionHead}>
          <h2>Why not the Resolution Center, or a chargeback service?</h2>
          <p>
            Sellers can answer a dispute themselves for free, or pay a service a share of every case it wins. Exhibit is for the seller in between: too
            small to give away a quarter of each win, too busy to write ten responses a month, and better off refunding the cases they would lose.
          </p>
        </div>
        <TableToggle what="the table">
        <div className={`sheet ${styles.compare}`}>
          <table>
            <thead>
              <tr>
                <th scope="col" />
                <th scope="col">What it costs</th>
                <th scope="col">Who writes the response</th>
                <th scope="col">When you&apos;d lose</th>
                <th scope="col">What you can check</th>
              </tr>
            </thead>
            <tbody>
              {OPTIONS.map((o) => (
                <tr key={o.name} data-us={o.name === "Exhibit"}>
                  <th scope="row">{o.name}</th>
                  <td>{o.cost}</td>
                  <td>{o.writes}</td>
                  <td>{o.refund}</td>
                  <td>{o.proof}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </TableToggle>
        <p className={styles.note}>
          Chargeback-service pricing from{" "}
          <a href={CHARGEFLOW_PRICING.href} target="_blank" rel="noreferrer">
            Chargeflow&apos;s pricing page
          </a>
          , checked {CHARGEFLOW_PRICING.checked}. Seller Protection and Chargeback Protection from PayPal&apos;s own pages, checked 29 Oct 2026:{" "}
          {PROTECTION_SOURCES.map((x, i) => (
            <span key={x.href}>
              {i > 0 ? ", " : ""}
              <a href={x.href} target="_blank" rel="noreferrer">
                {x.label}
              </a>
            </span>
          ))}
          . Exhibit&apos;s price is a plan, not a product: in this hackathon build everything is free and runs in the sandbox.
        </p>
      </section>

      <section className={styles.section} id="agent-stack">
        <div className={styles.sectionHead}>
          <h2>PayPal&apos;s agent stack, and the layer Exhibit adds</h2>
          <p>
            Exhibit runs PayPal&apos;s own Agent Toolkit (<code>@paypal/agent-toolkit</code> 1.11.0) for reads and two writes, and adds what the
            toolkit doesn&apos;t have: evidence, cross-examination and signed mandates. Its MCP server at <code>/api/mcp</code> carries both, so one MCP
            client gets PayPal&apos;s tools and Exhibit&apos;s in one session.
          </p>
        </div>
        <TableToggle what="the table">
        <div className={`sheet ${styles.compare}`}>
          <table>
            <thead>
              <tr>
                <th scope="col">PayPal Agent Toolkit tool</th>
                <th scope="col">Where Exhibit uses it</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">get_dispute, get_shipment_tracking, get_refund, get_order</th>
                <td>
                  Given to the GPT-5.6 drafter as functions on a live case, next to write_brief: it may read PayPal itself, at most {toolkitBrief.maxReads} reads in
                  one turn, before the brief is forced. Each read is listed under the brief on the case page. Measured once on {toolkitBrief.dispute} (
                  {day(toolkitBrief.at)}, read-only): it called {toolkitBrief.toolkit.map((t) => t.tool).join(", ")}, then wrote the brief;{" "}
                  {toolkitBrief.tokens ? `${toolkitBrief.tokens.input.toLocaleString("en-US")} tokens in and ${toolkitBrief.tokens.output.toLocaleString("en-US")} out` : ""}
                  {toolkitBrief.usd !== null ? `, $${toolkitBrief.usd.toFixed(4)}` : ""}, {(toolkitBrief.ms / 1000).toFixed(0)} s. The evals run without it, so they never
                  call PayPal.
                </td>
              </tr>
              <tr>
                <th scope="row">get_dispute, get_shipment_tracking</th>
                <td>The autopilot&apos;s read step on the seller&apos;s lane, before it decides under the house rules; written on the case as an audit line. Also on MCP as paypal_get_dispute and paypal_get_shipment_tracking.</td>
              </tr>
              <tr>
                <th scope="row">list_disputes, get_refund</th>
                <td>On MCP as paypal_list_disputes and paypal_get_refund, read-only.</td>
              </tr>
              <tr>
                <th scope="row">accept_dispute_claim</th>
                <td>
                  The autopilot&apos;s refunds on the seller&apos;s lane, and MCP&apos;s guarded paypal_accept_dispute_claim. Its note must match{" "}
                  <code>^[A-Za-z0-9_-]{"{1,255}"}$</code> (no spaces), so the note is a short hyphenated reason; Exhibit&apos;s own Disputes client is
                  the fallback, and the case says which one sent it. First live use: <a href="/case/PP-R-DNN-10195228">PP-R-DNN-10195228</a>, refunded
                  30 Oct 2026.
                </td>
              </tr>
              <tr>
                <th scope="row">create_shipment_tracking</th>
                <td>
                  The seller&apos;s lane puts its tracking up through it (PayPal&apos;s shipping trackers), and reads it back with get_shipment_tracking for
                  the tracking exhibit; Orders v2 <code>/track</code> is the fallback. First live use:{" "}
                  <a href="/case/PP-R-IPX-10195230">PP-R-IPX-10195230</a>, 30 Oct 2026.
                </td>
              </tr>
              <tr>
                <th scope="row">create_order</th>
                <td>Not used. It makes an order for a buyer to approve through a PayPal link, with no card payment source and no custom_id, so a buyer agent can&apos;t pay against the cart it signed. Exhibit&apos;s buyer agent pays through Orders v2 directly, with <code>ap2:</code> and the cart&apos;s SHA-256 in custom_id.</td>
              </tr>
            </tbody>
          </table>
        </div>
        </TableToggle>
        <p className={styles.note}>
          Exhibit&apos;s own MCP tools: list_cases, get_case, argue_case, file_response, cross_examine, open_case, preflight_cart and verify_mandate, plus the guarded paypal_accept_dispute_claim. A
          client config for both servers is in the README.
        </p>
      </section>

      <section className={`${styles.section} ${styles.final}`} id="run-it">
        <h2>Run it yourself</h2>
        <p>
          The variants are in <code>lib/eval/variants.ts</code> and <code>lib/eval/heldout.ts</code>, the stronger rules in <code>lib/eval/baseline.ts</code>
          , the runner in <code>scripts/eval.ts</code>, and every answer, sentence and strike from this run in <code>data/proof.json</code>. With your own
          model keys in <code>.env.local</code>, and its prices so the run stays under a spend cap:
        </p>
        <pre className={styles.cmd}>npx tsx --conditions=react-server scripts/eval.ts --price-in 1 --price-out 5 --max-usd 2.5</pre>
        <p className={styles.ctas}>
          <a className="btn btnQuiet" href="https://github.com/RohanGlitched/exhibit/blob/main/data/proof.json" target="_blank" rel="noreferrer">
            The raw results
          </a>
          <Link className="btn btnPrimary" href="/new">
            Open a sandbox case
          </Link>
        </p>
      </section>
    </main>
  );
}
