import assert from "node:assert/strict";
import test from "node:test";
import { scrubMetric } from "@mobile-dev/shared/telemetry.ts";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import type { TestContext } from "node:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { REDACTED, redactStorageValue } from "../src/app-storage/redaction.ts";
import { registerAppStorageTools } from "../src/app-storage/tools.ts";
import { SimulatorContainer } from "../src/app-storage/container.ts";
import type { AppContainer } from "../src/app-storage/container.ts";
import { systemCommands } from "../src/app-control/commands.ts";
import type { AppDriver } from "../src/app-control/driver.ts";
import { ExpectedOperationError } from "@mobile-dev/shared/error-reporting.ts";
import { storageSnapshotSchema, storageTableSchema } from "@mobile-dev/shared/app-storage.ts";
import { captureSentry } from "@mobile-dev/test-support/sentry.ts";
import { connectClient } from "@mobile-dev/test-support/mcp.ts";

const target = { platform: "ios", deviceId: "B5C969F6-58A4-4C31-AB12-FB9E56D681DE", bundleId: "com.example" };
const token = "ghp_0123456789abcdefghijklmnopqrstuvwxyz";
const containerFor = (files: Record<string, string>, reads: string[] = []): AppContainer => ({
  platform: "ios",
  list: async () => Object.entries(files).map(([path, value]) => ({ path, bytes: Buffer.byteLength(value) })),
  read: async path => { reads.push(path); if (!(path in files)) throw new Error("unexpected read"); return Buffer.from(files[path]); },
  remove: async () => { throw new Error("Must not delete data"); },
  reset: async () => { throw new Error("Must not reset data"); },
});
async function connect(t: TestContext, container: AppContainer) {
  const server = new McpServer({ name: "storage-redaction-test", version: "1" });
  registerAppStorageTools(server, systemCommands, () => ({} as AppDriver), async () => container);
  return connectClient(t, server);
}

function absent(result: unknown, secrets: string[]) {
  const serialized = JSON.stringify(result);
  for (const secret of secrets) assert.ok(!serialized.includes(secret), `Leaked synthetic fixture value: ${secret}`);
}

