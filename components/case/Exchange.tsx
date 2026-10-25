import { GROUND_LABEL, type Answer, type Objection, type RulingWord } from "@/lib/cases/hearing";
import { figures } from "@/lib/cases/verify";
import styles from "./hearing.module.css";

/**
 * One exchange of the hearing, as a transcript: the OBJECTION stamp and what it is to, Q. the reviewer's
 * question, A. Exhibit's answer with its exhibit marks (struck through when the checker strikes it), what the
 * checker found, and the SUSTAINED or OVERRULED stamp with the reason.
 */
export default function Exchange({
  objection,
  answer,
  ruling,
  reason,
  quote,
  withdrawn,
  flipped,
  index = 0,
  who = "Reviewer",
}: {
  objection: Objection;
  answer: Answer;
  ruling: RulingWord;
  reason: string;
  quote?: { text: string; cites: string[] } | null;
  withdrawn?: boolean;
  flipped?: boolean;
  index?: number;
  who?: string;
}) {
  const f = figures(answer.text);
  const hasFigures = f.money.length + f.dates.length + f.times.length + f.ids.length > 0;
  const target = objection.sentence === null ? "to the response as a whole" : `to sentence ${objection.sentence + 1}`;
  return (
    <div className={styles.exchange} style={{ "--i": index } as React.CSSProperties}>
      <p className={styles.objLine}>
        <span className={styles.chip}>OBJECTION</span>
        <span className={styles.target}>
          {who === "You" ? "Yours" : `No. ${objection.n}`}, {target}
          {who === "You" ? "" : `: ${GROUND_LABEL[objection.ground]}`}
          {objection.pages.length ? ` (${objection.pages.join(", ")})` : ""}
        </span>
      </p>
      {quote && (
        <p className={`serif ${styles.quoted}`} data-withdrawn={withdrawn ? "true" : "false"}>
          &ldquo;{quote.text}&rdquo;
          {quote.cites.map((c) => (
            <span key={c} className={styles.mark}>
              {c}
            </span>
          ))}
        </p>
      )}
      <p className={`serif ${styles.qa}`}>
        <b>Q.</b>
        <span>{objection.text}</span>
      </p>
      <p className={`serif ${styles.qa}`} data-struck={answer.stance === "answer" && !answer.kept ? "true" : "false"}>
        <b>A.</b>
        <span className={answer.stance === "concede" ? styles.concede : ""}>
          {answer.stance === "concede" ? `(Exhibit concedes) ${answer.text}` : answer.text}
          {answer.stance === "answer" &&
            answer.cites.map((c) => (
              <span key={c} className={styles.mark}>
                {c}
              </span>
            ))}
        </span>
      </p>
      {answer.stance === "answer" && (
        <p className={styles.checker} data-kept={answer.kept ? "true" : "false"}>
          {answer.kept
            ? hasFigures
              ? `Checked: every figure in the answer is in Exhibit ${answer.cites.join(", ")}.`
              : `Checked: cites Exhibit ${answer.cites.join(", ")}; the answer has no figures to match.`
            : `Struck by the checker: ${answer.why}`}
        </p>
      )}
      <p className={styles.rulingLine}>
        <span className={styles.chip} data-word={ruling}>
          {ruling.toUpperCase()}
        </span>
        <span>{reason.replace(/\.$/, "")}.</span>
        {/* A concession's reason already says what it did; a struck answer's withdrawal needs saying. */}
        {withdrawn && answer.stance === "answer" && <span className={styles.effect}>Sentence {(objection.sentence ?? 0) + 1} withdrawn.</span>}
        {flipped && answer.stance === "answer" && <span className={styles.effect}>Exhibit changes its call to refund.</span>}
      </p>
    </div>
  );
}
