import { NextResponse } from "next/server";
import { publishedKeys } from "@/lib/agentic/keys";

export const dynamic = "force-dynamic";

/**
 * The public keys agent mandates are verified against, JWKS-style (Ed25519, OKP), each with its kid and role.
 * Exhibit looks a mandate's key up here by kid; a key the mandate carries itself is never trusted.
 */
export function GET() {
  return NextResponse.json(
    {
      issuer: "Exhibit (demo wallet and agent platform on the PayPal sandbox)",
      note: "Intent mandates are signed by the wallet key, cart mandates by the agent key. Signatures are Ed25519 over the canonical JSON (sorted keys) of the mandate. A PayPal order commits to its signed cart with custom_id \"ap2:\" + SHA-256 of the canonical signed cart.",
      keys: publishedKeys(),
    },
    { headers: { "cache-control": "public, max-age=300", "access-control-allow-origin": "*" } },
  );
}
