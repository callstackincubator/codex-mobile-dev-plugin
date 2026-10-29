import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pluginHost, pluginRelease } from "./plugin-hosts.mjs";

// Generate a snippet only; never replace the user's existing host configuration.
//   node tooling/plugin-config.mjs <claude|cursor>
const name = process.argv[2];
const host = pluginHost(name);
// A host with its own server runs it from its package; the others run the shared build.
const { name: pluginName } = JSON.parse(await readFile(`${host.app}/${host.manifest}/plugin.json`, "utf8"));
const server = resolve(host.build ? `${pluginRelease(host, pluginName).plugin}/dist/server.mjs` : "dist/server.mjs");
try { await access(server); }
catch { throw new Error(host.build ? `Run npm run build and npm run package:${name} first.` : "Run npm run build first."); }
const config = {
  mcpServers: {
    "mobile-dev": { ...host.config.server, command: process.execPath, args: [server] },
  },
};
await mkdir(".local-dev", { recursive: true });
const path = resolve(`.local-dev/${host.config.file}`);
await writeFile(path, JSON.stringify(config, null, 2) + "\n");
console.log(`Merge the mcpServers entry from ${path} into ${host.config.target}.`);
