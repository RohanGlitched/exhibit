import Link from "next/link";
import Mark from "./Mark";
import styles from "./chrome.module.css";

export default function Header() {
  return (
    <header className={styles.header}>
      <div className={`shell ${styles.bar}`}>
        <Link href="/" className={styles.brand} aria-label="Exhibit, home">
          <Mark />
          <span>Exhibit</span>
        </Link>
        <nav className={styles.nav} aria-label="Main">
          <Link href="/desk">Desk</Link>
          <Link href="/#how" className={styles.hideSm}>
            How it works
          </Link>
          <Link href="/new" className={`btn btnPrimary ${styles.cta}`}>
            Open a sandbox case
          </Link>
        </nav>
      </div>
    </header>
  );
}
