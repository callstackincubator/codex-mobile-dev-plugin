import { randomUUID } from "node:crypto";
import { errorMessage } from "@mobile-dev/shared/protocol.ts";
import { expectedOutcome } from "@mobile-dev/shared/error-reporting.ts";
import type { LaneFailure } from "./testing-failure.ts";
import type { TestRunProgress, TestRunResult } from "./testing-run.ts";

/**
 * Runs one test on several devices: a registry of matrices and their lanes, and a scheduler that
 * keeps at most `limit` lanes active at a time.
 *
 * One `e2e run` process per device, not the runner's own device pool: a pool hands *different
 * files* to different devices, while a matrix needs the *same* test on each, with independent
 * progress, failure and cancel. A single run is a matrix of one, so there is one code path.
 */

export type LaneState = "queued" | "booting" | "installing" | "running" | "passed" | "failed" | "cancelled" | "error";
export type MatrixPlatform = "ios" | "android";

const TERMINAL: ReadonlySet<LaneState> = new Set(["passed", "failed", "cancelled", "error"]);
export const isTerminalLane = (state: LaneState): boolean => TERMINAL.has(state);

/** The default number of lanes that run at once, and the range a caller may choose from. */
export const DEFAULT_MATRIX_LIMIT = 3;
export const MAX_MATRIX_LIMIT = 8;
export function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_MATRIX_LIMIT;
  return Math.min(MAX_MATRIX_LIMIT, Math.max(1, Math.floor(limit)));
}

export interface MatrixDevice { deviceId: string; platform: MatrixPlatform; name?: string }

export interface Lane {
  runId: string;
  /** The device the caller asked for. An Android `avd:` name resolves to a serial once booted. */
  deviceId: string;
  deviceName: string;
  platform: MatrixPlatform;
  state: LaneState;
  /** The device the run actually used, once it is known. */
  resolvedDeviceId?: string;
  progress: TestRunProgress[];
  result?: TestRunResult;
  /** The failing line and the device's screen, set before the lane settles as failed. */
  failure?: LaneFailure;
  error?: string;
  startedAt?: number;
  finishedAt?: number;
}

export interface MatrixRun {
  matrixId: string;
  testPath: string;
  lanes: Lane[];
  startedAt: number;
  finishedAt?: number;
  limit: number;
}

/** A promise pool: at most `limit` tasks run at once, the rest wait in submission order. */
export class Scheduler {
  readonly limit: number;
  private active = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(limit: number) { this.limit = clampLimit(limit); }

  get running(): number { return this.active; }
  get queued(): number { return this.waiting.length; }

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) await new Promise<void>(resolve => this.waiting.push(resolve));
    else this.active += 1;
    try { return await task(); }
    finally {
      const next = this.waiting.shift();
      // The slot passes straight to the next waiter, so `active` is unchanged.
      if (next) next(); else this.active -= 1;
    }
  }
}

interface Entry { run: MatrixRun; aborts: Map<string, AbortController> }

/** The matrices of this server, newest last. Old finished ones are dropped so memory stays bounded. */
export class MatrixRegistry {
  private readonly entries = new Map<string, Entry>();
  private readonly keep: number;

  constructor(keep = 20) { this.keep = keep; }

  create(testPath: string, devices: MatrixDevice[], limit: number): { run: MatrixRun; aborts: Map<string, AbortController> } {
    const run: MatrixRun = {
      matrixId: randomUUID(), testPath, startedAt: Date.now(), limit: clampLimit(limit),
      lanes: devices.map(device => ({
        runId: randomUUID(), deviceId: device.deviceId, deviceName: device.name ?? device.deviceId,
        platform: device.platform, state: "queued" as LaneState, progress: [],
      })),
    };
    const aborts = new Map(run.lanes.map(lane => [lane.runId, new AbortController()]));
    this.entries.set(run.matrixId, { run, aborts });
    this.prune();
    return { run, aborts };
  }

  private prune() {
    for (const [id, entry] of this.entries) {
      if (this.entries.size <= this.keep) return;
      if (entry.run.lanes.every(lane => isTerminalLane(lane.state))) this.entries.delete(id);
    }
  }

  get(matrixId: string): MatrixRun | undefined { return this.entries.get(matrixId)?.run; }

