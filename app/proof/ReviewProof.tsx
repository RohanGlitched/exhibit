import { readFileSync } from "node:fs";
import path from "node:path";
import Pleading from "@/components/home/Pleading";
import Exchange from "@/components/case/Exchange";
import type { Hearing } from "@/lib/cases/hearing";
import { day } from "@/lib/format";
import styles from "./proof.module.css";
import css from "./review.module.css";

interface Summary {
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
  pressedByCard?: number;
  onCard?: number;
  fightsWithObjections?: number;
  fightsWithOverruled?: number;
  reviewerObjections?: number;
  fightsWithReviewerObjections?: number;
  overruledOnReviewer?: number;
  reasked?: number;
  stillUnruled?: number;
  verdictCaveats?: number;
}
interface Recheck {
  at?: string;
  carelessAnswers: number;
  carelessStruckAsPublished: number;
  carelessStruckNow: number;
  hearingAnswers: number;
  hearingAnswersChanged: number;
}
interface ReviewProofFile {
  at: string;
  instructions?: string;
  repairsAt?: string;
  summary: Summary;
  hearings: { key: string; label: string; brief: string; reviewerMatchesLabel: boolean; hearing: Hearing }[];
  /** The run this one replaced, with its saved answers re-read by the checker of the day. */
  previous?: { at: string; instructions?: string; summary: Summary; recheck: Recheck } | null;
  /** The versions before that, newest first. */
  earlier?: { at: string; instructions?: string; summary: Summary }[];
  carelessAt?: string;
  /** Today's checker over this run's saved answers; the figures above stay as measured. */
  recheck?: Recheck;
}

/** data/review-proof.json, written by scripts/eval-review.ts; the section is left out until a run exists. */
function load(): ReviewProofFile | null {
  try {
    return JSON.parse(readFileSync(path.join(process.cwd(), "data", "review-proof.json"), "utf8")) as ReviewProofFile;
  } catch {
    return null;
  }
}

/**
 * The hearing whose exchanges best show the machinery: an answer the reviewer overruled on an objection it raised
 * itself (not one the card added in code), else any overruled answer, else a struck answer, else a concession.
 */
function pickHearing(p: ReviewProofFile) {
  const fights = p.hearings.filter((h) => h.hearing.mode === "cross");
  return (
    fights.find((h) => h.hearing.exchanges.some((e) => e.ruling === "overruled" && !e.objection.pressed && e.objection.requirement)) ??
    fights.find((h) => h.hearing.exchanges.some((e) => e.ruling === "overruled" && !e.objection.pressed)) ??
    fights.find((h) => h.hearing.exchanges.some((e) => e.ruling === "overruled")) ??
    fights.find((h) => h.hearing.exchanges.some((e) => e.answer.stance === "answer" && !e.answer.kept)) ??
    fights.find((h) => h.hearing.exchanges.length > 0)
  );
}

function Transcript({ h, caption, only }: { h: ReviewProofFile["hearings"][number]; caption: string; only?: (e: Hearing["exchanges"][number]) => boolean }) {
  // The exchange the caption names first, then the next one.
  const first = only ? h.hearing.exchanges.findIndex(only) : 0;
  const shown = [...h.hearing.exchanges.slice(Math.max(0, first)), ...h.hearing.exchanges.slice(0, Math.max(0, first))].slice(0, 2);
  return (
    <Pleading lines={Math.max(10, shown.length * 7 + 2)}>
      <p className={css.caption}>
        {h.key.split("#")[0]} · {caption} · verdict for the {h.hearing.verdict.side}
      </p>
      {shown.map((e, i) => (
        <Exchange
          key={i}
          objection={e.objection}
          answer={e.answer}
          ruling={e.ruling}
          reason={e.reason}
          quote={e.objection.sentence !== null ? h.hearing.response[e.objection.sentence] : null}
          withdrawn={e.objection.sentence !== null && h.hearing.withdrawn.includes(e.objection.sentence) && e.ruling === "sustained"}
          flipped={e.answer.stance === "concede" && e.answer.effect === "refund"}
        />
      ))}
    </Pleading>
  );
}

