import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import { errorMessage } from "../shared/protocol.ts";
import { captureServerError } from "./telemetry.ts";
import type { AppFlowDecisionRequest, DecisionPollResult } from "./app-flow-host.ts";
import { AppFlowHost } from "./app-flow-host.ts";
import type { AppFlowProjectChoices } from "./app-flow-projects.ts";

const read = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const write = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
const appVisibility = { ui: { visibility: ["app"] as ("app" | "model")[] } };
const modelVisibility = { ui: { visibility: ["model"] as ("app" | "model")[] } };
const sharedVisibility = { ui: { visibility: ["app", "model"] as ("app" | "model")[] } };

const projectPath = z.string().min(1).max(4096);
const runId = z.string().uuid();
const projectId = z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/);
const screenshotId = z.string().min(1).max(512).regex(/^[a-zA-Z0-9_.~-]+$/);

function safe<T>(handler: (input: T) => Promise<CallToolResult>) {
  return async (input: T): Promise<CallToolResult> => {
    try {
      return await handler(input);
    } catch (error) {
      captureServerError(error, "app_flow.tool");
      return { isError: true, content: [{ type: "text", text: errorMessage(error) }] };
    }
  };
}

function dataResult(data: unknown, message?: string): CallToolResult {
  const structuredContent = data && typeof data === "object" && !Array.isArray(data)
    ? data as Record<string, unknown>
    : { result: data };
  return {
    content: [{ type: "text", text: message ?? JSON.stringify(structuredContent) }],
    structuredContent,
  };
}

function decisionResult(polled: DecisionPollResult | object): CallToolResult {
  const request = "request" in polled ? polled.request as AppFlowDecisionRequest | undefined : undefined;
  if (!request) return dataResult(polled);
  const metadata = {
    runId: request.runId,
    requestId: request.requestId,
    role: request.role,
    feature: request.feature,
    capabilities: request.capabilities,
    projectPath: request.projectPath,
    systemPrompt: request.systemPrompt,
    userPrompt: request.userPrompt,
    expectedResponse: request.expectedResponse,
    history: request.history,
    createdAt: request.createdAt,
  };
  return {
    content: [
      {
        type: "text",
        text:
          `App Flow decision request:\n${JSON.stringify(metadata)}\n` +
          "Use only the listed capabilities. Answer from the role instructions, history, and image, then call mobile_appflow_submit_decision with one strict JSON object. The submit result may contain the next request.",
      },
      ...(request.screenshot ? [{ type: "image" as const, ...request.screenshot }] : []),
    ],
  };
}

function lookup(input: { runId?: string; projectPath?: string }): { runId?: string; projectPath?: string } {
  if (Boolean(input.runId) === Boolean(input.projectPath)) {
    throw new Error("Pass exactly one of runId or projectPath.");
  }
  return input;
}

const lookupSchema = { runId: runId.optional(), projectPath: projectPath.optional(), since: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional() };
const resolution = z.enum(["stop", "override", "continue"]);
const locator = z.object({
  ref: z.string(),
  role: z.string().optional(),
  type: z.string().optional(),
  label: z.string().optional(),
  value: z.string().optional(),
  identifier: z.string().optional(),
  rect: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }).optional(),
});
const manualAction = z.discriminatedUnion("type", [
  z.object({ type: z.literal("tap"), target: locator }),
  z.object({ type: z.literal("fill"), target: locator, value: z.string() }),
  z.object({ type: z.literal("scroll"), direction: z.enum(["up", "down", "left", "right"]) }),
]);

