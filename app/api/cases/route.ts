import { NextResponse, after } from "next/server";
import { claimFresh, claimReady, refillPool } from "@/lib/cases/open";
import { revalidateTag } from "next/cache";
import { DESK_TAG, deskSnapshot } from "@/lib/desk";
import { scenario } from "@/lib/shop/scenarios";
import { clientIp, visitorId } from "@/lib/visitor";
import { HOUR, allow } from "@/lib/limits";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  // The desk's snapshot, with the time it was read from PayPal (the desk and the home page count the same one).
  const { rows, at } = await deskSnapshot(await visitorId());
  return NextResponse.json({ rows, at });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { scenario?: string };
  const s = body.scenario ? scenario(body.scenario) : undefined;
  if (!s) return NextResponse.json({ error: "Pick one of the cases to open." }, { status: 400 });
  const visitor = (await visitorId(true))!;
  // Opening cases spends sandbox calls; keep it to a few per visitor per hour. Keyed on the browser as well as
  // the address, so judges behind one office network don't use up each other's allowance.
  const ip = await clientIp();
  if (!allow("open", `${ip}:${visitor}`, 8, HOUR) || !allow("open-ip", ip, 20, HOUR)) {
    return NextResponse.json({ error: "That's a lot of cases this hour from here. Work those first, or come back in a bit." }, { status: 429 });
  }
  try {
    const ready = await claimReady(s.id, visitor);
    const rec = ready ?? (await claimFresh(s, visitor));
    revalidateTag(DESK_TAG);
    after(() => refillPool(3, "visit").catch((e) => console.error("refill", e)));
    return NextResponse.json({ id: rec.disputeId, ready: Boolean(ready), openedAt: rec.openedAt });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message || "Couldn't open a case." }, { status: 502 });
  }
}
