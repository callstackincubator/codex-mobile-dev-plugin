/**
 * The Testing Studio panel's view of a matrix run: what the server reports for each device, which devices
 * the user chose, and the small pure helpers the rows are drawn from. The server owns the run
 * (`packages/core/src/testing-matrix.ts`); this only reads it.
 */

export type MatrixPlatform = "ios" | "android";
export type LaneState = "queued" | "booting" | "installing" | "running" | "passed" | "failed" | "cancelled" | "error";

export const DEFAULT_MATRIX_LIMIT = 3;
export const MAX_MATRIX_LIMIT = 8;

export type LaneProgress = { stepIndex: number; phase: "start" | "end"; status?: string; error?: string };
export type LaneResult = { status: string; steps: { line: number; status: string; error?: string }[]; error?: string; output?: string; durationMs?: number };
export type MatrixLane = {
  runId: string; deviceId: string; deviceName: string; platform: MatrixPlatform; state: LaneState;
  resolvedDeviceId?: string; progress: LaneProgress[]; result?: LaneResult; error?: string; startedAt?: number; finishedAt?: number;
};
export type MatrixView = { matrixId: string; /** The test the lanes run, relative to the project. */ testPath?: string; lanes: MatrixLane[]; limit: number; startedAt: number; finishedAt?: number };

/** One device in the checklist. `installed` is unknown (undefined) for a device that is off. */
export type MatrixDeviceOption = {
  deviceId: string; name: string; platform: MatrixPlatform; runtime: string; booted: boolean; installed?: boolean;
};

const TERMINAL: ReadonlySet<LaneState> = new Set(["passed", "failed", "cancelled", "error"]);
export const isTerminalLane = (state: LaneState) => TERMINAL.has(state);
export const matrixFinished = (matrix: MatrixView | null) => matrix !== null && matrix.lanes.every(lane => isTerminalLane(lane.state));

export function clampLimit(value: number): number {
  return Number.isFinite(value) ? Math.min(MAX_MATRIX_LIMIT, Math.max(1, Math.floor(value))) : DEFAULT_MATRIX_LIMIT;
}

const STATE_LABEL: Record<LaneState, string> = {
  queued: "Queued", booting: "Booting", installing: "Installing", running: "Running",
  passed: "Passed", failed: "Failed", cancelled: "Cancelled", error: "Error",
};

/** "Running step 3 of 7" once the lane has started steps, else the plain state. */
export function laneLabel(lane: MatrixLane, totalSteps?: number): string {
  if (lane.state !== "running") return STATE_LABEL[lane.state];
  const done = new Set(lane.progress.filter(entry => entry.phase === "end").map(entry => entry.stepIndex)).size;
  const step = Math.min(done + 1, totalSteps ?? done + 1);
  return lane.progress.length === 0 ? "Running" : totalSteps ? `Running step ${step} of ${totalSteps}` : `Running step ${step}`;
}

export function laneDuration(lane: MatrixLane, now = Date.now()): number | undefined {
  if (lane.result?.durationMs !== undefined) return lane.result.durationMs;
  if (lane.startedAt === undefined) return undefined;
  return Math.max(0, (lane.finishedAt ?? now) - lane.startedAt);
}

/** "2 passed · 1 failed", counting only outcomes that exist yet. */
export function matrixSummary(matrix: MatrixView): string {
  const count = (...states: LaneState[]) => matrix.lanes.filter(lane => states.includes(lane.state)).length;
  const parts = [[count("passed"), "passed"], [count("failed", "error"), "failed"], [count("cancelled"), "cancelled"]] as const;
  const active = matrix.lanes.length - count("passed", "failed", "error", "cancelled");
  const text = parts.filter(([n]) => n > 0).map(([n, label]) => `${n} ${label}`);
  if (active > 0) text.push(`${active} in progress`);
  return text.join(" · ") || "No results yet";
}

