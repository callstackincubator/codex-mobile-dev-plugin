import { execFile } from "node:child_process";
import { promisify } from "node:util";
import assert from "node:assert/strict";
import { pluginHost, pluginRelease } from "./plugin-hosts.mjs";
import { tempPlugin, withServer } from "./lib/mcp-smoke.mjs";

const udid = process.argv[2];
if (!udid) throw new Error("Pass the UDID of an already booted simulator. This test never boots a device.");
const { plugin, remove } = await tempPlugin(pluginRelease(pluginHost("codex")).plugin, { prefix: "mobile-dev-reconnect-test-" });
const execute = promisify(execFile);
try {
  await withServer({ args: ["dist/server.mjs"], cwd: plugin, name: "mobile-dev-reconnect-test" }, async client => {
    const opened = await client.callTool({ name: "mobile_stream_session", arguments: { udid, fps: 10 } });
    assert.equal(opened.isError, undefined, JSON.stringify(opened.content));
    const sessionId = opened._meta.sessionId;
    const uri = new URL(opened._meta.frameUri);
    const first = await client.readResource({ uri: uri.href });
    const sequence = first.contents[0]._meta.sequence;
    assert.equal(first.contents[0].mimeType, "image/jpeg");
    const status = await client.callTool({ name: "mobile_list_simulators", arguments: {} });
    const baseUrl = status.structuredContent.baseUrl;
    const port = new URL(baseUrl).port;
    const { stdout: listener } = await execute("lsof", ["-t", `-iTCP:${port}`, "-sTCP:LISTEN"]);
    const pid = Number(listener.trim());
    assert.ok(Number.isInteger(pid) && pid > 1);
    const { stdout: command } = await execute("ps", ["-p", String(pid), "-o", "command="]);
    assert.ok(command.includes(`${plugin}/dist/baguette/Baguette serve`), "Only the test package's own Baguette may be stopped.");
    process.kill(pid, "SIGKILL");
    uri.searchParams.set("after", String(sequence));
    const deadline = Date.now() + 20000;
    let recovered;
    while (Date.now() < deadline) {
      const frame = await client.readResource({ uri: uri.href });
      if (frame.contents[0].mimeType === "image/jpeg") { recovered = frame.contents[0]; break; }
    }
    assert.ok(recovered, "Capture did not recover.");
    assert.ok(recovered._meta.sequence > sequence);
    const restarted = await client.callTool({ name: "mobile_list_simulators", arguments: {} });
    assert.equal(restarted.structuredContent.connected, true);
    assert.notEqual(restarted.structuredContent.baseUrl, baseUrl);
    await client.callTool({ name: "mobile_stream_close", arguments: { sessionId } });
    const closed = await client.readResource({ uri: uri.href });
    assert.equal(JSON.parse(closed.contents[0].text).state, "failed");
    assert.match(JSON.parse(closed.contents[0].text).error, /expired or closed/);
    console.log("The copied plugin restarted its own stopped Baguette and recovered JPEG capture with the same session and increasing frame sequence.");
    console.log("Closing the recovered session stopped its capture. No simulator was booted, repaired, or sent input.");
  });
} finally { await remove(); }
