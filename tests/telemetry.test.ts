import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Sentry from "@sentry/node";
import type { Envelope } from "@sentry/core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { z } from "zod";
import { MeasurementWindow, sampleTrace, scrubErrorEvent, scrubMetric, scrubSpan, TELEMETRY_META_KEY } from "../src/shared/telemetry.ts";
import { captureServerError, installTracePropagation, IOSLogProcessingTelemetry } from "../src/server/telemetry.ts";
import { directoryBytes } from "../src/server/storage-metrics.ts";
import { SimulatorUnavailableError } from "../src/server/simulator-unavailable.ts";
import { registerDeviceChoiceTools } from "../src/server/device-choice-tools.ts";
import type { OpenAIFormResult } from "@openai/mcp-extensions/server";
import { adapterClient } from "./agent-device-fixtures.ts";
import {QueuedAppFlowRuns as AppFlowRuns} from "./app-flow-queue-fixture.ts";
import { flowRunning } from "../src/shared/app-flow.ts";
import {captureBatch} from "../src/server/app-flow/capture-batch.ts";
import {queuedBackend} from "./app-flow-queue-fixture.ts";
import {FlowRuntimeMetrics,FlowRuntimeTimeout} from '../src/server/app-flow/runtime-metrics.ts';

test('local runtime totals retain fixed names across flushes without retaining command data',()=>{
  const metrics=new FlowRuntimeMetrics('ios');
  metrics.record('open',10,false);metrics.record('open',20,true);metrics.record('/private/app/secret',30,false);
  metrics.record('open',NaN,false);metrics.record('open',-1,false);
  const before=metrics.snapshot();
  assert.deepEqual(before,[{operation:'open',count:2,totalMs:30,maxMs:20,timeouts:1},{operation:'other',count:1,totalMs:30,maxMs:30,timeouts:0}]);
  before[0].count=100;
  metrics.flush();metrics.record('open',40,false);
  assert.equal(metrics.snapshot()[0].count,3);assert.equal(metrics.snapshot()[0].totalMs,70);
  assert.equal(JSON.stringify(metrics.snapshot()).includes('secret'),false);
});

function contains(text: string, fragment: string, expected = true) {
  const included = text.includes(fragment);
  assert.equal(included, expected, `Telemetry fragment: ${fragment}`);
}

test("App Flow reports bounded readiness, loading, and reconnect timings without screen data", async t => {
  const envelopes: Envelope[] = [];
  Sentry.init({ dsn: "https://public@example.com/1", defaultIntegrations: false, beforeSendMetric: scrubMetric,
    transport: () => ({ async send(envelope) { envelopes.push(envelope); return { statusCode: 200 }; }, async flush() { return true; } }),
  });
  const directory = await mkdtemp(join(tmpdir(), "flow-metrics-"));
  t.after(() => rm(directory, {recursive:true,force:true}));
  let connections=0;
  const runs = new AppFlowRuns({directory, scan: async()=>({files:1,scanMs:3,warnings:[],edges:[],nodes:[{id:'screen',name:'PRIVATE_SCREEN',kind:'screen',path:['PRIVATE_SCREEN'],required:[],status:'pending'}]}),
    connect: async()=>{const generation=++connections;return {runtime:{async invoke(command){if(command.type==='inspect'||command.type==='resume')return {available:true};if(generation===1)throw Error('disconnected');return {ready:true,found:true,name:'PRIVATE_SCREEN',active:['PRIVATE_SCREEN'],motion:'PRIVATE_ANIMATION_INPUT',readinessMs:345,loadingMs:210}},async close(){}},async screenshot(){return Buffer.from('PRIVATE_PNG')}}},
  });
  const run=runs.start({projectRoot:'PRIVATE_PATH',deviceId:'PRIVATE_DEVICE',platform:'ios',targetId:'PRIVATE_TARGET',metroUrl:'http://127.0.0.1:8081',useAi:false});
  while(flowRunning(runs.read(run.id))) await new Promise(resolve=>setTimeout(resolve,5));
  await runs.close(); await Sentry.close();
  const metrics=JSON.stringify(envelopes.flatMap(envelope=>envelope[1]).filter(item=>item[0].type==='trace_metric'));
  for(const name of ['app_flow.readiness.mean','app_flow.loading.p95','app_flow.capture.max','app_flow.reconnect.mean','app_flow.reconnects','app_flow.recovery_continuations','app_flow.retries','app_flow.checkpoint.mean','app_flow.run_phase','first-attempt','reconnect','app-flow','device_platform']) contains(metrics,name);
  for(const value of ['PRIVATE_SCREEN','PRIVATE_PNG','PRIVATE_PATH','PRIVATE_DEVICE','PRIVATE_TARGET','PRIVATE_ANIMATION_INPUT']) contains(metrics,value,false);
});

