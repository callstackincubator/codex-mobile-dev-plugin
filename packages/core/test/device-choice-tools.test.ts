import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { OpenAIExtensions, OpenAIFormSchema } from "@openai/mcp-extensions/server";
import type { OpenAIFormResult } from "@openai/mcp-extensions/server";
import { deviceChoiceForm, deviceChoiceFormSupport, registerDeviceChoiceTools, resolveDeviceChoices } from "../src/device-choice-tools.ts";
import type { DeviceChoiceSources } from "../src/device-choice-tools.ts";
import { deviceChoiceInputSchema } from "../../shared/src/device-choice.ts";
import type { Status } from "../../shared/src/protocol.ts";

const simulatorId = "11111111-1111-4111-8111-111111111111";
const input = {
  message: "ShopDemo is open on two devices. Which should I record?",
  context: "CPU, memory and Display FPS · 30 seconds. Use the app during recording.",
  devices: [
    { platform: "android", kind: "emulator", deviceId: "emulator-5554", appName: "ShopDemo" },
    { platform: "ios", kind: "simulator", deviceId: simulatorId, appName: "ShopDemo" },
  ],
};
const status: Status = { connected: true, managed: false, baseUrl: "", devices: [] };
function sources(): DeviceChoiceSources {
  return {
    async simulators() { return { ...status, devices: [{ udid: simulatorId, name: "iPhone 17", runtime: "iOS 27", state: "Booted" }] }; },
    async android() { return { ...status, devices: [{ udid: "emulator-5554", name: "Pixel 9", runtime: "Android", state: "Booted", platform: "android", kind: "emulator" }] }; },
    async physicalIos() { throw new Error("Should not discover unrelated physical devices"); },
  };
}
const requestSchema = z.object({ method: z.literal("openai/elicitation/create"), params: z.object({ mode: z.literal("form"), message: z.string(), requestedSchema: OpenAIFormSchema }) });

test("the native request waits for a single answer and returns verified device IDs", async t => {
  const server = new McpServer({ name: "device-choices", version: "1" });
  const extensions = new OpenAIExtensions(server);
  const discovery = sources();
  let androidReads = 0;
  const readAndroid = discovery.android;
  discovery.android = async () => { androidReads++; return readAndroid(); };
  registerDeviceChoiceTools(server, extensions, discovery, "openai");
  const client = new Client({ name: "native-host", version: "1" }, { capabilities: { extensions: { "openai/elicitation": { form: {} } } } });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  t.after(async () => { await client.close(); await server.close(); });
  let answer!: (result: OpenAIFormResult) => void;
  let shown!: () => void;
  const displayed = new Promise<void>(resolve => { shown = resolve; });
  client.setRequestHandler(requestSchema, async request => {
    assert.equal(request.params.message, input.message);
    const field = request.params.requestedSchema.properties.device;
    assert.equal(field.title, undefined);
    assert.equal(field.description, input.context);
    assert.ok("oneOf" in field && Array.isArray(field.oneOf));
    assert.equal(field.oneOf[0].title, "Pixel 9");
    assert.equal(field.oneOf[0].description, "Android emulator · ShopDemo");
    for (const option of field.oneOf) {
      const thumbnail = option["x-openai-thumbnail"];
      assert.ok(thumbnail);
      assert.equal(thumbnail.mimeType, "image/png");
      assert.match(thumbnail.src, /^data:image\/png;base64,[a-z0-9+/=]+$/i);
      const encoded = thumbnail.src.slice("data:image/png;base64,".length);
      const bytes = Buffer.from(encoded, "base64");
      const signature = bytes.subarray(0, 8);
      const expectedSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
      const width = bytes.readUInt32BE(16);
      const height = bytes.readUInt32BE(20);
      assert.deepEqual(signature, expectedSignature);
      assert.equal(width, 64);
      assert.equal(height, 100);
    }
    assert.equal(field.oneOf[1].description, "iOS simulator · iOS 27 · ShopDemo");
    const pending = new Promise<OpenAIFormResult>(resolve => { answer = resolve; });
    shown();
    return pending;
  });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  let completed = false;
  const pending = client.callTool({ name: "mobile_choose_devices", arguments: { ...input, selectionMode: "single" } }).then(result => { completed = true; return result; });
  await displayed;
  assert.equal(completed, false);
  answer({ action: "accept", content: { device: "device-1" } });
  const result = await pending;
  assert.equal(result.isError, undefined);
  assert.deepEqual(result.structuredContent, { action: "accept", devices: [{ ...input.devices[0], name: "Pixel 9", runtime: "Android", state: "Booted" }] });
  assert.equal(androidReads, 2, "Validate the selected device again after the user answers.");
});

