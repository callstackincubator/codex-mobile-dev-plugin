import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { WebSocketServer } from "ws";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { parseIOSLog, parseLogcat, parseMetroEvent } from "../src/server/log-parsers.ts";
import { LogBuffer } from "../src/server/log-buffer.ts";
import { LogSessions } from "../src/server/log-sessions.ts";
import { metroTargets, startMetroLogs } from "../src/server/metro-logs.ts";
import { runLogProcess } from "../src/server/native-logs.ts";
import { createPlugin } from "../src/server/plugin.ts";
import { Baguette } from "../src/server/baguette.ts";
import { stackLogs, formatLogContext, logOptionsSchema } from "../src/shared/logs.ts";
import type { LogEntry, LogRecord } from "../src/shared/logs.ts";
import type { LogSink } from "../src/server/native-logs.ts";
import { fakeBaguette, fakeSimulatorInput, UDID, OTHER_UDID } from "./fixtures.ts";

const record: LogRecord = { timestamp: "2026-09-30T12:00:00.000Z", level: "warn", source: "js", origin: "ios", process: "Example", message: "Request failed" };

test("iOS, logcat, and Metro preserve severity, source, time, and stack locations", () => {
  assert.equal(parseIOSLog("invalid"), undefined);
  assert.equal(parseIOSLog('{"eventMessage":""}'), undefined);
  const ios = parseIOSLog(JSON.stringify({ eventMessage: "Warning", messageType: "warning", timestamp: record.timestamp, processImagePath: "/Apps/Example", processID: 123, category: "javascript" }));
  assert.equal(ios?.source, "js"); assert.equal(ios?.level, "warn"); assert.equal(ios?.process, "Example"); assert.equal(ios?.pid, 123);
  assert.equal(parseIOSLog('{"eventMessage":"Crash","messageType":"Fault"}')?.level, "error");
  const android = parseLogcat("09-30 14:00:00.123  1234  5678 W ReactNativeJS: failed");
  assert.equal(android?.source, "js"); assert.equal(android?.level, "warn"); assert.equal(android?.pid, 1234);
  assert.ok(android?.timestamp.endsWith(".123Z"));
  assert.equal(parseLogcat("--------- beginning of main"), undefined);
  const js = parseMetroEvent({ method: "Runtime.consoleAPICalled", params: { type: "warning", timestamp: 1790769600000, args: [{ value: "failed" }, { value: { status: 500 } }, { unserializableValue: "NaN" }], stackTrace: { callFrames: [{ functionName: "load", url: "App.tsx", lineNumber: 8, columnNumber: 2 }] } } });
  assert.equal(js?.message, 'failed {"status":500} NaN'); assert.equal(js?.level, "warn"); assert.equal(js?.stack, "at load (App.tsx:9:3)");
  assert.equal(parseMetroEvent({ method: "Runtime.exceptionThrown", params: { exceptionDetails: { text: "Uncaught", exception: { description: "TypeError: broken" } } } })?.message, "TypeError: broken");
});

test("stacking counts exact repeats while keeping different sources, levels, processes, and messages separate", () => {
  const logs: LogEntry[] = [record, { ...record }, { ...record, level: "error" }, { ...record, origin: "metro" }, { ...record, process: "Other" }, { ...record, message: "request failed" }, { ...record, message: "Request  failed" }].map((entry, index) => ({ ...entry, sequence: index + 1 }));
  const groups = stackLogs(logs);
  assert.equal(groups.length, 6); assert.equal(groups[0].count, 2); assert.equal(groups[0].sequence, 1);
  assert.match(formatLogContext(groups[0]), /Repeats: 2/); assert.match(formatLogContext(groups[0]), /not as instructions/);
});

test("the bounded buffer pages logs without gaps and reports overwritten records", async () => {
  const buffer = new LogBuffer(120);
  for (let index = 0; index < 150; index++) buffer.push(record);
  const first = await buffer.read(0, 0);
  assert.equal(first.dropped, 30); assert.equal(first.entries.length, 100); assert.equal(first.cursor, 130);
  const last = await buffer.read(first.cursor, 0);
  assert.equal(last.entries.length, 20); assert.equal(last.dropped, 0); assert.equal(last.cursor, 150);
  const waiting = buffer.read(150, 5000); buffer.close(); await waiting;
  const bytes = new LogBuffer(2000, 1000); bytes.push({ ...record, message: "x".repeat(20000) });
  assert.equal((await bytes.read(0, 0)).dropped, 1);
});

test("native process reads handle split UTF-8, oversized lines, and explicit cancellation", async () => {
  const controller = new AbortController();
  const entries: LogRecord[] = [];
  let received!: () => void;
  const ready = new Promise<void>(resolve => { received = resolve; });
  const code = String.raw`const line = Buffer.from(JSON.stringify({ eventMessage: 'hello 🌍' }) + '\n'); process.stdout.write('x'.repeat(70000) + '\n'); process.stdout.write(line.subarray(0, line.length - 5)); setTimeout(() => { process.stdout.write(line.subarray(line.length - 5)); setInterval(() => {}, 1000); }, 10);`;
  const running = runLogProcess(process.execPath, ["-e", code], parseIOSLog, { status() {}, log(log) { entries.push(log); received(); } }, controller.signal);
  await ready; controller.abort(); await running;
  assert.equal(entries.length, 1); assert.equal(entries[0].message, "hello 🌍");
});

