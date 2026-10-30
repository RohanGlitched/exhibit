"use client";

import { useEffect, useRef, useState } from "react";
import Pleading from "@/components/home/Pleading";
import Stamp from "@/components/Stamp";
import type { Hearing as HearingRecord } from "@/lib/cases/hearing";
import { hearingAnchor } from "@/lib/cases/hearing-log";
import { draftHearingsNote, hearingTabs, pressedNote, type TabInput } from "@/lib/cases/case-page";
import type { Brief } from "@/lib/cases/types";
import type { CaseView } from "@/lib/cases/view";
import { utcDay } from "@/lib/format";
import { utcStamp } from "@/lib/webhooks/paypal";
import Exchange from "./Exchange";
import ReviewerChair from "./ReviewerChair";
import styles from "./hearing.module.css";

const copyOf = (h: Pick<HearingRecord, "source">) => (h.source === "paypal" ? "On the PDF PayPal holds" : "On the draft, before filing");

/** Hearings by time, one per time, oldest first: the ones the page loaded with and any held since. */
function merged(a: HearingRecord[], b: HearingRecord[]): HearingRecord[] {
  const byAt = new Map<string, HearingRecord>();
  for (const h of [...a, ...b]) byAt.set(h.at, h);
  return [...byAt.values()].sort((x, y) => x.at.localeCompare(y.at));
}

const initialList = (view: CaseView) => merged(view.hearings ?? [], view.hearing ? [view.hearing] : []);

/** What the tabs need besides the hearings: when Exhibit asked PayPal to rule, and which hearings the autopilot's lines rest on. */
function tabInput(view: CaseView, hearings: HearingRecord[]): TabInput {
  return {
    hearings,
    rulingAt: view.filings.filter((f) => f.action === "ruling" && f.ok !== false).map((f) => f.at).sort().at(-1) ?? null,
    resolved: view.status === "RESOLVED",
    linked: (view.house?.audit ?? []).map((a) => a.hearing).filter((a): a is string => !!a),
  };
}

/**
 * Cross-examination on the case page. A second model plays PayPal's reviewer: it reads only the PDF (the copy
 * PayPal holds once the response is filed), objects where the reason code's requirements card is weak or
 * missing (up to four objections), and rules. Exhibit answers from the exhibits; the checker strikes answers it
 * can't back. The verdict is the outcome a sandbox ruling request asks for. Every hearing the case kept is here,
 * one binder tab each (the draft's and PayPal's copy's), and each has an anchor the autopilot's audit lines link
 * to. Mounted under the brief; the visitor's own objections go in the reviewer's chair beside it.
 */
