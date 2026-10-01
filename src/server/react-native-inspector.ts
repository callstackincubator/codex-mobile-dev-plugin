import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import { z } from "zod";
import { metroTargets } from "./metro-logs.ts";
import { collectReactNativeTree } from "./react-native-snapshot.js";
import type { ScreenBounds, ReactElementContext } from "../shared/screen-annotations.ts";
import { resolveReactNativeSources } from "./react-native-source.ts";
import { captureServerError } from "./telemetry.ts";

export type InspectorNode = { source: "react-native"; role: string; label?: string; identifier?: string; frame: ScreenBounds; nodeId?: string; parentId?: string; depth?: number; children: InspectorNode[]; react?: ReactElementContext; creationStackIds?: number[] };
const frame = z.object({ x: z.number().finite(), y: z.number().finite(), width: z.number().positive().finite(), height: z.number().positive().finite() });
const react = z.object({ component: z.string().max(256), owners: z.array(z.string().max(256)).max(12), source: z.object({ file: z.string().max(2048), line: z.number().int().positive(), column: z.number().int().positive().optional(), functionName: z.string().max(256).optional() }).optional() });
const node: z.ZodType<InspectorNode> = z.lazy(() => z.object({ source: z.literal("react-native"), role: z.string().max(256), label: z.string().max(256).optional(), identifier: z.string().max(256).optional(), frame, nodeId: z.string().max(256).optional(), parentId: z.string().max(256).optional(), depth: z.number().int().min(0).max(10000).optional(), children: z.array(node).max(3000).default([]), react: react.optional(), creationStackIds: z.array(z.number().int().min(0).max(511)).max(12).optional() }));
const creationFrame = z.object({ url: z.number().int().min(0).max(31), line: z.number().int().positive(), column: z.number().int().nonnegative(), methodName: z.string().max(256) });
const snapshot = z.object({ available: z.boolean(), tree: z.array(node).max(3000).optional(), windowWidth: z.number().nonnegative().finite().optional(), truncated: z.boolean().optional(), sourceUrls: z.array(z.string().max(2048)).max(32).default([]), sourceStacks: z.array(z.array(creationFrame).max(3)).max(512).default([]) });
export type InspectorRequest = { url?: string; targetId?: string; deviceName: string; deviceAliases?: string[]; appName?: string; appId?: string; platform: "ios" | "android"; screenWidth: number };
const normalized = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

export async function inspectReactNative(request: InspectorRequest, signal?: AbortSignal) {
  const targets = await metroTargets(request.url ?? "http://127.0.0.1:8081", signal);
  const matches = targets.filter(target => {
    if (request.targetId) return target.id === request.targetId;
    if (!target.deviceName || ![request.deviceName, ...(request.deviceAliases ?? [])].some(name => normalized(target.deviceName!) === normalized(name))) return false;
    if (request.appId) return target.appId === request.appId;
    // Never pick another app merely because it has an inspector on this device.
    const app = normalized(request.appName ?? "");
    return !!app && !!target.appId && normalized(target.appId.split(".").at(-1)!) === app;
  });
  if (matches.length !== 1) return { available: false as const, reason: matches.length > 1 ? "ambiguous-target" : "no-matching-target" };
  const target = matches[0];
  if (!target.supportsMultipleDebuggers) return { available: false as const, reason: "exclusive-debugger" };
  const raw = await readSnapshot(target.webSocketDebuggerUrl, signal);
  // Bound recursion before parsing data supplied by the app's runtime.
  const stack: { value: unknown; depth: number }[] = [{ value: raw, depth: 0 }];
  let count = 0;
  while (stack.length) {
    const { value, depth } = stack.pop()!;
    if (++count > 20000 || depth > 330) throw new Error("React Native returned an oversized component tree.");
    if (value && typeof value === "object") for (const child of Object.values(value)) if (child && typeof child === "object") stack.push({ value: child, depth: depth + 1 });
  }
  const result = snapshot.parse(raw);
  if (!result.available || !result.tree || !result.windowWidth) return { available: false as const, reason: "unsupported-renderer" };
  try { await resolveReactNativeSources(result.tree, result.sourceUrls, result.sourceStacks, request.url ?? "http://127.0.0.1:8081", signal); }
  catch { if (!signal?.aborted) captureServerError(new Error("React Native source map lookup failed."), "inspection.symbolicate"); }
  // RN measurements use DIPs; Android screenshots and AX bounds use physical pixels.
  const scale = request.platform === "android" ? request.screenWidth / result.windowWidth : 1;
  const scaleNode = ({ creationStackIds, ...item }: InspectorNode): InspectorNode => ({ ...item, frame: {
    x: item.frame.x * scale, y: item.frame.y * scale, width: item.frame.width * scale, height: item.frame.height * scale,
  }, children: item.children.map(scaleNode) });
  return { available: true as const, tree: result.tree.map(scaleNode), truncated: !!result.truncated };
}

