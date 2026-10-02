import type { AccessibilitySnapshot } from "../accessibility.ts";
import type { DeviceSessionManager } from "../device-session-context.ts";
import type { Gesture } from "../input.ts";
import type { JsonResponseTracker } from "../json-response.ts";
import type { GeoFix } from "../location.ts";
import type { DeviceContext, DeviceGridResponse, WsData } from "../server.ts";

/** Session-bound services consumed by the production HTTP routes. */
export type ApiDependencies = {
  requestContext: DeviceContext;
  runForPublishedContext: <T>(
    context: DeviceContext,
    operation: (captured: DeviceContext) => Promise<T>,
  ) => Promise<T>;
  listDevices: (
    runExec?: typeof import("../exec.ts").execText,
  ) => Promise<import("../adb.ts").Device[]>;
  errorResponse: (err: unknown, fallbackStatus?: number) => Response;
  deviceGrid: (context: DeviceContext) => Promise<DeviceGridResponse>;
  readJsonBody: (
    req: Request,
    maxBytes?: number,
    context?: DeviceContext,
    requireUsableContext?: boolean,
  ) => Promise<unknown>;
  MAX_JSON_BODY_BYTES: number;
  switchSession: (
    serial: string,
  ) => Promise<{
    ok: boolean;
    serial: string;
    generation: number;
    device: string;
  }>;
  launchEmulator: (
    opts: import("../emulator.ts").StartEmulatorOpts,
    dependencies?: import("../emulator.ts").EmulatorRuntimeDependencies,
  ) => Promise<import("../emulator.ts").EmulatorLaunch>;
  sessions: DeviceSessionManager<DeviceContext>;
  listActiveAvds: (
    devices?: readonly import("../adb.ts").Device[],
    dependencies?: Pick<
      import("../emulator.ts").EmulatorRuntimeDependencies,
      "execText" | "listAllDevices"
    >,
  ) => Promise<import("../emulator.ts").RunningAvd[]>;
  stopCurrentSession: (context: DeviceContext, reason: string) => Promise<void>;
  killEmulator: (
    serial: string,
    runExec?: typeof import("../exec.ts").execText,
  ) => Promise<void>;
  runForContext: <T>(
    context: DeviceContext,
    operation: (captured: DeviceContext) => Promise<T>,
  ) => Promise<T>;
  srv: Bun.Server<WsData>;
  logcatStream: (context: DeviceContext, req: Request, url: URL) => Response;
  readAccessibilitySnapshot: (
    context: DeviceContext,
    cacheMs?: number,
  ) => Promise<AccessibilitySnapshot>;
  accessibilityTapEndpoint: (
    context: DeviceContext,
    req: Request,
  ) => Promise<Response>;
  gestureEndpoint: (
    context: DeviceContext,
    req: Request,
    type: Gesture["type"],
    source: string,
  ) => Promise<Response>;
  keyEndpoint: (context: DeviceContext, req: Request) => Promise<Response>;
  responseMetrics: JsonResponseTracker<
    "health" | "sessionPage" | "sessionExport"
  >;
  enqueueGesture: (
    context: DeviceContext,
    gesture: Gesture,
    source: string,
    record?: boolean,
  ) => import("../control-input-queue.ts").ControlInputHandle;
  setLocation: (
    serial: string,
    fix: GeoFix,
    signal: AbortSignal,
  ) => Promise<void>;
  installEndpoint: (context: DeviceContext, req: Request) => Promise<Response>;
  fileImportEndpoint: (
    context: DeviceContext,
    req: Request,
  ) => Promise<Response>;
  appJsonEndpoint: (
    context: DeviceContext,
    req: Request,
    action: (payload: Record<string, unknown>) => unknown | Promise<unknown>,
  ) => Promise<Response>;
  applyLocation: (
    context: DeviceContext,
    fix: GeoFix,
    source: string,
    record?: boolean,
  ) => Promise<GeoFix & { appliedAt: string }>;
  MAX_ROUTE_BODY_BYTES: number;
};
