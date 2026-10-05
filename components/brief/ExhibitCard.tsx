"use client";

import { useState } from "react";
import type { Exhibit } from "@/lib/cases/types";
import styles from "./brief.module.css";

export const sideOf = (e: Pick<Exhibit, "kind">) => (e.kind === "claim" ? "claimant" : "respondent");

interface Props {
  exhibit: Exhibit;
  active?: boolean;
  dim?: boolean;
  full?: boolean;
  fresh?: boolean;
  onEnter?: () => void;
  onLeave?: () => void;
  cardRef?: (el: HTMLElement | null) => void;
}

/** One exhibit, as a sticker-tabbed card: what it is, its key facts, where it came from. */
export default function ExhibitCard({ exhibit: e, active, dim, full, fresh, onEnter, onLeave, cardRef }: Props) {
  const [open, setOpen] = useState(false);
  const all = full || open;
  const facts = all ? e.facts : e.facts.slice(0, 3);
  const lines = all ? e.lines ?? [] : (e.lines ?? []).slice(-(e.kind === "scans" ? 2 : 1));
  return (
    <article
      ref={cardRef}
      className={`${styles.card} ${active ? styles.cardActive : ""} ${dim ? styles.cardDim : ""} ${fresh ? styles.cardFresh : ""}`}
      data-side={sideOf(e)}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onFocus={onEnter}
      onBlur={onLeave}
      tabIndex={0}
      aria-label={`Exhibit ${e.id}: ${e.title}`}
    >
      <header className={styles.cardHead}>
        <span className={styles.sticker} aria-hidden="true">
          {e.id}
        </span>
        <h4>{e.title}</h4>
      </header>
      {facts.length > 0 && (
        <dl className={styles.facts}>
          {facts.map((f) => (
            <div key={f.label}>
              <dt>{f.label}</dt>
              <dd>{f.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {lines.length > 0 && (
        <ul className={`${styles.lines} ${e.kind === "scans" ? styles.scanLines : ""}`}>
          {lines.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      )}
      {all && <p className={styles.source}>{e.source}</p>}
      {e.sandbox && all && <p className={styles.sandbox}>{e.sandbox}</p>}
      {!full && (
        <button type="button" className={styles.more} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? "Show less" : "Show the full record"}
        </button>
      )}
    </article>
  );
}
