import { SENTRY_ORIGIN } from "@mobile-dev/shared/telemetry.ts";
import { setImmediate } from "node:timers/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { SimulatorInputService } from "../src/simulator-input.ts";
import test from "node:test";
import assert from "node:assert/strict";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { OpenAIUiToolMetadataSchema, OpenAIUiResourceMetadataSchema } from "@openai/mcp-extensions/server";
import { APP_URI, createPanel, WORKSPACE_URI } from "../src/panel-tools.ts";
import { RECORDING_URI } from "@mobile-dev/shared/recordings.ts";
import { COMPARISON_URI } from "@mobile-dev/shared/performance-comparison.ts";
import { TRACESIFT_URI } from "@mobile-dev/shared/tracesift.ts";
import { SimulatorUnavailableError } from "../src/simulator-unavailable.ts";
import { parseBaseUrl } from "@mobile-dev/shared/protocol.ts";
import { createTestPlugin, fakeBaguette, fakeSimulatorInput, UDID, PNG, attachedBaguette } from "@mobile-dev/test-support/fixtures.ts";
import { getTelemetryIdentity } from "../src/telemetry-identity.ts";
import { LogSessions } from "../src/log-sessions.ts";
import type { ServerServices } from "../src/server-feature.ts";
import manifest from "../../../package.json" with { type: "json" };
import { connectClient } from "@mobile-dev/test-support/mcp.ts";
import { setEnv, setTelemetry } from "@mobile-dev/test-support/env.ts";

test("both opening tools accept optional device intent and preserve it in their results", async t => {
  const fake = await fakeBaguette();
  const plugin = await createTestPlugin("<html></html>", { features: [createPanel({ baguette: attachedBaguette(fake.url), simulatorInput: fakeSimulatorInput() })] });
  const client = await connectClient(t, plugin.server, { name: "opening-target-test" });
  t.after(async () => { await plugin.close(); await fake.close(); });
  for (const name of ["mobile_open_simulator", "mobile_open_workspace"]) {
    for (const target of [{}, { platform: "android", kind: "emulator" }, { platform: "ios", kind: "physical", deviceId: "00008110-000A0B1C2D3E4000" }]) {
      const result = await client.callTool({ name, arguments: target });
      assert.equal(result.isError, undefined);
      assert.deepEqual(result.structuredContent?.panelTarget, target);
    }
    const invalid = await client.callTool({ name, arguments: { platform: "android", kind: "simulator" } });
    assert.equal(invalid.isError, true);
  }
  const boots = fake.requests.filter(request => request.path.endsWith("/boot"));
  assert.equal(boots.length, 0);
});

test("the device chooser is listed only for hosts with a native form", async t => {
  const fake = await fakeBaguette();
  t.after(() => fake.close());
  for (const [capabilities, listed] of [
    [{}, false],
    [{ extensions: { "io.modelcontextprotocol/ui": { mimeTypes: ["text/html;profile=mcp-app"] } } }, false],
    [{ extensions: { "openai/elicitation": { form: {} } } }, true],
    [{ elicitation: {} }, true],
  ] as const) {
    const plugin = await createTestPlugin("<html></html>", { features: [createPanel({ baguette: attachedBaguette(fake.url), simulatorInput: fakeSimulatorInput() })] });
    const client = await connectClient(t, plugin.server, { name: "device-choice-host", capabilities });
    const choice = (await client.listTools()).tools.find(tool => tool.name === "mobile_choose_devices");
    assert.equal(choice !== undefined, listed, JSON.stringify(capabilities));
    if (choice) {
      assert.ok(choice.icons?.length);
      assert.equal(choice._meta?.ui, undefined, "The chooser has no card.");
    }
    assert.match(client.getInstructions() ?? "", /mobile_choose_devices when it is available, otherwise in chat/);
    await client.close(); await plugin.close();
  }
});

