import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { OpenAIUiToolMetadataSchema, OpenAIUiResourceMetadataSchema } from "@openai/mcp-extensions/server";
import { createPlugin as createActualPlugin } from "../src/server/plugin.ts";
import { Baguette } from "../src/server/baguette.ts";
import { parseBaseUrl } from "../src/shared/protocol.ts";
import { fakeBaguette, fakeSimulatorInput, UDID, OTHER_UDID, SCREEN, PNG, fakeCertificate, fakeStreamingService } from "./fixtures.ts";

let service: Awaited<ReturnType<typeof fakeStreamingService>>;
test.before(async () => { service = await fakeStreamingService(); });
test.after(async () => { await service.close(); });
function createPlugin(...args: Parameters<typeof createActualPlugin>) {
  const [html, baguette, input, logs, certificate] = args;
  const shared = service.client();
  return createActualPlugin(html, baguette, input, logs, certificate, shared);
}

test("UI resource addresses are stable across server instances", async t => {
  const html = '<!doctype html><html><head><!-- STREAM_CONFIG --></head><title>Current simulator</title><canvas></canvas></html>';
  const plugin = await createPlugin(html);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "panel-identity-test", version: "1" });
  t.after(async () => { await client.close(); await plugin.close(); });
  await plugin.server.connect(serverTransport);
  await client.connect(clientTransport);
  assert.match(plugin.appUri, /^ui:\/\/mobile-dev\/0\.1\.18\/shared-stream\/simulator\.html$/);
  const resource = await client.readResource({ uri: plugin.appUri });
  assert.equal(resource.contents[0].uri, plugin.appUri);
  assert.equal(resource.contents[0].mimeType, "text/html;profile=mcp-app");
  assert.match(resource.contents[0].text as string, /<canvas>/);
  assert.ok((resource.contents[0].text as string).includes(`content="${service.origin}"`));
  OpenAIUiResourceMetadataSchema.parse(resource.contents[0]._meta?.["openai/ui"]);
  for (const uri of ["ui://mobile-dev/0.1.18/wss/simulator.html", "ui://mobile-dev/workspace.html", "ui://mobile-dev/v6/simulator.html"]) {
    await assert.rejects(client.readResource({ uri }), /not found/);
  }
});

