import { caseContext } from "@/lib/cases/service";
import { briefPdf } from "@/lib/cases/pdf";
import { CASE_ID } from "@/lib/store";

export const dynamic = "force-dynamic";

/** The response exactly as Exhibit files it with PayPal. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!CASE_ID.test(id)) return new Response("That isn't a PayPal case id.", { status: 400 });
  const ctx = await caseContext(id).catch(() => null);
  if (!ctx?.record?.brief) return new Response("Argue the case first.", { status: 404 });
  const pdf = await briefPdf(ctx.dispute, ctx.record.brief, ctx.exhibits, ctx.record.invoiceId);
  return new Response(pdf as BodyInit, {
    headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${id}-response.pdf"`, "cache-control": "no-store" },
  });
}
