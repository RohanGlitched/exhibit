import type { Metadata } from "next";
import Link from "next/link";
import DeskGrid from "@/components/desk/DeskGrid";
import { deskSnapshot } from "@/lib/desk";
import { utcDay } from "@/lib/format";
import { visitorId } from "@/lib/visitor";
import styles from "./desk.module.css";

export const metadata: Metadata = { title: "Desk" };
export const dynamic = "force-dynamic";

export default async function Desk() {
  // The desk's snapshot: the same rows, counted the same way, as the home page's figures.
  const { rows, at } = await deskSnapshot(await visitorId());
  return (
    <main className={`shell ${styles.page}`}>
      <header className={styles.head}>
        <div>
          <p className={styles.docketLine}>
            <span className="bates">Docket</span>
            <span>{utcDay(new Date())}</span>
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
          <Link className="btn btnQuiet" href="/desk/analytics">
            Analytics
          </Link>
        </div>
      </header>
      <DeskGrid initial={rows} at={at} />
    </main>
  );
}
