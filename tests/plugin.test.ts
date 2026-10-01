import { SENTRY_ORIGIN } from "../src/shared/telemetry.ts";
import { setImmediate } from "node:timers/promises";
import { SimulatorInputService } from "../src/server/simulator-input.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { OpenAIUiToolMetadataSchema, OpenAIUiResourceMetadataSchema } from "@openai/mcp-extensions/server";
import { APP_URI, WORKSPACE_URI } from "../src/server/plugin.ts";
import { Baguette } from "../src/server/baguette.ts";
import { parseBaseUrl } from "../src/shared/protocol.ts";
import { createTestPlugin, fakeBaguette, fakeSimulatorInput, UDID, OTHER_UDID, SCREEN, PNG } from "./fixtures.ts";

test("live UI reads use MCP and allow only Sentry browser connections", async t => {
  let revision = "a".repeat(64);
  const plugin = await createTestPlugin(async () => ({ html: '<html data-view="panel">jonas</html>', liveRevision: revision }));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "dev-panel-test", version: "1" });
  t.after(async () => { await client.close(); await plugin.close(); });
  await plugin.server.connect(serverTransport);
  await client.connect(clientTransport);
  const first = await client.readResource({ uri: APP_URI });
  assert.deepEqual(first.contents[0]._meta?.ui, { csp: { connectDomains: [SENTRY_ORIGIN], resourceDomains: [] } });
  const uri = `ui://mobile-dev/live?after=${revision}`;
  const unchanged = await client.readResource({ uri });
  assert.deepEqual(JSON.parse(unchanged.contents[0].text as string), { revision });
  revision = "b".repeat(64);
  const changed = await client.readResource({ uri });
  assert.deepEqual(JSON.parse(changed.contents[0].text as string), { revision, html: '<html data-view="panel">jonas</html>' });
});

test("environment overrides apply to both initial UI resources and live reload", async t => {
  const previous = process.env.MOBILE_DEV_ENVIRONMENT;
  process.env.MOBILE_DEV_ENVIRONMENT = "release";
  const html = '<html><meta name="mobile-dev-environment" content="development"></html>';
  const revision = "a".repeat(64);
  const plugin = await createTestPlugin(async () => ({ html, liveRevision: revision }));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "telemetry-environment-test", version: "1" });
  t.after(async () => {
    if (previous === undefined) delete process.env.MOBILE_DEV_ENVIRONMENT;
    else process.env.MOBILE_DEV_ENVIRONMENT = previous;
    await client.close();
    await plugin.close();
  });
  await plugin.server.connect(serverTransport);
  await client.connect(clientTransport);
  const initial = await client.readResource({ uri: APP_URI });
  const initialText = initial.contents[0].text;
  assert.ok(typeof initialText === "string");
  assert.match(initialText, /mobile-dev-environment" content="release"/);
  const live = await client.readResource({ uri: "ui://mobile-dev/live?after=old" });
  const liveText = live.contents[0].text;
  assert.ok(typeof liveText === "string");
  const update = JSON.parse(liveText);
  assert.match(update.html, /mobile-dev-environment" content="release"/);
  process.env.MOBILE_DEV_ENVIRONMENT = "development";
  const development = await client.readResource({ uri: APP_URI });
  const developmentText = development.contents[0].text;
  assert.ok(typeof developmentText === "string");
  assert.match(developmentText, /mobile-dev-environment" content="development"/);
});

test("cached side tabs load the current UI through old resource addresses", async t => {
  const html = "<!doctype html><title>Current simulator</title><canvas></canvas>";
  const plugin = await createTestPlugin(html);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "cached-panel-test", version: "1" });
  t.after(async () => { await client.close(); await plugin.close(); });
  await plugin.server.connect(serverTransport);
  await client.connect(clientTransport);
  assert.equal(APP_URI, "ui://mobile-dev/0.1.75/simulator.html");
  const previousPanel = await client.readResource({ uri: "ui://mobile-dev/0.1.52/simulator.html" });
  assert.equal(previousPanel.contents[0].text, html);
  for (const uri of [APP_URI, "ui://mobile-dev/0.1.44/simulator.html", "ui://mobile-dev/0.1.43/simulator.html", "ui://mobile-dev/0.1.42/simulator.html", "ui://mobile-dev/0.1.41/simulator.html", "ui://mobile-dev/0.1.40/simulator.html", "ui://mobile-dev/0.1.39/simulator.html", "ui://mobile-dev/0.1.38/simulator.html", "ui://mobile-dev/0.1.37/simulator.html", "ui://mobile-dev/0.1.36/simulator.html", "ui://mobile-dev/0.1.35/simulator.html", "ui://mobile-dev/0.1.34/simulator.html", "ui://mobile-dev/0.1.33/simulator.html", "ui://mobile-dev/0.1.24/mcp-stream/simulator.html", "ui://mobile-dev/0.1.21/simulator.html", "ui://mobile-dev/0.1.20/simulator.html", "ui://mobile-dev/simulator.html", ...[1, 2, 3, 4, 5, 6].map(version => `ui://mobile-dev/v${version}/simulator.html`)]) {
    const { contents } = await client.readResource({ uri });
    assert.equal(contents[0].uri, uri);
    assert.equal(contents[0].mimeType, "text/html;profile=mcp-app");
    assert.equal(contents[0].text, html);
    OpenAIUiResourceMetadataSchema.parse(contents[0]._meta?.["openai/ui"]);
  }
  await assert.rejects(client.readResource({ uri: "ui://mobile-dev/v999/simulator.html" }), /not found/);
});

