import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { DisplayFpsSessions } from "../src/server/fps/sessions.ts";
import { CpuSessions } from "../src/server/cpu/sessions.ts";
import { PerformanceRecordings, RecordingStore } from "../src/server/performance-recordings.ts";
import { summarizeRecording } from "../src/shared/recordings.ts";
import { recordingFixture, unavailableFps } from "./recording-fixtures.ts";

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
  const store = new RecordingStore(directory);
  const recordings = new PerformanceRecordings(cpu, unavailableFps, store);
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
  const store = new RecordingStore(directory);
  const recordings = new PerformanceRecordings(cpu, unavailableFps, store);
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

test("FPS summaries clip interval overlap, retain idle zero, and exclude missing readings", () => {
  const recording = recordingFixture();
  recording.fps.samples = [
    { time: 1, interval: 1, fps: 0 },
    { time: 3, interval: 2, fps: 60 },
    { time: 4, interval: 1, fps: null },
  ];
  const whole = summarizeRecording(recording);
  assert.equal(whole.averageFps, 40);
  assert.equal(whole.minimumFps, 0);
  assert.equal(whole.peakFps, 60);
  assert.equal(whole.fpsSampleCount, 3);
  const selected = summarizeRecording(recording, { start: 0.5, end: 2 });
  assert.equal(selected.averageFps, 40);
  assert.equal(selected.fpsSampleCount, 2);
  const empty = summarizeRecording(recording, { start: 3, end: 4 });
  assert.equal(empty.averageFps, null);
  assert.equal(empty.minimumFps, null);
});

test("saved CPU/memory runs without historical FPS data remain readable", async t => {
  const directory = await mkdtemp(join(tmpdir(), "mobile-dev-historical-recording-"));
  t.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const recording = recordingFixture();
  const { fps, ...historical } = recording;
  const filename = join(directory, `${recording.id}.json`);
  const text = JSON.stringify(historical);
  await writeFile(filename, text);
  const store = new RecordingStore(directory);
  const loaded = await store.read(recording.id);
  assert.deepEqual(loaded.samples, historical.samples);
  assert.equal(loaded.fps.status, "unavailable");
  assert.deepEqual(loaded.fps.samples, []);
});

test("timed recordings align FPS, wait for Android readback, replace revised intervals and detach both collectors", async t => {
  const directory = await mkdtemp(join(tmpdir(), "mobile-dev-fps-recording-"));
  let cpuStopped = 0;
  let fpsStopped = 0;
  const cpu = new CpuSessions({ apps: async () => [{ bundleId: "com.example.shop", pid: 123 }], monitor: async options => {
    options.onSample({ timestampUs: 0n, intervalUs: 0, cpuPercent: null, memoryBytes: 1048576, threads: [] });
    const timer = setInterval(() => {
      options.onSample({ timestampUs: 1n, intervalUs: 100000, cpuPercent: 42, memoryBytes: 2097152, threads: [] });
    }, 100);
    return { closed: new Promise(() => {}), async stop() { clearInterval(timer); cpuStopped++; } };
  } });
  const fps = new DisplayFpsSessions(async options => {
    const origin = performance.now() / 1000;
    const first = origin + 0.5;
    options.onSample({ recordedAt: origin, interval: 0, fps: null });
    const initial = globalThis.setTimeout(() => {
      options.onSample({ recordedAt: first, interval: 0.5, fps: 0 });
    }, 500);
    const late = globalThis.setTimeout(() => {
      options.onSample({ recordedAt: first, interval: 0.5, fps: 30 });
      options.onSample({ recordedAt: origin + 1.5, interval: 1, fps: 60 });
      options.onSample({ recordedAt: origin + 4, interval: 1, fps: 10 });
    }, 2000);
    return { closed: new Promise(() => {}), async stop() { clearTimeout(initial); clearTimeout(late); fpsStopped++; } };
  });
  const store = new RecordingStore(directory);
  const recordings = new PerformanceRecordings(cpu, fps, store);
  t.after(async () => { await recordings.close(); await cpu.close(); await fps.close(); await rm(directory, { recursive: true, force: true }); });
  const target = recordingFixture().target;
  const started = recordings.start(target, "Scroll with FPS", 1, "Pixel");
  assert.equal(started.status, "connecting");
  await setTimeout(1300);
  const draining = await recordings.read(started.id);
  assert.equal(draining.status, "finishing");
  assert.equal(cpuStopped, 1, "CPU stops at the recording deadline, before delayed FPS readback.");
  assert.equal(fpsStopped, 0);
  await setTimeout(4900);
  const finished = await recordings.read(started.id);
  assert.equal(finished.status, "finished");
  assert.equal(finished.fps.status, "finished");
  const measured = finished.fps.samples.filter(sample => sample.fps !== null);
  assert.equal(measured.length, 2, "A correction replaces its interval; out-of-range FPS is excluded.");
  assert.equal(measured[0].fps, 30);
  assert.ok(measured[0].time > 0.4 && measured[0].time < 0.6, "FPS uses the CPU recording's origin.");
  assert.equal(measured[1].fps, 60);
  assert.ok(measured[1].time > 1, "The original interval endpoint is retained for range-weighted summaries.");
  assert.equal(cpuStopped, 1);
  assert.equal(fpsStopped, 1);
  const reopened = await store.read(started.id);
  assert.deepEqual(reopened, finished);
  const selected = summarizeRecording(reopened, { start: 0.6, end: 1 });
  assert.equal(selected.averageFps, 60);
});

