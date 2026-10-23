import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { localHostConfig } from "./local-host-config.mjs";

const config = await localHostConfig("vscode");
await mkdir(".local-dev", { recursive: true });
const path = resolve(".local-dev/vscode-mcp.json");
await writeFile(path, JSON.stringify(config, null, 2) + "\n");
console.log(`Merge the mobile-dev entry from ${path} into VS Code's local user-profile mcp.json or your project's .vscode/mcp.json, preserving existing servers.`);
