"use client";

import dynamic from "next/dynamic";
import styles from "./studio.module.css";

/** AG Studio runs only in the browser, and its bundle loads only on the analytics page. */
const ExhibitStudio = dynamic(() => import("./ExhibitStudio"), {
  ssr: false,
  loading: () => (
    <div className={styles.frame}>
      <div className={styles.placeholder}>
        <p>Laying out the report…</p>
      </div>
    </div>
  ),
});

export default function StudioLoader() {
  return <ExhibitStudio />;
}
