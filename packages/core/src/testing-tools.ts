import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import { errorMessage } from "@mobile-dev/shared/protocol.ts";
import { captureServerError } from "./telemetry.ts";
import type { TestingProjectChoices } from "./testing-projects.ts";
import { inspectProject, writeTestFile } from "./testing-projects.ts";
import { TestingDevices } from "./testing-device.ts";
import { runRecordedTest } from "./testing-run.ts";
import type { TestRunProgress } from "./testing-run.ts";
import { udidSchema } from "@mobile-dev/shared/protocol.ts";

const read = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const write = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
const destructive = { readOnlyHint: false, destructiveHint: true, openWorldHint: false };
/** The Testing panel drives these itself; the model has its own e2e MCP server for test work. */
const appVisibility = { ui: { visibility: ["app"] as ("app" | "model")[] } };

const projectPath = z.string().min(1).max(4096);

function safe<T>(handler: (input: T) => Promise<CallToolResult>) {
  return async (input: T): Promise<CallToolResult> => {
    try {
      return await handler(input);
    } catch (error) {
      captureServerError(error, "testing.tool");
      return { isError: true, content: [{ type: "text", text: errorMessage(error) }] };
    }
  };
}

function dataResult(data: Record<string, unknown>, message?: string): CallToolResult {
  return { content: [{ type: "text", text: message ?? JSON.stringify(data) }], structuredContent: data };
}

