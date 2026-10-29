import { test } from "node:test";
import assert from "node:assert/strict";
import { strictSchema } from "../lib/strict.ts";

test("a closed schema with every field required qualifies for strict mode", () => {
  assert.equal(
    strictSchema({
      type: "object",
      additionalProperties: false,
      required: ["a", "b", "list"],
      properties: {
        a: { type: "string", enum: ["x", "y"] },
        b: { type: ["number", "null"], description: "nullable stands in for optional" },
        list: { type: "array", items: { type: "object", additionalProperties: false, required: ["n"], properties: { n: { type: "integer" } } } },
      },
    }),
    true,
  );
});

test("an open object, an optional field or a rejected keyword doesn't", () => {
  assert.equal(strictSchema({ type: "object", required: ["a"], properties: { a: { type: "string" } } }), false);
  assert.equal(strictSchema({ type: "object", additionalProperties: false, required: ["a"], properties: { a: { type: "string" }, b: { type: "string" } } }), false);
  assert.equal(strictSchema({ type: "object", additionalProperties: false, required: ["a"], properties: { a: { type: "string", minLength: 3 } } }), false);
  assert.equal(
    strictSchema({ type: "object", additionalProperties: false, required: ["a"], properties: { a: { type: "array", items: { type: "object", properties: { x: { type: "string" } } } } } }),
    false,
  );
});
