import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import { errorMessage } from "@mobile-dev/shared/protocol.ts";
import { ExpectedOperationError } from "@mobile-dev/shared/error-reporting.ts";
import { captureServerError, recordTestingSetupOperation } from "./telemetry.ts";
import type { TestingProjectChoices } from "./testing-projects.ts";
import { deleteTestFile, discardStagedTestFile, inspectProject, listTestFiles, previewTestFile, readTestFile, resolveTestRunPaths, saveStagedTestFile, stageTestFile, studioWorkspacePath, writeTestFile, writeTestTarget } from "./testing-projects.ts";
import { TestDraftStore } from "./testing-drafts.ts";
import { MAX_DRAFT_STEPS, recordedStepSchema, testDraftIdSchema } from "@mobile-dev/shared/test-drafts.ts";
import type { TestDraft } from "@mobile-dev/shared/test-drafts.ts";
import { TestingDevices } from "./testing-device.ts";
import { runRecordedTest } from "./testing-run.ts";
import type { TestRunRequest } from "./testing-run.ts";
import { MatrixRegistry, MAX_MATRIX_LIMIT, snapshotMatrix, startMatrix } from "./testing-matrix.ts";
import type { LaneExecutor, MatrixDevice, MatrixRun } from "./testing-matrix.ts";
import { createLaneExecutor } from "./testing-prepare.ts";
import type { DeviceOps } from "./testing-prepare.ts";
import { deviceIdSchema } from "@mobile-dev/shared/panel-target.ts";
import type { BundledModelProvider } from "./testing-run.ts";
import { answerTestingSetup, applyTestingSetup, cancelTestingSetup, inspectTestingSetup, planTestingSetup, readTestingModelPreference, saveTestingModelPreference, SETUP_PROVIDERS, startTestingLogin, testingSetupProgress } from "./testing-setup.ts";
import type { SetupOptions } from "./testing-setup.ts";

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
export function registerTestingTools(server: McpServer, projects: TestingProjectChoices, devices = new TestingDevices(), drafts = new TestDraftStore(), matrix: { ops?: DeviceOps; registry?: MatrixRegistry; run?: typeof runRecordedTest } = {}): () => Promise<void> {
  /**
   * Every run, as a matrix of lanes; a single run is a matrix of one.
   *
   * A tool call is one request and one response, so a run's own call cannot report as it goes.
   * The panel polls `mobile_testing_run_progress` instead, which is a few hundred bytes a second
   * against a local server for as long as a run takes — cheaper than holding a notification channel
   * open for a feature whose whole output is a spinner moving down a dozen lines.
   */
  const registry = matrix.registry ?? new MatrixRegistry();
  const runTest = matrix.run ?? runRecordedTest;
  const matrixWire = (run: MatrixRun) => ({ ...snapshotMatrix(run), running: run.lanes.some(lane => !["passed", "failed", "cancelled", "error"].includes(lane.state)) });
  registerAppTool(server, "mobile_testing_projects", {
    title: "List testing projects",
    description: "List the e2e project folders the Testing panel can record against, most recent first, and the private Studio workspace it uses when no project is open.",
    inputSchema: {},
    annotations: read,
    _meta: appVisibility,
  }, safe(async () => dataResult({ projects: await projects.list(), studioPath: studioWorkspacePath() })));

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
      platform: z.enum(["ios", "android"]).optional().describe("With bundleId: the app a Studio test is pinned to. Stored beside the test, never in its source."),
      bundleId: z.string().min(1).max(512).optional(),
    },
    // Replacing someone's test file is destructive, so the host asks before this runs.
    annotations: destructive,
    _meta: appVisibility,
  }, safe(async ({ projectPath: selected, relativePath, contents, overwrite, platform, bundleId }: { projectPath: string; relativePath: string; contents: string; overwrite?: boolean; platform?: "ios" | "android"; bundleId?: string }) => {
    const project = await inspectProject(selected);
    const result = await writeTestFile(selected, relativePath, contents, overwrite ?? false);
    if (result.written && platform && bundleId) await writeTestTarget(selected, relativePath, { platform, bundleId });
    const shownPath = project.runtimeMode === "bundled" ? `Studio/${relativePath}` : result.path;
    return dataResult({ ...result, path: shownPath, storageMode: project.runtimeMode }, result.written ? `Saved ${shownPath}` : `${shownPath} already exists.`);
  }));

  /**
   * The tests the project already holds.
   *
   * The other half of the panel's list. A recording that has been written into the project stops
   * being a draft, and the draft is deleted at that point — so until this existed, pressing Save
   * made the test leave the list altogether. Read from the folder rather than remembered, so a
   * test written by hand or by an agent is listed beside the recorded ones.
   */
  registerAppTool(server, "mobile_testing_tests", {
    title: "List the project's tests",
    description: "List the .e2e.ts files already in the project's tests/ folder, newest first.",
    inputSchema: { projectPath },
    annotations: read,
    _meta: appVisibility,
  }, safe(async ({ projectPath: selected }: { projectPath: string }) =>
    dataResult({ tests: await listTestFiles(selected) })));

  registerAppTool(server, "mobile_testing_read_file", {
    title: "Preview a project test",
    description: "Read the source of one .e2e.ts file in the project's tests/ folder for the Testing panel preview.",
    inputSchema: { projectPath, relativePath: z.string().min(1).max(512) },
    annotations: read,
    _meta: appVisibility,
  }, safe(async ({ projectPath: selected, relativePath }: { projectPath: string; relativePath: string }) =>
    dataResult(await previewTestFile(selected, relativePath))));

  registerAppTool(server, "mobile_testing_stage_file", {
    title: "Keep project test edits temporarily",
    description: "Keep edits to a project test in a temporary working copy without changing the project file.",
    inputSchema: { projectPath, relativePath: z.string().min(1).max(512), originalHash: z.string().length(64), source: z.string().max(256 * 1024) },
    annotations: write,
    _meta: appVisibility,
  }, safe(async ({ projectPath: selected, relativePath, originalHash, source }: { projectPath: string; relativePath: string; originalHash: string; source: string }) => {
    await stageTestFile(selected, relativePath, originalHash, source);
    return dataResult({ staged: true });
  }));

  registerAppTool(server, "mobile_testing_save_staged_file", {
    title: "Save project test edits",
    description: "Write a staged test to its original project file if that file has not changed since editing began.",
    inputSchema: { projectPath, relativePath: z.string().min(1).max(512) },
    annotations: destructive,
    _meta: appVisibility,
  }, safe(async ({ projectPath: selected, relativePath }: { projectPath: string; relativePath: string }) =>
    dataResult(await saveStagedTestFile(selected, relativePath))));

  registerAppTool(server, "mobile_testing_discard_staged_file", {
    title: "Undo project test edits",
    description: "Discard a temporary working copy and return the unchanged project test.",
    inputSchema: { projectPath, relativePath: z.string().min(1).max(512) },
    annotations: write,
    _meta: appVisibility,
  }, safe(async ({ projectPath: selected, relativePath }: { projectPath: string; relativePath: string }) =>
    dataResult(await discardStagedTestFile(selected, relativePath))));

  registerAppTool(server, "mobile_testing_delete_file", {
    title: "Delete one of the project's tests",
    description: "Delete one .e2e.ts file from the project's tests/ folder. The panel asks before calling this; the file is not recoverable from here.",
    inputSchema: {
      projectPath,
      relativePath: z.string().min(1).max(512).describe("The test to delete, relative to the project, e.g. tests/a-recorded-flow.e2e.ts."),
    },
    // Removing a file from the user's repository is exactly what the host should ask about.
    annotations: destructive,
    _meta: appVisibility,
  }, safe(async ({ projectPath: selected, relativePath }: { projectPath: string; relativePath: string }) => {
    const result = await deleteTestFile(selected, relativePath);
    return dataResult({ ...result }, result.removed ? `Deleted ${result.path}` : `${result.path} was already gone.`);
  }));

  /**
   * The unsaved recordings.
   *
   * A flow lives in the panel document until Save writes it into the project, and the host rebuilds
   * that document whenever the user looks at another tool or another chat — so a flow they have not
   * saved, or one their agent recorded while they were reading the chat, used to be gone when they
   * came back. The panel autosaves into these instead, and lists them so a flow can be reopened,
   * swapped for another or thrown away. Nothing here touches the user's project.
   */
  registerAppTool(server, "mobile_testing_drafts", {
    title: "List unsaved recordings",
    description: "List the recorded tests that have not been written into a project yet, newest first. Pass projectPath to list one project's drafts.",
    inputSchema: { projectPath: projectPath.optional() },
    annotations: read,
    _meta: appVisibility,
  }, safe(async ({ projectPath: selected }: { projectPath?: string }) =>
    dataResult({ drafts: await drafts.list(selected ?? "") })));

  registerAppTool(server, "mobile_testing_draft_read", {
    title: "Read an unsaved recording",
    description: "Read one unsaved recording, with its steps, so the panel can put it back in the step list.",
    inputSchema: { id: testDraftIdSchema },
    annotations: read,
    _meta: appVisibility,
  }, safe(async ({ id }: { id: string }) => {
    const draft = await drafts.read(id);
    return dataResult(draft ? { draft } : {}, draft ? undefined : "That recording is no longer there.");
  }));

  registerAppTool(server, "mobile_testing_draft_save", {
    title: "Keep an unsaved recording",
    description:
      "Write the recording in the panel to the plugin's own storage so it survives the panel being rebuilt. Nothing is written into the user's project; that is mobile_testing_write_file.",
    inputSchema: {
      id: testDraftIdSchema.optional().describe("The draft to replace. Omit to start a new one."),
      projectPath,
      title: z.string().max(160),
      fileName: z.string().max(256).optional(),
      origin: z.enum(["user", "agent"]).optional(),
      steps: z.array(recordedStepSchema).max(MAX_DRAFT_STEPS),
      source: z.string().max(256 * 1024).optional(),
    },
    // The plugin's own state, replaced wholesale by the panel that owns it.
    annotations: write,
    _meta: appVisibility,
  }, safe(async (input: { id?: string; projectPath: string; title: string; fileName?: string; origin?: "user" | "agent"; steps: TestDraft["steps"]; source?: string }) => {
    const draft = await drafts.save({ ...input, steps: input.steps });
    return dataResult({ id: draft.id, updatedAt: draft.updatedAt });
  }));

  registerAppTool(server, "mobile_testing_draft_delete", {
    title: "Delete an unsaved recording",
    description: "Forget one unsaved recording. The steps are gone; a recording already written into the project is untouched.",
    inputSchema: { id: testDraftIdSchema },
    // Throwing away a flow the user recorded and never saved is not recoverable.
    annotations: destructive,
    _meta: appVisibility,
  }, safe(async ({ id }: { id: string }) => {
    const removed = await drafts.remove(id);
    return dataResult({ removed }, removed ? "Deleted the recording." : "That recording was already gone.");
  }));

  registerAppTool(server, "mobile_testing_project_config", {
    title: "Read a testing project's config",
    description: "Read the targets of a project's e2e config: the target names, their platforms, and the bundle ids to launch.",
    inputSchema: { projectPath, foregroundPlatform: z.enum(["ios", "android"]).optional(), foregroundBundleId: z.string().min(1).max(512).optional() },
    annotations: read,
    _meta: appVisibility,
  }, safe(async ({ projectPath: selected, foregroundPlatform, foregroundBundleId }: { projectPath: string; foregroundPlatform?: "ios" | "android"; foregroundBundleId?: string }) => {
    const project = await inspectProject(selected, foregroundPlatform && foregroundBundleId ? { platform: foregroundPlatform, bundleId: foregroundBundleId } : undefined);
    return dataResult({ ...project, setup: await inspectTestingSetup(project.path, project.configPath || undefined), modelPreference: await readTestingModelPreference(), providers: SETUP_PROVIDERS });
  }));

  const setupTarget = z.object({ name: z.string().min(1).max(128), platform: z.enum(["ios", "android"]), bundleId: z.string().min(1).max(512) });
  const setupOptions = z.object({
    targets: z.array(setupTarget).min(1).max(100),
    provider: z.enum(["none", "vercel", "openrouter", "openai-compatible", "chatgpt", "copilot", "opencode-console", "grok"]),
    model: z.string().max(256).optional(), endpoint: z.string().max(2048).optional(),
    installDependencies: z.boolean(), installSkill: z.boolean(), registerMcp: z.boolean(),
  });
  registerAppTool(server, "mobile_testing_setup_plan", {
    title: "Preview e2e setup",
    description: "Build an immutable, non-writing e2e init plan for the selected project. The plan must be confirmed and remains valid only while every affected file is unchanged.",
    inputSchema: { projectPath, options: setupOptions }, annotations: read, _meta: appVisibility,
  }, safe(async ({ projectPath: selected, options }: { projectPath: string; options: SetupOptions }) => {
    try { const plan = await planTestingSetup(selected, options); recordTestingSetupOperation("plan", "succeeded", options.provider); return dataResult({ plan }); }
    catch (error) { recordTestingSetupOperation("plan", "failed", options.provider); throw error; }
  }));
  registerAppTool(server, "mobile_testing_setup_apply", {
    title: "Apply confirmed e2e setup", description: "Apply an unchanged preview plan and optionally install dependencies. Existing configs and example tests are preserved; progress is read separately.",
    inputSchema: { planId: z.string().length(64) }, annotations: destructive, _meta: appVisibility,
  }, safe(async ({ planId }: { planId: string }) => { const operation = applyTestingSetup(planId); recordTestingSetupOperation("apply", "started"); return dataResult({ operation }); }));
  registerAppTool(server, "mobile_testing_setup_progress", {
    title: "Read e2e setup progress", description: "Read setup or subscription-login progress without exposing credentials.",
    inputSchema: { operationId: z.string().uuid() }, annotations: read, _meta: appVisibility,
  }, safe(async ({ operationId }: { operationId: string }) => { const operation = testingSetupProgress(operationId); if (!operation) throw new ExpectedOperationError("invalid_input", "That setup operation is no longer available."); return dataResult({ operation }); }));
  registerAppTool(server, "mobile_testing_setup_cancel", {
    title: "Cancel e2e setup", description: "Cancel dependency installation or an in-progress E2E login. Files already applied are left in place and reported by progress.",
    inputSchema: { operationId: z.string().uuid() }, annotations: write, _meta: appVisibility,
  }, safe(async ({ operationId }: { operationId: string }) => dataResult({ cancelled: cancelTestingSetup(operationId) })));
  registerAppTool(server, "mobile_testing_setup_login", {
    title: "Sign in to an E2E subscription", description: "Start an OAuth login using the bundled E2E runtime's provider callbacks. The panel shows its URL, device code and prompts.",
    inputSchema: { provider: z.enum(["openai", "github-copilot", "opencode-console", "spacexai"]) }, annotations: write, _meta: appVisibility,
  }, safe(async ({ provider: selected }: { provider: "openai" | "github-copilot" | "opencode-console" | "spacexai" }) => { const operation = startTestingLogin(selected); recordTestingSetupOperation("login", "started"); return dataResult({ operation }); }));
  registerAppTool(server, "mobile_testing_setup_answer", {
    title: "Answer an E2E login prompt", description: "Return the pasted authorization code requested by E2E's OAuth callback. The answer is used in memory and never persisted by Mobile Dev.",
    inputSchema: { operationId: z.string().uuid(), value: z.string().max(8192) }, annotations: write, _meta: appVisibility,
  }, safe(async ({ operationId, value }: { operationId: string; value: string }) => dataResult({ accepted: answerTestingSetup(operationId, value) })));
  registerAppTool(server, "mobile_testing_model_preference", {
    title: "Save the Testing model preference", description: "Save or clear only the non-secret provider, model and endpoint preference used by bundled runs. Keys and OAuth credentials are never accepted.",
    inputSchema: { preference: z.object({ provider: z.enum(["vercel", "openrouter", "openai-compatible", "chatgpt", "copilot", "opencode-console", "grok"]), model: z.string().min(1).max(256), endpoint: z.string().max(2048).optional() }).optional() }, annotations: write, _meta: appVisibility,
  }, safe(async ({ preference }: { preference?: { provider: BundledModelProvider; model: string; endpoint?: string } }) => { await saveTestingModelPreference(preference); recordTestingSetupOperation("preference", "succeeded", preference?.provider); return dataResult({ saved: Boolean(preference) }); }));

  registerAppTool(server, "mobile_testing_read_tree", {
    title: "Read the runner's element tree",
    description:
      "Read the element tree the e2e runner queries, for the app the device is already showing. The recorder names selectors from this so role vocabulary and name sources match what the test will run against.",
    inputSchema: {
      deviceId: deviceIdSchema,
      platform: z.enum(["ios", "android"]).describe("The mirrored device's platform: an iOS simulator's deviceId is its UDID, an Android emulator's its adb serial."),
      projectPath,
      bundleId: z.string().min(1).max(512).describe("The target's bundle id, from the project's e2e config."),
    },
    annotations: read,
    _meta: appVisibility,
  }, safe(async ({ deviceId, platform, projectPath: selected, bundleId }: { deviceId: string; platform: "ios" | "android"; projectPath: string; bundleId: string }) => {
    const project = await inspectProject(selected, { platform, bundleId });
    // The refs go no further than the server: the panel records selectors and drives the mirror,
    // so an agent-device handle per element would be a few kilobytes a read that nothing reads.
    const { tree, screen } = await devices.read({ deviceId, platform, projectPath: selected, runtimeRoot: project.runtime.root, bundleId });
    return dataResult({ tree, ...(screen ? { screen } : {}) });
  }));

  registerAppTool(server, "mobile_testing_set_target", {
    title: "Pin a Studio test to an app",
    description: "Store the app (platform and bundle id) a saved Studio test runs against. Only Studio tests carry one; a project test keeps using its config's target. With mode add, the app is added for its platform and the app the test was recorded against stays.",
    inputSchema: { projectPath, relativePath: z.string().min(1).max(512), platform: z.enum(["ios", "android"]), bundleId: z.string().min(1).max(512), mode: z.enum(["replace", "add"]).optional() },
    annotations: write,
    _meta: appVisibility,
  }, safe(async ({ projectPath: selected, relativePath, platform, bundleId, mode }: { projectPath: string; relativePath: string; platform: "ios" | "android"; bundleId: string; mode?: "replace" | "add" }) =>
    dataResult({ pinned: await writeTestTarget(selected, relativePath, { platform, bundleId }, mode) })));

  const modelSchema = z.object({
    provider: z.enum(["vercel", "openrouter", "openai-compatible", "chatgpt", "copilot", "opencode-console", "grok"]),
    model: z.string().min(1).max(256), endpoint: z.string().url().max(2048).optional(),
  });
  type RunInput = { projectPath: string; relativePath: string; configPath?: string; timeoutMs?: number; target?: string; platform?: "ios" | "android"; bundleId?: string; pin?: boolean; model?: { provider: BundledModelProvider; model: string; endpoint?: string }; untilSource?: string };

  /** Everything a run needs before a device is chosen: the same for a single run and for every lane. */
  async function prepareRequest(input: RunInput) {
    const { projectPath: selected, relativePath, configPath, timeoutMs, target, platform, bundleId, pin, model, untilSource } = input;
    const project = await inspectProject(selected, platform && bundleId ? { platform, bundleId } : undefined);
    if (pin && platform && bundleId) await writeTestTarget(selected, relativePath, { platform, bundleId }).catch(() => false);
    const paths = await resolveTestRunPaths(selected, relativePath, project.runtimeMode === "project" ? configPath : undefined, untilSource !== undefined);
    const selectedTarget = project.targets.find(entry => entry.name === target)
      ?? project.targets.find(entry => entry.platform === platform && (!bundleId || entry.bundleId === bundleId))
      ?? project.targets[0];
    const bundledSource = project.runtimeMode === "bundled" ? (untilSource ?? await readTestFile(selected, relativePath)) : untilSource;
    const request: TestRunRequest = { ...paths, ...(timeoutMs === undefined ? {} : { timeoutMs }), ...(target ? { target } : {}),
      ...(bundledSource === undefined ? {} : { untilSource: bundledSource }), runtime: { mode: project.runtimeMode, root: project.runtime.root },
      ...(project.runtimeMode === "bundled" && platform && bundleId ? { bundledTarget: { platform, bundleId } }
        : project.runtimeMode === "bundled" && selectedTarget?.platform && selectedTarget.bundleId ? { bundledTarget: { platform: selectedTarget.platform as "ios" | "android", bundleId: selectedTarget.bundleId } } : {}),
      ...(model ? { model } : {}) };
    return { request, project };
  }

  /** Starts a matrix whose lanes run `request` and returns once it is registered. */
  function launchMatrix(testPath: string, devices_: MatrixDevice[], limit: number | undefined, executor: LaneExecutor) {
    return startMatrix(registry, { testPath, devices: devices_, ...(limit === undefined ? {} : { limit }) }, executor);
  }

  registerAppTool(server, "mobile_testing_run_test", {
    title: "Run a recorded test",
    description:
      "Run one saved test with the project's own e2e CLI and report each step with the line it came from. The recorder's device session is released first: the runner allows one session per device, so a run started while the recorder holds it fails with \"Device is already in use\". Runs on the one device the runner picks; use mobile_testing_run_matrix to choose devices.",
    inputSchema: {
      projectPath,
      relativePath: z.string().min(1).max(512).describe("The test to run, relative to the project, e.g. tests/a-recorded-flow.e2e.ts."),
      configPath: z.string().min(1).max(4096).optional().describe("The project's e2e config, so the run can report live per-step progress."),
      timeoutMs: z.number().int().min(10_000).max(30 * 60_000).optional(),
      target: z.string().min(1).max(256).optional().describe("The e2e target name to run against, so a flow recorded on Android does not run on the config's first (iOS) target."),
      platform: z.enum(["ios", "android"]).optional().describe("The mirrored platform for a bundled run."),
      bundleId: z.string().min(1).max(512).optional().describe("The app identifier for a bundled run: the test's pinned app, or the foreground app when it has none."),
      pin: z.boolean().optional().describe("Pin platform and bundleId to the saved test before running, for a bundled test that has no app yet."),
      model: modelSchema.optional(),
      untilSource: z.string().min(1).max(400_000).optional().describe(
        "Run this truncated copy of the test instead of the file itself, for \"play until here\": the same flow cut off after one step. It is written beside the test for the one run and removed afterwards; the file itself is not touched."),
    },
    // A test run drives the app on the device: it taps, types and changes the app's own state.
    annotations: destructive,
    _meta: appVisibility,
  }, safe(async (input: RunInput) => {
    // The release is a dependency of the run, not a step the caller is trusted to have taken: see
    // `TestRunDeps`. The panel releases too, but a caller who forgets must not break the run.
    const { request } = await prepareRequest(input);
    const executor: LaneExecutor = {
      // No device is chosen and nothing is booted or installed: the runner picks, as it always has.
      prepare: async () => "",
      run: (_lane, _device, signal, onProgress) => runTest(request, { release: () => devices.release(), onProgress, signal }),
    };
    const { run, done } = launchMatrix(input.relativePath, [{ deviceId: "auto", platform: input.platform ?? "ios", name: "Default device" }], 1, executor);
    await done;
    const lane = run.lanes[0]!;
    // A run that could not start at all is the caller's error, as it was before lanes existed.
    if (lane.state === "error" || (lane.state === "cancelled" && !lane.result)) throw new Error(lane.error ?? "The test run was cancelled.");
    return dataResult({ ...lane.result!, matrixId: run.matrixId }, `${input.relativePath} ${lane.result!.status}.`);
  }));

  registerAppTool(server, "mobile_testing_run_matrix", {
    title: "Run a recorded test on several devices",
    description:
      "Run one saved test on several devices at once, one independent lane per device, and return a matrixId immediately; read progress with mobile_testing_run_progress. At most `limit` lanes run at once (default 3, max 8); the rest are queued. Devices that are off are booted, and a device missing the app gets it installed by copying it from another device in the run that has it; otherwise that lane fails with \"App not installed\". Bundled mode only. A failure on one device does not stop the others.",
    inputSchema: {
      projectPath,
      relativePath: z.string().min(1).max(512).describe("The test to run, relative to the project."),
      devices: z.array(z.object({
        deviceId: deviceIdSchema.describe("An iOS simulator UDID, an Android serial, or an avd: id from the device lists."),
        platform: z.enum(["ios", "android"]),
        name: z.string().min(1).max(128).optional().describe("A label for the lane."),
      })).min(1).max(16),
      apps: z.object({ ios: z.string().min(1).max(512).optional(), android: z.string().min(1).max(512).optional() })
        .describe("The app id per platform: the iOS bundle id and the Android package name."),
      limit: z.number().int().min(1).max(MAX_MATRIX_LIMIT).optional().describe("How many devices run at once. Default 3."),
      timeoutMs: z.number().int().min(10_000).max(30 * 60_000).optional(),
      model: modelSchema.optional(),
      untilSource: z.string().min(1).max(400_000).optional().describe("A truncated copy of the test to run instead of the file."),
    },
    annotations: destructive,
    _meta: appVisibility,
  }, safe(async (input: Omit<RunInput, "platform" | "bundleId" | "pin" | "target" | "configPath"> & { devices: MatrixDevice[]; apps: { ios?: string; android?: string }; limit?: number }) => {
    const unique = new Set(input.devices.map(device => device.deviceId));
    if (unique.size !== input.devices.length) throw new ExpectedOperationError("invalid_input", "Each device can appear only once in a matrix.");
    if (!matrix.ops) throw new ExpectedOperationError("unsupported_platform", "This server cannot prepare devices for a matrix run.");
    const first = input.devices[0]!;
    const { request, project } = await prepareRequest({ ...input, platform: first.platform, ...(input.apps[first.platform] ? { bundleId: input.apps[first.platform]! } : {}) });
    if (project.runtimeMode !== "bundled") throw new ExpectedOperationError("invalid_input", "Running on several devices is available for Mobile Dev's bundled runner. This project uses its own e2e config, so run it on one device.");
    // Only the devices of this matrix lose the recorder; a recorder on another device keeps its session.
    await devices.releaseOn(input.devices.map(device => device.deviceId)).catch(() => undefined);
    const executor = createLaneExecutor({
      ops: matrix.ops, apps: input.apps,
      runTest: (lane, deviceId, signal, onProgress) => runTest(
        { ...request, bundledTarget: { platform: lane.platform, bundleId: input.apps[lane.platform]!, device: deviceId } },
        { release: () => devices.releaseOn([lane.deviceId, deviceId]), onProgress, signal }),
    });
    const { run } = launchMatrix(input.relativePath, input.devices, input.limit, executor);
    return dataResult({ matrixId: run.matrixId, limit: run.limit, lanes: snapshotMatrix(run).lanes }, `Started ${run.lanes.length} lanes, up to ${run.limit} at once.`);
  }));

  registerAppTool(server, "mobile_testing_run_progress", {
    title: "Read a run's progress",
    description:
      "Read the lanes of a matrix run: each device's state (queued, booting, installing, running, passed, failed, cancelled, error), the steps it has started and finished so far, and its result. Without a matrixId it reads the latest run, whose first lane's steps are also returned as `progress`. Each step carries its index within its test, which is its position among the file's awaited calls.",
    inputSchema: { matrixId: z.string().min(1).max(128).optional() },
    annotations: read,
    _meta: appVisibility,
  }, safe(async ({ matrixId }: { matrixId?: string }) => {
    const run = matrixId ? registry.get(matrixId) : registry.latest();
    if (matrixId && !run) throw new ExpectedOperationError("invalid_input", "That run is no longer available.");
    if (!run) return dataResult({ running: false, progress: [], lanes: [], busyDevices: registry.busyDevices() });
    const wire = matrixWire(run);
    return dataResult({ ...wire, progress: wire.lanes[0]?.progress ?? [], busyDevices: registry.busyDevices() });
  }));

  registerAppTool(server, "mobile_testing_cancel", {
    title: "Cancel a test run",
    description: "Cancel one device's lane of a matrix run, or every lane that has not finished. A queued lane never starts; a running lane's process is stopped.",
    inputSchema: { matrixId: z.string().min(1).max(128), deviceId: deviceIdSchema.optional().describe("Cancel only this device's lane.") },
    annotations: write,
    _meta: appVisibility,
  }, safe(async ({ matrixId, deviceId }: { matrixId: string; deviceId?: string }) => {
    if (!registry.get(matrixId)) throw new ExpectedOperationError("invalid_input", "That run is no longer available.");
    const cancelled = registry.cancel(matrixId, deviceId);
    return dataResult({ cancelled: cancelled.map(lane => lane.deviceId) }, `Cancelled ${cancelled.length} lane${cancelled.length === 1 ? "" : "s"}.`);
  }));

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
