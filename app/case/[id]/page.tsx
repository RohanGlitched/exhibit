import type { Metadata } from "next";
import Link from "next/link";
import CaseRoom from "@/components/case/CaseRoom";
import Registering from "@/components/case/Registering";
import { caseView } from "@/lib/cases/view";
import { PayPalError } from "@/lib/paypal/client";
import { CASE_ID, loadCase } from "@/lib/store";
import { visitorId } from "@/lib/visitor";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return { title: `Case ${id}` };
}

export default async function CasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const view = CASE_ID.test(id) ? await caseView(id, await visitorId()).catch((e: Error) => e) : new Error("That isn't a PayPal case id.");
  if (view instanceof Error) {
    // Exhibit holds the record but PayPal doesn't list the case yet: it was opened seconds ago.
    if (view instanceof PayPalError && view.status === 404 && (await loadCase(id))) return <Registering id={id} />;
    return (
      <main className="shell" style={{ paddingTop: 60, maxWidth: 720 }}>
        <h1 style={{ fontSize: 34 }}>This case couldn&apos;t be loaded</h1>
        <p style={{ marginTop: 14, color: "var(--ink-soft)" }}>{view.message}</p>
        <p style={{ marginTop: 22, display: "flex", gap: 12 }}>
          <Link className="btn btnPrimary" href="/desk">
            Back to the desk
          </Link>
          <Link className="btn btnQuiet" href="/new">
            Open a new case
          </Link>
        </p>
      </main>
    );
  }
  return <CaseRoom initial={view} />;
}
