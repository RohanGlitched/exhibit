import Link from "next/link";
import Mark from "./Mark";
import { REPO_URL, VIDEO_URL } from "@/lib/site";
import styles from "./chrome.module.css";

const TRY: { href: string; label: string; note: string; external?: boolean }[] = [
  { href: "/new", label: "Open a sandbox case", note: "a real sandbox chargeback, yours to argue" },
  { href: "/import", label: "Bring your own case", note: "paste an order, tracking and emails; never filed" },
  { href: "/desk", label: "The desk", note: "every dispute on the account" },
  { href: "/desk/analytics", label: "Analytics", note: "the desk in AG Studio" },
  { href: "/proof", label: "Proof", note: "what was measured, and how" },
  { href: "/api/mcp", label: "MCP server", note: "/api/mcp, for any MCP client", external: true },
];

// Named as PayPal's docs name them. Tracking is the Orders v2 track call, not the separate Tracking API.
const APIS: { name: string; calls: string }[] = [
  { name: "Orders v2", calls: "create and read orders; tracking through /v2/checkout/orders/{id}/track" },
  { name: "Payments v2", calls: "captures and refunds" },
  { name: "Disputes v1", calls: "read, provide-evidence, accept-claim, adjudicate (sandbox only), and the filed documents" },
  { name: "Webhooks", calls: "dispute events, each checked with verify-webhook-signature" },
  { name: "Sandbox chargeback simulator", calls: "the card issuer's chargeback, with Visa and Mastercard reason codes" },
];

/** Every page ends here: what to try, which PayPal APIs and which model it runs on, the source, the team, and what is simulated. */
export default function Footer() {
  return (
    <footer className={styles.footer}>
      <div className={`shell ${styles.footGrid}`}>
        <div className={styles.footBrand}>
          <p className={styles.footName}>
            <Mark />
            <span>Exhibit</span>
          </p>
          <p>
            The dispute desk for small PayPal sellers: it argues each case from the records, checks every figure and name against the record it cites,
            and files with PayPal, or refunds when the seller would lose.
          </p>
          <p className={styles.footTeam}>Built by Rohan Borade and Aatmaja</p>
        </div>

        <nav className={styles.footCol} aria-label="Try it">
          <h2>Try it</h2>
          <ul>
            {TRY.map((t) => (
              <li key={t.href}>
                {t.external ? <a href={t.href}>{t.label}</a> : <Link href={t.href}>{t.label}</Link>}
                <small>{t.note}</small>
              </li>
            ))}
          </ul>
        </nav>

        <div className={styles.footCol}>
          <h2>PayPal APIs used</h2>
          <ul>
            {APIS.map((a) => (
              <li key={a.name}>
                <strong>{a.name}</strong>
                <small>{a.calls}</small>
              </li>
            ))}
          </ul>
        </div>

        <div className={styles.footCol}>
          <h2>Model</h2>
          <ul>
            <li>
              <strong>GPT-5.6 on Azure OpenAI</strong>
              <small>writes the briefs, plays the simulated reviewer, and runs the analyst; live</small>
            </li>
            <li>
              <strong>Claude Haiku 4.5 on Amazon Bedrock</strong>
              <small>wired in behind the same interface; ready, not used live</small>
            </li>
            <li>
              <strong>The checker</strong>
              <small>plain code on Exhibit&apos;s server, no model</small>
            </li>
          </ul>
        </div>

        <nav className={styles.footCol} aria-label="Source">
          <h2>Source</h2>
          <ul>
            <li>
              <a href={REPO_URL}>Code on GitHub</a>
              <small>MIT licence</small>
            </li>
            <li>
              <a href={VIDEO_URL}>Demo video</a>
              <small>under three minutes</small>
            </li>
            <li>
              <a href="/api/health">Health</a>
              <small>pool, PayPal, model and webhooks, live</small>
            </li>
          </ul>
        </nav>
      </div>
      <div className={`shell ${styles.footNote}`}>
        <p>
          Everything runs in PayPal&apos;s sandbox: real API calls, test money. The shop, Halden Ceramics, is fictional, and so are its buyers. Nobody at
          PayPal reads sandbox evidence, so the reviewer on each case is simulated. A hackathon entry, not a PayPal product.
        </p>
      </div>
    </footer>
  );
}
