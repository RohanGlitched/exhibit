import { ANALYST_ID } from "@/components/studio/analyst";
import { allow, MINUTE } from "@/lib/limits";
import { converse, llmModel, llmReady } from "@/lib/llm";
import { instructionsFor, isAgentId, toolsFor } from "@/lib/studio/agents";
import { takeAnalystTurn } from "@/lib/studio/budget";
import { toConverse, toResponsesEvents, type StreamEvent } from "@/lib/studio/responses";
import { clientIp } from "@/lib/visitor";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * The model behind the analytics page's analyst. AG Studio runs the agent loop in the browser and calls this
 * once per turn with an OpenAI Responses request (components/studio/adapter.ts). Here the turn becomes one
 * Converse call through lib/llm.ts (GPT-5.6 on Azure OpenAI, or Claude Haiku 4.5 on Bedrock), and the answer goes back as the Responses event
 * stream the adapter reads, so no key or model reaches the browser. Guards:
 * - same origin only, and a cap on the request size;
 * - only the dashboard's agents: the analyst's instructions and its own tools are built here (lib/studio/
 *   agents.ts) and the browser's copies ignored; Studio's agents must open as AG's do, and every agent may
 *   call only the tools it is known to have;
 * - the analyst's own daily budget of model turns, apart from the briefs' (lib/studio/budget.ts), a cap on
 *   new questions per visitor per day, and a sliding window per visitor on turns.
 */

const MAX_BYTES = 600_000;
const MAX_OUTPUT_TOKENS = 4000;
const KEEPALIVE_MS = 8000;

const fail = (status: number, message: string) => Response.json({ error: { message } }, { status, headers: { "cache-control": "no-store" } });

function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

type Item = { type?: string; role?: string };

const sse = (e: StreamEvent) => `data: ${JSON.stringify(e)}\n\n`;

export async function POST(req: Request) {
  if (!sameOrigin(req)) return fail(403, "The analyst only answers this site.");
  if (!llmReady()) return fail(503, "The analyst isn't connected to a model on this server.");

  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > MAX_BYTES) return fail(413, "This conversation has grown too long for the analyst. Start a new one.");
  const raw = await req.text();
  if (raw.length > MAX_BYTES) return fail(413, "This conversation has grown too long for the analyst. Start a new one.");

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return fail(400, "The analyst couldn't read that request.");
  }
  if (!Array.isArray(body.input)) return fail(400, "The analyst couldn't read that request.");

  const meta = (body.exhibit ?? {}) as { agent?: unknown; context?: unknown };
  if (!isAgentId(meta.agent)) return fail(400, "That request isn't one of the dashboard's agents.");
  const agent = meta.agent;
  const system = instructionsFor(agent, body.instructions, meta.context);
  if (!system.ok) return fail(400, system.error);
  const { tools, dropped } = toolsFor(agent, body.tools);
  if (dropped.length && process.env.NODE_ENV !== "production") console.warn(`[studio-agent] ${agent}: left out tools ${dropped.join(", ")}`);

  const last = (body.input as Item[]).at(-1);
  const newQuestion = agent === ANALYST_ID && last?.type === "message" && last.role === "user";

  const ip = await clientIp();
  if (!allow("studio-turn", ip, 40, 10 * MINUTE) || !allow("studio-turn-day", ip, 160, 24 * 60 * MINUTE)) {
    return fail(429, "The analyst has worked hard for you in the last few minutes. Give it a little while, then ask again.");
  }
  if (newQuestion && !allow("studio-question", ip, 25, 24 * 60 * MINUTE)) {
    return fail(429, "That's the analyst's limit of questions for one visitor today. The dashboard still works; try the analyst again tomorrow.");
  }
  if (!(await takeAnalystTurn())) {
    return fail(429, "The analyst is out of model time for today (the demo keeps a daily budget of its own). The dashboard still works; try the analyst again tomorrow.");
  }

  const turn = toConverse({ input: body.input, tools, tool_choice: body.tool_choice });
  if (process.env.NODE_ENV !== "production") {
    console.log(`[studio-agent] ${agent}: ${raw.length} bytes in, ${system.text.length} chars of instructions, ${turn.messages.length} messages, ${turn.tools.length} tools`);
  }
  const id = `resp_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const encoder = new TextEncoder();

  // One Converse call per turn, wrapped as a Responses event stream; a keepalive every few seconds holds the
  // connection open while the model works.
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (s: string) => controller.enqueue(encoder.encode(s));
      const beat = setInterval(() => send(sse({ type: "keepalive" })), KEEPALIVE_MS);
      try {
        const out = await converse({
          system: system.text,
          messages: turn.messages,
          tools: turn.tools,
          toolChoice: turn.toolChoice,
          maxTokens: MAX_OUTPUT_TOKENS,
          timeoutMs: 100_000,
          temperature: 0.2,
        });
        if (process.env.NODE_ENV !== "production" && out.usage) {
          console.log(`[studio-agent] ${agent}: ${out.usage.inputTokens} in, ${out.usage.outputTokens} out, ${out.stopReason}`);
        }
        for (const e of toResponsesEvents(out.message as never, { id, model: llmModel(), usage: out.usage, stopReason: out.stopReason })) send(sse(e));
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        console.error("[studio-agent] model call failed:", detail.slice(0, 300));
        const message = /\b429\b|thrott/i.test(detail)
          ? "The model is busy right now. Try again in a minute."
          : /\b400\b|validation/i.test(detail)
            ? "The model turned that request down. Start a new conversation and ask again."
            : "The model had a problem answering. Try again in a moment.";
        send(sse({ type: "response.failed", response: { id, status: "failed", error: { code: "model_error", message } } }));
      } finally {
        clearInterval(beat);
        controller.close();
      }
    },
  });

  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream", "cache-control": "no-store" } });
}