/** The /proof section on cross-examination: the reviewer's objections, Exhibit's answers, the checker, the repair step. */
export default function ReviewProof() {
  const p = load();
  if (!p || !p.hearings.length) return null;
  const s = p.summary;
  const pick = pickHearing(p);
  // An objection the card added in code, where the reviewer left that item alone, to show beside the reviewer's own.
  const isPressed = (e: Hearing["exchanges"][number]) => !!e.objection.pressed;
  const pressed = p.hearings.find((h) => h !== pick && h.hearing.mode === "cross" && h.hearing.exchanges.some(isPressed));
  const lostFights = p.hearings.filter((h) => h.hearing.mode === "cross" && h.label === "fight" && h.hearing.verdict.side !== "seller").map((h) => h.key.split("#")[0]);
  const lostFraud = lostFights.filter((k) => k.startsWith("fraud-")).length;
  // The correction below is about the second version's published figure, so it shows only beside that version.
  const careless = /^second/.test(p.previous?.instructions ?? "") ? p.previous?.recheck : undefined;
  // Whose objections they are: the reviewer's own, or added in code from the card where it left an item alone.
  const all = p.hearings.flatMap((h) => h.hearing.exchanges);
  const own = s.reviewerObjections ?? all.filter((e) => !e.objection.pressed).length;
  const ownFights = s.fightsWithReviewerObjections ?? p.hearings.filter((h) => h.hearing.mode === "cross" && h.hearing.exchanges.some((e) => !e.objection.pressed)).length;
  const byCard = s.pressedByCard ?? all.filter((e) => e.objection.pressed).length;
  // Every version measured, oldest first, with a short name from its instructions.
  const versions = [
    ...[...(p.earlier ?? [])].reverse(),
    ...(p.previous ? [{ at: p.previous.at, instructions: p.previous.instructions, summary: p.previous.summary }] : []),
    { at: p.at, instructions: p.instructions, summary: s, current: true as const },
  ].map((v) => ({ ...v, name: (v.instructions ?? "").split(/[:(]/)[0].replace(/ version\s*$/, "").trim().replace(/^./, (c) => c.toUpperCase()) || "Earlier", what: (v.instructions ?? "").split(":")[1]?.trim() }));
  return (
    <section className={styles.section} id="cross-examination">
      <div className={styles.sectionHead}>
        <h2>Cross-examined by a second model</h2>
        <p>
          Every measured brief was rendered as the PDF Exhibit files with PayPal, read back to text ({s.pdfRoundTrip} of {s.pdfBriefs} came back sentence
          for sentence), and put before a second model playing PayPal&apos;s dispute reviewer, which saw nothing else but the requirements card for the
          case&apos;s reason code: what the card network asks for, each item marked on file, weak or missing by code. The card drives the objections: every
          weak or missing item the case needs is objected to, by the reviewer or, where it left one alone, from the card, and a fight with nothing weak is
          put to proof on the item it turns on. Since 30 Oct the card also reads whether the cardholder returned the item or tried to, and whether
          delivery came before the case opened. Exhibit answered from the exhibits or conceded, and the checker read every answer. Where Exhibit advised a
          refund, the reviewer ruled on the exhibit pages alone.
        </p>
      </div>
      <dl className={styles.strip}>
        <div>
          <dt>Objections raised</dt>
          <dd>{s.objections}</dd>
          <p>
            {own} by the reviewer itself, on {ownFights} of {s.fights} fights, plus {byCard} the requirements card adds in code
          </p>
        </div>
        <div>
          <dt>Overruled</dt>
          <dd>{s.overruled}</dd>
          <p>
            answers the checker kept and the reviewer accepted, on {s.fightsWithOverruled ?? "?"} fights; {s.sustained} sustained
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
          <dt>Reviewer agrees with the label</dt>
          <dd>
            {s.reviewerMatchesLabel}/{s.hearings}
          </dd>
          <p>
            {s.fightsUpheld} of {s.fights} fights upheld, {s.recordsConfirmed} of {s.records} refunds confirmed
          </p>
        </div>
        <div>
          <dt>Careless answers struck</dt>
          <dd>
            {s.carelessStruck}/{s.carelessAnswers}
          </dd>
          <p>from an answerer told never to concede{p.carelessAt ? `, measured ${day(p.carelessAt)}` : ""}</p>
        </div>
      </dl>

      {versions.length > 1 && (
        <div className={`sheet ${styles.compare} ${css.versions}`}>
          <table>
            <thead>
              <tr>
                <th scope="col">Hearing instructions</th>
                <th scope="col">Objections: reviewer&apos;s own + card&apos;s</th>
                <th scope="col">Fights the reviewer objected to</th>
                <th scope="col">Overruled</th>
                <th scope="col">Sustained</th>
                <th scope="col">Conceded</th>
                <th scope="col">Answers kept</th>
                <th scope="col">Reviewer matches the label</th>
              </tr>
            </thead>
            <tbody>
              {versions.map((v) => {
                const x = v.summary;
                const mine = x.reviewerObjections ?? x.objections - (x.pressedByCard ?? 0);
                return (
                  <tr key={v.at} data-us={"current" in v ? "true" : undefined}>
                    <th scope="row">
                      {v.name}, {day(v.at)}
                      {"current" in v && v.what ? <small className={styles.kindSource}>: {v.what}</small> : null}
                    </th>
                    <td>
                      {mine} + {x.pressedByCard ?? 0}
                    </td>
                    <td>
                      {x.fightsWithReviewerObjections ?? (x.objections ? 1 : 0)}/{x.fights}
                    </td>
                    <td>{x.overruled}</td>
                    <td>{x.sustained}</td>
                    <td>{x.conceded}</td>
                    <td>
                      {x.answersKept}/{x.answered}
                    </td>
                    <td>
                      {x.reviewerMatchesLabel}/{x.hearings}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className={`${styles.split} ${css.split}`}>
        <div>
          <h3 className={css.h3}>How a hearing is decided</h3>
          <ul className={css.rules}>
            <li>An answer counts only if the checker keeps it: every amount, date, time and id must be in the exhibits it cites. A struck answer is no answer, and the sentence it defended is withdrawn.</li>
            <li>A concession is always sustained. Exhibit says what follows: the sentence goes, or the call becomes a refund, and a conceded case is ruled for the buyer whatever the reviewer wrote.</li>
            <li>Only the reviewer can overrule, and only an answer that survived the checker.</li>
            <li>
              A kept answer the reviewer leaves unruled is put to it once more rather than held against the seller, and a verdict for the seller that rests on
              a point the hearing sustained is sent back once; if it still does, the verdict says so.
              {s.reasked === undefined
                ? ""
                : s.reasked === 0 && !s.stillUnruled && !s.verdictCaveats
                  ? " In this run the reviewer ruled on every kept answer that mattered and no verdict leaned on a sustained point, so no re-ask was needed."
                  : ` In this run ${s.reasked} hearing${s.reasked === 1 ? " was" : "s were"} asked again; ${s.stillUnruled ?? 0} answer${s.stillUnruled === 1 ? "" : "s"} stayed unruled and ${s.verdictCaveats ?? 0} verdict${s.verdictCaveats === 1 ? " is" : "s are"} flagged.`}
            </li>
            <li>
              On a live case the verdict is the outcome Exhibit asks the sandbox ruling for, and the case shows &ldquo;Ruled by the simulated reviewer&rdquo; with
              the reason.
            </li>
            <li>
              The repair step: before a brief is final, each sentence the checker struck goes back to the model once with the reason. The new sentence is used only
              if the checker keeps it, and the brief says &ldquo;Repaired: re-cited to Exhibit C&rdquo;. Of {s.plantedTried} sentences carrying a fact the seller
              planted, {s.plantedFixed} came back usable{s.plantedSurvived ? `, and ${s.plantedSurvived} still carried the planted fact` : ", none of them carrying the planted fact"}
              {p.repairsAt ? ` (measured ${day(p.repairsAt)}; the repair step didn't change, so it wasn't run again)` : ""}.
            </li>
          </ul>
          <p className={styles.note}>
            A harder reviewer agrees with the labels less: it ruled for the buyer on {lostFights.length} of the {s.fights} cases labelled fight (
            {lostFights.join(", ")}).{lostFraud ? ` ${lostFraud === 1 ? "One" : lostFraud === 2 ? "Two" : lostFraud} of those ${lostFraud === 1 ? "is a fraud case" : "are fraud cases"} with no 3-D Secure result and no device or IP match on file, where Exhibit itself conceded that the compelling evidence the networks ask for isn't complete; the labels were set before the card existed.` : ""}
            {p.recheck?.hearingAnswersChanged
              ? ` ${p.recheck.hearingAnswersChanged} of the ${p.recheck.hearingAnswers} answers were struck by a checker misread, "3-D Secure" read as the count 3 and "sentence 2" as a figure; it is fixed since, and today's checker keeps both. The figures above are as measured.`
              : ""}
          </p>
          {careless && (
            <p className={styles.note}>
              Correction: the second version published &ldquo;Invented answers struck {careless.carelessStruckAsPublished}/{careless.carelessAnswers}&rdquo;. One of
              those strikes was the checker misreading a true answer&apos;s signer as &ldquo;D BROOKS. The&rdquo;. Re-checked with today&apos;s checker, no model
              calls: {careless.carelessStruckNow}/{careless.carelessAnswers}, and the one still struck joins true figures from two records rather than inventing
              any, so &ldquo;careless&rdquo;, not &ldquo;invented&rdquo;, is the right word.
            </p>
          )}
          <p className={styles.note}>
            Measured {day(p.at)} on the briefs from the run above ({s.briefsFrom}). Reviewer and answerer: {s.reviewer}. {s.calls} model calls,{" "}
            {(s.inputTokens + s.outputTokens).toLocaleString("en-US")} tokens
            {s.priceIn !== null ? `, about $${s.spendUsd.toFixed(2)} at $${s.priceIn} and $${s.priceOut} per million tokens in and out` : ""}. The reviewer is
            the same family of model as the drafter and was written by the same people, so agreement measures consistency, not a bank&apos;s judgement. All{" "}
            {versions.length} versions ran on the same cases, so treat the gains as tuned, not held out. The first version, before 25 Oct and not kept as a data file, conceded 18 of 19 objections and matched the label in 20 of 28.
          </p>
        </div>
        <div className={css.transcripts}>
          {pick && <Transcript h={pick} caption="the reviewer's own objection, overruled" only={(e) => e.ruling === "overruled" && !e.objection.pressed} />}
          {pressed && <Transcript h={pressed} caption="an objection the card added in code" only={isPressed} />}
        </div>
      </div>
      <pre className={styles.cmd}>npx tsx --conditions=react-server scripts/eval-review.ts --provider azure --price-in 1.25 --price-out 10 --cap 0.235 --steps hearings</pre>
    </section>
  );
}
