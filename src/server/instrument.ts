import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import * as Sentry from "@sentry/node";
import { SENTRY_RELEASE, SENTRY_SERVER_DSN, sampleTrace, scrubErrorEvent, scrubMetric, scrubSpan } from "../shared/telemetry.ts";
import { TELEMETRY_ENVIRONMENT } from "./telemetry-environment.ts";

process.env.MOBILE_DEV_NATIVE_RELEASE = SENTRY_RELEASE;
process.env.MOBILE_DEV_NATIVE_ENVIRONMENT = TELEMETRY_ENVIRONMENT;
const nativeHome = homedir();
const nativeCache = join(nativeHome, "Library/Caches/mobile-dev/sentry");
if (process.env.MOBILE_DEV_TELEMETRY !== "off") mkdirSync(nativeCache, { recursive: true, mode: 0o700 });
process.env.MOBILE_DEV_NATIVE_CACHE = nativeCache;

const client = Sentry.init({
  dsn: SENTRY_SERVER_DSN,
  release: SENTRY_RELEASE,
  environment: TELEMETRY_ENVIRONMENT,
  enabled: process.env.MOBILE_DEV_TELEMETRY !== "off",
  dataCollection: { userInfo: false, genAI: { inputs: false, outputs: false } },
  integrations: defaults => {
    const selected = defaults.filter(integration => ["Console", "LocalVariables", "LocalVariablesAsync", "ContextLines", "ChildProcess"].includes(integration.name) === false);
    const runtimeMetrics = Sentry.nodeRuntimeMetricsIntegration({ collect: { memExternal: true } });
    selected.push(runtimeMetrics);
    return selected;
  },
  tracesSampler: context => sampleTrace(context.name, context.inheritOrSampleWith),
  beforeSend: scrubErrorEvent,
  beforeSendSpan: scrubSpan,
  beforeSendMetric: scrubMetric,
  beforeBreadcrumb: breadcrumb => breadcrumb.category === "mobile-dev" ? breadcrumb : null,
});
const component = process.argv[1]?.endsWith("agent-device-server.mjs") ? "agent-device-wrapper" : "server";
Sentry.setTag("component", component);
Sentry.setAttribute("component", component);
client?.on("spanStart", span => {
  const scope = Sentry.getIsolationScope();
  const data = scope.getScopeData();
  for (const [key, value] of Object.entries(data.attributes)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") span.setAttribute(key, value);
  }
});
