import { createServer } from "node:net";
import type { Socket } from "node:net";
import { mirrorRequestSchema, maximumReplyBytes } from "./ios-mirror-rpc.ts";
import type { MirrorRequest } from "./ios-mirror-rpc.ts";
import type { IosCapture } from "./ios-native-capture.ts";
import type { IosMirrorHub } from "./ios-mirror-hub.ts";
import { IosMirrorInputBusyError } from "../shared/ios-mirror-errors.ts";

export function createIosMirrorServer(hub: IosMirrorHub, idle: () => void, active: () => void) {
  const sockets = new Set<Socket>();
  const cleanup = new Set<Promise<void>>();
  const server = createServer(socket => {
    sockets.add(socket);
    active();
    socket.setEncoding("utf8");
    socket.setTimeout(360000, () => socket.destroy());
    let incoming = "";
    let capture: IosCapture | undefined;
    let opening: Promise<IosCapture> | undefined;
    let closing = false;
    const running = new Set<number>();
    const handle = async (request: MirrorRequest) => {
      if (closing) throw new Error("The shared physical iOS connection closed.");
      if (request.method === "open") {
        if (capture || opening) throw new Error("This connection already has a physical iOS subscription.");
        opening = hub.open(request.udid);
        try { capture = await opening; }
        finally { opening = undefined; }
        return null;
      }
      if (capture === undefined) throw new Error("Open a shared physical iOS subscription first.");
      if (request.method === "read") return capture.read();
      if (request.method === "touch") await capture.touch(request.samples, request.generation);
      if (request.method === "reset") await capture.reset();
      if (request.method === "close") { closing = true; await capture.close(); capture = undefined; }
      return null;
    };
    const respond = async (request: MirrorRequest) => {
      try {
        let reply;
        try { const result = await handle(request); reply = { id: request.id, result }; }
        catch (error) {
          const message = error instanceof Error ? error.message : "Shared physical iOS capture failed.";
          reply = { id: request.id, error: message.slice(0, 4096), inputBusy: error instanceof IosMirrorInputBusyError };
        }
        if (socket.destroyed) return;
        const encoded = JSON.stringify(reply);
        if (encoded.length > maximumReplyBytes || socket.writableLength > maximumReplyBytes) { socket.destroy(); return; }
        socket.write(encoded + "\n");
      } finally { running.delete(request.id); }
    };
    socket.on("data", (chunk: string) => {
      incoming += chunk;
      let end = incoming.indexOf("\n");
      while (end >= 0) {
        if (end > 32768) { socket.destroy(); return; }
        const line = incoming.slice(0, end);
        incoming = incoming.slice(end + 1);
        try {
          const value: unknown = JSON.parse(line);
          const request = mirrorRequestSchema.parse(value);
          if (running.size >= 8 || running.has(request.id)) { socket.destroy(); return; }
          running.add(request.id);
          void respond(request);
        } catch { socket.destroy(); return; }
        end = incoming.indexOf("\n");
      }
      if (incoming.length > 32768) socket.destroy();
    });
    socket.on("error", () => {});
    socket.once("close", () => {
      closing = true;
      sockets.delete(socket);
      const finished = (async () => {
        try { await opening; }
        catch { /* Startup failures leave no subscription to close. */ }
        await capture?.close();
      })();
      cleanup.add(finished);
      void finished.finally(() => { cleanup.delete(finished); if (sockets.size === 0 && cleanup.size === 0) idle(); }).catch(() => {});
    });
  });
  return {
    server,
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      await Promise.allSettled(cleanup);
      await hub.close();
    },
  };
}
