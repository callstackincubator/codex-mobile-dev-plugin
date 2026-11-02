import { execFile, spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { access } from "node:fs/promises";
import { createServer } from "node:net";
import type { Socket } from "node:net";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
export type DebugserverTransport = { socket: Socket; close(): Promise<void>; exited: Promise<number | null> };

export async function openSimulatorDebugserver(signal: AbortSignal): Promise<DebugserverTransport> {
  if (process.platform !== "darwin") throw new Error("iOS simulator CPU monitoring requires macOS.");
  const discoverySignal = AbortSignal.any([signal, AbortSignal.timeout(5000)]);
  const selection = await execute("xcode-select", ["--print-path"], { signal: discoverySignal });
  const directory = selection.stdout.trim();
  const binary = resolve(directory, "../SharedFrameworks/LLDB.framework/Resources/debugserver");
  try { await access(binary); }
  catch { throw new Error("The selected developer directory has no debugserver. Select the full Xcode installation."); }
  return launchLocalDebugserver(binary, signal);
}

export async function launchLocalDebugserver(binary: string, signal: AbortSignal): Promise<DebugserverTransport> {
  signal.throwIfAborted();
  const listener = createServer();
  let socket: Socket | undefined;
  let child: ChildProcess | undefined;
  let exited: Promise<number | null> | undefined;
  let closing: Promise<void> | undefined;
  let diagnostics = "";
  const close = (): Promise<void> => {
    if (closing) return closing;
    closing = (async () => {
      listener.close();
      socket?.destroy();
      if (!child || !exited) return;
      if (socket === undefined) child.kill("SIGTERM");
      // Closing the GDB socket detaches the app. Allow that to finish first.
      const terminate = setTimeout(() => child?.kill("SIGTERM"), 5000);
      const kill = setTimeout(() => child?.kill("SIGKILL"), 10000);
      try { await exited; }
      finally { clearTimeout(terminate); clearTimeout(kill); }
    })();
    return closing;
  };
  const startupSignal = AbortSignal.any([signal, AbortSignal.timeout(10000)]);
  const abort = () => { void close(); };
  startupSignal.addEventListener("abort", abort, { once: true });
  let failAbort: (() => void) | undefined;
  try {
    await new Promise<void>((ready, reject) => {
      listener.once("error", reject);
      listener.once("close", () => reject(new Error("Simulator debugserver startup was cancelled.")));
      listener.listen({ host: "127.0.0.1", port: 0, signal: startupSignal }, ready);
    });
    startupSignal.throwIfAborted();
    const address = listener.address();
    if (address === null || typeof address === "string") throw new Error("Could not listen for simulator debugserver.");
    const connected = new Promise<Socket>((accept, reject) => {
      listener.once("error", reject);
      listener.once("connection", connection => {
        socket = connection;
        connection.on("error", () => {});
        connection.setNoDelay(true);
        if (startupSignal.aborted) connection.destroy();
        accept(connection);
        listener.close();
      });
    });
    const destination = `127.0.0.1:${address.port}`;
    // Attach only after negotiating detach-on-error in the GDB collector.
    child = spawn(binary, ["--native-regs", "--setsid", "--reverse-connect", destination], { stdio: ["ignore", "pipe", "pipe"] });
    const drain = (chunk: Buffer) => { const text = chunk.toString(); diagnostics = (diagnostics + text).slice(-4000); };
    child.stdout?.on("data", drain);
    child.stderr?.on("data", drain);
    exited = new Promise((done, reject) => {
      child!.once("error", reject);
      child!.once("close", done);
    });
    const prematureExit = exited.then(code => {
      const details = diagnostics.trim();
      throw new Error(`Simulator debugserver exited before connecting (${code}). ${details}`);
    });
    const aborted = new Promise<never>((_, reject) => {
      failAbort = () => reject(startupSignal.reason);
      if (startupSignal.aborted) failAbort();
      else startupSignal.addEventListener("abort", failAbort, { once: true });
    });
    const connection = await Promise.race([connected, prematureExit, aborted]);
    startupSignal.throwIfAborted();
    const disconnect = () => connection.destroy();
    signal.addEventListener("abort", disconnect, { once: true });
    connection.once("close", () => signal.removeEventListener("abort", disconnect));
    return { socket: connection, close, exited };
  } catch (error) {
    await close().catch(() => {});
    throw error;
  } finally {
    startupSignal.removeEventListener("abort", abort);
    if (failAbort) startupSignal.removeEventListener("abort", failAbort);
  }
}
