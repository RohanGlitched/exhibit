import type { RequirementsCard, Status } from "@/lib/cases/requirements";
import styles from "./ledger.module.css";

const MARK: Record<Status, string> = { "on file": "On file", weak: "Weak", missing: "Missing" };
const STANDING: Record<RequirementsCard["standing"], string> = { met: "Met", partly: "Partly met", "not met": "Not met" };

/**
 * The requirements card on the case page: what the card network asks for on this reason code, each item on
 * file, weak or missing from the exhibits, as code read them. The drafter and the reviewer read the same card.
 */
export default function Requirements({ card }: { card: RequirementsCard }) {
  return (
    <section className={`sheet ${styles.card}`} aria-labelledby="requirements-title">
      <header className={styles.cardHead}>
        <p className={styles.kicker}>
          <span className="bates">
            {card.network} {card.code}
          </span>
          <span>{card.title}</span>
        </p>
        <h2 id="requirements-title">What the network asks for</h2>
        <p className={styles.standing} data-standing={card.standing}>
          {STANDING[card.standing]}
        </p>
      </header>
      <ul className={styles.items}>
        {card.items.map((i) => (
          <li key={i.id} data-status={i.status}>
            <span className={styles.mark} data-status={i.status}>
              {MARK[i.status]}
            </span>
            <div>
              <p className={styles.need}>
                {i.need}
                {!i.required && <small> strengthens the case</small>}
              </p>
              <p className={styles.detail}>
                {i.detail}
                {i.exhibits.length > 0 && <span className={styles.cite}> Exhibit {i.exhibits.join(", ")}</span>}
              </p>
            </div>
          </li>
        ))}
      </ul>
      <p className={styles.foot}>
        {card.note ? `${card.note} ` : ""}Marked by code from the exhibits; the reviewer at the hearing presses every weak or missing item the case needs.
      </p>
    </section>
  );
}
