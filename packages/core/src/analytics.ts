import { randomUUID } from "node:crypto";
import * as Sentry from "@sentry/node";
import { PLUGIN_VERSION } from "@mobile-dev/shared/version.ts";
import { isFrequentTool, TELEMETRY_INTERVAL_MS } from "@mobile-dev/shared/telemetry.ts";
import type { TelemetryEnvironment, TelemetryHost } from "@mobile-dev/shared/telemetry.ts";
import { TELEMETRY_ENVIRONMENT } from "./telemetry-environment.ts";
import { getTelemetryIdentity } from "./telemetry-identity.ts";

/** Public project token of the EU-resident Mixpanel project. Empty disables product analytics. */
export const MIXPANEL_TOKEN = "780e4817b73c1234479ad8d418d34e89";
/** Mixpanel's EU ingestion endpoint; `ip=0` stops Mixpanel from reading or storing the sender's IP. */
export const MIXPANEL_TRACK_URL = "https://api-eu.mixpanel.com/track?ip=0";
const BATCH_SIZE = 50;
const MAX_QUEUED = 500;

type AnalyticsEvent = { event: string; properties: Record<string, string | number> };
type Send = (url: string, init: RequestInit) => Promise<Response>;

export type AnalyticsOptions = {
  token?: string;
  environment?: TelemetryEnvironment;
  distinctId?: () => string | undefined;
  send?: Send;
  intervalMs?: number;
};

/** Whether the person running the server has turned off product analytics or all telemetry. */
export function analyticsDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.MOBILE_DEV_TELEMETRY === "off" || env.MOBILE_DEV_ANALYTICS === "off" || env.DO_NOT_TRACK === "1";
}

/**
 * Anonymous product analytics: which tools are used and by how many installations.
 * Events carry only the tool name, outcome, host, plugin version and OS, never arguments,
 * results, device details, paths or IPs. Release builds only.
 */
export class ProductAnalytics {
  private readonly queue: AnalyticsEvent[] = [];
  private readonly token: string;
  private readonly distinctId: () => string | undefined;
  private readonly send: Send;
  private readonly enabled: boolean;
  private readonly timer?: NodeJS.Timeout;
  private host: TelemetryHost = "other";
  private flushing?: Promise<void>;

  constructor(options: AnalyticsOptions = {}) {
    this.token = options.token ?? MIXPANEL_TOKEN;
    this.distinctId = options.distinctId ?? (() => getTelemetryIdentity()?.userId);
    this.send = options.send ?? fetch;
    const environment = options.environment ?? TELEMETRY_ENVIRONMENT;
    this.enabled = this.token !== "" && environment === "release";
    if (this.enabled === false) return;
    this.timer = setInterval(() => { void this.flush(); }, options.intervalMs ?? TELEMETRY_INTERVAL_MS);
    this.timer.unref();
  }

  setHost(host: TelemetryHost) {
    this.host = host;
  }

  /** Marks a connected host session, which counts active installations per host. */
  sessionStarted() {
    this.track("Session Started", {});
  }

  /** Counts a tool call. Polling and input tools are left out: they measure pacing, not feature use. */
  toolCalled(tool: string, outcome: "success" | "error") {
    if (isFrequentTool(tool) || /_input$/.test(tool)) return;
    this.track("Tool Called", { tool, outcome });
  }

  private track(event: string, properties: Record<string, string>) {
    if (this.enabled === false || analyticsDisabled()) return;
    const distinctId = this.distinctId();
    if (distinctId === undefined || this.queue.length >= MAX_QUEUED) return;
    this.queue.push({ event, properties: {
      ...properties,
      token: this.token,
      distinct_id: distinctId,
      time: Date.now(),
      $insert_id: randomUUID(),
      host: this.host,
      plugin_version: PLUGIN_VERSION,
      os: process.platform,
    } });
    if (this.queue.length >= BATCH_SIZE) void this.flush();
  }

  /** Sends queued events; failed batches are dropped rather than retried. */
  flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    if (this.queue.length === 0) return Promise.resolve();
    this.flushing = (async () => {
      try {
        while (this.queue.length > 0) {
          const batch = this.queue.splice(0, BATCH_SIZE);
          let outcome: "success" | "failed" = "success";
          try {
            const response = await this.send(MIXPANEL_TRACK_URL, {
              method: "POST",
              headers: { "Content-Type": "application/json", Accept: "text/plain" },
              body: JSON.stringify(batch),
              signal: AbortSignal.timeout(5000),
            });
            if (response.ok === false) outcome = "failed";
          } catch { outcome = "failed"; }
          if (process.env.MOBILE_DEV_TELEMETRY !== "off") {
            Sentry.metrics.count("analytics.flush", 1, { attributes: { component: "server", outcome } });
          }
        }
      } finally { this.flushing = undefined; }
    })();
    return this.flushing;
  }

  async close() {
    clearInterval(this.timer);
    await this.flush();
  }
}

export const productAnalytics = new ProductAnalytics();