function record(value: unknown): Record<string, unknown> | null { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
const str = (value: unknown) => typeof value === "string" ? value : "";
const STATES = new Set<string>(["queued", "booting", "installing", "running", "passed", "failed", "cancelled", "error"]);

/** Reads the server's matrix wire shape defensively; anything malformed is dropped rather than thrown. */
export function parseMatrix(value: unknown): MatrixView | null {
  const data = record(value);
  if (!data || !str(data.matrixId) || !Array.isArray(data.lanes)) return null;
  const lanes: MatrixLane[] = [];
  for (const raw of data.lanes) {
    const lane = record(raw);
    if (!lane || !str(lane.runId) || !STATES.has(str(lane.state)) || (lane.platform !== "ios" && lane.platform !== "android")) continue;
    const result = record(lane.result);
    lanes.push({
      runId: str(lane.runId), deviceId: str(lane.deviceId), deviceName: str(lane.deviceName) || str(lane.deviceId), platform: lane.platform,
      state: str(lane.state) as LaneState,
      ...(str(lane.resolvedDeviceId) ? { resolvedDeviceId: str(lane.resolvedDeviceId) } : {}),
      progress: (Array.isArray(lane.progress) ? lane.progress : []).map(record).filter((entry): entry is Record<string, unknown> => entry !== null
        && typeof entry.stepIndex === "number" && (entry.phase === "start" || entry.phase === "end"))
        .map(entry => ({ stepIndex: entry.stepIndex as number, phase: entry.phase as "start" | "end", ...(str(entry.status) ? { status: str(entry.status) } : {}), ...(str(entry.error) ? { error: str(entry.error) } : {}) })),
      ...(result ? { result: {
        status: str(result.status) || "failed",
        steps: (Array.isArray(result.steps) ? result.steps : []).map(record).filter((step): step is Record<string, unknown> => step !== null && typeof step.line === "number" && step.line > 0)
          .map(step => ({ line: step.line as number, status: str(step.status), ...(str(step.error) ? { error: str(step.error) } : {}) })),
        ...(str(result.error) ? { error: str(result.error) } : {}),
        ...(str(result.output) ? { output: str(result.output) } : {}),
        ...(typeof result.durationMs === "number" ? { durationMs: result.durationMs } : {}),
      } } : {}),
      ...(str(lane.error) ? { error: str(lane.error) } : {}),
      ...(typeof lane.startedAt === "number" ? { startedAt: lane.startedAt } : {}),
      ...(typeof lane.finishedAt === "number" ? { finishedAt: lane.finishedAt } : {}),
    });
  }
  return {
    matrixId: str(data.matrixId), ...(str(data.testPath) ? { testPath: str(data.testPath) } : {}), lanes, limit: clampLimit(typeof data.limit === "number" ? data.limit : DEFAULT_MATRIX_LIMIT),
    startedAt: typeof data.startedAt === "number" ? data.startedAt : Date.now(),
    ...(typeof data.finishedAt === "number" ? { finishedAt: data.finishedAt } : {}),
  };
}

/** Reads the checklist's devices out of the two device-list tools' payloads. Physical iOS devices are not listed. */
export function parseMatrixDevices(platform: MatrixPlatform, value: unknown): MatrixDeviceOption[] {
  const devices = record(value)?.devices;
  if (!Array.isArray(devices)) return [];
  return devices.map(record).filter((device): device is Record<string, unknown> => device !== null && Boolean(str(device.udid)))
    // A physical iPhone cannot take a simulator build, and a physical Android is not booted by us.
    .filter(device => platform === "android" || str(device.kind) !== "physical")
    .map(device => ({
      deviceId: str(device.udid), name: str(device.name) || str(device.udid), platform, runtime: str(device.runtime),
      booted: str(device.state) === "Booted" || str(device.state) === "connected" || str(device.state) === "device",
    }));
}

export type MatrixPreferences = { limit: number };
const STORAGE_PREFIX = "mobile-dev.testing.matrix:";

/** The saved concurrency limit for one project. Device choices are deliberately per test and per panel session. */
export function readMatrixPreferences(projectPath: string): MatrixPreferences {
  try {
    const stored = record(JSON.parse(globalThis.localStorage?.getItem(STORAGE_PREFIX + projectPath) ?? "null"));
    return { limit: typeof stored?.limit === "number" ? clampLimit(stored.limit) : DEFAULT_MATRIX_LIMIT };
  } catch { return { limit: DEFAULT_MATRIX_LIMIT }; }
}

export function writeMatrixPreferences(projectPath: string, preferences: MatrixPreferences): void {
  try { globalThis.localStorage?.setItem(STORAGE_PREFIX + projectPath, JSON.stringify(preferences)); } catch { /* best effort */ }
}
