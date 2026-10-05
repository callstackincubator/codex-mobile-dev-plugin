import { z } from "zod";
import { errorMessage } from "./protocol.ts";
import { getDiscoveryCommandDiagnostic, discoveryCommandTags } from "./device-apps-command-diagnostics.ts";

export const DEVICE_APPS_DIAGNOSTIC_META = "mobile-dev/device-apps-diagnostic";

const stage = z.enum(["device_validation", "running_apps", "foreground", "discovery", "transport", "response"]);
const failure = z.enum(["missing_executable", "timeout", "command_failed", "invalid_response", "cancelled", "unknown"]);
const platform = z.enum(["ios", "android"]);
const kind = z.enum(["physical", "simulator", "unknown"]);
const diagnosticObject = z.object({ stage, failure, platform, kind });
export const deviceAppsDiagnosticSchema = diagnosticObject.strict();
export type DeviceAppsDiagnostic = z.infer<typeof deviceAppsDiagnosticSchema>;
export type DeviceAppsStage = DeviceAppsDiagnostic["stage"];

const diagnostics = new WeakMap<object, DeviceAppsDiagnostic>();

function classifyFailure(error: unknown): DeviceAppsDiagnostic["failure"] {
  if (error === null || typeof error !== "object") return "unknown";
  const command = getDiscoveryCommandDiagnostic(error);
  if (command?.cause === "cancelled") return "cancelled";
  if (command?.termination === "deadline" || command?.cause.endsWith("_timeout")) return "timeout";
  if (command?.termination === "output_limit") return "command_failed";
  if ("name" in error && error.name === "AbortError") return "cancelled";
  if ("code" in error && error.code === "ENOENT") return "missing_executable";
  if ("code" in error && (error.code === "ETIMEDOUT" || error.code === -32001)) return "timeout";
  if ("name" in error && error.name === "TimeoutError") return "timeout";
  if ("killed" in error && error.killed === true) return "timeout";
  if ("name" in error && (error.name === "ZodError" || error.name === "SyntaxError")) return "invalid_response";
  if ("code" in error && typeof error.code === "number" && error.code > 0) return "command_failed";
  if ("signal" in error && typeof error.signal === "string") return "command_failed";
  return "unknown";
}

export function deviceAppsDiagnostic(error: unknown, stage: DeviceAppsStage,
  platform: DeviceAppsDiagnostic["platform"], kind?: string): DeviceAppsDiagnostic {
  const failure = classifyFailure(error);
  let deviceKind: DeviceAppsDiagnostic["kind"] = "unknown";
  if (platform === "ios") deviceKind = kind === "physical" ? "physical" : "simulator";
  return { stage, failure, platform, kind: deviceKind };
}

export function setDeviceAppsDiagnostic(error: object, diagnostic: DeviceAppsDiagnostic) {
  diagnostics.set(error, diagnostic);
}

export function getDeviceAppsDiagnostic(error: unknown): DeviceAppsDiagnostic | undefined {
  if (error === null || typeof error !== "object") return;
  return diagnostics.get(error);
}

export function deviceAppsDiagnosticTags(error: unknown): Record<string, string> {
  const diagnostic = getDeviceAppsDiagnostic(error);
  const commandTags = discoveryCommandTags(error);
  if (diagnostic === undefined) return commandTags;
  return { ...commandTags, discovery_stage: diagnostic.stage, discovery_failure: diagnostic.failure,
    device_platform: diagnostic.platform, device_kind: diagnostic.kind };
}

export function annotateDeviceAppsError(error: unknown, stage: DeviceAppsStage,
  platform: DeviceAppsDiagnostic["platform"], kind?: string): unknown {
  const previous = getDeviceAppsDiagnostic(error);
  if (previous) return error;
  let annotated: object;
  if (error !== null && typeof error === "object") annotated = error;
  else {
    const message = errorMessage(error);
    annotated = new Error(message);
  }
  const diagnostic = deviceAppsDiagnostic(error, stage, platform, kind);
  setDeviceAppsDiagnostic(annotated, diagnostic);
  return annotated;
}

export async function withDeviceAppsDiagnostic<T>(operation: () => Promise<T>, stage: DeviceAppsStage,
  platform: DeviceAppsDiagnostic["platform"], kind?: string): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const annotated = annotateDeviceAppsError(error, stage, platform, kind);
    throw annotated;
  }
}
