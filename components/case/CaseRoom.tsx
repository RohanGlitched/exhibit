"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import PinnedBrief, { type Verdict } from "@/components/brief/PinnedBrief";
import Stamp from "@/components/Stamp";
import type { ArgueEvent, BriefSentence, Exhibit, Filing, TallyItem } from "@/lib/cases/types";
import type { CaseView } from "@/lib/cases/view";
import { STATUSES, dayTime, daysUntil, reasonLabel, usd } from "@/lib/format";
import styles from "./case.module.css";

const OUTCOMES: Record<string, string> = {
  RESOLVED_SELLER_FAVOUR: "Won: resolved in the seller's favour",
  RESOLVED_BUYER_FAVOUR: "Lost: resolved in the buyer's favour",
  ACCEPTED: "Closed: the seller accepted the claim",
  CANCELED_BY_BUYER: "Closed: the buyer cancelled",
  RESOLVED_WITH_PAYOUT: "Closed with a payout",
  DENIED: "Denied",
};

type Phase = "idle" | "arguing" | "argued" | "filing";

export default function CaseRoom({ initial }: { initial: CaseView }) {
  const [view, setView] = useState(initial);
  const [exhibits, setExhibits] = useState<Exhibit[]>(initial.brief ? initial.exhibits : []);
  const [sentences, setSentences] = useState<BriefSentence[]>(initial.brief?.sentences ?? []);
  const [tally, setTally] = useState<TallyItem[]>(initial.brief?.tally ?? []);
  const [verdict, setVerdict] = useState<Verdict | null>(initial.brief ? toVerdict(initial.brief) : null);
  const [status, setStatus] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>(initial.brief ? "argued" : "idle");
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"accept" | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const autoStarted = useRef(false);

  const refresh = useCallback(async () => {
    const r = await fetch(`/api/cases/${view.id}`, { cache: "no-store" }).catch(() => null);
    if (r?.ok) setView(await r.json());
  }, [view.id]);

  // Keep PayPal's side current: status, allowed actions, outcome.
  useEffect(() => {
    if (view.status === "RESOLVED") return;
    const t = setInterval(refresh, 20_000);
    return () => clearInterval(t);
  }, [refresh, view.status]);

  const argue = useCallback(async () => {
    setPhase("arguing");
    setError(null);
    setExhibits([]);
    setSentences([]);
    setTally([]);
    setVerdict(null);
    setStatus("Reading the case from PayPal");
    try {
      const res = await fetch(`/api/cases/${view.id}/argue`, { method: "POST" });
      if (!res.ok || !res.body) throw new Error((await res.json().catch(() => ({}))).error ?? "Couldn't start the argument.");
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          const ev = JSON.parse(line) as ArgueEvent;
          if (ev.type === "status") setStatus(ev.text);
          else if (ev.type === "exhibit") setExhibits((x) => [...x, ev.exhibit]);
          else if (ev.type === "sentence") {
            setStatus(null);
            setSentences((x) => [...x, ev.sentence]);
          } else if (ev.type === "tally") setTally((x) => [...x, ev.item]);
          else if (ev.type === "brief") {
            setVerdict(toVerdict(ev.brief));
            setView((v) => ({ ...v, brief: ev.brief }));
          } else if (ev.type === "error") throw new Error(ev.text);
        }
      }
      setPhase("argued");
    } catch (e) {
      setError((e as Error).message);
      setPhase(view.brief ? "argued" : "idle");
    } finally {
      setStatus(null);
    }
  }, [view.id, view.brief]);

  // A case opened from /new starts arguing on arrival.
  useEffect(() => {
    if (autoStarted.current || initial.brief) return;
    if (new URLSearchParams(window.location.search).get("argue") === "1") {
      autoStarted.current = true;
      argue();
    }
  }, [argue, initial.brief]);

  async function file(action: "evidence" | "accept" | "offer" | "ruling") {
    setPhase("filing");
    setError(null);
    setConfirm(null);
    try {
      const r = await fetch(`/api/cases/${view.id}/file`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });
      const j = (await r.json()) as { filing?: Filing; error?: string };
      if (!r.ok || !j.filing) throw new Error(j.error ?? "PayPal didn't take it.");
      setToast(
        action === "evidence"
          ? "Response filed with PayPal."
          : action === "accept"
            ? "Claim accepted. PayPal refunds the buyer."
            : action === "ruling"
              ? "Ruling requested. This page updates when PayPal resolves the case."
              : "Offer sent.",
      );
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPhase("argued");
    }
  }

  const amount = usd(view.amount.value);
  const due = daysUntil(view.due ?? undefined);
  const can = new Set(view.actions);
  const filed = view.filings.length > 0;
  const waiting = !filed && view.status !== "WAITING_FOR_SELLER_RESPONSE" && view.status !== "RESOLVED";
  const rec = verdict?.recommendation;

  const panel =
    (phase === "argued" || phase === "filing") && verdict ? (
        <section className={`sheet ${styles.actions}`} aria-label="File">
          {filed ? (
            <div className={styles.filed}>
              <h2>Filed</h2>
              <ol>
                {view.filings.map((f, i) => (
                  <li key={i}>
                    <span>{dayTime(f.at)}</span>
                    {f.summary}.
                  </li>
                ))}
              </ol>
              <p className={styles.after}>
                PayPal now shows this case as <strong>{STATUSES[view.status] ?? view.status}</strong>
                {view.evidences.some((e) => e.source === "SUBMITTED_BY_SELLER") ? ", with the seller's evidence on file" : ""}. On a card chargeback the
                issuing bank makes the final call; this page updates when PayPal does.
              </p>
              {view.status !== "RESOLVED" && !view.filings.some((f) => f.action === "ruling") && (
                <div className={styles.ruling}>
                  <p>
                    In the sandbox nobody at PayPal reads the evidence. When PayPal opens the case for a ruling (about 20 minutes after filing), you can ask
                    its simulator to decide. It rules the way the filing points.
                  </p>
                  <button className="btn btnQuiet" onClick={() => file("ruling")} disabled={phase === "filing" || !can.has("adjudicate")}>
                    {can.has("adjudicate") ? "Ask the sandbox to rule" : "Waiting for PayPal to open the ruling"}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className={styles.choose}>
              <div>
                <h2>{rec === "accept" ? "Refund and close it" : rec === "offer" ? "Offer a partial refund" : "File the response"}</h2>
                <p>
                  {rec === "accept"
                    ? `Accepting tells PayPal to refund ${amount} to the buyer and closes the case. It saves the fee and the time a losing fight costs.`
                    : `Exhibit sends PayPal the response, the evidence types it chose and a PDF with every exhibit, Bates-stamped.`}
                </p>
              </div>
              <div className={styles.buttons}>
                {rec === "accept" ? (
                  confirm === "accept" ? (
                    <button className="btn btnDanger" onClick={() => file("accept")} disabled={phase === "filing" || !can.has("accept_claim")}>
                      Confirm refund of {amount}
                    </button>
                  ) : (
                    <button className="btn btnPrimary" onClick={() => setConfirm("accept")} disabled={phase === "filing" || !can.has("accept_claim")}>
                      Accept and refund
                    </button>
                  )
                ) : (
                  <button className="btn btnPrimary" onClick={() => file(rec === "offer" ? "offer" : "evidence")} disabled={phase === "filing" || !can.has(rec === "offer" ? "make_offer" : "provide_evidence")}>
                    {phase === "filing" ? "Filing…" : rec === "offer" ? `Offer ${usd(verdict.offerAmount ?? "0")}` : "File the response"}
                  </button>
                )}
                {rec === "accept" && can.has("provide_evidence") && (
                  <button className="btn btnQuiet" onClick={() => file("evidence")} disabled={phase === "filing"}>
                    Fight it anyway
                  </button>
                )}
                {rec !== "accept" && can.has("accept_claim") && (
                  confirm === "accept" ? (
                    <button className="btn btnDanger" onClick={() => file("accept")} disabled={phase === "filing"}>
                      Confirm refund of {amount}
                    </button>
                  ) : (
                    <button className="btn btnQuiet" onClick={() => setConfirm("accept")} disabled={phase === "filing"}>
                      Refund instead
                    </button>
                  )
                )}
                <a className="btn btnQuiet" href={`/api/cases/${view.id}/pdf`} target="_blank" rel="noreferrer">
                  Read the PDF
                </a>
              </div>
              {waiting && <p className={styles.hint}>Filing opens when PayPal passes the case to the seller.</p>}
              <button className={styles.again} onClick={argue} disabled={phase !== "argued"}>
                Argue it again
              </button>
            </div>
          )}
        </section>
      ) : null;

  return (
    <main className={`shell ${styles.room}`}>
      <div className={styles.topline}>
        <Link href="/desk" className={styles.back}>
          Desk
        </Link>
        <span className={styles.status} data-status={view.status}>
          {view.outcome ? OUTCOMES[view.outcome] ?? view.outcome : STATUSES[view.status] ?? view.status}
        </span>
        {due !== null && view.status !== "RESOLVED" && (
          <span className={styles.due} data-soon={due <= 2}>
            Respond by {dayTime(view.due!).split(",")[0]}, {due <= 0 ? "today" : `${due} day${due === 1 ? "" : "s"} left`}
          </span>
        )}
      </div>

      <section className={styles.titleRow}>
        <div>
          <h1>{view.story?.title ?? `${reasonLabel(view.reason)}, ${amount}`}</h1>
          {view.story && <p className={styles.blurb}>{view.story.blurb}</p>}
        </div>
      </section>

      {waiting && (
        <p className={styles.notice}>
          PayPal is still reviewing this chargeback before it reaches the seller. That usually takes five to eight minutes in the sandbox. You can argue the
          case now; filing opens when PayPal hands it over. This page checks every 20 seconds.
        </p>
      )}

      <div className={styles.desk}>
      <PinnedBrief
        stamp={
          filed ? (
            <Stamp
              word={view.filings.some((f) => f.action === "accept") ? "REFUNDED" : "FILED"}
              line={`WITH PAYPAL ${dayTime(view.filings[0].at).split(",")[0].toUpperCase()}`}
              tone={view.outcome === "RESOLVED_SELLER_FAVOUR" ? "won" : "due"}
            />
          ) : null
        }
        head={{ id: view.id, reason: reasonLabel(view.reason), amount, buyer: view.story?.buyer, order: view.invoiceId }}
        exhibits={exhibits}
        sentences={sentences}
        tally={tally}
        verdict={verdict}
        status={status}
        placeholder={
          <div className={styles.empty}>
            <p>Exhibit reads the case from PayPal, pulls the order, payment and tracking behind it, and writes the response here, one sentence at a time.</p>
            <p>Every sentence is pinned to the record that proves it. A sentence it can&apos;t prove gets struck before anything is filed.</p>
            <button className="btn btnPrimary" onClick={argue} disabled={phase === "arguing"}>
              Argue this case
            </button>
          </div>
        }
        below={panel}
      />
      </div>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {toast && (
        <p className={styles.toast} role="status" onAnimationEnd={() => setToast(null)}>
          {toast}
        </p>
      )}
    </main>
  );
}

function toVerdict(b: NonNullable<CaseView["brief"]>): Verdict {
  return { recommendation: b.recommendation, odds: b.odds, offerAmount: b.offerAmount, headline: b.headline, engine: b.engine, model: b.model, ms: b.ms };
}
