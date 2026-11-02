import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { createConnection } from "node:net";
import type { Socket } from "node:net";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { DebugserverTransport } from "./simulator.ts";

const number = z.number();
const integer = number.int();
const positive = integer.min(1);
const port = positive.max(65535);
const address = z.object({ port });
const readySchema = address.strict();

export async function openPhysicalDebugserver(deviceId: string, signal: AbortSignal,
  helper = new URL("./ios-fps/mobile-dev-ios-fps", import.meta.url)): Promise<DebugserverTransport> {
  signal.throwIfAborted();
  if (process.platform !== "darwin") throw new Error("Physical iOS CPU monitoring requires macOS.");
  const path = fileURLToPath(helper);
  await access(path);
  signal.throwIfAborted();
  const child = spawn(path, ["debugserver", deviceId], { stdio: "pipe", shell: false });
  let socket: Socket | undefined;
  let closing: Promise<void> | undefined;
  let diagnostics = "";
  let pending = "";
  let accept!: (port: number) => void;
  let fail!: (error: Error) => void;
  const ready = new Promise<number>((resolve, reject) => { accept = resolve; fail = reject; });
  const exited = new Promise<number | null>(resolve => {
    child.once("close", (code, exitSignal) => {
      const message = diagnostics.trim() || `The iPhone debugserver helper exited (${code ?? exitSignal}).`;
      const error = new Error(message);
      fail(error);
      if (closing === undefined) socket?.destroy(error);
      resolve(code);
    });
  });
  const close = (): Promise<void> => {
    if (closing) return closing;
    closing = (async () => {
      socket?.destroy();
      child.stdin.end();
      const terminate = setTimeout(() => child.kill("SIGTERM"), 5000);
      const kill = setTimeout(() => child.kill("SIGKILL"), 10000);
      try { await exited; }
      finally { clearTimeout(terminate); clearTimeout(kill); }
    })();
    return closing;
  };
  const abort = () => {
    fail(signal.reason);
    void close();
  };
  signal.addEventListener("abort", abort, { once: true });
  child.stdin.on("error", () => {});
  child.once("error", fail);
  child.stderr.on("data", (chunk: Buffer) => {
    const text = chunk.toString("utf8");
    diagnostics = (diagnostics + text).slice(-4096);
  });
  child.stdout.on("data", (chunk: Buffer) => {
    if (closing || socket) return;
    pending += chunk.toString("utf8");
    try {
      if (pending.length > 4096) throw new Error("The iPhone debugserver helper returned an oversized address.");
      const newline = pending.indexOf("\n");
      if (newline < 0) return;
      const line = pending.slice(0, newline);
      const decoded: unknown = JSON.parse(line);
      const ready = readySchema.parse(decoded);
      accept(ready.port);
    } catch (error) {
      const failure = error instanceof Error ? error : new Error("Invalid iPhone debugserver address.");
      fail(failure);
    }
  });
  const timeout = setTimeout(() => {
    const error = new Error("Timed out opening the paired iPhone debugserver. Check Developer Mode and the developer disk image.");
    fail(error);
    socket?.destroy(error);
  }, 25000);
  try {
    const port = await ready;
    signal.throwIfAborted();
    const connected = new Promise<void>((resolve, reject) => {
      socket = createConnection({ host: "127.0.0.1", port });
      socket.once("connect", resolve);
      socket.once("error", reject);
      socket.once("close", () => {
        const error = new Error("The iPhone debugserver connection closed before connecting.");
        reject(error);
      });
      socket.on("error", () => {});
      socket.setNoDelay(true);
    });
    await connected;
    signal.throwIfAborted();
    if (socket === undefined) throw new Error("The iPhone debugserver did not connect.");
    socket.once("close", () => signal.removeEventListener("abort", abort));
    return { socket, close, exited };
  } catch (error) {
    await close();
    signal.removeEventListener("abort", abort);
    throw error;
  } finally { clearTimeout(timeout); }
}
