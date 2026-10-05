import type { Metadata } from "next";
import Link from "next/link";
import DeskGrid from "@/components/desk/DeskGrid";
import { deskRows } from "@/lib/desk";
import { visitorId } from "@/lib/visitor";

export const metadata: Metadata = { title: "Desk" };
export const dynamic = "force-dynamic";

export default async function Desk() {
  const rows = await deskRows(await visitorId());
  return (
    <main className="shell" style={{ paddingTop: 44 }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 20, flexWrap: "wrap", marginBottom: 22 }}>
        <div>
          <h1 style={{ fontSize: "clamp(30px, 4vw, 46px)" }}>The desk</h1>
          <p style={{ marginTop: 10, color: "var(--ink-soft)", maxWidth: "62ch", fontSize: 16.5 }}>
            Every dispute on Halden Ceramics&apos; sandbox PayPal account, straight from the Disputes API, soonest deadline first. Open one to see
            Exhibit&apos;s brief, or argue it if nobody has yet.
          </p>
        </div>
        <Link className="btn btnPrimary" href="/new">
          Open a sandbox case
        </Link>
      </header>
      <DeskGrid initial={rows} />
    </main>
  );
}
