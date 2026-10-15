import { takeDaily, takeModelCall } from "@/lib/budget";
import { allow, MINUTE } from "@/lib/limits";
import { clientIp } from "@/lib/visitor";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * The model behind the analytics page's analyst. AG Studio runs the agent loop in the browser and calls this
 * once per turn with an OpenAI Responses request (components/studio/adapter.ts). Here the turn goes to the
 * app's own GPT-5.6 deployment on Azure OpenAI and the event stream comes straight back, so the key never
 * leaves the server. Guards:
 * - same origin only, and a cap on the request size;
 * - a new question from the reader takes a model call from the app's spend guard (per visitor and per day,
 *   shared with the briefs), and every later turn of the same answer takes one from the day's budget;
 * - a sliding window per visitor on turns, so one long answer can't run on and on.
 */

const MAX_BYTES = 1_500_000;
const MAX_OUTPUT_TOKENS = 8000;

const fail = (status: number, message: string) => Response.json({ error: { message } }, { status, headers: { "cache-control": "no-store" } });

const azureReady = () => Boolean(process.env.AZURE_OPENAI_API_KEY && process.env.AZURE_OPENAI_ENDPOINT && process.env.AZURE_OPENAI_DEPLOYMENT);

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

export async function POST(req: Request) {
  if (!sameOrigin(req)) return fail(403, "The analyst only answers this site.");
  if (!azureReady()) return fail(503, "The analyst isn't connected to a model on this server.");

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
  if (!Array.isArray(body.input) || typeof body.instructions !== "string") return fail(400, "The analyst couldn't read that request.");

  // Reasoning items refer to stored responses; nothing is stored (store: false), so they are left out of the replay.
  const input = (body.input as Item[]).filter((i) => i && i.type !== "reasoning");
  const last = input.at(-1);
  const newQuestion = last?.type === "message" && last.role === "user";

  const ip = await clientIp();
  if (!allow("studio-turn", ip, 40, 10 * MINUTE) || !allow("studio-turn-day", ip, 240, 24 * 60 * MINUTE)) {
    return fail(429, "The analyst has worked hard for you in the last few minutes. Give it a little while, then ask again.");
  }
  const budget = newQuestion ? await takeModelCall(ip) : await takeDaily();
  if (!budget) return fail(429, "The analyst is out of model time for now (the demo keeps a daily budget). The dashboard still works; try the analyst again later.");

  const base = process.env.AZURE_OPENAI_ENDPOINT!.replace(/\/+$/, "").replace(/\/openai(\/v1)?$/, "");
  let upstream: Response;
  try {
    upstream = await fetch(`${base}/openai/v1/responses`, {
      method: "POST",
      headers: { "api-key": process.env.AZURE_OPENAI_API_KEY!, "content-type": "application/json" },
      body: JSON.stringify({
        model: process.env.AZURE_OPENAI_DEPLOYMENT,
        instructions: body.instructions,
        input,
        tools: Array.isArray(body.tools) ? body.tools : [],
        tool_choice: body.tool_choice ?? "auto",
        text: body.text,
        parallel_tool_calls: body.parallel_tool_calls ?? true,
        reasoning: { effort: process.env.AZURE_OPENAI_REASONING || "low" },
        max_output_tokens: MAX_OUTPUT_TOKENS,
        store: false,
        stream: true,
      }),
      signal: AbortSignal.any([req.signal, AbortSignal.timeout(110_000)]),
    });
  } catch (err) {
    console.error("[studio-agent] model call failed:", err instanceof Error ? err.message : err);
    return fail(502, "The analyst couldn't reach the model just now. Try again in a moment.");
  }

  if (!upstream.ok || !upstream.body) {
    const detail = (await upstream.json().catch(() => ({}))) as { error?: { message?: string; code?: string } };
    console.error(`[studio-agent] model answered ${upstream.status}:`, detail.error?.code ?? "", detail.error?.message?.slice(0, 300) ?? "");
    const message =
      upstream.status === 429
        ? "The model is busy right now. Try again in a minute."
        : upstream.status === 400
          ? "The model turned that request down. Start a new conversation and ask again."
          : "The model had a problem answering. Try again in a moment.";
    return fail(upstream.status === 429 ? 429 : 502, message);
  }

  return new Response(upstream.body, {
    status: 200,
    headers: { "content-type": upstream.headers.get("content-type") ?? "text/event-stream", "cache-control": "no-store" },
  });
}
