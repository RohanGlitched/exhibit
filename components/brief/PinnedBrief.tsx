"use client";

import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { BriefSentence, Exhibit, Recommendation, TallyItem } from "@/lib/cases/types";
import ExhibitCard, { sideOf } from "./ExhibitCard";
import Tally from "./Tally";
import styles from "./brief.module.css";

export interface Verdict {
  recommendation: Recommendation;
  odds: number;
  offerAmount?: string;
  headline: string;
  engine: "model" | "rules";
  model?: string;
  ms?: number;
}

interface Props {
  head: { id: string; reason: string; amount: string; due?: string | null; order?: string | null; buyer?: string | null };
  exhibits: Exhibit[];
  sentences: BriefSentence[];
  tally: TallyItem[];
  verdict: Verdict | null;
  status?: string | null;
  placeholder?: React.ReactNode; // shown in the sheet before the first sentence
  compact?: boolean; // the landing hero: shorter cards
  stamp?: React.ReactNode; // shown on the paper once something is filed
  below?: React.ReactNode; // under the paper, in the same column (the filing panel)
}

interface Thread {
  key: string;
  exhibit: string;
  sentence: number;
  d: string;
  side: "claimant" | "respondent";
  node: { x: number; y: number };
}

/**
 * The pinned brief: the response typesets itself on the sheet while each sentence's proof is pinned to it by
 * a routed thread running from the sheet's margin to the exhibit card on the rail. Hover either end to see
 * what depends on what. On narrow screens the rail folds away and each citation opens its exhibit inline.
 */
