import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { Icon, ListToolsResult } from "@modelcontextprotocol/sdk/types.js";

const phone = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="#8e8e93" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="10" height="16" rx="2.5"/><path d="M8 4.5h4M9.5 15.5h1"/></svg>`;
export const PHONE_ICONS: Icon[] = [{ src: `data:image/svg+xml;base64,${Buffer.from(phone).toString("base64")}`, mimeType: "image/svg+xml", sizes: ["20x20"] }];

// SDK 1.31 omits icons from tools/list. Preserve its handler and all other fields.
export function addToolIcons(server: McpServer, icons: Record<string, Icon[]>) {
  const register = server.server.setRequestHandler.bind(server.server);
  server.server.setRequestHandler = (schema, handler) => {
    if (schema !== ListToolsRequestSchema) return register(schema, handler);
    register(schema, async (request, extra) => {
      const result = await handler(request, extra) as ListToolsResult;
      return { ...result, tools: result.tools.map(tool => icons[tool.name] ? { ...tool, icons: icons[tool.name] } : tool) };
    });
  };
}
