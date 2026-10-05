"use client";

import type { TallyItem } from "@/lib/cases/types";
import { usd } from "@/lib/format";
import type { Verdict } from "./PinnedBrief";
import styles from "./brief.module.css";

const WORDS = {
  fight: "Fight it",
  accept: "Refund it",
  offer: "Offer a partial refund",
} as const;

function Weight({ n }: { n: number }) {
  return (
    <span className={styles.weight} aria-label={`weight ${n} of 3`}>
      {[1, 2, 3].map((i) => (
        <i key={i} data-on={i <= n} />
      ))}
    </span>
  );
}

/** The two sides of the ledger, then the odds and the call. */
export default function Tally({ tally, verdict, amount }: { tally: TallyItem[]; verdict: Verdict | null; amount: string }) {
  const seller = tally.filter((t) => t.side === "seller");
  const buyer = tally.filter((t) => t.side === "buyer");
  return (
    <section className={styles.tally} aria-label="Tally">
      <div className={styles.ledger}>
        <div>
          <h5>For the seller</h5>
          <ul>
            {seller.map((t, i) => (
              <li key={i}>
                <Weight n={t.weight} />
                <span>{t.point}</span>
                <em>{t.cites.join(", ")}</em>
              </li>
            ))}
            {seller.length === 0 && <li className={styles.none}>Nothing in the records.</li>}
          </ul>
        </div>
        <div>
          <h5>For the buyer</h5>
          <ul>
            {buyer.map((t, i) => (
              <li key={i}>
                <Weight n={t.weight} />
                <span>{t.point}</span>
                <em>{t.cites.join(", ")}</em>
              </li>
            ))}
            {buyer.length === 0 && <li className={styles.none}>Nothing in the records.</li>}
          </ul>
        </div>
      </div>
      {verdict && (
        <div className={styles.verdict} data-rec={verdict.recommendation}>
          <div className={styles.oddsBar} role="img" aria-label={`Seller's chance ${verdict.odds} percent`}>
            <span style={{ width: `${verdict.odds}%` }} />
          </div>
          <div className={styles.verdictRow}>
            <p className={styles.call}>
              {verdict.recommendation === "offer" && verdict.offerAmount ? `Offer ${usd(verdict.offerAmount)}` : WORDS[verdict.recommendation]}
              <span>{verdict.odds}% chance for the seller</span>
            </p>
            <p className={styles.stake}>{amount} at stake</p>
          </div>
          <p className={styles.headline}>{verdict.headline}</p>
          <p className={styles.engine}>
            {verdict.engine === "model" ? `Argued by ${verdict.model ?? "the model"}${verdict.ms ? ` in ${(verdict.ms / 1000).toFixed(1)} s` : ""}` : "Argued by the rules engine"}
            . Every sentence checked against its exhibits.
          </p>
        </div>
      )}
    </section>
  );
}