for (const action of ["accept", "cancel", "decline", "invalid", "duplicate", "empty", "stale"] as const) {
  test(`multiple device selection handles ${action}`, async t => {
    const server = new McpServer({ name: "device-choices", version: "1" });
    const extensions = new OpenAIExtensions(server);
    const discovery = sources();
    registerDeviceChoiceTools(server, extensions, discovery, "openai");
    const client = new Client({ name: "native-host", version: "1" }, { capabilities: { extensions: { "openai/elicitation": { form: {} } } } });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    t.after(async () => { await client.close(); await server.close(); });
    client.setRequestHandler(requestSchema, async request => {
      const field = request.params.requestedSchema.properties.devices;
      assert.equal(field.type, "array");
      assert.equal(request.params.message, input.message);
      assert.equal(field.title, undefined);
      assert.equal(field.description, input.context);
      if (action === "cancel" || action === "decline") return { action };
      if (action === "stale") discovery.android = async () => ({ ...status });
      let devices = ["device-2", "device-1"];
      if (action === "invalid") devices = ["device-3"];
      if (action === "duplicate") devices = ["device-1", "device-1"];
      if (action === "empty") devices = [];
      return { action: "accept", content: { devices } };
    });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const result = await client.callTool({ name: "mobile_choose_devices", arguments: { ...input, selectionMode: "multiple" } });
    if (action === "accept") {
      assert.equal(result.isError, undefined);
      const selected = result.structuredContent?.devices;
      assert.ok(Array.isArray(selected));
      const ids = selected.map(device => device.deviceId);
      assert.deepEqual(ids, [simulatorId, "emulator-5554"]);
    } else if (action === "cancel" || action === "decline") {
      assert.deepEqual(result.structuredContent, { action, devices: [] });
    } else {
      assert.equal(result.isError, true);
      assert.equal(result.structuredContent, undefined);
    }
  });
}

test("discovery rejects duplicate, missing, wrong-kind and unauthorized candidates", async () => {
  const parsed = deviceChoiceInputSchema.parse(input);
  const android = parsed.devices[0];
  await assert.rejects(resolveDeviceChoices([android, android], sources()), /only once/);
  await assert.rejects(resolveDeviceChoices([{ ...android, deviceId: "missing" }], sources()), /no longer available/);
  await assert.rejects(resolveDeviceChoices([{ platform: "android", kind: "physical", deviceId: android.deviceId }], sources()), /no longer available/);
  const discovery = sources();
  const readAndroid = discovery.android;
  discovery.android = async () => {
    const listed = await readAndroid();
    listed.devices[0].state = "unauthorized";
    return listed;
  };
  await assert.rejects(resolveDeviceChoices([android], discovery), /offline or unauthorized/);
});

test("physical devices use hardware IDs; stopped simulators remain selectable for build tasks", async () => {
  const discovery = sources();
  discovery.physicalIos = async () => [{
    udid: "00008140-0011223344556677", coreDeviceId: simulatorId, name: "My iPhone", model: "iPhone 17", productType: "iPhone18,1",
    state: "connected", runtime: "iOS 27", platform: "ios", kind: "physical", transportType: "wired", pairingState: "paired",
  }];
  const physical = { platform: "ios", kind: "physical", deviceId: "00008140-0011223344556677" } as const;
  const devices = await resolveDeviceChoices([physical], discovery);
  assert.equal(devices[0].deviceId, physical.deviceId);
  await assert.rejects(resolveDeviceChoices([{ ...physical, deviceId: simulatorId }], discovery), /no longer available/);
  const parsed = deviceChoiceInputSchema.parse(input);
  discovery.simulators = async () => ({ ...status, devices: [{ udid: simulatorId, name: "iPhone 17", runtime: "iOS 27", state: "Shutdown" }] });
  const stopped = await resolveDeviceChoices([parsed.devices[1]], discovery);
  const form = deviceChoiceForm(parsed, stopped);
  const field = form.properties.device;
  assert.ok("oneOf" in field && Array.isArray(field.oneOf));
  assert.match(field.oneOf[0].description ?? "", /Stopped/);
  assert.equal(field.default, undefined, "No target is silently preselected.");
});

