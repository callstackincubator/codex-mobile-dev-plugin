import assert from "node:assert/strict";
import test from "node:test";
import * as Sentry from "@sentry/node";
import type { Envelope } from "@sentry/core";
import { recordTestingSetupOperation } from "../src/telemetry.ts";
import { scrubMetric } from "../../shared/src/telemetry.ts";

test("testing setup telemetry contains only bounded structural attributes", async t => {
  const envelopes: Envelope[] = [];
  Sentry.init({
    dsn: "https://public@example.com/1", defaultIntegrations: false, beforeSendMetric: scrubMetric,
    transport: () => ({ async send(envelope) { envelopes.push(envelope); return { statusCode: 200 }; }, async flush() { return true; } }),
  });
  t.after(async () => { await Sentry.close(); });
  recordTestingSetupOperation("apply", "failed", "chatgpt");
  recordTestingSetupOperation("login", "started", "/private/project?token=secret");
  await Sentry.flush();
  const encoded = JSON.stringify(envelopes);
  assert.match(encoded, /testing\.setup\.operation\.samples/);
  assert.match(encoded, /chatgpt/);
  assert.match(encoded, /other/);
  assert.doesNotMatch(encoded, /private\/project|token/);
});
