
!function(){try{var e="undefined"!=typeof window?window:"undefined"!=typeof global?global:"undefined"!=typeof globalThis?globalThis:"undefined"!=typeof self?self:{},n=(new e.Error).stack;n&&(e._sentryDebugIds=e._sentryDebugIds||{},e._sentryDebugIds[n]="47b6837c-9078-5003-8e8a-496c21d1c778")}catch(e){}}();
import { createRequire as mobileDevBundleRequire } from 'node:module'; import { fileURLToPath as mobileDevFileURLToPath } from 'node:url'; import { dirname as mobileDevPathDirname } from 'node:path'; const require = mobileDevBundleRequire(import.meta.url); const __filename = mobileDevFileURLToPath(import.meta.url); const __dirname = mobileDevPathDirname(__filename);
import {
  ActiveTimeBudget,
  ParamStore,
  agentDeviceOpenCommand,
  bootDevice,
  capturePressables,
  captureScreenshot,
  closeDevice,
  configureAppFlowHost,
  contentMatchedSelectors,
  createAppRuntimeTransport,
  createRenderPortForTransport,
  defaultScreenInfo,
  endLiveSession,
  fillCommand,
  getAppFlowBuilders,
  getFlowsDir,
  getLaunchedApps,
  getProjectId,
  getScreenshotPath,
  isMetroReady,
  pressCommand,
  pressPointCommand,
  pressWithLocator,
  readAgentDeviceScreens,
  readAppConfig,
  readAppFlow,
  readParamStore,
  recordRuntimeCount,
  recordRuntimeTiming,
  registerProject,
  replayPathToReach,
  resolveNodeParams,
  runPathToReach,
  saveAndReplayRecording,
  scrollCommand,
  serializeLocator,
  startReplayRecording,
  uniqueScreenKey,
  waitForReplayableFrame,
  waitForRoute,
  writeAgentDeviceScreens,
  writeAppFlow
} from "./chunk-NBDADLJI.mjs";
import {
  errorMessage
} from "./chunk-OPAYWTKC.mjs";
import "./chunk-WX3WADUR.mjs";
import "./chunk-BNXJFHSV.mjs";
import "./chunk-WNUFIJT5.mjs";

// packages/core/src/app-flow/manual/context.ts
async function manualCaptureContext(projectPath, projectId) {
  const config = await readAppConfig(projectPath);
  return {
    projectPath,
    projectId,
    scheme: config.scheme,
    appName: config.name,
    bundleId: config.bundleId,
    slug: config.slug,
    platform: "ios",
    sessionName: `${projectId}-manual`
  };
}

