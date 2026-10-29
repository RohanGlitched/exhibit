/**
 * Whether a tool's JSON schema can be sent with `strict: true` to OpenAI-style function calling (Azure OpenAI's
 * Responses API): every object closed (`additionalProperties: false`) with every property listed in `required`
 * (an optional field is written as nullable instead), and none of the keywords strict mode rejects. A schema
 * that doesn't qualify is sent as before, unenforced, and the caller checks the shape in code.
 */

const REJECTED = new Set(["minLength", "maxLength", "pattern", "format", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "minItems", "maxItems", "uniqueItems", "minProperties", "maxProperties", "patternProperties", "default", "oneOf", "allOf", "not", "if", "then", "else"]);

const typesOf = (n: Record<string, unknown>) => (Array.isArray(n.type) ? n.type : [n.type]).filter((t): t is string => typeof t === "string");

export function strictSchema(schema: unknown): boolean {
  const ok = (node: unknown): boolean => {
    if (!node || typeof node !== "object" || Array.isArray(node)) return false;
    const n = node as Record<string, unknown>;
    if (Object.keys(n).some((k) => REJECTED.has(k))) return false;
    if (Array.isArray(n.anyOf)) return n.anyOf.every(ok);
    const types = typesOf(n);
    if (!types.length && !Array.isArray(n.enum)) return false;
    if (types.includes("object")) {
      const props = n.properties;
      if (!props || typeof props !== "object") return false;
      if (n.additionalProperties !== false) return false;
      const keys = Object.keys(props);
      const required = Array.isArray(n.required) ? n.required : [];
      if (keys.length !== required.length || !keys.every((k) => required.includes(k))) return false;
      if (!Object.values(props).every(ok)) return false;
    }
    if (types.includes("array") && !ok(n.items)) return false;
    return true;
  };
  return ok(schema);
}
