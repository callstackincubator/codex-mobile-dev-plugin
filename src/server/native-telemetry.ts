import { makeNodeTransport } from "@sentry/node";
import type { ErrorEvent } from "@sentry/node";
import { SENTRY_NATIVE_DSN, SENTRY_RELEASE } from "../shared/telemetry.ts";
import { TELEMETRY_ENVIRONMENT } from "./telemetry-environment.ts";
import { getTelemetryIdentity } from "./telemetry-identity.ts";

type Transport = ReturnType<typeof makeNodeTransport>;
type Envelope = Parameters<Transport["send"]>[0];
type MetricPayload = Extract<Envelope[1][number], [{ type: "trace_metric" }, unknown]>[1];
type ClientReport = Extract<Envelope[1][number], [{ type: "client_report" }, unknown]>[1];
const prefix = "[mobile-dev:sentry-envelope]";
const maximumLine = 350_000;
let transport: Transport | undefined;

export function parseNativeEnvelope(encoded: string): Envelope[] {
  if (encoded.length === 0 || encoded.length > maximumLine || /^[A-Za-z0-9+/]*={0,2}$/.test(encoded) === false) {
    throw new Error("Invalid native Sentry envelope encoding.");
  }
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length > 256 * 1024) throw new Error("Native Sentry envelope exceeded its size limit.");
  let offset = 0;
  const readHeader = (): Record<string, unknown> => {
    const end = bytes.indexOf(10, offset);
    if (end < 0) throw new Error("Incomplete native Sentry envelope header.");
    const line = bytes.subarray(offset, end);
    const text = line.toString("utf8");
    const value: Record<string, unknown> = JSON.parse(text);
    offset = end + 1;
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid native Sentry envelope header.");
    return value;
  };
  const header = readHeader();
  if (header.dsn !== SENTRY_NATIVE_DSN) throw new Error("Native Sentry envelope targets another project.");
  const envelopes: Envelope[] = [];
  while (offset < bytes.length) {
    const item = readHeader();
    if (item.type !== "event" && item.type !== "trace_metric" && item.type !== "client_report") {
      throw new Error("Native Sentry envelope contains an unsupported item.");
    }
    if (typeof item.length !== "number" || Number.isSafeInteger(item.length) === false || item.length < 0) {
      throw new Error("Invalid native Sentry envelope item size.");
    }
    const end = offset + item.length;
    if (end > bytes.length) throw new Error("Incomplete native Sentry envelope item.");
    const payload = bytes.subarray(offset, end);
    const text = payload.toString("utf8");
    if (item.type === "event") {
      const event: ErrorEvent = JSON.parse(text);
      if (event === null || typeof event !== "object" || event.platform !== "native") throw new Error("Invalid native Sentry event.");
      if (typeof event.event_id !== "string") throw new Error("Native Sentry event has no event ID.");
      const now = new Date();
      const sentAt = now.toISOString();
      const eventHeader = { dsn: SENTRY_NATIVE_DSN, event_id: event.event_id, sent_at: sentAt };
      envelopes.push([eventHeader, [[{ type: "event" }, event]]]);
    } else if (item.type === "trace_metric") {
      const metrics: MetricPayload = JSON.parse(text);
      if (metrics === null || typeof metrics !== "object" || Array.isArray(metrics.items) === false) throw new Error("Invalid native Sentry metrics.");
      const count = metrics.items.length;
      envelopes.push([header, [[{ type: "trace_metric", item_count: count, content_type: "application/vnd.sentry.items.trace-metric+json" }, metrics]]]);
    } else {
      const report: ClientReport = JSON.parse(text);
      if (report === null || typeof report !== "object" || Array.isArray(report.discarded_events) === false) throw new Error("Invalid native Sentry client report.");
      envelopes.push([header, [[{ type: "client_report" }, report]]]);
    }
    offset = end;
    if (offset < bytes.length && bytes[offset] === 10) offset++;
  }
  return envelopes;
}

function sendEnvelope(encoded: string) {
  if (process.env.MOBILE_DEV_TELEMETRY === "off") return;
  const envelopes = parseNativeEnvelope(encoded);
  if (transport === undefined) {
    const dsn = new URL(SENTRY_NATIVE_DSN);
    const project = dsn.pathname.slice(1);
    const url = `https://${dsn.hostname}/api/${project}/envelope/?sentry_key=${dsn.username}&sentry_version=7`;
    transport = makeNodeTransport({ url, bufferSize: 16, recordDroppedEvent() {} });
  }
  for (const envelope of envelopes) {
    const sending = transport.send(envelope);
    const promise = Promise.resolve(sending);
    void promise.catch(() => {});
  }
}

export class NativeTelemetryRelay {
  private pending = "";
  private discarding = false;
  private readonly diagnostic: (text: string) => void;
  private readonly send: (encoded: string) => void;

  constructor(diagnostic: (text: string) => void, send: (encoded: string) => void = sendEnvelope) {
    this.diagnostic = diagnostic;
    this.send = send;
  }

  write(chunk: Buffer) {
    const text = chunk.toString("utf8");
    const parts = text.split("\n");
    for (let index = 0; index < parts.length; index++) {
      if (this.discarding === false) this.pending += parts[index];
      if (this.pending.length > maximumLine + prefix.length) { this.pending = ""; this.discarding = true; }
      if (index === parts.length - 1) continue;
      if (this.discarding === false) this.consume(this.pending + "\n");
      this.pending = "";
      this.discarding = false;
    }
  }

  end() {
    if (this.discarding === false && this.pending.length > 0) this.consume(this.pending);
    this.pending = "";
  }

  private consume(line: string) {
    if (line.startsWith(prefix)) {
      const payload = line.slice(prefix.length);
      const encoded = payload.trimEnd();
      try { this.send(encoded); }
      catch { this.diagnostic("Native Sentry report was invalid and discarded.\n"); }
    } else this.diagnostic(line);
  }
}

function shellQuote(value: string) {
  const quoted = value.replaceAll("'", "'\\''");
  return `'${quoted}'`;
}

export function nativeCollectorCommand(binary: string, args: string[] = []) {
  const release = shellQuote(SENTRY_RELEASE);
  const environment = shellQuote(TELEMETRY_ENVIRONMENT);
  const enabled = process.env.MOBILE_DEV_TELEMETRY === "off" ? "off" : "on";
  const command = shellQuote(binary);
  const quotedArguments = args.map(shellQuote);
  const argumentsText = quotedArguments.join(" ");
  const identity = getTelemetryIdentity();
  let identityEnvironment = "";
  if (identity) {
    const userId = shellQuote(identity.userId);
    const sessionId = shellQuote(identity.sessionId);
    identityEnvironment = ` MOBILE_DEV_NATIVE_USER_ID=${userId} MOBILE_DEV_NATIVE_SESSION_ID=${sessionId}`;
  }
  return `MOBILE_DEV_NATIVE_RELEASE=${release} MOBILE_DEV_NATIVE_ENVIRONMENT=${environment} MOBILE_DEV_TELEMETRY=${enabled}${identityEnvironment} exec ${command} ${argumentsText}`;
}

export async function closeNativeTelemetry() {
  if (transport !== undefined) await transport.flush(2000);
}
