import test from "node:test";
import assert from "node:assert/strict";
import { compileLogQuery } from "../src/ui/log-query.ts";
import type { LogRecord } from "../src/shared/logs.ts";

const now = Date.parse("2026-10-02T12:00:00Z");
const log: LogRecord = {
  timestamp: "2026-10-02T11:59:30Z", level: "error", source: "native", origin: "ios",
  message: "Network request failed: timeout 42", process: "Example", tag: "Networking",
  subsystem: "com.example.api", category: "requests", stack: "loadProfile at App.tsx:42",
};

function matches(query: string, values: Partial<LogRecord> = {}, time = now) {
  const compiled = compileLogQuery(query);
  assert.equal(compiled.error, "", query);
  const record = { ...log, ...values };
  return compiled.match(record, time);
}

test("keywords, quoted phrases, and field filters match case insensitively", () => {
  for (const query of ["", " \t ", "network TIMEOUT", '"request failed"', 'message:"request failed"', "level:err", "source:native", "origin:ios", "process:example", "tag:network", "subsystem:example.api", "category:requests", "stack:loadprofile", "timestamp:11:59"]) {
    assert.equal(matches(query), true, query);
  }
  for (const query of ["missing", 'message:"failed request"', "level:info", "source:js", "origin:android", "message:loadProfile"]) {
    assert.equal(matches(query), false, query);
  }
  assert.equal(matches('"level:error"', { message: "literal level:error" }), true);
  assert.equal(matches('"https://example.com"', { message: "https://example.com" }), true);
  assert.equal(matches("level:warning", { level: "warn" }), true);
  assert.equal(matches("level:verbose", { level: "debug" }), true);
});

test("repeated fields use OR and different fields and keywords use AND", () => {
  assert.equal(matches("level:warn level:error message:network"), true);
  assert.equal(matches("level:warn level:info message:network"), false);
  assert.equal(matches("level:error message:missing message:network"), true);
  assert.equal(matches("level:error level:warn -message:noise"), true);
  assert.equal(matches("level:error & level:warn"), false);
});

test("operators respect precedence, groups, and exclusions", () => {
  assert.equal(matches("missing | network & timeout"), true);
  assert.equal(matches("network | missing & absent"), true);
  assert.equal(matches("(network | missing) & absent"), false);
  assert.equal(matches("network (timeout | absent) -level:debug"), true);
  assert.equal(matches("-message:network"), false);
  assert.equal(matches("-timeout"), false);
  assert.equal(matches("-(level:info | source:js)"), true);
  assert.equal(matches("-stack:missing", { stack: undefined }), true);
});

test("regex patterns preserve escapes and quoted groups", () => {
  assert.equal(matches("message~:.*TIMEOUT"), true);
  assert.equal(matches('message~:"(timeout|failed) \\d+"'), true);
  assert.equal(matches('message~:"^network.*failed" -message~:success'), true);
  assert.equal(matches('message:"say \\"hello\\""', { message: 'say "hello"' }), true);
});

test("age filters use a single supplied clock and expire at the boundary", () => {
  for (const query of ["age:30s", "age:5m", "age:1h", "age:1d", "age:1M"]) assert.equal(matches(query), true);
  assert.equal(matches("age:29s"), false);
  assert.equal(matches("age:30s", {}, now + 1), false);
  assert.equal(matches("age:5m", { timestamp: "invalid" }), false);
  assert.equal(matches("age:5m", { timestamp: "2026-10-02T12:01:00Z" }), false);
  assert.equal(matches("-age:29s"), true);
  const compiled = compileLogQuery("age:5m & level:error");
  assert.equal(compiled.usesAge, true);
});

test("invalid filters report errors and never silently change semantics", () => {
  for (const query of ["level:", ":value", "~:value", "unknown:value", "age:5", "age:999999999999999999999d", "age~:5m", 'message~:"["', 'message:"open', "network &", "| network", "()", "(network", "network)", "-", "x".repeat(513)]) {
    const compiled = compileLogQuery(query);
    assert.ok(compiled.error, query);
    assert.equal(compiled.match(log, now), false, query);
    assert.equal(compiled.usesAge, false);
  }
});