test("live UI reads use MCP and allow only Sentry browser connections", async t => {
  let revision = "a".repeat(64);
  const plugin = await createTestPlugin(async () => ({ html: '<html data-view="panel">jonas</html>', liveRevision: revision }), { features: [createPanel()] });
  const client = await connectClient(t, plugin.server, { name: "dev-panel-test" });
  t.after(() => plugin.close());
  const first = await client.readResource({ uri: APP_URI });
  assert.deepEqual(first.contents[0]._meta?.ui, { permissions: { clipboardWrite: {} }, csp: { connectDomains: [SENTRY_ORIGIN], resourceDomains: [] } });
  const uri = `ui://mobile-dev/live?after=${revision}`;
  const unchanged = await client.readResource({ uri });
  assert.deepEqual(JSON.parse(unchanged.contents[0].text as string), { revision });
  revision = "b".repeat(64);
  const changed = await client.readResource({ uri });
  assert.deepEqual(JSON.parse(changed.contents[0].text as string), { revision, html: '<html data-view="panel">jonas</html>' });
});

test("environment overrides apply to both initial UI resources and live reload", async t => {
  setEnv(t, { MOBILE_DEV_ENVIRONMENT: "release" });
  const html = '<html><meta name="mobile-dev-environment" content="development"></html>';
  const revision = "a".repeat(64);
  const plugin = await createTestPlugin(async () => ({ html, liveRevision: revision }), { features: [createPanel()] });
  const client = await connectClient(t, plugin.server, { name: "telemetry-environment-test" });
  t.after(() => plugin.close());
  const initial = await client.readResource({ uri: APP_URI });
  const initialText = initial.contents[0].text;
  assert.ok(typeof initialText === "string");
  assert.match(initialText, /mobile-dev-environment" content="release"/);
  const live = await client.readResource({ uri: "ui://mobile-dev/live?after=old" });
  const liveText = live.contents[0].text;
  assert.ok(typeof liveText === "string");
  const update = JSON.parse(liveText);
  assert.match(update.html, /mobile-dev-environment" content="release"/);
  setEnv(t, { MOBILE_DEV_ENVIRONMENT: "development" });
  const development = await client.readResource({ uri: APP_URI });
  const developmentText = development.contents[0].text;
  assert.ok(typeof developmentText === "string");
  assert.match(developmentText, /mobile-dev-environment" content="development"/);
});

test("local packaged UI uses development without a live watcher", async t => {
  setEnv(t, { MOBILE_DEV_ENVIRONMENT: undefined });
  const html = '<html><meta name="mobile-dev-environment" content="release"></html>';
  const plugin = await createTestPlugin(html, { features: [createPanel()] });
  const client = await connectClient(t, plugin.server, { name: "local-build-environment-test" });
  t.after(() => plugin.close());
  const resource = await client.readResource({ uri: APP_URI });
  const content = resource.contents[0].text;
  assert.ok(typeof content === "string");
  assert.match(content, /mobile-dev-environment" content="development"/);
});

test("UI surfaces and live reload receive the server's anonymous identity and opt-out", async t => {
  setTelemetry(t, "on");
  const html = '<html data-view="panel"><head><meta name="mobile-dev-environment" content="development"></head></html>';
  const plugin = await createTestPlugin(async () => ({ html, liveRevision: "new" }), { features: [createPanel()] });
  const client = await connectClient(t, plugin.server, { name: "identity-test" });
  t.after(() => plugin.close());
  const identity = getTelemetryIdentity();
  assert.ok(identity);
  const userMarker = `name="mobile-dev-user-id" content="${identity.userId}"`;
  const sessionMarker = `name="mobile-dev-session-id" content="${identity.sessionId}"`;
  for (const uri of [APP_URI, WORKSPACE_URI, RECORDING_URI, COMPARISON_URI, TRACESIFT_URI]) {
    const resource = await client.readResource({ uri });
    const content = resource.contents[0].text;
    assert.ok(typeof content === "string");
    const userIncluded = content.includes(userMarker);
    const sessionIncluded = content.includes(sessionMarker);
    assert.ok(userIncluded);
    assert.ok(sessionIncluded);
  }
  const live = await client.readResource({ uri: "ui://mobile-dev/live?after=old" });
  const liveText = live.contents[0].text;
  assert.ok(typeof liveText === "string");
  const update = JSON.parse(liveText);
  const liveIncludesUser = update.html.includes(userMarker);
  const liveIncludesSession = update.html.includes(sessionMarker);
  assert.ok(liveIncludesUser);
  assert.ok(liveIncludesSession);
  setTelemetry(t, "off");
  const disabled = await client.readResource({ uri: APP_URI });
  const disabledText = disabled.contents[0].text;
  assert.ok(typeof disabledText === "string");
  assert.match(disabledText, /mobile-dev-telemetry" content="off"/);
  const disabledIncludesUser = disabledText.includes("mobile-dev-user-id");
  const disabledIncludesSession = disabledText.includes("mobile-dev-session-id");
  assert.equal(disabledIncludesUser, false);
  assert.equal(disabledIncludesSession, false);
});

test("cached side tabs and saved cards load the current UI through old resource addresses", async t => {
  const html = '<!doctype html><html data-view="panel"><title>Current simulator</title><canvas></canvas></html>';
  const plugin = await createTestPlugin(html, { features: [createPanel()] });
  const client = await connectClient(t, plugin.server, { name: "cached-panel-test" });
  t.after(() => plugin.close());
  assert.equal(APP_URI, `ui://mobile-dev/${manifest.version}/simulator.html`);
  const previousPanel = await client.readResource({ uri: "ui://mobile-dev/0.1.147/simulator.html" });
  assert.equal(previousPanel.contents[0].text, html);
  for (const uri of [APP_URI, "ui://mobile-dev/0.1.44/simulator.html", "ui://mobile-dev/0.1.43/simulator.html", "ui://mobile-dev/0.1.42/simulator.html", "ui://mobile-dev/0.1.41/simulator.html", "ui://mobile-dev/0.1.40/simulator.html", "ui://mobile-dev/0.1.39/simulator.html", "ui://mobile-dev/0.1.38/simulator.html", "ui://mobile-dev/0.1.37/simulator.html", "ui://mobile-dev/0.1.36/simulator.html", "ui://mobile-dev/0.1.35/simulator.html", "ui://mobile-dev/0.1.34/simulator.html", "ui://mobile-dev/0.1.33/simulator.html", "ui://mobile-dev/0.1.24/mcp-stream/simulator.html", "ui://mobile-dev/0.1.21/simulator.html", "ui://mobile-dev/0.1.20/simulator.html", "ui://mobile-dev/simulator.html", ...[1, 2, 3, 4, 5, 6].map(version => `ui://mobile-dev/v${version}/simulator.html`)]) {
    const { contents } = await client.readResource({ uri });
    assert.equal(contents[0].uri, uri);
    assert.equal(contents[0].mimeType, "text/html;profile=mcp-app");
    assert.equal(contents[0].text, html);
    OpenAIUiResourceMetadataSchema.parse(contents[0]._meta?.["openai/ui"]);
  }
  for (const uri of ["ui://mobile-dev/0.1.147/workspace.html", "ui://mobile-dev/0.1.24/mcp-stream/workspace.html", "ui://mobile-dev/workspace.html"]) {
    const { contents } = await client.readResource({ uri });
    assert.equal(contents[0].uri, uri);
    assert.equal(contents[0].mimeType, "text/html;profile=mcp-app");
  }
  for (const page of ["recording", "comparison", "tracesift", "devices"]) {
    const { contents } = await client.readResource({ uri: `ui://mobile-dev/0.1.169/${page}.html` });
    assert.equal((contents[0]._meta?.["openai/ui"] as { preferredDisplayMode: string }).preferredDisplayMode, "inline", `a saved ${page} card from an earlier release still loads`);
    assert.match(contents[0].text as string, new RegExp(`data-view="${page}"`));
  }
  for (const uri of ["ui://mobile-dev/v999/simulator.html", "ui://mobile-dev/latest/simulator.html", "ui://mobile-dev/0.1.147/other.html"]) {
    await assert.rejects(client.readResource({ uri }), /not found/);
  }
});

test("MCP tools expose native entrypoints and complete the simulator workflow", async t => {
  const fake = await fakeBaguette();
  const plugin = await createTestPlugin('<!doctype html><html data-view="panel" data-layout="stacked"><title>Mobile Dev</title></html>', { features: [createPanel({ baguette: attachedBaguette(fake.url), simulatorInput: fakeSimulatorInput() })] });
  const client = await connectClient(t, plugin.server);
  t.after(async () => { await plugin.close(); await fake.close(); });
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
    assert.match(svg, /stroke="currentColor"/);
    assert.match(svg, /<title>ai-phone-01<\/title>/);

  }
  assert.equal((workspace._meta?.ui as { resourceUri: string }).resourceUri, WORKSPACE_URI);
  const workspaceResource = await client.readResource({ uri: WORKSPACE_URI });
  const recordingResource = await client.readResource({ uri: RECORDING_URI });
  // Cards from a server with the workspace can open recordings there.
  assert.match(recordingResource.contents[0].text as string, /data-view="recording" data-workspace/);
  assert.equal(recordingResource.contents[0].mimeType, "text/html;profile=mcp-app");
  assert.deepEqual(recordingResource.contents[0]._meta?.["openai/ui"], { preferredDisplayMode: "inline", availableDisplayModes: ["inline", "fullscreen"] });
  assert.deepEqual(recordingResource.contents[0]._meta?.ui, { prefersBorder: true, permissions: { clipboardWrite: {} }, csp: { connectDomains: [SENTRY_ORIGIN], resourceDomains: [] } });
  const renderRecording = tools.tools.find(tool => tool.name === "mobile_render_performance_recording");
  assert.deepEqual(renderRecording?._meta?.ui, { resourceUri: RECORDING_URI, visibility: ["app", "model"] });
  const comparisonResource = await client.readResource({ uri: COMPARISON_URI });
  assert.match(comparisonResource.contents[0].text as string, /data-view="comparison"/);
  assert.deepEqual(comparisonResource.contents[0]._meta, recordingResource.contents[0]._meta);
  const traceSiftResource = await client.readResource({ uri: TRACESIFT_URI });
  assert.match(traceSiftResource.contents[0].text as string, /data-view="tracesift"/);
  assert.deepEqual(traceSiftResource.contents[0]._meta, recordingResource.contents[0]._meta);
  const analyzeProfile = tools.tools.find(tool => tool.name === "mobile_analyze_profile");
  assert.deepEqual(analyzeProfile?._meta?.ui, { resourceUri: TRACESIFT_URI, visibility: ["app", "model"] });
  assert.deepEqual(tools.tools.find(tool => tool.name === "mobile_remember_tracesift_analysis")?._meta?.ui, { visibility: ["app"] });
  assert.deepEqual(tools.tools.find(tool => tool.name === "mobile_restore_tracesift_analysis")?._meta?.ui, { visibility: ["app"] });
  assert.deepEqual(tools.tools.find(tool => tool.name === "mobile_restore_tracesift_analysis_by_input")?._meta?.ui, { visibility: ["app"] });
  // The agent fetches a card's handoff itself where the host does not let the card call tools.
  assert.deepEqual(tools.tools.find(tool => tool.name === "mobile_get_tracesift_handoff")?._meta?.ui, { visibility: ["app", "model"] });
  assert.match(workspaceResource.contents[0].text as string, /data-view="workspace" data-layout="split"/);
  assert.equal(WORKSPACE_URI, `ui://mobile-dev/${manifest.version}/workspace.html`);
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
  assert.deepEqual(resource.contents[0]._meta?.ui, { permissions: { clipboardWrite: {} }, csp: { connectDomains: [SENTRY_ORIGIN], resourceDomains: [] } });
  const status = await client.callTool({ name: "mobile_open_simulator", arguments: {} });
  assert.equal(status.structuredContent?.connected, true);
  assert.equal((status.structuredContent?.devices as unknown[]).length, 2);
  const session = await client.callTool({ name: "mobile_stream_session", arguments: { udid: UDID } });
  assert.equal(session.isError, undefined);
  const definition = session.structuredContent?.definition;
  assert.ok(definition && typeof definition === "object" && "screen" in definition);
  const screen = definition.screen;
  assert.ok(screen && typeof screen === "object" && "maskImage" in screen);
  assert.equal(screen.maskImage, null);
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
  // The panel's annotations read the accessibility tree; the agent uses device_snapshot.
  const describeUi = tools.tools.find(tool => tool.name === "mobile_describe_ui");
  assert.deepEqual((describeUi?._meta?.ui as { visibility: string[] }).visibility, ["app"]);
  const readUI = await client.callTool({ name: "mobile_describe_ui", arguments: { udid: UDID } });
  assert.ok(JSON.stringify(readUI.structuredContent).includes("Continue"));
  for (const name of ["mobile_send_input", "mobile_screenshot"]) assert.equal(tools.tools.some(tool => tool.name === name), false, name);
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
});

test("the toolbar capture copies the returned PNG and still returns it when clipboard copying fails", async t => {
  const fake = await fakeBaguette();
  const copies: Buffer[] = [];
  let copyFails = false;
  const plugin = await createTestPlugin("<title>Mobile Dev</title>", { features: [createPanel({ baguette: attachedBaguette(fake.url), simulatorInput: fakeSimulatorInput(), copyScreenshot: async bytes => {
    if (copyFails) throw new Error("Clipboard unavailable");
    copies.push(bytes);
  } })] });
  const client = await connectClient(t, plugin.server, { name: "screenshot-test" });
  t.after(async () => { await plugin.close(); await fake.close(); });
  const tools = await client.listTools();
  const capture = tools.tools.find(tool => tool.name === "mobile_capture_screenshot")!;
  assert.deepEqual((capture._meta?.ui as { visibility: string[] }).visibility, ["app"]);
  assert.equal(capture.annotations?.readOnlyHint, false);
  const first = await client.callTool({ name: "mobile_capture_screenshot", arguments: { udid: UDID } });
  const image = (first.content as { type: string; data: string }[]).find(item => item.type === "image")!;
  assert.deepEqual(Buffer.from(image.data, "base64"), copies[0]);
  assert.deepEqual(copies[0], PNG);
  assert.equal(first.structuredContent?.copied, true);
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
  const plugin = await createTestPlugin("<title>Mobile Dev</title>", { features: [createPanel({ baguette: attachedBaguette(fake.url), simulatorInput: input })] });
  const client = await connectClient(t, plugin.server, { name: "blocked-input-test" });
  t.after(async () => { await plugin.close(); await fake.close(); });
  const session = await client.callTool({ name: "mobile_stream_session", arguments: { udid: UDID } });
  assert.deepEqual(session.structuredContent?.inputStatus, { state: "ready" });
  await client.readResource({ uri: session._meta?.frameUri as string });
  input.block();
  const blocked = await client.callTool({ name: "mobile_stream_input", arguments: { sessionId: session._meta?.sessionId, messages: [{ type: "button", button: "home" }] } });
  assert.equal(blocked.isError, true);
  assert.equal(blocked._meta?.streamDisconnected, true);
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

test("a stale accessibility bridge restarts once before reading the UI again", async t => {
  let now = 0;
  t.mock.method(Date, "now", () => now);
  let responses: unknown[] = [];
  const server = createServer((request, response) => {
    if (request.url === "/simulators.json") response.end('{"running":[],"available":[]}');
    else response.end(JSON.stringify(responses.shift() ?? { ok: false, error: "no accessibility data" }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const restarts: string[] = [];
  const baguette = attachedBaguette(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, { kickstartBridge: async udid => { restarts.push(udid); } });
  t.after(() => baguette.dispose());
  await baguette.start();

  responses = [{ ok: false, error: "no accessibility data" }, { ok: true, tree: { label: "HorseTinder" } }];
  assert.equal((await baguette.describeUi(UDID)).tree?.label, "HorseTinder");
  assert.deepEqual(restarts, [UDID]);

  // A screen with genuinely no data does not restart the bridge on every read.
  now = 5000;
  await assert.rejects(baguette.describeUi(UDID), /no accessibility data/);
  assert.equal(restarts.length, 1);

  now = 20000;
  responses = [{ ok: false, error: "describe failed" }];
  await assert.rejects(baguette.describeUi(UDID), /describe failed/);
  assert.equal(restarts.length, 1);
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
  const plugin = await createTestPlugin("<head></head>", { features: [createPanel({ baguette: attachedBaguette(fake.url), simulatorInput: input })] });
  t.after(() => resolveRefresh("state 0"));
  const client = await connectClient(t, plugin.server, { name: "background-input-test" });
  t.after(async () => { await plugin.close(); await fake.close(); });
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

test("without the panel, the server keeps its cards and finds simulators without Baguette", async t => {
  const reads: string[] = [];
  const simulators = {
    async list() { reads.push("list"); return { connected: true, managed: false, baseUrl: "", devices: [{ udid: UDID, name: "iPhone 17", state: "Shutdown", runtime: "iOS 26.0" }] }; },
    async device(udid: string, mustBeBooted = false) {
      reads.push(udid);
      if (mustBeBooted) throw new SimulatorUnavailableError("The simulator is stopped. Boot it first.");
      return { udid, name: "iPhone 17", state: "Shutdown", runtime: "iOS 26.0" };
    },
  };
  const plugin = await createTestPlugin('<html data-view="panel"></html>', { simulators });
  const client = await connectClient(t, plugin.server, { name: "no-panel-host" });
  t.after(() => plugin.close());
  assert.match(client.getInstructions() ?? "", /the host's own simulator view/);
  const names = (await client.listTools()).tools.map(tool => tool.name);
  for (const name of ["mobile_logs_session", "mobile_record_performance", "mobile_render_performance_recording", "mobile_compare_performance_recordings", "mobile_analyze_profile", "mobile_list_apps", "mobile_app_storage"]) {
    assert.ok(names.includes(name), name);
  }
  for (const name of ["mobile_open_simulator", "mobile_open_workspace", "mobile_list_simulators", "mobile_describe_ui", "mobile_stream_session", "mobile_list_android_devices", "mobile_android_stream_session", "mobile_inspect_ui", "mobile_device_settings", "mobile_ios_mirror_session", "mobile_open_performance_recording", "mobile_app_icons", "mobile_choose_devices"]) {
    assert.equal(names.includes(name), false, name);
  }
  await assert.rejects(client.readResource({ uri: APP_URI }));
  await assert.rejects(client.readResource({ uri: WORKSPACE_URI }));
  const card = await client.readResource({ uri: RECORDING_URI });
  assert.match(String(card.contents[0].text), /data-view="recording"/);
  assert.doesNotMatch(String(card.contents[0].text), /data-workspace/);
  const logs = await client.callTool({ name: "mobile_logs_session", arguments: { options: { native: { platform: "ios", deviceId: UDID } } } });
  assert.equal(logs.isError, true);
  assert.match((logs.content as { text: string }[])[0].text, /Boot it first/);
  assert.deepEqual(reads, [UDID]);
});

test("hosts without the panel close a device's sessions through their features, and failed feature cleanups do not stop shutdown", async t => {
  let stops = 0;
  const logs = new LogSessions({ native: () => async () => { stops++; }, metro: () => async () => {} });
  let services!: ServerServices;
  const plugin = await createTestPlugin("<html></html>", { logs, features: [
    { register: (_server, provided) => { services = provided; return () => { throw new Error("Cleanup failed"); }; } },
    { register: () => async () => { throw new Error("Async cleanup failed"); } },
  ] });
  t.after(() => plugin.close());
  const kept = logs.open({ native: { platform: "android", deviceId: "emulator-5556" } });
  const closed = logs.open({ native: { platform: "android", deviceId: "emulator-5554" } });
  await services.closeDevice("emulator-5554");
  assert.equal(stops, 1);
  await assert.rejects(logs.read(closed, 0, 0), /expired or closed/);
  assert.equal((await logs.read(kept, 0, 0)).entries.length, 0);
  await plugin.close();
  assert.equal(stops, 2);
});
