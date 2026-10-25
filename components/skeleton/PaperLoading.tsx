import styles from "./skeleton.module.css";

/**
 * What a case or the desk shows while the server reads PayPal (two to three seconds on a cold case): the sheet
 * it is about to fill, ruled like the paper, with a line saying what is being read.
 */
export default function PaperLoading({ label, lines = 9 }: { label: string; lines?: number }) {
  return (
    <main className={`shell ${styles.page}`} aria-busy="true">
      <p className={`bates ${styles.label}`} role="status">
        {label}
      </p>
      <div className={`sheet ${styles.sheet}`}>
        {Array.from({ length: lines }, (_, i) => (
          <span key={i} className={styles.line} style={{ width: `${92 - ((i * 37) % 30)}%` }} />
        ))}
      </div>
    </main>
  );
}
