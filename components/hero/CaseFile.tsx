"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Stamp from "@/components/Stamp";
import type { Brief, Exhibit } from "@/lib/cases/types";
import { day, usd } from "@/lib/format";
import styles from "./casefile.module.css";

interface Props {
  head: { id: string; reason: string; amount: string; buyer?: string | null; order?: string | null };
  exhibits: Exhibit[];
  brief: Brief;
  filedAt: string | null;
  onPhase?: (phase: number) => void; // 0 read, 1 gather, 2 argue, 3 check, 4 file
}

const W = 820; // design size of the desk; the whole scene scales to its container
const H = 680;
const CALL = { fight: "Fight it", accept: "Refund it", offer: "Offer a refund" } as const;

/**
 * The case file on a desk, in perspective: the response letter on the left writes itself one sentence at a
 * time, and as each sentence cites a record, that exhibit lifts out of the tabbed stack on the right with a
 * thread back to its mark. It ends with the stamp. Real case, real records; only the pacing is staged.
 */
export default function CaseFile({ head, exhibits, brief, filedAt, onPhase }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [step, setStep] = useState(-1);
  const [run, setRun] = useState(0);
  const [thread, setThread] = useState<string | null>(null);
  const marks = useRef(new Map<string, HTMLElement>());
  const tabs = useRef(new Map<string, HTMLElement>());
  const sentences = brief.sentences.filter((s) => s.kept);
  const nEx = exhibits.length;
  const nS = sentences.length;
  const END = nEx + nS + 2; // + tally + stamp

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    // Perspective pushes the stack's far edge past the design box, so fit to a little more than W.
    const fit = () => setScale(Math.min(1, el.clientWidth / (W + 130)));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setStep(END);
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    let started = false;
    const tick = (s: number) => {
      setStep(s);
      if (s >= END) return;
      const wait = s < 0 ? 400 : s < nEx ? 150 : s < nEx + nS ? 1250 : 900;
      timer = setTimeout(() => tick(s + 1), wait);
    };
    const io = new IntersectionObserver((es) => {
      if (!started && es.some((e) => e.isIntersecting)) {
        started = true;
        tick(0);
      }
    }, { threshold: 0.7 });
    if (wrap.current) io.observe(wrap.current);
    return () => {
      io.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, [run, END, nEx, nS]);

  const shownEx = Math.max(0, Math.min(nEx, step));
  const shownS = Math.max(0, Math.min(nS, step - nEx + 1));
  const writing = step >= nEx && step < nEx + nS;
  const current = writing ? sentences[step - nEx] : null;
  const active = current?.cites.find((c) => exhibits.some((e) => e.id === c)) ?? null;
  const showTally = step >= nEx + nS;
  const stamped = step >= END;
  const phase = step < 0 ? -1 : step === 0 ? 0 : step < nEx ? 1 : step < nEx + nS ? 2 : step < END ? 3 : 4;
  useEffect(() => onPhase?.(phase), [phase, onPhase]);

  // The thread from the sentence's mark to the lifted exhibit's tab, in screen space.
  useLayoutEffect(() => {
    if (!active || !wrap.current || !current) {
      setThread(null);
      return;
    }
    const frame = requestAnimationFrame(() => {
      const box = wrap.current!.getBoundingClientRect();
      const m = marks.current.get(`${step - nEx}-${active}`);
      const t = tabs.current.get(active);
      if (!m || !t) return setThread(null);
      const a = m.getBoundingClientRect();
      const b = t.getBoundingClientRect();
      const x1 = a.right - box.left + 2;
      const y1 = a.top + a.height / 2 - box.top;
      const x2 = b.left - box.left;
      const y2 = b.top + b.height / 2 - box.top;
      const dx = Math.max(40, (x2 - x1) * 0.5);
      setThread(`M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`);
    });
    return () => cancelAnimationFrame(frame);
  }, [active, current, step, nEx, scale]);

  return (
    <div className={styles.wrap} ref={wrap} style={{ height: H * scale }}>
      <div className={styles.scene} style={{ width: W, height: H, transform: `scale(${scale})` }}>
        <div className={styles.stage}>
          {/* The response letter */}
          <article className={styles.letter}>
            <header className={styles.letterhead}>
              <div>
                <strong>Halden Ceramics</strong>
                <span>88 Kiln Row, Portland, OR</span>
              </div>
              <span className={styles.caseNo}>{head.id}</span>
            </header>
            <p className={styles.re}>
              Re: {head.reason.toLowerCase()}, {head.amount}
              {head.order ? `, order ${head.order}` : ""}
            </p>
            <div className={styles.body}>
              {step >= 0 && shownS === 0 && <p className={styles.reading}>{step < nEx ? "Gathering the records" : "Weighing the records"}</p>}
              {sentences.slice(0, shownS).map((s, i) => (
                <p key={`${run}-${i}`} className={`${styles.line} ${current === s ? styles.lineNow : ""}`}>
                  {s.text}
                  {s.cites.map((c) => (
                    <span
                      key={c}
                      ref={(el) => {
                        if (el) marks.current.set(`${i}-${c}`, el);
                      }}
                      className={styles.mark}
                      data-side={c === exhibits.find((e) => e.kind === "claim")?.id ? "claimant" : "respondent"}
                    >
                      {c}
                    </span>
                  ))}
                </p>
              ))}
            </div>
            <footer className={`${styles.verdict} ${showTally ? styles.on : ""}`}>
              <div className={styles.bar}>
                <span style={{ width: showTally ? `${brief.odds}%` : 0 }} />
              </div>
              <p>
                <b>{brief.recommendation === "offer" && brief.offerAmount ? `Offer ${usd(brief.offerAmount)}` : CALL[brief.recommendation]}</b>
                <span>{brief.odds}% for the seller</span>
              </p>
            </footer>
            <span className={styles.bates}>HC-000001</span>
            {stamped && (
              <div className={styles.stampAt}>
                <Stamp
                  key={run}
                  word={brief.recommendation === "accept" ? "REFUNDED" : "FILED"}
                  line={`WITH PAYPAL ${day(filedAt ?? brief.createdAt).toUpperCase()}`}
                />
              </div>
            )}
          </article>

          {/* The exhibits, a tabbed stack */}
          <div className={styles.stack}>
            {exhibits.slice(0, shownEx).map((e, i) => {
              const lifted = e.id === active;
              return (
                <article
                  key={`${run}-${e.id}`}
                  className={`${styles.page} ${lifted ? styles.lifted : ""}`}
                  data-side={e.kind === "claim" ? "claimant" : "respondent"}
                  style={{ top: i * 46, zIndex: lifted ? 50 : i }}
                >
                  <header
                    className={styles.tabRow}
                    ref={(el) => {
                      if (el) tabs.current.set(e.id, el);
                    }}
                  >
                    <span className={styles.tab}>{e.id}</span>
                    <h4>{e.title}</h4>
                  </header>
                  <dl>
                    {e.facts.slice(0, 4).map((f) => (
                      <div key={f.label}>
                        <dt>{f.label}</dt>
                        <dd>{f.value}</dd>
                      </div>
                    ))}
                  </dl>
                  {e.lines && e.lines.length > 0 && <p className={styles.pageLine}>{e.lines[e.lines.length - 1]}</p>}
                </article>
              );
            })}
          </div>
        </div>
      </div>
      <svg className={styles.thread} aria-hidden="true">
        {thread && <path key={`${run}-${step}`} d={thread} pathLength={1} />}
      </svg>
      {stamped && (
        <button
          className={styles.again}
          onClick={() => {
            setStep(-1);
            setRun((r) => r + 1);
          }}
        >
          Play it again
        </button>
      )}
    </div>
  );
}
