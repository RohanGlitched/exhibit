import { NextResponse } from "next/server";
import { reviewCase } from "@/lib/cases/cross";
import { BudgetSpent } from "@/lib/cases/review";
import { CASE_ID } from "@/lib/store";
import { clientIp } from "@/lib/visitor";
import { MINUTE, allow } from "@/lib/limits";
import { loadCase } from "@/lib/store";
import { publicWriteBlocked, shopRequest } from "@/lib/cases/locks";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Cross-examines the case: the simulated reviewer reads the PDF, objects, Exhibit answers, the checker rules on the answers. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!CASE_ID.test(id)) return NextResponse.json({ error: "That isn't a PayPal case id." }, { status: 400 });
  const ip = await clientIp();
  if (!allow("review", ip, 6, 10 * MINUTE)) {
    return NextResponse.json({ error: "That's six hearings in ten minutes from one place. Give it a few minutes." }, { status: 429 });
  }
  const locked = shopRequest(_req) ? null : publicWriteBlocked(id, await loadCase(id).catch(() => null), "hearing");
  if (locked) return NextResponse.json({ error: locked }, { status: 403 });
  try {
    return NextResponse.json(await reviewCase(id, ip));
  } catch (e) {
    const status = e instanceof BudgetSpent ? 429 : 409;
    console.error("review", (e as Error).message);
    return NextResponse.json({ error: e instanceof BudgetSpent || !/^(Azure|Bedrock|The model)/.test((e as Error).message) ? (e as Error).message : "The reviewer didn't answer. Try again in a minute." }, { status });
  }
}