/** The Testing panel's project selection, and the device tree its recorder names selectors from. */
/** Returns the shutdown the plugin has to run: the recorder's device session, handed back. */
export function registerTestingTools(server: McpServer, projects: TestingProjectChoices, devices = new TestingDevices()): () => Promise<void> {
  /**
   * The live progress of the run in flight.
   *
   * A tool call is one request and one response, so the run's own call cannot report as it goes.
   * The panel polls this one instead, which is a few hundred bytes a second against a local server
   * for as long as a run takes — cheaper than holding a notification channel open for a feature
   * whose whole output is a spinner moving down a dozen lines.
   */
  let progress: TestRunProgress[] = [];
  let running = false;
  registerAppTool(server, "mobile_testing_projects", {
    title: "List testing projects",
    description: "List the e2e project folders the Testing panel can record against, most recent first.",
    inputSchema: {},
    annotations: read,
    _meta: appVisibility,
  }, safe(async () => dataResult({ projects: await projects.list() })));

  registerAppTool(server, "mobile_testing_choose_project", {
    title: "Choose a testing project",
    description:
      "Choose the project the Testing panel records against: pass projectPath to select one the panel already lists, or nothing to open the system folder picker. The folder must hold an e2e.config.ts. The choice persists across sessions.",
    inputSchema: { projectPath: projectPath.optional() },
    annotations: write,
    _meta: appVisibility,
  }, safe(async ({ projectPath: selected }: { projectPath?: string }) => {
    const project = selected === undefined ? await projects.choose() : await projects.record(selected);
    return dataResult(project ? { project } : {}, project ? undefined : "No project was chosen.");
  }));

  registerAppTool(server, "mobile_testing_write_file", {
    title: "Save a recorded test",
    description:
      "Write a recorded test into the project's tests/ folder. Without overwrite an existing file is reported back untouched instead of being replaced.",
    inputSchema: {
      projectPath,
      relativePath: z.string().min(1).max(512).describe("Path under the project, inside tests/, ending in .e2e.ts."),
      contents: z.string().max(256 * 1024),
      overwrite: z.boolean().optional(),
    },
    // Replacing someone's test file is destructive, so the host asks before this runs.
    annotations: destructive,
    _meta: appVisibility,
  }, safe(async ({ projectPath: selected, relativePath, contents, overwrite }: { projectPath: string; relativePath: string; contents: string; overwrite?: boolean }) => {
    const result = await writeTestFile(selected, relativePath, contents, overwrite ?? false);
    return dataResult({ ...result }, result.written ? `Saved ${result.path}` : `${result.path} already exists.`);
  }));

  registerAppTool(server, "mobile_testing_project_config", {
    title: "Read a testing project's config",
    description: "Read the targets of a project's e2e config: the target names, their platforms, and the bundle ids to launch.",
    inputSchema: { projectPath },
    annotations: read,
    _meta: appVisibility,
  }, safe(async ({ projectPath: selected }: { projectPath: string }) =>
    dataResult({ ...await inspectProject(selected) })));

  registerAppTool(server, "mobile_testing_read_tree", {
    title: "Read the runner's element tree",
    description:
      "Read the element tree the e2e runner queries, for the app the device is already showing. The recorder names selectors from this so role vocabulary and name sources match what the test will run against.",
    inputSchema: {
      udid: udidSchema,
      projectPath,
      bundleId: z.string().min(1).max(512).describe("The target's bundle id, from the project's e2e config."),
    },
    annotations: read,
    _meta: appVisibility,
  }, safe(async ({ udid, projectPath: selected, bundleId }: { udid: string; projectPath: string; bundleId: string }) =>
    dataResult({ ...await devices.read({ udid, projectPath: selected, bundleId }) })));

  registerAppTool(server, "mobile_testing_run_test", {
    title: "Run a recorded test",
    description:
      "Run one saved test with the project's own e2e CLI and report each step with the line it came from. The recorder's device session is released first: the runner allows one session per device, so a run started while the recorder holds it fails with \"Device is already in use\".",
    inputSchema: {
      projectPath,
      relativePath: z.string().min(1).max(512).describe("The test to run, relative to the project, e.g. tests/a-recorded-flow.e2e.ts."),
      configPath: z.string().min(1).max(4096).optional().describe("The project's e2e config, so the run can report live per-step progress."),
      timeoutMs: z.number().int().min(10_000).max(30 * 60_000).optional(),
    },
    // A test run drives the app on the device: it taps, types and changes the app's own state.
    annotations: destructive,
    _meta: appVisibility,
  }, safe(async ({ projectPath: selected, relativePath, configPath, timeoutMs }: { projectPath: string; relativePath: string; configPath?: string; timeoutMs?: number }) => {
    // The release is a dependency of the run, not a step the caller is trusted to have taken: see
    // `TestRunDeps`. The panel releases too, but a caller who forgets must not break the run.
    progress = [];
    running = true;
    try {
      const result = await runRecordedTest(
        { projectPath: selected, relativePath, ...(configPath ? { configPath } : {}), ...(timeoutMs === undefined ? {} : { timeoutMs }) },
        { release: () => devices.release(), onProgress: entry => { progress.push(entry); } });
      return dataResult({ ...result }, `${relativePath} ${result.status}.`);
    } finally {
      running = false;
    }
  }));

  registerAppTool(server, "mobile_testing_run_progress", {
    title: "Read a run's progress",
    description:
      "Read the steps the run in flight has started and finished so far, as the runner's own event spine reports them. Each entry carries the step's index within its test, which is its position among the file's awaited calls.",
    inputSchema: {},
    annotations: read,
    _meta: appVisibility,
  }, safe(async () => dataResult({ running, progress: [...progress] })));

  registerAppTool(server, "mobile_testing_release_device", {
    title: "Release the recorder's device",
    description:
      "Close the recorder's session on the device. A session left open makes the next `e2e run` fail because the device is already in use, so the panel calls this whenever it stops recording.",
    inputSchema: {},
    annotations: write,
    _meta: appVisibility,
  }, safe(async () => { await devices.release(); return dataResult({ released: true }, "Released the device."); }));

  /**
   * A server that goes away without releasing leaves the claim behind, and the daemon that holds it
   * outlives the server. The user then sees their own `e2e run` refuse to boot the device — "has an
   * ownership claim that could not be verified" — with nothing on screen connecting it to a panel
   * they closed. Every ordinary path already releases; this is the one that is not ordinary.
   */
  return () => devices.release();
}
