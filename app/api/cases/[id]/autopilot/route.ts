import { NextResponse } from "next/server";
import { CASE_ID, updateCase } from "@/lib/store";
import { undoable } from "@/lib/cases/autopilot";
import { clientIp } from "@/lib/visitor";
import { MINUTE, allow } from "@/lib/limits";

export const dynamic = "force-dynamic";

/** Stops what the autopilot planned on a case, while its undo window is open. The case then waits for the seller. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!CASE_ID.test(id)) return NextResponse.json({ error: "That isn't a PayPal case id." }, { status: 400 });
  if (!allow("undo", await clientIp(), 10, 10 * MINUTE)) return NextResponse.json({ error: "Too many requests. Give it a few minutes." }, { status: 429 });
  let why = "Nothing is waiting to be sent on this case.";
  const rec = await updateCase(id, (r) => {
    if (!undoable(r.house, Date.now())) {
      if (r.house?.done) why = "The autopilot has already sent it.";
      return null;
    }
    return { ...r, house: { ...r.house!, undone: { at: new Date().toISOString() } } };
  }).catch(() => null);
  if (!rec?.house?.undone) return NextResponse.json({ error: why }, { status: 409 });
  return NextResponse.json({ house: rec.house });
}
