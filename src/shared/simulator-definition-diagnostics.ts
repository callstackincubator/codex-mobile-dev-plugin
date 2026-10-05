import { z } from "zod";
import baguetteRelease from "../../vendor/baguette-release.json" with { type: "json" };

const stages = z.enum(["simulator_lookup", "profile_read", "profile_parse", "profile_chrome_identifier", "panel_lookup", "chrome_lookup", "chrome_read",
  "chrome_parse", "composite_read", "composite_layout", "composite_rasterize", "screen_geometry",
  "slice_read", "slice_rasterize", "assembly", "response"]);
const failures = z.enum(["missing", "permission_denied", "unreadable", "invalid", "unsupported", "failed", "unavailable", "unclassified"]);
const states = z.enum(["Creating", "Shutdown", "Booting", "Booted", "ShuttingDown", "missing", "unreachable", "unknown"]);
const version = /^\d{1,2}(?:\.\d{1,2}){0,2}$/;
const runtime = /^(iOS|tvOS|watchOS|visionOS) \d{1,2}\.\d{1,2}(?:\.\d{1,2})?$/;

// Only public device-type names are accepted; simulator names never enter telemetry.
const modelNames = new Set([
  "Apple TV",
  "Apple TV 4K",
  "Apple TV 4K (2nd generation)",
  "Apple TV 4K (2nd generation) (at 1080p)",
  "Apple TV 4K (3rd generation)",
  "Apple TV 4K (3rd generation) (at 1080p)",
  "Apple TV 4K (at 1080p)",
  "Apple Vision Pro",
  "Apple Vision Pro (at 2732x2048)",
  "Apple Watch SE (40mm)",
  "Apple Watch SE (40mm) (2nd generation)",
  "Apple Watch SE (44mm)",
  "Apple Watch SE (44mm) (2nd generation)",
  "Apple Watch SE 3 (40mm)",
  "Apple Watch SE 3 (44mm)",
  "Apple Watch Series 10 (42mm)",
  "Apple Watch Series 10 (46mm)",
  "Apple Watch Series 11 (42mm)",
  "Apple Watch Series 11 (46mm)",
  "Apple Watch Series 12 (42mm)",
  "Apple Watch Series 12 (46mm)",
  "Apple Watch Series 2 (38mm)",
  "Apple Watch Series 2 (42mm)",
  "Apple Watch Series 3 (38mm)",
  "Apple Watch Series 3 (42mm)",
  "Apple Watch Series 4 (40mm)",
  "Apple Watch Series 4 (44mm)",
  "Apple Watch Series 5 (40mm)",
  "Apple Watch Series 5 (44mm)",
  "Apple Watch Series 6 (40mm)",
  "Apple Watch Series 6 (44mm)",
  "Apple Watch Series 7 (41mm)",
  "Apple Watch Series 7 (45mm)",
  "Apple Watch Series 8 (41mm)",
  "Apple Watch Series 8 (45mm)",
  "Apple Watch Series 9 (41mm)",
  "Apple Watch Series 9 (45mm)",
  "Apple Watch Ultra (49mm)",
  "Apple Watch Ultra 2 (49mm)",
  "Apple Watch Ultra 3 (49mm)",
  "Apple Watch Ultra 4 (49mm)",
  "iPad (10th generation)",
  "iPad (5th generation)",
  "iPad (6th generation)",
  "iPad (7th generation)",
  "iPad (8th generation)",
  "iPad (9th generation)",
  "iPad (A16)",
  "iPad Air (3rd generation)",
  "iPad Air (4th generation)",
  "iPad Air (5th generation)",
  "iPad Air 11-inch (M2)",
  "iPad Air 11-inch (M3)",
  "iPad Air 11-inch (M4)",
  "iPad Air 13-inch (M2)",
  "iPad Air 13-inch (M3)",
  "iPad Air 13-inch (M4)",
  "iPad Air 2",
  "iPad Pro (10.5-inch)",
  "iPad Pro (11-inch) (1st generation)",
  "iPad Pro (11-inch) (2nd generation)",
  "iPad Pro (11-inch) (3rd generation)",
  "iPad Pro (11-inch) (4th generation)",
  "iPad Pro (11-inch) (4th generation) (16GB)",
  "iPad Pro (12.9-inch) (1st generation)",
  "iPad Pro (12.9-inch) (2nd generation)",
  "iPad Pro (12.9-inch) (3rd generation)",
  "iPad Pro (12.9-inch) (4th generation)",
  "iPad Pro (12.9-inch) (5th generation)",
  "iPad Pro (12.9-inch) (6th generation)",
  "iPad Pro (12.9-inch) (6th generation) (16GB)",
  "iPad Pro (9.7-inch)",
  "iPad Pro 11-inch (M4)",
  "iPad Pro 11-inch (M4) (16GB)",
  "iPad Pro 11-inch (M5)",
  "iPad Pro 11-inch (M5) (16GB)",
  "iPad Pro 13-inch (M4)",
  "iPad Pro 13-inch (M4) (16GB)",
  "iPad Pro 13-inch (M5)",
  "iPad Pro 13-inch (M5) (16GB)",
  "iPad mini (5th generation)",
  "iPad mini (6th generation)",
  "iPad mini (A17 Pro)",
  "iPad mini 4",
  "iPhone 11",
  "iPhone 11 Pro",
  "iPhone 11 Pro Max",
  "iPhone 12",
  "iPhone 12 Pro",
  "iPhone 12 Pro Max",
  "iPhone 12 mini",
  "iPhone 13",
  "iPhone 13 Pro",
  "iPhone 13 Pro Max",
  "iPhone 13 mini",
  "iPhone 14",
  "iPhone 14 Plus",
  "iPhone 14 Pro",
  "iPhone 14 Pro Max",
  "iPhone 15",
  "iPhone 15 Plus",
  "iPhone 15 Pro",
  "iPhone 15 Pro Max",
  "iPhone 16",
  "iPhone 16 Plus",
  "iPhone 16 Pro",
  "iPhone 16 Pro Max",
  "iPhone 16e",
  "iPhone 17",
  "iPhone 17 Pro",
  "iPhone 17 Pro Max",
  "iPhone 17e",
  "iPhone 18 Pro",
  "iPhone 18 Pro Max",
  "iPhone 6s",
  "iPhone 6s Plus",
  "iPhone 7",
  "iPhone 7 Plus",
  "iPhone 8",
  "iPhone 8 Plus",
  "iPhone Air",
  "iPhone SE (1st generation)",
  "iPhone SE (2nd generation)",
  "iPhone SE (3rd generation)",
  "iPhone X",
  "iPhone Xs",
  "iPhone Xs Max",
  "iPhone X\u0280",
  "iPod touch (7th generation)",
  "iPhone Duo",
]);

