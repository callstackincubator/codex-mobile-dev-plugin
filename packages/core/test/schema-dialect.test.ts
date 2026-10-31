import test from "node:test";
import assert from "node:assert/strict";
import { declareSchemaDialect, JSON_SCHEMA_2020_12 } from "../src/schema-dialect.ts";
import { createTestPlugin } from "@mobile-dev/test-support/fixtures.ts";
import { createPanel } from "../src/panel-tools.ts";
import { connectClient } from "@mobile-dev/test-support/mcp.ts";

// Keywords whose meaning differs between draft-07 and 2020-12. Relabelling the
// SDK's draft-07 output is exact only while no tool schema uses them.
const draft07Only = new Set(["definitions", "dependencies", "additionalItems"]);

function draft07Keywords(schema: unknown, path = ""): string[] {
  if (Array.isArray(schema)) return schema.flatMap((item, index) => draft07Keywords(item, `${path}/${index}`));
  if (schema === null || typeof schema !== "object") return [];
  return Object.entries(schema).flatMap(([key, value]) => {
    // Property names are data, not keywords.
    if (key === "properties" && value && typeof value === "object") return Object.entries(value).flatMap(([name, property]) => draft07Keywords(property, `${path}/properties/${name}`));
    const own = draft07Only.has(key) || (key === "items" && Array.isArray(value)) || (key === "$ref" && String(value).includes("/definitions/")) ? [`${path}/${key}`] : [];
    return [...own, ...draft07Keywords(value, `${path}/${key}`)];
  });
}

test("every tool declares JSON Schema 2020-12 and uses no draft-07-only keyword", async t => {
  const plugin = await createTestPlugin("<html></html>", { features: [createPanel()] });
  t.after(() => plugin.close());
  const client = await connectClient(t, plugin.server, { prepare: declareSchemaDialect });
  const { tools } = await client.listTools();
  assert.ok(tools.length > 40);
  for (const tool of tools) {
    for (const schema of [tool.inputSchema, tool.outputSchema]) {
      if (schema === undefined) continue;
      assert.equal(schema.$schema, JSON_SCHEMA_2020_12, tool.name);
      assert.deepEqual(draft07Keywords(schema), [], tool.name);
    }
  }
});
