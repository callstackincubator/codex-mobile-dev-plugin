import { z } from "zod";
import { getDiscoveryCommandDiagnostic } from "./device-apps-command-diagnostics.ts";
import { classifyProcessFailure, errorDiagnostics, setErrorDiagnostic } from "./error-diagnostics.ts";
import { errorMessage } from "./error-reporting.ts";

export const DEVICE_APPS_DIAGNOSTIC_META = "mobile-dev/device-apps-diagnostic";

const stage = z.enum(["device_validation", "running_apps", "foreground", "discovery", "transport", "response"]);
const failure = z.enum(["missing_executable", "timeout", "command_failed", "invalid_response", "cancelled", "unknown"]);
const platform = z.enum(["ios", "android"]);
const kind = z.enum(["physical", "simulator", "unknown"]);
const diagnosticObject = z.object({ stage, failure, platform, kind });
export const deviceAppsDiagnosticSchema = diagnosticObject.strict();
export type DeviceAppsDiagnostic = z.infer<typeof deviceAppsDiagnosticSchema>;
export type DeviceAppsStage = DeviceAppsDiagnostic["stage"];

function classifyFailure(error: unknown): DeviceAppsDiagnostic["failure"] {
  if (error === null || typeof error !== "object") return "unknown";
  const command = getDiscoveryCommandDiagnostic(error);
  if (command?.cause === "cancelled") return "cancelled";
  if (command?.termination === "deadline" || command?.cause.endsWith("_timeout")) return "timeout";
  if (command?.termination === "output_limit") return "command_failed";
  // A cancelled request is cancelled whatever code it carries; -32001 is an MCP request that timed out.
  if ("name" in error && error.name === "AbortError") return "cancelled";
  const { termination, status } = classifyProcessFailure(error);
  if (status === -32001) return "timeout";
  if (termination === "deadline") return "timeout";
  if (termination === "cancelled" || termination === "missing_executable" || termination === "invalid_response") return termination;
  if (termination === "signal" || termination === "exit" && status !== undefined && status > 0) return "command_failed";
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
  setErrorDiagnostic(error, "deviceApps", diagnostic);
}

export function getDeviceAppsDiagnostic(error: unknown): DeviceAppsDiagnostic | undefined {
  return errorDiagnostics(error).deviceApps;
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
