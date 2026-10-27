import { access, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

// Generate a snippet only; never replace the user's existing Cursor configuration.
await access("dist/server.mjs");
const config = {
  mcpServers: {
    "mobile-dev": {
      type: "stdio",
      command: process.execPath,
      args: [resolve("dist/server.mjs")],
    },
  },
};
await mkdir(".local-dev", { recursive: true });
const path = resolve(".local-dev/cursor-mcp.json");
await writeFile(path, JSON.stringify(config, null, 2) + "\n");
console.log(`Merge the mcpServers entry from ${path} into ~/.cursor/mcp.json, then reload Cursor.`);
