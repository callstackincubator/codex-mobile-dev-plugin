import { readFile } from "node:fs/promises";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createPlugin } from "./plugin.ts";

const html = await readFile(new URL("./app.html", import.meta.url), "utf8");
const plugin = await createPlugin(html);
const transport = new StdioServerTransport();
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await plugin.close();
}
transport.onclose = () => { void close(); };
process.stdin.on("end", () => { void close(); });
process.on("SIGINT", () => { void close(); });
process.on("SIGTERM", () => { void close(); });
process.on("uncaughtException", error => { console.error(error); void close().finally(() => { process.exitCode = 1; }); });
await plugin.server.connect(transport);
