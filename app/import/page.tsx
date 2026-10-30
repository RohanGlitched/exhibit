import type { Metadata } from "next";
import Link from "next/link";
import ImportDesk from "@/components/import/ImportDesk";
import styles from "@/components/import/import.module.css";

export const metadata: Metadata = {
  title: "Bring your own case",
  description:
    "Paste an order, its tracking and the emails with the buyer. Exhibit letters the exhibits, marks what the card network asks for, and writes a checked brief. It never files anything and never calls PayPal.",
};

/**
 * What each reason needs, by network. Amex's codes are Amex's own (C08, C31, F29, P08). `protection` is what
 * PayPal's Seller Protection adds on top, which is PayPal's rule, not the card network's.
 */
const NEEDS: { reason: string; codes: string; reads: string; protection?: string; paste: string }[] = [
  {
    reason: "Not received",
    codes: "Visa 13.1 · Mastercard 4853 · Amex C08",
    reads: "Carrier and tracking number, a delivered scan with its date, delivery in the ship-to ZIP",
    protection: "Signed proof of delivery on orders over $750",
    paste: "The carrier's scan history, any signature, and the ship-to address with its ZIP",
  },
  {
    reason: "Not as described",
    codes: "Visa 13.3 · Mastercard 4853 · Amex C31",
    reads: "The listing as sold, words that disclose the difference, a return offered under your policy",
    paste: "The listing text, your return policy, and the emails where you offered a return",
  },
  {
    reason: "Unauthorised",
    codes: "Visa 10.4 · Mastercard 4837 · Amex F29",
    reads: "Address and security-code checks, two earlier undisputed orders, a matching device or IP, delivery to the cardholder",
    paste: "The AVS and CVV results, the billing address, and this customer's earlier orders",
  },
  {
    reason: "Charged twice",
    codes: "Visa 12.6.1 · Mastercard 4834 · Amex P08",
    reads: "A credit on the duplicate, or two distinct transactions",
    paste: "The refund id and amount, or the second charge's transaction id",
  },
];

export default function ImportPage() {
  return (
    <main className={`shell ${styles.page}`}>
      <header className={styles.head}>
        <div>
          <p className={styles.kicker}>Bring your own case</p>
          <h1>Paste a dispute from your own store</h1>
          <p className={styles.lead}>
            Paste the order, the tracking and the emails with the buyer. Exhibit letters them as exhibits, marks what the card network asks for on
            that reason code, and writes a response in which every figure and name is checked against the exhibit it cites.
          </p>
        </div>
        <ul className={`sheet ${styles.promise}`} aria-label="What this page does and doesn't do">
          <li>
            <span aria-hidden="true">✓</span>
            <div>
              <strong>Builds the case from your paste</strong> with the same exhibits, requirements card and checker as a sandbox case.
            </div>
          </li>
          <li>
            <span aria-hidden="true">✓</span>
            <div>
              <strong>Argues it with GPT-5.6</strong> while your share of the model budget lasts, then with the rules engine.
            </div>
          </li>
          <li data-no>
            <span aria-hidden="true">✕</span>
            <div>
              <strong>Never files and never calls PayPal.</strong> You copy the response into PayPal&apos;s Resolution Center yourself.
            </div>
          </li>
          <li data-no>
            <span aria-hidden="true">✕</span>
            <div>
              <strong>Stores nothing.</strong> Your paste is read for this one brief and dropped.
            </div>
          </li>
        </ul>
      </header>

      <ImportDesk />

      <section className={styles.explain} aria-labelledby="needs-title">
        <h2 id="needs-title" className={styles.sectionTitle}>
          What each reason code needs from your paste
        </h2>
        <p className={styles.explainLead}>
          The requirements card reads the exhibits by code, never by the model, and marks each item on file, weak or missing. Paste what the right-hand
          column names and the card has something to find. Amex cases are labelled with Amex&apos;s own reason codes; the card marks the same evidence
          for them, as Exhibit doesn&apos;t model Amex&apos;s rules item by item.
        </p>
        <div className={`sheet ${styles.tableWrap}`}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Reason</th>
                <th scope="col">What the network asks for</th>
                <th scope="col">What to paste</th>
              </tr>
            </thead>
            <tbody>
              {NEEDS.map((n) => (
                <tr key={n.reason}>
                  <th scope="row">
                    {n.reason}
                    <small>{n.codes}</small>
                  </th>
                  <td>
                    {n.reads}
                    {n.protection && (
                      <span className={styles.protection}>
                        <strong>PayPal Seller Protection, not the network:</strong> {n.protection.charAt(0).toLowerCase() + n.protection.slice(1)}
                      </span>
                    )}
                  </td>
                  <td>{n.paste}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.explain} aria-labelledby="how-title">
        <h2 id="how-title" className={styles.sectionTitle}>
          How a paste becomes a brief
        </h2>
        <ol className={styles.how}>
          <li className="sheet">
            <span className={styles.sticker}>A</span>
            <h3>Read</h3>
            <p>
              Dates, amounts, items, scans and emails are read into the forms the exhibits use, like 6 Oct 2026, 14:14 and $62.00. Scans and emails
              pasted newest first are put oldest first, and anything Exhibit couldn&apos;t read is named.
            </p>
          </li>
          <li className="sheet">
            <span className={styles.sticker}>B</span>
            <h3>Letter</h3>
            <p>
              The claim, the order, the tracking, the scans, the emails and any listing, policy or notes each become an exhibit, marked as from your
              paste. The emails are evidence; an instruction written in one is not followed.
            </p>
          </li>
          <li className="sheet">
            <span className={styles.sticker}>C</span>
            <h3>Mark</h3>
            <p>
              The requirements card for the network and reason code marks each item on file, weak or missing. A tracking number you say is on the PayPal
              transaction counts as on file, on your word.
            </p>
          </li>
          <li className="sheet">
            <span className={styles.sticker}>D</span>
            <h3>Check</h3>
            <p>
              Each sentence of the brief cites exhibits. Any figure or name that isn&apos;t in what it cites is struck, as on every sandbox case. The model
              gets one try to re-cite a struck sentence.
            </p>
          </li>
        </ol>
      </section>

      <section className={styles.explain} aria-labelledby="limits-title">
        <h2 id="limits-title" className={styles.sectionTitle}>
          Limits, so it stays honest
        </h2>
        <ul className={styles.limits}>
          <li>
            <strong>Your word, not PayPal&apos;s record.</strong> A sandbox case reads the order, payment and tracking from PayPal&apos;s APIs. A pasted case
            can only be as true as the paste, so a brief here checks that each sentence matches what you pasted, not that what you pasted is true.
          </li>
          <li>
            <strong>US dollars, one order.</strong> Amounts are read as USD, and an export holding several orders is read for its first one.
          </li>
          <li>
            <strong>Sizes.</strong> Up to 40 scan lines, 30 emails (12,000 characters) and 20 items. Twelve builds per ten minutes from one place.
          </li>
          <li>
            <strong>Never a full card number.</strong> The form takes the last four digits only, and the page never asks for a password or a PayPal login.
          </li>
        </ul>
        <p className={styles.explainLead}>
          Want the whole loop with real PayPal records, a filing and an outcome? <Link href="/new">Open a sandbox case</Link> against the demo shop, or
          read <Link href="/proof">what was measured</Link>.
        </p>
      </section>
    </main>
  );
}