// packages/core/src/app-flow/runtime-replay.ts
var SETTLE_BUDGET_MS = 15e3;
function finish(outcome, startedAt) {
  recordRuntimeCount("app_flow.runtime_replay", { outcome });
  recordRuntimeTiming("app_flow.runtime_replay.duration", Date.now() - startedAt, { outcome });
}
async function runtimeReplay(projectId, nodeId, deps) {
  const startedAt = Date.now();
  const read = deps.read ?? (async () => ({
    flow: await readAppFlow(projectId),
    paramStore: await readParamStore(projectId)
  }));
  const { flow, paramStore: storedParams } = await read();
  if (!flow) {
    finish("no-map", startedAt);
    return { ok: false, error: "This project has no App Flow map yet \u2014 run a sweep first." };
  }
  const node = flow.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) {
    finish("no-node", startedAt);
    return {
      ok: false,
      error: `${nodeId} is not in this project\u2019s map any more \u2014 rebuild the map and try again.`
    };
  }
  const paramStore = ParamStore.fromJSON(storedParams);
  const resolution = resolveNodeParams(node, flow.edges, paramStore);
  if (resolution.unresolved.length) {
    finish("unresolved-params", startedAt);
    const named = resolution.unresolved.map((key) => `:${key}`).join(", ");
    return {
      ok: false,
      error: `This route needs ${named}, and no value for ${resolution.unresolved.length > 1 ? "them has" : "it has"} been observed yet. Reach the screen once \u2014 a sweep, or a recorded path \u2014 and the value is remembered for next time.`
    };
  }
  const values = Object.fromEntries(
    node.params.filter((key) => resolution.values[key] !== void 0).map((key) => [key, resolution.values[key]])
  );
  const params = Object.keys(values).length ? values : null;
  const { ctx, device } = await deps.prepare();
  const metrics = {
    navigate(outcome) {
      recordRuntimeCount("app_flow.runtime.navigate", { outcome });
    },
    settle(durationMs, stop) {
      recordRuntimeTiming("app_flow.runtime.settle", durationMs, { stop });
    },
    verify(durationMs, path, verdict) {
      recordRuntimeTiming("app_flow.runtime.verify", durationMs, { path, verdict });
    }
  };
  const runtime = createAppRuntimeTransport({
    metroPort: device.metroPort,
    deviceId: device.deviceId,
    deviceName: device.deviceName,
    appName: ctx.appName,
    // Distinct from the sweep's `fast-<projectId>` so a replay started while a sweep holds its own
    // connection is a separate debugger session rather than a collision on one name.
    sessionId: `runtime-replay-${projectId}`,
    signal: ctx.signal,
    logLabel: "[app-flow:runtime-replay]"
  });
  try {
    await waitForReplayableFrame(ctx, device);
    const render = createRenderPortForTransport({
      transport: runtime.transport,
      expoRouter: flow.manifest.project.mode === "expo-router",
      metrics
    });
    const availability = await render.available();
    if (!availability.ok) {
      finish("unavailable", startedAt);
      return {
        ok: false,
        error: `The app\u2019s runtime could not be reached \u2014 ${availability.reason}`
      };
    }
    const dispatch = await render.navigate(node, params);
    if (!dispatch.ok) {
      finish("refused", startedAt);
      return { ok: false, error: dispatch.reason };
    }
    await render.awaitSettled(node, params, new ActiveTimeBudget(SETTLE_BUDGET_MS));
    console.log(`[app-flow:runtime-replay] ${node.id} \u2014 ${dispatch.reason}`);
    finish("ok", startedAt);
    return { ok: true, detail: dispatch.reason };
  } catch (error) {
    finish("failed", startedAt);
    console.error("[app-flow:runtime-replay] failed:", error);
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not replay this screen at runtime."
    };
  } finally {
    await runtime.close().catch(() => void 0);
  }
}

// packages/core/src/app-flow/manual/session.ts
import { EventEmitter } from "node:events";
import { rename, unlink } from "node:fs/promises";
import { join } from "node:path";

// packages/core/src/app-flow-deps/profiling/snapshot.ts
var CONTAINERS = /* @__PURE__ */ new Set(["application", "window", "scrollview", "scroll-view"]);
function semanticType(node) {
  return `${node.role ?? node.type ?? ""}`.toLowerCase().replace(/^xcuielementtype/, "");
}
function slimSnapshotNodes(nodes) {
  return nodes.flatMap((node) => {
    if (node.visibleToUser === false || node.enabled === false || CONTAINERS.has(semanticType(node)) || !node.ref?.trim()) return [];
    const ref = node.ref.trim();
    return [{ ref: ref.startsWith("@") ? ref : `@${ref}`, ...node.role ? { role: node.role } : {}, ...node.type ? { type: node.type } : {}, ...node.label ? { label: node.label } : {}, ...node.value ? { value: node.value } : {}, ...node.identifier ? { identifier: node.identifier } : {}, ...node.rect ? { rect: node.rect } : {} }];
  });
}
function snapshotBounds(nodes) {
  let widest = null, union = null;
  for (const node of nodes) {
    const rect = node.rect;
    if (!rect || rect.width <= 0 || rect.height <= 0) continue;
    if (CONTAINERS.has(semanticType(node)) && (!widest || rect.width * rect.height > widest.width * widest.height)) widest = rect;
    if (!union) union = { ...rect };
    else {
      const right = Math.max(union.x + union.width, rect.x + rect.width), bottom = Math.max(union.y + union.height, rect.y + rect.height);
      union.x = Math.min(union.x, rect.x);
      union.y = Math.min(union.y, rect.y);
      union.width = right - union.x;
      union.height = bottom - union.y;
    }
  }
  return widest ?? union ?? { x: 0, y: 0, width: 0, height: 0 };
}
async function captureSnapshotFrame(device, options) {
  const snapshot = await device.client.capture.snapshot({ platform: options?.platform ?? "ios", responseLevel: "default", interactiveOnly: true, customActions: true, forceFull: true, ...options?.noRecord === false ? {} : { noRecord: true }, timeoutMs: options?.timeoutMs ?? 3e4 });
  if (!Array.isArray(snapshot.nodes)) throw new Error("agent-device snapshot did not return a nodes array");
  const raw = snapshot.nodes;
  return { nodes: slimSnapshotNodes(raw), bounds: snapshotBounds(raw) };
}

