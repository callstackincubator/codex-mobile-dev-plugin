import type { TestContext } from "node:test";
import * as NodeSentry from "@sentry/node";
import type { Envelope, ErrorEvent, SerializedMetric } from "@sentry/core";
import { setTelemetry } from "./env.ts";

type InitOptions = NonNullable<Parameters<typeof NodeSentry.init>[0]>;

/** The parts of a Sentry SDK the capture drives: `@sentry/node`, or the copy a bundled runtime carries. */
export type SentrySdk = {
  init(options: InitOptions): unknown;
  flush(timeout?: number): PromiseLike<boolean>;
  close(timeout?: number): PromiseLike<boolean>;
};

export type CaptureOptions = Omit<InitOptions, "dsn" | "transport"> & {
  /** Sets `MOBILE_DEV_TELEMETRY` for the test: "on" removes it, "off" opts out. Omitted, it is left as it is. */
  telemetry?: "on" | "off";
  /** The SDK to initialize. Defaults to `@sentry/node`. */
  sdk?: SentrySdk;
};

export type SentryCapture = ReturnType<typeof captureSentry>;

/**
 * Initializes Sentry with a transport that keeps every envelope in memory, without
 * default integrations unless `options` passes them. Sentry closes and the
 * telemetry setting is restored after the test.
 */
export function captureSentry(t: TestContext, { telemetry, sdk = NodeSentry, ...options }: CaptureOptions = {}) {
  const envelopes: Envelope[] = [];
  sdk.init({
    dsn: "https://public@example.com/1", defaultIntegrations: false, ...options,
    transport: () => ({ async send(envelope) { envelopes.push(envelope); return { statusCode: 200 }; }, async flush() { return true; } }),
  });
  t.after(async () => { await sdk.close(); });
  if (telemetry) setTelemetry(t, telemetry);
  const flush = async () => { await sdk.flush(); };
  /** The payloads of every sent envelope item of `type`. */
  const sent = (type: string) => envelopes.flatMap(envelope => envelope[1]).filter(item => item[0].type === type).map(item => item[1]);
  return {
    envelopes,
    flush,
    sent,
    /** Flushes, then returns the error events sent so far. */
    async events() { await flush(); return sent("event") as ErrorEvent[]; },
    /** Flushes, then returns the metrics sent so far, in send order. */
    async metrics() { await flush(); return (sent("trace_metric") as { items: SerializedMetric[] }[]).flatMap(container => container.items); },
    /** Flushes, then returns everything sent so far as JSON, for fragment checks. */
    async text() { await flush(); return JSON.stringify(envelopes); },
    /** Forgets what was sent so far. */
    clear() { envelopes.length = 0; },
    /** Turns telemetry on or off for the rest of the test. */
    setTelemetry(state: "on" | "off") { setTelemetry(t, state); },
  };
}