test("UI timing windows retain exact totals, reset, and ignore invalid measurements", () => {
  const window = new MeasurementWindow();
  for (let value = 1; value <= 200; value++) window.record(value);
  window.record(Number.NaN);
  window.record(-1);
  const initial = window.take();
  assert.deepEqual(initial, { count: 200, mean: 100.5, p95: 190, max: 200 });
  const empty = window.take();
  assert.equal(empty, undefined);
  for (let index = 0; index < 100_000; index++) window.record(16);
  const many = window.take();
  assert.deepEqual(many, { count: 100_000, mean: 16, p95: 16, max: 16 });
});

test('runtime timing and timeout metrics use fixed operation names and no command data',async()=>{
  const envelopes:Envelope[]=[];
  Sentry.init({dsn:'https://public@example.com/1',defaultIntegrations:false,beforeSendMetric:scrubMetric,
    transport:()=>({async send(envelope){envelopes.push(envelope);return {statusCode:200}},async flush(){return true}})});
  const metrics=new FlowRuntimeMetrics('ios');
  for(let i=0;i<3000;i++)metrics.record('presentation-collect',12,false);
  metrics.record('presentation-collect',2500,true);metrics.record('context-data',15,false);metrics.record('presentation-effects',81,false);metrics.record('presentation-handoff',340,false);metrics.record('PRIVATE_COMMAND',20,true);metrics.flush();metrics.flush();
  await Sentry.close();
  const payload=JSON.stringify(envelopes.flatMap(envelope=>envelope[1]).filter(item=>item[0].type==='trace_metric'));
  for(const value of ['app_flow.runtime.mean','app_flow.runtime.p95','app_flow.runtime.max','app_flow.runtime.timeouts','presentation-collect','context-data','presentation-effects','presentation-handoff','other','app-flow','device_platform'])contains(payload,value);
  contains(payload,'PRIVATE_',false);assert.doesNotMatch(new FlowRuntimeTimeout('PRIVATE_COMMAND').message,/PRIVATE_/);
});