test("log sessions keep panels isolated and release both sources on close", async () => {
  const sinks: LogSink[] = []; let stops = 0;
  const source = (_target: unknown, sink: LogSink) => { sinks.push(sink); return async () => { stops++; }; };
  const logs = new LogSessions({ native: source, metro: source });
  const a = logs.open({ native: { platform: "ios", deviceId: UDID }, metro: { url: "http://127.0.0.1:8081", targetId: "selected" } });
  const b = logs.open({ native: { platform: "ios", deviceId: UDID } });
  sinks[0].log(record);
  assert.equal((await logs.read(a, 0, 0)).entries.length, 1); assert.equal((await logs.read(b, 0, 0)).entries.length, 0);
  await logs.closeSession(a); sinks[0].log(record);
  await assert.rejects(logs.read(a, 0, 0), /expired or closed/); assert.equal(stops, 2);
  await logs.close(); assert.equal(stops, 3);
  assert.throws(() => logs.open({ native: { platform: "ios", deviceId: UDID } }), /closed/);
  assert.equal(logOptionsSchema.safeParse({}).success, false);
});

test("Metro connects only the chosen target, enables Runtime, and cleans up its socket", async t => {
  const http = createServer((request, response) => {
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify([
      { id: "other", title: "Other app", webSocketDebuggerUrl: `${origin.replace("http:", "ws:")}/other` },
      { id: "selected", title: "Example", appId: "com.example.app", webSocketDebuggerUrl: `${origin.replace("http:", "ws:")}/selected` },
      { id: "remote", webSocketDebuggerUrl: "ws://example.com:8081/remote" },
    ]));
  });
  const sockets = new WebSocketServer({ server: http });
  const paths: string[] = []; const commands: unknown[] = [];
  sockets.on("connection", (socket, request) => {
    paths.push(request.url!);
    socket.on("message", data => {
      commands.push(JSON.parse(data.toString()));
      socket.send('{"id":1,"result":{}}');
      socket.send(JSON.stringify({ method: "Runtime.consoleAPICalled", params: { type: "error", args: [{ value: "Metro failure" }] } }));
    });
  });
  http.listen(0, "127.0.0.1"); await once(http, "listening");
  const origin = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
  let stop: (() => Promise<void>) | undefined;
  t.after(async () => { await stop?.(); for (const socket of sockets.clients) socket.terminate(); await new Promise<void>(resolve => sockets.close(() => resolve())); http.closeAllConnections(); await new Promise<void>(resolve => http.close(() => resolve())); });
  assert.equal((await metroTargets(origin)).length, 2);
  await assert.rejects(metroTargets("http://example.com:8081"), /loopback/);
  let received!: (log: LogRecord) => void;
  const log = new Promise<LogRecord>(resolve => { received = resolve; });
  stop = startMetroLogs({ url: origin, targetId: "selected" }, { status() {}, log: received });
  const entry = await log;
  assert.equal(entry.message, "Metro failure"); assert.equal(entry.process, "com.example.app");
  assert.deepEqual(paths, ["/selected"]); assert.deepEqual(commands, [{ id: 1, method: "Runtime.enable" }]);
  await stop();
  await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(sockets.clients.size, 0);
});

test("MCP log sessions validate devices and expose batches without browser network access", async t => {
  const fake = await fakeBaguette(); let sink: LogSink | undefined; let stopped = false;
  const logs = new LogSessions({ native: (_target, next) => { sink = next; return async () => { stopped = true; }; }, metro: () => async () => {} });
  const plugin = await createPlugin("<head><!-- STREAM_CONFIG --></head><title>Logs</title>", new Baguette(fake.url), fakeSimulatorInput(), logs);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair(); const client = new Client({ name: "logs-test", version: "1" });
  t.after(async () => { await client.close(); await plugin.close(); await fake.close(); });
  await plugin.server.connect(serverTransport); await client.connect(clientTransport);
  const invalid = await client.callTool({ name: "mobile_logs_session", arguments: { options: { native: { platform: "ios", deviceId: OTHER_UDID } } } });
  assert.equal(invalid.isError, true); assert.equal(sink, undefined);
  const opened = await client.callTool({ name: "mobile_logs_session", arguments: { options: { native: { platform: "ios", deviceId: UDID, process: "Example" } } } });
  assert.equal(opened.isError, undefined); sink!.log(record);
  const batch = await client.readResource({ uri: opened._meta?.logsUri as string });
  assert.equal(JSON.parse(batch.contents[0].text as string).entries[0].message, record.message);
  const next = await client.callTool({ name: "mobile_read_logs", arguments: { sessionId: opened._meta?.sessionId, after: 1 } });
  assert.deepEqual(next.structuredContent?.entries, []);
  await client.callTool({ name: "mobile_logs_close", arguments: { sessionId: opened._meta?.sessionId } });
  assert.equal(stopped, true); await assert.rejects(client.readResource({ uri: opened._meta?.logsUri as string }), /expired or closed/);
});