test("MCP tools expose native entrypoints and complete the simulator workflow", async t => {
  const fake = await fakeBaguette();
  const plugin = await createTestPlugin('<!doctype html><html data-view="panel" data-layout="stacked"><title>Mobile Dev</title></html>', new Baguette(fake.url), fakeSimulatorInput());
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1" });
  t.after(async () => { await client.close(); await plugin.close(); await fake.close(); });
  await plugin.server.connect(serverTransport);
  await client.connect(clientTransport);
  const tools = await client.listTools();
  const open = tools.tools.find(tool => tool.name === "mobile_open_simulator")!;
  assert.equal(tools.tools.find(tool => tool.name === "mobile_list_simulators")?.icons, undefined);
  const metadata = OpenAIUiToolMetadataSchema.parse(open._meta?.["openai/ui"]);
  assert.deepEqual(metadata.entrypoints?.map(item => item.type), ["thread"]);
  const workspace = tools.tools.find(tool => tool.name === "mobile_open_workspace")!;
  const workspaceMetadata = OpenAIUiToolMetadataSchema.parse(workspace._meta?.["openai/ui"]);
  assert.deepEqual(workspaceMetadata.entrypoints?.map(item => item.type), ["global"]);
  for (const tool of [open, workspace]) {
    // The desktop host rejects unknown openai/ui keys, unlike the SDK parser.
    assert.deepEqual(Object.keys(tool._meta?.["openai/ui"] as object), ["entrypoints"]);
    assert.equal(tool.icons?.[0].mimeType, "image/svg+xml");
    const svg = Buffer.from(tool.icons![0].src.split(",")[1], "base64").toString();
    assert.match(svg, /stroke="#8e8e93"/);
    assert.match(svg, /<rect/);

  }
  assert.equal((workspace._meta?.ui as { resourceUri: string }).resourceUri, WORKSPACE_URI);
  const workspaceResource = await client.readResource({ uri: WORKSPACE_URI });
  assert.match(workspaceResource.contents[0].text as string, /data-view="workspace" data-layout="split"/);
  assert.equal(WORKSPACE_URI, "ui://mobile-dev/0.1.75/workspace.html");
  const previousWorkspace = await client.readResource({ uri: "ui://mobile-dev/0.1.52/workspace.html" });
  assert.equal(previousWorkspace.contents[0].text, workspaceResource.contents[0].text);
  for (const uri of ["ui://mobile-dev/0.1.44/workspace.html", "ui://mobile-dev/0.1.43/workspace.html", "ui://mobile-dev/0.1.42/workspace.html", "ui://mobile-dev/0.1.41/workspace.html", "ui://mobile-dev/0.1.40/workspace.html", "ui://mobile-dev/0.1.39/workspace.html", "ui://mobile-dev/0.1.38/workspace.html", "ui://mobile-dev/0.1.37/workspace.html", "ui://mobile-dev/0.1.36/workspace.html", "ui://mobile-dev/0.1.35/workspace.html", "ui://mobile-dev/0.1.34/workspace.html", "ui://mobile-dev/0.1.33/workspace.html", "ui://mobile-dev/0.1.24/mcp-stream/workspace.html", "ui://mobile-dev/0.1.21/workspace.html", "ui://mobile-dev/0.1.20/workspace.html", "ui://mobile-dev/workspace.html"]) {
    const oldWorkspace = await client.readResource({ uri });
    assert.equal(oldWorkspace.contents[0].text, workspaceResource.contents[0].text);
  }
  assert.equal(open._meta?.ui && (open._meta.ui as { resourceUri: string }).resourceUri, APP_URI);
  const appTool = tools.tools.find(tool => tool.name === "mobile_stream_session")!;
  assert.deepEqual((appTool._meta?.ui as { visibility: string[] }).visibility, ["app"]);
  assert.deepEqual((tools.tools.find(tool => tool.name === "mobile_device_settings")!._meta?.ui as { visibility: string[] }).visibility, ["app"]);
  const deviceSettings = await client.callTool({ name: "mobile_device_settings", arguments: { target: { platform: "ios", id: UDID } } });
  assert.equal((deviceSettings.structuredContent?.settings as { appearance: string }).appearance, "light");
  const updatedSettings = await client.callTool({ name: "mobile_update_device_setting", arguments: { target: { platform: "ios", id: UDID }, change: { setting: "appearance", value: "dark" } } });
  assert.equal((updatedSettings.structuredContent?.settings as { appearance: string }).appearance, "dark");
  const badSetting = await client.callTool({ name: "mobile_update_device_setting", arguments: { target: { platform: "ios", id: UDID }, change: { setting: "fontScale", value: 3 } } });
  assert.equal(badSetting.isError, true);
  const resource = await client.readResource({ uri: APP_URI });
  OpenAIUiResourceMetadataSchema.parse(resource.contents[0]._meta?.["openai/ui"]);
  assert.equal(resource.contents[0].mimeType, "text/html;profile=mcp-app");
  assert.match(resource.contents[0].text as string, /data-view="panel" data-layout="stacked"/);
  assert.deepEqual(resource.contents[0]._meta?.ui, { csp: { connectDomains: [SENTRY_ORIGIN], resourceDomains: [] } });
  const status = await client.callTool({ name: "mobile_open_simulator", arguments: {} });
  assert.equal(status.structuredContent?.connected, true);
  assert.equal((status.structuredContent?.devices as unknown[]).length, 2);
  const session = await client.callTool({ name: "mobile_stream_session", arguments: { udid: UDID } });
  assert.equal(session.structuredContent?.fps, 60);
  assert.match(session._meta?.sessionId as string, /^[a-f0-9]{64}$/);
  assert.equal(session._meta?.streamUrl, undefined);
  const frame = await client.readResource({ uri: session._meta?.frameUri as string });
  assert.equal(frame.contents[0].mimeType, "image/jpeg");
  assert.deepEqual(Buffer.from((frame.contents[0] as { blob: string }).blob, "base64"), PNG);
  assert.equal(frame.contents[0]._meta?.sequence, 1);
  await assertClosed(client, `mobile-frame://${"0".repeat(64)}/latest?after=0`);
  const panelInput = { type: "button", button: "home" };
  const panelAccepted = await client.callTool({ name: "mobile_stream_input", arguments: { sessionId: session._meta?.sessionId, messages: [panelInput] } });
  assert.equal(panelAccepted.structuredContent?.accepted, 1);
  const panelRejected = await client.callTool({ name: "mobile_stream_input", arguments: { sessionId: session._meta?.sessionId, messages: [{ type: "run_shell" }] } });
  assert.equal(panelRejected.isError, true);
  const resetTool = tools.tools.find(tool => tool.name === "mobile_stream_reset")!;
  assert.deepEqual((resetTool._meta?.ui as { visibility: string[] }).visibility, ["app"]);
  const invalidReset = await client.callTool({ name: "mobile_stream_reset", arguments: { sessionId: "0".repeat(64) } });
  assert.equal(invalidReset.isError, true);
  const reset = await client.callTool({ name: "mobile_stream_reset", arguments: { sessionId: session._meta?.sessionId } });
  assert.equal(reset.isError, undefined);
  let recovered;
  const recoveredUri = (session._meta?.frameUri as string).replace("after=0", "after=1");
  for (let attempt = 0; attempt < 5; attempt++) {
    const resource = await client.readResource({ uri: recoveredUri });
    if (resource.contents[0].mimeType === "image/jpeg") { recovered = resource.contents[0]; break; }
  }
  assert.equal(recovered?._meta?.sequence, 2);
  const closedPanel = await client.callTool({ name: "mobile_stream_close", arguments: { sessionId: session._meta?.sessionId } });
  assert.equal(closedPanel.isError, undefined);
  await assertClosed(client, session._meta?.frameUri as string);
  const readUI = await client.callTool({ name: "mobile_describe_ui", arguments: { udid: UDID } });
  assert.ok(JSON.stringify(readUI.structuredContent).includes("Continue"));
  const screenshot = await client.callTool({ name: "mobile_screenshot", arguments: { udid: UDID } });
  const image = (screenshot.content as { type: string; data: string }[]).find(item => item.type === "image")!;
  assert.deepEqual(Buffer.from(image.data, "base64"), PNG);
  const input = { type: "tap", x: 10, y: 20, ...SCREEN };
  await client.callTool({ name: "mobile_send_input", arguments: { udid: UDID, input } });
  assert.deepEqual(fake.inputs.at(-1), input);
  fake.setInputFailure();
  const rejected = await client.callTool({ name: "mobile_send_input", arguments: { udid: UDID, input } });
  assert.equal(rejected.isError, true);
  assert.match(JSON.stringify(rejected.content), /input rejected/);
  const active = await client.callTool({ name: "mobile_stream_session", arguments: { udid: UDID } });
  const stopped = await client.callTool({ name: "mobile_shutdown_simulator", arguments: { udid: UDID } });
  assert.equal((stopped.structuredContent?.devices as { state: string; udid: string }[]).find(item => item.udid === UDID)?.state, "Shutdown");
  await assertClosed(client, active._meta?.frameUri as string);
  const noStream = await client.callTool({ name: "mobile_stream_session", arguments: { udid: UDID } });
  assert.equal(noStream.isError, true);
  assert.equal(noStream._meta?.retryable, false);
  const booted = await client.callTool({ name: "mobile_boot_simulator", arguments: { udid: UDID } });
  assert.equal((booted.structuredContent?.devices as { state: string; udid: string }[]).find(item => item.udid === UDID)?.state, "Booted");
  const unknown = await client.callTool({ name: "mobile_boot_simulator", arguments: { udid: "810F8795-62F8-4B9D-A3D2-6AC9FDF585A2" } });
  assert.equal(unknown.isError, true);
  const invalid = await client.callTool({ name: "mobile_send_input", arguments: { udid: OTHER_UDID, input: { type: "tap", x: 2, y: 2 } } });
  assert.equal(invalid.isError, true);
});

