import { access } from "node:fs/promises";
import { createConnection } from "node:net";
import type { Socket } from "node:net";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { DebugserverTransport } from "./simulator.ts";
import { startCollector } from "../collectors/process.ts";

const number = z.number();
const integer = number.int();
const positive = integer.min(1);
const port = positive.max(65535);
const readySchema = z.object({ type: z.literal("ready"), port });

export async function openPhysicalDebugserver(deviceId: string, signal: AbortSignal,
  helper = new URL("./ios-fps/mobile-dev-ios-fps", import.meta.url)): Promise<DebugserverTransport> {
  signal.throwIfAborted();
  if (process.platform !== "darwin") throw new Error("Physical iOS CPU monitoring requires macOS.");
  const path = fileURLToPath(helper);
  await access(path);
  let address = 0;
  const bridge = await startCollector({
    command: path, args: ["debugserver", deviceId], signal, readyTimeoutMs: 25000, terminateMs: 5000, killMs: 10000,
    labels: {
      exited: status => `The iPhone debugserver helper exited (${status}).`,
      timeout: "Timed out opening the paired iPhone debugserver. Check Developer Mode and the developer disk image.",
    },
    ready(record) { address = readySchema.parse(record).port; },
    output: { kind: "json", maxLineLength: 4096, oversized: "The iPhone debugserver helper returned an oversized address.", record() {} },
  });
  let socket: Socket | undefined;
  let closing: Promise<void> | undefined;
  const close = (): Promise<void> => {
    closing ??= (async () => {
      socket?.destroy();
      await bridge.stop();
    })();
    return closing;
  };
  void bridge.closed.then(error => { if (closing === undefined) socket?.destroy(error); });
  try {
    const connected = new Promise<void>((resolve, reject) => {
      socket = createConnection({ host: "127.0.0.1", port: address });
      socket.once("connect", resolve);
      socket.once("error", reject);
      socket.once("close", () => {
        const error = new Error("The iPhone debugserver connection closed before connecting.");
        reject(error);
      });
      socket.on("error", () => {});
      socket.setNoDelay(true);
    });
    const disconnected = bridge.closed.then(error => { throw error; });
    await Promise.race([connected, disconnected]);
    signal.throwIfAborted();
    if (socket === undefined) throw new Error("The iPhone debugserver did not connect.");
    return { socket, close, exited: bridge.exited };
  } catch (error) {
    await close();
    throw error;
  }
}
