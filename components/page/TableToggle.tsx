"use client";

import { useState, type ReactNode } from "react";
import styles from "./page.module.css";

/**
 * A wide table that is open on a desktop and folded on a phone (640 px and under) behind "Show the table".
 * Which one shows is decided by CSS, not after hydration, so nothing jumps when the page loads; the button only
 * appears on a phone.
 */
export default function TableToggle({ children, what = "the table", note }: { children: ReactNode; what?: string; note?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={styles.toggle} data-open={open ? "true" : "false"}>
      <p className={styles.toggleBar}>
        <button type="button" className={styles.toggleButton} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? `Hide ${what}` : `Show ${what}`}
        </button>
        {note && <span>{note}</span>}
      </p>
      <div className={styles.toggleBody}>{children}</div>
    </div>
  );
}
