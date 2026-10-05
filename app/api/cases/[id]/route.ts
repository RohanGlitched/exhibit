import { NextResponse } from "next/server";
import { caseView } from "@/lib/cases/view";
import { CASE_ID } from "@/lib/store";
import { visitorId } from "@/lib/visitor";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!CASE_ID.test(id)) return NextResponse.json({ error: "That isn't a PayPal case id." }, { status: 400 });
  try {
    return NextResponse.json(await caseView(id, await visitorId()));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
