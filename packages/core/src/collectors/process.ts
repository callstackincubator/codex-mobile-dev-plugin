import { spawn as spawnProcess } from "node:child_process";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { errorMessage } from "@mobile-dev/shared/protocol.ts";
import { NativeTelemetryRelay } from "../native-telemetry.ts";
import { LineSplitter } from "./lines.ts";

/** A running collector. `closed` resolves with the reason it ended, including after `stop`. */
export type Collector = { stop(): Promise<void>; closed: Promise<Error> };
export type CollectorProcess = Collector & { exited: Promise<number | null> };
export type ReadyRecord = { type: "ready"; [field: string]: unknown };

/** The `{"type":"error"}` record a helper writes before a non-zero exit. */
export class CollectorError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "CollectorError";
    this.code = code;
  }
}

export type CollectorOutput =
  /** NDJSON records. Invalid JSON and oversized lines fail the collector. */
  | { kind: "json"; maxLineLength: number; oversized: string; record(value: unknown, started: () => void): void }
  /** Text lines, for example log records. Oversized lines are dropped. */
  | { kind: "lines"; maxLineLength: number; line(text: string): void }
  /** Binary data; the decoder hands the helper's JSON control lines to `control`. */
  | { kind: "stream"; create(control: (line: string) => void, started: () => void): (chunk: Buffer) => void };

export type CollectorOptions = {
  command: string;
  args: string[];
  signal: AbortSignal;
  output: CollectorOutput;
  labels: {
    exited(status: number | string): string;
    timeout: string;
    stalled?: string;
    /** Rejects a start cancelled by `signal`; the signal's reason otherwise. */
    cancelled?: string;
    invalid?(message: string): string;
  };
  /** Startup ends when the helper's ready record (or, with `readyOnData`, its first data) arrives. */
  readyTimeoutMs?: number;
  readyOnData?: boolean;
  /** After startup, the longest wait for data before the collector counts as stalled. */
  stallMs?: number;
  /** After a stop request: SIGTERM after `terminateMs`, SIGKILL after `killMs`. */
  terminateMs?: number;
  killMs: number;
  /**
   * Helpers speak the shared protocol: NDJSON ready/error control records, and EOF on
   * stdin stops them. Other commands are live once spawned and stop on SIGTERM.
   */
  protocol?: boolean;
  /** Checks the ready record; throwing fails the start. */
  ready?(record: ReadyRecord): void;
  spawn?: (command: string, args: string[], options: SpawnOptions) => ChildProcess;
};

function controlRecord(value: unknown): { type: "ready" | "error"; [field: string]: unknown } | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return;
  const type = (value as { type?: unknown }).type;
  if (type === "ready" || type === "error") return value as { type: "ready" | "error" };
}

function parseJson(line: string): unknown {
  try { return JSON.parse(line); } catch { return undefined; }
}

