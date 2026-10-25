import "server-only";
import { signRequest, type AwsCredentials } from "./aws/sigv4";

/**
 * Exhibit asks for one structured answer per case through a single forced tool call, so the brief always arrives
 * as JSON the server can check. The model is Claude Haiku 4.5 on Amazon Bedrock (the Converse API), called with
 * SigV4-signed requests from an IAM user that may invoke that one model and nothing else:
 * BEDROCK_ACCESS_KEY_ID + BEDROCK_SECRET_ACCESS_KEY, optionally BEDROCK_REGION and BEDROCK_MODEL.
 */

const REGION = () => process.env.BEDROCK_REGION || "ap-southeast-2";
const MODEL = () => process.env.BEDROCK_MODEL || "au.anthropic.claude-haiku-4-5-20251001-v1:0";

function credentials(): AwsCredentials | null {
  const accessKeyId = process.env.BEDROCK_ACCESS_KEY_ID;
  const secretAccessKey = process.env.BEDROCK_SECRET_ACCESS_KEY;
  return accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : null;
}

export const llmReady = () => credentials() !== null;

/** A readable name for the model, shown under each brief. */
export const llmModel = () => process.env.BEDROCK_MODEL_LABEL || "Claude Haiku 4.5 on Amazon Bedrock";

/** Dollars per million tokens for Claude Haiku 4.5 on Bedrock, for the spend figures in the evals. */
export const PRICE = { input: 1, output: 5 };

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