  latest(): MatrixRun | undefined { return [...this.entries.values()].at(-1)?.run; }

  /** Whether any lane of any matrix is still queued or active. */
  get busy(): boolean { return [...this.entries.values()].some(entry => entry.run.lanes.some(lane => !isTerminalLane(lane.state))); }

  /** Device ids that a lane that has not finished is using or will use. */
  busyDevices(): string[] {
    return [...new Set([...this.entries.values()].flatMap(entry => entry.run.lanes
      .filter(lane => !isTerminalLane(lane.state)).flatMap(lane => [lane.deviceId, ...(lane.resolvedDeviceId ? [lane.resolvedDeviceId] : [])])))];
  }

  /** Cancels one lane (by device) or every lane of the matrix. Returns the lanes that were cancelled. */
  cancel(matrixId: string, deviceId?: string): Lane[] {
    const entry = this.entries.get(matrixId);
    if (!entry) return [];
    const cancelled: Lane[] = [];
    for (const lane of entry.run.lanes) {
      if (isTerminalLane(lane.state)) continue;
      if (deviceId !== undefined && lane.deviceId !== deviceId && lane.resolvedDeviceId !== deviceId) continue;
      entry.aborts.get(lane.runId)?.abort();
      // A lane that has not started yields at once; an active one is marked when its process ends.
      if (lane.state === "queued" && lane.startedAt === undefined) { lane.state = "cancelled"; lane.finishedAt = Date.now(); }
      cancelled.push(lane);
    }
    return cancelled;
  }
}

/** Everything a lane needs from the outside world; faked in tests. */
export interface LaneExecutor {
  /**
   * Gets the device ready: boots it and installs the app when they are missing. Reports each phase
   * through `setState` and returns the device id the run should use.
   */
  prepare(lane: Lane, lanes: readonly Lane[], signal: AbortSignal, setState: (state: "booting" | "installing") => void): Promise<string>;
  run(lane: Lane, deviceId: string, signal: AbortSignal, onProgress: (progress: TestRunProgress) => void): Promise<TestRunResult>;
}

/** How a finished runner status maps to a lane state. */
export function laneStateFor(status: string): LaneState { return status === "passed" ? "passed" : "failed"; }

/**
 * Starts the matrix and returns immediately; the lanes advance in the background and the caller
 * polls the registry. The returned promise settles when every lane is terminal (tests await it).
 */
export function startMatrix(registry: MatrixRegistry, input: { testPath: string; devices: MatrixDevice[]; limit?: number }, executor: LaneExecutor): { run: MatrixRun; done: Promise<void> } {
  const { run, aborts } = registry.create(input.testPath, input.devices, clampLimit(input.limit));
  const scheduler = new Scheduler(run.limit);
  const done = Promise.all(run.lanes.map(lane => scheduler.run(() => runLane(run, lane, aborts.get(lane.runId)!.signal, executor)))).then(() => { run.finishedAt = Date.now(); });
  return { run, done };
}

async function runLane(run: MatrixRun, lane: Lane, signal: AbortSignal, executor: LaneExecutor): Promise<void> {
  if (signal.aborted || lane.state === "cancelled") { settle(lane, "cancelled"); return; }
  lane.startedAt = Date.now();
  try {
    const deviceId = await executor.prepare(lane, run.lanes, signal, state => { lane.state = state; });
    lane.resolvedDeviceId = deviceId;
    signal.throwIfAborted();
    lane.state = "running";
    const result = await executor.run(lane, deviceId, signal, entry => { lane.progress.push(entry); });
    lane.result = result;
    settle(lane, laneStateFor(result.status));
  } catch (error) {
    if (signal.aborted || expectedOutcome(error) === "cancelled") settle(lane, "cancelled");
    else { lane.error = errorMessage(error); settle(lane, "error"); }
  }
}

function settle(lane: Lane, state: LaneState) { lane.state = state; lane.finishedAt = Date.now(); }

/** A copy for the wire: the registry's own objects keep changing while the caller holds the answer. */
export function snapshotMatrix(run: MatrixRun): MatrixRun {
  return { ...run, lanes: run.lanes.map(lane => ({ ...lane, progress: [...lane.progress] })) };
}
