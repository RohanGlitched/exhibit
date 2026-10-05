"use client";

import Link from "next/link";
import { useState } from "react";
import HeroReplay from "@/components/HeroReplay";
import type { Brief, Exhibit } from "@/lib/cases/types";
import { day } from "@/lib/format";
import CaseFile from "./CaseFile";
import styles from "./stage.module.css";

interface Props {
  head: { id: string; reason: string; amount: string; buyer: string | null; order: string | null };
  exhibits: Exhibit[];
  brief: Brief;
  filedAt: string | null;
}

const PHASES = [
  { title: "Read the case", detail: "Disputes API" },
  { title: "Gather the records", detail: "Orders, Payments, tracking, store" },
  { title: "Argue it", detail: "One sentence, one record" },
  { title: "Check every figure", detail: "Struck if it isn't in the exhibit" },
  { title: "File it with PayPal", detail: "Evidence and a Bates-stamped PDF" },
];

/** The landing's stage: a real case argued on a dark desk, with the steps lighting up beside it. */
export default function HomeStage({ head, exhibits, brief, filedAt }: Props) {
  const [phase, setPhase] = useState(-1);
  const kept = brief.sentences.filter((s) => s.kept).length;
  return (
    <section className={styles.stage} aria-label="A real case, argued">
      <div className={styles.side}>
        <p className={styles.live}>
          <span className={styles.dot} />
          Real sandbox case
        </p>
        <p className={styles.caseId}>{head.id}</p>
        <p className={styles.meta}>
          {head.reason}, {head.amount}
          {head.buyer ? `, ${head.buyer}` : ""}
        </p>
        <ol className={styles.phases}>
          {PHASES.map((p, i) => (
            <li key={p.title} data-state={i < phase ? "done" : i === phase ? "now" : "next"}>
              <span className={styles.num}>{i + 1}</span>
              <span>
                <strong>{p.title}</strong>
                <em>{p.detail}</em>
              </span>
            </li>
          ))}
        </ol>
        <p className={styles.facts}>
          {exhibits.length} exhibits, {kept} sentences, {brief.sentences.length - kept} struck.{" "}
          {brief.engine === "model" ? `Argued by ${brief.model}` : "Argued by the rules engine"}
          {filedAt ? `, filed ${day(filedAt)}.` : "."}
        </p>
        <Link href={`/case/${head.id}`} className={styles.open}>
          Open this case
        </Link>
      </div>
      <div className={styles.desk}>
        <CaseFile head={head} exhibits={exhibits} brief={brief} filedAt={filedAt} onPhase={setPhase} />
      </div>
      <div className={styles.narrow}>
        <HeroReplay head={head} exhibits={exhibits} brief={brief} />
      </div>
    </section>
  );
}
