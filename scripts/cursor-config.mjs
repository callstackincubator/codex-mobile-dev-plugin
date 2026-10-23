import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { localHostConfig } from "./local-host-config.mjs";

const config = await localHostConfig("cursor");
await mkdir(".local-dev", { recursive: true });
const path = resolve(".local-dev/cursor-mcp.json");
await writeFile(path, JSON.stringify(config, null, 2) + "\n");
console.log(`Merge the mobile-dev entry from ${path} into ~/.cursor/mcp.json or your project's .cursor/mcp.json, preserving existing servers.`);
