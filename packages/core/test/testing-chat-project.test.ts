import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ListRootsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { TestingAgentRecordings } from "../src/testing-agent.ts";
import { TestingDevices } from "../src/testing-device.ts";
import { isChatProject, studioWorkspacePath } from "../src/testing-projects.ts";
import { createPanel } from "../src/panel-tools.ts";
import { Baguette } from "../src/baguette.ts";
import { createTestPlugin, fakeBaguette, fakeSimulatorInput } from "../../test-support/fixtures.ts";

async function scratch(body: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "chat-project-"));
  const previous = process.env.MOBILE_DEV_TESTING_DIRECTORY;
  process.env.MOBILE_DEV_TESTING_DIRECTORY = join(root, "state");
  try { await body(root); }
  finally {
    if (previous === undefined) delete process.env.MOBILE_DEV_TESTING_DIRECTORY; else process.env.MOBILE_DEV_TESTING_DIRECTORY = previous;
    await rm(root, { recursive: true, force: true });
  }
}

test("a folder is a project only when it carries a project marker", async () => {
  await scratch(async root => {
    const empty = join(root, "Codex/2026-11-18/use");
    await mkdir(empty, { recursive: true });
    await writeFile(join(empty, "notes.md"), "scratch");
    assert.equal(await isChatProject(empty), false, "a scratch folder is not a project");
    assert.equal(await isChatProject(join(root, "missing")), false);
    assert.equal(await isChatProject("relative/path"), false);
    assert.equal(await isChatProject(studioWorkspacePath()), false, "Testing Studio's own workspace is No project");

    const expo = join(root, "expo"); await mkdir(expo);
    await writeFile(join(expo, "package.json"), "{}");
    assert.equal(await isChatProject(expo), true);
    const native = join(root, "native"); await mkdir(join(native, "ios/App.xcodeproj"), { recursive: true });
    assert.equal(await isChatProject(native), true, "a native iOS project counts");
    const listed = join(root, "listed"); await mkdir(listed);
    assert.equal(await isChatProject(listed), false);
    assert.equal(await isChatProject(listed, [{ path: listed }]), true, "a project the panel already lists counts");
  });
});

function recordings(now: { at: number }) {
  return new TestingAgentRecordings({} as unknown as TestingDevices, undefined, { now: () => now.at });
}

test("an agent's project request is held for the panel until it reports that project", async () => {
  await scratch(async () => {
    const clock = { at: 1_000 };
    const rec = recordings(clock);
    assert.equal(rec.panelProjectRequest(), null, "nothing asked: the panel keeps its own selection");
    rec.requestPanelProject();
    assert.deepEqual(rec.panelProjectRequest(), { id: 1, path: studioWorkspacePath() }, "no project asks for Testing Studio");
    rec.setPanelProject("/work/expoapp57");
    assert.equal(rec.unmetProjectRequest(), studioWorkspacePath(), "the old project is not the requested one");
    setTimeout(() => rec.setPanelProject(studioWorkspacePath()), 100);
    assert.equal(await rec.awaitPanelProject(), studioWorkspacePath(), "calls wait for the panel to switch");
    assert.equal(rec.unmetProjectRequest(), undefined);
    rec.requestPanelProject("/work/app");
    assert.equal(rec.panelProjectRequest()?.id, 2);
    clock.at += 61_000;
    assert.equal(rec.panelProjectRequest(), null, "a stale request is not applied by a panel that loads much later");
  });
});

test("begin refuses to record on the old project while a request is unmet", async () => {
  await scratch(async () => {
    const rec = recordings({ at: Date.now() });
    rec.setPanelProject("/work/expoapp57");
    rec.requestPanelProject();
    await assert.rejects(() => rec.begin({ title: "t", goal: "g" }), /has not switched to No project yet/);
  });
});