test("the toolbar capture copies the returned PNG and still returns it when clipboard copying fails", async t => {
  const fake = await fakeBaguette();
  const copies: Buffer[] = [];
  let copyFails = false;
  const plugin = await createTestPlugin("<title>Mobile Dev</title>", new Baguette(fake.url), fakeSimulatorInput(), undefined, undefined, async bytes => {
    if (copyFails) throw new Error("Clipboard unavailable");
    copies.push(bytes);
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "screenshot-test", version: "1" });
  t.after(async () => { await client.close(); await plugin.close(); await fake.close(); });
  await plugin.server.connect(serverTransport); await client.connect(clientTransport);
  const tools = await client.listTools();
  const capture = tools.tools.find(tool => tool.name === "mobile_capture_screenshot")!;
  assert.deepEqual((capture._meta?.ui as { visibility: string[] }).visibility, ["app"]);
  assert.equal(capture.annotations?.readOnlyHint, false);
  const first = await client.callTool({ name: "mobile_capture_screenshot", arguments: { udid: UDID } });
  const image = (first.content as { type: string; data: string }[]).find(item => item.type === "image")!;
  assert.deepEqual(Buffer.from(image.data, "base64"), copies[0]);
  assert.deepEqual(copies[0], PNG);
  assert.equal(first.structuredContent?.copied, true);
  await client.callTool({ name: "mobile_screenshot", arguments: { udid: UDID } });
  assert.equal(copies.length, 1);
  copyFails = true;
  const failed = await client.callTool({ name: "mobile_capture_screenshot", arguments: { udid: UDID } });
  assert.equal(failed.isError, undefined);
  assert.equal(failed.structuredContent?.copied, false);
  assert.equal(failed.structuredContent?.clipboardError, "Clipboard unavailable");
  assert.equal((failed.content as { type: string }[])[0].type, "image");
  fake.setState("Shutdown");
  const stopped = await client.callTool({ name: "mobile_capture_screenshot", arguments: { udid: UDID } });
  assert.equal(stopped.isError, true);
  assert.equal(copies.length, 1);
  assert.equal(fake.requests.some(request => request.path.endsWith("/boot")), false);
});

