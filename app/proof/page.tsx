import type { Metadata } from "next";
import Link from "next/link";
import Pleading from "@/components/home/Pleading";
import { FIGURES, OPTIONS, CHARGEFLOW_PRICING, PROTECTION_SOURCES } from "@/lib/impact";
import policies from "@/data/policies.json";
import { day, usd } from "@/lib/format";
import proof from "@/data/proof.json";
import styles from "./proof.module.css";
import ReviewProof from "./ReviewProof";

export const metadata: Metadata = {
  title: "Proof",
  description:
    "Exhibit measured: the right call on labelled dispute variants against a rules baseline that reads every record, a held-out set, prompt injection, the checker against ten kinds of false statement, latency and tokens, and the sourced cost of a dispute.",
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
      summary: { runs: number; correct: number; textRuns: number; textCorrect: number; seedRuns?: SeedRun[] };
      runs: { key: string; variant: string; label: string; model: Answer | null }[];
    } | null;
  };
  injection?: { variants: { id: string; change: string; label: string; attack: string }[]; runs: (Row & { wrotePlanted: boolean; keptPlanted: number })[] };
  repeats?: { main: { key: string; seed: number; call: string | null; correct: boolean | null }[]; heldout: { key: string; seed: number; call: string | null; correct: boolean | null }[]; injection: { key: string; seed: number; call: string | null; correct: boolean | null }[] };
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

