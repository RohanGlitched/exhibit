/**
 * AG Studio's agents speak the OpenAI Responses wire format (components/studio/adapter.ts, kept close to AG's
 * own example). Behind them is lib/llm.ts's Converse-shaped call (GPT-5.6 on Azure, or Claude Haiku 4.5 on Bedrock). These two pure
 * functions translate one turn each way: a Responses request into a Converse request, and a Converse answer
 * into the Responses stream events the adapter reads. No I/O, so they are unit-tested.
 */

export type Block =
  | { text: string }
  | { toolUse: { toolUseId: string; name: string; input: unknown } }
  | { toolResult: { toolUseId: string; content: { text: string }[]; status?: "success" | "error" } };

export interface Message {
  role: "user" | "assistant";
  content: Block[];
}

export interface Tool {
  name: string;
  description: string;
  schema: object;
}

export interface ConverseTurn {
  messages: Message[];
  tools: Tool[];
  toolChoice: "auto" | "any" | { name: string };
}

type Item = Record<string, unknown>;

const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : JSON.stringify(v));

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((c: Item) => (typeof c?.text === "string" ? c.text : typeof c?.refusal === "string" ? c.refusal : ""))
    .filter(Boolean)
    .join("\n");
}

function parseArgs(raw: unknown): unknown {
  if (raw && typeof raw === "object") return raw;
  try {
    const v = JSON.parse(str(raw) || "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

/** Bedrock tool-use ids allow letters, digits, "_" and "-", up to 64 characters. */
const safeId = (id: unknown) => str(id).replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64) || "call";

/**
 * A Responses request's input items as Converse messages: user and assistant text, function calls as toolUse
 * in the assistant's message, their outputs as toolResult in the user's. Neighbouring items from the same side
 * are merged, since Converse wants the two sides to alternate and to open with the user.
 */
export function toConverse(body: { input?: unknown; tools?: unknown; tool_choice?: unknown; text?: unknown }): ConverseTurn {
  const items = (Array.isArray(body.input) ? body.input : []) as Item[];
  const out: Message[] = [];
  const push = (role: Message["role"], block: Block) => {
    const last = out.at(-1);
    if (last && last.role === role) last.content.push(block);
    else out.push({ role, content: [block] });
  };

  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const type = item.type ?? (item.role ? "message" : undefined);
    if (type === "message") {
      const text = textOf(item.content).trim();
      if (!text) continue;
      push(item.role === "assistant" ? "assistant" : "user", { text });
    } else if (type === "function_call") {
      push("assistant", { toolUse: { toolUseId: safeId(item.call_id), name: str(item.name), input: parseArgs(item.arguments) } });
    } else if (type === "function_call_output") {
      const text = textOf(item.output) || str(item.output) || "(no output)";
      push("user", { toolResult: { toolUseId: safeId(item.call_id), content: [{ text }] } });
    }
    // Reasoning items belong to the provider that made them; they are not replayed.
  }

  // Converse opens with the user and ends with the user (a question, or the tools' results).
  if (out[0]?.role !== "user") out.unshift({ role: "user", content: [{ text: "Continue." }] });
  if (out.at(-1)?.role !== "user") out.push({ role: "user", content: [{ text: "Continue." }] });

  const tools: Tool[] = (Array.isArray(body.tools) ? (body.tools as Item[]) : [])
    .filter((t) => t && (t.type === "function" || t.type == null) && typeof t.name === "string")
    .map((t) => ({
      name: str(t.name),
      description: str(t.description) || str(t.name),
      schema: t.parameters && typeof t.parameters === "object" ? (t.parameters as object) : { type: "object", properties: {} },
    }));

  // Converse refuses tool blocks in a request that offers no tools, so a toolless turn reads them as text.
  if (tools.length === 0) {
    for (const m of out)
      m.content = m.content.map((b): Block =>
        "toolUse" in b ? { text: `[called ${b.toolUse.name} ${JSON.stringify(b.toolUse.input)}]` } : "toolResult" in b ? { text: `[result: ${b.toolResult.content.map((c) => c.text).join(" ")}]` } : b,
      );
  }

  const choice = body.tool_choice;
  const toolChoice: ConverseTurn["toolChoice"] =
    choice === "required"
      ? "any"
      : choice && typeof choice === "object" && typeof (choice as Item).name === "string"
        ? { name: str((choice as Item).name) }
        : "auto";

  return { messages: out, tools, toolChoice };
}

/** One server-sent event payload, as the adapter's ResponseStreamTranslator reads it. */
export type StreamEvent = Record<string, unknown> & { type: string };

/**
 * A finished Converse answer as the Responses stream events for it: each text block a message item and each
 * toolUse a function_call item (added, delta, done), then response.completed carrying the whole output.
 */
export function toResponsesEvents(
  message: { content: Block[] } | undefined,
  opts: { id: string; model: string; usage?: { inputTokens?: number; outputTokens?: number }; stopReason?: string },
): StreamEvent[] {
  const events: StreamEvent[] = [];
  const output: Item[] = [];
  let n = 0;
  for (const block of message?.content ?? []) {
    if ("text" in block && block.text.trim()) {
      const id = `msg_${opts.id}_${n++}`;
      const done = { type: "message", id, role: "assistant", status: "completed", content: [{ type: "output_text", text: block.text, annotations: [] }] };
      events.push({ type: "response.output_item.added", item: { ...done, status: "in_progress", content: [] } });
      events.push({ type: "response.output_text.delta", item_id: id, delta: block.text });
      events.push({ type: "response.output_item.done", item: done });
      output.push(done);
    } else if ("toolUse" in block) {
      const id = `fc_${opts.id}_${n++}`;
      const args = JSON.stringify(block.toolUse.input ?? {});
      const done = { type: "function_call", id, call_id: block.toolUse.toolUseId, name: block.toolUse.name, arguments: args, status: "completed" };
      events.push({ type: "response.output_item.added", item: { ...done, arguments: "", status: "in_progress" } });
      events.push({ type: "response.function_call_arguments.delta", item_id: id, delta: args });
      events.push({ type: "response.output_item.done", item: done });
      output.push(done);
    }
  }
  const input = opts.usage?.inputTokens ?? 0;
  const outTokens = opts.usage?.outputTokens ?? 0;
  if (output.length === 0) {
    events.push({
      type: "response.failed",
      response: { id: opts.id, status: "failed", error: { code: "empty", message: opts.stopReason === "max_tokens" ? "The answer ran too long. Ask for less at once." : "The model returned nothing. Try again." } },
    });
    return events;
  }
  events.push({
    type: "response.completed",
    response: {
      id: opts.id,
      object: "response",
      created_at: Math.floor(Date.now() / 1000),
      model: opts.model,
      status: "completed",
      output,
      usage: { input_tokens: input, output_tokens: outTokens, total_tokens: input + outTokens },
    },
  });
  return events;
}
