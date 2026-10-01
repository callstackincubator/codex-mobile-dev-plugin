import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { CpuSessions } from "../src/server/cpu/sessions.ts";
import { PerformanceRecordings, RecordingStore } from "../src/server/performance-recordings.ts";
import { summarizeRecording } from "../src/shared/recordings.ts";
import { recordingFixture } from "./recording-fixtures.ts";

test("range summaries weight interval overlap, preserve CPU above 100%, zero memory, and missing values", () => {
  const recording = recordingFixture();
  recording.samples = [
    { time: 0, interval: 0, cpuPercent: null, memoryBytes: 0, threads: [] },
    { time: 2, interval: 2, cpuPercent: 200, memoryBytes: null, threads: [{ id: "main", name: "main", cpuPercent: 150 }] },
    { time: 3, interval: 1, cpuPercent: 20, memoryBytes: 1048576, threads: [{ id: "main", name: "main", cpuPercent: 10 }] },
  ];
  const total = summarizeRecording(recording);
  assert.equal(total.peakCpuPercent, 200);
  assert.equal(total.averageCpuPercent, 140);
  assert.equal(total.firstMemoryBytes, 0);
  assert.equal(total.memoryChangeBytes, 1048576);
  const selected = summarizeRecording(recording, { start: 1, end: 3 });
  assert.equal(selected.averageCpuPercent, 110);
  assert.equal(selected.threads[0].averageCpuPercent, 80);
  assert.equal(selected.memoryChangeBytes, 0);
  const empty = summarizeRecording(recording, { start: 10, end: 12 });
  assert.equal(empty.peakCpuPercent, null);
  assert.equal(empty.memoryChangeBytes, null);
  assert.deepEqual(empty.threads, []);
  assert.throws(() => summarizeRecording(recording, { start: 0, end: 31 }), /exceeds/);
});

test("recordings persist original samples across store restarts with private files and validated IDs", async t => {
  const directory = await mkdtemp(join(tmpdir(), "mobile-dev-recording-"));
  t.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const store = new RecordingStore(directory);
  const recording = recordingFixture();
  await store.save(recording);
  const reopened = new RecordingStore(directory);
  assert.deepEqual(await reopened.read(recording.id), recording);
  const listed = await reopened.list(1);
  assert.equal(listed[0].id, recording.id);
  const filename = join(directory, `${recording.id}.json`);
  const metadata = await stat(filename);
  assert.equal(metadata.mode & 0o777, 0o600);
  const text = await readFile(filename, "utf8");
  assert.ok(text.includes('"threads"'));
  await assert.rejects(store.read("../private"));
});

test("timed recording returns immediately, collects and detaches without UI polling, and saves the run", async t => {
  const directory = await mkdtemp(join(tmpdir(), "mobile-dev-timed-recording-"));
  let stopped = 0;
  const cpu = new CpuSessions({ apps: async () => [{ bundleId: "com.example.shop", pid: 123 }], monitor: async options => {
    options.onSample({ timestampUs: 0n, intervalUs: 0, cpuPercent: null, memoryBytes: 1048576, threads: [] });
    const timer = setInterval(() => {
      options.onSample({ timestampUs: 1n, intervalUs: 100000, cpuPercent: 42, memoryBytes: 2097152, threads: [{ id: "main", name: "main", cpuPercent: 20 }] });
    }, 100);
    return { closed: new Promise(() => {}), async stop() { clearInterval(timer); stopped++; } };
  } });
  const recordings = new PerformanceRecordings(cpu, new RecordingStore(directory));
  t.after(async () => { await recordings.close(); await cpu.close(); await rm(directory, { recursive: true, force: true }); });
  const target = recordingFixture().target;
  const started = recordings.start(target, "Scroll", 1, "Pixel");
  assert.equal(started.status, "connecting");
  assert.deepEqual(started.samples, []);
  await setTimeout(1200);
  const finished = await recordings.read(started.id);
  assert.equal(finished.status, "finished");
  assert.equal(stopped, 1);
  assert.ok(finished.samples.length >= 9);
  assert.equal(finished.samples[0].time, 0);
  const reopened = await recordings.store.read(started.id);
  assert.deepEqual(reopened, finished);
  assert.equal(finished.samples[1].threads[0].cpuPercent, 20);
});

test("early finish and server shutdown both detach collectors; failures persist as failed runs", async t => {
  const directory = await mkdtemp(join(tmpdir(), "mobile-dev-failed-recording-"));
  let stopped = 0;
  const cpu = new CpuSessions({ apps: async () => [{ bundleId: "com.example.shop", pid: 123 }], monitor: async options => {
    options.onSample({ timestampUs: 0n, intervalUs: 1000000, cpuPercent: 15, memoryBytes: 100, threads: [] });
    return { closed: new Promise(() => {}), async stop() { stopped++; } };
  } });
  const recordings = new PerformanceRecordings(cpu, new RecordingStore(directory));
  t.after(async () => { await recordings.close(); await cpu.close(); await rm(directory, { recursive: true, force: true }); });
  const first = recordings.start(recordingFixture().target, "Early", 30, "Pixel");
  await setTimeout(10);
  const finished = await recordings.finish(first.id);
  assert.equal(finished.status, "finished");
  assert.equal(stopped, 1);
  const second = recordings.start(recordingFixture().target, "Interrupted", 30, "Pixel");
  await setTimeout(10);
  await recordings.close();
  const interrupted = await recordings.store.read(second.id);
  assert.equal(interrupted.status, "failed");
  assert.match(interrupted.error!, /server closed/);
  assert.equal(stopped, 2);
});
