"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./page.module.css";

export interface IndexItem {
  id: string;
  label: string;
}

/** How far below the viewport's top a section has to reach to count as the one being read: the header and this bar. */
const READ_LINE = 140;

/**
 * A sticky index of a long page's sections, as a row of chips under the site header. The chip for the section
 * being read is marked, and the row scrolls sideways inside itself to keep it in view, so the page never
 * scrolls sideways. Each chip is an ordinary link to the section's anchor, so it works before hydration too.
 * `inShell`: the page's main is already a .shell; the bar's band still runs the full width.
 */
export default function SectionIndex({ items, label = "On this page", inShell = false }: { items: IndexItem[]; label?: string; inShell?: boolean }) {
  const [current, setCurrent] = useState<string | null>(null);
  const row = useRef<HTMLOListElement>(null);

  useEffect(() => {
    let frame = 0;
    const read = () => {
      frame = 0;
      let at: string | null = null;
      for (const it of items) {
        const el = document.getElementById(it.id);
        if (el && el.getBoundingClientRect().top <= READ_LINE) at = it.id;
      }
      setCurrent(at);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(read);
    };
    read();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [items]);

  // Keep the current chip in view inside the row, without moving the page.
  useEffect(() => {
    const list = row.current;
    const chip = current ? list?.querySelector<HTMLElement>(`[data-id="${current}"]`) : null;
    if (!list || !chip) return;
    const left = chip.offsetLeft - list.offsetLeft;
    if (left < list.scrollLeft || left + chip.offsetWidth > list.scrollLeft + list.clientWidth) {
      list.scrollTo({ left: Math.max(0, left - 16), behavior: "smooth" });
    }
  }, [current]);

  if (items.length < 2) return null;
  return (
    <nav className={styles.index} data-in-shell={inShell ? "true" : undefined} aria-label={label}>
      <div className={inShell ? styles.indexInner : `shell ${styles.indexInner}`}>
        <span className={styles.indexLabel}>{label}</span>
        <ol ref={row} className={styles.chips}>
          {items.map((it) => (
            <li key={it.id}>
              <a href={`#${it.id}`} data-id={it.id} className={styles.chip} aria-current={current === it.id ? "location" : undefined}>
                {it.label}
              </a>
            </li>
          ))}
        </ol>
      </div>
    </nav>
  );
}
