"use client";

import { useState } from "react";
import type { ChairExchange } from "@/lib/cases/hearing";
import Exchange from "./Exchange";
import styles from "./hearing.module.css";

const MAX = 300;

const EXAMPLES: Record<string, string[]> = {
  MERCHANDISE_OR_SERVICE_NOT_RECEIVED: ["Which page shows the parcel reached the buyer's own address?", "Who signed for it, and does that match the buyer?"],
  MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED: ["Where did the listing tell the buyer the colour could differ?", "Was the buyer offered a return before the chargeback?"],
  UNAUTHORISED: ["What shows the cardholder, not someone else, made this purchase?", "Why does it ship somewhere other than the billing address?"],
  DUPLICATE_TRANSACTION: ["Which page ties the refund to the second charge rather than this one?", "Does any page show the buyer ended up paying once?"],
};

/**
 * "Take the reviewer's chair": a visitor objects to the response and watches Exhibit answer from the exhibits
 * (checked by the same checker) or concede. Nothing typed here is filed or saved; the log lives in the page.
 */
export default function ReviewerChair({ id, reason, response }: { id: string; reason: string; response: { text: string; cites: string[] }[] }) {
  const [text, setText] = useState("");
  const [sentence, setSentence] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<ChairExchange[]>([]);

  async function object() {
    const t = text.trim();
    if (t.length < 8 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/cases/${id}/object`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ objection: t, sentence }),
      });
      const j = (await r.json().catch(() => ({}))) as { exchange?: ChairExchange; error?: string };
      if (!r.ok || !j.exchange) throw new Error(j.error ?? "Exhibit didn't answer. Try again in a minute.");
      setLog((l) => [j.exchange!, ...l].slice(0, 8));
      setText("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className={`sheet ${styles.chair}`} aria-label="Take the reviewer's chair">
      <h3>Take the reviewer&apos;s chair</h3>
      <p>
        Object to the response the way a reviewer would. Exhibit answers from the exhibits or concedes, and the checker reads its answer. Nothing you type
        is filed or saved.
      </p>
      {response.length > 0 && (
        <label>
          Object to
          <select value={sentence ?? ""} onChange={(e) => setSentence(e.target.value === "" ? null : Number(e.target.value))}>
            <option value="">The response as a whole</option>
            {response.map((s, i) => (
              <option key={i} value={i}>
                Sentence {i + 1}: {s.text.length > 60 ? `${s.text.slice(0, 58)}…` : s.text}
              </option>
            ))}
          </select>
        </label>
      )}
      <label>
        Your objection
        <textarea
          value={text}
          maxLength={MAX}
          onChange={(e) => setText(e.target.value)}
          placeholder="Which page shows that?"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) object();
          }}
        />
      </label>
      <span className={styles.count}>
        {text.length}/{MAX}
      </span>
      <div className={styles.examples}>
        {(EXAMPLES[reason] ?? ["Which page answers the buyer's claim?"]).map((x) => (
          <button key={x} type="button" onClick={() => setText(x)}>
            {x}
          </button>
        ))}
      </div>
      <button className="btn btnPrimary" type="button" onClick={object} disabled={busy || text.trim().length < 8}>
        {busy ? "Exhibit is answering…" : "Object"}
      </button>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {log.length > 0 && (
        <div className={styles.chairLog} aria-live="polite">
          {log.map((x, i) => (
            <Exchange
              key={log.length - i}
              objection={{ ...x.objection, n: 0 }}
              answer={x.answer}
              ruling={x.ruling}
              reason={x.reason}
              quote={x.objection.sentence !== null ? response[x.objection.sentence] : null}
              who="You"
            />
          ))}
        </div>
      )}
    </aside>
  );
}
