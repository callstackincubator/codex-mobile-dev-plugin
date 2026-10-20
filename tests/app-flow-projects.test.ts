import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as Sentry from "@sentry/node";
import type { Envelope } from "@sentry/core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { AppFlowProjectChoices } from "../src/server/app-flow-projects.ts";
import { AppFlowHost, type AppFlowHostServices } from "../src/server/app-flow-host.ts";
import { registerAppFlowTools } from "../src/server/app-flow-tools.ts";
import { scrubMetric } from "../src/shared/telemetry.ts";

async function projects(t: test.TestContext, pick?: () => Promise<string | undefined>) {
  const directory = await mkdtemp(join(tmpdir(), "mobile-dev-app-flow-projects-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { directory, choices: new AppFlowProjectChoices(directory, pick ?? (async () => undefined)) };
}

async function folder(t: test.TestContext, directory: string, name: string): Promise<string> {
  const path = join(directory, "apps", name);
  await mkdir(path, { recursive: true });
  return path;
}

async function paths(list: Array<{ path: string }>): Promise<string[]> {
  return list.map(entry => entry.path);
}

test("a chosen folder becomes the newest choice and survives the panel being rebuilt", async t => {
  const { directory, choices } = await projects(t);
  const first = await folder(t, directory, "First");
  const second = await folder(t, directory, "Second");
  await choices.record(first);
  const recorded = await choices.record(second);
  assert.deepEqual(recorded, { path: second, name: "Second", lastPickedAt: recorded.lastPickedAt });
  assert.deepEqual(await paths((await new AppFlowProjectChoices(directory).list())), [second, first]);
});

test("re-choosing a project moves it to the front instead of listing it twice", async t => {
  const { directory, choices } = await projects(t);
  const first = await folder(t, directory, "First");
  const second = await folder(t, directory, "Second");
  await choices.record(first);
  await choices.record(second);
  await choices.record(`${first}/`);
  assert.deepEqual(await paths(await choices.list()), [first, second]);
});

test("the selector also offers projects a map was built for, even without a pick", async t => {
  const { directory, choices } = await projects(t);
  const chat = await folder(t, directory, "FromChat");
  const picked = await folder(t, directory, "Picked");
  await mkdir(join(directory, "app-flows"), { recursive: true });
  await writeFile(join(directory, "app-flows", "projects.json"), JSON.stringify([{ id: "0123456789abcdef", name: "FromChat", path: chat, lastOpenedAt: "2026-10-01T10:00:00.000Z" }]));
  await choices.record(picked);
  assert.deepEqual(await paths(await choices.list()), [picked, chat]);
  // The engine owns its registry, so this list is never written back into it.
  assert.equal(JSON.parse(await readFile(join(directory, "projects.json"), "utf-8")).projects.length, 1);
});

test("unusable folders are refused and folders that disappear are left out", async t => {
  const { directory, choices } = await projects(t);
  await assert.rejects(() => choices.record("relative/project"), /Choose the app's project folder/);
  await assert.rejects(() => choices.record(join(directory, "gone")), /no longer exists/);
  const temporary = await folder(t, directory, "Temporary");
  await choices.record(temporary);
  await rm(temporary, { recursive: true, force: true });
  assert.deepEqual(await choices.list(), []);
});

test("the list stays bounded and a damaged registry leaves a usable picker", async t => {
  const { directory, choices } = await projects(t);
  for (let index = 0; index < 15; index++) await choices.record(await folder(t, directory, `App${index}`));
  assert.equal((await choices.list()).length, 12);
  const survivor = await folder(t, directory, "Survivor");
  await writeFile(join(directory, "projects.json"), "{not json");
  assert.deepEqual(await choices.list(), []);
  await writeFile(join(directory, "projects.json"), JSON.stringify({ version: 1, projects: [{ path: 5 }, survivor, { path: "relative", lastPickedAt: "x" }, "text", { path: `${survivor}/`, lastPickedAt: "not a date" }] }));
  assert.deepEqual(await paths(await choices.list()), [survivor]);
});

test("choices recorded together all reach the list", async t => {
  const { directory, choices } = await projects(t);
  const names = ["A", "B", "C", "D"];
  const folders = await Promise.all(names.map(name => folder(t, directory, name)));
  await Promise.all(folders.map(path => choices.record(path)));
  assert.deepEqual((await paths(await choices.list())).sort(), [...folders].sort());
});

test("the folder picker records its choice and a cancelled dialog changes nothing", async t => {
  const cancelled = await projects(t);
  assert.equal(await cancelled.choices.choose(), undefined);
  assert.deepEqual(await cancelled.choices.list(), []);
  const chosen = await folder(t, cancelled.directory, "Chosen");
  let opens = 0;
  const picker = await projects(t, async () => { opens++; return `${chosen}/`; });
  const project = await picker.choices.choose();
  assert.deepEqual(project, { path: chosen, name: "Chosen", lastPickedAt: project?.lastPickedAt });
  assert.equal(opens, 1);
  assert.deepEqual(await paths(await picker.choices.list()), [chosen]);
});

test("the folder dialog reports only its outcome, never the chosen path", async t => {
  const previous = process.env.MOBILE_DEV_TELEMETRY;
  delete process.env.MOBILE_DEV_TELEMETRY;
  t.after(() => { if (previous === undefined) delete process.env.MOBILE_DEV_TELEMETRY; else process.env.MOBILE_DEV_TELEMETRY = previous; });
  const envelopes: Envelope[] = [];
  Sentry.init({
    dsn: "https://public@example.com/1", defaultIntegrations: false, beforeSendMetric: scrubMetric,
    transport: () => ({ async send(envelope) { envelopes.push(envelope); return { statusCode: 200 }; }, async flush() { return true; } }),
  });
  t.after(async () => { await Sentry.close(); });
  const privateFolder = await mkdtemp(join(tmpdir(), "mobile-dev-app-flow-"));
  const privateProject = join(privateFolder, "PROJECT_PATH");
  await mkdir(privateProject, { recursive: true });
  t.after(() => rm(privateFolder, { recursive: true, force: true }));
  const { choices } = await projects(t, async () => privateProject);
  assert.equal((await choices.choose())?.path, privateProject);
  await Sentry.flush();
  const sent = JSON.stringify(envelopes);
  for (const fragment of ["app_flow.project_dialog.samples", "app_flow.project_dialog.duration", "millisecond", '"surface":{"value":"app-flow"', '"outcome":{"value":"chosen"', '"component":{"value":"server"']) {
    assert.equal(sent.includes(fragment), true, `Telemetry fragment: ${fragment}`);
  }
  assert.equal(sent.includes("server.address"), false, "the shared metric scrubber still applies");
  assert.equal(sent.includes(privateProject), false, "the chosen folder stays local");
  assert.equal(sent.includes(privateFolder), false, "its parent stays local too");
  assert.equal(sent.includes("PROJECT_PATH"), false);
  // A cancelled dialog reports its outcome and nothing else.
  const cancelled = await projects(t);
  await cancelled.choices.choose();
  await Sentry.flush();
  assert.equal(JSON.stringify(envelopes).includes('"outcome":{"value":"cancelled"'), true);
});

test("the panel's project tools stay out of the model's tool list and keep only real folders", async t => {
  const outside = await mkdtemp(join(tmpdir(), "mobile-dev-app-flow-dialog-"));
  t.after(() => rm(outside, { recursive: true, force: true }));
  const browsed = join(outside, "Browsed");
  await mkdir(browsed, { recursive: true });
  let fromDialog: string | undefined = browsed;
  const { directory, choices } = await projects(t, async () => fromDialog);
  const listed = await folder(t, directory, "Listed");
  const server = new McpServer({ name: "app-flow-projects-test", version: "1" });
  const cleared: string[] = [];
  const services = {
    async clear(projectPath: string) { cleared.push(projectPath); return { cleared: true as const, projectId: "project-1" }; },
  } as unknown as AppFlowHostServices;
  const close = registerAppFlowTools(server, new AppFlowHost(services), choices);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "app-flow-projects-test-client", version: "1" });
  t.after(async () => { await client.close(); await close(); await server.close(); });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  for (const name of ["mobile_appflow_projects", "mobile_appflow_choose_project"]) {
    const tool = (await client.listTools()).tools.find(candidate => candidate.name === name);
    assert.ok(tool, `${name} is registered`);
    assert.deepEqual(tool._meta?.ui?.visibility, ["app"], `${name} stays out of the model's tool budget`);
  }
  const clear = (await client.listTools()).tools.find(candidate => candidate.name === "mobile_appflow_clear");
  assert.ok(clear, "mobile_appflow_clear is registered");
  assert.deepEqual(clear._meta?.ui?.visibility, ["app"], "clearing stays out of the model's tool budget");
  assert.equal(clear.annotations?.destructiveHint, true);
  assert.deepEqual(clear.inputSchema.required, ["projectPath"]);
  const clearedResult = await client.callTool({ name: "mobile_appflow_clear", arguments: { projectPath: listed } });
  assert.equal(clearedResult.isError, undefined);
  assert.deepEqual(cleared, [listed]);
  const empty = await client.callTool({ name: "mobile_appflow_projects", arguments: {} });
  assert.equal(empty.isError, undefined);
  assert.deepEqual(empty.structuredContent?.projects, []);

  const picked = await client.callTool({ name: "mobile_appflow_choose_project", arguments: {} });
  assert.deepEqual(picked.structuredContent?.project, {
    path: browsed, name: "Browsed", lastPickedAt: (picked.structuredContent?.project as { lastPickedAt: string }).lastPickedAt,
  });

  const selected = await client.callTool({ name: "mobile_appflow_choose_project", arguments: { projectPath: listed } });
  assert.equal((selected.structuredContent?.project as { path: string }).path, listed);
  const refreshed = await client.callTool({ name: "mobile_appflow_projects", arguments: {} });
  assert.deepEqual(await paths(refreshed.structuredContent?.projects as Array<{ path: string }>), [listed, browsed]);

  fromDialog = undefined;
  const cancelled = await client.callTool({ name: "mobile_appflow_choose_project", arguments: {} });
  assert.equal(cancelled.isError, undefined);
  assert.equal("project" in (cancelled.structuredContent ?? {}), false, "a cancelled dialog reports no project");
  const unchanged = await client.callTool({ name: "mobile_appflow_projects", arguments: {} });
  assert.deepEqual(await paths(unchanged.structuredContent?.projects as Array<{ path: string }>), [listed, browsed]);

  const rejected = await client.callTool({ name: "mobile_appflow_choose_project", arguments: { projectPath: "relative/project" } });
  assert.equal(rejected.isError, true);
  assert.match(JSON.stringify(rejected.content), /Choose the app's project folder/);
});