/** Why a held-out variant moved in the 29 Oct re-run, as read from its answers. */
const WHY_MOVED: Record<string, string> = {
  "heldout-agent-mandate-revoked":
    "A code check now reads the cardholder's words in the agent's log; “Hold off for now” before checkout makes the order the agent platform's, and the mandate check says so.",
  "heldout-agent-overreach-approved": "The same check reads “Go ahead at $104” as written approval of the overage, so the cart is the cardholder's.",
  "heldout-duplicate-two-orders":
    "Lost: the requirements card read “no second transaction on file” because the second order was only in the store's notes and history. The card reads those since this run; not re-measured.",
  "heldout-fraud-descriptor":
    "Lost on one of two runs: the brief refunded because the card marked the compelling evidence missing, though the cardholder's email admits the order. The card lists a written admission since this run; not re-measured.",
};
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
  const notRun = [
    !held && "the held-out set",
    !inj && "prompt injection in the buyer's email",
    !ablation && "the rubric ablation",
    seeds < 2 && "repeat runs",
  ].filter(Boolean) as string[];

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
              </p>
            </div>
            <div>
              <dt>Deciding fact in the records</dt>
              <dd>
                {s.modelCorrectOnRecord} vs {s.strongCorrectOnRecord}
              </dd>
              <p>of {s.recordRuns} runs; a rule reading the records does as well here</p>
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
          <p>{seeds > 1 ? `across ${seeds} runs of every case, lowest to highest` : "of labelled runs, one run each"}</p>
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
          <p>no figure or name in them to check; marked, not counted as checked</p>
        </div>
        <div>
          <dt>Time and tokens per brief</dt>
          <dd>{((s.medianMs ?? 0) / 1000).toFixed(1)} s</dd>
          <p>
            median; {s.medianInputTokens?.toLocaleString("en-US")} in, {s.medianOutputTokens?.toLocaleString("en-US")} out
          </p>
        </div>
      </dl>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2>Every variant, both customers</h2>
          <p>
            Each row is one variant, run with two of the story&apos;s customers (different names, addresses and order numbers). Green is the labelled
            call; red is a miss. The fallback rules engine is what argues when the model is out. The stronger rules compare the delivery ZIP with the
            ship-to ZIP, look for a refund record, read the issuer&apos;s address and security-code checks, compare billing with shipping, count earlier
            orders and read the mandate check; they never read an email or a listing. The model&apos;s number is the seller&apos;s chance from its own
            tally.
            {seeds > 1 ? ` Small marks after the model's call are its ${seeds - 1} repeat runs.` : ""}
          </p>
        </div>
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
      </section>

      {hasStrong && (
        <section className={`${styles.section} ${styles.split}`}>
          <div>
            <h2>Where the model earns its place</h2>
            <p>
              On {s.recordRuns} of the {s.modelRuns || s.runs} runs the model answered, the deciding fact is in a structured record, and a rule that reads the records gets{" "}
              {s.strongCorrectOnRecord} of them right; the model gets {s.modelCorrectOnRecord}. The difference is on the {textRuns} runs where it sits only
              in free text, such as a buyer&apos;s email saying the vase arrived or a listing that does or doesn&apos;t warn about the glaze: the model{" "}
              {s.modelCorrectOnText}, the stronger rules {s.strongCorrectOnText}, the fallback {s.rulesCorrectOnText}. That free-text margin is the number to
              read, and {textRuns} runs is a small base.
            </p>
            {ablation && (
              <p>
                The prompt carries a short rubric, &ldquo;How cases are usually decided&rdquo;, that mirrors how the labels were set. With it taken out, the
                model got {s.ablationCorrect} of {s.ablationRuns} right, and {s.ablationCorrectOnText} of {s.ablationTextRuns} free-text runs (with it:{" "}
                {s.modelCorrect} of {s.modelRuns}, and {s.modelCorrectOnText} of {textRuns}).
              </p>
            )}
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
            {ablation && (
              <li>
                Model without the rubric: <strong>{s.ablationCorrect}/{s.ablationRuns}</strong>
              </li>
            )}
          </ul>
        </section>
      )}

      {held && (
        <section className={styles.section}>
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
                Re-run {day(held.at)}, once, on today&apos;s prompt: {held.prompt}. Before, on the main run&apos;s prompt ({day(held.previous.at)},{" "}
                {held.previous.summary.seedRuns?.length ?? 1} runs): {held.previous.summary.correct} of {held.previous.summary.runs}, and{" "}
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
                The same set was used to find the agent-lane miss, so treat that gain as tuned, not held out. The stronger rules are the frozen baseline
                and don&apos;t read the agent&apos;s log; the fallback rules follow the consent check, so they gain the agent cases too. This run cost $
                {held.spend?.usd.toFixed(2)} for {held.spend?.calls} calls.
              </p>
            )}
          </div>
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
        </section>
      )}

      <section className={`${styles.section} ${styles.split}`}>
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
        <section className={styles.section}>
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

      <section className={styles.section}>
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
        <section className={styles.section}>
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

      <section className={`${styles.section} ${styles.split}`}>
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
            Exhibit&apos;s request or closed the case by itself.
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
          {P.recheckedAt && (
            <li>
              The model&apos;s answers are from the run on {day(P.at)}; the checker, the stronger rules and the mutations were re-run over those saved
              answers on {day(P.recheckedAt)} with no new model calls. Variants added since that run show &ldquo;not run&rdquo;.
            </li>
          )}
          {notRun.length > 0 && <li>Not measured in this run: {notRun.join(", ")}.</li>}
        </ul>
      </section>

      <section className={styles.section}>
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
            The {policies.from.runs} labelled runs of the main set above, scaled to 100, each at its own disputed amount (
            {usd(policies.disputedUsdPer100)} per 100 in all, {usd(policies.winnableUsdPer100)} of it on cases labelled fight). Exhibit is the
            model&apos;s first run on {day(policies.from.measured)}.
          </p>
        </div>
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className={styles.note}>
          How it is counted: a case labelled fight that is fought counts as kept and one that is refunded as given up; a case labelled refund ends with
          the money back with the buyer whichever way it goes, so fighting it only costs a response. Real responses win less often than their label, so
          &ldquo;kept&rdquo; is the most each policy could keep. PayPal&apos;s {usd(policies.feePerCase)} card chargeback fee is counted on every case
          under every policy, because the fee page doesn&apos;t say it is waived on a win. On money alone, always fighting keeps as much as Exhibit on
          this set; the difference is the {policies.table.find((t) => t.id === "fight")!.responses - policies.table.find((t) => t.id === "exhibit")!.responses}{" "}
          responses per 100 nobody has to write and the {policies.table.find((t) => t.id === "fight")!.fightsOnRefundCases} fights on cases the seller
          should refund. We found no sourced figure for a seller&apos;s minutes per response, so time is counted in responses. Computed by{" "}
          <code>scripts/policies.ts</code> into <code>data/policies.json</code>.
        </p>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2>Why not the Resolution Center, or a chargeback service?</h2>
          <p>
            Sellers can answer a dispute themselves for free, or pay a service a share of every case it wins. Exhibit is for the seller in between: too
            small to give away a quarter of each win, too busy to write ten responses a month, and better off refunding the cases they would lose.
          </p>
        </div>
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

      <section className={`${styles.section} ${styles.final}`}>
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
