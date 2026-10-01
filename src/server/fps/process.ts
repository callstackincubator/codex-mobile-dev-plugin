import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type { CpuMonitor } from "../cpu/monitor.ts";

export async function collectorProcess(command: string, args: string[], options: {
  signal: AbortSignal;
  data: (chunk: Buffer, ready: () => void) => void;
  diagnostic?: (text: string) => void;
  shutdown?: () => Promise<void>;
}): Promise<CpuMonitor> {
  options.signal.throwIfAborted();
  const child: ChildProcessWithoutNullStreams = spawn(command, args, { stdio: "pipe", shell: false });
  let diagnostics = "";
  let failure: Error | undefined;
  let stopping: Promise<void> | undefined;
  let end!: (error: Error) => void;
  let exited!: () => void;
  let ready!: () => void;
  let watchdog: NodeJS.Timeout | undefined;
  let startedSuccessfully = false;
  const closed = new Promise<Error>(resolve => { end = resolve; });
  const exit = new Promise<void>(resolve => { exited = resolve; });
  const started = new Promise<void>(resolve => { ready = resolve; });
  const stop = (): Promise<void> => {
    if (stopping) return stopping;
    stopping = (async () => {
      const timer = setTimeout(() => child.kill("SIGKILL"), 4000);
      try {
        if (options.shutdown) await options.shutdown();
        child.stdin.end();
        await exit;
      } finally { clearTimeout(timer); clearTimeout(watchdog); }
    })();
    return stopping;
  };
  const abort = () => { void stop().catch(() => {}); };
  options.signal.addEventListener("abort", abort, { once: true });
  child.stderr.on("data", (chunk: Buffer) => {
    const text = chunk.toString("utf8");
    diagnostics = (diagnostics + text).slice(-4096);
    options.diagnostic?.(text);
  });
  child.stdout.on("data", (chunk: Buffer) => {
    if (stopping || failure) return;
    const accept = () => { startedSuccessfully = true; ready(); };
    try {
      options.data(chunk, accept);
      if (startedSuccessfully) {
        clearTimeout(watchdog);
        watchdog = setTimeout(() => {
          failure = new Error("The device stopped sending Display FPS data. Reconnect and retry.");
          end(failure);
          void stop().catch(() => {});
        }, 6000);
      }
    }
    catch (error) {
      if (error instanceof Error) failure = error;
      else {
        const message = String(error);
        failure = new Error(message);
      }
      end(failure);
      void stop().catch(() => {});
    }
  });
  child.stdin.on("error", () => {});
  child.once("error", error => { failure = error; end(error); });
  child.once("close", (code, signal) => {
    options.signal.removeEventListener("abort", abort);
    clearTimeout(watchdog);
    exited();
    const message = diagnostics.trim() || `Display FPS collector exited (${code ?? signal}).`;
    const error = failure ?? new Error(message);
    end(error);
  });
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("The device did not produce live Display FPS samples.")), 15000);
  });
  const disconnected = closed.then(error => { throw error; });
  try {
    await Promise.race([started, timeout, disconnected]);
    options.signal.throwIfAborted();
    return { stop, closed };
  } catch (error) { await stop(); throw error; }
  finally { clearTimeout(timer); }
}
