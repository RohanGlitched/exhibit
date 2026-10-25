import { outcomeWords, statusWords, utcStamp, type WebhookView } from "@/lib/webhooks/paypal";
import styles from "./WebhookLine.module.css";

/** One line on the case page: when PayPal's webhook delivered the case, and how soon Exhibit argued it. */
export default function WebhookLine({ webhook }: { webhook: WebhookView | null | undefined }) {
  if (!webhook) return null;
  const { receivedAt, seconds, engine, current, last } = webhook;
  const by = engine === "model" ? "the model" : "the rules engine";
  return (
    <p className={styles.line} role="note">
      <span className={styles.tag}>Webhook</span>
      {receivedAt && seconds !== null && (
        <span>
          <strong>
            Received from PayPal at {utcStamp(receivedAt)}, argued {seconds} s later.
          </strong>{" "}
          {current
            ? `PayPal announced this chargeback and Exhibit wrote the brief below with ${by} before anyone opened the case.`
            : `Exhibit wrote a first brief with ${by}; the one below was argued again since.`}
        </span>
      )}
      {last && last.type !== "CUSTOMER.DISPUTE.CREATED" && (
        <span className={styles.last}>
          Latest update from PayPal at {utcStamp(last.receivedAt)}: {statusWords(last.status)}
          {last.outcome ? `, ${outcomeWords(last.outcome)}` : ""}.
        </span>
      )}
    </p>
  );
}