test("Device Hub blockage repairs automatically, limits repeated repairs, and permits manual recovery", async t => {
  const fake = await fakeBaguette();
  const input = fakeSimulatorInput();
  const plugin = await createTestPlugin("<title>Mobile Dev</title>", new Baguette(fake.url), input);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "blocked-input-test", version: "1" });
  t.after(async () => { await client.close(); await plugin.close(); await fake.close(); });
  await plugin.server.connect(serverTransport);
  await client.connect(clientTransport);
  const session = await client.callTool({ name: "mobile_stream_session", arguments: { udid: UDID } });
  assert.deepEqual(session.structuredContent?.inputStatus, { state: "ready" });
  await client.readResource({ uri: session._meta?.frameUri as string });
  input.block();
  const blocked = await client.callTool({ name: "mobile_stream_input", arguments: { sessionId: session._meta?.sessionId, messages: [{ type: "button", button: "home" }] } });
  assert.equal(blocked.isError, true);
  assert.equal(blocked._meta?.streamDisconnected, true);
  const modelInput = await client.callTool({ name: "mobile_send_input", arguments: { udid: UDID, input: { type: "tap", x: 10, y: 20, ...SCREEN } } });
  assert.equal(modelInput._meta?.inputBlocked, true);
  const shadowed = await client.callTool({ name: "mobile_stream_session", arguments: { udid: UDID } });
  assert.deepEqual(shadowed.structuredContent?.inputStatus, { state: "ready" });
  assert.match(shadowed.structuredContent?.inputRepairMessage as string, /repaired automatically/);
  assert.equal((await client.readResource({ uri: shadowed._meta?.frameUri as string })).contents[0].mimeType, "image/jpeg");
  assert.equal(fake.inputs.some(message => ["button", "tap"].includes((message as { type: string }).type)), false);
  assert.deepEqual(input.repairs, [UDID]);
  input.block();
  const limited = await client.callTool({ name: "mobile_stream_session", arguments: { udid: UDID } });
  assert.deepEqual(limited.structuredContent?.inputStatus, { state: "blocked" });
  assert.match(limited.structuredContent?.inputRepairMessage as string, /paused/);
  assert.deepEqual(input.repairs, [UDID]);
  const unknown = await client.callTool({ name: "mobile_repair_input", arguments: { udid: "810F8795-62F8-4B9D-A3D2-6AC9FDF585A2" } });
  assert.equal(unknown.isError, true);
  assert.deepEqual(input.repairs, [UDID]);
  const repaired = await client.callTool({ name: "mobile_repair_input", arguments: { udid: UDID } });
  assert.equal(repaired.isError, undefined);
  assert.deepEqual(input.repairs, [UDID, UDID]);
  await assertClosed(client, session._meta?.frameUri as string);
  await assertClosed(client, shadowed._meta?.frameUri as string);
  const reconnected = await client.callTool({ name: "mobile_stream_session", arguments: { udid: UDID } });
  assert.deepEqual(reconnected.structuredContent?.inputStatus, { state: "ready" });
  await client.readResource({ uri: reconnected._meta?.frameUri as string });
  const accepted = await client.callTool({ name: "mobile_stream_input", arguments: { sessionId: reconnected._meta?.sessionId, messages: [{ type: "button", button: "home" }] } });
  assert.equal(accepted.structuredContent?.accepted, 1);
  input.block();
  const wrongSession = await client.callTool({ name: "mobile_stream_input", arguments: { sessionId: "0".repeat(64), messages: [{ type: "button", button: "home" }] } });
  assert.equal(wrongSession.isError, true);
  assert.equal(wrongSession._meta?.inputBlocked, undefined);
});

