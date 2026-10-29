"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import PinnedBrief, { type Verdict } from "@/components/brief/PinnedBrief";
import Stamp from "@/components/Stamp";
import WebhookLine from "./WebhookLine";
import HouseRules from "./HouseRules";
import Hearing from "./Hearing";
import AgentTranscript from "./AgentTranscript";
import CaseLedger from "./CaseLedger";
import ToolkitCalls from "./ToolkitCalls";
import type { ArgueEvent, BriefSentence, Exhibit, Filing, TallyItem } from "@/lib/cases/types";
import type { CaseView } from "@/lib/cases/view";
import { STATUSES, dayTime, daysToDue, reasonLabel, usd } from "@/lib/format";
import styles from "./case.module.css";

const STAMP: Partial<Record<CaseView["where"], { word: string; tone: "due" | "won" | "ink" }>> = {
  won: { word: "WON", tone: "won" },
  lost: { word: "LOST", tone: "due" },
  refunded: { word: "REFUNDED", tone: "ink" },
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

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3600);
    return () => clearTimeout(t);
  }, [toast]);

  // Keep PayPal's side current: status, allowed actions, outcome. Faster while PayPal is still handing it over.
  useEffect(() => {
    if (view.status === "RESOLVED") return;
    const t = setInterval(refresh, view.where === "open" || view.where === "reviewing" ? 20_000 : 60_000);
    return () => clearInterval(t);
  }, [refresh, view.status, view.where]);

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
  const due = view.due ? daysToDue(view.due) : null;
  const can = new Set(view.actions);
  // PayPal's record decides: a case is filed when PayPal holds the seller's response, whoever filed it.
  const filed = view.filings.some((f) => f.action === "evidence" || f.action === "accept");
  // A new chargeback stays with PayPal (open, or under review with nothing filed) for a few minutes.
  const waiting = (view.where === "open" || view.where === "reviewing") && Date.now() - new Date(view.created).getTime() < 3 * 3_600_000;
  const closed = view.status === "RESOLVED";
  const pdfHref = view.filedPdf ? `/api/cases/${view.id}/filed` : `/api/cases/${view.id}/pdf`;
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
                    {f.summary}.{f.source === "paypal" && <em className={styles.source}> From PayPal&apos;s record.</em>}
                  </li>
                ))}
                {closed && view.ruledAt && view.ending && (
                  <li>
                    <span>{dayTime(view.ruledAt)}</span>
                    {view.ending.what}.
                  </li>
                )}
              </ol>
              <p className={styles.after}>
                {closed ? (
                  <>
                    PayPal shows this case as <strong>resolved</strong>.
                    {view.decidedBy === "sandbox" &&
                      " The sandbox closes some filed cases by itself, so this outcome says nothing about the filing: no reviewer, real or simulated, decided it."}
                  </>
                ) : (
                  <>
                    PayPal now shows this case as <strong>{STATUSES[view.status] ?? view.status}</strong>
                    {view.evidences.some((e) => e.source === "SUBMITTED_BY_SELLER") ? ", with the seller's response on file" : ""}. On a card chargeback the
                    issuing bank makes the final call; this page updates when PayPal does.
                  </>
                )}
              </p>
              <p className={styles.buttons}>
                <a className="btn btnQuiet" href={pdfHref} target="_blank" rel="noreferrer">
                  {view.filedPdf ? "Read the PDF PayPal holds" : "Read the PDF"}
                </a>
              </p>
              {!closed && !view.filings.some((f) => f.action === "ruling") && (
                <div className={styles.ruling}>
                  <p>
                    In the sandbox nobody at PayPal reads the evidence: its simulator rules for whichever side it is asked to. So Exhibit first puts the
                    filing before a simulated PayPal reviewer (the hearing below), and asks the simulator to rule the way that reviewer decided. PayPal
                    opens the case for a ruling about 20 minutes after filing.
                  </p>
                  <button className="btn btnQuiet" onClick={() => file("ruling")} disabled={phase === "filing" || !can.has("adjudicate")}>
                    {can.has("adjudicate") ? "Ask the sandbox to rule" : "Waiting for PayPal to open the ruling"}
                  </button>
                </div>
              )}
            </div>
          ) : closed ? (
            <div className={styles.filed}>
              <h2>Closed</h2>
              <p className={styles.after}>
                Exhibit argued this case but nothing was filed before PayPal&apos;s deadline. {view.whereLine}.
              </p>
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
                <a className="btn btnQuiet" href={pdfHref} target="_blank" rel="noreferrer">
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
        <Link href="/desk/analytics" className={styles.backAlt}>
          Analytics
        </Link>
        <span className={styles.status} data-status={view.status}>
          {closed
            ? view.where === "won"
              ? "Resolved: won"
              : view.where === "lost"
                ? "Resolved: lost"
                : view.where === "refunded"
                  ? "Resolved: refunded"
                  : "Resolved"
            : view.where === "filed"
              ? "Filed, PayPal reviewing"
              : view.where === "refunded"
                ? "Refund accepted"
                : (STATUSES[view.status] ?? view.status)}
        </span>
        {due !== null && view.status === "WAITING_FOR_SELLER_RESPONSE" && (
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

      {view.restored && (
        <p className={styles.notice} data-tone="record">
          Exhibit rebuilt this case from PayPal&apos;s own record: the response, the filing and the outcome below are what PayPal holds.
        </p>
      )}
      <WebhookLine webhook={view.webhook} />
      <HouseRules id={view.id} house={view.house} />
      {view.notes.map((n, i) => (
        <p key={i} className={styles.notice} data-tone="record">
          {n}
        </p>
      ))}
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
              word={STAMP[view.where]?.word ?? "FILED"}
              line={
                closed && view.ending
                  ? view.ending.stamp
                  : closed && view.ruledAt
                    ? `PAYPAL CLOSED ${dayTime(view.ruledAt).split(",")[0].toUpperCase()}`
                    : `WITH PAYPAL ${dayTime(view.filings[0].at).split(",")[0].toUpperCase()}`
              }
              tone={STAMP[view.where]?.tone ?? "due"}
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
          closed ? (
            <div className={styles.empty}>
              <p>PayPal closed this case before anyone answered it. {view.whereLine}.</p>
              <p>{view.due ? `PayPal's deadline to answer this case was ${dayTime(view.due).split(",")[0]}` : "PayPal sets a response date on every case"}; a chargeback nobody answers by then can't be won.</p>
              <Link className="btn btnPrimary" href="/new">
                Open a case you can answer
              </Link>
            </div>
          ) : (
            <div className={styles.empty}>
              <p>Exhibit reads the case from PayPal, pulls the order, payment and tracking behind it, and writes the response here, one sentence at a time.</p>
              <p>
                Every sentence is pinned to the record that proves it, and every figure and name in it is checked against that record. A sentence that
                doesn&apos;t match gets struck before anything is filed; one with nothing to check is marked unverified.
              </p>
              <button className="btn btnPrimary" onClick={argue} disabled={phase === "arguing"}>
                Argue this case
              </button>
            </div>
          )
        }
        below={panel}
        decided={
          closed
            ? view.where === "won"
              ? `won, the seller keeps ${amount}`
              : view.where === "lost"
                ? `lost, ${amount} back to the buyer`
                : view.where === "refunded"
                  ? `refunded, ${amount} back to the buyer`
                  : "resolved"
            : null
        }
      />
      </div>
      <ToolkitCalls calls={view.brief?.toolkit} />

      {phase !== "arguing" && <Hearing view={view} onBrief={(b) => { setSentences(b.sentences); setVerdict(toVerdict(b)); setView((v) => ({ ...v, brief: b })); }} />}
      <CaseLedger view={view} />
      {view.agent && <AgentTranscript agent={view.agent} />}

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