// packages/core/src/app-flow/manual/commands.ts
function isPortable(locator) {
  return locator !== null && locator.by !== "text";
}

// packages/core/src/app-flow/manual/locators.ts
function locatorFor(node) {
  const identifier = node.identifier?.trim();
  if (identifier) return { by: "id", value: identifier };
  const label = node.label?.trim();
  if (label) return { by: "label", value: label };
  const value = node.value?.trim();
  if (value) return { by: "text", value };
  return null;
}
function destinationLocator(nodes) {
  for (const node of nodes) {
    const identifier = node.identifier?.trim();
    if (identifier) return { by: "id", value: identifier };
  }
  for (const node of nodes) {
    const label = node.label?.trim();
    if (label) return { by: "label", value: label };
  }
  return null;
}
function rectCenter(rect) {
  return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
}

// packages/core/src/app-flow/manual/session.ts
var SNAPSHOT_REST_MS = 1e3;
function log(step, detail) {
  console.log(detail ? `[app-flow:manual] ${step} \u2014 ${detail}` : `[app-flow:manual] ${step}`);
}
var ManualSession = class extends EventEmitter {
  projectPath;
  projectId;
  nodeId;
  prepared;
  release;
  deviceSource = "booted";
  device = null;
  ctx = null;
  node = null;
  candidatePath = "";
  publishedPath = "";
  /** The literal `agent-device …` lines, in order, used when the recording cannot be published. */
  literalCommands = [];
  latestSnapshot = [];
  revision = 0;
  pollTimer = null;
  /**
   * Serializes the poll against user actions. A snapshot taken while a press is mid-flight reports
   * a half-transitioned screen, and two overlapping snapshots race the same agent-device session.
   */
  busy = false;
  finished = false;
  constructor(projectPath, projectId, nodeId, options = {}) {
    super();
    this.projectPath = projectPath;
    this.projectId = projectId;
    this.nodeId = nodeId;
    this.prepared = options.prepared ?? null;
    this.release = options.release ?? ((device) => closeDevice(device));
  }
  /** Which device this session is running on — read by the service for its own bookkeeping. */
  get source() {
    return this.deviceSource;
  }
  emitEvent(event) {
    try {
      this.emit("event", event);
    } catch (error) {
      console.error("Manual recording event listener error:", error);
    }
  }
  status(status, message) {
    this.emitEvent({
      type: "status",
      projectId: this.projectId,
      nodeId: this.nodeId,
      status,
      ...message ? { message } : {}
    });
  }
  async start() {
    this.status("starting", "Resolving screen");
    const result = await readAppFlow(this.projectId);
    const node = result?.nodes.find((candidate) => candidate.id === this.nodeId) ?? null;
    if (!node) throw new Error("Screen is not in this project\u2019s app flow. Generate the flow first.");
    if (node.origin === "chrome") {
      throw new Error("A navigator surface is not a screen \u2014 there is nothing to record a path to.");
    }
    this.node = node;
    const startedAt = Date.now();
    this.ctx = this.prepared?.ctx ?? await manualCaptureContext(this.projectPath, this.projectId);
    await registerProject(this.projectPath);
    this.candidatePath = join(getFlowsDir(this.projectId), `.${node.slug}.manual.candidate.ad`);
    this.publishedPath = join(getFlowsDir(this.projectId), `${node.slug}.ad`);
    if (this.prepared) {
      this.deviceSource = this.prepared.source;
      this.device = this.prepared.device;
      log("start", `reusing the ${this.prepared.source} device \u2014 no build, boot or Metro start`);
      this.status(
        "starting",
        this.prepared.source === "launched" ? "Reusing the app you launched" : "Reusing the running app"
      );
    } else {
      this.deviceSource = "booted";
      this.status("starting", "Booting simulator");
      this.device = await bootDevice(this.ctx);
    }
    if (await this.abandonIfFinished()) return;
    this.status("starting", "Launching app");
    await startReplayRecording(this.ctx, this.device, this.candidatePath, this.device.launchUrl);
    if (await this.abandonIfFinished()) return;
    this.status("recording");
    recordRuntimeTiming("app_flow.manual.start", Date.now() - startedAt, {
      device: this.deviceSource
    });
    await this.tick();
    this.schedulePoll();
  }
  /**
   * Releases a device `start` acquired after the session was already discarded, and says whether
   * it did.
   *
   * `cancel` and `failed` can both run while `start` is still booting, and `teardown` is a no-op
   * when `this.device` is null — which it is for the whole expensive half of a start. So the
   * checkpoints in `start` call this after every step that can leave something behind, and it
   * performs the half of the discard that was skipped: end the live `--saveScript` transaction,
   * drop the candidate script, hand the device to the service's `release`.
   *
   * It releases through the same `teardown('done')` an ordinary discard uses, so a device booted
   * for a recording nobody wants is parked for the next session rather than thrown away — the
   * boot has been paid for either way, and `releaseDevices` closes it before any sweep.
   */
  async abandonIfFinished() {
    if (!this.finished) return false;
    log("start", "discarded while starting \u2014 releasing the device it had already acquired");
    if (this.device) await endLiveSession(this.device).catch(() => void 0);
    await unlink(this.candidatePath).catch(() => void 0);
    await this.teardown("done");
    return true;
  }
  /**
   * Waits out an in-flight snapshot poll before taking the session.
   *
   * Bounded rather than an open loop: a snapshot has its own 15s timeout, so anything past that is
   * a wedged call, and the user's tap is worth more than the stale tick blocking it.
   */
  async waitForIdle(timeoutMs = 2e4) {
    const deadline = Date.now() + timeoutMs;
    while (this.busy && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  /** One wireframe refresh. Silently skipped while another device call holds the session. */
  async tick() {
    if (this.busy || this.finished || !this.device || !this.ctx) return;
    this.busy = true;
    try {
      const frame = await captureSnapshotFrame(this.device, {
        platform: this.ctx.platform,
        timeoutMs: 15e3
      });
      this.latestSnapshot = frame.nodes;
      this.revision += 1;
      this.emitEvent({
        type: "snapshot",
        projectId: this.projectId,
        nodeId: this.nodeId,
        revision: this.revision,
        nodes: this.latestSnapshot,
        bounds: frame.bounds
      });
    } catch (error) {
      log("snapshot tick failed", errorMessage(error));
    } finally {
      this.busy = false;
    }
  }
  async act(action) {
    if (this.finished) throw new Error("This recording has already finished.");
    const device = this.device;
    const ctx = this.ctx;
    if (!device || !ctx) throw new Error("Recording is still starting up.");
    await this.waitForIdle();
    this.busy = true;
    this.status("acting");
    const startedAt = Date.now();
    try {
      const step = await this.perform(ctx, device, action);
      this.literalCommands.push(step.command);
      this.emitEvent({
        type: "step",
        projectId: this.projectId,
        nodeId: this.nodeId,
        command: step.command,
        portable: step.portable
      });
      await waitForRoute();
      this.status("recording");
      recordRuntimeTiming("app_flow.manual.act", Date.now() - startedAt, {
        action: action.type,
        outcome: "ok"
      });
    } catch (error) {
      recordRuntimeTiming("app_flow.manual.act", Date.now() - startedAt, {
        action: action.type,
        outcome: "failed"
      });
      this.status("recording");
      throw error;
    } finally {
      this.busy = false;
      await this.tick();
      this.schedulePoll();
    }
  }
  async perform(ctx, device, action) {
    if (action.type === "scroll") {
      await device.client.interactions.scroll({
        platform: ctx.platform,
        direction: action.direction
      });
      return { command: scrollCommand(action.direction), portable: true };
    }
    const locator = locatorFor(action.target);
    if (!locator) {
      const rect = action.target.rect;
      if (!rect) throw new Error("That element has neither a selector nor a position to press.");
      const point = rectCenter(rect);
      if (action.type === "fill") {
        throw new Error("That field has no id or label to type into reliably.");
      }
      await device.client.interactions.press({
        platform: ctx.platform,
        x: point.x,
        y: point.y,
        settle: true,
        timeoutMs: 1e4
      });
      return { command: pressPointCommand(point.x, point.y), portable: false };
    }
    const selector = serializeLocator(locator);
    if (action.type === "fill") {
      await device.client.interactions.fill({
        platform: ctx.platform,
        selector,
        text: action.value,
        settle: true,
        timeoutMs: 1e4
      });
      return {
        command: fillCommand(selector, action.value),
        portable: isPortable(locator)
      };
    }
    await pressWithLocator(ctx, device, locator);
    return { command: pressCommand(selector), portable: isPortable(locator) };
  }
  /**
   * Ends the walk and writes the artifacts.
   *
   * Tries hardest first: wait on a durable landmark, publish the recording, verify it by replaying
   * it, and hand back a `pathToReach` that is one `agent-device replay`. Everything that can go
   * wrong there falls back to the literal command list rather than failing the session — the user
   * has already done the work, and a weaker path is worth far more than none.
   */
  async stop() {
    if (this.finished) return;
    const device = this.device;
    const ctx = this.ctx;
    const node = this.node;
    if (!device || !ctx || !node) throw new Error("Recording is still starting up.");
    await this.waitForIdle();
    this.finished = true;
    this.stopPolling();
    this.status("saving");
    const pressables = await this.collectPressables(ctx, device);
    const screenshot = await this.collectScreenshot(ctx, device, node);
    let pathToReach = [];
    let replayScript = null;
    let replayVerified = false;
    let fallbackReason;
    const destination = destinationLocator(this.latestSnapshot);
    if (!destination) {
      fallbackReason = "This screen has no element with an id or accessibility label, so agent-device cannot guard a saved recording here.";
    } else {
      try {
        await saveAndReplayRecording(ctx, device, this.candidatePath, serializeLocator(destination));
        await rename(this.candidatePath, this.publishedPath);
        replayScript = this.publishedPath;
        replayVerified = true;
        pathToReach = replayPathToReach(device, this.publishedPath);
      } catch (error) {
        fallbackReason = `The recording could not be published or verified: ${errorMessage(error)}`;
        await unlink(this.candidatePath).catch(() => void 0);
      }
    }
    if (!replayVerified) {
      await unlink(this.candidatePath).catch(() => void 0);
      pathToReach = [
        ...device.setupCommands,
        // `device.launchTarget` verbatim, exactly as `resolveDeepLink` passes it — the launch
        // target is already the resolved bundle id by the time `bootDevice` returns.
        agentDeviceOpenCommand(device.launchTarget, device.launchUrl ?? null),
        ...this.literalCommands
      ];
    }
    await this.persist(node, { pathToReach, replayScript, replayVerified, pressables, screenshot });
    this.emitEvent({
      type: "complete",
      projectId: this.projectId,
      nodeId: this.nodeId,
      pathToReach,
      replayVerified,
      ...fallbackReason ? { fallbackReason } : {}
    });
    recordRuntimeCount("app_flow.manual.stop", {
      outcome: replayVerified ? "verified" : "fallback",
      device: this.deviceSource
    });
    await this.teardown("done");
  }
  async collectPressables(ctx, device) {
    try {
      return await capturePressables(ctx, device);
    } catch (error) {
      log("pressables failed", errorMessage(error));
      return [];
    }
  }
  async collectScreenshot(ctx, device, node) {
    const path = getScreenshotPath(this.projectId, node.slug);
    try {
      await captureScreenshot(ctx, device, path);
      return join("screens", `${node.slug}.png`);
    } catch (error) {
      log("screenshot failed", errorMessage(error));
      return null;
    }
  }
  /**
   * Merges this one screen into both documents. Never rewrites either wholesale: every other
   * screen's entry and every other node's capture is read back and preserved, because a manual
   * recording is a single-screen edit to files a whole sweep also owns.
   */
  async persist(node, outcome) {
    const contentSelectors = contentMatchedSelectors(outcome.pathToReach);
    const result = await readAppFlow(this.projectId);
    if (result) {
      const target = result.nodes.find((candidate) => candidate.id === node.id);
      if (target) {
        target.capture = {
          status: "ok",
          needsNavigation: false,
          note: "Recorded manually",
          screenshot: outcome.screenshot,
          pressables: outcome.pressables,
          captureMethod: "manual",
          replayScript: outcome.replayScript,
          replayVerified: outcome.replayVerified,
          // True on both branches above, and the one case where it is *more* than `replayVerified`
          // claims: a recording that could not be published still produced a literal command list
          // of steps the user themselves performed on the device. `pathVerified` asks whether
          // anything travelled this path, not whether a script round-tripped, so the fallback
          // qualifies exactly as the published script does — and either way this is nothing like
          // the chrome-inferred guess the flag exists to mark (`AppFlowCapture.pathVerified`).
          pathVerified: outcome.pathToReach.length > 0,
          ...contentSelectors.length ? { pathContentSelectors: contentSelectors } : {},
          // Always true in practice — a manual recording's path opens with the app launch — but
          // written from the path itself rather than asserted, so the node and the screens entry
          // below cannot disagree about whether there is something to replay.
          replayable: outcome.pathToReach.length > 0,
          ...result.manifest.structureRevision ? { structureRevision: result.manifest.structureRevision } : {}
        };
      }
      await writeAppFlow(this.projectId, result);
    }
    const screens = await readAgentDeviceScreens(this.projectId);
    const existingKey = Object.keys(screens).find((key2) => screens[key2].screenId === node.id);
    const used = new Set(Object.keys(screens).filter((key2) => key2 !== existingKey));
    const key = existingKey ?? uniqueScreenKey(node.title || node.id, used);
    screens[key] = {
      key,
      screenId: node.id,
      info: screens[existingKey ?? ""]?.info ?? defaultScreenInfo(node),
      pressables: outcome.pressables,
      pathToReach: outcome.pathToReach,
      pathVerified: outcome.pathToReach.length > 0,
      ...contentSelectors.length ? { pathContentSelectors: contentSelectors } : {},
      replayScript: outcome.replayScript,
      replayVerified: outcome.replayVerified
    };
    await writeAgentDeviceScreens(this.projectId, screens);
  }
  async cancel() {
    if (this.finished) return;
    await this.waitForIdle();
    this.finished = true;
    this.stopPolling();
    if (this.device) await endLiveSession(this.device);
    await unlink(this.candidatePath).catch(() => void 0);
    this.status("stopped", "Recording discarded");
    await this.teardown("done");
  }
  /**
   * Always runs, on every exit path. A leaked agent-device session keeps the iOS runner lease, and
   * the next sweep fails with "iOS runner is already owned by another agent-device daemon".
   *
   * What "release" means is the service's call, not this class's: a device the user launched is
   * handed back untouched, this session's own is parked for the next recording to reuse, and a
   * failed session's is closed. The default — used by tests and any caller that hands in nothing —
   * is still `closeDevice`, so nothing leaks by omission.
   */
  async teardown(reason = "done") {
    this.stopPolling();
    const device = this.device;
    const ctx = this.ctx;
    this.device = null;
    if (!device) return;
    try {
      await this.release(device, ctx, { source: this.deviceSource, reason });
    } catch (error) {
      console.error("Failed to release manual recording device:", error);
    }
  }
  /** Queues the next wireframe refresh, a rest after whatever the last one cost. */
  schedulePoll() {
    if (this.finished) return;
    this.stopPolling();
    this.pollTimer = setTimeout(() => {
      void this.tick().finally(() => this.schedulePoll());
    }, SNAPSHOT_REST_MS);
  }
  stopPolling() {
    if (!this.pollTimer) return;
    clearTimeout(this.pollTimer);
    this.pollTimer = null;
  }
  /** Reported to the renderer so a failed start still tears the device down. */
  async failed(error) {
    this.finished = true;
    this.stopPolling();
    if (this.device) await endLiveSession(this.device).catch(() => void 0);
    await unlink(this.candidatePath).catch(() => void 0);
    this.emitEvent({
      type: "error",
      projectId: this.projectId,
      nodeId: this.nodeId,
      message: errorMessage(error)
    });
    await this.teardown("failed");
  }
};

// packages/core/src/app-flow/manual/index.ts
var sessions = /* @__PURE__ */ new Map();
var starting = /* @__PURE__ */ new Map();
var warmDevices = /* @__PURE__ */ new Map();
var WARM_DEVICE_IDLE_MS = 10 * 60 * 1e3;
async function closeWarmDevice(projectId) {
  const parked = warmDevices.get(projectId);
  if (!parked) return;
  warmDevices.delete(projectId);
  clearTimeout(parked.timer);
  await closeDevice(parked.device).catch((error) => {
    console.error("[app-flow:manual] could not close the parked device:", error);
  });
}
function parkWarmDevice(projectId, device, ctx) {
  const timer = setTimeout(() => {
    console.log("[app-flow:manual] parked device idle \u2014 closing it");
    void closeWarmDevice(projectId);
  }, WARM_DEVICE_IDLE_MS);
  timer.unref?.();
  warmDevices.set(projectId, { device, ctx, timer });
}
async function metroAlive(device) {
  if (device.launchProcess && device.launchProcess.exitCode !== null) return false;
  return device.metroPort > 0 ? isMetroReady(device.metroPort) : false;
}
async function prepareDevice(projectId) {
  const launched = getLaunchedApps().get(projectId);
  if (launched) {
    if (await metroAlive(launched.device)) {
      await closeWarmDevice(projectId);
      return { device: launched.device, ctx: launched.ctx, source: "launched" };
    }
    console.log("[app-flow:manual] the launched app\u2019s dev server is gone \u2014 not adopting it");
  }
  const parked = warmDevices.get(projectId);
  if (!parked) return null;
  warmDevices.delete(projectId);
  clearTimeout(parked.timer);
  if (!await metroAlive(parked.device)) {
    console.log("[app-flow:manual] parked device\u2019s dev server is gone \u2014 closing it and booting fresh");
    await closeDevice(parked.device).catch(() => void 0);
    return null;
  }
  try {
    await parked.device.client.devices.boot({
      platform: "ios",
      target: "mobile",
      udid: parked.device.deviceId
    });
  } catch (error) {
    console.log(`[app-flow:manual] parked device did not answer (${String(error)}) \u2014 booting fresh`);
    await closeDevice(parked.device).catch(() => void 0);
    return null;
  }
  return { device: parked.device, ctx: parked.ctx, source: "warm" };
}
function createManualRecordingService(host) {
  configureAppFlowHost(host);
  return {
    isActive: (projectPath) => sessions.has(getProjectId(projectPath)),
    releaseDevices: (projectPath) => closeWarmDevice(getProjectId(projectPath)),
    start: async (projectPath, nodeId) => {
      const projectId = getProjectId(projectPath);
      if (getAppFlowBuilders().get(projectId)?.isRunning()) {
        return { ok: false, error: "An App Flow build is already running for this project." };
      }
      if (sessions.has(projectId)) {
        return { ok: false, error: "A recording is already in progress for this project." };
      }
      const prepared = await prepareDevice(projectId);
      const session = new ManualSession(projectPath, projectId, nodeId, {
        prepared,
        /**
         * A device the user launched goes back untouched — `launchApp` owns it, and closing it
         * here would pull the app out from under the panel's Launch state. One this module opened
         * is parked for the next recording unless the session failed, where its state is unknown
         * and closing is the only safe answer.
         */
        release: async (device, ctx, outcome) => {
          if (outcome.source === "launched") return;
          if (outcome.reason === "failed" || !ctx) {
            await closeDevice(device);
            return;
          }
          parkWarmDevice(projectId, device, ctx);
        }
      });
      sessions.set(projectId, session);
      session.on("event", (event) => {
        host.emit(event);
        if (event.type === "complete" || event.type === "error") sessions.delete(projectId);
      });
      console.log(`[app-flow:manual] start ${nodeId} for ${projectPath} (${projectId})`);
      const pending = session.start().catch((error) => {
        console.error("[app-flow:manual] start rejected:", error);
        sessions.delete(projectId);
        return session.failed(error);
      }).finally(() => {
        if (starting.get(projectId) === pending) starting.delete(projectId);
      });
      starting.set(projectId, pending);
      return { ok: true };
    },
    act: async (projectPath, action) => {
      const session = sessions.get(getProjectId(projectPath));
      if (!session) return { ok: false, error: "No recording in progress for this project." };
      try {
        await session.act(action);
        return { ok: true };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : "Interaction failed." };
      }
    },
    stop: async (projectPath) => {
      const projectId = getProjectId(projectPath);
      const session = sessions.get(projectId);
      if (!session) return { ok: false, error: "No recording in progress for this project." };
      try {
        await session.stop();
        return { ok: true };
      } catch (error) {
        console.error("[app-flow:manual] stop failed:", error);
        await session.failed(error);
        return {
          ok: false,
          error: error instanceof Error ? error.message : "Could not save the recording."
        };
      } finally {
        sessions.delete(projectId);
      }
    },
    cancel: async (projectPath) => {
      const projectId = getProjectId(projectPath);
      const session = sessions.get(projectId);
      if (!session) return { cancelled: false };
      try {
        await session.cancel().catch((error) => {
          console.error("[app-flow:manual] cancel failed:", error);
        });
        await starting.get(projectId)?.catch(() => void 0);
      } finally {
        sessions.delete(projectId);
      }
      return { cancelled: true };
    },
    /**
     * Walks a screen's stored `pathToReach` and leaves the app sitting on it.
     *
     * Awaited rather than fired like `start`: there is no panel to follow along on, the renderer
     * just wants to know whether it worked, and the one line of feedback it needs is the error when
     * it did not. The whole call is a couple of minutes on a cold device, which `ipcMain.handle`
     * carries fine.
     */
    replay: async (projectPath, nodeId) => {
      const projectId = getProjectId(projectPath);
      if (getAppFlowBuilders().get(projectId)?.isRunning()) {
        return { ok: false, error: "An App Flow build is already running for this project." };
      }
      if (sessions.has(projectId)) {
        return { ok: false, error: "A recording is in progress for this project." };
      }
      const screens = await readAgentDeviceScreens(projectId);
      const entry = Object.values(screens).find((screen) => screen.screenId === nodeId);
      if (!entry?.pathToReach.length) {
        return { ok: false, error: "This screen has no recorded path to replay yet." };
      }
      console.log(
        `[app-flow:manual] replay ${nodeId} for ${projectPath} (${projectId})` + // Said out loud before the device is booted, because this is the one place that knows
        // which path is about to run and a failure two minutes from now reads very differently
        // depending on the answer. `ModerationInbox`'s stored path was reconstructed from a
        // chrome reveal and was never travelled; `My-Profile`'s was walked. See
        // `AppFlowCapture.pathVerified`.
        (entry.pathVerified === false ? " \u2014 inferred path, never travelled" : "") + (entry.pathContentSelectors?.length ? ` \u2014 matches on rendered content: ${entry.pathContentSelectors.join(", ")}` : "")
      );
      const prepared = await prepareDevice(projectId);
      const ctx = prepared?.ctx ?? await manualCaptureContext(projectPath, projectId);
      const device = prepared?.device ?? await bootDevice(ctx);
      if (prepared?.source !== "launched") parkWarmDevice(projectId, device, ctx);
      try {
        await runPathToReach(ctx, device, entry.pathToReach);
        return { ok: true };
      } catch (error) {
        console.error("[app-flow:manual] replay failed:", error);
        return {
          ok: false,
          error: error instanceof Error ? error.message : "Could not replay this screen."
        };
      }
    },
    /**
     * Navigates to a screen through the app's own runtime, with no recording involved.
     *
     * Same guards and the same device ladder as `replay` above, for the same reasons — a sweep and
     * this would fight over one simulator, and a recording in progress owns the device outright.
     * Everything past the device is `runtime-replay.ts`; this is the part that has to live beside
     * the pool.
     */
    replayRuntime: async (projectPath, nodeId) => {
      const projectId = getProjectId(projectPath);
      if (getAppFlowBuilders().get(projectId)?.isRunning()) {
        return { ok: false, error: "An App Flow build is already running for this project." };
      }
      if (sessions.has(projectId)) {
        return { ok: false, error: "A recording is in progress for this project." };
      }
      console.log(`[app-flow:runtime-replay] ${nodeId} for ${projectPath} (${projectId})`);
      return await runtimeReplay(projectId, nodeId, {
        prepare: async () => {
          const prepared = await prepareDevice(projectId);
          const ctx = prepared?.ctx ?? await manualCaptureContext(projectPath, projectId);
          const device = prepared?.device ?? await bootDevice(ctx);
          if (prepared?.source !== "launched") parkWarmDevice(projectId, device, ctx);
          return { ctx, device };
        }
      });
    }
  };
}
export {
  createManualRecordingService
};

//# debugId=47b6837c-9078-5003-8e8a-496c21d1c778
