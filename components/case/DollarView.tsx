import { DISPUTE_FEE } from "@/lib/impact";
import { usd } from "@/lib/format";
import type { CaseView } from "@/lib/cases/view";
import styles from "./ledger.module.css";

/** The money on one case, computed from PayPal's record of it and the brief: no estimate, no probability. */
export function dollars(view: Pick<CaseView, "amount" | "channel" | "brief">) {
  const amount = Number(view.amount.value);
  const card = view.channel === "EXTERNAL";
  const fee = card ? DISPUTE_FEE.card : DISPUTE_FEE.paypal;
  const offer = view.brief?.offerAmount ? Number(view.brief.offerAmount) : null;
  return {
    amount,
    card,
    fee,
    // Fought and won: the sale stays. Refunded, or fought and lost: it goes back to the buyer.
    win: amount - fee,
    refund: -fee,
    offer: offer !== null ? { amount: offer, keep: amount - offer - fee } : null,
    balance: view.brief ? view.brief.odds : null,
    call: view.brief?.recommendation ?? null,
  };
}

const signed = (n: number) => (n < 0 ? `−${usd(-n)}` : usd(n));

export default function DollarView({ view }: { view: Pick<CaseView, "amount" | "channel" | "brief"> }) {
  const d = dollars(view);
  return (
    <section className={`sheet ${styles.card}`} aria-labelledby="dollars-title">
      <header className={styles.cardHead}>
        <p className={styles.kicker}>
          <span className="bates">Ledger</span>
          <span>{d.card ? "Card chargeback" : "PayPal dispute"}</span>
        </p>
        <h2 id="dollars-title">What this case is worth</h2>
      </header>
      <table className={styles.money}>
        <tbody>
          <tr>
            <th scope="row">At stake</th>
            <td>{usd(d.amount)}</td>
          </tr>
          <tr>
            <th scope="row">PayPal&apos;s fee on the dispute</th>
            <td>{signed(-d.fee)}</td>
          </tr>
          <tr data-call={d.call === "fight" || undefined}>
            <th scope="row">Fight and win: you keep</th>
            <td>{signed(d.win)}</td>
          </tr>
          <tr data-call={d.call === "accept" || undefined}>
            <th scope="row">Refund, or fight and lose</th>
            <td>{signed(d.refund)}</td>
          </tr>
          <tr data-call={d.call === "offer" || undefined}>
            <th scope="row">{d.offer ? `Partial offer of ${usd(d.offer.amount)}` : "Partial offer"}</th>
            <td>{d.offer ? signed(d.offer.keep) : d.card ? "not possible" : "none advised"}</td>
          </tr>
          {d.balance !== null && (
            <tr>
              <th scope="row">Evidence balance for you</th>
              <td>{d.balance}%</td>
            </tr>
          )}
        </tbody>
      </table>
      <p className={styles.foot}>
        The fee is PayPal&apos;s: {usd(DISPUTE_FEE.card)} on a card chargeback, {usd(DISPUTE_FEE.paypal)} on a dispute paid through a PayPal account. Its fee page
        doesn&apos;t say it&apos;s waived when you win, so it is counted either way.
        {d.card ? " A card chargeback can only be fought or refunded in full." : ""} The evidence balance is the weight of the brief&apos;s points, not a
        chance of winning.
      </p>
    </section>
  );
}
