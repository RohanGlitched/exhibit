import { NextResponse } from "next/server";
import { objectCase } from "@/lib/cases/cross";
import { BudgetSpent } from "@/lib/cases/review";
import { CASE_ID } from "@/lib/store";
import { clientIp } from "@/lib/visitor";
import { HOUR, MINUTE, allow } from "@/lib/limits";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const OBJECTION_MAX = 300;

/** A visitor's objection from the reviewer's chair: Exhibit answers from the exhibits, the checker checks it. Nothing is saved. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { objection?: unknown; sentence?: unknown };
  const text = typeof body.objection === "string" ? body.objection.replace(/\s+/g, " ").trim() : "";
  // 0-based index of the response sentence objected to; anything else means the response as a whole.
  const n = body.sentence;
  const sentence = typeof n === "number" && Number.isInteger(n) && n >= 0 && n < 20 ? n : null;
  if (!CASE_ID.test(id)) return NextResponse.json({ error: "That isn't a PayPal case id." }, { status: 400 });
  if (text.length < 8 || text.length > OBJECTION_MAX) return NextResponse.json({ error: `Write an objection between 8 and ${OBJECTION_MAX} characters.` }, { status: 400 });
  const ip = await clientIp();
  if (!allow("object", ip, 6, 10 * MINUTE) || !allow("object-hour", ip, 20, HOUR)) {
    return NextResponse.json({ error: "That's a lot of objections from one place. Give it a few minutes." }, { status: 429 });
  }
  try {
    return NextResponse.json({ exchange: await objectCase(id, text, sentence, ip) });
  } catch (e) {
    const status = e instanceof BudgetSpent ? 429 : 409;
    console.error("object", (e as Error).message);
    return NextResponse.json({ error: e instanceof BudgetSpent || !/^(Azure|Bedrock|The model)/.test((e as Error).message) ? (e as Error).message : "Exhibit didn't answer. Try again in a minute." }, { status });
  }
}
