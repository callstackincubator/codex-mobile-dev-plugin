import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { RecordingStore, PerformanceRecordings } from "../src/server/performance-recordings.ts";
import { registerRecordingTools } from "../src/server/recording-tools.ts";
import { RECORDING_URI } from "../src/shared/recordings.ts";
import { COMPARISON_URI } from "../src/shared/performance-comparison.ts";
import { recordingFixture, unavailableFps } from "./recording-fixtures.ts";

test("recording tools distinguish data, inline rendering, workspace opening and exact-range retrieval", async t => {
  const directory = await mkdtemp(join(tmpdir(), "mobile-dev-recording-tools-"));
  const store = new RecordingStore(directory);
  const recording = recordingFixture();
  recording.fps.samples[0].frameTimeline = {
    clock: "boottime", intervalEndNs: "9007200254740993", frames: [
      { token: "1", startTimeNs: "9007199744741116", endTimeNs: "9007199754741116", presentType: 2, jankType: 48 },
      { token: "2", startTimeNs: "9007200144740993", endTimeNs: "9007200154740993", presentType: 4 },
    ],
  };
  recording.fps.samples[1].frameTimeline = {
    clock: "boottime", intervalEndNs: "9007201254740993", frames: [
      { token: "3", startTimeNs: "9007200444740993", endTimeNs: "9007200454740993", presentType: 1 },
    ],
  };
  await store.save(recording);
  const recordings = new PerformanceRecordings({ open() { throw new Error("Already monitoring this app"); }, async read() { throw new Error("Not running"); }, async closeSession() {} }, unavailableFps, store);
  const server = new McpServer({ name: "recordings-test", version: "1" });
  registerRecordingTools(server, recordings, async () => "Pixel", "ui://test/workspace.html");
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "recordings-client", version: "1" });
  t.after(async () => { await client.close(); await server.close(); await recordings.close(); await rm(directory, { recursive: true, force: true }); });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const { tools } = await client.listTools();
  const comparing = tools.find(tool => tool.name === "mobile_compare_performance_recordings");
  assert.deepEqual(comparing?._meta?.ui, { resourceUri: COMPARISON_URI, visibility: ["app", "model"] });
  const second = recordingFixture();
  second.id = "44b7030b-a74e-466f-aeb0-bcd3ae8af972";
  second.title = "Checkout scroll · Run 2";
  second.durationSeconds = 15;
  second.samples = second.samples.slice(0, 16);
  second.fps.samples = second.fps.samples.slice(0, 15);
  await store.save(second);
  const comparisonArguments = { recordingIds: [recording.id, second.id], range: { start: 12, end: 18 } };
  const comparison = await client.callTool({ name: "mobile_compare_performance_recordings", arguments: comparisonArguments });
  assert.equal(comparison.isError, undefined);
  assert.deepEqual(comparison.structuredContent?.recordings, [recording, second]);
  const summaries = comparison.structuredContent?.summaries;
  assert.ok(Array.isArray(summaries));
  assert.deepEqual(summaries[1].range, { start: 12, end: 15 });
  assert.equal(summaries[1].summary.averageCpuPercent, 72);
  assert.equal(summaries[1].summary.averageFps, 30);
  for (const recordingIds of [[recording.id], [recording.id, recording.id], Array(7).fill(recording.id), [recording.id, "invalid"]]) {
    const invalidComparison = await client.callTool({ name: "mobile_compare_performance_recordings", arguments: { recordingIds } });
    assert.equal(invalidComparison.isError, true);
  }
  const missingComparison = await client.callTool({ name: "mobile_compare_performance_recordings", arguments: { recordingIds: [recording.id, "27cfecab-d99c-4533-90dd-e14a7cb0087b"] } });
  assert.equal(missingComparison.isError, true);
  const excessiveComparison = await client.callTool({ name: "mobile_compare_performance_recordings", arguments: { ...comparisonArguments, range: { start: 0, end: 31 } } });
  assert.equal(excessiveComparison.isError, true);
  second.status = "recording";
  await store.save(second);
  const activeComparison = await client.callTool({ name: "mobile_compare_performance_recordings", arguments: comparisonArguments });
  assert.equal(activeComparison.isError, true);
  second.status = "finished";
  await store.save(second);
  const rendering = tools.find(tool => tool.name === "mobile_render_performance_recording");
  assert.deepEqual(rendering?._meta?.ui, { resourceUri: RECORDING_URI, visibility: ["app", "model"] });
  const reading = tools.find(tool => tool.name === "mobile_read_performance_recording");
  assert.deepEqual(reading?._meta?.ui, { visibility: ["app", "model"] });
  const opening = tools.find(tool => tool.name === "mobile_open_performance_recording");
  assert.deepEqual(opening?._meta?.ui, { resourceUri: "ui://test/workspace.html", visibility: ["app", "model"] });
  for (const name of ["mobile_read_performance_recording", "mobile_render_performance_recording", "mobile_open_performance_recording"]) {
    const result = await client.callTool({ name, arguments: { recordingId: recording.id, range: { start: 12, end: 18 } } });
    assert.equal(result.isError, undefined);
    assert.deepEqual(result.structuredContent?.recording, recording);
    assert.deepEqual(result.structuredContent?.range, { start: 12, end: 18 });
    const summary = result.structuredContent?.summary;
    assert.ok(summary && typeof summary === "object" && "peakCpuPercent" in summary);
    assert.equal(summary.peakCpuPercent, 72);
    assert.equal(summary.averageFps, 30);
    assert.equal(summary.minimumFps, 30);
  }
  const listing = await client.callTool({ name: "mobile_list_performance_recordings", arguments: {} });
  const items = listing.structuredContent?.recordings;
  assert.ok(Array.isArray(items));
  const listed = items.find(item => item.id === recording.id);
  assert.equal(listed.sampleCount, 31);
  assert.equal(listed.samples, undefined);
  assert.equal(listed.fps.samples, undefined);
  assert.equal(listed.fps.sampleCount, 30);
  const framesInput = { recordingId: recording.id, range: { start: 0.4, end: 1.3 }, limit: 1 };
  const frames = await client.callTool({ name: "mobile_read_performance_frames", arguments: framesInput });
  assert.equal(frames.isError, undefined);
  assert.equal(frames.structuredContent?.available, true);
  assert.equal(frames.structuredContent?.clock, "boottime");
  assert.equal(frames.structuredContent?.frameCount, 3);
  assert.equal(frames.structuredContent?.nextCursor, 1);
  const frameStats = frames.structuredContent?.frameStats;
  assert.ok(frameStats && typeof frameStats === "object" && "jankRatePercent" in frameStats);
  assert.equal(frameStats.jankRatePercent, 100);
  assert.equal(frameStats.classificationCoveragePercent, 50);
  assert.equal(frameStats.droppedFrameCount, 1);
  assert.equal(frameStats.p95FrameIntervalMs, 699.999877);
  const firstPage = frames.structuredContent?.frames;
  assert.ok(Array.isArray(firstPage));
  assert.equal(firstPage[0].endTimeNs, "9007199754741116");
  assert.equal(firstPage[0].jankType, 48);
  assert.ok(Math.abs(firstPage[0].time - 0.500000123) < 1e-12);
  const remaining = await client.callTool({ name: "mobile_read_performance_frames", arguments: { ...framesInput, after: 1, limit: 2 } });
  assert.equal(remaining.isError, undefined);
  const lastPage = remaining.structuredContent?.frames;
  assert.ok(Array.isArray(lastPage));
  const tokens = lastPage.map(frame => frame.token);
  assert.deepEqual(tokens, ["2", "3"]);
  assert.equal(lastPage[0].presentType, 4, "Deep dives can inspect dropped frames.");
  assert.equal(remaining.structuredContent?.nextCursor, undefined);
  assert.deepEqual(remaining.structuredContent?.frameStats, frameStats, "Statistics cover the whole range, independently of pagination.");
  const general = await client.callTool({ name: "mobile_read_performance_recording", arguments: { recordingId: recording.id, range: framesInput.range } });
  const generalSummary = general.structuredContent?.summary;
  assert.ok(generalSummary && typeof generalSummary === "object" && "frameStats" in generalSummary);
  assert.deepEqual(generalSummary.frameStats, frameStats, "General reports use the same jank calculation as frame reports.");
  const tooMany = await client.callTool({ name: "mobile_read_performance_frames", arguments: { recordingId: recording.id, limit: 1001 } });
  assert.equal(tooMany.isError, true);
  const invalid = await client.callTool({ name: "mobile_read_performance_recording", arguments: { recordingId: recording.id, range: { start: 18, end: 12 } } });
  assert.equal(invalid.isError, true);
  const excessive = await client.callTool({ name: "mobile_read_performance_recording", arguments: { recordingId: recording.id, range: { start: 12, end: 40 } } });
  assert.equal(excessive.isError, true);
  const excessiveFrames = await client.callTool({ name: "mobile_read_performance_frames", arguments: { recordingId: recording.id, range: { start: 12, end: 40 } } });
  assert.equal(excessiveFrames.isError, true);
  const conflict = await client.callTool({ name: "mobile_record_performance", arguments: { target: recording.target, title: "Another run" } });
  assert.equal(conflict.isError, true);
});
