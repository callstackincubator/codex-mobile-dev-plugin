import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { NativeTelemetryRelay, nativeCollectorCommand, parseNativeEnvelope } from "../src/server/native-telemetry.ts";
import { SENTRY_NATIVE_DSN, SENTRY_RELEASE } from "../src/shared/telemetry.ts";
import { getTelemetryIdentity } from "../src/server/telemetry-identity.ts";

function encode(type: string, payload: unknown, dsn = SENTRY_NATIVE_DSN) {
  const json = JSON.stringify(payload);
  const body = Buffer.from(json);
  const headerText = JSON.stringify({ dsn });
  const itemText = JSON.stringify({ type, length: body.length });
  const envelope = `${headerText}\n${itemText}\n${json}\n`;
  const bytes = Buffer.from(envelope);
  return bytes.toString("base64");
}

test("native relay preserves diagnostics and assembles reports across pipe chunks", () => {
  const event = { platform: "native", event_id: "1".repeat(32), message: "Native crash" };
  const encoded = encode("event", event);
  const reports: ReturnType<typeof parseNativeEnvelope>[] = [];
  let diagnostic = "";
  const relay = new NativeTelemetryRelay(text => { diagnostic += text; }, text => { reports.push(parseNativeEnvelope(text)); });
  const input = Buffer.from(`ordinary diagnostic\n[mobile-dev:sentry-envelope]${encoded}\ntrailing diagnostic`);
  for (let offset = 0; offset < input.length; offset += 7) {
    const chunk = input.subarray(offset, offset + 7);
    relay.write(chunk);
  }
  relay.end();
  assert.equal(diagnostic, "ordinary diagnostic\ntrailing diagnostic");
  assert.equal(reports.length, 1);
  assert.deepEqual(reports[0][0][1][0][1], event);
});

test("native envelopes preserve metric counts and UTF-8 byte boundaries", () => {
  const event = { platform: "native", event_id: "1".repeat(32), message: "Native échec" };
  const encodedEvent = encode("event", event);
  const events = parseNativeEnvelope(encodedEvent);
  assert.deepEqual(events[0][1][0][1], event);
  const metrics = { items: [{ name: "native.cpu.utilization", value: 0.05, type: "gauge", timestamp: 123 }] };
  const encodedMetrics = encode("trace_metric", metrics);
  const envelopes = parseNativeEnvelope(encodedMetrics);
  assert.equal(envelopes[0][1][0][0].item_count, 1);
  assert.deepEqual(envelopes[0][1][0][1], metrics);
});

test("native relay rejects other projects, attachments, invalid lengths and oversized reports", () => {
  const wrongProject = encode("event", {}, "https://public@other.example/1");
  assert.throws(() => parseNativeEnvelope(wrongProject), /another project/);
  const attachment = encode("attachment", {});
  assert.throws(() => parseNativeEnvelope(attachment), /unsupported item/);
  const header = JSON.stringify({ dsn: SENTRY_NATIVE_DSN });
  const bytes = Buffer.from(`${header}\n{"type":"event","length":999}\n{}\n`);
  const incomplete = bytes.toString("base64");
  assert.throws(() => parseNativeEnvelope(incomplete), /Incomplete/);
  const oversized = "A".repeat(350_001);
  assert.throws(() => parseNativeEnvelope(oversized), /encoding/);
  let diagnostic = "";
  const relay = new NativeTelemetryRelay(text => { diagnostic += text; }, parseNativeEnvelope);
  const invalid = Buffer.from("[mobile-dev:sentry-envelope]invalid!\nnext diagnostic\n");
  relay.write(invalid);
  assert.equal(diagnostic, "Native Sentry report was invalid and discarded.\nnext diagnostic\n");
});

test("Android launch commands propagate release, environment, anonymous identity and the telemetry off switch", () => {
  const command = nativeCollectorCommand("/data/local/tmp/mobile-dev-cpu", ["123"]);
  assert.ok(command.includes(SENTRY_RELEASE));
  assert.match(command, /MOBILE_DEV_NATIVE_ENVIRONMENT='(?:development|release)'/);
  const identity = getTelemetryIdentity();
  assert.ok(identity);
  const userIncluded = command.includes(`MOBILE_DEV_NATIVE_USER_ID='${identity.userId}'`);
  const sessionIncluded = command.includes(`MOBILE_DEV_NATIVE_SESSION_ID='${identity.sessionId}'`);
  assert.ok(userIncluded);
  assert.ok(sessionIncluded);
  assert.match(command, /exec '\/data\/local\/tmp\/mobile-dev-cpu' '123'$/);
  const previous = process.env.MOBILE_DEV_TELEMETRY;
  try {
    process.env.MOBILE_DEV_TELEMETRY = "off";
    const disabled = nativeCollectorCommand("/data/local/tmp/mobile-dev-fps");
    assert.match(disabled, /MOBILE_DEV_TELEMETRY=off/);
    const disabledIncludesUser = disabled.includes("MOBILE_DEV_NATIVE_USER_ID");
    const disabledIncludesSession = disabled.includes("MOBILE_DEV_NATIVE_SESSION_ID");
    assert.equal(disabledIncludesUser, false);
    assert.equal(disabledIncludesSession, false);
    const quoted = nativeCollectorCommand("/tmp/helper", ["a'b"]);
    assert.ok(quoted.includes("'a'\\''b'"));
  } finally {
    if (previous === undefined) delete process.env.MOBILE_DEV_TELEMETRY;
    else process.env.MOBILE_DEV_TELEMETRY = previous;
  }
});

test("the C SDK and the host relay use the same native project", async () => {
  const sourceUrl = new URL("../native/telemetry/telemetry.c", import.meta.url);
  const source = await readFile(sourceUrl, "utf8");
  assert.ok(source.includes(SENTRY_NATIVE_DSN));
});
