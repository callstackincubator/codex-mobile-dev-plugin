import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import { WebSocket } from "ws";
import { once } from "node:events";

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
  const approvedOrigin = resource.contents[0]._meta.ui.csp.connectDomains[0];
  assert.equal(new URL(opened._meta.streamUrl).origin, approvedOrigin);
  const home = homedir();
  const certificatePath = join(home, "Library", "Application Support", "Mobile Dev", "tls", "localhost.crt");
  const ca = await readFile(certificatePath);
  async function receive(opened) {
    const socket = new WebSocket(opened._meta.streamUrl, { ca });
    const packets = new Promise((resolve, reject) => {
      let configuration = false;
      let keyframe = false;
      const timer = setTimeout(() => { reject(new Error("No H.264 configuration and keyframe received.")); }, 10000);
      socket.on("message", (data, binary) => {
        if (binary === false || data.length <= 1) return;
        if (data[0] === 1) configuration = true;
        if (data[0] === 2) keyframe = true;
        if (configuration && keyframe) { clearTimeout(timer); resolve(); }
      });
      socket.once("error", error => { clearTimeout(timer); reject(error); });
    });
    const connected = once(socket, "open");
    await Promise.all([connected, packets]);
    return socket;
  }
  const first = await receive(opened);
  const dropped = once(first, "close");
  const status = await client.callTool({ name: "mobile_list_simulators", arguments: {} });
  const baseUrl = status.structuredContent.baseUrl;
  const port = new URL(baseUrl).port;
  const { stdout: listener } = await execute("lsof", ["-t", `-iTCP:${port}`, "-sTCP:LISTEN"]);
  const pid = Number(listener.trim());
  assert.ok(Number.isInteger(pid) && pid > 1);
  const { stdout: command } = await execute("ps", ["-p", String(pid), "-o", "command="]);
  assert.ok(command.includes(`${plugin}/dist/baguette/Baguette serve`), "Only the test package's own Baguette may be stopped.");
  process.kill(pid, "SIGKILL");
  await dropped;
  const recovered = await client.callTool({ name: "mobile_stream_session", arguments: { udid, fps: 60 } });
  assert.equal(recovered.isError, undefined, JSON.stringify(recovered.content));
  assert.notEqual(recovered._meta.sessionId, sessionId);
  assert.equal(new URL(recovered._meta.streamUrl).origin, approvedOrigin);
  const socket = await receive(recovered);
  const restarted = await client.callTool({ name: "mobile_list_simulators", arguments: {} });
  assert.equal(restarted.structuredContent.connected, true);
  assert.notEqual(restarted.structuredContent.baseUrl, baseUrl);
  const closed = once(socket, "close");
  await client.callTool({ name: "mobile_stream_close", arguments: { sessionId: recovered._meta.sessionId } });
  await closed;
  console.log("The copied plugin restarted its stopped Baguette and recovered H.264 configuration and keyframes through the same shared WSS origin.");
  console.log("Closing the recovered session stopped capture. No simulator was booted, repaired, or sent input.");
} catch (error) { process.stderr.write(diagnostics); throw error; }
finally { await client?.close(); await rm(temporary, { recursive: true, force: true }); }
