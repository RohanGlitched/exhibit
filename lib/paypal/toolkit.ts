import "server-only";
import { PayPalAgentToolkit } from "@paypal/agent-toolkit/openai";
import { PAYPAL_BASE } from "./client";

/**
 * PayPal's own Agent Toolkit (@paypal/agent-toolkit), for the seller agent's read steps: the dispute, the
 * shipment tracking PayPal holds for the payment, the refund and the order. The autopilot reads a case through
 * it before deciding under the house rules, and Exhibit's MCP server passes these tools through, so one MCP
 * client gets PayPal's tools and Exhibit's evidence layer (argue, cross-examine, file, verify mandates) together.
 *
 * Writes stay on Exhibit's own clients: the toolkit's accept_dispute_claim only takes a note matching
 * ^[A-Za-z0-9_-]{1,255}$ (no spaces), and its create_order has no card payment source or custom_id, so an
 * agent can't pay against its signed cart with it (lib/agentic/buyer.ts).
 */

export const TOOLKIT_TOOLS = ["get_dispute", "list_disputes", "get_shipment_tracking", "get_refund", "get_order"] as const;
export type ToolkitTool = (typeof TOOLKIT_TOOLS)[number];

let kit: PayPalAgentToolkit | null = null;
function toolkit(): PayPalAgentToolkit {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("PayPal isn't configured on this server.");
  kit ??= new PayPalAgentToolkit({
    clientId,
    clientSecret,
    configuration: {
      actions: { disputes: { list: true, get: true }, shipment: { get: true }, payments: { getRefunds: true }, orders: { get: true } },
      context: { sandbox: PAYPAL_BASE.includes("sandbox") },
    },
  });
  return kit;
}

/** The toolkit's own definition of a tool (name, description, JSON schema), as an agent would be given it. */
export function toolkitDefinition(name: ToolkitTool) {
  const t = toolkit()
    .getTools()
    .find((x) => x.type === "function" && x.function.name === name);
  if (!t || t.type !== "function") throw new Error(`PayPal's Agent Toolkit has no ${name} tool.`);
  return t.function;
}

/** Calls one of PayPal's toolkit tools and returns what it answered, parsed when it is JSON. */
export async function toolkitCall<T = unknown>(name: ToolkitTool, args: Record<string, unknown>): Promise<T> {
  const r = await toolkit().handleToolCall({ id: `exhibit-${Date.now()}`, type: "function", function: { name, arguments: JSON.stringify(args) } });
  const text = typeof r.content === "string" ? r.content : JSON.stringify(r.content);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`PayPal's Agent Toolkit answered ${name} with: ${text.slice(0, 200)}`);
  }
}

export interface ToolkitRead {
  at: string;
  dispute: { status: string; due: string | null; amount: string } | null;
  tracking: { number: string; carrier: string; status: string } | null;
  error?: string;
}

/** The autopilot's read step: the dispute and the tracking PayPal holds for its payment, through PayPal's toolkit. */
export async function readThroughToolkit(disputeId: string): Promise<ToolkitRead> {
  const at = new Date().toISOString();
  try {
    const d = await toolkitCall<{ status?: string; seller_response_due_date?: string; dispute_amount?: { value?: string }; disputed_transactions?: { seller_transaction_id?: string }[] }>("get_dispute", { dispute_id: disputeId });
    const tx = d.disputed_transactions?.[0]?.seller_transaction_id;
    const t = tx ? await toolkitCall<{ trackers?: { tracking_number?: string; carrier?: string; status?: string }[] }>("get_shipment_tracking", { transaction_id: tx }).catch(() => null) : null;
    const tr = t?.trackers?.[0];
    return {
      at,
      dispute: d.status ? { status: d.status, due: d.seller_response_due_date ?? null, amount: d.dispute_amount?.value ?? "" } : null,
      tracking: tr?.tracking_number ? { number: tr.tracking_number, carrier: tr.carrier ?? "", status: tr.status ?? "" } : null,
    };
  } catch (e) {
    return { at, dispute: null, tracking: null, error: (e as Error).message.slice(0, 200) };
  }
}
