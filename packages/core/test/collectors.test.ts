import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { LineSplitter } from "../src/collectors/lines.ts";
import { CollectorError, startCollector } from "../src/collectors/process.ts";
import type { CollectorOptions } from "../src/collectors/process.ts";
import { TraceStream } from "../src/fps/protobuf.ts";
import { startDisplayFpsMonitor } from "../src/fps/source.ts";
import type { FrameReading } from "../src/fps/frame-timeline.ts";

const labels: CollectorOptions["labels"] = {
  exited: status => `Fixture exited (${status}).`, timeout: "Fixture timed out.", stalled: "Fixture stalled.", cancelled: "Fixture cancelled.",
};
/** A protocol helper: stops on stdin EOF. */
const stopsOnEof = "process.stdin.on('end', () => process.exit(0)); process.stdin.resume();";

function helper(script: string, options: Partial<CollectorOptions> = {}) {
  const records: unknown[] = [];
  const start = startCollector({
    command: process.execPath, args: ["-e", script], signal: new AbortController().signal, labels, readyTimeoutMs: 5000, killMs: 2000,
    output: { kind: "json", maxLineLength: 1024, oversized: "Oversized fixture record.", record(value) { records.push(value); } },
    ...options,
  });
  return { start, records };
}

test("the line splitter joins split UTF-8, drops or rejects oversized lines and flushes the last line", () => {
  const lines: Array<[string, boolean]> = [];
  const splitter = new LineSplitter((line, terminated) => lines.push([line, terminated]), { maxLength: 8 });
  const text = Buffer.from("héllo\nxxxxxxxxxxxx\nok\ntail");
  splitter.write(text.subarray(0, 2));
  splitter.write(text.subarray(2));
  splitter.end();
  assert.deepEqual(lines, [["héllo", true], ["ok", true], ["tail", false]]);
  const strict = new LineSplitter(() => {}, { maxLength: 4, oversized: "Too long." });
  assert.throws(() => strict.write(Buffer.from("12345")), /Too long/);
});

test("helpers become ready on their ready record, deliver data records and stop on stdin EOF", async () => {
  let ready: unknown;
  const script = `console.log(JSON.stringify({ extra: 1, type: 'ready' })); console.log('{"type":"sample","value":2}'); ${stopsOnEof}`;
  const { start, records } = helper(script, { ready(record) { ready = record; } });
  const collector = await start;
  assert.deepEqual(ready, { extra: 1, type: "ready" });
  while (records.length === 0) await new Promise(resolve => setTimeout(resolve, 5));
  assert.deepEqual(records, [{ type: "sample", value: 2 }]);
  await Promise.all([collector.stop(), collector.stop()]);
  assert.equal(await collector.exited, 0);
});

test("a helper's error record becomes the failure, before and after startup", async () => {
  const failing = `console.log(JSON.stringify({ type: 'error', cause: 'device_unavailable', message: 'The phone is gone.' })); console.error('details'); process.exit(1);`;
  const early = helper(failing);
  await assert.rejects(early.start, (error: unknown) => error instanceof CollectorError && error.code === "device_unavailable" && error.message === "The phone is gone.");
  const late = helper(`console.log('{"type":"ready"}'); setTimeout(() => { ${failing} }, 20); ${stopsOnEof}`);
  const collector = await late.start;
  const error = await collector.closed;
  assert.ok(error instanceof CollectorError);
  assert.equal(error.message, "The phone is gone.");
});

test("startup times out without a ready record, stalls fail a quiet helper and invalid records fail the stream", async () => {
  const silent = helper(stopsOnEof, { readyTimeoutMs: 50 });
  await assert.rejects(silent.start, /Fixture timed out/);
  const quiet = helper(`console.log('{"type":"ready"}'); ${stopsOnEof}`, { stallMs: 50 });
  const collector = await quiet.start;
  assert.match((await collector.closed).message, /Fixture stalled/);
  const invalid = helper(`console.log('{"type":"ready"}'); console.log('not json'); ${stopsOnEof}`, {
    labels: { ...labels, invalid: message => `Invalid fixture: ${message}` },
  });
  const broken = await invalid.start;
  assert.match((await broken.closed).message, /^Invalid fixture:/);
  await broken.stop();
});

test("cancelling a start stops the helper, and a helper that ignores EOF is killed", async () => {
  const abort = new AbortController();
  const pending = helper("setInterval(() => {}, 1000);", { signal: abort.signal, killMs: 50 });
  setTimeout(() => abort.abort(), 30);
  await assert.rejects(pending.start, /Fixture cancelled/);
  const stubborn = helper(`console.log('{"type":"ready"}'); setInterval(() => {}, 1000);`, { killMs: 50 });
  const collector = await stubborn.start;
  await collector.stop();
  assert.equal(await collector.exited, null);
});

test("plain commands are live once spawned, ignore control records and stop on SIGTERM", async () => {
  const lines: string[] = [];
  const collector = await startCollector({
    command: process.execPath, args: ["-e", `console.log('{"type":"error","message":"not a helper"}'); setInterval(() => {}, 1000);`],
    signal: new AbortController().signal, labels, protocol: false, killMs: 2000,
    output: { kind: "lines", maxLineLength: 1024, line(text) { lines.push(text); } },
  });
  while (lines.length === 0) await new Promise(resolve => setTimeout(resolve, 5));
  assert.deepEqual(lines, ['{"type":"error","message":"not a helper"}']);
  await collector.stop();
  assert.equal(await collector.exited, null);
});

test("Perfetto streams carry helper control lines between trace packets", () => {
  const packets: string[] = [];
  const control: string[] = [];
  const stream = new TraceStream(packet => packets.push(packet.toString()), line => control.push(line));
  const packet = Buffer.concat([Buffer.from([10, 2]), Buffer.from("ok")]);
  const bytes = Buffer.concat([Buffer.from('{"type":"ready"}\n'), packet, Buffer.from('{"type":"error"}\n')]);
  stream.push(bytes.subarray(0, 5));
  stream.push(bytes.subarray(5, 19));
  stream.push(bytes.subarray(19));
  assert.deepEqual(packets, ["ok"]);
  assert.deepEqual(control, ['{"type":"ready"}', '{"type":"error"}']);
  assert.throws(() => new TraceStream(() => {}).push(Buffer.from("{")), /Invalid Perfetto trace stream/);
});

test("iPhone Display FPS starts its first interval at the helper's ready record", { skip: process.platform !== "darwin" && "needs macOS" }, async t => {
  const directory = await mkdtemp(join(tmpdir(), "mobile-dev-fps-helper-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "mobile-dev-ios-fps");
  const script = `#!${process.execPath}
if (process.argv[2] !== 'fps' || process.argv[3] !== 'device') process.exit(2);
console.log('{"type":"ready"}');
setTimeout(() => console.log('{"fps":60}'), 100);
${stopsOnEof}`;
  await writeFile(path, script, { mode: 0o700 });
  const readings: FrameReading[] = [];
  const monitor = await startDisplayFpsMonitor({ target: { platform: "ios", deviceId: "device" }, signal: new AbortController().signal,
    onSample: reading => readings.push(reading) }, pathToFileURL(path));
  while (readings.length < 2) await new Promise(resolve => setTimeout(resolve, 10));
  await monitor.stop();
  assert.equal(readings[0].fps, null);
  assert.equal(readings[0].interval, 0);
  assert.equal(readings[1].fps, 60);
  assert.ok(readings[1].interval > 0);
});