test("hosts are offered the form they render, preferring OpenAI's", () => {
  assert.equal(deviceChoiceFormSupport({ extensions: { "openai/elicitation": { form: {} } }, elicitation: { form: {} } }), "openai");
  assert.equal(deviceChoiceFormSupport({ elicitation: { form: {} } }), "mcp");
  assert.equal(deviceChoiceFormSupport({ elicitation: { url: {} } }), undefined);
  assert.equal(deviceChoiceFormSupport({ extensions: { "io.modelcontextprotocol/ui": {} } }), undefined);
  assert.equal(deviceChoiceFormSupport(undefined), undefined);
});

async function mcpFormClient(t: test.TestContext, discovery: DeviceChoiceSources, answer: (request: z.infer<typeof ElicitRequestSchema>) => unknown) {
  const server = new McpServer({ name: "device-choices", version: "1" });
  registerDeviceChoiceTools(server, new OpenAIExtensions(server), discovery, "mcp");
  // An empty elicitation capability means forms.
  const client = new Client({ name: "mcp-form-host", version: "1" }, { capabilities: { elicitation: {} } });
  client.setRequestHandler(ElicitRequestSchema, async request => answer(request) as never);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  t.after(async () => { await client.close(); await server.close(); });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}
function text(result: Awaited<ReturnType<Client["callTool"]>>) {
  const content = result.content;
  assert.ok(Array.isArray(content) && content[0].type === "text");
  return content[0].text;
}

test("MCP forms offer each device with its details as a titled option and return verified IDs", async t => {
  let requested: unknown;
  const client = await mcpFormClient(t, sources(), request => {
    requested = request.params;
    return { action: "accept", content: { devices: ["device-2"] } };
  });
  const result = await client.callTool({ name: "mobile_choose_devices", arguments: { ...input, selectionMode: "multiple" } });
  assert.equal(result.isError, undefined);
  assert.deepEqual(result.structuredContent, { action: "accept", devices: [{ ...input.devices[1], name: "iPhone 17", runtime: "iOS 27", state: "Booted" }] });
  assert.deepEqual(requested, {
    mode: "form", message: input.message,
    requestedSchema: { type: "object", required: ["devices"], properties: { devices: {
      type: "array", title: "Devices", description: input.context, minItems: 1, maxItems: 2,
      items: { anyOf: [{ const: "device-1", title: "Pixel 9 (Android emulator · ShopDemo)" }, { const: "device-2", title: "iPhone 17 (iOS simulator · iOS 27 · ShopDemo)" }] },
    } } },
  });
});

test("an MCP form answer outside the offered devices fails", async t => {
  const client = await mcpFormClient(t, sources(), () => ({ action: "accept", content: { device: "device-9" } }));
  const result = await client.callTool({ name: "mobile_choose_devices", arguments: { ...input, selectionMode: "single" } });
  assert.equal(result.isError, true);
});

test("without candidates the form offers selectable devices, running first, despite an unavailable backend", async t => {
  const discovery = sources();
  discovery.simulators = async () => ({ ...status, devices: [
    { udid: "22222222-2222-4222-8222-222222222222", name: "iPhone Air", runtime: "iOS 27", state: "Shutdown" },
    { udid: simulatorId, name: "iPhone 17", runtime: "iOS 27", state: "Booted" },
  ] });
  discovery.physicalIos = async () => { throw new Error("devicectl needs Xcode 27."); };
  let titles: string[] = [];
  const client = await mcpFormClient(t, discovery, request => {
    const field = request.params.mode === "url" ? undefined : request.params.requestedSchema.properties.device;
    titles = field && "oneOf" in field ? field.oneOf.map(option => option.title) : [];
    return { action: "decline" };
  });
  const result = await client.callTool({ name: "mobile_choose_devices", arguments: { message: "Which device?" } });
  assert.deepEqual(result.structuredContent, { action: "decline", devices: [] });
  assert.deepEqual(titles, ["iPhone 17 (iOS simulator · iOS 27)", "Pixel 9 (Android emulator)", "iPhone Air (iOS simulator · iOS 27 · Stopped)"]);
});

test("a choice requires a message, and fails with each backend's note when none can list devices", async t => {
  const fail = async (): Promise<never> => { throw new Error("Backend unavailable."); };
  const client = await mcpFormClient(t, { simulators: fail, android: fail, physicalIos: fail }, () => { throw new Error("must not ask"); });
  assert.equal((await client.callTool({ name: "mobile_choose_devices", arguments: { selectionMode: "single" } })).isError, true);
  const choice = await client.callTool({ name: "mobile_choose_devices", arguments: { message: "Which device?" } });
  assert.equal(choice.isError, true);
  assert.match(text(choice), /Backend unavailable/);
});