export default function Hearing({ view, onBrief }: { view: CaseView; onBrief?: (b: Brief) => void }) {
  const [list, setList] = useState<HearingRecord[]>(() => initialList(view));
  // A case whose ruling request followed a hearing on PayPal's copy opens on that hearing, not on a later re-hearing.
  const [selected, setSelected] = useState<string | null>(() => hearingTabs(tabInput(view, initialList(view))).open);
  const [fresh, setFresh] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A ruling request can hold a new hearing on the server; take it when the page refreshes, and show it.
  const newestSeen = useRef(initialList(view).at(-1)?.at ?? "");
  useEffect(() => {
    const incoming = initialList(view);
    setList((cur) => {
      const next = merged(cur, incoming);
      return next.length === cur.length ? cur : next;
    });
    const newest = incoming.at(-1)?.at;
    if (newest && newest > newestSeen.current) {
      newestSeen.current = newest;
      setSelected(newest);
    }
  }, [view]);

  // An audit line's "Read the transcript" link (#hearing-…) opens that hearing's tab and scrolls to it.
  useEffect(() => {
    const open = () => {
      const id = window.location.hash.slice(1);
      const h = list.find((x) => hearingAnchor(x) === id);
      if (!h) return;
      setSelected(h.at);
      // With several hearings, bring the tabs into view with the transcript under them.
      requestAnimationFrame(() => (document.getElementById(`${id}-tab`)?.parentElement ?? document.getElementById(id))?.scrollIntoView({ block: "start", behavior: "smooth" }));
    };
    open();
    window.addEventListener("hashchange", open);
    return () => window.removeEventListener("hashchange", open);
  }, [list]);

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
      const h = j.hearing;
      setList((cur) => merged(cur, [h]));
      newestSeen.current = h.at > newestSeen.current ? h.at : newestSeen.current;
      setSelected(h.at);
      setFresh(h.at);
      if (j.brief && h.source === "draft") onBrief?.(j.brief);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const latest = list.at(-1) ?? null;
  const tabInfo = tabInput(view, list);
  const { tabs, open } = hearingTabs(tabInfo);
  const hearing = list.find((h) => h.at === selected) ?? list.find((h) => h.at === open) ?? latest;
  const tab = tabs.find((t) => t.at === hearing?.at);
  const draftNote = draftHearingsNote(tabInfo);
  // The latest hearing read the draft, but the response has been filed since: PayPal's copy is due a hearing.
  const stale = Boolean(latest && filed && latest.source === "draft");
  // A hearing held after PayPal had already decided the case (or after Exhibit asked it to) played no part in the outcome.
  const afterRuled = Boolean(hearing && view.ruledAt && view.status === "RESOLVED" && hearing.at > view.ruledAt);
  const afterRequest = Boolean(tab?.afterRuling && !afterRuled);
  const askedAt = tabInfo.rulingAt;
  const response = latest && !stale ? latest.response : view.brief.sentences.filter((s) => s.kept).map((s) => ({ text: s.text, cites: s.cites }));
  const advisedRefund = !filed && view.brief.recommendation !== "fight";
  const lines = hearing ? Math.max(8, hearing.exchanges.length * 7 + 3) : 6;
  const animate = Boolean(hearing && fresh === hearing.at);

  return (
    <section className={styles.hearing} aria-label="Cross-examination" id="cross-examination">
      <header className={styles.head}>
        <p className={styles.kicker}>
          <span className="bates">Cross-examination</span>
          {list.length > 1 ? <span>{list.length} hearings kept</span> : hearing && <span>Heard {utcStamp(hearing.at)}</span>}
          {list.length === 1 && hearing && <span>{copyOf(hearing)}</span>}
        </p>
        <h2>{advisedRefund ? "A second opinion from the reviewer" : "Before PayPal's reviewer"}</h2>
        <p>
          {advisedRefund
            ? "Exhibit advised refunding, so there is no response to object to. A second model, playing PayPal's dispute reviewer, reads the exhibit pages alone and says how it would rule if the seller fought."
            : "A second model plays PayPal's dispute reviewer. It reads only the PDF, the response and the Bates-stamped exhibits, and objects where the requirements card is weak or missing, up to four objections. Exhibit answers each objection from the exhibits or concedes; the same checker strikes any answer it can't back. When you ask the sandbox to rule, Exhibit asks for the reviewer's verdict, not its own."}
        </p>
        {view.priorPayments?.length ? (
          <p>
            The reviewer reads the store&apos;s history as given, the way a reviewer reads a real seller&apos;s order book: the test is whether the
            response proves what the network asks for from that record. The sandbox note on how the earlier payments were re-created sits beside the
            requirements card, not in the PDF
            {view.filings.some((f) => f.action === "evidence" && f.at < "2026-10-30T00:50:00Z")
              ? ". The PDF PayPal holds on this case was filed before that change, so the note is still inside it, and a hearing on PayPal's copy reads it."
              : "."}
          </p>
        ) : null}
        <div className={styles.call}>
          {!latest || stale ? (
            <button className="btn btnPrimary" onClick={run} disabled={busy || Boolean(view.locked)} title={view.locked ?? undefined}>
              {busy ? "The reviewer is reading…" : advisedRefund ? "Ask the reviewer" : filed ? "Cross-examine the filed PDF" : "Call the reviewer"}
            </button>
          ) : (
            !ruled && (
              <button className={styles.again} onClick={run} disabled={busy || Boolean(view.locked)} title={view.locked ?? undefined}>
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
        {draftNote && <p className={styles.tabNote}>{draftNote}</p>}
        {list.length > 1 && (
          <div className={styles.tabs} role="tablist" aria-label="Hearings on this case">
            {tabs.map((t) => (
              <button
                key={t.at}
                type="button"
                role="tab"
                id={`${hearingAnchor(t)}-tab`}
                aria-selected={t.at === hearing?.at}
                aria-controls={hearingAnchor(t)}
                className={styles.tab}
                data-after={t.afterRuling ? "true" : undefined}
                onClick={() => setSelected(t.at)}
              >
                <strong>{t.label}</strong>
                <span>{utcStamp(t.at)}</span>
              </button>
            ))}
          </div>
        )}
        {hearing ? (
          <div id={hearingAnchor(hearing)} className={styles.anchor} role={list.length > 1 ? "tabpanel" : undefined} aria-labelledby={list.length > 1 ? `${hearingAnchor(hearing)}-tab` : undefined}>
            <Pleading lines={lines} className={styles.paper}>
              <p className={styles.caption}>
                {view.id} · hearing transcript · {copyOf(hearing).toLowerCase()}
                {tab && tab.label !== "On the draft" && tab.label !== "On the PDF PayPal holds" ? ` · ${tab.label.toLowerCase()}` : ""} · {utcStamp(hearing.at)} · {hearing.pages.length} page{hearing.pages.length === 1 ? "" : "s"} read
                {hearing.pages.length > 1 ? ` (${hearing.pages[0]} to ${hearing.pages.at(-1)})` : ""}
              </p>
              {hearing.mode === "record" ? (
                <p className={styles.quiet}>No objections: Exhibit advised a refund, so the reviewer ruled on the exhibit pages alone.</p>
              ) : hearing.exchanges.length === 0 ? (
                <p className={styles.quiet}>The reviewer read the filing and raised no objections.</p>
              ) : (
                hearing.exchanges.map((e, i) => (
                  <Exchange
                    key={`${hearing.at}-${i}`}
                    index={animate ? i : 0}
                    objection={e.objection}
                    answer={e.answer}
                    ruling={e.ruling}
                    reason={e.reason}
                    quote={e.objection.sentence !== null ? hearing.response[e.objection.sentence] : null}
                    withdrawn={e.objection.sentence !== null && hearing.withdrawn.includes(e.objection.sentence) && e.ruling === "sustained"}
                    flipped={e.answer.stance === "concede" && e.answer.effect === "refund"}
                    pressed={pressedNote(e.objection, hearing.exchanges)}
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
                animate={animate}
              />
              <div>
                <h3>
                  {afterRuled
                    ? "Heard again after PayPal ruled"
                    : afterRequest
                      ? "Heard again after the ruling request"
                    : hearing.verdict.by === "rules"
                      ? "Ruled by the rules engine"
                      : hearing.verdict.by === "concession"
                        ? "Conceded on the record"
                        : "Ruled by the simulated reviewer"}
                </h3>
                {afterRuled && (
                  <p>
                    PayPal had already closed this case on {utcDay(view.ruledAt!)}
                    {askedAt ? `, at Exhibit's request of ${utcStamp(askedAt)}` : ""}, so this verdict played no part in the outcome. It shows how the
                    simulated reviewer reads the filing PayPal holds when heard again.
                  </p>
                )}
                {afterRequest && askedAt && (
                  <p>
                    Exhibit asked PayPal to rule at {utcStamp(askedAt)}, following an earlier hearing, so this verdict played no part in the request. It
                    shows how the simulated reviewer reads the filing PayPal holds when heard again.
                  </p>
                )}
                <p>
                  <strong>For the {hearing.verdict.side}:</strong> {hearing.verdict.reason.replace(/\.$/, "")}.
                </p>
                <p>
                  {verdictLine(hearing, view.brief?.recommendation)}
                  {hearing.withdrawn.length
                    ? hearing.source === "paypal"
                      ? ` Conceded at the hearing: sentence ${hearing.withdrawn.map((w) => w + 1).join(", ")}; still in the PDF PayPal holds.`
                      : ` Withdrawn before filing: sentence ${hearing.withdrawn.map((w) => w + 1).join(", ")}.`
                    : ""}
                  {hearing.source === "draft" && (hearing.flipped || hearing.withdrawn.length) ? " The brief above reflects it." : ""}
                </p>
                {filed && !ruled && view.status !== "RESOLVED" && hearing.source === "paypal" && hearing === latest && (
                  <p>When you ask the sandbox to rule, Exhibit asks for a ruling for the {hearing.verdict.side}.</p>
                )}
              </div>
              <p className={styles.meta}>
                {hearing.model ?? "Model"} as reviewer and as Exhibit, {hearing.calls} call{hearing.calls === 1 ? "" : "s"}, {(hearing.ms / 1000).toFixed(1)} s
                {hearing.tokens ? `, ${(hearing.tokens.input + hearing.tokens.output).toLocaleString("en-US")} tokens` : ""}. Nobody at PayPal reads sandbox
                evidence; this reviewer is simulated.
              </p>
            </div>
          </div>
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

/**
 * The verdict against Exhibit's own advice. When the brief advised a refund and the seller filed a response anyway,
 * the hearing's call is the seller's fight, not Exhibit's, so the line says so instead of "Exhibit's call to fight".
 */
export function verdictLine(h: { agrees: boolean; call?: string; flipped?: boolean; verdict: { side: string } }, advised: string | undefined): string {
  const sellerFought = h.call === "fight" && advised !== undefined && advised !== "fight";
  if (sellerFought) {
    return h.verdict.side === "buyer"
      ? "The reviewer finds for the buyer, as Exhibit advised: its call was to refund, and the seller filed a response anyway." + (h.flipped ? " Exhibit conceded at the hearing." : "")
      : "The reviewer finds for the seller, though Exhibit advised a refund; the seller filed a response anyway.";
  }
  const call = h.call === "fight" ? "fight" : "refund";
  return (h.agrees ? `The reviewer agrees with Exhibit's call to ${call}.` : `The reviewer disagrees with Exhibit's call to ${call}.`) + (h.flipped ? " Exhibit conceded and changed its call to refund." : "");
}