export default function PinnedBrief({ head, exhibits, sentences, tally, verdict, status, placeholder, compact, stamp, below }: Props) {
  const board = useRef<HTMLDivElement>(null);
  const sheet = useRef<HTMLElement>(null);
  const marks = useRef(new Map<string, HTMLElement>());
  const cards = useRef(new Map<string, HTMLElement>());
  const [threads, setThreads] = useState<Thread[]>([]);
  const [hoverExhibit, setHoverExhibit] = useState<string | null>(null);
  const [hoverSentence, setHoverSentence] = useState<number | null>(null);
  const [inline, setInline] = useState<{ s: number; e: string } | null>(null);
  const seen = useRef(new Set<string>());

  const layout = useCallback(() => {
    const b = board.current;
    const sh = sheet.current;
    if (!b || !sh || getComputedStyle(b).getPropertyValue("--threads").trim() !== "on") {
      setThreads([]);
      return;
    }
    const br = b.getBoundingClientRect();
    const edge = sh.getBoundingClientRect().right - br.left;
    const used = [...new Set(sentences.filter((s) => s.kept).flatMap((s) => s.cites))].sort();
    const out: Thread[] = [];
    sentences.forEach((s, si) => {
      if (!s.kept) return;
      for (const c of s.cites) {
        const m = marks.current.get(`${si}-${c}`);
        const card = cards.current.get(c);
        const ex = exhibits.find((e) => e.id === c);
        if (!m || !card || !ex) continue;
        const mr = m.getBoundingClientRect();
        const cr = card.getBoundingClientRect();
        const y1 = mr.top + mr.height / 2 - br.top;
        const x2 = cr.left - br.left;
        const y2 = cr.top - br.top + 21;
        const lane = edge + 16 + used.indexOf(c) * 5;
        const r = Math.min(7, Math.abs(y2 - y1) / 2);
        const dir = y2 >= y1 ? 1 : -1;
        const d =
          Math.abs(y2 - y1) < 1
            ? `M ${edge} ${y1} H ${x2}`
            : `M ${edge} ${y1} H ${lane - r} Q ${lane} ${y1} ${lane} ${y1 + dir * r} V ${y2 - dir * r} Q ${lane} ${y2} ${lane + r} ${y2} H ${x2}`;
        out.push({ key: `${si}-${c}`, exhibit: c, sentence: si, d, side: sideOf(ex), node: { x: edge, y: y1 } });
      }
    });
    setThreads(out);
  }, [sentences, exhibits]);

  useLayoutEffect(layout, [layout]);
  useEffect(() => {
    const b = board.current;
    if (!b) return;
    const ro = new ResizeObserver(() => layout());
    ro.observe(b);
    window.addEventListener("resize", layout);
    document.fonts?.ready.then(layout).catch(() => {});
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", layout);
    };
  }, [layout]);

  useEffect(() => {
    const id = requestAnimationFrame(() => threads.forEach((t) => seen.current.add(t.key)));
    return () => cancelAnimationFrame(id);
  }, [threads]);

  const citedBy = (exhibitId: string) => sentences.some((s, i) => s.kept && s.cites.includes(exhibitId) && (hoverSentence === null || hoverSentence === i));
  const lit = (t: Thread) => (hoverExhibit ? t.exhibit === hoverExhibit : hoverSentence !== null ? t.sentence === hoverSentence : false);
  const anyHover = hoverExhibit !== null || hoverSentence !== null;

  return (
    <div className={`${styles.board} ${compact ? styles.compact : ""}`} ref={board}>
      <div className={styles.column}>
      <article className={`sheet ${styles.paper}`} ref={sheet as React.RefObject<HTMLElement>}>
        <header className={styles.paperHead}>
          {stamp && <div className={styles.stampSlot}>{stamp}</div>}
          <p className={styles.caseLine}>
            <span className="bates">{head.id}</span>
            <span>{head.reason}</span>
            <span>{head.amount}</span>
          </p>
          {(head.order || head.buyer) && (
            <p className={styles.caseSub}>
              {head.buyer ? `${head.buyer}` : ""}
              {head.order ? `${head.buyer ? ", store order " : "Store order "}${head.order}` : ""}
            </p>
          )}
        </header>

        <div className={`serif ${styles.text}`} aria-live="polite">
          {sentences.length === 0 && placeholder}
          {sentences.map((s, si) => (
            <Fragment key={si}>
              <p
                className={`${styles.sentence} ${s.kept ? "" : styles.struck} ${hoverSentence === si ? styles.sentenceLit : ""} ${
                  hoverExhibit && s.kept && s.cites.includes(hoverExhibit) ? styles.sentenceLit : ""
                } ${anyHover && !(hoverSentence === si || (hoverExhibit && s.cites.includes(hoverExhibit))) ? styles.sentenceDim : ""}`}
                onMouseEnter={() => s.kept && setHoverSentence(si)}
                onMouseLeave={() => setHoverSentence(null)}
              >
                <span className={styles.sentenceText}>{s.text}</span>
                {s.cites.map((c) => {
                  const ex = exhibits.find((e) => e.id === c);
                  return (
                    <button
                      key={c}
                      type="button"
                      className={styles.mark}
                      data-side={ex ? sideOf(ex) : "respondent"}
                      ref={(el) => {
                        if (el) marks.current.set(`${si}-${c}`, el);
                        else marks.current.delete(`${si}-${c}`);
                      }}
                      onClick={() => setInline((cur) => (cur?.s === si && cur.e === c ? null : { s: si, e: c }))}
                      aria-expanded={inline?.s === si && inline.e === c}
                      aria-label={`Exhibit ${c}${ex ? `: ${ex.title}` : ""}`}
                    >
                      {c}
                    </button>
                  );
                })}
              </p>
              {!s.kept && <p className={styles.strikeNote}>Struck before filing: {s.why}</p>}
              {inline?.s === si && (
                <div className={styles.inlineCard}>
                  {exhibits.filter((e) => e.id === inline.e).map((e) => (
                    <ExhibitCard key={e.id} exhibit={e} full />
                  ))}
                </div>
              )}
            </Fragment>
          ))}
          {status && <p className={styles.working}>{status}</p>}
        </div>

        {(tally.length > 0 || verdict) && <Tally tally={tally} verdict={verdict} amount={head.amount} />}
      </article>
      {below}
      </div>

      <svg className={styles.threads} aria-hidden="true">
        {threads.map((t) => (
          <g key={t.key} className={`${styles.thread} ${lit(t) ? styles.threadLit : ""} ${anyHover && !lit(t) ? styles.threadDim : ""}`} data-side={t.side}>
            <path d={t.d} pathLength={1} className={seen.current.has(t.key) ? "" : styles.draw} />
            <circle cx={t.node.x} cy={t.node.y} r={3} />
          </g>
        ))}
      </svg>

      <aside className={styles.rail} aria-label="Exhibits">
        {exhibits.map((e) => (
          <ExhibitCard
            key={e.id}
            exhibit={e}
            fresh
            active={hoverExhibit === e.id || (hoverSentence !== null && sentences[hoverSentence]?.cites.includes(e.id))}
            dim={anyHover && !(hoverExhibit === e.id || (hoverSentence !== null && citedBy(e.id)))}
            onEnter={() => setHoverExhibit(e.id)}
            onLeave={() => setHoverExhibit(null)}
            cardRef={(el) => {
              if (el) cards.current.set(e.id, el);
              else cards.current.delete(e.id);
            }}
          />
        ))}
      </aside>
    </div>
  );
}