test('automatic local forms report bounded capture and binding costs without source or UI state',async t=>{
  const envelopes:Envelope[]=[];
  Sentry.init({dsn:'https://public@example.com/1',defaultIntegrations:false,beforeSendMetric:scrubMetric,
    transport:()=>({async send(envelope){envelopes.push(envelope);return {statusCode:200}},async flush(){return true}})});
  const directory=await mkdtemp(join(tmpdir(),'flow-presentation-metrics-'));let opened=false;
  const action:any={id:'PRIVATE_ACTION',name:'PRIVATE_FORM',file:'PRIVATE_SOURCE',line:12,owner:'PRIVATE_OWNER',component:'PRIVATE_BUTTON',prop:'onPress',effect:{kind:'state',site:'PRIVATE_SITE',path:['PRIVATE_FIELD'],value:'PRIVATE_STATE'}};
  const view:any={id:'PRIVATE_CATALOG_VIEW',name:'PRIVATE_CATALOG_FORM',file:'PRIVATE_CATALOG_SOURCE',availability:'observed-only'};
  const preview:any={...action,id:'PRIVATE_PREVIEW',preview:true,views:[view.id]};
  const runs=new AppFlowRuns({directory,scan:async()=>({files:1,scanMs:3,catalogMs:1,sourceHash:'PRIVATE_SOURCE_HASH',warnings:[],nodes:[],edges:[],presentations:{states:[],actions:[action],previews:[preview],previewStates:[],views:[view],viewStates:[]}}),connect:async()=>({
    runtime:{async close(){},async invoke(command:any){
      if(command.type==='inspect')return {available:false};
      if(command.type==='presentation-setup')assert.equal(command.catalog.views,undefined);
      if(command.type==='presentation-view')return {key:opened?'PRIVATE_FORM':'PRIVATE_ENTRY',signature:'PRIVATE_CONTENT',ready:true,found:true};
      if(command.type==='presentation-checkpoint')return {level:0};
      if(command.type==='presentations')return opened?[]:[action];
      if(command.type==='presentation-prepare')return {available:true};
    if(command.type==='presentation-open'){opened=true;return {ready:false};}
      if(command.type==='presentation-rollback')opened=false;
      return {};
    }},async screenshot(){return Buffer.from(opened?'PRIVATE_FORM_IMAGE':'PRIVATE_ENTRY_IMAGE')},
  })});
  t.after(async()=>{await runs.close();await Sentry.close();await rm(directory,{recursive:true,force:true})});
  const run=runs.start({projectRoot:'PRIVATE_PATH',deviceId:'PRIVATE_DEVICE',platform:'ios',targetId:'PRIVATE_TARGET',metroUrl:'http://127.0.0.1:8081',useAi:false});
  while(flowRunning(runs.read(run.id)))await new Promise(resolve=>setTimeout(resolve,5));
  await runs.close();await Sentry.close();
  const metrics=JSON.stringify(envelopes.flatMap(envelope=>envelope[1]).filter(item=>item[0].type==='trace_metric'));
  for(const name of ['app_flow.planning.mean','app_flow.source_catalog','app_flow.source_candidates','app_flow.preview_plans','app_flow.previews_captured','app_flow.previews_blocked','app_flow.presentations','app_flow.presentations_captured','app_flow.presentation.mean','app_flow.presentation_binding.p95','app_flow.presentation_discovery.mean','app-flow','device_platform'])contains(metrics,name);
  contains(metrics,'PRIVATE_',false);
});

test('flow recording reports capture and save costs without flow names or app data', async t => {
  const envelopes: Envelope[] = [];
  Sentry.init({ dsn:'https://public@example.com/1', defaultIntegrations:false, beforeSendMetric:scrubMetric,
    transport:() => ({async send(envelope){envelopes.push(envelope);return {statusCode:200}},async flush(){return true}}),
  });
  const directory = await mkdtemp(join(tmpdir(),'flow-recording-metrics-'));
  const runs = new AppFlowRuns({directory,connect:async()=>({runtime:{async invoke(){return {key:'PRIVATE_VIEW',signature:'PRIVATE_CONTENT',title:'PRIVATE_TITLE',ready:true,active:[]}},async close(){}},async screenshot(){return Buffer.from('PRIVATE_IMAGE')}})});
  t.after(async()=>{await runs.close();await Sentry.close();await rm(directory,{recursive:true,force:true})});
  const run = await runs.record({projectRoot:'PRIVATE_PATH',deviceId:'PRIVATE_DEVICE',platform:'ios',targetId:'PRIVATE_TARGET',metroUrl:'http://127.0.0.1:8081',useAi:false},'PRIVATE_FLOW');
  for(let i=0;i<100&&!runs.read(run.id).nodes.length;i++)await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(runs.read(run.id).nodes.length,1);
  await runs.close();await Sentry.close();
  const metrics = JSON.stringify(envelopes.flatMap(envelope=>envelope[1]).filter(item=>item[0].type==='trace_metric'));
  for(const name of ['app_flow.recording','app_flow.record_frame.mean','app_flow.recorded_screens','app_flow.checkpoint.mean','app-flow']) contains(metrics,name);
  for(const value of ['PRIVATE_FLOW','PRIVATE_VIEW','PRIVATE_CONTENT','PRIVATE_TITLE','PRIVATE_IMAGE','PRIVATE_PATH','PRIVATE_DEVICE','PRIVATE_TARGET']) contains(metrics,value,false);
});

