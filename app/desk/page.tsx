import type { Metadata } from "next";
import Link from "next/link";
import DeskGrid from "@/components/desk/DeskGrid";
import { deskCounts, deskRows } from "@/lib/desk";
import { day } from "@/lib/format";
import { visitorId } from "@/lib/visitor";
import styles from "./desk.module.css";

export const metadata: Metadata = { title: "Desk" };
export const dynamic = "force-dynamic";

export default async function Desk() {
  const rows = await deskRows(await visitorId());
  const c = deskCounts(rows);
  return (
    <main className={`shell ${styles.page}`}>
      <header className={styles.head}>
        <div>
          <p className={styles.docketLine}>
            <span className="bates">Docket</span>
            <span>{day(new Date())}</span>
            <span>Halden Ceramics, sandbox account</span>
          </p>
          <h1>The desk</h1>
          <p className={styles.lede}>
            Every dispute on the shop&apos;s sandbox PayPal account, straight from the Disputes API, soonest deadline first. Where a case stands is read from
            PayPal&apos;s own record: what the seller filed, and how PayPal ruled. Open one to see Exhibit&apos;s brief, or argue it if nobody has yet.
          </p>
        </div>
        <div className={styles.headLinks}>
          <Link className="btn btnPrimary" href="/new">
            Open a sandbox case
          </Link>
        </div>
      </header>
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
        </div>
        <div>
          <dt>Refunded</dt>
          <dd>{c.refunded}</dd>
        </div>
        <div>
          <dt>Lost</dt>
          <dd data-tone="lost">{c.lost}</dd>
        </div>
        <div>
          <dt>Soonest deadline</dt>
          <dd>{c.soonest ? day(c.soonest) : "None"}</dd>
        </div>
      </dl>
      <DeskGrid initial={rows} />
    </main>
  );
}