test("MCP tools expose native entrypoints and complete the simulator workflow", async t => {
  const fake = await fakeBaguette();
  const certificate = await fakeCertificate();
  const plugin = await createPlugin('<!doctype html><html data-view="panel" data-layout="stacked"><head><!-- STREAM_CONFIG --></head><title>Mobile Dev</title></html>', new Baguette(fake.url), fakeSimulatorInput(), undefined, certificate);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1" });
  t.after(async () => { await client.close(); await plugin.close(); await fake.close(); });
  await plugin.server.connect(serverTransport);
  await client.connect(clientTransport);
  const tools = await client.listTools();
  const open = tools.tools.find(tool => tool.name === "mobile_open_simulator")!;
  const metadata = OpenAIUiToolMetadataSchema.parse(open._meta?.["openai/ui"]);
  assert.deepEqual(metadata.entrypoints?.map(item => item.type), ["thread"]);
  const workspace = tools.tools.find(tool => tool.name === "mobile_open_workspace")!;
  const workspaceMetadata = OpenAIUiToolMetadataSchema.parse(workspace._meta?.["openai/ui"]);
  assert.deepEqual(workspaceMetadata.entrypoints?.map(item => item.type), ["global"]);
  assert.equal((workspace._meta?.ui as { resourceUri: string }).resourceUri, plugin.workspaceUri);
  const workspaceResource = await client.readResource({ uri: plugin.workspaceUri });
  assert.match(workspaceResource.contents[0].text as string, /data-view="workspace" data-layout="split"/);
  assert.match(plugin.workspaceUri, /\/workspace\.html$/);
  assert.equal(open._meta?.ui && (open._meta.ui as { resourceUri: string }).resourceUri, plugin.appUri);
  const appTool = tools.tools.find(tool => tool.name === "mobile_stream_session")!;
  assert.deepEqual((appTool._meta?.ui as { visibility: string[] }).visibility, ["app"]);
  const resource = await client.readResource({ uri: plugin.appUri });
  OpenAIUiResourceMetadataSchema.parse(resource.contents[0]._meta?.["openai/ui"]);
  assert.equal(resource.contents[0].mimeType, "text/html;profile=mcp-app");
  assert.match(resource.contents[0].text as string, /data-view="panel" data-layout="stacked"/);
  const ui = resource.contents[0]._meta?.ui as { csp: { connectDomains: string[] } };
  assert.match(ui.csp.connectDomains[0], /^wss:\/\/127\.0\.0\.1:\d+$/);
  assert.equal(certificate.setups, 0);
  assert.equal(tools.tools.some(tool => tool.name === "mobile_stream_input"), false);
  const status = await client.callTool({ name: "mobile_open_simulator", arguments: {} });
  assert.equal(status.structuredContent?.connected, true);
  assert.equal((status.structuredContent?.devices as unknown[]).length, 2);
  const session = await client.callTool({ name: "mobile_stream_session", arguments: { udid: UDID } });
  assert.equal(session.structuredContent?.fps, 60);
  assert.match(session._meta?.sessionId as string, /^[a-f0-9]{64}$/);
  assert.match(session._meta?.streamUrl as string, /^wss:\/\/127\.0\.0\.1:/);
  assert.equal(session._meta?.frameUri, undefined);
  const closedPanel = await client.callTool({ name: "mobile_stream_close", arguments: { sessionId: session._meta?.sessionId } });
  assert.equal(closedPanel.isError, undefined);
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
  const stopped = await client.callTool({ name: "mobile_shutdown_simulator", arguments: { udid: UDID } });
  assert.equal((stopped.structuredContent?.devices as { state: string; udid: string }[]).find(item => item.udid === UDID)?.state, "Shutdown");
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

test("Device Hub blockage stays visible until an explicit repair reconnects input", async t => {
  const fake = await fakeBaguette();
  const certificate = await fakeCertificate();
  const input = fakeSimulatorInput();
  const plugin = await createPlugin("<head><!-- STREAM_CONFIG --></head><title>Mobile Dev</title>", new Baguette(fake.url), input, undefined, certificate);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "blocked-input-test", version: "1" });
  t.after(async () => { await client.close(); await plugin.close(); await fake.close(); });
  await plugin.server.connect(serverTransport);
  await client.connect(clientTransport);
  const session = await client.callTool({ name: "mobile_stream_session", arguments: { udid: UDID } });
  assert.deepEqual(session.structuredContent?.inputStatus, { state: "ready" });
  input.block();
  const modelInput = await client.callTool({ name: "mobile_send_input", arguments: { udid: UDID, input: { type: "tap", x: 10, y: 20, ...SCREEN } } });
  assert.equal(modelInput._meta?.inputBlocked, true);
  const shadowed = await client.callTool({ name: "mobile_stream_session", arguments: { udid: UDID } });
  assert.deepEqual(shadowed.structuredContent?.inputStatus, { state: "blocked" });
  assert.match(shadowed._meta?.streamUrl as string, /^wss:/);
  assert.equal(fake.inputs.some(message => ["button", "tap"].includes((message as { type: string }).type)), false);
  assert.deepEqual(input.repairs, []);
  const unknown = await client.callTool({ name: "mobile_repair_input", arguments: { udid: "810F8795-62F8-4B9D-A3D2-6AC9FDF585A2" } });
  assert.equal(unknown.isError, true);
  assert.deepEqual(input.repairs, []);
  const repaired = await client.callTool({ name: "mobile_repair_input", arguments: { udid: UDID } });
  assert.equal(repaired.isError, undefined);
  assert.deepEqual(input.repairs, [UDID]);
  const reconnected = await client.callTool({ name: "mobile_stream_session", arguments: { udid: UDID } });
  assert.deepEqual(reconnected.structuredContent?.inputStatus, { state: "ready" });

});

test("only a loopback HTTP origin can become a backend target", () => {
  for (const value of ["https://127.0.0.1", "http://example.com", "http://user:pass@localhost", "http://localhost/path", "http://localhost?url=x"]) {
    assert.throws(() => parseBaseUrl(value));
  }
  assert.equal(parseBaseUrl("http://127.0.0.1:8421").port, "8421");
});