function publicModel(value: unknown): string {
  if (typeof value === "string" && modelNames.has(value)) return value;
  return "unknown";
}

function numericVersion(value: unknown): string {
  if (typeof value === "string" && version.test(value)) return value;
  return "unknown";
}

export type DefinitionDiagnostic = {
  stage: z.infer<typeof stages>;
  failure: z.infer<typeof failures>;
  model: string;
  runtime: string;
  state: z.infer<typeof states>;
  panel: "primary" | "secondary" | "unknown";
  xcodeVersion: string;
  backendVersion: string;
  backendSource: "pinned" | "unknown";
  deviceBefore: z.infer<typeof states>;
  deviceAfter: z.infer<typeof states>;
  backendMode: "embedded" | "external";
  cachedFailure: "true" | "false" | "unknown";
};

const diagnostics = new WeakMap<object, DefinitionDiagnostic>();

export function parseDefinitionDiagnostic(payload: unknown): DefinitionDiagnostic {
  const diagnostic: DefinitionDiagnostic = {
    stage: "response", failure: "unclassified", model: "unknown", runtime: "unknown", state: "unknown",
    panel: "unknown", xcodeVersion: "unknown", backendVersion: "unknown", backendSource: "unknown",
    deviceBefore: "unknown", deviceAfter: "unknown", backendMode: "external", cachedFailure: "unknown",
  };
  if (payload === null || typeof payload !== "object" || !("definition_diagnostic" in payload)) return diagnostic;
  const candidate = payload.definition_diagnostic;
  if (candidate === null || typeof candidate !== "object" || !("schema" in candidate) || candidate.schema !== "1") return diagnostic;
  if ("stage" in candidate) {
    const parsed = stages.safeParse(candidate.stage);
    if (parsed.success) diagnostic.stage = parsed.data;
  }
  if ("failure" in candidate) {
    const parsed = failures.safeParse(candidate.failure);
    if (parsed.success) diagnostic.failure = parsed.data;
  }
  if ("cached_failure" in candidate && (candidate.cached_failure === "true" || candidate.cached_failure === "false")) diagnostic.cachedFailure = candidate.cached_failure;
  if ("model" in candidate) diagnostic.model = publicModel(candidate.model);
  if ("runtime" in candidate && typeof candidate.runtime === "string" && runtime.test(candidate.runtime)) diagnostic.runtime = candidate.runtime;
  if ("state" in candidate) {
    const parsed = states.safeParse(candidate.state);
    if (parsed.success) diagnostic.state = parsed.data;
  }
  if ("panel" in candidate && (candidate.panel === "primary" || candidate.panel === "secondary")) diagnostic.panel = candidate.panel;
  if ("xcode_version" in candidate) diagnostic.xcodeVersion = numericVersion(candidate.xcode_version);
  if ("backend_version" in candidate && candidate.backend_version === baguetteRelease.version) diagnostic.backendVersion = baguetteRelease.version;
  if ("backend_source" in candidate && candidate.backend_source === baguetteRelease.rebuild.sourceCommit) diagnostic.backendSource = "pinned";
  return diagnostic;
}

export function definitionDeviceState(value: unknown): DefinitionDiagnostic["state"] {
  const parsed = states.safeParse(value);
  return parsed.success ? parsed.data : "unknown";
}

export function setDefinitionDiagnostic(error: object, diagnostic: DefinitionDiagnostic) {
  diagnostics.set(error, diagnostic);
}

export function getDefinitionDiagnostic(error: unknown): DefinitionDiagnostic | undefined {
  if (error === null || typeof error !== "object") return;
  return diagnostics.get(error);
}

export function definitionDiagnosticTags(error: unknown): Record<string, string> {
  const diagnostic = getDefinitionDiagnostic(error);
  if (diagnostic === undefined) return {};
  return {
    definition_stage: diagnostic.stage, definition_failure: diagnostic.failure,
    definition_model: diagnostic.model, definition_runtime: diagnostic.runtime,
    definition_device_state: diagnostic.state, definition_device_before: diagnostic.deviceBefore, definition_device_after: diagnostic.deviceAfter,
    definition_panel: diagnostic.panel, definition_xcode_version: diagnostic.xcodeVersion,
    definition_backend_version: diagnostic.backendVersion, definition_backend_source: diagnostic.backendSource,
    definition_backend_mode: diagnostic.backendMode, definition_cached_failure: diagnostic.cachedFailure,
  };
}