test("only a loopback HTTP origin can become a backend target", () => {
  for (const value of ["https://127.0.0.1", "http://example.com", "http://user:pass@localhost", "http://localhost/path", "http://localhost?url=x"]) {
    assert.throws(() => parseBaseUrl(value));
  }
  assert.equal(parseBaseUrl("http://127.0.0.1:8421").port, "8421");
});

test("a reused backend survives disposal of the adapter", async t => {
  const fake = await fakeBaguette();
  t.after(() => fake.close());
  const baguette = new Baguette(fake.url);
  assert.equal((await baguette.start()).managed, false);
  baguette.dispose();
  assert.equal((await fetch(`${fake.url}/simulators.json`)).status, 200);
});

test("panel input reaches the native socket during a pending refresh and blocks after it reports Device Hub", { timeout: 2000 }, async t => {
  let now = 0;
  t.mock.method(Date, "now", () => now);
  let resolveRefresh!: (value: string) => void;
  const refresh = new Promise<string>(resolve => { resolveRefresh = resolve; });
  let checks = 0;
  const input = new SimulatorInputService(async () => {}, () => {
    checks++;
    return checks === 1 ? Promise.resolve("state 0") : refresh;
  });
  const fake = await fakeBaguette();
  const buttonReceived = new Promise<void>(resolve => {
    fake.websocket.once("connection", socket => {
      socket.on("message", data => {
        const text = data.toString();
        const message = JSON.parse(text);
        if (message.type === "button") resolve();
      });
    });
  });
  const plugin = await createTestPlugin("<head></head>", new Baguette(fake.url), input);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "background-input-test", version: "1" });
  t.after(async () => { resolveRefresh("state 0"); await client.close(); await plugin.close(); await fake.close(); });
  await plugin.server.connect(serverTransport);
  await client.connect(clientTransport);
  const session = await client.callTool({ name: "mobile_stream_session", arguments: { udid: UDID } });
  await client.readResource({ uri: session._meta?.frameUri as string });
  now = 1000;
  const arguments_ = { sessionId: session._meta?.sessionId, messages: [{ type: "button", button: "home" }] };
  const sent = await client.callTool({ name: "mobile_stream_input", arguments: arguments_ });
  assert.equal(sent.isError, undefined);
  assert.equal(sent.structuredContent?.accepted, 1);
  assert.equal(checks, 2);
  await buttonReceived;
  const buttons = fake.inputs.filter(message => message != null && typeof message === "object" && "type" in message && message.type === "button");
  assert.equal(buttons.length, 1, "The gesture reached the socket before the query completed.");
  resolveRefresh("state 1");
  await setImmediate();
  const blocked = await client.callTool({ name: "mobile_stream_input", arguments: arguments_ });
  assert.equal(blocked._meta?.streamDisconnected, true);
});


async function assertClosed(client: Client, uri: string) {
  const result = await client.readResource({ uri });
  const status = result.contents.find(item => "text" in item);
  assert.ok(status && "text" in status);
  const message = JSON.parse(status.text);
  assert.equal(message.state, "failed");
  assert.match(message.error, /expired or closed/);
}
