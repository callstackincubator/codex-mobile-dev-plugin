import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { Icon, ListToolsResult } from "@modelcontextprotocol/sdk/types.js";

const phone = `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24"><title>ai-phone-01</title><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"><path d="M18 11.5V15c0 3.3 0 4.95-1.025 5.975S14.3 22 11 22s-4.95 0-5.975-1.025S4 18.3 4 15V9c0-3.3 0-4.95 1.025-5.975S7.7 2 11 2c.747 0 .41 0 1 .012"/><path d="M11.125 18.75H11m.25 0a.25.25 0 1 1-.5 0a.25.25 0 0 1 .5 0m5.724-16.729c.006-.028.046-.028.052 0a3.79 3.79 0 0 0 2.953 2.953c.028.006.028.046 0 .052a3.79 3.79 0 0 0-2.953 2.953c-.006.028-.046.028-.052 0a3.79 3.79 0 0 0-2.953-2.953c-.028-.006-.028-.046 0-.052a3.79 3.79 0 0 0 2.953-2.953"/></g></svg>`;
export const PHONE_ICONS: Icon[] = [{ src: `data:image/svg+xml;base64,${Buffer.from(phone).toString("base64")}`, mimeType: "image/svg+xml", sizes: ["any"] }];

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
