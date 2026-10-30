import type { CaseView } from "@/lib/cases/view";
import { priorPaymentsNote } from "@/lib/cases/case-page";
import DollarView from "./DollarView";
import Requirements from "./Requirements";
import styles from "./ledger.module.css";

/**
 * The requirements card and the money on a case, side by side under the hearing. A returning customer's
 * re-created earlier orders are disclosed on the card, outside the PDF.
 */
export default function CaseLedger({ view }: { view: CaseView }) {
  if (!view.requirements && !view.brief) return null;
  return (
    <div className={styles.ledger}>
      {view.requirements && <Requirements card={view.requirements} disclosure={priorPaymentsNote(view.priorPayments, view.exhibits)} />}
      <DollarView view={view} />
    </div>
  );
}
