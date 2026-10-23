import { access } from "node:fs/promises";
import { resolve } from "node:path";

// Generate data only. The caller decides where to save it; user settings are
// never overwritten. Resolve paths now so GUI hosts need no shell PATH or cwd.
export async function localHostConfig(host, root = ".", node = process.execPath) {
  if (host !== "cursor" && host !== "vscode") throw new Error("Unsupported editor host.");
  const server = resolve(root, "dist/server.mjs");
  await access(server);
  const entry = { type: "stdio", command: node, args: [server], env: { MOBILE_DEV_HOST: host } };
  return host === "vscode" ? { servers: { "mobile-dev": entry } } : { mcpServers: { "mobile-dev": entry } };
}
