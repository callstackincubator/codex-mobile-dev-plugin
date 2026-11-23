import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { projectLaneTargets, registerTestingTools } from "../src/testing-tools.ts";
import { TestingProjectChoices } from "../src/testing-projects.ts";
import { TestingDevices } from "../src/testing-device.ts";
import { createLaneExecutor } from "../src/testing-prepare.ts";
import { MatrixRegistry, startMatrix } from "../src/testing-matrix.ts";
import type { DeviceOps } from "../src/testing-prepare.ts";
import type { TestRunRequest } from "../src/testing-run.ts";

const CONFIG = `import { mobile } from "@e2e-dev/mobile";
export default { targets: [
  { name: "ios", engine: mobile({ platform: "ios" }), app: { bundleId: "com.example.ios" } },
  { name: "android", engine: mobile({ platform: "android" }), app: { bundleId: "com.example.android" } },
] };
`;

async function projectWithRuntime(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "matrix-project-"));
  await writeFile(join(root, "e2e.config.ts"), CONFIG);
  await mkdir(join(root, "node_modules/.bin"), { recursive: true });
  await mkdir(join(root, "node_modules/e2e"), { recursive: true });
  await mkdir(join(root, "node_modules/@e2e-dev/mobile/dist"), { recursive: true });
  await writeFile(join(root, "node_modules/.bin/e2e"), "");
  await writeFile(join(root, "node_modules/e2e/package.json"), JSON.stringify({ version: "0.17.0" }));
  await writeFile(join(root, "node_modules/@e2e-dev/mobile/package.json"), JSON.stringify({ version: "0.9.2" }));
  await writeFile(join(root, "node_modules/@e2e-dev/mobile/dist/nodes.js"), "export {};\n");
  return root;
}

function machine(apps: Record<string, string[]>) {
  const log: string[] = [];
  const ops: DeviceOps = {
    async isBooted(_p, id) { return id !== "OFF"; },
    async boot(_p, id) { log.push(`boot ${id}`); return id; },
    async hasApp(_p, id, app) { return apps[id]?.includes(app) ?? false; },
    async copyApp() { log.push("copy"); },
    async launch(_p, id) { log.push(`launch ${id}`); },
  };
  return { ops, log };
}

async function connect(root: string, ops: DeviceOps, run: (request: TestRunRequest) => void) {
  const server = new McpServer({ name: "t", version: "1" });
  const registry = new MatrixRegistry();
  registerTestingTools(server, new TestingProjectChoices(join(root, "state")), new TestingDevices(), undefined, {
    ops, registry, run: async request => { run(request); return { status: "passed", exitCode: 0, steps: [] }; },
  });
  const client = new Client({ name: "c", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return { client, registry };
}

async function settled(registry: MatrixRegistry) {
  for (let i = 0; i < 200 && registry.busy; i++) await new Promise(resolve => setTimeout(resolve, 10));
}

test("a project with its own e2e config now runs a matrix: each lane gets the config's target for its platform and its own device", async () => {
  const root = await projectWithRuntime();
  const { ops, log } = machine({ A: ["com.example.ios"], B: ["com.example.ios"], E: ["com.example.android"] });
  const requests: TestRunRequest[] = [];
  const { client, registry } = await connect(root, ops, request => requests.push(request));
  const result = await client.callTool({ name: "mobile_testing_run_matrix", arguments: {
    projectPath: root, relativePath: "tests/flow.e2e.ts", untilSource: 'test("x", async () => {});\n', apps: {},
    devices: [{ deviceId: "A", platform: "ios" }, { deviceId: "B", platform: "ios" }, { deviceId: "E", platform: "android" }],
  } });
  assert.notEqual(result.isError, true, JSON.stringify(result.content));
  await settled(registry);
  assert.deepEqual(requests.map(request => request.projectLane).sort((l, r) => l!.device.localeCompare(r!.device)), [
    { target: "ios", device: "A" }, { target: "ios", device: "B" }, { target: "android", device: "E" }].sort((l, r) => l.device.localeCompare(r.device)));
  assert.ok(requests.every(request => request.configPath === join(root, "e2e.config.ts")));
  assert.ok(log.every(line => line.startsWith("boot") === false) && !log.some(line => line.startsWith("launch") || line === "copy"), "the plugin does not launch a project's app, and nothing needed copying");
  assert.deepEqual(registry.latest()!.lanes.map(lane => lane.state), ["passed", "passed", "passed"]);
});

test("a project lane on a device without the app gets it copied from another device in the run", async () => {
  const root = await projectWithRuntime();
  const { ops, log } = machine({ A: ["com.example.ios"], B: [] });
  const requests: TestRunRequest[] = [];
  const { client, registry } = await connect(root, ops, request => requests.push(request));
  await client.callTool({ name: "mobile_testing_run_matrix", arguments: {
    projectPath: root, relativePath: "tests/flow.e2e.ts", untilSource: 'test("x", async () => {});\n', apps: {},
    devices: [{ deviceId: "A", platform: "ios" }, { deviceId: "B", platform: "ios" }],
  } });
  await settled(registry);
  assert.deepEqual(registry.latest()!.lanes.map(lane => lane.state), ["passed", "passed"]);
  assert.ok(log.includes("copy"), "the missing app is copied from A");
  assert.deepEqual(requests.map(request => request.projectLane!.device).sort(), ["A", "B"]);
});

test("a platform the config has no target for is refused before anything boots", async () => {
  const root = await projectWithRuntime();
  await writeFile(join(root, "e2e.config.ts"), CONFIG.replace(/\n  \{ name: "android"[^\n]*/, ""));
  const { ops, log } = machine({});
  const { client, registry } = await connect(root, ops, () => undefined);
  const result = await client.callTool({ name: "mobile_testing_run_matrix", arguments: {
    projectPath: root, relativePath: "tests/flow.e2e.ts", untilSource: 'test("x", async () => {});\n', apps: {},
    devices: [{ deviceId: "OFF", platform: "android" }],
  } });
  assert.equal(result.isError, true);
  assert.match(JSON.stringify(result.content), /no android target/);
  assert.equal(registry.latest(), undefined);
  assert.deepEqual(log, []);
});

test("project lane targets default to each platform's first target and honour a named one", () => {
  const targets = [
    { name: "ios-a", platform: "ios", bundleId: "a" }, { name: "ios-b", platform: "ios", bundleId: "b" }, { name: "web" }, { name: "android", platform: "android", bundleId: "c" },
  ];
  const devices = [{ deviceId: "1", platform: "ios" as const }, { deviceId: "2", platform: "android" as const }];
  assert.deepEqual(projectLaneTargets(targets, devices), { ios: { name: "ios-a", bundleId: "a" }, android: { name: "android", bundleId: "c" } });
  assert.equal(projectLaneTargets(targets, devices, { ios: "ios-b" }).ios!.bundleId, "b");
  assert.throws(() => projectLaneTargets(targets, devices, { ios: "android" }), /no ios target named "android"/);
  assert.throws(() => projectLaneTargets(targets, devices, { ios: "missing" }), /no ios target named "missing"/);
});

test("project mode skips the launch the bundled lane does", async () => {
  const { ops, log } = machine({ A: ["com.app"] });
  const executor = createLaneExecutor({ ops, apps: { ios: "com.app" }, projectMode: true, runTest: async () => ({ status: "passed", exitCode: 0, steps: [] }) });
  const { done } = startMatrix(new MatrixRegistry(), { testPath: "t", devices: [{ deviceId: "A", platform: "ios" }] }, executor);
  await done;
  assert.deepEqual(log, []);
});
