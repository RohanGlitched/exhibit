import type { Exhibit } from "@/lib/cases/types";
import styles from "./home-art.module.css";

const FROM_PAYPAL = new Set<Exhibit["kind"]>(["claim", "order", "payment", "refund", "tracking"]);

/** Every record behind the showcase case, as the lettered index cards a reviewer would get. */
export default function ExhibitWall({ exhibits }: { exhibits: Exhibit[] }) {
  return (
    <ul className={styles.wall} aria-label="The exhibits in the case on the desk">
      {exhibits.map((e, i) => (
        <li key={e.id} className={styles.wallCard} data-side={e.kind === "claim" ? "claimant" : "respondent"} style={{ "--tilt": `${((i % 3) - 1) * 0.5}deg` } as React.CSSProperties}>
          <span className={styles.wallTab}>{e.id}</span>
          <h3>{e.title}</h3>
          <dl>
            {e.facts.slice(0, 2).map((f) => (
              <div key={f.label}>
                <dt>{f.label}</dt>
                <dd>{f.value}</dd>
              </div>
            ))}
            {e.facts.length === 0 && e.lines?.[0] && (
              <div>
                <dd className={styles.wallLine}>{e.lines[0]}</dd>
              </div>
            )}
          </dl>
          <p className={styles.wallSource}>{FROM_PAYPAL.has(e.kind) ? "PayPal" : e.kind === "scans" ? "Carrier" : "Store"}</p>
        </li>
      ))}
    </ul>
  );
}