test("a reused backend survives disposal of the adapter", async t => {
  const fake = await fakeBaguette();
  const certificate = await fakeCertificate();
  t.after(() => fake.close());
  const baguette = new Baguette(fake.url);
  assert.equal((await baguette.start()).managed, false);
  baguette.dispose();
  assert.equal((await fetch(`${fake.url}/simulators.json`)).status, 200);
});

test("certificate setup is explicit and enables the existing local endpoint", async t => {
  const fake = await fakeBaguette();
  const certificate = await fakeCertificate();
  certificate.missing();
  const plugin = await createPlugin("<head><!-- STREAM_CONFIG --></head><canvas></canvas>", new Baguette(fake.url), fakeSimulatorInput(), undefined, certificate);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "certificate-setup-test", version: "1" });
  t.after(async () => { await client.close(); await plugin.close(); await fake.close(); });
  await plugin.server.connect(serverTransport);
  await client.connect(clientTransport);
  await client.readResource({ uri: plugin.appUri });
  const status = await client.callTool({ name: "mobile_certificate_status", arguments: {} });
  assert.equal(status.structuredContent?.state, "missing");
  const blocked = await client.callTool({ name: "mobile_stream_session", arguments: { udid: UDID } });
  assert.equal(blocked.isError, true);
  assert.equal(blocked._meta?.tlsRequired, true);
  assert.equal(certificate.setups, 0);
  const setup = await client.callTool({ name: "mobile_setup_certificate", arguments: {} });
  assert.equal(setup.structuredContent?.state, "ready");
  assert.equal(certificate.setups, 1);
  const opened = await client.callTool({ name: "mobile_stream_session", arguments: { udid: UDID } });
  assert.equal(opened.isError, undefined);
  const { WebSocket } = await import("ws");
  const { once } = await import("node:events");
  const socket = new WebSocket(opened._meta?.streamUrl as string, { ca: certificate.cert });
  const frame = once(socket, "message");
  await once(socket, "open");
  const [packet, binary] = await frame;
  assert.equal(binary, true);
  assert.deepEqual(packet, PNG);
  socket.close();
});

test("discovery and runtime instances share UI addresses, CSP, and stream origin across restarts", async t => {
  const fake = await fakeBaguette();
  const certificate = await fakeCertificate();
  const records: { plugin: Awaited<ReturnType<typeof createPlugin>>; client: Client; closed: boolean }[] = [];
  t.after(async () => {
    for (const record of records) {
      if (record.closed === false) { await record.client.close(); await record.plugin.close(); }
    }
    await fake.close();
  });
  async function startServer() {
    const html = '<!doctype html><html data-view="panel" data-layout="stacked"><head><!-- STREAM_CONFIG --></head><canvas></canvas></html>';
    const plugin = await createPlugin(html, new Baguette(fake.url), fakeSimulatorInput(), undefined, certificate);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "restart-policy-test", version: "1" });
    const record = { plugin, client, closed: false };
    records.push(record);
    await plugin.server.connect(serverTransport);
    await client.connect(clientTransport);
    return record;
  }
  const discovery = await startServer();
  const runtime = await startServer();
  const tools = await discovery.client.listTools();
  const entrypoint = tools.tools.find(tool => tool.name === "mobile_open_simulator")!;
  const uri = (entrypoint._meta?.ui as { resourceUri: string }).resourceUri;
  const cached = await discovery.client.readResource({ uri });
  const cachedUi = cached.contents[0]._meta?.ui as { csp: { connectDomains: string[] } };
  const resource = await runtime.client.readResource({ uri });
  assert.equal(resource.contents[0].text, cached.contents[0].text);
  assert.deepEqual(resource.contents[0]._meta, cached.contents[0]._meta);
  await discovery.client.close();
  await discovery.plugin.close();
  discovery.closed = true;
  const replacement = await startServer();
  assert.equal(replacement.plugin.appUri, uri);
  await replacement.client.readResource({ uri });
  const session = await replacement.client.callTool({ name: "mobile_stream_session", arguments: { udid: UDID } });
  assert.equal(session.isError, undefined);
  const socketUrl = new URL(session._meta?.streamUrl as string);
  assert.equal(socketUrl.origin, service.origin);
  assert.deepEqual(cachedUi.csp.connectDomains, [socketUrl.origin]);
});
