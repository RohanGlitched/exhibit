import Link from "next/link";
import { REPO_URL } from "@/lib/site";
import styles from "./chrome.module.css";

export default function Footer() {
  return (
    <footer className={styles.footer}>
      <div className={`shell ${styles.footRow}`}>
        <p>
          Exhibit runs on the PayPal sandbox: real Orders, Payments, Tracking and Disputes API calls, with test money. The shop, Halden Ceramics,
          is fictional, and so are its buyers.
        </p>
        <nav aria-label="Footer">
          <Link href="/desk">Desk</Link>
          <Link href="/new">Open a case</Link>
          <a href={REPO_URL}>Source code</a>
        </nav>
      </div>
    </footer>
  );
}
