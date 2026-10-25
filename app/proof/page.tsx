import type { Metadata } from "next";
import Link from "next/link";
import Pleading from "@/components/home/Pleading";
import { FIGURES, OPTIONS, CHARGEFLOW_PRICING } from "@/lib/impact";
import { day } from "@/lib/format";
import proof from "@/data/proof.json";
import styles from "./proof.module.css";
import ReviewProof from "./ReviewProof";

export const metadata: Metadata = {
  title: "Proof",
  description: "Exhibit measured: the right call on labelled dispute variants, the checker against invented figures, latency and tokens, and the sourced cost of a dispute.",
};

type Run = (typeof proof.runs)[number];

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
const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : "n/a");

function Call({ run, side }: { run: Run; side: "rules" | "model" }) {
  const r = side === "model" ? run.model : run.rules;
  if (!r) return <span className={styles.na}>no answer</span>;
  return (
    <span className={styles.call} data-ok={r.correct} data-call={r.call}>
      {CALL[r.call]}
      {side === "model" && "odds" in r ? <small> {r.call === "accept" ? Math.min(50, r.odds) : r.odds}%</small> : null}
    </span>
  );
}

export default function Proof() {
  const s = proof.summary;
  const byVariant = proof.variants.map((v) => ({ ...v, runs: proof.runs.filter((r) => r.variant === v.id) }));
  const careless = proof.pressure.filter((p) => p.mode === "Careless drafter");
  const careful = proof.pressure.filter((p) => p.mode !== "Careless drafter");
  const mutationKinds = Object.entries(proof.mutations) as [string, { n: number; struck: number; examples: { from: string; to: string; why: string | null }[] }][];
  const stories = [...new Set(proof.variants.map((v) => v.story))];
  return (
    <main className={`shell ${styles.page}`}>
      <header className={styles.head}>
        <p className={styles.docketLine}>
          <span className="bates">Proof</span>
          <span>Measured {day(proof.at)}</span>
          <span>{s.model}, reasoning {proof.reasoning}</span>
        </p>
        <h1>Measured, not promised</h1>
        <p className={styles.lede}>
          Five sample stories prove nothing on their own. So we wrote {s.variants} variants of the seven stories, each changing one or two facts so the
          right call flips or holds, labelled each with what a careful seller should do before running anything, and ran every one with two different
          customers through the model and through the rules engine. Then we tried to make the model state things no record holds, and changed one
          figure in every sentence it wrote to see whether the checker notices.
        </p>
      </header>

      <dl className={styles.strip}>
        <div>
          <dt>Right call, model</dt>
          <dd>
            {s.modelCorrect}/{s.modelRuns}
          </dd>
          <p>{pct(s.modelCorrect, s.modelRuns)} of labelled runs</p>
        </div>
        <div>
          <dt>Right call, rules engine</dt>
          <dd>
            {s.rulesCorrect}/{s.runs}
          </dd>
          <p>the fallback, on the same exhibits</p>
        </div>
        <div>
          <dt>Changed facts, model vs rules</dt>
          <dd>
            {s.modelCorrectOnChanged} vs {s.rulesCorrectOnChanged}
          </dd>
          <p>of {s.changedRuns} runs where a fact moved</p>
        </div>
        <div>
          <dt>False figures struck</dt>
          <dd>
            {s.mutationsStruck}/{s.mutations}
          </dd>
          <p>one figure changed in a true sentence</p>
        </div>
        <div>
          <dt>Invented facts struck</dt>
          <dd>
            {s.carelessPlantedStruck}/{s.carelessPlantedSentences}
          </dd>
          <p>written by a drafter told to use them</p>
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
            call; red is a miss. The model&apos;s number is the seller&apos;s chance from its own tally. The rules engine is what argues when the model is
            out; it handles the patterns it was written for and misses the rest, which is the point of having a model.
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
                <col />
              </colgroup>
              <thead>
                <tr>
                  <th scope="col">What changed</th>
                  <th scope="col">Label</th>
                  <th scope="col">Rules engine</th>
                  <th scope="col">Model</th>
                </tr>
              </thead>
              <tbody>
                {byVariant
                  .filter((v) => v.story === story)
                  .map((v) => (
                    <tr key={v.id}>
                      <td>{v.change}</td>
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
                      <td>
                        <span className={styles.pair}>
                          {v.runs.map((r) => (
                            <Call key={r.key} run={r} side="model" />
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

      <section className={`${styles.section} ${styles.split}`}>
        <div>
          <h2>The checker against false figures</h2>
          <p>
            We took every sentence the model wrote that survived the checker ({s.keptSentences}) and changed one figure in it: a date moved three days,
            an amount raised by $10, a time moved an hour, the last digit of an id or tracking number changed. Then we ran the same checker the filing
            uses.
          </p>
          <ul className={styles.kinds}>
            {mutationKinds.map(([kind, k]) => (
              <li key={kind}>
                <strong>
                  {k.struck}/{k.n}
                </strong>{" "}
                {kind}
              </li>
            ))}
          </ul>
          <p className={styles.note}>
            {s.figurelessSentences} of the {s.keptSentences} sentences carry no figure at all (&ldquo;The parcel was signed for at the front
            desk&rdquo;). The checker can only hold those to their citations; it reads figures, not meaning.
          </p>
        </div>
        <Pleading lines={12}>
          {mutationKinds.slice(0, 3).map(([kind, k]) =>
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

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2>Asked to state what no record says</h2>
          <p>
            Six seller&apos;s notes, each asking for a date, an amount, a time or a reference number that appears in no exhibit. With Exhibit&apos;s own
            prompt the model wrote none of them ({s.pressureWrote} of {s.pressureRuns}). So we swapped in a careless drafter told to use every fact the
            seller gives: it wrote all {s.carelessWrote}, and the checker struck {s.carelessPlantedStruck} of {s.carelessPlantedSentences} before anything
            could be filed.
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

      <ReviewProof />

      <section className={`${styles.section} ${styles.split}`}>
        <div>
          <h2>What this doesn&apos;t show</h2>
          <p>Read the numbers with these in mind.</p>
        </div>
        <ul className={`sheet ${styles.limits}`}>
          <li>The stories and the variants were written by the people who wrote the prompt. This measures consistency on known patterns, not accuracy on real sellers&apos; cases.</li>
          <li>
            The PayPal records in the eval are built offline in the exact shapes the sandbox returns; nothing was filed. The live desk&apos;s cases are real
            sandbox disputes.
          </li>
          <li>
            Won and lost on the desk are sandbox rulings Exhibit asks for after filing, and the simulator rules the way the filing points. They show the
            whole lifecycle works through PayPal&apos;s API, not that a bank was persuaded.
          </li>
          <li>The checker proves a figure appears in the record a sentence cites. A real date moved onto another real date in the same record would pass.</li>
          <li>One run per variant and customer. The model&apos;s odds come from its own tally of weighted points; they aren&apos;t calibrated probabilities.</li>
          <li>On agent-placed orders the decision is the mandate check, which is code; the model writes the response around it.</li>
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
          , checked {CHARGEFLOW_PRICING.checked}. Exhibit&apos;s price is a plan, not a product: in this hackathon build everything is free and runs in the
          sandbox.
        </p>
      </section>

      <section className={`${styles.section} ${styles.final}`}>
        <h2>Run it yourself</h2>
        <p>
          The variants are in <code>lib/eval/variants.ts</code>, the runner in <code>scripts/eval.ts</code>, and every answer, sentence and strike from
          this run in <code>data/proof.json</code>. With your own Azure OpenAI key in <code>.env.local</code>:
        </p>
        <pre className={styles.cmd}>npx tsx --conditions=react-server scripts/eval.ts</pre>
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
