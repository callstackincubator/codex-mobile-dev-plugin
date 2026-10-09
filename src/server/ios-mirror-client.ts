import { createConnection } from "node:net";
import type { Socket } from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { ExpectedOperationError } from "../shared/error-reporting.ts";
import { IosMirrorInputBusyError } from "../shared/ios-mirror-errors.ts";
import { mirrorReplySchema, mirrorSocketPath, maximumReplyBytes } from "./ios-mirror-rpc.ts";
import type { MirrorCommand, MirrorReply } from "./ios-mirror-rpc.ts";
import type { IosCapture } from "./ios-native-capture.ts";

async function connect(path: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(path);
    const timer = setTimeout(() => {
      const error = new Error("Shared iOS capture connection timed out.");
      socket.destroy(error);
    }, 1000);
    socket.once("error", reject);
    socket.once("connect", () => { clearTimeout(timer); socket.removeListener("error", reject); resolve(socket); });
    socket.once("close", () => clearTimeout(timer));
  });
}

let starting: Promise<void> | undefined;
async function startService() {
  if (starting) return starting;
  starting = (async () => {
    const bundled = import.meta.url.endsWith("/server.mjs");
    const entry = bundled ? "./ios-mirror-service.mjs" : "./ios-mirror-service.ts";
    const url = new URL(entry, import.meta.url);
    const path = fileURLToPath(url);
    const child = spawn(process.execPath, [path], { detached: true, stdio: "ignore", env: process.env });
    let failure: Error | undefined;
    child.on("error", error => { failure = error; });
    child.unref();
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if (failure) throw failure;
      try { const socket = await connect(mirrorSocketPath); socket.destroy(); return; }
      catch { await delay(100); }
    }
    throw new Error("The shared iOS capture service did not start.");
  })();
  try { await starting; }
  finally { starting = undefined; }
}

export async function connectIosCapture(path: string, udid: string): Promise<IosCapture> {
  const socket = await connect(path);
  socket.setEncoding("utf8");
  let incoming = "";
  let sequence = 0;
  let closed = false;
  const pending = new Map<number, { resolve: (reply: MirrorReply) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  const fail = (error: Error) => {
    closed = true;
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(error); }
    pending.clear();
  };
  socket.on("error", fail);
  socket.on("close", () => {
    const error = new Error("The shared physical iOS stream disconnected.");
    fail(error);
  });
  const disconnect = (message: string) => {
    const error = new Error(message);
    socket.destroy(error);
  };
  socket.on("data", (chunk: string) => {
    incoming += chunk;
    let end = incoming.indexOf("\n");
    while (end >= 0) {
      if (end > maximumReplyBytes) { disconnect("Shared iOS video exceeded its size limit."); return; }
      const line = incoming.slice(0, end);
      incoming = incoming.slice(end + 1);
      try {
        const value: unknown = JSON.parse(line);
        const reply = mirrorReplySchema.parse(value);
        const request = pending.get(reply.id);
        if (request) {
          clearTimeout(request.timer);
          pending.delete(reply.id);
          if (reply.error) {
            const error = reply.inputBusy ? new IosMirrorInputBusyError() : new Error(reply.error);
            request.reject(error);
          }
          else request.resolve(reply);
        }
      } catch { disconnect("Invalid shared iOS capture response."); return; }
      end = incoming.indexOf("\n");
    }
    if (incoming.length > maximumReplyBytes) disconnect("Shared iOS video exceeded its size limit.");
  });
  const request = (command: MirrorCommand): Promise<MirrorReply> => {
    if (closed) {
      const error = new Error("The shared physical iOS stream closed.");
      return Promise.reject(error);
    }
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => disconnect("Shared iOS capture request timed out."), 30000);
      pending.set(id, { resolve, reject, timer });
      const encoded = JSON.stringify({ ...command, id });
      socket.write(encoded + "\n");
    });
  };
  try { await request({ method: "open", udid }); }
  catch (error) { socket.destroy(); throw error; }
  return {
    async read() {
      const reply = await request({ method: "read" });
      if (reply.result === undefined || reply.result === null) throw new Error("Shared iOS capture returned no video batch.");
      return reply.result;
    },
    async touch(samples, generation) { await request({ method: "touch", samples, generation }); },
    async reset() { await request({ method: "reset" }); },
    async close() {
      if (closed) return;
      try { await request({ method: "close" }); }
      finally { socket.destroy(); }
    },
  };
}

export async function openSharedIosCapture(udid: string): Promise<IosCapture> {
  if (process.platform !== "darwin" || process.arch !== "arm64") throw new ExpectedOperationError("unsupported_platform", "Physical iOS mirroring requires an Apple Silicon Mac.");
  // Only connection establishment starts a service; device-open errors must reach the panel unchanged.
  try { const socket = await connect(mirrorSocketPath); socket.destroy(); }
  catch { await startService(); }
  return connectIosCapture(mirrorSocketPath, udid);
}