test('preview failures report a fixed error without the app exception or source',async()=>{
  const envelopes:Envelope[]=[];
  Sentry.init({dsn:'https://public@example.com/1',defaultIntegrations:false,beforeSend:scrubErrorEvent,
    transport:()=>({async send(envelope){envelopes.push(envelope);return {statusCode:200}},async flush(){return true}})});
  let opened=false;
  const node:any={id:'PRIVATE_NODE',name:'PRIVATE_FORM',kind:'screen',path:[],required:[],status:'pending',presentation:{actions:['PRIVATE_ACTION'],basePath:[]}};
  const run:any={id:'PRIVATE_RUN',revision:0,nodes:[node],edges:[],presentations:{states:[],actions:[{id:'PRIVATE_ACTION'}]}};
  const backend:any={screenshot:async()=>Buffer.from('PRIVATE_IMAGE'),runtime:{async invoke(command:any){
    if(command.type==='presentations')return [{id:'PRIVATE_ACTION'}];
    if(command.type==='presentation-prepare')return {available:true};
    if(command.type==='presentation-open'){opened=true;return {ready:false};}
    if(command.type==='presentation-view')return {key:'PRIVATE_VIEW',error:opened?'PRIVATE_APP_ERROR':undefined};
    if(command.type==='presentation-rollback')opened=false;
    return {};
  }}};
  try{
    await captureBatch({backend:queuedBackend(backend),run,directory:'PRIVATE_PATH',projectRoot:'PRIVATE_PATH',signal:new AbortController().signal,async save(){},manifest:{version:1,total:1,jobs:[{id:node.id,path:[],actions:[{id:'PRIVATE_ACTION'} as any],sourceViews:[]}]}});
    assert.equal(node.status,'blocked');
    assert.equal(opened,false,'A failed preview still restores its entry');
    await Sentry.flush();
    const errors=JSON.stringify(envelopes.flatMap(envelope=>envelope[1]).filter(item=>item[0].type==='event'));
    contains(errors,'App Flow presentation capture failed.');contains(errors,'app_flow.presentation');contains(errors,'PRIVATE_',false);
  }finally{await Sentry.close();}
});

test("high frequency reads and input avoid trace sampling even with a sampled parent", () => {
  let inherited = 0;
  const inherit = (rate: number) => { inherited++; return rate; };
  for (const name of ["resources/read frame://private-session", "notifications/tools/list_changed", "tools/call mobile_stream_input", "tools/call mobile_ios_mirror_input", "tools/call mobile_read_cpu", "tools/call mobile_read_app_flow", "tools/call devices", "tools/call session", "tools/call events"]) {
    const rate = sampleTrace(name, inherit);
    assert.equal(rate, 0);
  }
  assert.equal(inherited, 0);
  const rate = sampleTrace("tools/call mobile_cpu_session", inherit);
  assert.equal(rate, 0.1);
  const screenshotRate = sampleTrace("tools/call mobile_ios_mirror_capture_screenshot", inherit);
  assert.equal(screenshotRate, 0.1);
});

test("iOS parser telemetry aggregates bounded timings and flushes once on stream cleanup", async t => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const envelopes: Envelope[] = [];
  Sentry.init({
    dsn: "https://public@example.com/1", defaultIntegrations: false, beforeSendMetric: scrubMetric,
    transport: () => ({ async send(envelope) { envelopes.push(envelope); return { statusCode: 200 }; }, async flush() { return true; } }),
  });
  t.after(async () => { await Sentry.close(); });
  const telemetry = new IOSLogProcessingTelemetry("physical");
  t.after(() => telemetry.close());
  for (let index = 0; index < 1000; index++) telemetry.record(2);
  await Sentry.flush();
  const before = JSON.stringify(envelopes);
  contains(before, "logs.ios.parse", false);
  t.mock.timers.tick(30000);
  await Sentry.flush();
  const periodic = JSON.stringify(envelopes);
  for (const name of ["samples", "mean", "p95", "max"]) contains(periodic, `logs.ios.parse.${name}`);
  contains(periodic, "millisecond");
  contains(periodic, '"surface":{"value":"logs"');
  contains(periodic, '"device_kind":{"value":"physical"');
  contains(periodic, '"device_platform":{"value":"ios"');
  telemetry.record(3);
  telemetry.close();
  await Sentry.flush();
  const closed = JSON.stringify(envelopes);
  telemetry.record(4);
  telemetry.close();
  t.mock.timers.tick(60000);
  await Sentry.flush();
  const after = JSON.stringify(envelopes);
  assert.equal(after, closed, "Closing stops the timer and ignores late measurements.");
});

