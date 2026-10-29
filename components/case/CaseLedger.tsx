import type { CaseView } from "@/lib/cases/view";
import DollarView from "./DollarView";
import Requirements from "./Requirements";
import styles from "./ledger.module.css";

/** The requirements card and the money on a case, side by side under the hearing. */
export default function CaseLedger({ view }: { view: CaseView }) {
  if (!view.requirements && !view.brief) return null;
  return (
    <div className={styles.ledger}>
      {view.requirements && <Requirements card={view.requirements} />}
      <DollarView view={view} />
    </div>
  );
}
