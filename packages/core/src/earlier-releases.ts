import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import type { ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";

const releaseSegment = /^(?:\d+\.\d+\.\d+|v[1-6])$/;

/** Codex keeps the addresses of cards and side tabs opened before an update, so earlier releases' addresses serve the current UI. */
export function registerEarlierReleases(server: McpServer, name: string, page: string, read: (uri: URL) => Promise<ReadResourceResult>) {
  const template = new ResourceTemplate(`ui://mobile-dev/{release}/${page}.html`, { list: undefined });
  server.registerResource(name, template, { mimeType: RESOURCE_MIME_TYPE }, (uri, { release }) => {
    if (typeof release !== "string" || !releaseSegment.test(release)) throw new McpError(ErrorCode.InvalidParams, `Resource ${uri} not found`);
    return read(uri);
  });
}
