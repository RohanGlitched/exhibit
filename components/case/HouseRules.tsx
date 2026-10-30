"use client";
import { useState } from "react";
import { utcStamp } from "@/lib/webhooks/paypal";
import type { HouseView } from "@/lib/cases/view";
import styles from "./HouseRules.module.css";

/**
 * The seller's own lane on the case page: each step the autopilot took, with the house rule it acted under and
 * how long after PayPal's webhook, the rules themselves, and a way to stop a step still in its undo window.
 */
export default function HouseRules({ id, house }: { id: string; house: HouseView | null }) {
  const [view, setView] = useState(house);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!view) return null;
  const p = view.plan;
  const undo = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/cases/${id}/autopilot`, { method: "POST" });
      const j = (await r.json()) as { house?: HouseView["plan"]; error?: string };
      if (!r.ok || !j.house) throw new Error(j.error ?? "Couldn't stop it.");
      setView({ ...view, plan: j.house, undoable: false, audit: [...view.audit, { at: new Date().toISOString(), text: "Stopped in the undo window; the case waits for the seller" }] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className={styles.panel} aria-label="Autopilot" id="autopilot">
      <p className={styles.head}>
        <span className={styles.tag}>{view.lane ? "Seller's lane · autopilot" : "Autopilot"}</span>
        <span>
          {view.lane
            ? "Opened as the shop's own traffic, not handed to a visitor: the autopilot works it end to end under the seller's house rules."
            : "The autopilot stepped in on this case under the seller's house rules."}
        </span>
      </p>
      {view.audit.length > 0 && (
        <ol className={styles.audit}>
          {view.audit.map((a, i) => (
            <li key={i}>
              <time dateTime={a.at}>{utcStamp(a.at)}</time>
              <span>
                {a.text}
                {a.hearing && (
                  <>
                    {" "}
                    <a className={styles.transcript} href={`#${a.hearing}`}>
                      Read the transcript
                    </a>
                  </>
                )}
                {a.missing && <em className={styles.missing}> ({a.missing})</em>}
              </span>
            </li>
          ))}
        </ol>
      )}
      {p && view.undoable && (
        <p className={styles.undo}>
          <span>
            Sends at {utcStamp(p.sendAfter)} unless stopped.
          </span>
          <button type="button" onClick={undo} disabled={busy}>
            {busy ? "Stopping…" : "Stop it"}
          </button>
          {error && <span role="alert">{error}</span>}
        </p>
      )}
      <details className={styles.rules}>
        <summary>House rules {view.rules.version}</summary>
        <ol>
          {view.rules.rules.map((r) => (
            <li key={r.n} value={r.n}>
              {r.text}
            </li>
          ))}
        </ol>
      </details>
    </section>
  );
}