test("Agent Device adapter continues traces and reports failures without native tool payloads", async t => {
  const envelopes: Envelope[] = [];
  Sentry.init({
    dsn: "https://public@example.com/1", defaultIntegrations: false,
    tracesSampler: context => context.inheritOrSampleWith(1), beforeSend: scrubErrorEvent, beforeSendSpan: scrubSpan,
    transport: () => ({ async send(envelope) { envelopes.push(envelope); return { statusCode: 200 }; }, async flush() { return true; } }),
  });
  t.after(async () => { await Sentry.close(); });
  let observedTrace: string | undefined;
  let calls = 0;
  const { client } = await adapterClient(t, async () => {
    calls++;
    const span = Sentry.getActiveSpan();
    observedTrace = span?.spanContext().traceId;
    if (calls === 2) throw new Error("PRIVATE_NATIVE_ERROR with PRIVATE_NATIVE_ARGUMENT");
    if (calls > 2) return { isError: true, content: [], structuredContent: { code: "DEVICE_NOT_FOUND", message: "PRIVATE_STOPPED_DEVICE" } };
    return { isError: true, content: [{ type: "text", text: "PRIVATE_NATIVE_RESULT" }] };
  });
  const traceId = "1234567890abcdef1234567890abcdef";
  await client.callTool({ name: "type", arguments: { session: "PRIVATE_SESSION", text: "PRIVATE_NATIVE_ARGUMENT" }, _meta: {
    "sentry-trace": `${traceId}-1234567890abcdef-1`,
  } });
  assert.equal(observedTrace, traceId);
  await client.callTool({ name: "type", arguments: { session: "PRIVATE_SESSION", text: "PRIVATE_NATIVE_ARGUMENT" } });
  await Sentry.flush();
  const encoded = JSON.stringify(envelopes);
  contains(encoded, "PRIVATE_", false);
  contains(encoded, traceId);
  contains(encoded, "Agent Device command failed.");
  contains(encoded, "Agent Device tool transport failed.");
  contains(encoded, "agent_device.catalog.ready");
  const items = envelopes.flatMap(envelope => envelope[1]);
  const errors = items.filter(item => item[0].type === "event");
  await client.callTool({ name: "type", arguments: { session: "PRIVATE_SESSION", text: "PRIVATE_NATIVE_ARGUMENT" } });
  await Sentry.flush();
  const afterItems = envelopes.flatMap(envelope => envelope[1]);
  const afterErrors = afterItems.filter(item => item[0].type === "event");
  assert.equal(afterErrors.length, errors.length, "Expected unavailable devices must not produce Sentry issues");
});

test("error and streamed-span filters remove app payloads and local identifiers", () => {
  const traceId = "1".repeat(32);
  const spanId = "2".repeat(16);
  const filtered = scrubErrorEvent({
    message: "Failed /Users/alice/private.log for alice@example.com at https://private.test/path Bearer SECRET",
    request: { data: "private request" }, extra: { logs: "private logs" }, user: { email: "alice@example.com" }, server_name: "private-host",
    exception: { values: [{ value: "Command failed: secret --token password", mechanism: { type: "generic", data: { input: "private input" } }, stacktrace: { frames: [{ filename: "app:///mobile-dev-ui.js", vars: { token: "private" }, pre_context: ["private"], context_line: "private", post_context: ["private"] }] } }] },
    contexts: { trace: { trace_id: traceId, span_id: spanId, data: { logs: "private" } }, device: { name: "private device" } },
  });
  const encoded = JSON.stringify(filtered);
  contains(encoded, "private", false);
  contains(encoded, "alice", false);
  contains(encoded, "SECRET", false);
  assert.equal(filtered.exception?.values?.[0].value, "Child process command failed");
  assert.equal(filtered.exception?.values?.[0].stacktrace?.frames?.[0].filename, "app:///mobile-dev-ui.js");
  const span = scrubSpan({
    trace_id: traceId, span_id: spanId, name: "resources/read frame://private-session", start_timestamp: 1, timestamp: 2,
    attributes: { "mcp.request.argument.secret": "private", "mcp.response.content": "private", "mcp.resource.uri": "private", "error.message": "private", surface: "logs" },
  });
  assert.equal(span.name, "resources/read");
  assert.deepEqual(span.attributes, { surface: "logs" });
});