test("storage filtering handles sensitive names, nested objects, encoded JSON, opaque data and known credential formats", () => {
  for (const key of ["access_token", "refreshToken", "PASSWORD", "ＡＰＩ＿ＫＥＹ", "session.id", "private-key", "email", "creditCardNumber"]) {
    assert.equal(redactStorageValue(key, "small-secret"), REDACTED, key);
  }
  for (const value of [token, "Bearer short-secret", "Basic dXNlcjpwYXNz", "https://user:pass@example.com/path", "-----BEGIN RSA PRIVATE KEY-----\nbody", "password=short", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig", "person@example.com"]) {
    assert.equal(redactStorageValue("neutral", value), REDACTED, value);
  }
  const nested = JSON.stringify({ theme: "dark", prefs: [{ password: "nested-secret", enabled: true }], encoded: JSON.stringify({ apiKey: "encoded-secret", count: 2 }) });
  const filtered = JSON.parse(String(redactStorageValue("settings", nested)));
  assert.deepEqual(filtered.prefs, [{ password: REDACTED, enabled: true }]);
  assert.deepEqual(JSON.parse(filtered.encoded), { apiKey: REDACTED, count: 2 });
  assert.equal(filtered.theme, "dark");
  assert.equal(redactStorageValue("blob", "1234", true), REDACTED);
  assert.equal(redactStorageValue("settings", '{"password":"partial-secret"'), REDACTED);
  assert.equal(redactStorageValue("settings", "[".repeat(30) + '"deep-secret"' + "]".repeat(30)), REDACTED);
  assert.equal(redactStorageValue("settings", JSON.stringify({ value: "x".repeat(1_000_001) })), REDACTED);
});

test("scoped MCP reads never decode or return unrelated stores and redact before truncation", async t => {
  const reads: string[] = [];
  const path = "Library/Application Support/com.example/RCTAsyncLocalStorage_V1/manifest.json";
  const container = containerFor({
    [path]: JSON.stringify({ password: "pvt-a", nested: JSON.stringify({ summary: "safe text ".repeat(80), token: "pvt-b" }), theme: "dark", tokenAfterPrefix: "pvt-c", generic: "safe prefix ".repeat(10) + token }),
    "Library/Preferences/unrelated.plist": "unrelated-private-value",
    "Documents/person@example.com.txt": "personal-path",
  }, reads);
  const client = await connect(t, container);
  const result = await client.callTool({ name: "mobile_app_storage", arguments: { ...target, store: `async-storage:${path}`, valueLength: 40 } });
  assert.equal(result.isError, undefined);
  const snapshot = storageSnapshotSchema.parse(result.structuredContent);
  assert.deepEqual(reads, [path]);
  assert.deepEqual(snapshot.files.map(file => file.path), [path]);
  assert.equal(snapshot.fileCount, 1);
  const entries = Object.fromEntries(snapshot.stores[0].entries.map(entry => [entry.key, entry]));
  assert.equal(entries.password.value, REDACTED);
  assert.equal(entries.generic.value, REDACTED);
  assert.equal(entries.theme.value, "dark");
  assert.equal(entries.nested.truncated, true);
  absent(result, ["pvt-a", "pvt-b", "pvt-c", token, "unrelated", "person@example.com", "private-value"]);
  assert.deepEqual(JSON.parse((result.content as { text: string }[])[0].text), result.structuredContent);
  const filtered = await client.callTool({ name: "mobile_app_storage", arguments: { ...target, store: `async-storage:${path}`, keys: ["theme"] } });
  assert.deepEqual(storageSnapshotSchema.parse(filtered.structuredContent).stores[0].entries.map(entry => entry.key), ["theme"]);
  const before = reads.length;
  const missing = await client.callTool({ name: "mobile_app_storage", arguments: { ...target, store: "async-storage:missing" } });
  assert.equal(missing.isError, true);
  assert.equal(reads.length, before);
});

test("unscoped MCP reads filter plaintext plist values and sensitive metadata", async t => {
  const container = containerFor({
    "Library/Preferences/com.example.plist": `<plist><dict><key>password</key><string>plist-private</string><key>theme</key><string>dark</string><key>blob</key><data>c2VjcmV0</data><key>${token}</key><string>credential-key-value</string></dict></plist>`,
    "Documents/person@example.com.txt": "ignore",
    "Library/Preferences/person@example.com.plist": "ignore",
  });
  const client = await connect(t, container);
  const result = await client.callTool({ name: "mobile_app_storage", arguments: target });
  assert.equal(result.isError, undefined);
  absent(result, ["plist-private", "736563726574", token, "person@example.com", "credential-key-value"]);
  assert.ok(JSON.stringify(result).includes("dark"));
});

test("MCP storage errors do not echo raw or expected diagnostic content", async t => {
  for (const error of [new Error("SQL pvt-error /private/path"), new ExpectedOperationError("device_unavailable", "pvt-error /private/path"), new ExpectedOperationError("invalid_input", "pvt-error /private/path")]) {
    const container = containerFor({}); container.list = async () => { throw error; };
    const client = await connect(t, container);
    const result = await client.callTool({ name: "mobile_app_storage", arguments: target });
    assert.equal(result.isError, true);
    absent(result, ["pvt-error", "/private/path"]);
  }
});

test("MCP SQLite results filter columns, key/value rows, nested JSON and blobs before crossing either output channel", { skip: process.platform !== "darwin" }, async t => {
  const root = await mkdtemp(join(tmpdir(), "storage-redaction-")); t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "Documents"));
  const path = join(root, "Documents/app.db");
  execFileSync("/usr/bin/sqlite3", [path, `
    CREATE TABLE settings (key TEXT, value TEXT, password TEXT, data BLOB, count INTEGER);
    INSERT INTO settings VALUES ('theme', 'dark', 'sql-password', x'736563726574', 2);
    INSERT INTO settings VALUES ('refresh_token', 'sql-refresh', 'sql-password', NULL, 3);
    INSERT INTO settings VALUES ('nested', '{"enabled":true,"secret":"sql-nested"}', 'sql-password', NULL, 4);
    INSERT INTO settings VALUES ('generic', '${token}', 'sql-password', NULL, 5);
    CREATE TABLE tokens (label TEXT, value TEXT); INSERT INTO tokens VALUES ('test', 'sql-token-table');
  `]);
  const before = await readFile(path);
  const client = await connect(t, new SimulatorContainer(root, target.deviceId, systemCommands));
  const args = { ...target, store: "sqlite:Documents/app.db", table: "settings", limit: 4 };
  const result = await client.callTool({ name: "mobile_app_storage_table", arguments: args });
  assert.equal(result.isError, undefined);
  absent(result, ["sql-password", "sql-refresh", "sql-nested", token, "736563726574"]);
  const table = storageTableSchema.parse(result.structuredContent);
  assert.deepEqual(table.rows[0], ["theme", "dark", REDACTED, REDACTED, 2]);
  assert.ok(table.rows[1].every(value => value === REDACTED));
  assert.deepEqual(JSON.parse(String(table.rows[2][1])), { enabled: true, secret: REDACTED });
  assert.deepEqual(JSON.parse((result.content as { text: string }[])[0].text), result.structuredContent);
  // Projection cannot bypass the key/credential label by requesting only value.
  const projected = await client.callTool({ name: "mobile_app_storage_table", arguments: { ...args, columns: ["value"], offset: 1, limit: 1 } });
  assert.deepEqual(storageTableSchema.parse(projected.structuredContent).rows, [[REDACTED]]);
  assert.deepEqual(storageTableSchema.parse(projected.structuredContent).columns.map(column => column.name), ["value"]);
  const sensitiveTable = await client.callTool({ name: "mobile_app_storage_table", arguments: { ...args, table: "tokens" } });
  absent(sensitiveTable, ["sql-token-table"]);
  const invalid = await client.callTool({ name: "mobile_app_storage_table", arguments: { ...args, columns: ["value\"; DROP TABLE settings; --"] } });
  assert.equal(invalid.isError, true);
  absent(invalid, ["DROP TABLE"]);
  assert.deepEqual(await readFile(path), before, "Inspection must not alter the source database");
});


test("filtered MCP reads preserve operation metrics without storage content and honor telemetry opt-out", async t => {
  const sentry = captureSentry(t, { telemetry: "on", beforeSendMetric: scrubMetric });
  const path = "Library/Preferences/com.example.plist";
  const client = await connect(t, containerFor({ [path]: '<plist><dict><key>password</key><string>private-metric-value</string></dict></plist>' }));
  const result = await client.callTool({ name: "mobile_app_storage", arguments: target });
  assert.equal(result.isError, undefined);
  await client.callTool({ name: "mobile_app_storage", arguments: { ...target, store: "private-missing-store" } });
  const sent = await sentry.text();
  for (const fragment of ["app_storage.operation.samples", "app_storage.operation.duration", '"surface":{"value":"storage"', '"operation":{"value":"read"', '"outcome":{"value":"success"', '"outcome":{"value":"failed"']) assert.ok(sent.includes(fragment), fragment);
  absent(sentry.envelopes, ["private-metric-value", "private-missing-store", "password", path, target.bundleId, target.deviceId]);
  sentry.setTelemetry("off");
  await client.callTool({ name: "mobile_app_storage", arguments: target });
  assert.equal(await sentry.text(), sent);
});
