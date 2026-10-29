import type { DeskTotals } from "@/lib/desk-counts";
import { utcDay } from "@/lib/format";
import { utcStamp } from "@/lib/webhooks/paypal";
import styles from "@/app/desk/desk.module.css";

/**
 * The strip above the desk, counted by the same function as the home page's figures (lib/desk-counts.ts) from
 * the same snapshot, with the time it was read. Rendered inside the grid's client component so a refresh of
 * the rows refreshes the counts with them.
 */
export default function DeskStrip({ c, at }: { c: DeskTotals; at: string }) {
  return (
    <div className={styles.stripWrap}>
      <dl className={styles.strip}>
        <div>
          <dt>Your move</dt>
          <dd>{c.waiting}</dd>
        </div>
        <div>
          <dt>PayPal reviewing</dt>
          <dd>{c.reviewing + c.open}</dd>
        </div>
        <div>
          <dt>Won</dt>
          <dd data-tone="won">{c.won}</dd>
          <p className={styles.split}>
            {c.wonAsked} ruled at Exhibit&apos;s request, {c.wonByItself} closed by the sandbox on its own
          </p>
        </div>
        <div>
          <dt>Refunded</dt>
          <dd>{c.refunded}</dd>
        </div>
        <div>
          <dt>Lost</dt>
          <dd data-tone="lost">{c.lost}</dd>
          <p className={styles.split}>
            {c.lostAsked} ruled at Exhibit&apos;s request, {c.lostByItself} closed by the sandbox or the deadline
          </p>
        </div>
        <div>
          <dt>Soonest deadline</dt>
          <dd>{c.soonest ? utcDay(c.soonest) : "None"}</dd>
        </div>
      </dl>
      <p className={styles.asOf}>
        {c.cases} shop cases, read from PayPal&apos;s dispute list at <time dateTime={at}>{utcStamp(at)}</time>; the home page counts the same snapshot. It
        is read again every minute, and at once after a filing.
      </p>
    </div>
  );
}
