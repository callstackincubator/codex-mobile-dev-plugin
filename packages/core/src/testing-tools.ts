import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import { errorMessage } from "@mobile-dev/shared/protocol.ts";
import { ExpectedOperationError } from "@mobile-dev/shared/error-reporting.ts";
import { captureServerError, recordTestingSetupOperation } from "./telemetry.ts";
import type { TestingProjectChoices } from "./testing-projects.ts";
import { deleteTestFile, discardStagedTestFile, inspectProject, listTestFiles, previewTestFile, readTestFile, readTestTarget, resolveTestRunPaths, saveStagedTestFile, stageTestFile, studioWorkspacePath, writeTestFile, writeTestTarget } from "./testing-projects.ts";
import type { TestTarget } from "./testing-projects.ts";
import { branchStoredStepLocator } from "@mobile-dev/shared/stored-test-steps.ts";
import { compactElements, describeFailure } from "./testing-failure.ts";
import type { TestingAgentContext } from "./testing-agent.ts";
import { TestDraftStore } from "./testing-drafts.ts";
import { MAX_DRAFT_STEPS, recordedStepSchema, testDraftIdSchema } from "@mobile-dev/shared/test-drafts.ts";
import type { TestDraft } from "@mobile-dev/shared/test-drafts.ts";
import { bundledE2eRoot, testingRuntimeDownload } from "./e2e-runtime.ts";
import { TestingDevices } from "./testing-device.ts";
import { runRecordedTest, sweepLaneFiles } from "./testing-run.ts";
import type { TestRunRequest } from "./testing-run.ts";
import { MatrixRegistry, MAX_MATRIX_LIMIT, snapshotMatrix, startMatrix } from "./testing-matrix.ts";
import type { LaneExecutor, MatrixDevice, MatrixRun } from "./testing-matrix.ts";
import { LAUNCHER_APP, createLaneExecutor } from "./testing-prepare.ts";
import type { DeviceOps } from "./testing-prepare.ts";
import { deviceIdSchema } from "@mobile-dev/shared/panel-target.ts";
import { simulatorBundleForPid } from "./device-apps/apps.ts";
import type { BundledModelProvider } from "./testing-run.ts";
import { answerTestingSetup, applyTestingSetup, cancelTestingSetup, inspectTestingSetup, planTestingSetup, readTestingLoginStatus, readTestingModelPreference, saveTestingModelPreference, SETUP_PROVIDERS, startTestingLogin, testingSetupProgress } from "./testing-setup.ts";
import type { SetupOptions } from "./testing-setup.ts";

const read = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const write = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
const destructive = { readOnlyHint: false, destructiveHint: true, openWorldHint: false };
/** The Testing Studio panel drives these itself; the model has its own e2e MCP server for test work. */
const appVisibility = { ui: { visibility: ["app"] as ("app" | "model")[] } };
/**
 * The tools an agent drives No project (Testing Studio) mode with: run, progress, cancel, pin an app,
 * read a test, list tests, branch a line, wait for an app. The panel calls them too.
 */
const sharedVisibility = { ui: { visibility: ["app", "model"] as ("app" | "model")[] } };

/** What the Testing Studio tab has told the server; see `TestingAgentRecordings.setPanelProject`. */
export interface PanelContext {
  panelProjectPath(): string | undefined;
  /** Like `panelProjectPath`, but waits out the panel's first report when the tab was only just opened. */
  awaitPanelProject?(): Promise<string | undefined>;
  panelContext?(): TestingAgentContext | undefined;
}

/** Quote-aware: one expression with balanced brackets and no `;` outside a string. */
function singleExpression(text: string): boolean {
  const closing: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
  const stack: string[] = [];
  let quote = "";
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    if (char === "\\" && quote) { index++; continue; }
    if (quote) { if (char === quote) quote = ""; continue; }
    if (char === "\n" || char === ";") return false;
    if (char === '"' || char === "'" || char === "`") { quote = char; continue; }
    if (closing[char]) stack.push(closing[char]!);
    else if ([")", "]", "}"].includes(char) && stack.pop() !== char) return false;
  }
  return !quote && stack.length === 0;
}

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

/**
 * The config target each platform of a project matrix runs: the named one, else the platform's first.
 * A platform with no target, or a named target of another platform, refuses before anything boots.
 */
