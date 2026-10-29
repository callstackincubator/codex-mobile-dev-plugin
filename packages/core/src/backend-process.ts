import type { ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { annotateDeviceCommand } from "@mobile-dev/shared/device-command-diagnostics.ts";

/** A free loopback port. Another process can still bind it before the backend does. */
export async function allocatePort(failure: string): Promise<number> {
  const socket = createServer();
  await new Promise<void>((resolve, reject) => { socket.once("error", reject); socket.listen(0, "127.0.0.1", resolve); });
  const address = socket.address();
  await new Promise<void>(resolve => socket.close(() => resolve()));
  if (!address || typeof address === "string") throw new Error(failure);
  return address.port;
}

/** How a backend failed to become ready, other than failing to spawn. */
export type BackendFailure = "exit" | "deadline" | "cancelled";

export class BackendStartError extends Error {
  readonly failure: BackendFailure;
  constructor(message: string, failure: BackendFailure) {
    super(message);
    this.failure = failure;
  }
}

export type BackendSupervision<T> = {
  /** Names the backend in errors, such as Baguette. */
  name: string;
  deadlineMs: number;
  /** Resolves once the backend answers, or undefined while it cannot yet. */
  probe(signal: AbortSignal): Promise<T | undefined>;
  /** Whether the owner closed, which ends the wait. */
  closed(): boolean;
  /** The error for a process that could not spawn. */
  spawnError(error: Error): Error;
  /** Names the start command on exit and deadline errors. */
  command?: string;
  /** A secret the backend prints, kept out of its echoed output and errors. */
  redact?: string;
  stop?(child: ChildProcess): void;
};

/**
 * Waits for a spawned backend to become ready, echoing its output to stderr and keeping its end for
 * errors. It polls every 250 ms until the deadline, ends as soon as the process exits, and stops the
 * process on failure.
 */
export async function superviseBackend<T>(child: ChildProcess, supervision: BackendSupervision<T>): Promise<T> {
  const { name, deadlineMs, probe, closed, spawnError, command, redact, stop = process => process.kill("SIGTERM") } = supervision;
  // Each process keeps its own output, so a failed attempt's late output can't explain the next one.
  let output = "";
  let launchError: Error | undefined;
  const exited = new AbortController();
  child.on("error", error => { launchError = error; });
  child.on("exit", () => exited.abort());
  for (const stream of [child.stdout, child.stderr]) {
    stream?.on("data", (chunk: Buffer) => {
      const shown = redact ? chunk.toString().replaceAll(redact, "[token]") : chunk;
      output = (output + shown.toString()).slice(-4000);
      process.stderr.write(shown);
    });
  }
  const annotate = (error: Error, failure: Parameters<typeof annotateDeviceCommand>[2]) => command ? annotateDeviceCommand(error, command, failure) : error;
  try {
    const deadline = AbortSignal.timeout(deadlineMs);
    // A listener that holds the port but never answers must not delay noticing that the backend exited.
    const polling = AbortSignal.any([deadline, exited.signal]);
    while (!deadline.aborted && !closed()) {
      if (launchError) throw spawnError(launchError);
      if (child.exitCode !== null || child.signalCode !== null) {
        const error = new BackendStartError(`${name} exited before it became ready. ${output.trim()}`, "exit");
        throw annotate(error, child.signalCode === null ? { failure: "exit", status: child.exitCode ?? undefined } : { failure: "signal" });
      }
      const ready = await probe(polling).catch(() => undefined);
      if (ready !== undefined) return ready;
      await delay(250);
    }
    const error = new BackendStartError(`${name} did not become ready within ${deadlineMs / 1000} seconds. ${output.trim()}`, closed() ? "cancelled" : "deadline");
    throw annotate(error, { failure: "deadline" });
  } catch (error) {
    stop(child);
    throw error;
  }
}
