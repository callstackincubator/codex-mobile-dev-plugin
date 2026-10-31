import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { pluginUpdateSchema } from "../shared/plugin-updates.ts";
import type { PluginUpdates } from "./plugin-updates.ts";

export function registerPluginUpdateTools(server: McpServer, updates: PluginUpdates) {
  const visibility: ("app" | "model")[] = ["app"];
  const metadata = { ui: { visibility } };
  const outputSchema = { update: pluginUpdateSchema };
  registerAppTool(server, "mobile_check_plugin_update", {
    title: "Check Mobile Dev updates", description: "Read the published Mobile Dev version from the Codex plugin store.", inputSchema: {},
    outputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true }, _meta: metadata,
  }, async () => {
    const update = await updates.check();
    return { content: [], structuredContent: { update } };
  });
  registerAppTool(server, "mobile_migrate_plugin_to_store", {
    title: "Finish Mobile Dev store migration", description: "After the user installs Mobile Dev from the plugin store and clicks Finish migration, verify that installation and remove the GitHub plugin and marketplace. Restart Codex afterward.", inputSchema: {},
    outputSchema,
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true }, _meta: metadata,
  }, async () => {
    try {
      const update = await updates.migrate();
      return { content: [], structuredContent: { update } };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not migrate Mobile Dev. Try again.";
      return { isError: true, content: [{ type: "text", text: message }] };
    }
  });
}