export function readSnapshot(url: string, signal?: AbortSignal): Promise<unknown> {
  if (signal?.aborted) return Promise.reject(new Error("Component inspection cancelled."));
  return new Promise((resolve, reject) => {
    const origin = new URL(url); origin.protocol = "http:";
    const binding = `__mobile_dev_inspection_${randomUUID().replaceAll("-", "")}`;
    const socket = new WebSocket(url, { origin: origin.origin, handshakeTimeout: 3000, maxPayload: 1024 * 1024, followRedirects: false });
    let settled = false, cleanup: (() => void) | undefined;
    const finish = (error?: Error, result?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer); signal?.removeEventListener("abort", abort);
      let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
      cleanup = () => {
        if (!cleanup) return;
        cleanup = undefined;
        clearTimeout(cleanupTimer);
        if (socket.readyState === WebSocket.OPEN) socket.close(); else socket.terminate();
        if (error) reject(error); else resolve(result);
      };
      if (socket.readyState !== WebSocket.OPEN) { cleanup(); return; }
      // Remove both the session binding and its temporary global function.
      socket.send(JSON.stringify({ id: 3, method: "Runtime.removeBinding", params: { name: binding } }));
      socket.send(JSON.stringify({ id: 4, method: "Runtime.evaluate", params: { expression: `delete globalThis[${JSON.stringify(binding)}]`, silent: true } }));
      cleanupTimer = setTimeout(() => cleanup?.(), 300);
    };
    const abort = () => finish(new Error("Component inspection cancelled."));
    const timer = setTimeout(() => finish(new Error("React Native component inspection timed out.")), 5000);
    signal?.addEventListener("abort", abort, { once: true });
    socket.once("open", () => {
      if (signal?.aborted) { abort(); return; }
      socket.send(JSON.stringify({ id: 1, method: "Runtime.addBinding", params: { name: binding } }));
    });
    socket.on("message", bytes => {
      try {
        const message = JSON.parse(bytes.toString());
        if (settled) { if (message.id === 4) cleanup?.(); return; }
        if (message.id === 1) {
          if (message.error) { finish(new Error("React Native does not support inspection bindings.")); return; }
          socket.send(JSON.stringify({ id: 2, method: "Runtime.evaluate", params: {
            expression: `(${collectReactNativeTree.toString()})(result => globalThis[${JSON.stringify(binding)}](JSON.stringify(result)))`, returnByValue: true, silent: true,
          } }));
        } else if (message.id === 2 && (message.error || message.result?.exceptionDetails)) {
          finish(new Error("The React Native renderer could not provide component bounds."));
        } else if (message.method === "Runtime.bindingCalled" && message.params?.name === binding) {
          finish(undefined, JSON.parse(message.params.payload));
        }
      } catch { finish(new Error("React Native returned an invalid inspector response.")); }
    });
    socket.once("error", () => { if (settled) cleanup?.(); else finish(new Error("Cannot connect to the selected React Native debugger.")); });
    socket.once("close", () => { if (settled) cleanup?.(); else finish(new Error("React Native closed component inspection.")); });
  });
}
