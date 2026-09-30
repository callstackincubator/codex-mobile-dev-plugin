import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";

const udid = process.argv[2];
if (!udid) throw new Error("Pass the UDID of an already booted simulator. This test never boots a device.");
const temporary = await mkdtemp(join(tmpdir(), "mobile-dev-reconnect-test-"));
const plugin = join(temporary, "mobile-dev");
const execute = promisify(execFile);
let client;
let diagnostics = "";
try {
  await cp(resolve("release/marketplace/plugins/mobile-dev"), plugin, { recursive: true });
  const transport = new StdioClientTransport({ command: process.execPath, args: ["dist/server.mjs"], cwd: plugin, stderr: "pipe" });
  transport.stderr?.on("data", data => { diagnostics = (diagnostics + data).slice(-8000); });
  client = new Client({ name: "mobile-dev-reconnect-test", version: "1" });
  await client.connect(transport);
  const tools = await client.listTools();
  const entrypoint = tools.tools.find(tool => tool.name === "mobile_open_simulator");
  const resource = await client.readResource({ uri: entrypoint._meta.ui.resourceUri });
  const opened = await client.callTool({ name: "mobile_stream_session", arguments: { udid, fps: 60 } });
  assert.equal(opened.isError, undefined, JSON.stringify(opened.content));
  const sessionId = opened._meta.sessionId;
  assert.deepEqual(resource.contents[0]._meta.ui.csp.connectDomains, []);
  async function receive(opened) {
    const result = await client.readResource({ uri: `${opened._meta.frameUri}?after=0` });
    const image = result.contents.find(item => item.mimeType === "image/jpeg" && "blob" in item);
    assert.ok(image, JSON.stringify(result));
    const bytes = Buffer.from(image.blob, "base64");
    assert.equal(bytes[0], 0xff);
    assert.equal(bytes[1], 0xd8);
    assert.ok(image._meta.sequence > 0);
    assert.ok(image._meta.serverWaitMs >= 0);
    return image._meta.sequence;
  }
  const firstSequence = await receive(opened);
  const status = await client.callTool({ name: "mobile_list_simulators", arguments: {} });
  const baseUrl = status.structuredContent.baseUrl;
  const port = new URL(baseUrl).port;
  const { stdout: listener } = await execute("lsof", ["-t", `-iTCP:${port}`, "-sTCP:LISTEN"]);
  const pid = Number(listener.trim());
  assert.ok(Number.isInteger(pid) && pid > 1);
  const { stdout: command } = await execute("ps", ["-p", String(pid), "-o", "command="]);
  assert.ok(command.includes(`${plugin}/dist/baguette/Baguette serve`), "Only the test package's own Baguette may be stopped.");
  process.kill(pid, "SIGKILL");
  const deadline = Date.now() + 5000;
  let disconnected = false;
  while (Date.now() < deadline) {
    const result = await client.readResource({ uri: `${opened._meta.frameUri}?after=${firstSequence}` });
    const status = result.contents.find(item => item.mimeType === "application/json" && "text" in item);
    if (status && JSON.parse(status.text).state === "failed") { disconnected = true; break; }
  }
  assert.equal(disconnected, true);
  await client.callTool({ name: "mobile_stream_close", arguments: { sessionId } });
  const recovered = await client.callTool({ name: "mobile_stream_session", arguments: { udid, fps: 60 } });
  assert.equal(recovered.isError, undefined, JSON.stringify(recovered.content));
  assert.notEqual(recovered._meta.sessionId, sessionId);
  await receive(recovered);
  const restarted = await client.callTool({ name: "mobile_list_simulators", arguments: {} });
  assert.equal(restarted.structuredContent.connected, true);
  assert.notEqual(restarted.structuredContent.baseUrl, baseUrl);
  await client.callTool({ name: "mobile_stream_close", arguments: { sessionId: recovered._meta.sessionId } });
  const closed = await client.readResource({ uri: `${recovered._meta.frameUri}?after=0` });
  assert.equal(JSON.parse(closed.contents[0].text).state, "failed");
  console.log("The copied plugin restarted its stopped Baguette and recovered JPEG frames through MCP resource reads without certificate setup.");
  console.log("Closing the recovered session stopped capture. No simulator was booted, repaired, or sent input.");
} catch (error) { process.stderr.write(diagnostics); throw error; }
finally { await client?.close(); await rm(temporary, { recursive: true, force: true }); }