/** Spawns a collector process and resolves once it is ready. */
export async function startCollector(options: CollectorOptions): Promise<CollectorProcess> {
  const { signal, labels, output } = options;
  const protocol = options.protocol ?? true;
  if (signal.aborted) {
    if (labels.cancelled !== undefined) throw new Error(labels.cancelled);
    signal.throwIfAborted();
  }
  const spawn = options.spawn ?? spawnProcess;
  const child = spawn(options.command, options.args, { stdio: [protocol ? "pipe" : "ignore", "pipe", "pipe"], shell: false });
  let diagnostics = "";
  let failure: Error | undefined;
  let stopping: Promise<void> | undefined;
  let watchdog: NodeJS.Timeout | undefined;
  let isReady = false;
  let end!: (error: Error) => void;
  let markExited!: (code: number | null) => void;
  let accept!: () => void;
  const closed = new Promise<Error>(resolve => { end = resolve; });
  const exited = new Promise<number | null>(resolve => { markExited = resolve; });
  const ready = new Promise<void>(resolve => { accept = resolve; });

  const arm = (milliseconds: number | undefined, message: string | undefined) => {
    clearTimeout(watchdog);
    if (milliseconds === undefined || message === undefined) return;
    watchdog = setTimeout(() => fail(new Error(message)), milliseconds);
    watchdog.unref();
  };
  const stop = (): Promise<void> => {
    if (stopping) return stopping;
    stopping = (async () => {
      clearTimeout(watchdog);
      signal.removeEventListener("abort", abort);
      if (protocol) child.stdin?.end();
      else child.kill("SIGTERM");
      const terminate = options.terminateMs === undefined ? undefined : setTimeout(() => child.kill("SIGTERM"), options.terminateMs);
      const kill = setTimeout(() => child.kill("SIGKILL"), options.killMs);
      terminate?.unref();
      kill.unref();
      try { await exited; } finally { clearTimeout(terminate); clearTimeout(kill); }
    })();
    return stopping;
  };
  function fail(error: Error) {
    failure ??= error;
    end(failure);
    void stop();
  }
  const abort = () => fail(labels.cancelled === undefined ? signal.reason : new Error(labels.cancelled));
  const started = () => {
    if (isReady) return;
    isReady = true;
    arm(options.stallMs, labels.stalled);
    accept();
  };
  const active = () => { if (isReady) arm(options.stallMs, labels.stalled); };
  const invalid = (error: unknown) => {
    const message = errorMessage(error);
    return new Error(labels.invalid ? labels.invalid(message) : message);
  };
  /** Handles a control record; false for data. */
  const control = (value: unknown): boolean => {
    const record = protocol ? controlRecord(value) : undefined;
    if (record === undefined) return false;
    if (record.type === "error") {
      const code = typeof record.cause === "string" ? record.cause : "failed";
      const message = typeof record.message === "string" && record.message.length > 0 ? record.message : labels.exited(code);
      failure ??= new CollectorError(code, message);
    } else if (isReady === false) {
      options.ready?.(record as ReadyRecord);
      if (options.readyOnData !== true) started();
    }
    return true;
  };

  let write: (chunk: Buffer) => void;
  if (output.kind === "stream") {
    const controlLine = (line: string) => {
      if (control(JSON.parse(line)) === false) throw new Error("The helper wrote an unknown control record.");
    };
    const decode = output.create(controlLine, started);
    write = chunk => { decode(chunk); active(); };
  } else {
    const lineOptions = output.kind === "json"
      ? { maxLength: output.maxLineLength, oversized: output.oversized }
      : { maxLength: output.maxLineLength };
    const splitter = new LineSplitter(line => {
      if (output.kind === "json") {
        const value: unknown = JSON.parse(line);
        if (control(value) === false) output.record(value, started);
      } else if (protocol === false || line.includes('"type"') === false || control(parseJson(line)) === false) {
        // Only control records carry a top-level "type" key; other lines skip the extra parse.
        output.line(line);
      }
      active();
    }, lineOptions);
    write = chunk => splitter.write(chunk);
  }
  const telemetry = new NativeTelemetryRelay(text => { diagnostics = (diagnostics + text).slice(-4096); });
  child.stderr?.on("data", (chunk: Buffer) => { telemetry.write(chunk); });
  child.stdout?.on("data", (chunk: Buffer) => {
    if (stopping || failure) return;
    try { write(chunk); }
    catch (error) {
      const oversized = output.kind === "json" && error instanceof Error && error.message === output.oversized;
      fail(oversized ? error : invalid(error));
    }
  });
  child.stdin?.on("error", () => {});
  child.once("error", error => { fail(error); markExited(null); });
  child.once("spawn", () => { if (protocol === false) started(); });
  child.once("close", (code, exitSignal) => {
    telemetry.end();
    clearTimeout(watchdog);
    signal.removeEventListener("abort", abort);
    markExited(code);
    end(failure ?? new Error(diagnostics.trim() || labels.exited(code ?? exitSignal ?? "unknown")));
  });
  signal.addEventListener("abort", abort, { once: true });
  arm(options.readyTimeoutMs, labels.timeout);
  const outcome = await Promise.race([ready, closed]);
  if (outcome instanceof Error) {
    await stop();
    throw outcome;
  }
  return { stop, closed, exited };
}