test("FPS failure saves CPU/memory, and server shutdown closes both active collectors", async t => {
  const directory = await mkdtemp(join(tmpdir(), "mobile-dev-fps-failure-"));
  let cpuStopped = 0;
  let fpsStopped = 0;
  const cpu = new CpuSessions({ apps: async () => [{ bundleId: "com.example.shop", pid: 123 }], monitor: async options => {
    options.onSample({ timestampUs: 0n, intervalUs: 0, cpuPercent: null, memoryBytes: 100, threads: [] });
    const timer = setInterval(() => {
      options.onSample({ timestampUs: 1n, intervalUs: 100000, cpuPercent: 12, memoryBytes: 100, threads: [] });
    }, 100);
    return { closed: new Promise(() => {}), async stop() { clearInterval(timer); cpuStopped++; } };
  } });
  let fail: ((error: Error) => void) | undefined;
  const fps = new DisplayFpsSessions(async options => {
    options.onSample({ recordedAt: performance.now() / 1000, interval: 0, fps: null });
    const closed = new Promise<Error>(resolve => { fail = resolve; });
    return { closed, async stop() { fpsStopped++; } };
  });
  const store = new RecordingStore(directory);
  const recordings = new PerformanceRecordings(cpu, fps, store);
  t.after(async () => { await recordings.close(); await cpu.close(); await fps.close(); await rm(directory, { recursive: true, force: true }); });
  const first = recordings.start(recordingFixture().target, "FPS unavailable", 30, "Pixel");
  await setTimeout(150);
  assert.ok(fail);
  fail(new Error("Lost FPS connection"));
  await setTimeout(150);
  const saved = await recordings.finish(first.id);
  assert.equal(saved.status, "finished");
  assert.equal(saved.fps.status, "unavailable");
  assert.match(saved.fps.error!, /Lost FPS connection/);
  assert.ok(saved.samples.length > 0);
  assert.equal(cpuStopped, 1);
  const stoppedAfterFailure = fpsStopped;
  const second = recordings.start(recordingFixture().target, "Interrupted", 30, "Pixel");
  await setTimeout(150);
  await recordings.close();
  const interrupted = await store.read(second.id);
  assert.equal(interrupted.status, "failed");
  assert.equal(cpuStopped, 2);
  assert.equal(fpsStopped, stoppedAfterFailure + 1);
});
