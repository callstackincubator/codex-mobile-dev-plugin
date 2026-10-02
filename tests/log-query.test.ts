import test from "node:test";
import assert from "node:assert/strict";
import { compileLogQuery, composeAppLogQuery, quoteLogQueryValue } from "../src/ui/log-query.ts";
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

test("PID filters match exact process identities and reject invalid values", () => {
  const exact = matches("pid:123", { pid: 123 });
  assert.equal(exact, true);
  const different = matches("pid:123", { pid: 1234 });
  assert.equal(different, false);
  const missing = matches("pid:123");
  assert.equal(missing, false);
  const alternatives = matches("pid:123 pid:456", { pid: 456 });
  assert.equal(alternatives, true);
  const excluded = matches("-pid:123", { pid: 456 });
  assert.equal(excluded, true);
  for (const query of ["pid:0", "pid:-1", "pid:1.5", "pid:2147483648", "pid:text", "pid~:123"]) {
    const compiled = compileLogQuery(query);
    assert.ok(compiled.error, query);
  }
});

test("app filters match exact app identities, support regex, and search metadata", () => {
  const identity = { appId: "com.example.app" };
  const exact = matches('app:"COM.EXAMPLE.APP"', identity);
  assert.equal(exact, true);
  const partial = matches("app:com.example", identity);
  assert.equal(partial, false);
  const missing = matches("app:com.example.app", { process: "com.example.app" });
  assert.equal(missing, false);
  const pattern = matches('app~:"^com\\.example\\."', identity);
  assert.equal(pattern, true);
  const keyword = matches("com.example.app", identity);
  assert.equal(keyword, true);
});

test("automatic app clauses preserve user-query precedence and repeated-field alternatives", () => {
  const clause = 'app:"com.example.app"';
  const identity = { appId: "com.example.app" };
  for (const query of ["level:warn level:error message:network", "missing | network", 'message~:"(failed|timeout) \\d+" -message:noise', "level:error -message:noise", "age:5m"]) {
    const composed = composeAppLogQuery(clause, query);
    const included = matches(composed, identity);
    assert.equal(included, true, composed);
    const otherApp = matches(composed, { appId: "com.other.app" });
    assert.equal(otherApp, false, composed);
  }
  const repeated = composeAppLogQuery(clause, "level:warn level:error message:network");
  const warning = matches(repeated, { ...identity, level: "warn" });
  assert.equal(warning, true);
  const wrongLevel = matches(repeated, { ...identity, level: "info" });
  assert.equal(wrongLevel, false);
  const age = composeAppLogQuery(clause, "age:5m");
  const compiledAge = compileLogQuery(age);
  assert.equal(compiledAge.usesAge, true);
  const invalid = composeAppLogQuery(clause, "level:");
  const compiledInvalid = compileLogQuery(invalid);
  assert.ok(compiledInvalid.error);
  const emptyClause = composeAppLogQuery("", "level:error level:warn");
  assert.equal(emptyClause, "level:error level:warn");
  const emptyQuery = composeAppLogQuery(clause, "");
  assert.equal(emptyQuery, clause);
});

test("quoted app identities retain punctuation, quotes, and backslashes", () => {
  const appId = 'example\\folder"name:app';
  const quoted = quoteLogQueryValue(appId);
  const exact = matches(`app:${quoted}`, { appId });
  assert.equal(exact, true);
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
