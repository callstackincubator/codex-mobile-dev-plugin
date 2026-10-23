import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

const DRAFT_07 = "http://json-schema.org/draft-07/schema#";
export const JSON_SCHEMA_2020_12 = "https://json-schema.org/draft/2020-12/schema";

/**
 * The SDK labels every tool schema draft-07, but MCP clients validate JSON Schema
 * 2020-12, and Claude Desktop rejects a tool whose output schema names another
 * dialect. Our schemas use no keyword whose meaning differs between the two (a test
 * checks), so declaring 2020-12 describes them exactly.
 */
export function declareSchemaDialect(transport: Transport) {
  const send = transport.send.bind(transport);
  transport.send = (message, options) => {
    const tools = "result" in message ? (message.result as { tools?: unknown }).tools : undefined;
    if (Array.isArray(tools)) {
      for (const tool of tools as Array<{ inputSchema?: { $schema?: string }; outputSchema?: { $schema?: string } }>) {
        for (const schema of [tool.inputSchema, tool.outputSchema]) if (schema?.$schema === DRAFT_07) schema.$schema = JSON_SCHEMA_2020_12;
      }
    }
    return send(message, options);
  };
}
