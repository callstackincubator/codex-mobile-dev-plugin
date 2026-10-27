import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

// Generate a snippet only; never replace the user's existing Claude configuration.
await access("dist/server.mjs");
const manifest = JSON.parse(await readFile("apps/claude/manifest.json", "utf8"));
const config = {
  mcpServers: {
    "mobile-dev": {
      command: process.execPath,
      args: [resolve(manifest.server.entry_point)],
    },
  },
};
await mkdir(".local-dev", { recursive: true });
const path = resolve(".local-dev/claude-desktop-config.json");
await writeFile(path, JSON.stringify(config, null, 2) + "\n");
console.log(`Merge the mcpServers entry from ${path} into Claude Desktop Settings > Developer > Edit Config, then fully restart Claude.`);
