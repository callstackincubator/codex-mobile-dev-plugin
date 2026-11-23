import { randomUUID } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { CallToolRequest, CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { PLUGIN_VERSION } from "@mobile-dev/shared/version.ts";
import { isFrequentTool, MIXPANEL_TOKEN, MIXPANEL_TRACK_URL, MIXPANEL_ENGAGE_URL, TELEMETRY_INTERVAL_MS } from "@mobile-dev/shared/telemetry.ts";
import type { TelemetryEnvironment, TelemetryHost } from "@mobile-dev/shared/telemetry.ts";
import { TELEMETRY_ENVIRONMENT } from "./telemetry-environment.ts";
import { getTelemetryIdentity } from "./telemetry-identity.ts";
import { recordAnalyticsFlush, serverTelemetryHost } from "./telemetry.ts";

// Mixpanel takes at most 50 events per request; the queue stays bounded while it is unreachable.
const BATCH_SIZE = 50;
const MAX_QUEUED = 500;

type AnalyticsEvent = { event: string; properties: Record<string, string | number> };
type AnalyticsProfile = { $token: string; $distinct_id: string; $ip: "0"; $set: Record<string, string> };
type Send = (url: string, init: RequestInit) => Promise<Response>;

/** Services analytics uses; tests replace them. */
export type AnalyticsOptions = { token?: string; environment?: TelemetryEnvironment; userId?: string; send?: Send };

export type ProductAnalytics = {
  /** Counts a connected host session, which gives active installations per host. */
  sessionStarted(clientName: string | undefined): void;
  /** Sends what is queued and stops sending. */
  close(): Promise<void>;
};

const disabled: ProductAnalytics = { sessionStarted() {}, async close() {} };

// The SDK's generic handler schema type does not overlap its own exported schemas, so compare untyped.
function isCallTool(schema: unknown) {
  return schema === CallToolRequestSchema;
}

function optedOut() {
  return process.env.MOBILE_DEV_TELEMETRY === "off" || process.env.MOBILE_DEV_ANALYTICS === "off" || process.env.DO_NOT_TRACK === "1";
}

async function deliver(send: Send, url: string, batch: AnalyticsEvent[] | AnalyticsProfile[]): Promise<"success" | "failed"> {
  try {
    const body = JSON.stringify(batch);
    const signal = AbortSignal.timeout(5000);
    const response = await send(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body,
      signal,
    });
    const reply: { status?: number } = await response.json();
    return response.ok && reply.status === 1 ? "success" : "failed";
  } catch { return "failed"; }
}

/**
 * Sends pseudonymous product analytics to Mixpanel from release servers: connected host sessions and
 * the tools they call, plus an installation profile with its host, plugin version and OS. Never sends
 * arguments, results, device details, paths or IP properties. Install before tools register.
 */
export function instrumentProductAnalytics(server: McpServer, options: AnalyticsOptions = {}): ProductAnalytics {
  const { token = MIXPANEL_TOKEN, environment = TELEMETRY_ENVIRONMENT, userId = getTelemetryIdentity()?.userId, send = fetch } = options;
  if (token === "" || environment !== "release" || userId === undefined || optedOut()) return disabled;
  const distinctId = userId;
  const queue: AnalyticsEvent[] = [];
  let host: TelemetryHost = "other";
  let pendingProfile: AnalyticsProfile | undefined;
  let sending: Promise<void> | undefined;
  let closed = false;

  async function drain() {
    const profile = pendingProfile;
    if (profile !== undefined) {
      const outcome = await deliver(send, MIXPANEL_ENGAGE_URL, [profile]);
      recordAnalyticsFlush(outcome, "engage");
      if (outcome === "success" && pendingProfile === profile) pendingProfile = undefined;
    }
    while (queue.length > 0) {
      const batch = queue.splice(0, BATCH_SIZE);
      const outcome = await deliver(send, MIXPANEL_TRACK_URL, batch);
      recordAnalyticsFlush(outcome, "track");
    }
  }
  function flush() {
    sending ??= drain().finally(() => { sending = undefined; });
    return sending;
  }
  function track(event: string, properties: Record<string, string> = {}) {
    if (closed || queue.length >= MAX_QUEUED) return;
    queue.push({ event, properties: {
      ...properties, token, distinct_id: distinctId, time: Date.now(), $insert_id: randomUUID(),
      host, plugin_version: PLUGIN_VERSION, os: process.platform,
    } });
    if (queue.length >= BATCH_SIZE) void flush();
  }

  // Polling and input tools measure pacing, not feature use.
  const register = server.server.setRequestHandler.bind(server.server);
  server.server.setRequestHandler = (schema, handler) => {
    if (isCallTool(schema) === false) return register(schema, handler);
    register(schema, async (request, extra) => {
      const { name } = (request as CallToolRequest).params;
      if (isFrequentTool(name)) return handler(request, extra);
      let result: CallToolResult;
      try { result = await handler(request, extra) as CallToolResult; }
      catch (error) { track("Tool Called", { tool: name, outcome: "error" }); throw error; }
      track("Tool Called", { tool: name, outcome: result.isError === true ? "error" : "success" });
      return result;
    });
  };
  const timer = setInterval(() => { void flush(); }, TELEMETRY_INTERVAL_MS);
  timer.unref();

  return {
    sessionStarted(clientName) {
      if (closed) return;
      host = serverTelemetryHost(clientName);
      pendingProfile = {
        $token: token, $distinct_id: distinctId, $ip: "0",
        $set: { host, plugin_version: PLUGIN_VERSION, os: process.platform },
      };
      track("Session Started");
    },
    async close() {
      if (closed) return sending;
      closed = true;
      clearInterval(timer);
      await flush();
      pendingProfile = undefined;
    },
  };
}
