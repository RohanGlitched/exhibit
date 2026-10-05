"use client";

import { useEffect, useRef, useState } from "react";
import PinnedBrief from "@/components/brief/PinnedBrief";
import type { Brief, Exhibit } from "@/lib/cases/types";
import styles from "@/app/home.module.css";

interface Props {
  head: { id: string; reason: string; amount: string; buyer?: string | null; order?: string | null };
  exhibits: Exhibit[];
  brief: Brief;
}

/**
 * Replays a real argued case: the exhibits arrive, then the sentences, then the tally, at the pace the live
 * argument streams. Starts when it scrolls into view; reduced motion shows the finished brief at once.
 */
export default function HeroReplay({ head, exhibits, brief }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(0);
  const [run, setRun] = useState(0);
  const total = exhibits.length + brief.sentences.length + brief.tally.length + 1;

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setStep(total);
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    let started = false;
    const tick = (s: number) => {
      setStep(s);
      if (s >= total) return;
      const inSentences = s >= exhibits.length && s < exhibits.length + brief.sentences.length;
      timer = setTimeout(() => tick(s + 1), s === 0 ? 500 : inSentences ? 900 : 160);
    };
    const io = new IntersectionObserver(
      (es) => {
        if (es.some((e) => e.isIntersecting) && !started) {
          started = true;
          tick(0);
        }
      },
      { threshold: 0.25 },
    );
    if (box.current) io.observe(box.current);
    return () => {
      io.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, [run, total, exhibits.length, brief.sentences.length]);

  const ex = exhibits.slice(0, Math.min(step, exhibits.length));
  const sCount = Math.max(0, Math.min(brief.sentences.length, step - exhibits.length));
  const tCount = Math.max(0, Math.min(brief.tally.length, step - exhibits.length - brief.sentences.length));
  const done = step >= total;
  const status = step === 0 ? null : step <= exhibits.length ? "Gathering the records" : sCount === 0 ? "Weighing the records" : null;

  return (
    <div ref={box} className={styles.replay}>
      <PinnedBrief
        head={head}
        exhibits={ex}
        sentences={brief.sentences.slice(0, sCount)}
        tally={brief.tally.slice(0, tCount)}
        verdict={done ? { recommendation: brief.recommendation, odds: brief.odds, offerAmount: brief.offerAmount, headline: brief.headline, engine: brief.engine, model: brief.model, ms: brief.ms } : null}
        status={done ? null : status}
        compact
      />
      {done && (
        <button
          className={styles.replayBtn}
          onClick={() => {
            setStep(0);
            setRun((r) => r + 1);
          }}
        >
          Play it again
        </button>
      )}
    </div>
  );
}
