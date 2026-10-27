import { access, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pluginHost } from "./plugin-hosts.mjs";

// Generate a snippet only; never replace the user's existing host configuration.
const { config: host } = pluginHost(process.argv[2]);
await access("dist/server.mjs");
const config = {
  mcpServers: {
    "mobile-dev": { ...host.server, command: process.execPath, args: [resolve("dist/server.mjs")] },
  },
};
await mkdir(".local-dev", { recursive: true });
const path = resolve(`.local-dev/${host.file}`);
await writeFile(path, JSON.stringify(config, null, 2) + "\n");
console.log(`Merge the mcpServers entry from ${path} into ${host.target}.`);
