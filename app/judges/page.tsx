import type { Metadata } from "next";
import Link from "next/link";
import styles from "./judges.module.css";

export const metadata: Metadata = {
  title: "For judges: Exhibit in 90 seconds",
  description: "Three clicks through real PayPal sandbox cases: a hearing that keeps an answer, a hearing that changes a draft, and PayPal's Agent Toolkit writing on the seller's lane.",
};

// Each step opens a real case at the part that shows it. These cases are read-only for public writes through judging.
const STEPS = [
  {
    href: "/case/PP-R-HWG-10195220#hearing-20261029T233420",
    title: "A hearing keeps an answer",
    case: "PP-R-HWG-10195220, not as described, $136",
    body: "A second model plays PayPal's reviewer on the PDF PayPal holds. It objected that the listing didn't cover the buyer's complaint. Exhibit answered from the listing and the buyer's email, the checker kept the answer, and the objection was overruled. PayPal then ruled for the seller at Exhibit's request.",
    look: "Look for the red OBJECTION stamp, the answer with its exhibit marks, and the green OVERRULED.",
    time: "30 s",
  },
  {
    href: "/case/PP-R-IPX-10195230#hearing-20261030T005522",
    title: "A hearing changes a draft before PayPal sees it",
    case: "PP-R-IPX-10195230, an AI agent's purchase, $180",
    body: "Every sentence of this draft cited a record, and the checker passed them all. A tool that only cites would have filed it. At the hearing on the draft, the reviewer asked what evidence the card networks recognise. Exhibit withdrew the two sentences that leaned on the agent's mandate, and filed on the earlier orders from the same device instead.",
    look: "Look for the SUSTAINED objections and 'Withdrawn before filing: sentence 4, 5'.",
    time: "30 s",
  },
  {
    href: "/case/PP-R-DNN-10195228#autopilot",
    title: "PayPal's Agent Toolkit writes on the seller's lane",
    case: "PP-R-DNN-10195228, not received, $27",
    body: "PayPal's webhook arrived and the autopilot argued the case seconds later, read it through PayPal's Agent Toolkit, held a hearing, and refunded it under a written house rule through the toolkit's accept_dispute_claim, after a ten-minute undo window.",
    look: "Look for the audit line 'Accepted the claim through PayPal's Agent Toolkit (accept_dispute_claim)'.",
    time: "30 s",
  },
];

const MORE = [
  { href: "/new", title: "Open your own case", body: "A real sandbox chargeback in one click; every action works on it." },
  { href: "/proof", title: "What was measured", body: "55 of 56 labelled runs, 16 of 18 held-out free-text runs, and what it doesn't show." },
  { href: "/desk", title: "The desk", body: "Every dispute on the shop's sandbox account, and who decided each outcome." },
  { href: "/case/PP-R-YAC-10195241#autopilot", title: "An agent purchase, no human step", body: "Filed 14 minutes after PayPal's webhook; 2 of 2 hearings for the seller." },
];

export default function Judges() {
  return (
    <main className={`shell ${styles.page}`}>
      <header className={styles.head}>
        <p className="bates">For judges</p>
        <h1>Exhibit in three clicks, about 90 seconds.</h1>
        <p>
          Exhibit answers a seller&apos;s PayPal chargebacks from the records, then tests the answer before PayPal reads it. Each step below opens a
          real case in PayPal&apos;s sandbox at the part that shows it. Nobody at PayPal reads sandbox evidence; the reviewer is simulated, and each case
          says who decided its outcome.
        </p>
      </header>
      <ol className={styles.steps}>
        {STEPS.map((s, i) => (
          <li key={s.href} className={`sheet ${styles.step}`}>
            <span className={styles.num}>{i + 1}</span>
            <div>
              <h2>
                <Link href={s.href}>{s.title}</Link>
              </h2>
              <p>
                <strong>{s.case}.</strong> {s.body}
              </p>
              <p className={styles.look}>{s.look}</p>
            </div>
            <span className={styles.time}>{s.time}</span>
          </li>
        ))}
      </ol>
      <section className={styles.more} aria-label="Go further">
        {MORE.map((m) => (
          <Link key={m.href} href={m.href} className="sheet">
            <strong>{m.title}</strong>
            <span>{m.body}</span>
          </Link>
        ))}
      </section>
    </main>
  );
}
