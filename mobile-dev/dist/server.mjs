
!function(){try{var e="undefined"!=typeof window?window:"undefined"!=typeof global?global:"undefined"!=typeof globalThis?globalThis:"undefined"!=typeof self?self:{},n=(new e.Error).stack;n&&(e._sentryDebugIds=e._sentryDebugIds||{},e._sentryDebugIds[n]="2273c02e-4ed0-581a-b757-57804fe1dd20")}catch(e){}}();
;(function(){var g=globalThis.__SENTRY_ORCHESTRION__=globalThis.__SENTRY_ORCHESTRION__||{};g.bundler=g.bundler||new Set();})();import { createRequire as mobileDevBundleRequire } from 'node:module'; const require = mobileDevBundleRequire(import.meta.url);
import {
  SENTRY_RELEASE,
  SENTRY_SERVER_DSN,
  TELEMETRY_ENVIRONMENT,
  createErrorEventFilter,
  getIsolationScope,
  getTelemetryIdentity,
  init,
  nodeRuntimeMetricsIntegration,
  sampleMetric,
  sampleTrace,
  scrubSpan,
  setAttribute,
  setTag,
  tagInstallIntegrity
} from "./chunk-UKBMU5DX.mjs";
import "./chunk-HEGITGOM.mjs";

// packages/core/src/instrument.ts
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
var identity = getTelemetryIdentity();
if (identity) {
  process.env.MOBILE_DEV_NATIVE_USER_ID = identity.userId;
  process.env.MOBILE_DEV_NATIVE_SESSION_ID = identity.sessionId;
} else {
  delete process.env.MOBILE_DEV_NATIVE_USER_ID;
  delete process.env.MOBILE_DEV_NATIVE_SESSION_ID;
}
process.env.MOBILE_DEV_NATIVE_RELEASE = SENTRY_RELEASE;
process.env.MOBILE_DEV_NATIVE_ENVIRONMENT = TELEMETRY_ENVIRONMENT;
var nativeHome = homedir();
var nativeCache = join(nativeHome, "Library/Caches/mobile-dev/sentry");
if (process.env.MOBILE_DEV_TELEMETRY !== "off") mkdirSync(nativeCache, { recursive: true, mode: 448 });
process.env.MOBILE_DEV_NATIVE_CACHE = nativeCache;
var client = init({
  dsn: SENTRY_SERVER_DSN,
  release: SENTRY_RELEASE,
  environment: TELEMETRY_ENVIRONMENT,
  enabled: process.env.MOBILE_DEV_TELEMETRY !== "off",
  initialScope: identity ? { user: { id: identity.userId }, tags: { telemetry_session: identity.sessionId } } : void 0,
  dataCollection: { userInfo: false, genAI: { inputs: false, outputs: false } },
  integrations: (defaults) => {
    const selected = defaults.filter((integration) => ["Console", "LocalVariables", "LocalVariablesAsync", "ContextLines", "ChildProcess"].includes(integration.name) === false);
    const runtimeMetrics = nodeRuntimeMetricsIntegration({ collect: { memExternal: true } });
    selected.push(runtimeMetrics);
    return selected;
  },
  tracesSampler: (context) => sampleTrace(context.name, context.inheritOrSampleWith),
  beforeSend: createErrorEventFilter(),
  beforeSendSpan: scrubSpan,
  beforeSendMetric: sampleMetric,
  beforeBreadcrumb: (breadcrumb) => breadcrumb.category === "mobile-dev" ? breadcrumb : null
});
client?.addEventProcessor(tagInstallIntegrity);
var executable = process.argv[1] ?? "";
var mirrorService = executable.endsWith("ios-mirror-service.mjs") || executable.endsWith("ios-mirror-service.ts");
var component = mirrorService ? "ios-mirror-service" : "server";
setTag("component", component);
setAttribute("component", component);
var host = process.env.MOBILE_DEV_HOST === "mac" ? "mac" : "other";
setTag("host", host);
setAttribute("host", host);
client?.on("spanStart", (span) => {
  const scope = getIsolationScope();
  const data = scope.getScopeData();
  for (const [key, value] of Object.entries(data.attributes)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") span.setAttribute(key, value);
  }
});

// apps/claude/server/index.ts
await import("./server-DKYOGSKQ.mjs");

//# debugId=2273c02e-4ed0-581a-b757-57804fe1dd20
