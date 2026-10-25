import "server-only";
import { signRequest, type AwsCredentials } from "./aws/sigv4";

/**
 * Exhibit asks for one structured answer per case through a single forced tool call, so the brief always arrives
 * as JSON the server can check. Two providers behind one Converse-shaped interface:
 * - Claude Haiku 4.5 on Amazon Bedrock (the Converse API), SigV4-signed from an IAM user that may invoke that one
 *   model and nothing else: BEDROCK_ACCESS_KEY_ID + BEDROCK_SECRET_ACCESS_KEY, optionally BEDROCK_REGION/MODEL;
 * - GPT-5.6 on Azure OpenAI (the Responses API): AZURE_OPENAI_API_KEY + _ENDPOINT + _DEPLOYMENT.
 * LLM_PROVIDER picks one ("bedrock" or "azure"); unset, Azure is used when it is configured, else Bedrock.
 */

const REGION = () => process.env.BEDROCK_REGION || "ap-southeast-2";
const MODEL = () => process.env.BEDROCK_MODEL || "au.anthropic.claude-haiku-4-5-20251001-v1:0";

function credentials(): AwsCredentials | null {
  const accessKeyId = process.env.BEDROCK_ACCESS_KEY_ID;
  const secretAccessKey = process.env.BEDROCK_SECRET_ACCESS_KEY;
  return accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : null;
}

const azureReady = () => Boolean(process.env.AZURE_OPENAI_API_KEY && process.env.AZURE_OPENAI_ENDPOINT && process.env.AZURE_OPENAI_DEPLOYMENT);

export type Provider = "bedrock" | "azure";

export function llmProvider(): Provider | null {
  const want = process.env.LLM_PROVIDER;
  if (want === "bedrock") return credentials() ? "bedrock" : null;
  if (want === "azure") return azureReady() ? "azure" : null;
  return azureReady() ? "azure" : credentials() ? "bedrock" : null;
}

export const llmReady = () => llmProvider() !== null;

/** A readable name for the model, shown under each brief. */
export const llmModel = () =>
  llmProvider() === "azure"
    ? process.env.AZURE_OPENAI_MODEL_LABEL || "GPT-5.6 on Azure OpenAI"
    : process.env.BEDROCK_MODEL_LABEL || "Claude Haiku 4.5 on Amazon Bedrock";

/**
 * Dollars per million tokens, for the spend figures and caps in the evals: Claude Haiku 4.5 on Bedrock, or a
 * conservative ceiling for GPT-5.6 on Azure (output includes its reasoning tokens). Read once, when imported.
 */
export const PRICE = llmProvider() === "azure" ? { input: 1.25, output: 10 } : { input: 1, output: 5 };

export interface StructuredRequest {
  system: string;
  prompt: string;
  tool: { name: string; description: string; schema: object };
  maxTokens?: number;
  timeoutMs?: number;
  temperature?: number;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

/** One Converse content block, as Bedrock sends and takes it. */
export type Block =
  | { text: string }
  | { toolUse: { toolUseId: string; name: string; input: unknown } }
  | { toolResult: { toolUseId: string; content: { text?: string; json?: unknown }[]; status?: "success" | "error" } };

export interface Message {
  role: "user" | "assistant";
  content: Block[];
}

export interface Tool {
  name: string;
  description: string;
  schema: object;
}

export interface ConverseRequest {
  system: string;
  messages: Message[];
  tools?: Tool[];
  /** "auto" lets the model answer in text; a tool name forces that tool; "any" forces some tool. */
  toolChoice?: "auto" | "any" | { name: string };
  maxTokens?: number;
  timeoutMs?: number;
  temperature?: number;
}

export interface ConverseResult {
  message: Message;
  stopReason: string;
  usage?: Usage;
}

/** One Converse turn: the building block for the brief, the reviewer and the buyer's agent. */
export async function converse(req: ConverseRequest): Promise<ConverseResult> {
  const p = llmProvider();
  if (p === "azure") return azureConverse(req);
  const creds = credentials();
  if (!creds) throw new Error("No model is configured.");
  const region = REGION();
  const url = `https://bedrock-runtime.${region}.amazonaws.com/model/${encodeURIComponent(MODEL())}/converse`;
  const choice = req.toolChoice ?? "auto";
  const body = JSON.stringify({
    system: [{ text: req.system }],
    messages: req.messages,
    ...(req.tools?.length
      ? {
          toolConfig: {
            tools: req.tools.map((t) => ({ toolSpec: { name: t.name, description: t.description, inputSchema: { json: t.schema } } })),
            toolChoice: choice === "auto" ? { auto: {} } : choice === "any" ? { any: {} } : { tool: { name: choice.name } },
          },
        }
      : {}),
    inferenceConfig: { maxTokens: req.maxTokens ?? 4000, temperature: req.temperature ?? 0.2 },
  });
  const headers = signRequest(
    { method: "POST", url, service: "bedrock", region, body, headers: { "content-type": "application/json", accept: "application/json" } },
    creds,
  );
  // Bedrock throttles bursts on this account; two short retries cover it without stalling a visitor for long.
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { method: "POST", headers, body, signal: AbortSignal.timeout(req.timeoutMs ?? 40_000) });
    const out = (await res.json().catch(() => ({}))) as {
      output?: { message?: Message };
      stopReason?: string;
      usage?: Usage;
      message?: string;
    };
    if ((res.status === 429 || res.status >= 500) && attempt < 2) {
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
      continue;
    }
    if (!res.ok || !out.output?.message) throw new Error(`Bedrock ${res.status}: ${out.message ?? JSON.stringify(out).slice(0, 300)}`);
    return { message: out.output.message, stopReason: out.stopReason ?? "", usage: out.usage };
  }
}