test("UI trace context crosses the MCP bridge and handled server errors exclude tool payloads", async t => {
  const envelopes: Envelope[] = [];
  Sentry.init({
    dsn: "https://public@example.com/1", defaultIntegrations: false,
    tracesSampler: context => context.inheritOrSampleWith(1), beforeSend: scrubErrorEvent, beforeSendSpan: scrubSpan,
    transport: () => ({ async send(envelope) { envelopes.push(envelope); return { statusCode: 200 }; }, async flush() { return true; } }),
  });
  const server = new McpServer({ name: "telemetry-test", version: "1" });
  Sentry.wrapMcpServerWithSentry(server, { recordInputs: false, recordOutputs: false });
  let observedTrace: string | undefined;
  let observedTags: Record<string, unknown> | undefined;
  const secret = z.string();
  server.registerTool("test_action", { inputSchema: { secret } }, async () => {
    const span = Sentry.getActiveSpan();
    observedTrace = span?.spanContext().traceId;
    const scope = Sentry.getIsolationScope();
    observedTags = scope.getScopeData().tags;
    const error = new Error("Handled tool failed /Users/alice/private.log");
    captureServerError(error, "test_action");
    return { isError: true, content: [{ type: "text", text: "PRIVATE_TOOL_RESULT" }] };
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  installTracePropagation(serverTransport);
  const client = new Client({ name: "test-client", version: "1" });
  t.after(async () => { await client.close(); await server.close(); await Sentry.close(); });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const traceId = "1234567890abcdef1234567890abcdef";
  const parentId = "1234567890abcdef";
  await client.callTool({ name: "test_action", arguments: { secret: "PRIVATE_TOOL_ARGUMENT" }, _meta: {
    "sentry-trace": `${traceId}-${parentId}-1`,
    [TELEMETRY_META_KEY]: { surface: "logs", layout: "both", view: "workspace", device_platform: "ios", device_kind: "physical", user: "PRIVATE_USER", logs: "PRIVATE_LOGS", component: "spoofed" },
  } });
  assert.equal(observedTrace, traceId);
  assert.equal(observedTags?.surface, "logs");
  assert.equal(observedTags?.layout, "both");
  assert.equal(observedTags?.user, undefined);
  assert.equal(observedTags?.component, undefined);
  await client.callTool({ name: "test_action", arguments: { secret: "PRIVATE_RECORDING_ARGUMENT" }, _meta: {
    [TELEMETRY_META_KEY]: { surface: "recording", view: "recording", recordingId: "PRIVATE_RECORDING_ID" },
  } });
  assert.equal(observedTags?.surface, "recording");
  assert.equal(observedTags?.view, "recording");
  assert.equal(observedTags?.recordingId, undefined);
  await client.callTool({ name: "test_action", arguments: { secret: "PRIVATE_COMPARISON_ARGUMENT" }, _meta: {
    [TELEMETRY_META_KEY]: { surface: "comparison", view: "comparison", device_platform: "mixed", device_kind: "none", recordingIds: ["PRIVATE_RUN_A", "PRIVATE_RUN_B"] },
  } });
  assert.equal(observedTags?.surface, "comparison");
  assert.equal(observedTags?.view, "comparison");
  assert.equal(observedTags?.device_platform, "mixed");
  assert.equal(observedTags?.device_kind, "none");
  assert.equal(observedTags?.recordingIds, undefined);
  await client.callTool({ name: "test_action", arguments: { secret: "PRIVATE_FLOW_PARAMS" }, _meta: {
    [TELEMETRY_META_KEY]: { surface: "app-flow", view: "workspace", route: "PRIVATE_ROUTE", projectRoot: "PRIVATE_PATH" },
  } });
  assert.equal(observedTags?.surface, "app-flow");
  assert.equal(observedTags?.route, undefined);
  assert.equal(observedTags?.projectRoot, undefined);
  await Sentry.flush();
  const encoded = JSON.stringify(envelopes);
  contains(encoded, "PRIVATE_", false);
  contains(encoded, "alice", false);
  contains(encoded, traceId);
  contains(encoded, "Handled tool failed");
  const eventItems = envelopes.flatMap(envelope => envelope[1]);
  const errors = eventItems.filter(item => item[0].type === "event");
  assert.equal(errors.length, 4);
  const unavailable = new SimulatorUnavailableError("Expected stopped simulator");
  captureServerError(unavailable, "expected");
  await Sentry.flush();
  const afterItems = envelopes.flatMap(envelope => envelope[1]);
  const afterErrors = afterItems.filter(item => item[0].type === "event");
  assert.equal(afterErrors.length, 4);
});

test("error filters retain only generated identity while metrics and spans omit user dimensions", async () => {
  const userId = "anon_0123456789abcdef0123456789abcdef";
  const sessionId = "run_1234567890abcdef1234567890abcdef";
  const filtered = scrubErrorEvent({
    user: { id: userId, email: "private@example.com", username: "private-name", ip_address: "127.0.0.1", extra: "private-account" },
    tags: { telemetry_session: sessionId, surface: "logs" },
  });
  assert.deepEqual(filtered.user, { id: userId });
  assert.equal(filtered.tags?.telemetry_session, sessionId);
  const rejected = scrubErrorEvent({ user: { id: "private-account" }, tags: { telemetry_session: "private-thread" } });
  assert.equal(rejected.user, undefined);
  assert.equal(rejected.tags?.telemetry_session, undefined);
  const envelopes: Envelope[] = [];
  Sentry.init({
    dsn: "https://public@example.com/1", defaultIntegrations: false,
    initialScope: { user: { id: userId }, tags: { telemetry_session: sessionId } },
    beforeSend: scrubErrorEvent, beforeSendMetric: scrubMetric,
    transport: () => ({ async send(envelope) { envelopes.push(envelope); return { statusCode: 200 }; }, async flush() { return true; } }),
  });
  const error = new Error("Anonymous identity test");
  captureServerError(error, "identity.test");
  Sentry.metrics.count("identity.test", 1, { attributes: { surface: "logs", telemetry_session: sessionId } });
  await Sentry.close();
  const items = envelopes.flatMap(envelope => envelope[1]);
  const errors = items.filter(item => item[0].type === "event");
  assert.equal(errors.length, 1);
  const encodedError = JSON.stringify(errors[0]);
  contains(encodedError, userId);
  contains(encodedError, sessionId);
  const metrics = items.filter(item => item[0].type === "trace_metric");
  assert.ok(metrics.length > 0);
  const encodedMetrics = JSON.stringify(metrics);
  contains(encodedMetrics, userId, false);
  contains(encodedMetrics, sessionId, false);
  const span = scrubSpan({ trace_id: "1".repeat(32), span_id: "2".repeat(16), name: "identity.test", start_timestamp: 1, timestamp: 2,
    attributes: { "user.id": userId, "user.email": "private@example.com", "session.id": sessionId, telemetry_session: sessionId, surface: "logs" } });
  assert.deepEqual(span.attributes, { surface: "logs" });
});

test("native device picker measures preparation and outcomes without private form content", async t => {
  const envelopes: Envelope[] = [];
  Sentry.init({
    dsn: "https://public@example.com/1", defaultIntegrations: false,
    beforeSend: scrubErrorEvent, beforeSendMetric: scrubMetric,
    transport: () => ({ async send(envelope) { envelopes.push(envelope); return { statusCode: 200 }; }, async flush() { return true; } }),
  });
  const server = new McpServer({ name: "picker-telemetry", version: "1" });
  let answer: OpenAIFormResult = { action: "accept", content: { device: "device-1" } };
  registerDeviceChoiceTools(server, { async elicitInput() { return answer; } }, {
    async simulators() { throw new Error("PRIVATE unrelated discovery"); },
    async physicalIos() { throw new Error("PRIVATE unrelated discovery"); },
    async android() { return { connected: true, managed: false, baseUrl: "", devices: [
      { udid: "PRIVATE_SERIAL", name: "PRIVATE_DEVICE_NAME", runtime: "Android", state: "Booted", platform: "android", kind: "physical" },
    ] }; },
  });
  const client = new Client({ name: "picker-host", version: "1" }, { capabilities: { extensions: { "openai/elicitation": { form: {} } } } });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  t.after(async () => { await client.close(); await server.close(); await Sentry.close(); });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const arguments_ = { message: "PRIVATE_QUESTION", context: "PRIVATE_OPERATION", devices: [
    { platform: "android", kind: "physical", deviceId: "PRIVATE_SERIAL", appName: "PRIVATE_APP" },
  ] };
  for (const action of ["accept", "cancel", "decline"] as const) {
    answer = action === "accept" ? { action, content: { device: "device-1" } } : { action };
    const result = await client.callTool({ name: "mobile_choose_devices", arguments: arguments_ });
    assert.equal(result.isError, undefined);
  }
  answer = { action: "accept", content: { device: "not-offered" } };
  const invalid = await client.callTool({ name: "mobile_choose_devices", arguments: arguments_ });
  assert.equal(invalid.isError, true);
  await Sentry.close();
  const encoded = JSON.stringify(envelopes);
  contains(encoded, "device_picker.prepare");
  contains(encoded, "device_picker.result");
  contains(encoded, "device_picker.selected");
  contains(encoded, "PRIVATE", false);
  contains(encoded, "device-1", false);
  contains(encoded, "selection_mode");
  contains(encoded, "millisecond");
  const items = envelopes.flatMap(envelope => envelope[1]);
  const errors = items.filter(item => item[0].type === "event");
  assert.equal(errors.length, 0, "Expected stale/invalid device responses do not produce issues.");
});

test("storage measurements count owned files without following external symlinks", async t => {
  const temporary = tmpdir();
  const prefix = join(temporary, "mobile-dev-storage-test-");
  const directory = await mkdtemp(prefix);
  t.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const owned = join(directory, "owned");
  const nested = join(owned, "nested");
  await mkdir(nested, { recursive: true });
  const first = join(owned, "one");
  const second = join(nested, "two");
  await writeFile(first, "123");
  await writeFile(second, "12345");
  const external = join(directory, "external");
  await writeFile(external, "external private data");
  const link = join(owned, "link");
  await symlink(external, link);
  const bytes = await directoryBytes(owned);
  assert.equal(bytes, 8);
  const missing = join(directory, "missing");
  const absentBytes = await directoryBytes(missing);
  assert.equal(absentBytes, 0);
});

test("Node runtime metrics report CPU, memory and event-loop measurements with component labels", async t => {
  const envelopes: Envelope[] = [];
  const runtimeMetrics = Sentry.nodeRuntimeMetricsIntegration({ collectionIntervalMs: 1000, collect: { memExternal: true } });
  Sentry.init({
    dsn: "https://public@example.com/1", defaultIntegrations: false,
    integrations: [runtimeMetrics],
    transport: () => ({ async send(envelope) { envelopes.push(envelope); return { statusCode: 200 }; }, async flush() { return true; } }),
  });
  t.after(async () => { await Sentry.close(); });
  Sentry.setAttribute("component", "server");
  await new Promise(resolve => { setTimeout(resolve, 1100); });
  await Sentry.flush();
  const encoded = JSON.stringify(envelopes);
  for (const name of ["node.runtime.cpu.utilization", "node.runtime.mem.rss", "node.runtime.mem.heap_used", "node.runtime.mem.external", "node.runtime.mem.array_buffers", "node.runtime.event_loop.delay.p99", "node.runtime.event_loop.utilization"]) {
    contains(encoded, name);
  }
  contains(encoded, '"component":{"value":"server"');
});