async function openPlugin(t: test.TestContext, roots?: string[]) {
  const fake = await fakeBaguette();
  const plugin = await createTestPlugin("<html></html>", { panel: createPanel({ baguette: new Baguette(fake.url), simulatorInput: fakeSimulatorInput() }) });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "chat-project-test", version: "1" }, roots ? { capabilities: { roots: {} } } : {});
  if (roots) client.setRequestHandler(ListRootsRequestSchema, async () => ({ roots: roots.map(path => ({ uri: pathToFileURL(path).href })) }));
  t.after(async () => { await client.close(); await plugin.close(); await fake.close(); });
  await plugin.server.connect(serverTransport);
  await client.connect(clientTransport);
  const open = (args: Record<string, unknown>) => client.callTool({ name: "mobile_open_simulator", arguments: { workspaceTool: "testing", ...args } });
  const request = async () => (await client.callTool({ name: "mobile_testing_agent_state", arguments: {} })).structuredContent?.projectRequest;
  return { open, request, client };
}

test("opening the Testing Studio tab for a chat with no project asks for No project", async t => {
  await scratch(async root => {
    const folder = join(root, "Codex/2026-11-18/use"); await mkdir(folder, { recursive: true });
    const { open, request } = await openPlugin(t);
    const result = await open({ projectPath: folder });
    assert.equal(result.isError, undefined);
    assert.deepEqual((result.structuredContent?.panelTarget as Record<string, unknown>).workspaceTool, "testing");
    assert.equal((await request() as { path: string }).path, studioWorkspacePath());
    await open({ projectPath: "" });
    assert.equal((await request() as { id: number; path: string }).id, 2, "an empty path says there is no project");
  });
});

test("opening the Testing Studio tab for a chat with a project asks for that project", async t => {
  await scratch(async root => {
    const project = join(root, "my-app"); await mkdir(project);
    await writeFile(join(project, "package.json"), "{}");
    const { open, request } = await openPlugin(t);
    await open({ projectPath: project });
    assert.equal((await request() as { path: string }).path, project);
  });
});

test("without a project path or roots, opening leaves the panel's own selection alone", async t => {
  await scratch(async () => {
    const { open, request } = await openPlugin(t);
    await open({});
    assert.equal(await request(), null);
  });
});

test("a host's MCP root stands in for the project path", async t => {
  await scratch(async root => {
    const project = join(root, "rooted"); await mkdir(project);
    await writeFile(join(project, "app.json"), "{}");
    const { open, request } = await openPlugin(t, [project]);
    await open({});
    assert.equal((await request() as { path: string }).path, project);
    const other = await openPlugin(t, [join(root, "scratch-root")]);
    await other.open({});
    assert.equal((await other.request() as { path: string }).path, studioWorkspacePath(), "a root that is not a project is No project");
  });
});

test("a repeat open tells the agent the panel is already there, because the host draws a view per call", async t => {
  await scratch(async () => {
    const { open, client } = await openPlugin(t);
    const texts = (result: Awaited<ReturnType<typeof open>>) => (result.content as { type: string; text: string }[]).map(part => part.text).join("\n");
    assert.doesNotMatch(texts(await open({ projectPath: "" })), /already/i, "the first open says nothing");
    // The tab has not reported (hidden, or still loading): the second call is told one was opened.
    assert.match(texts(await open({ projectPath: "" })), /already opened in this chat.*Do not open more/s);
    // Once the tab heartbeats, the warning says it is live.
    await client.callTool({ name: "mobile_testing_set_context", arguments: { projectPath: studioWorkspacePath(), deviceId: "", bundleId: "" } });
    assert.match(texts(await open({ projectPath: "" })), /already open in this chat and the Testing Studio tab is reporting/);
  });
});

test("booting a device never opens a panel", async t => {
  await scratch(async () => {
    const { client } = await openPlugin(t);
    const result = await client.callTool({ name: "mobile_boot_simulator", arguments: { udid: "00000000-0000-0000-0000-000000000000" } });
    assert.doesNotMatch(JSON.stringify(result.content), /panel/i);
    const state = await client.callTool({ name: "mobile_testing_agent_state", arguments: {} });
    assert.equal(state.structuredContent?.projectRequest, null, "no open call was made, so no panel was asked for");
  });
});
