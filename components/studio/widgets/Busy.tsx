import styles from "./widgets.module.css";

/**
 * What a widget shows while Studio's data engine answers its first query: ruled lines on the paper, the way
 * the desk and the case pages load, instead of a blank card. Always an element, never null: Studio attaches a
 * React widget only once it has drawn something.
 */
export default function Busy({ lines = 5 }: { lines?: number }) {
  return (
    <div className={`${styles.paper} ${styles.busy}`} aria-busy="true" aria-label="Loading">
      {Array.from({ length: lines }, (_, i) => (
        <span key={i} className={styles.busyLine} style={{ width: `${88 - ((i * 29) % 34)}%` }} />
      ))}
    </div>
  );
}
