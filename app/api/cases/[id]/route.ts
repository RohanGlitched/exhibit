import { NextResponse } from "next/server";
import { caseView } from "@/lib/cases/view";
import { CASE_ID } from "@/lib/store";
import { PayPalError } from "@/lib/paypal/client";
import { visitorId } from "@/lib/visitor";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!CASE_ID.test(id)) return NextResponse.json({ error: "That isn't a PayPal case id." }, { status: 400 });
  try {
    return NextResponse.json(await caseView(id, await visitorId()));
  } catch (e) {
    const status = e instanceof PayPalError && e.status === 404 ? 404 : 502;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