/**
 * The same turn on Azure OpenAI's Responses API: Converse messages become Responses input items (text, function
 * calls and their outputs), tools become function tools, and the output comes back as Converse blocks, so every
 * caller works unchanged whichever provider answers.
 */
async function azureConverse(req: ConverseRequest): Promise<ConverseResult> {
  const input: unknown[] = [];
  for (const m of req.messages) {
    const text = m.content.filter((b): b is { text: string } => "text" in b).map((b) => b.text).join("\n");
    if (text) input.push({ role: m.role, content: text });
    for (const b of m.content) {
      if ("toolUse" in b) input.push({ type: "function_call", call_id: b.toolUse.toolUseId, name: b.toolUse.name, arguments: JSON.stringify(b.toolUse.input ?? {}) });
      if ("toolResult" in b)
        input.push({
          type: "function_call_output",
          call_id: b.toolResult.toolUseId,
          output: b.toolResult.content.map((c) => (c.text !== undefined ? c.text : JSON.stringify(c.json))).join("\n"),
        });
    }
  }
  const choice = req.toolChoice ?? "auto";
  const base = process.env.AZURE_OPENAI_ENDPOINT!.replace(/\/+$/, "").replace(/\/openai(\/v1)?$/, "");
  const body = JSON.stringify({
    model: process.env.AZURE_OPENAI_DEPLOYMENT,
    instructions: req.system,
    input,
    ...(req.tools?.length
      ? {
          tools: req.tools.map((t) => ({ type: "function", name: t.name, description: t.description, parameters: t.schema, strict: false })),
          tool_choice: choice === "auto" ? "auto" : choice === "any" ? "required" : { type: "function", name: choice.name },
        }
      : {}),
    reasoning: { effort: process.env.AZURE_OPENAI_REASONING || "low" },
    // A reasoning model spends part of its budget thinking, so leave room above what the answer needs.
    max_output_tokens: Math.max(1000, (req.maxTokens ?? 4000) * 2),
    store: false,
  });
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${base}/openai/v1/responses`, {
      method: "POST",
      headers: { "api-key": process.env.AZURE_OPENAI_API_KEY!, "content-type": "application/json" },
      body,
      signal: AbortSignal.timeout(req.timeoutMs ?? 40_000),
    });
    const out = (await res.json().catch(() => ({}))) as {
      output?: { type: string; call_id?: string; name?: string; arguments?: string; content?: { type: string; text?: string }[] }[];
      usage?: { input_tokens: number; output_tokens: number };
      error?: { message?: string };
    };
    if ((res.status === 429 || res.status >= 500) && attempt < 2) {
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
      continue;
    }
    if (!res.ok) throw new Error(`Azure OpenAI ${res.status}: ${out.error?.message ?? JSON.stringify(out).slice(0, 300)}`);
    const content: Block[] = [];
    for (const o of out.output ?? []) {
      if (o.type === "message") {
        const text = (o.content ?? []).map((c) => c.text ?? "").join("");
        if (text) content.push({ text });
      } else if (o.type === "function_call" && o.name) {
        let parsed: unknown = {};
        try {
          parsed = JSON.parse(o.arguments || "{}");
        } catch {
          parsed = { _unparsed: o.arguments };
        }
        content.push({ toolUse: { toolUseId: o.call_id ?? o.name, name: o.name, input: parsed } });
      }
    }
    return {
      message: { role: "assistant", content },
      stopReason: content.some((c) => "toolUse" in c) ? "tool_use" : "end_turn",
      usage: out.usage ? { inputTokens: out.usage.input_tokens, outputTokens: out.usage.output_tokens } : undefined,
    };
  }
}

/** One forced tool call: the answer arrives as the tool's input, already JSON. */
export async function structured<T>(req: StructuredRequest): Promise<{ value: T; usage?: Usage }> {
  const out = await converse({
    system: req.system,
    messages: [{ role: "user", content: [{ text: req.prompt }] }],
    tools: [req.tool],
    toolChoice: { name: req.tool.name },
    maxTokens: req.maxTokens,
    timeoutMs: req.timeoutMs,
    temperature: req.temperature,
  });
  const use = out.message.content.find((c): c is Extract<Block, { toolUse: unknown }> => "toolUse" in c)?.toolUse;
  if (!use) throw new Error("The model answered without the brief.");
  return { value: use.input as T, usage: out.usage };
}

export interface Ping {
  ok: boolean;
  at: string;
  ms: number;
  error?: string;
}

let lastPing: Ping | null = null;

/** A four-token call, cached for ten minutes, so /api/health can say whether the model answers right now. */
export async function llmPing(maxAgeMs = 10 * 60_000): Promise<Ping | null> {
  if (!llmReady()) return null;
  if (lastPing && Date.now() - new Date(lastPing.at).getTime() < maxAgeMs) return lastPing;
  const t0 = Date.now();
  try {
    await converse({ system: "Reply with OK.", messages: [{ role: "user", content: [{ text: "OK?" }] }], maxTokens: 8, timeoutMs: 15_000 });
    lastPing = { ok: true, at: new Date().toISOString(), ms: Date.now() - t0 };
  } catch (e) {
    lastPing = { ok: false, at: new Date().toISOString(), ms: Date.now() - t0, error: (e as Error).message.slice(0, 120) };
  }
  return lastPing;
}
