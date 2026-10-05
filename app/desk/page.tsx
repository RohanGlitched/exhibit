import type { Metadata } from "next";
import Link from "next/link";
import DeskGrid from "@/components/desk/DeskGrid";
import { deskRows } from "@/lib/desk";
import { day } from "@/lib/format";
import { visitorId } from "@/lib/visitor";
import styles from "./desk.module.css";

export const metadata: Metadata = { title: "Desk" };
export const dynamic = "force-dynamic";

export default async function Desk() {
  const rows = await deskRows(await visitorId());
  const live = rows.filter((r) => !r.pooled);
  const count = (status: string) => live.filter((r) => r.status === status).length;
  const soonest = live.filter((r) => r.due && r.status === "WAITING_FOR_SELLER_RESPONSE").map((r) => r.due!).sort()[0];
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
            Every dispute on the shop&apos;s sandbox PayPal account, straight from the Disputes API, soonest deadline first. Open one to see Exhibit&apos;s
            brief, or argue it if nobody has yet.
          </p>
        </div>
        <Link className="btn btnPrimary" href="/new">
          Open a sandbox case
        </Link>
      </header>
      <dl className={styles.strip}>
        <div>
          <dt>Your move</dt>
          <dd>{count("WAITING_FOR_SELLER_RESPONSE")}</dd>
        </div>
        <div>
          <dt>PayPal reviewing</dt>
          <dd>{count("UNDER_REVIEW")}</dd>
        </div>
        <div>
          <dt>Resolved</dt>
          <dd>{count("RESOLVED")}</dd>
        </div>
        <div>
          <dt>Soonest deadline</dt>
          <dd>{soonest ? day(soonest) : "None"}</dd>
        </div>
      </dl>
      <DeskGrid initial={rows} />
    </main>
  );
}