/** Registers the App Flow engine, manual recorder, decision broker, and screenshot bridge. */
export function registerAppFlowTools(server: McpServer, host: AppFlowHost, projects: AppFlowProjectChoices): () => Promise<void> {
  registerAppTool(server, "mobile_appflow_start", {
    title: "Start App Flow",
    description:
      "Start a non-blocking App Flow build. For screen-ui-and-structure mode, immediately service mobile_appflow_next_decision and mobile_appflow_submit_decision until completion, suspension, cancellation, or a human-action gate.",
    inputSchema: {
      projectPath,
      mode: z.enum(["structure-only", "screen-ui-and-structure"]).default("structure-only"),
      screenLimit: z.number().int().min(1).max(1000).optional(),
      explorationMode: z.enum(["auto", "fast", "thorough"]).optional(),
      deepLinkJudgeMode: z.enum(["on", "off"]).optional(),
    },
    annotations: write,
    _meta: sharedVisibility,
  }, safe(async (input: Record<string, unknown>) => {
    const started = await host.start(input);
    return dataResult(started, started.instructions ?? `Started App Flow run ${started.runId}.`);
  }));

  registerAppTool(server, "mobile_appflow_status", {
    title: "Read App Flow status",
    description: "Read an active run by runId or reopen persisted App Flow status by projectPath.",
    inputSchema: lookupSchema,
    annotations: read,
    _meta: sharedVisibility,
  }, safe(async (input: { runId?: string; projectPath?: string }) =>
    dataResult(await host.services.status(lookup(input)))));

  registerAppTool(server, "mobile_appflow_result", {
    title: "Read App Flow result",
    description: "Read the current or persisted App Flow graph by runId or projectPath.",
    inputSchema: lookupSchema,
    annotations: read,
    _meta: sharedVisibility,
  }, safe(async (input: { runId?: string; projectPath?: string }) =>
    dataResult(await host.services.result(lookup(input)))));

  registerAppTool(server, "mobile_appflow_pause", {
    title: "Pause App Flow",
    description: "Pause an active App Flow run at its next safe boundary.",
    inputSchema: { runId }, annotations: write, _meta: appVisibility,
  }, safe(async ({ runId }: { runId: string }) => dataResult(await host.services.pause(runId))));

  registerAppTool(server, "mobile_appflow_cancel", {
    title: "Cancel App Flow",
    description: "Cancel an active App Flow run and reject any parked agent decision.",
    inputSchema: { runId }, annotations: write, _meta: sharedVisibility,
  }, safe(async ({ runId }: { runId: string }) => dataResult(await host.cancel(runId))));

  registerAppTool(server, "mobile_appflow_launch_app", {
    title: "Launch app for App Flow",
    description: "Boot the App Flow device and launch the selected project without starting a sweep.",
    inputSchema: { projectPath }, annotations: write, _meta: appVisibility,
  }, safe(async ({ projectPath }: { projectPath: string }) => dataResult(await host.services.launchApp(projectPath))));

  registerAppTool(server, "mobile_appflow_explore_ui", {
    title: "Explore UI states",
    description:
      "Open and photograph the UI states (modals, sheets, dialogs) of the screen the already-launched app is on, by calling the app's own setters and controllers. Non-blocking: poll mobile_appflow_status and mobile_appflow_events, and stop it with mobile_appflow_cancel. The app must already be launched; nothing is tapped and no screen is navigated to.",
    inputSchema: {
      projectPath,
      limit: z.number().int().positive().max(1000).optional(),
    },
    annotations: write,
    _meta: sharedVisibility,
  }, safe(async ({ projectPath: selectedProjectPath, limit }: { projectPath: string; limit?: number }) => {
    const started = await host.exploreUi(selectedProjectPath, limit === undefined ? {} : { limit });
    return dataResult(started, `Started UI explore ${started.runId}.`);
  }));

  registerAppTool(server, "mobile_appflow_resolve_prompt", {
    title: "Resolve App Flow prompt",
    description:
      "Resolve a human-action gate after the user has reviewed or logged into the app. The agent must not claim a human action happened or resolve an authentication gate autonomously.",
    inputSchema: { runId, resolution, promptId: z.string().optional(), projectPath: projectPath.optional() },
    annotations: write,
    _meta: appVisibility,
  }, safe(async ({ runId, resolution, promptId, projectPath }: { runId: string; resolution: "stop" | "override" | "continue"; promptId?: string; projectPath?: string }) =>
    dataResult(await host.services.resolvePrompt(runId, resolution, promptId, projectPath))));

  registerAppTool(server, "mobile_appflow_projects", {
    title: "List App Flow projects",
    description: "List the React Native project folders App Flow can open, most recent first.",
    inputSchema: {},
    annotations: read,
    _meta: appVisibility,
  }, safe(async () => dataResult({ projects: await projects.list() })));

  registerAppTool(server, "mobile_appflow_choose_project", {
    title: "Choose an App Flow project",
    description:
      "Choose an App Flow project: pass projectPath to select one the panel already lists, or nothing to open the system folder picker. The choice persists across sessions.",
    inputSchema: { projectPath: projectPath.optional() },
    annotations: write,
    _meta: appVisibility,
  }, safe(async ({ projectPath: selected }: { projectPath?: string }) => {
    const project = selected === undefined ? await projects.choose() : await projects.record(selected);
    return dataResult(project ? { project } : {}, project ? undefined : "No project was chosen.");
  }));

  registerAppTool(server, "mobile_appflow_manual_start", {
    title: "Start recording an App Flow path",
    description: "Start a manual path recording for one saved App Flow screen.",
    inputSchema: { projectPath, nodeId: z.string().min(1).max(256) }, annotations: write, _meta: appVisibility,
  }, safe(async ({ projectPath, nodeId }: { projectPath: string; nodeId: string }) =>
    dataResult(await host.services.manualStart(projectPath, nodeId))));

  registerAppTool(server, "mobile_appflow_manual_act", {
    title: "Record an App Flow interaction",
    description: "Perform and record one tap, fill, or scroll in the active manual recording.",
    inputSchema: { projectPath, action: manualAction }, annotations: write, _meta: appVisibility,
  }, safe(async ({ projectPath, action }: { projectPath: string; action: z.infer<typeof manualAction> }) =>
    dataResult(await host.services.manualAct(projectPath, action))));

  registerAppTool(server, "mobile_appflow_manual_stop", {
    title: "Save an App Flow path",
    description: "Stop and save the active manual path recording.",
    inputSchema: { projectPath }, annotations: write, _meta: appVisibility,
  }, safe(async ({ projectPath }: { projectPath: string }) => dataResult(await host.services.manualStop(projectPath))));

  registerAppTool(server, "mobile_appflow_manual_cancel", {
    title: "Cancel App Flow path recording",
    description: "Cancel the active manual path recording without saving it.",
    inputSchema: { projectPath }, annotations: write, _meta: appVisibility,
  }, safe(async ({ projectPath }: { projectPath: string }) => dataResult(await host.services.manualCancel(projectPath))));

  registerAppTool(server, "mobile_appflow_manual_replay", {
    title: "Replay an App Flow path",
    description: "Replay a saved path and leave the app on its destination screen.",
    inputSchema: { projectPath, nodeId: z.string().min(1).max(256) }, annotations: write, _meta: appVisibility,
  }, safe(async ({ projectPath, nodeId }: { projectPath: string; nodeId: string }) => {
    if (!host.services.manualReplay) throw new Error("Manual replay is not available.");
    return dataResult(await host.services.manualReplay(projectPath, nodeId));
  }));

  registerAppTool(server, "mobile_appflow_events", {
    title: "Poll App Flow events",
    description:
      "Read buffered App Flow progress or manual-recording events newer than a sequence cursor. App Flow panels poll this because hosts may not forward server logging notifications.",
    inputSchema: lookupSchema,
    annotations: read,
    _meta: appVisibility,
  }, safe(async (input: { runId?: string; projectPath?: string; since?: number }) =>
    dataResult(await host.services.poll(lookup(input), input.since ?? 0))));

  registerAppTool(server, "mobile_appflow_next_decision", {
    title: "Get next App Flow decision",
    description:
      "Long-poll for the next agent decision. A waiting result means local work is still progressing; poll again until a request, terminal state, suspension, or needs-user-action is returned.",
    inputSchema: { runId, waitMs: z.number().int().min(0).max(20_000).default(15_000) },
    annotations: read,
    _meta: modelVisibility,
  }, safe(async ({ runId, waitMs }: { runId: string; waitMs: number }) =>
    decisionResult(await host.nextDecision(runId, waitMs))));

  registerAppTool(server, "mobile_appflow_submit_decision", {
    title: "Submit App Flow decision",
    description:
      "Submit one strict JSON response for the pending decision. Exact duplicate submissions are idempotent; stale IDs and conflicting duplicates are rejected. Waits briefly for and may return the next request.",
    inputSchema: { runId, requestId: z.string().uuid(), response: z.string().min(2).max(128_000) },
    annotations: write,
    _meta: modelVisibility,
  }, safe(async ({ runId, requestId, response }: { runId: string; requestId: string; response: string }) =>
    decisionResult(await host.submitDecision(runId, requestId, response))));

  registerAppTool(server, "mobile_appflow_screenshot", {
    title: "Read App Flow screenshot",
    description: "Read one authorized App Flow screenshot as inline PNG content.",
    inputSchema: { projectId, path: screenshotId },
    annotations: read,
    _meta: appVisibility,
  }, safe(async ({ projectId, path }: { projectId: string; path: string }) => ({
    content: [{
      type: "image",
      mimeType: "image/png",
      data: (await host.services.screenshot(projectId, path)).toString("base64"),
    }],
  })));

  server.registerResource(
    "app-flow-image",
    new ResourceTemplate("appflow-image://mobile-dev/{projectId}/{screenshotId}", { list: undefined }),
    { mimeType: "image/png", description: "Read a screenshot produced by an App Flow run." },
    async (uri, variables) => {
      const id = projectId.parse(variables.projectId);
      const image = screenshotId.parse(variables.screenshotId);
      return {
        contents: [{
          uri: uri.href,
          mimeType: "image/png",
          blob: (await host.services.screenshot(id, image)).toString("base64"),
        }],
      };
    },
  );

  const unsubscribe = host.services.subscribe?.(({ runId, seq, event }) => {
    void server.sendLoggingMessage({
      level: "info",
      logger: "app-flow",
      data: { source: "app-flow", ...(runId ? { runId } : {}), ...(seq !== undefined ? { seq } : {}), event },
    }).catch(() => undefined);
  });

  return async () => {
    unsubscribe?.();
    await host.close();
  };
}
