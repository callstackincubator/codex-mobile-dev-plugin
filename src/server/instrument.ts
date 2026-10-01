import { existsSync, readFileSync, statSync } from "node:fs";
import * as Sentry from "@sentry/node";
import { SENTRY_RELEASE, SENTRY_SERVER_DSN, sampleTrace, scrubErrorEvent, scrubMetric, scrubSpan } from "../shared/telemetry.ts";
import type { TelemetryEnvironment } from "../shared/telemetry.ts";

function environment(): TelemetryEnvironment {
  const override = process.env.MOBILE_DEV_ENVIRONMENT;
  if (override !== undefined && override !== "development" && override !== "release") {
    throw new Error("MOBILE_DEV_ENVIRONMENT must be development or release.");
  }
  if (override !== undefined) return override;
  const configUrl = new URL("../ui-dev.json", import.meta.url);
  if (existsSync(configUrl)) {
    const configText = readFileSync(configUrl, "utf8");
    const config = JSON.parse(configText);
    if (config.mode === "mcp-live" && typeof config.projectRoot === "string") {
      const heartbeatPath = `${config.projectRoot}/.local-dev/ui-watch.json`;
      if (existsSync(heartbeatPath)) {
        const heartbeat = statSync(heartbeatPath);
        if (Date.now() - heartbeat.mtimeMs < 10_000) return "development";
      }
    }
  }
  return "release";
}

const client = Sentry.init({
  dsn: SENTRY_SERVER_DSN,
  release: SENTRY_RELEASE,
  environment: environment(),
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
