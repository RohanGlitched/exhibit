import { NextResponse, after } from "next/server";
import { claimFresh, claimReady, refillPool } from "@/lib/cases/open";
import { deskRows } from "@/lib/desk";
import { scenario } from "@/lib/shop/scenarios";
import { clientIp, visitorId } from "@/lib/visitor";
import { HOUR, allow } from "@/lib/limits";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const rows = await deskRows(await visitorId());
  return NextResponse.json({ rows, at: new Date().toISOString() });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { scenario?: string };
  const s = body.scenario ? scenario(body.scenario) : undefined;
  if (!s) return NextResponse.json({ error: "Pick one of the cases to open." }, { status: 400 });
  const visitor = (await visitorId(true))!;
  // Opening cases spends sandbox calls; keep it to a few per visitor per hour.
  if (!allow("open", await clientIp(), 8, HOUR)) {
    return NextResponse.json({ error: "That's eight cases this hour. Work those first, or come back in a bit." }, { status: 429 });
  }
  try {
    const ready = await claimReady(s.id, visitor);
    const rec = ready ?? (await claimFresh(s, visitor));
    after(() => refillPool(3).catch((e) => console.error("refill", e)));
    return NextResponse.json({ id: rec.disputeId, ready: Boolean(ready), openedAt: rec.openedAt });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message || "Couldn't open a case." }, { status: 502 });
  }
}
