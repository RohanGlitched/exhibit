import { readFileSync } from "node:fs";
import path from "node:path";
import Pleading from "@/components/home/Pleading";
import Exchange from "@/components/case/Exchange";
import type { Hearing } from "@/lib/cases/hearing";
import { day } from "@/lib/format";
import styles from "./proof.module.css";
import own from "./review.module.css";

interface ReviewProofFile {
  at: string;
  summary: {
    briefsFrom: string | null;
    reviewer: string | null;
    pdfRoundTrip: number;
    pdfBriefs: number;
    hearings: number;
    cross: number;
    objections: number;
    answered: number;
    answersKept: number;
    answersStruck: number;
    conceded: number;
    overruled: number;
    sustained: number;
    withdrawn: number;
    flipped: number;
    agree: number;
    fights: number;
    fightsUpheld: number;
    records: number;
    recordsConfirmed: number;
    reviewerMatchesLabel: number;
    repairTried: number;
    repairFixed: number;
    plantedTried: number;
    plantedFixed: number;
    plantedSurvived: number;
    misciteTried: number;
    misciteFixed: number;
    misciteRightExhibit: number;
    carelessAnswers: number;
    carelessStruck: number;
    medianHearingMs: number | null;
    calls: number;
    inputTokens: number;
    outputTokens: number;
    spendUsd: number;
    priceIn: number | null;
    priceOut: number | null;
  };
  hearings: { key: string; label: string; brief: string; reviewerMatchesLabel: boolean; hearing: Hearing }[];
}

/** data/review-proof.json, written by scripts/eval-review.ts; the section is left out until a run exists. */
function load(): ReviewProofFile | null {
  try {
    return JSON.parse(readFileSync(path.join(process.cwd(), "data", "review-proof.json"), "utf8")) as ReviewProofFile;
  } catch {
    return null;
  }
}

/** The /proof section on cross-examination: the reviewer's objections, Exhibit's answers, the checker, the repair step. */
export default function ReviewProof() {
  const p = load();
  if (!p || !p.hearings.length) return null;
  const s = p.summary;
  // Show the exchange that best shows the machinery: a struck answer, else a concession, else any objection.
  const pick =
    p.hearings.find((h) => h.hearing.exchanges.some((e) => e.answer.stance === "answer" && !e.answer.kept)) ??
    p.hearings.find((h) => h.hearing.exchanges.some((e) => e.answer.stance === "concede")) ??
    p.hearings.find((h) => h.hearing.exchanges.length > 0);
  const shown = pick ? pick.hearing.exchanges.slice(0, 2) : [];
  return (
    <section className={styles.section} id="cross-examination">
      <div className={styles.sectionHead}>
        <h2>Cross-examined by a second model</h2>
        <p>
          Every measured brief was rendered as the PDF Exhibit files with PayPal, read back to text ({s.pdfRoundTrip} of {s.pdfBriefs} came back sentence
          for sentence), and put before a second model playing PayPal&apos;s dispute reviewer, which saw nothing else. It raised up to four objections to
          each fight; Exhibit answered from the exhibits or conceded, and the checker read every answer. Where Exhibit advised a refund, the reviewer ruled
          on the exhibit pages alone.
        </p>
      </div>
      <dl className={styles.strip}>
        <div>
          <dt>Objections raised</dt>
          <dd>{s.objections}</dd>
          <p>
            on {s.fights} fights; {s.overruled} overruled, {s.sustained} sustained
          </p>
        </div>
        <div>
          <dt>Answered and kept by the checker</dt>
          <dd>
            {s.answersKept}/{s.answered}
          </dd>
          <p>{s.answersStruck} answers struck before they counted</p>
        </div>
        <div>
          <dt>Conceded on the record</dt>
          <dd>{s.conceded}</dd>
          <p>
            {s.withdrawn} sentence{s.withdrawn === 1 ? "" : "s"} withdrawn, {s.flipped} call{s.flipped === 1 ? "" : "s"} changed to refund
          </p>
        </div>
        <div>
          <dt>Reviewer agrees with Exhibit</dt>
          <dd>
            {s.agree}/{s.hearings}
          </dd>
          <p>
            {s.fightsUpheld} of {s.fights} fights upheld, {s.recordsConfirmed} of {s.records} refunds confirmed
          </p>
        </div>
        <div>
          <dt>Repaired by one re-cite</dt>
          <dd>
            {s.repairFixed}/{s.repairTried}
          </dd>
          <p>
            {s.misciteRightExhibit} of {s.misciteTried} wrong citations moved to the right exhibit
          </p>
        </div>
        <div>
          <dt>Invented answers struck</dt>
          <dd>
            {s.carelessStruck}/{s.carelessAnswers}
          </dd>
          <p>from an answerer told never to concede</p>
        </div>
      </dl>

      <div className={`${styles.split} ${own.split}`}>
        <div>
          <h3 className={own.h3}>How a hearing is decided</h3>
          <ul className={own.rules}>
            <li>An answer counts only if the checker keeps it: every amount, date, time and id must be in the exhibits it cites. A struck answer is no answer, and the sentence it defended is withdrawn.</li>
            <li>A concession is always sustained. Exhibit says what follows: the sentence goes, or the call becomes a refund, and a conceded case is ruled for the buyer whatever the reviewer wrote.</li>
            <li>Only the reviewer can overrule, and only an answer that survived the checker.</li>
            <li>
              On a live case the verdict is the outcome Exhibit asks the sandbox ruling for, and the case shows &ldquo;Ruled by the simulated reviewer&rdquo; with
              the reason.
            </li>
            <li>
              The repair step: before a brief is final, each sentence the checker struck goes back to the model once with the reason. The new sentence is used only
              if the checker keeps it, and the brief says &ldquo;Repaired: re-cited to Exhibit C&rdquo;. Of {s.plantedTried} sentences carrying a fact the seller
              planted, {s.plantedFixed} came back usable{s.plantedSurvived ? `, and ${s.plantedSurvived} still carried the planted fact` : ", none of them carrying the planted fact"}.
            </li>
          </ul>
          <p className={styles.note}>
            Measured {day(p.at)} on the briefs from the run above ({s.briefsFrom}). Reviewer and answerer: {s.reviewer}. {s.calls} model calls,{" "}
            {(s.inputTokens + s.outputTokens).toLocaleString("en-US")} tokens
            {s.priceIn !== null ? `, about $${s.spendUsd.toFixed(2)} at $${s.priceIn} and $${s.priceOut} per million tokens in and out` : ""}. The reviewer is
            the same family of model as the drafter and was written by the same people, so agreement measures consistency, not a bank&apos;s judgement.
          </p>
        </div>
        {pick && (
          <Pleading lines={Math.max(10, shown.length * 9 + 2)}>
            <p className={own.caption}>
              {pick.key.split("#")[0]} · hearing transcript · verdict for the {pick.hearing.verdict.side}
            </p>
            {shown.map((e, i) => (
              <Exchange
                key={i}
                objection={e.objection}
                answer={e.answer}
                ruling={e.ruling}
                reason={e.reason}
                quote={e.objection.sentence !== null ? pick.hearing.response[e.objection.sentence] : null}
                withdrawn={e.objection.sentence !== null && pick.hearing.withdrawn.includes(e.objection.sentence) && e.ruling === "sustained"}
                flipped={e.answer.stance === "concede" && e.answer.effect === "refund"}
              />
            ))}
          </Pleading>
        )}
      </div>
      <pre className={styles.cmd}>npx tsx --conditions=react-server scripts/eval-review.ts --price-in 1 --price-out 5</pre>
    </section>
  );
}
