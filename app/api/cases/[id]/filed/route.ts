import { downloadDocument, getDispute } from "@/lib/paypal/disputes";
import { filedDocument } from "@/lib/cases/derive";
import { CASE_ID } from "@/lib/store";

export const dynamic = "force-dynamic";

/** The PDF filed with the seller's response, exactly as PayPal holds it on the case (not re-rendered by Exhibit). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!CASE_ID.test(id)) return new Response("That isn't a PayPal case id.", { status: 400 });
  const d = await getDispute(id).catch(() => null);
  if (!d) return new Response("PayPal has no case with that id.", { status: 404 });
  const doc = filedDocument(d);
  if (!doc) return new Response("PayPal holds no filed document on this case.", { status: 404 });
  try {
    const pdf = await downloadDocument(doc.url);
    return new Response(pdf as BodyInit, {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename="${id}-as-filed.pdf"`,
        "cache-control": "private, max-age=3600",
      },
    });
  } catch (e) {
    return new Response((e as Error).message, { status: 502 });
  }
}
