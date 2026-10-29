import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// Helpers for the smoke scripts that start a Mobile Dev server over stdio.

/** The value after `--name` on the command line, if any. */
export function option(name, args = process.argv) {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

/**
 * Starts an MCP server over stdio and connects a client to it. The server's stderr is
 * kept for `diagnostics()`, its last lines, or with `stderr: "inherit"` streamed.
 * `close()` closes the client and stops the server.
 */
export async function startServer({ command = process.execPath, args, cwd, env, name = "mobile-dev-smoke", capabilities, stderr = "tail" }) {
  const transport = new StdioClientTransport({ command, args, cwd, env, stderr: "pipe" });
  let tail = "";
  transport.stderr?.on("data", chunk => {
    if (stderr === "inherit") process.stderr.write(chunk);
    else tail = (tail + chunk).slice(-8000);
  });
  const client = new Client({ name, version: "1" }, capabilities && { capabilities });
  const close = async () => { await client.close(); await transport.close(); };
  try { await client.connect(transport); }
  catch (error) {
    await close();
    if (tail) console.error(tail);
    throw error;
  }
  return { client, diagnostics: () => tail, close };
}

/**
 * Runs `fn(client)` against a server `startServer` starts, then closes it. When `fn`
 * fails, the server's last stderr lines are printed with the error.
 */
export async function withServer(options, fn) {
  const server = await startServer(options);
  try { return await fn(server.client); }
  catch (error) {
    if (server.diagnostics()) console.error(server.diagnostics());
    throw error;
  } finally { await server.close(); }
}

/** Calls a tool and returns its result, throwing the tool's text when it reports an error. */
export async function call(client, name, args = {}, options) {
  const result = await client.callTool({ name, arguments: args }, undefined, options);
  if (result.isError) throw new Error(result.content.filter(item => item.type === "text").map(item => item.text).join("\n") || JSON.stringify(result.content));
  return result;
}

/** Every tool the server lists, across pages. */
export async function listAllTools(client) {
  const tools = [];
  let cursor;
  do {
    const page = await client.listTools({ cursor });
    tools.push(...page.tools);
    cursor = page.nextCursor;
  } while (cursor !== undefined);
  return tools;
}

/**
 * Reads a cursor-paged JSON resource, such as a log or CPU session's: each batch in
 * turn, each read asking for what came after the previous batch's `cursor`.
 */
export async function* readBatches(client, uri) {
  const url = new URL(uri);
  while (true) {
    const resource = await client.readResource({ uri: url.href });
    const batch = JSON.parse(resource.contents.find(item => "text" in item).text);
    yield batch;
    url.searchParams.set("after", String(batch.cursor));
  }
}

/**
 * Copies a plugin folder into a new temporary directory, as a host's install cache
 * would, at `<temporary>/<folder>`. `remove()` deletes the temporary directory.
 */
export async function tempPlugin(source, { prefix = "mobile-dev-smoke-", folder = "mobile-dev" } = {}) {
  const temporary = await mkdtemp(join(tmpdir(), prefix));
  const plugin = join(temporary, folder);
  try { await cp(resolve(source), plugin, { recursive: true, verbatimSymlinks: true }); }
  catch (error) { await rm(temporary, { recursive: true, force: true }); throw error; }
  return { temporary, plugin, remove: () => rm(temporary, { recursive: true, force: true }) };
}
