"use client";

import { useEffect, useState } from "react";
import Pleading from "@/components/home/Pleading";
import Stamp from "@/components/Stamp";
import type { Hearing as HearingRecord } from "@/lib/cases/hearing";
import type { Brief } from "@/lib/cases/types";
import type { CaseView } from "@/lib/cases/view";
import { dayTime } from "@/lib/format";
import Exchange from "./Exchange";
import ReviewerChair from "./ReviewerChair";
import styles from "./hearing.module.css";

/**
 * Cross-examination on the case page. A second model plays PayPal's reviewer: it reads only the PDF (the copy
 * PayPal holds once the response is filed), objects sentence by sentence, and rules. Exhibit answers from the
 * exhibits; the checker strikes answers it can't back. The verdict is the outcome a sandbox ruling request asks
 * for. Mounted under the brief; the visitor's own objections go in the reviewer's chair beside it.
 */
export default function Hearing({ view, onBrief }: { view: CaseView; onBrief?: (b: Brief) => void }) {
  const [hearing, setHearing] = useState<HearingRecord | null>(view.hearing);
  const [fresh, setFresh] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A ruling request can hold a new hearing on the server; take it when the page refreshes.
  useEffect(() => {
    if (view.hearing && view.hearing.at !== hearing?.at && (!hearing || view.hearing.at > hearing.at)) setHearing(view.hearing);
  }, [view.hearing, hearing]);

  const accepted = view.filings.some((f) => f.action === "accept");
  const filed = view.filings.some((f) => f.action === "evidence");
  const ruled = view.filings.some((f) => f.action === "ruling");
  if (!view.brief || accepted) return null;

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/cases/${view.id}/review`, { method: "POST" });
      const j = (await r.json().catch(() => ({}))) as { hearing?: HearingRecord; brief?: Brief | null; error?: string };
      if (!r.ok || !j.hearing) throw new Error(j.error ?? "The reviewer didn't sit. Try again in a minute.");
      setHearing(j.hearing);
      setFresh(true);
      if (j.brief && j.hearing.source === "draft") onBrief?.(j.brief);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const stale = hearing && filed && hearing.source === "draft";
  // A hearing held after PayPal had already decided the case played no part in the outcome.
  const afterRuling = Boolean(hearing && view.ruledAt && view.status === "RESOLVED" && hearing.at > view.ruledAt);
  const response = hearing && !stale ? hearing.response : view.brief.sentences.filter((s) => s.kept).map((s) => ({ text: s.text, cites: s.cites }));
  const advisedRefund = !filed && view.brief.recommendation !== "fight";
  const lines = hearing ? Math.max(8, hearing.exchanges.length * 7 + 3) : 6;

  return (
    <section className={styles.hearing} aria-label="Cross-examination">
      <header className={styles.head}>
        <p className={styles.kicker}>
          <span className="bates">Cross-examination</span>
          {hearing && <span>Heard {dayTime(hearing.at)}</span>}
          {hearing && <span>{hearing.source === "paypal" ? "On the PDF PayPal holds" : "On the PDF Exhibit would file"}</span>}
        </p>
        <h2>{advisedRefund ? "A second opinion from the reviewer" : "Before PayPal's reviewer"}</h2>
        <p>
          {advisedRefund
            ? "Exhibit advised refunding, so there is no response to object to. A second model, playing PayPal's dispute reviewer, reads the exhibit pages alone and says how it would rule if the seller fought."
            : "A second model plays PayPal's dispute reviewer. It reads only the PDF, the response and the Bates-stamped exhibits, and objects sentence by sentence. Exhibit answers each objection from the exhibits or concedes; the same checker strikes any answer it can't back. When you ask the sandbox to rule, Exhibit asks for the reviewer's verdict, not its own."}
        </p>
        <div className={styles.call}>
          {!hearing || stale ? (
            <button className="btn btnPrimary" onClick={run} disabled={busy}>
              {busy ? "The reviewer is reading…" : advisedRefund ? "Ask the reviewer" : filed ? "Cross-examine the filed PDF" : "Call the reviewer"}
            </button>
          ) : (
            !ruled && (
              <button className={styles.again} onClick={run} disabled={busy}>
                {busy ? "The reviewer is reading…" : "Hear it again"}
              </button>
            )
          )}
          {busy && <p className={styles.working}>Reading the PDF, then objections, answers and rulings. This takes 15 to 45 seconds.</p>}
          {stale && !busy && <p>The last hearing was on the draft. The response has been filed since, so the reviewer should read PayPal&apos;s copy.</p>}
        </div>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
      </header>

      <div className={styles.transcript}>
        {hearing && !stale ? (
          <>
            <Pleading lines={lines} className={styles.paper}>
              <p className={styles.caption}>
                {view.id} · hearing transcript · {hearing.pages.length} page{hearing.pages.length === 1 ? "" : "s"} read
                {hearing.pages.length > 1 ? ` (${hearing.pages[0]} to ${hearing.pages.at(-1)})` : ""}
              </p>
              {hearing.mode === "record" ? (
                <p className={styles.quiet}>No objections: Exhibit advised a refund, so the reviewer ruled on the exhibit pages alone.</p>
              ) : hearing.exchanges.length === 0 ? (
                <p className={styles.quiet}>The reviewer read the filing and raised no objections.</p>
              ) : (
                hearing.exchanges.map((e, i) => (
                  <Exchange
                    key={i}
                    index={fresh ? i : 0}
                    objection={e.objection}
                    answer={e.answer}
                    ruling={e.ruling}
                    reason={e.reason}
                    quote={e.objection.sentence !== null ? hearing.response[e.objection.sentence] : null}
                    withdrawn={e.objection.sentence !== null && hearing.withdrawn.includes(e.objection.sentence) && e.ruling === "sustained"}
                    flipped={e.answer.stance === "concede" && e.answer.effect === "refund"}
                  />
                ))
              )}
            </Pleading>
            <div className={`sheet ${styles.verdict}`}>
              <Stamp
                className={styles.verdictStamp}
                word={hearing.verdict.side === "seller" ? "SELLER" : "BUYER"}
                line="REVIEWER'S VERDICT"
                tone={hearing.verdict.side === "seller" ? "won" : "due"}
                animate={fresh}
              />
              <div>
                <h3>
                  {afterRuling
                    ? "Heard after PayPal ruled"
                    : hearing.verdict.by === "rules"
                      ? "Ruled by the rules engine"
                      : hearing.verdict.by === "concession"
                        ? "Conceded on the record"
                        : "Ruled by the simulated reviewer"}
                </h3>
                {afterRuling && (
                  <p>
                    PayPal had already closed this case on {dayTime(view.ruledAt!).split(",")[0]}, so this verdict played no part in the outcome. It shows how
                    the simulated reviewer reads the filing PayPal holds.
                  </p>
                )}
                <p>
                  <strong>For the {hearing.verdict.side}:</strong> {hearing.verdict.reason.replace(/\.$/, "")}.
                </p>
                <p>
                  {hearing.agrees
                    ? `The reviewer agrees with Exhibit's call to ${hearing.call === "fight" ? "fight" : "refund"}.`
                    : `The reviewer disagrees with Exhibit's call to ${hearing.call === "fight" ? "fight" : "refund"}.`}
                  {hearing.flipped ? " Exhibit conceded and changed its call to refund." : ""}
                  {hearing.withdrawn.length ? ` Withdrawn: sentence ${hearing.withdrawn.map((w) => w + 1).join(", ")}.` : ""}
                  {hearing.source === "draft" && (hearing.flipped || hearing.withdrawn.length) ? " The brief above now reflects it." : ""}
                </p>
                {filed && !ruled && view.status !== "RESOLVED" && hearing.source === "paypal" && (
                  <p>When you ask the sandbox to rule, Exhibit asks for a ruling for the {hearing.verdict.side}.</p>
                )}
              </div>
              <p className={styles.meta}>
                {hearing.model ?? "Model"} as reviewer and as Exhibit, {hearing.calls} call{hearing.calls === 1 ? "" : "s"}, {(hearing.ms / 1000).toFixed(1)} s
                {hearing.tokens ? `, ${(hearing.tokens.input + hearing.tokens.output).toLocaleString("en-US")} tokens` : ""}. Nobody at PayPal reads sandbox
                evidence; this reviewer is simulated.
              </p>
            </div>
          </>
        ) : (
          <Pleading lines={lines} className={styles.paper}>
            <p className={styles.caption}>{view.id} · hearing transcript</p>
            <p className={styles.quiet}>No hearing yet. The transcript is typed here, objection by objection.</p>
          </Pleading>
        )}
      </div>

      <ReviewerChair id={view.id} reason={view.reason} response={response} />
    </section>
  );
}