export function projectLaneTargets(targets: readonly { name: string; platform?: string; bundleId?: string }[], devices: readonly MatrixDevice[], named?: { ios?: string; android?: string }): Partial<Record<MatrixDevice["platform"], { name: string; bundleId: string }>> {
  const chosen: Partial<Record<MatrixDevice["platform"], { name: string; bundleId: string }>> = {};
  for (const platform of new Set(devices.map(device => device.platform))) {
    const target = named?.[platform]
      ? targets.find(entry => entry.name === named[platform])
      : targets.find(entry => entry.platform === platform && entry.bundleId);
    if (!target || target.platform !== platform || !target.bundleId)
      throw new ExpectedOperationError("invalid_input", `The project's e2e config has no ${platform} target${named?.[platform] ? ` named "${named[platform]}"` : ""} with a bundleId, so devices of that platform cannot run it.`);
    chosen[platform] = { name: target.name, bundleId: target.bundleId };
  }
  return chosen;
}

/** The Testing Studio panel's project selection, and the device tree its recorder names selectors from. */
/** Returns the shutdown the plugin has to run: the recorder's device session, handed back. */
export function registerTestingTools(server: McpServer, projects: TestingProjectChoices, devices = new TestingDevices(), drafts = new TestDraftStore(), matrix: { ops?: DeviceOps; registry?: MatrixRegistry; run?: typeof runRecordedTest; panel?: PanelContext; pollMs?: number; failureReadMs?: number; foregroundBundle?: (deviceId: string, pid: number) => Promise<string | undefined> } = {}): () => Promise<void> {
  /**
   * Every run, as a matrix of lanes; a single run is a matrix of one.
   *
   * A tool call is one request and one response, so a run's own call cannot report as it goes.
   * The panel polls `mobile_testing_run_progress` instead, which is a few hundred bytes a second
   * against a local server for as long as a run takes — cheaper than holding a notification channel
   * open for a feature whose whole output is a spinner moving down a dozen lines.
   */
  const registry = matrix.registry ?? new MatrixRegistry();
  // Lane copies of a project's config that a crashed run left beside it. Best effort, and only files whose process is gone.
  void projects.list().then(list => Promise.all(list.map(entry => sweepLaneFiles(entry.path)))).catch(() => undefined);
  const runTest = matrix.run ?? runRecordedTest;
  /**
   * The project a model-visible tool works on. With a panel, the Testing Studio tab must have reported a
   * project — that is the only proof the user has it open — and a call that names none defaults to
   * it, so the agent never needs to know where Testing Studio lives.
   */
  const panel = matrix.panel;
  async function resolveProject(selected?: string): Promise<string> {
    if (!panel) {
      if (!selected) throw new ExpectedOperationError("invalid_input", "Pass projectPath.");
      return selected;
    }
    // Right after an agent opened the tab its first heartbeat may not have arrived; wait for it.
    const current = await panel.awaitPanelProject?.() ?? panel.panelProjectPath();
    if (!current) throw new ExpectedOperationError("invalid_input", "The Testing Studio tab is not open, so there is no project to work on. If no Mobile Dev panel is showing in this chat, open it once with mobile_open_simulator (workspaceTool \"testing\"), then try again; if you already opened one, do not open another (each call adds a panel) and ask the user to show the existing panel and its Testing Studio tab.");
    return selected ?? current;
  }
  const matrixWire = (run: MatrixRun) => ({ ...snapshotMatrix(run), running: run.lanes.some(lane => !["passed", "failed", "cancelled", "error"].includes(lane.state)) });
  registerAppTool(server, "mobile_testing_projects", {
    title: "List testing projects",
    description: "List the e2e project folders the Testing Studio panel can record against, most recent first, and the private Testing Studio workspace it uses when no project is open.",
    inputSchema: {},
    annotations: read,
    _meta: appVisibility,
  }, safe(async () => dataResult({ projects: await projects.list(), studioPath: studioWorkspacePath() })));

  registerAppTool(server, "mobile_testing_choose_project", {
    title: "Choose a testing project",
    description:
      "Choose the project the Testing Studio panel records against: pass projectPath to select one the panel already lists, or nothing to open the system folder picker. The folder must hold an e2e.config.ts. The choice persists across sessions.",
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
      platform: z.enum(["ios", "android"]).optional().describe("With bundleId: the app a Testing Studio test is pinned to. Stored beside the test, never in its source."),
      bundleId: z.string().min(1).max(512).optional(),
    },
    // Replacing someone's test file is destructive, so the host asks before this runs.
    annotations: destructive,
    _meta: appVisibility,
  }, safe(async ({ projectPath: selected, relativePath, contents, overwrite, platform, bundleId }: { projectPath: string; relativePath: string; contents: string; overwrite?: boolean; platform?: "ios" | "android"; bundleId?: string }) => {
    const project = await inspectProject(selected);
    const result = await writeTestFile(selected, relativePath, contents, overwrite ?? false);
    if (result.written && platform && bundleId) await writeTestTarget(selected, relativePath, { platform, bundleId });
    const shownPath = project.runtimeMode === "bundled" ? `Testing Studio/${relativePath}` : result.path;
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
    description: "List the .e2e.ts files already in the project's tests/ folder, newest first. Each carries the app it is pinned to: target.platform and target.bundleId for the app it was recorded against, and target.apps for the app added on the other platform. projectPath defaults to the Testing Studio tab's project.",
    inputSchema: { projectPath: projectPath.optional() },
    annotations: read,
    _meta: sharedVisibility,
  }, safe(async ({ projectPath: selected }: { projectPath?: string }) =>
    dataResult({ tests: await listTestFiles(await resolveProject(selected)) })));

  registerAppTool(server, "mobile_testing_read_file", {
    title: "Preview a project test",
    description: "Read the source of one .e2e.ts file in the project's tests/ folder. Lines are numbered from 1; the line numbers in a failed run's steps and failure refer to this source. projectPath defaults to the Testing Studio tab's project.",
    inputSchema: { projectPath: projectPath.optional(), relativePath: z.string().min(1).max(512) },
    annotations: read,
    _meta: sharedVisibility,
  }, safe(async ({ projectPath: selected, relativePath }: { projectPath?: string; relativePath: string }) =>
    dataResult(await previewTestFile(await resolveProject(selected), relativePath))));

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
    inputSchema: {
      projectPath, foregroundPlatform: z.enum(["ios", "android"]).optional(), foregroundBundleId: z.string().min(1).max(512).optional(),
      foregroundDeviceId: deviceIdSchema.optional().describe("With foregroundPid, for an iOS simulator app the device's app list leaves out (Apple's own apps)."),
      foregroundPid: z.number().int().positive().optional(),
    },
    annotations: read,
    _meta: appVisibility,
  }, safe(async ({ projectPath: selected, foregroundPlatform, foregroundBundleId, foregroundDeviceId, foregroundPid }: { projectPath: string; foregroundPlatform?: "ios" | "android"; foregroundBundleId?: string; foregroundDeviceId?: string; foregroundPid?: number }) => {
    // The panel's device list names only apps that can be monitored, so an Apple app in front (Fitness,
    // Settings) arrives as a pid alone. The home screen is never an app to record.
    const resolved = foregroundBundleId ?? (foregroundPlatform === "ios" && foregroundDeviceId && foregroundPid
      ? await (matrix.foregroundBundle ?? simulatorBundleForPid)(foregroundDeviceId, foregroundPid).catch(() => undefined) : undefined);
    const bundleId = resolved && !LAUNCHER_APP.test(resolved) ? resolved : undefined;
    const project = await inspectProject(selected, foregroundPlatform && bundleId ? { platform: foregroundPlatform, bundleId } : undefined);
    const needsRuntime = project.runtimeMode === "bundled" && testingRuntimeDownload && testingRuntimeDownload.progress.phase !== "ready";
    return dataResult({ ...project, needsRuntime: Boolean(needsRuntime), setup: await inspectTestingSetup(project.path, project.configPath || undefined), modelPreference: await readTestingModelPreference(), providers: SETUP_PROVIDERS });
  }));

  const download = testingRuntimeDownload;
  if (download) {
    const currentProgress = async () => {
      const loginStatus = download.progress.phase === "ready" ? await readTestingLoginStatus() : undefined;
      return dataResult({ progress: { ...download.progress }, loginStatus });
    };
    registerAppTool(server, "mobile_testing_prepare_runtime", {
      title: "Prepare the Testing Studio runtime",
      description: "Start the pinned Testing Studio download on first use, or retry a failed installation.",
      inputSchema: { retry: z.boolean().optional() },
      annotations: { ...write, openWorldHint: true },
      _meta: appVisibility,
    }, safe(async ({ retry }: { retry?: boolean }) => {
      const phase = download.progress.phase;
      if (phase === "idle" || (phase === "failed" && retry)) {
        // Polls report the terminal error without holding the initial MCP request open.
        void download.ensure().catch(() => {});
      }
      return currentProgress();
    }));
    registerAppTool(server, "mobile_testing_runtime_progress", {
      title: "Read Testing Studio download progress",
      description: "Read the current download and installation status.",
      inputSchema: {}, annotations: read, _meta: appVisibility,
    }, safe(currentProgress));
  }

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
    const runtimeRoot = project.runtimeMode === "bundled" ? await bundledE2eRoot() : project.runtime.root;
    const { tree, screen } = await devices.read({ deviceId, platform, projectPath: selected, runtimeRoot, bundleId });
    return dataResult({ tree, ...(screen ? { screen } : {}) });
  }));

  registerAppTool(server, "mobile_testing_set_target", {
    title: "Pin a Testing Studio test to an app",
    description: "Store the app (platform and bundle id) a saved Testing Studio test runs against. Only Testing Studio tests carry one; a project test keeps using its config's target. With mode add, the app is added for its platform and the app the test was recorded against stays: use it to give a test the app for its other platform, with the bundleId mobile_testing_wait_for_app returned. Returns the app id pinned. projectPath defaults to the Testing Studio tab's project.",
    inputSchema: { projectPath: projectPath.optional(), relativePath: z.string().min(1).max(512), platform: z.enum(["ios", "android"]), bundleId: z.string().min(1).max(512), mode: z.enum(["replace", "add"]).optional() },
    annotations: write,
    _meta: sharedVisibility,
  }, safe(async ({ projectPath: selected, relativePath, platform, bundleId, mode }: { projectPath?: string; relativePath: string; platform: "ios" | "android"; bundleId: string; mode?: "replace" | "add" }) => {
    const pinned = await writeTestTarget(await resolveProject(selected), relativePath, { platform, bundleId }, mode);
    return dataResult({ pinned, ...(pinned ? { added: { platform, bundleId, mode: mode ?? "replace" } } : {}) },
      pinned ? `Pinned ${platform} ${bundleId} to ${relativePath} (${mode ?? "replace"}).` : "Only Testing Studio tests carry a pinned app; nothing was changed.");
  }));

  const modelSchema = z.object({
    provider: z.enum(["vercel", "openrouter", "openai-compatible", "chatgpt", "copilot", "opencode-console", "grok"]),
    model: z.string().min(1).max(256), endpoint: z.string().url().max(2048).optional(),
  });
  type RunInput = { projectPath: string; relativePath: string; configPath?: string; timeoutMs?: number; target?: string; platform?: "ios" | "android"; bundleId?: string; pin?: boolean; model?: { provider: BundledModelProvider; model: string; endpoint?: string }; untilSource?: string };

  /** Everything a run needs before a device is chosen: the same for a single run and for every lane. */
  async function prepareRequest(input: RunInput) {
    const { projectPath: selected, relativePath, configPath, timeoutMs, target, pin, model, untilSource } = input;
    // A Testing Studio test remembers its app, so a caller that names none runs the one it was pinned to.
    let { platform, bundleId } = input;
    if (!(platform && bundleId)) {
      const stored = await readTestTarget(selected, relativePath).catch(() => undefined);
      if (stored) ({ platform, bundleId } = storedApp(stored, platform, bundleId));
    }
    const project = await inspectProject(selected, platform && bundleId ? { platform, bundleId } : undefined);
    if (pin && platform && bundleId) await writeTestTarget(selected, relativePath, { platform, bundleId }).catch(() => false);
    const paths = await resolveTestRunPaths(selected, relativePath, project.runtimeMode === "project" ? configPath : undefined, untilSource !== undefined);
    const selectedTarget = project.targets.find(entry => entry.name === target)
      ?? project.targets.find(entry => entry.platform === platform && (!bundleId || entry.bundleId === bundleId))
      ?? project.targets[0];
    const bundledSource = project.runtimeMode === "bundled" ? (untilSource ?? await readTestFile(selected, relativePath)) : untilSource;
    const runtimeRoot = project.runtimeMode === "bundled" ? await bundledE2eRoot() : project.runtime.root;
    const request: TestRunRequest = { ...paths, ...(timeoutMs === undefined ? {} : { timeoutMs }), ...(target ? { target } : {}),
      ...(bundledSource === undefined ? {} : { untilSource: bundledSource }), runtime: { mode: project.runtimeMode, root: runtimeRoot },
      ...(project.runtimeMode === "bundled" && platform && bundleId ? { bundledTarget: { platform, bundleId } }
        : project.runtimeMode === "bundled" && selectedTarget?.platform && selectedTarget.bundleId ? { bundledTarget: { platform: selectedTarget.platform as "ios" | "android", bundleId: selectedTarget.bundleId } } : {}),
      ...(model ? { model } : {}) };
    return { request, project, platform, bundleId };
  }

  /** The app a stored target gives a platform (the recorded platform's, or the one added). */
  function storedApp(stored: TestTarget, platform?: "ios" | "android", bundleId?: string): { platform: "ios" | "android"; bundleId?: string } {
    const chosen = platform ?? stored.platform;
    return { platform: chosen, bundleId: bundleId ?? (chosen === stored.platform ? stored.bundleId : stored.apps?.[chosen]) };
  }

  /**
   * The failing line and the device's screen, set on the lane before it settles, so whoever polls
   * the run has what it takes to choose a locator without another call. Best effort: the run's own
   * verdict is already in hand, and a device that cannot be read only costs the element list.
   */
  async function attachFailure(lane: { failure?: import("./testing-failure.ts").LaneFailure }, result: Awaited<ReturnType<typeof runRecordedTest>>, source: string,
    read: { deviceId: string; platform: "ios" | "android"; projectPath: string; runtimeRoot: string; bundleId?: string }) {
    const failure = describeFailure(result, source);
    if (!failure) return;
    lane.failure = failure;
    if (!read.bundleId) { failure.elementsError = "No app id is known for this device, so its screen was not read."; return; }
    if (!read.deviceId) { failure.elementsError = "The runner chose the device, so its screen was not read. Run with mobile_testing_run_matrix to name one."; return; }
    try {
      const timeout = matrix.failureReadMs ?? 20_000;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const tree = await Promise.race([
        devices.read({ deviceId: read.deviceId, platform: read.platform, projectPath: read.projectPath, runtimeRoot: read.runtimeRoot, bundleId: read.bundleId }),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Reading the device's screen timed out.")), timeout); }),
      ]).finally(() => clearTimeout(timer));
      Object.assign(failure, compactElements(tree.tree, tree.screen));
    } catch (error) {
      failure.elementsError = errorMessage(error);
    } finally {
      // The next run takes the device; a session this read left behind would refuse it.
      await devices.releaseOn([read.deviceId]).catch(() => undefined);
    }
  }

  /** Starts a matrix whose lanes run `request` and returns once it is registered. */
  function launchMatrix(testPath: string, devices_: MatrixDevice[], limit: number | undefined, executor: LaneExecutor) {
    return startMatrix(registry, { testPath, devices: devices_, ...(limit === undefined ? {} : { limit }) }, executor);
  }

  registerAppTool(server, "mobile_testing_run_test", {
    title: "Run a recorded test",
    description:
      "Run one saved test and report each step with the line it came from. Blocks until the run ends; for a long test, or to choose the device, start it with mobile_testing_run_matrix and read mobile_testing_run_progress. Without platform and bundleId a Testing Studio test runs the app it is pinned to. The recorder's device session is released first. A failed run carries `failure`: the failing line, its error and, when the device can be read, its screen as locator rows to pick from. projectPath defaults to the Testing Studio tab's project.",
    inputSchema: {
      projectPath: projectPath.optional(),
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
    _meta: sharedVisibility,
  }, safe(async (raw: Omit<RunInput, "projectPath"> & { projectPath?: string }) => {
    const input: RunInput = { ...raw, projectPath: await resolveProject(raw.projectPath) };
    // The release is a dependency of the run, not a step the caller is trusted to have taken: see
    // `TestRunDeps`. The panel releases too, but a caller who forgets must not break the run.
    const { request, project, platform, bundleId } = await prepareRequest(input);
    const lanePlatform = platform ?? "ios";
    const executor: LaneExecutor = {
      // No device is chosen and nothing is booted or installed: the runner picks, as it always has.
      prepare: async () => "",
      run: async (lane, _device, signal, onProgress) => {
        const result = await runTest(request, { release: () => devices.release(), onProgress, signal });
        const context = panel?.panelContext?.();
        const source = request.untilSource ?? await readTestFile(input.projectPath, input.relativePath).catch(() => "");
        await attachFailure(lane, result, source, { deviceId: context && context.platform === lanePlatform ? context.deviceId : "", platform: lanePlatform, projectPath: input.projectPath, runtimeRoot: project.runtime.root, ...(bundleId ? { bundleId } : {}) });
        return result;
      },
    };
    const { run, done } = launchMatrix(input.relativePath, [{ deviceId: "auto", platform: lanePlatform, name: "Default device" }], 1, executor);
    await done;
    const lane = run.lanes[0]!;
    // A run that could not start at all is the caller's error, as it was before lanes existed.
    if (lane.state === "error" || (lane.state === "cancelled" && !lane.result)) throw new Error(lane.error ?? "The test run was cancelled.");
    return dataResult({ ...lane.result!, matrixId: run.matrixId, ...(lane.failure ? { failure: lane.failure } : {}) }, `${input.relativePath} ${lane.result!.status}.`);
  }));

  registerAppTool(server, "mobile_testing_run_matrix", {
    title: "Run a recorded test on several devices",
    description:
      "Run one saved test on several devices at once, one independent lane per device (iOS and Android can be mixed), and return a matrixId immediately; read progress with mobile_testing_run_progress. At most `limit` lanes run at once (default 3, max 8); the rest are queued. Devices that are off are booted. In bundled mode a device missing the app gets it installed by copying it from another booted device that has it (one in the run first); otherwise that lane fails with \"App not installed\"; `apps` defaults to the apps the test is pinned to, and a platform with no app is refused, naming the fix. In a project with its own e2e config each lane runs the config's target for the device's platform (or `targets`) on that device, a device missing the app gets it copied the same way, and the target's engine must be a direct mobile(...) call. A failure on one device does not stop the others, and its lane carries `failure` (line, error, screen). projectPath defaults to the Testing Studio tab's project.",
    inputSchema: {
      projectPath: projectPath.optional(),
      relativePath: z.string().min(1).max(512).describe("The test to run, relative to the project."),
      devices: z.array(z.object({
        deviceId: deviceIdSchema.describe("An iOS simulator UDID, an Android serial, or an avd: id from the device lists."),
        platform: z.enum(["ios", "android"]),
        name: z.string().min(1).max(128).optional().describe("A label for the lane."),
      })).min(1).max(16),
      apps: z.object({ ios: z.string().min(1).max(512).optional(), android: z.string().min(1).max(512).optional() }).optional()
        .describe("The app id per platform: the iOS bundle id and the Android package name. Defaults to the apps the test is pinned to. Ignored for a project with its own e2e config, which uses its targets' apps."),
      targets: z.object({ ios: z.string().min(1).max(256).optional(), android: z.string().min(1).max(256).optional() }).optional()
        .describe("Project mode only: the config's target name per platform. Defaults to the first target of each platform."),
      limit: z.number().int().min(1).max(MAX_MATRIX_LIMIT).optional().describe("How many devices run at once. Default 3."),
      timeoutMs: z.number().int().min(10_000).max(30 * 60_000).optional(),
      model: modelSchema.optional(),
      untilSource: z.string().min(1).max(400_000).optional().describe("A truncated copy of the test to run instead of the file."),
    },
    annotations: destructive,
    _meta: sharedVisibility,
  }, safe(async (raw: Omit<RunInput, "projectPath" | "platform" | "bundleId" | "pin" | "target" | "configPath"> & { projectPath?: string; devices: MatrixDevice[]; apps?: { ios?: string; android?: string }; targets?: { ios?: string; android?: string }; limit?: number }) => {
    const projectPathValue = await resolveProject(raw.projectPath);
    const stored = await readTestTarget(projectPathValue, raw.relativePath).catch(() => undefined);
    const apps: { ios?: string; android?: string } = { ...(stored ? { [stored.platform]: stored.bundleId, ...stored.apps } : {}), ...raw.apps };
    const input = { ...raw, projectPath: projectPathValue, apps };
    const unique = new Set(input.devices.map(device => device.deviceId));
    if (unique.size !== input.devices.length) throw new ExpectedOperationError("invalid_input", "Each device can appear only once in a matrix.");
    if (!matrix.ops) throw new ExpectedOperationError("unsupported_platform", "This server cannot prepare devices for a matrix run.");
    const first = input.devices[0]!;
    const { request, project } = await prepareRequest({ ...input, platform: first.platform, ...(input.apps[first.platform] ? { bundleId: input.apps[first.platform]! } : {}) });
    if (project.runtimeMode === "project") {
      const lanes = projectLaneTargets(project.targets, input.devices, input.targets);
      await devices.releaseOn(input.devices.map(device => device.deviceId)).catch(() => undefined);
      const projectExecutor = createLaneExecutor({
        ops: matrix.ops, projectMode: true, apps: Object.fromEntries(Object.entries(lanes).map(([platform, target]) => [platform, target.bundleId])),
        runTest: (lane, deviceId, signal, onProgress) => runTest(
          { ...request, configPath: project.configPath, target: lanes[lane.platform]!.name, projectLane: { target: lanes[lane.platform]!.name, device: deviceId } },
          { release: () => devices.releaseOn([lane.deviceId, deviceId]), onProgress, signal }),
      });
      const { run } = launchMatrix(input.relativePath, input.devices, input.limit, projectExecutor);
      return dataResult({ matrixId: run.matrixId, limit: run.limit, lanes: snapshotMatrix(run).lanes }, `Started ${run.lanes.length} lanes, up to ${run.limit} at once.`);
    }
    for (const platform of ["ios", "android"] as const) {
      if (input.devices.some(device => device.platform === platform) && !apps[platform])
        throw new ExpectedOperationError("app_unavailable", `This test has no ${platform} app yet. Ask the user to open the app on a ${platform} device, call mobile_testing_wait_for_app with platform "${platform}", pin the bundleId it returns with mobile_testing_set_target mode "add", then run again.`);
    }
    // Only the devices of this matrix lose the recorder; a recorder on another device keeps its session.
    await devices.releaseOn(input.devices.map(device => device.deviceId)).catch(() => undefined);
    const executor = createLaneExecutor({
      ops: matrix.ops, apps: input.apps,
      runTest: async (lane, deviceId, signal, onProgress) => {
        const result = await runTest(
          { ...request, bundledTarget: { platform: lane.platform, bundleId: input.apps[lane.platform]!, device: deviceId } },
          { release: () => devices.releaseOn([lane.deviceId, deviceId]), onProgress, signal });
        await attachFailure(lane, result, request.untilSource ?? "", { deviceId, platform: lane.platform, projectPath: input.projectPath, runtimeRoot: project.runtime.root, bundleId: input.apps[lane.platform]! });
        return result;
      },
    });
    const { run } = launchMatrix(input.relativePath, input.devices, input.limit, executor);
    return dataResult({ matrixId: run.matrixId, limit: run.limit, lanes: snapshotMatrix(run).lanes }, `Started ${run.lanes.length} lanes, up to ${run.limit} at once.`);
  }));

  registerAppTool(server, "mobile_testing_run_progress", {
    title: "Read a run's progress",
    description:
      "Read the lanes of a matrix run: each device's state (queued, booting, installing, running, passed, failed, cancelled, error), the steps it has started and finished so far, and its result. Without a matrixId it reads the latest run, whose first lane's steps are also returned as `progress`. Each step carries its index within its test, which is its position among the file's awaited calls. A lane that failed carries `failure`: the failing line, its source and error, and the device's screen as locator rows (`role \"name\" → screen.getBy…`) to pick a replacement from. `running` is false once every lane has finished.",
    inputSchema: { matrixId: z.string().min(1).max(128).optional() },
    annotations: read,
    _meta: sharedVisibility,
  }, safe(async ({ matrixId }: { matrixId?: string }) => {
    if (panel) await resolveProject();
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
    _meta: sharedVisibility,
  }, safe(async ({ matrixId, deviceId }: { matrixId: string; deviceId?: string }) => {
    if (panel) await resolveProject();
    if (!registry.get(matrixId)) throw new ExpectedOperationError("invalid_input", "That run is no longer available.");
    const cancelled = registry.cancel(matrixId, deviceId);
    return dataResult({ cancelled: cancelled.map(lane => lane.deviceId) }, `Cancelled ${cancelled.length} lane${cancelled.length === 1 ? "" : "s"}.`);
  }));

  registerAppTool(server, "mobile_testing_wait_for_app", {
    title: "Wait for the user to open an app",
    description:
      "Wait until a booted device of one platform has an app in the foreground, and return that device and the app's bundleId; use it after asking the user to open the app on that platform, then pin the id with mobile_testing_set_target mode \"add\". Returns found: false with a message to relay to the user if nothing appears within timeoutMs (default 2 minutes). The home screen and launchers do not count.",
    inputSchema: {
      platform: z.enum(["ios", "android"]),
      timeoutMs: z.number().int().min(100).max(10 * 60_000).optional().describe("How long to wait. Default 120000."),
    },
    annotations: read,
    _meta: sharedVisibility,
  }, safe(async ({ platform, timeoutMs }: { platform: "ios" | "android"; timeoutMs?: number }) => {
    if (panel) await resolveProject();
    const ops = matrix.ops;
    if (!ops?.bootedDevices || !ops.foregroundApp) throw new ExpectedOperationError("unsupported_platform", "This server cannot read what is on a device's screen.");
    const deadline = Date.now() + (timeoutMs ?? 120_000);
    let seen = 0;
    for (;;) {
      const booted = await ops.bootedDevices(platform).catch(() => []);
      seen = booted.length;
      for (const device of booted) {
        const bundleId = await ops.foregroundApp(platform, device.deviceId).catch(() => null);
        if (bundleId && !LAUNCHER_APP.test(bundleId)) return dataResult({ found: true, platform, deviceId: device.deviceId, deviceName: device.name, bundleId }, `${bundleId} is open on ${device.name}.`);
      }
      if (Date.now() >= deadline) break;
      await new Promise(resolve => setTimeout(resolve, Math.min(matrix.pollMs ?? 1_500, Math.max(0, deadline - Date.now()))));
    }
    const label = platform === "ios" ? "iOS simulator" : "Android emulator";
    const message = seen === 0
      ? `No ${label} is booted. Ask the user to boot one and open the app on it.`
      : `Nothing is open on the ${label}. Ask the user to open the app on it, then try again.`;
    return dataResult({ found: false, timedOut: true, platform, message }, message);
  }));

  registerAppTool(server, "mobile_testing_branch_line", {
    title: "Give one line its own locator for one platform",
    description:
      "Repair a Testing Studio test for one platform: replace the locator on one line with `locator` on `platform` only, keeping the old locator for the other platform (`platform === \"android\" ? new : old`). The assertion or action on the line is never changed, and only the locator is. Take `locator` from a failed run's `failure.elements`, e.g. screen.getByText(\"Home\"). Writes the test and returns the new source; refuses, naming why, when the line cannot be rewritten with certainty (a multi-line call, no locator on the line). projectPath defaults to the Testing Studio tab's project.",
    inputSchema: {
      projectPath: projectPath.optional(),
      relativePath: z.string().min(1).max(512).describe("The Testing Studio test, e.g. tests/checkout.e2e.ts."),
      line: z.number().int().min(1).max(100_000).describe("The 1-based line of the failing step, from the run's failure.line."),
      platform: z.enum(["ios", "android"]).describe("The platform whose run failed. The other platform keeps its locator."),
      locator: z.string().min(1).max(1000).describe("A single screen.getBy… locator expression."),
    },
    annotations: destructive,
    _meta: sharedVisibility,
  }, safe(async ({ projectPath: selected, relativePath, line, platform, locator }: { projectPath?: string; relativePath: string; line: number; platform: "ios" | "android"; locator: string }) => {
    const project = await resolveProject(selected);
    if ((await inspectProject(project)).runtimeMode !== "bundled") throw new ExpectedOperationError("invalid_input", "Branching a line is for Testing Studio tests; edit a project test in its own file.");
    if (!singleExpression(locator) || !locator.startsWith("screen.")) throw new ExpectedOperationError("invalid_input", "locator must be one screen.getBy… expression on a single line.");
    const source = await readTestFile(project, relativePath);
    const next = branchStoredStepLocator(source, line, platform, locator);
    if (next === source) throw new ExpectedOperationError("invalid_input", `Line ${line} of ${relativePath} cannot be rewritten: it is not a single-line step with a locator. Read the test with mobile_testing_read_file and check the line.`);
    await writeTestFile(project, relativePath, next, true);
    return dataResult({ relativePath, line, platform, source: next }, `Line ${line} of ${relativePath} now uses ${locator} on ${platform}.`);
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
