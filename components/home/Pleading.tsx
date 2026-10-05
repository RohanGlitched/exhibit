import styles from "./home-art.module.css";

/**
 * Pleading paper: the ruled sheet with numbered lines and a double red rule down the left margin that court
 * filings are typed on. Children are set on a 28px rhythm so the lines fall on the ruling.
 */
export default function Pleading({ lines, children, className = "" }: { lines: number; children: React.ReactNode; className?: string }) {
  return (
    <div className={`sheet ${styles.pleading} ${className}`} style={{ "--lines": lines } as React.CSSProperties}>
      <ol className={styles.lineNos} aria-hidden="true">
        {Array.from({ length: lines }, (_, i) => (
          <li key={i}>{i + 1}</li>
        ))}
      </ol>
      <div className={styles.pleadBody}>{children}</div>
    </div>
  );
}
