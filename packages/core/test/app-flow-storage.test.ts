import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { configureAppFlowHost } from "../src/app-flow/host.ts";
import { clearSavedAppFlow, getProjectId } from "../src/app-flow/storage.ts";

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

test("clearing removes the complete project artifact unit but preserves both project registries", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "mobile-dev-app-flow-storage-"));
  temporary.push(dataDir);
  configureAppFlowHost({ dataDir, emit() {}, async loadAgentDevice() { throw new Error("unused"); } });

  const projectId = getProjectId("/projects/demo");
  const projectDir = join(dataDir, "app-flows", projectId);
  const engineRegistry = JSON.stringify([{ id: projectId, path: "/projects/demo" }]);
  const pickerRegistry = JSON.stringify({ version: 1, projects: [{ path: "/projects/demo" }] });
  await mkdir(join(projectDir, "screens"), { recursive: true });
  await mkdir(join(projectDir, "flows"), { recursive: true });
  await mkdir(join(projectDir, "scratch"), { recursive: true });
  await Promise.all([
    writeFile(join(dataDir, "app-flows", "projects.json"), engineRegistry),
    writeFile(join(dataDir, "projects.json"), pickerRegistry),
    writeFile(join(projectDir, "app-flow.json"), "{}"),
    writeFile(join(projectDir, "manifest.json"), "{}"),
    writeFile(join(projectDir, "sweep-progress.json"), "{}"),
    writeFile(join(projectDir, "screens", "home.png"), "screen"),
    writeFile(join(projectDir, "flows", "home.ad"), "flow"),
    writeFile(join(projectDir, "scratch", "probe.png"), "scratch"),
  ]);

  await clearSavedAppFlow(projectId);

  await assert.rejects(access(projectDir));
  assert.equal(await readFile(join(dataDir, "app-flows", "projects.json"), "utf8"), engineRegistry);
  assert.equal(await readFile(join(dataDir, "projects.json"), "utf8"), pickerRegistry);
});
