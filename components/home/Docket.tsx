import Pleading from "./Pleading";
import styles from "./home-art.module.css";

const CALLS: { when: string; method: string; path: string; does: string }[] = [
  { when: "Opening", method: "POST", path: "/v2/checkout/orders", does: "The buyer pays the shop by card: one call with intent CAPTURE, returns COMPLETED." },
  { when: "Opening", method: "POST", path: "/v2/checkout/orders/{id}/track", does: "The shop adds the carrier and tracking number to the order." },
  { when: "Opening", method: "POST", path: "/v2/payments/captures/{id}/refund", does: "“Charged twice” only: the duplicate charge is refunded in full, a real refund." },
  { when: "Opening", method: "POST", path: "/v2/customer-support/process-chargeback", does: "The card issuer files a chargeback (sandbox simulator, Visa and Mastercard reason codes)." },
  { when: "Reading", method: "GET", path: "/v1/customer/disputes", does: "The desk: every case on the account, soonest deadline first." },
  { when: "Reading", method: "GET", path: "/v1/customer/disputes/{id}", does: "Reason, amount, stage, deadline, and the links that say what PayPal will accept now." },
  { when: "Reading", method: "GET", path: "/v2/checkout/orders/{id}", does: "Items, ship-to address and trackers: Exhibits B and D." },
  { when: "Reading", method: "GET", path: "/v2/payments/captures/{id}", does: "Amount, fees, and the issuer's address and security-code checks: Exhibit C." },
  { when: "Reading", method: "GET", path: "/v2/payments/refunds/{id}", does: "A refund already made, as an exhibit of its own." },
  { when: "Filing", method: "POST", path: "/v1/customer/disputes/{id}/provide-evidence", does: "The response, tracking or refund details, and the Bates-stamped PDF, in one multipart call." },
  { when: "Filing", method: "POST", path: "/v1/customer/disputes/{id}/accept-claim", does: "A full refund when the records point the buyer's way." },
  { when: "Filing", method: "POST", path: "/v1/customer/disputes/{id}/adjudicate", does: "Sandbox only: ask PayPal's simulator for a ruling once the case is under review." },
];

/** Every PayPal call Exhibit makes, typed on pleading paper. */
export default function Docket() {
  return (
    <Pleading lines={CALLS.length * 2 + 1} className={styles.docket}>
      <ol className={styles.calls}>
        {CALLS.map((c, i) => (
          <li key={c.path} data-first={i === 0 || CALLS[i - 1].when !== c.when}>
            <span className={styles.when}>{c.when}</span>
            <span className={styles.path}>
              <b>{c.method}</b> {c.path}
            </span>
            <span className={styles.does}>{c.does}</span>
          </li>
        ))}
      </ol>
    </Pleading>
  );
}
