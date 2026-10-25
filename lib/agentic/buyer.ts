import "server-only";
import { llmModel, llmReady, structured } from "../llm";
import type { Scenario } from "../shop/scenarios";
import { requireSigner } from "./keys";
import { cartDigest, signMandate } from "./mandate";
import { boughtStoryCart, callTool, newSession, scriptedAgent, TOOL_HELP, TOOL_NAMES, type Deps, type Session } from "./shop-tools";
import { intentFor, shipLine } from "./story";
import type { AgentRun, AgentStep } from "./types";

/**
 * The buyer's shopping agent: a model with tools browses the Halden Ceramics catalogue under the cardholder's
 * signed intent, fills a cart, checks it against the intent, signs it and pays through PayPal Orders v2.
 *
 * It runs on lib/llm.ts's one structured call: each step the model must call one function, `act`, naming the
 * next tool and its arguments. Exhibit runs the tool and shows the model the result on the next step. That
 * keeps the agent on whichever provider argues the cases, with the same spend guards.
 *
 * Why not @paypal/agent-toolkit: its create_order tool makes an order for a buyer to approve through a PayPal
 * link, with no card payment source and no custom_id, so an agent can't complete a payment that commits to its
 * signed cart; and it ships its own model adapters (ai-sdk, OpenAI, LangChain) that don't fit lib/llm.ts.
 * The agent pays through Exhibit's own Orders v2 client instead (lib/paypal/orders.ts).
 */

const MAX_STEPS = 12;

function system(s: Scenario): string {
  return `You are ${s.agent!.name}, a shopping agent acting for one cardholder. You can only act through tools, one call per step, by calling the act function.
Tools:
${TOOL_NAMES.map((t) => `- ${TOOL_HELP[t]}`).join("\n")}
Shop at the catalogue the tools give you. Ship to the cardholder's address on file. When you have paid, or decided not to buy, call finish with a short message to the cardholder.`;
}

function prompt(x: Session): string {
  const i = x.intent.mandate;
  const history = x.steps.length
    ? x.steps.map((st) => `${st.n}. ${st.tool}(${Object.entries(st.args).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(", ")}) ->\n${st.result}`).join("\n\n")
    : "(nothing yet)";
  return `The cardholder, ${i.cardholder}, asked: "${i.request}"
Their signed intent mandate ${i.id}: item "${i.item}"${i.quantity ? ` × ${i.quantity}` : ""}, limit $${i.maxTotal} including shipping, ship to ${i.shipTo}, valid until ${i.expiresAt}.
Address on file: ${x.shipTo}.

Steps so far:
${history}

Choose the next tool call.`;
}

const ACT = {
  name: "act",
  description: "Make the next tool call.",
  schema: {
    type: "object",
    required: ["tool", "why"],
    properties: {
      tool: { type: "string", enum: [...TOOL_NAMES] },
      query: { type: "string", description: "search_catalog: what to search for" },
      sku: { type: "string", description: "view_product, add_to_cart, remove_from_cart: the product's sku" },
      quantity: { type: "integer", description: "add_to_cart: how many (default 1)" },
      message: { type: "string", description: "finish: what you tell the cardholder" },
      why: { type: "string", description: "One short sentence: why this call." },
    },
  },
};

type Act = { tool: string; query?: string; sku?: string; quantity?: number; message?: string; why?: string };

/** The model's run. Returns its token use; the session holds the steps. Stops on finish, the step cap or the budget. */
async function modelAgent(x: Session, deps: Deps, s: Scenario, budget: () => Promise<boolean>): Promise<{ input: number; output: number; stopped?: string }> {
  const tokens = { input: 0, output: 0 };
  for (let n = 0; n < MAX_STEPS && !x.done; n++) {
    if (!(await budget())) return { ...tokens, stopped: "the model budget ran out mid-purchase" };
    const { value, usage } = await structured<Act>({ system: system(s), prompt: prompt(x), tool: ACT, maxTokens: 1500, timeoutMs: 30_000 });
    if (usage) {
      tokens.input += usage.inputTokens;
      tokens.output += usage.outputTokens;
    }
    await callTool(x, deps, String(value.tool ?? ""), { query: value.query, sku: value.sku, quantity: value.quantity, message: value.message }, value.why);
  }
  return { ...tokens, stopped: x.done ? undefined : `the model hadn't finished after ${MAX_STEPS} tool calls` };
}

export interface BuyOptions {
  invoiceId: string;
  orderAt: Date; // the store's order time (story clock)
  pay: Deps["pay"];
  /** Whether the model may run at all for this purchase (the per-visitor cap and the daily budget). */
  allowModel: boolean;
  /** Takes one model call from the budget before each step. */
  budget: () => Promise<boolean>;
  noModelReason?: string;
}

/**
 * Makes a story's agent purchase. The wallet signs the intent first; then the model shops. If it can't run, or
 * doesn't buy the story's cart, the scripted agent replays the story's purchase through the same tools, and the
 * run says why.
 */
export async function buyForStory(s: Scenario, o: BuyOptions): Promise<AgentRun & { session: Session }> {
  const startedAt = new Date();
  const wallet = requireSigner("wallet");
  const agentSigner = requireSigner("agent");
  const intent = signMandate(intentFor(s, o.orderAt), wallet);
  const shipTo = shipLine(s.buyer.shipTo);
  const deps: Deps = { agentSigner, pay: o.pay };

  let modelSteps: AgentStep[] | undefined;
  let modelTold: string | undefined;
  let fallback: string | undefined = !llmReady() ? "no model is configured" : !o.allowModel ? (o.noModelReason ?? "the buyer-agent allowance for this visitor is used up") : undefined;
  let tokens: { input: number; output: number } | undefined;
  let x = newSession(s, intent, shipTo, o.orderAt);

  if (!fallback) {
    try {
      const r = await modelAgent(x, deps, s, o.budget);
      tokens = { input: r.input, output: r.output };
      if (!boughtStoryCart(x)) {
        fallback = x.paid
          ? `the model bought ${x.signed!.mandate.items.map((i) => `${i.quantity} × ${i.name}`).join(", ")}, not this story's cart (that sandbox order ${x.paid.orderId} has no dispute)`
          : x.done
            ? "the model chose not to buy"
            : (r.stopped ?? "the model stopped without paying");
      }
    } catch (e) {
      fallback = `the model call failed (${(e as Error).message.slice(0, 120)})`;
    }
    if (fallback) {
      modelSteps = x.steps;
      modelTold = x.told;
      x = newSession(s, intent, shipTo, o.orderAt);
    }
  }
  if (fallback) await scriptedAgent(x, deps);
  if (!x.paid || !x.signed) throw new Error(`The buyer's agent couldn't pay: ${x.steps.filter((st) => !st.ok).at(-1)?.result ?? "no payment"}`);

  return {
    engine: fallback ? "scripted" : "model",
    ...(fallback ? {} : { model: llmModel() }),
    ...(fallback ? { fallback } : {}),
    ...(modelSteps?.length ? { modelSteps, model: llmModel() } : {}),
    ...(modelTold ? { modelTold } : {}),
    steps: x.steps,
    told: x.told,
    injection: x.injected || undefined,
    intent,
    cart: x.signed,
    digest: cartDigest(x.signed),
    orderId: x.paid.orderId,
    startedAt: startedAt.toISOString(),
    ms: Date.now() - startedAt.getTime(),
    ...(tokens ? { tokens } : {}),
    session: x,
  };
}
