import "server-only";

/**
 * Exhibit asks for one structured answer per case through a single forced tool (function) call, so the brief
 * always arrives as JSON the server can check. Two providers, picked by which keys are set:
 * - Azure OpenAI (AZURE_OPENAI_API_KEY + AZURE_OPENAI_ENDPOINT + AZURE_OPENAI_DEPLOYMENT), the default;
 * - Amazon Bedrock Converse (AWS_BEARER_TOKEN_BEDROCK), Claude Haiku 4.5.
 */

type Provider = "azure" | "bedrock";

const azureReady = () => Boolean(process.env.AZURE_OPENAI_API_KEY && process.env.AZURE_OPENAI_ENDPOINT && process.env.AZURE_OPENAI_DEPLOYMENT);
const bedrockReady = () => Boolean(process.env.AWS_BEARER_TOKEN_BEDROCK);

export const llmProvider = (): Provider | null => (azureReady() ? "azure" : bedrockReady() ? "bedrock" : null);
export const llmReady = () => llmProvider() !== null;

/** A readable name for the model, shown under each brief. */
export const llmModel = () =>
  llmProvider() === "azure"
    ? process.env.AZURE_OPENAI_MODEL_LABEL || `${process.env.AZURE_OPENAI_DEPLOYMENT} on Azure OpenAI`
    : "Claude Haiku 4.5 on Amazon Bedrock";

export interface StructuredRequest {
  system: string;
  prompt: string;
  tool: { name: string; description: string; schema: object };
  maxTokens?: number;
  timeoutMs?: number;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export async function structured<T>(req: StructuredRequest): Promise<{ value: T; usage?: Usage }> {
  const p = llmProvider();
  if (p === "azure") return azure<T>(req);
  if (p === "bedrock") return bedrock<T>(req);
  throw new Error("No model is configured.");
}

async function azure<T>(req: StructuredRequest): Promise<{ value: T; usage?: Usage }> {
  // Responses API (v1): the deployment goes in `model`; GPT-5.x takes function tools together with reasoning here.
  const base = process.env.AZURE_OPENAI_ENDPOINT!.replace(/\/+$/, "").replace(/\/openai(\/v1)?$/, "");
  const res = await fetch(`${base}/openai/v1/responses`, {
    method: "POST",
    headers: { "api-key": process.env.AZURE_OPENAI_API_KEY!, "content-type": "application/json" },
    body: JSON.stringify({
      model: process.env.AZURE_OPENAI_DEPLOYMENT,
      instructions: req.system,
      input: req.prompt,
      tools: [{ type: "function", name: req.tool.name, description: req.tool.description, parameters: req.tool.schema, strict: false }],
      tool_choice: { type: "function", name: req.tool.name },
      reasoning: { effort: process.env.AZURE_OPENAI_REASONING || "low" },
      max_output_tokens: req.maxTokens ?? 8000,
      store: false,
    }),
    signal: AbortSignal.timeout(req.timeoutMs ?? 55_000),
  });
  const body = (await res.json().catch(() => ({}))) as {
    output?: { type: string; name?: string; arguments?: string }[];
    usage?: { input_tokens: number; output_tokens: number };
    error?: { message?: string };
  };
  if (!res.ok) throw new Error(`Azure OpenAI ${res.status}: ${body.error?.message ?? JSON.stringify(body).slice(0, 300)}`);
  const call = body.output?.find((o) => o.type === "function_call" && o.name === req.tool.name);
  if (!call?.arguments) throw new Error("The model answered without the brief.");
  return {
    value: JSON.parse(call.arguments) as T,
    usage: body.usage ? { inputTokens: body.usage.input_tokens, outputTokens: body.usage.output_tokens } : undefined,
  };
}

async function bedrock<T>(req: StructuredRequest): Promise<{ value: T; usage?: Usage }> {
  const region = process.env.BEDROCK_REGION || "us-east-1";
  const model = process.env.BEDROCK_MODEL || "us.anthropic.claude-haiku-4-5-20251001-v1:0";
  const res = await fetch(`https://bedrock-runtime.${region}.amazonaws.com/model/${encodeURIComponent(model)}/converse`, {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.AWS_BEARER_TOKEN_BEDROCK}`, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      system: [{ text: req.system }],
      messages: [{ role: "user", content: [{ text: req.prompt }] }],
      toolConfig: {
        tools: [{ toolSpec: { name: req.tool.name, description: req.tool.description, inputSchema: { json: req.tool.schema } } }],
        toolChoice: { tool: { name: req.tool.name } },
      },
      inferenceConfig: { maxTokens: req.maxTokens ?? 2500, temperature: 0.2 },
    }),
    signal: AbortSignal.timeout(req.timeoutMs ?? 45_000),
  });
  const body = (await res.json().catch(() => ({}))) as {
    output?: { message?: { content: { toolUse?: { input: unknown } }[] } };
    usage?: Usage;
    message?: string;
  };
  if (!res.ok) throw new Error(`Bedrock ${res.status}: ${body.message ?? JSON.stringify(body).slice(0, 300)}`);
  const use = body.output?.message?.content.find((c) => c.toolUse)?.toolUse;
  if (!use) throw new Error("The model answered without the brief.");
  return { value: use.input as T, usage: body.usage };
}
