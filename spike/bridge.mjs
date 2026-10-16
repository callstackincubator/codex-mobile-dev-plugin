// Spike A — MCP bridge payload transport measurements.
//
// Models the REAL chain the explore payload will travel:
//
//   App (iframe view; ext-apps `App`)
//     ── [postMessage-like transport] ──  AppBridge (host; ext-apps `AppBridge`)
//     ── [SDK Client + zod parse] ──      McpServer + registerAppTool (plugin server)
//
// Both transports JSON.stringify + JSON.parse every message, because the real
// chain serializes twice: MCP server→host over stdio JSON, host→iframe over
// postMessage (structured clone ≈ full copy cost). InMemoryTransport passes
// objects by reference, so we add the serialization ourselves.
//
// WHAT THIS DOES NOT MODEL (host properties we cannot replicate):
//  - Codex's own structuredContent decoder reportedly has depth/size limits
//    (docs/architecture.md ~line 73: "sending a deep runtime tree as structured
//    content can cause a host to discard the response and wait until timeout").
//    Here zod/ajv/JSON are the only decoders; a host may add a stricter one.
//  - The real host is a Rust/Swift bridge between stdio and postMessage; its
//    copy/queue behavior and any message-size caps are unmeasured here.
//  - postMessage structured clone ≠ JSON round trip (clone keeps numbers/dates
//    exactly and is usually faster than JSON.parse).
//  - ext-apps PostMessageTransport additionally safeParses every incoming
//    message with JSONRPCMessageSchema; skipped here (result field is
//    z.unknown() so it is a shallow no-op).
//
// Run: node --expose-gc spike/bridge.mjs [--quick] [--only V1,V2,V3,V4]
// Results: console table + spike/out/bridge-results.json

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { z } from 'zod/v4';
import { App } from '@modelcontextprotocol/ext-apps';
import { AppBridge } from '@modelcontextprotocol/ext-apps/app-bridge';
import { registerAppTool } from '@modelcontextprotocol/ext-apps/server';
import { gzipSync } from 'node:zlib';
import { performance } from 'node:perf_hooks';
import { writeFile, mkdir } from 'node:fs/promises';
import { makeTaskCard, makeFlatExplore, maxDepth, sizeOf } from './gen.mjs';

const ONLY = (flagValue('--only') ?? 'V1,V2,V3,V4').split(',');
const QUICK = process.argv.includes('--quick');
const SIZES = QUICK ? [1, 5] : [1, 5, 10, 25];
const DEPTHS = QUICK ? [50] : [50, 500];
const RES_URI = 'spike://explore-payload/1';
const gc = globalThis.gc ?? (() => {}); // requires --expose-gc for real heap deltas

// ── transport with JSON serialization + per-trial stats ────────────────────
let stats = null; // current trial's stats sink
function resetStats() {
  stats = { serializeMs: 0, parseMs: 0, serverToClientBytes: 0, bridgeToAppBytes: 0 };
}

class JsonTransport {
  constructor(label) { this.label = label; this.started = false; }
  static createPair(a, b) {
    const x = new JsonTransport(a), y = new JsonTransport(b);
    x.other = y; y.other = x;
    return [x, y];
  }
  async start() { this.started = true; }
  async close() { this.other?.onclose?.(); }
  async send(message) {
    if (!this.other) throw new Error('Not connected');
    const t0 = performance.now();
    const text = JSON.stringify(message);
    const t1 = performance.now();
    const parsed = JSON.parse(text);
    const t2 = performance.now();
    if (stats) {
      stats.serializeMs += t1 - t0;
      stats.parseMs += t2 - t1;
      if (message.result) stats[this.label] = Math.max(stats[this.label] ?? 0, Buffer.byteLength(text));
    }
    this.other.onmessage?.(parsed, {});
  }
  onmessage; onclose; onerror;
  sessionId; setProtocolVersion() {}
}

// ── stack ───────────────────────────────────────────────────────────────────
async function makeStack(payloadForVariants) {
  const server = new McpServer({ name: 'spike-server', version: '1' });

  // V1: structuredContent with an output schema, mirroring the plugin's
  // existing tracesift tools (registerAppTool + outputSchema → server-side
  // ajv/zod validation of structuredContent).
  registerAppTool(server, 'spike_explore_v1', {
    title: 'spike v1',
    description: 'Return a synthetic explore payload as structuredContent',
    inputSchema: {},
    outputSchema: { variant: z.string(), payload: z.unknown() },
    _meta: { ui: { visibility: ['app'] } },
  }, async () => ({
    content: [{ type: 'text', text: 'ok' }],
    structuredContent: { variant: 'V1', payload: payloadForVariants('V1') },
  }));

  // V2/V3: giant text block, no outputSchema (what we would ship if the model
  // never needs to see the payload).
  registerAppTool(server, 'spike_explore_text', {
    title: 'spike text',
    description: 'Return a synthetic explore payload as text',
    inputSchema: { variant: z.string() },
    _meta: { ui: { visibility: ['app'] } },
  }, async ({ variant }) => {
    const t0 = performance.now();
    const packed = payloadForVariants(variant); // per-variant packaging cost
    void (performance.now() - t0);
    return { content: [{ type: 'text', text: packed }] };
  });

  // V4: resource read with a base64 blob (like the live-frame resource pattern)
  server.registerResource('spike-payload', RES_URI, { title: 'spike' }, async () => ({
    contents: [{ uri: RES_URI, mimeType: 'application/octet-stream', blob: payloadForVariants('V4') }],
  }));

  const client = new Client({ name: 'spike-host-client', version: '1' });
  const [cT, sT] = JsonTransport.createPair('', 'serverToClientBytes'); // label records result-message bytes on send
  await server.connect(sT);
  await client.connect(cT);

  const bridge = new AppBridge(client, { name: 'spike-host', version: '1' }, {
    serverTools: {}, serverResources: {}, openLinks: {},
  });
  const [bT, aT] = JsonTransport.createPair('bridgeToAppBytes', ''); // bT (host→view) sends the result
  await bridge.connect(bT);

  const app = new App({ name: 'spike-view', version: '1' }, {}, { autoResize: false });
  await app.connect(aT);
  return { server, client, bridge, app };
}

// ── payload fixtures (pre-generated; server "fetch" cost is out of scope) ──
function buildFixtures() {
  gc();
  const heap0 = process.memoryUsage().heapUsed;
  const fixtures = [];
  for (const mb of SIZES) for (const depth of DEPTHS) {
    const card = makeTaskCard({ depth, mb });
    const json = JSON.stringify(card);
    const gz = gzipSync(json);
    fixtures.push({
      kind: 'taskcard', mb, depth, json,
      bytes: Buffer.byteLength(json),
      gzipB64: gz.toString('base64'),
      plainB64: Buffer.from(json).toString('base64'),
    });
  }
  const flat = makeFlatExplore({ nodes: 60_000, commits: 5_000 });
  const fjson = JSON.stringify(flat);
  const fgz = gzipSync(fjson);
  fixtures.push({
    kind: 'flat60k', mb: +(Buffer.byteLength(fjson) / 1048576).toFixed(2), depth: 1, json: fjson,
    bytes: Buffer.byteLength(fjson), gzipB64: fgz.toString('base64'), plainB64: Buffer.from(fjson).toString('base64'), nodes: 60_000,
  });
  gc();
  return { fixtures, fixtureHeapMB: (process.memoryUsage().heapUsed - heap0) / 1048576 };
}

// ── per-trial runner ────────────────────────────────────────────────────────
async function runTrial(variant, fx) {
  const out = { variant, kind: fx.kind, mb: fx.mb, depth: fx.depth, bytesMB: +(fx.bytes / 1048576).toFixed(2) };
  gc();
  const heapBefore = process.memoryUsage().heapUsed;
  let stack;
  try {
    stack = await makeStack(v => {
      if (v === 'V1') return JSON.parse(fx.json);            // server-side object as the tool would return it
      if (v === 'V2') return fx.json;                          // already stringified — simulate cost below
      if (v === 'V3') return fx.gzipB64;
      if (v === 'V4') return fx.plainB64;
      throw new Error('bad variant');
    });
    const { app } = stack;
    resetStats();

    const t0 = performance.now();
    let result;
    if (variant === 'V1') result = await app.callServerTool({ name: 'spike_explore_v1', arguments: {} });
    else if (variant === 'V4') result = await app.readServerResource({ uri: RES_URI });
    else result = await app.callServerTool({ name: 'spike_explore_text', arguments: { variant } });
    const t1 = performance.now();

    // app-side (iframe) parse/decode
    let decoded;
    const d0 = performance.now();
    if (variant === 'V1') decoded = result.structuredContent?.payload;
    if (variant === 'V2') decoded = JSON.parse(result.content[0].text);
    if (variant === 'V3') {
      const bin = Buffer.from(result.content[0].text, 'base64');
      const stream = new Blob([bin]).stream().pipeThrough(new DecompressionStream('gzip'));
      decoded = JSON.parse(await new Response(stream).text());
    }
    if (variant === 'V4') decoded = JSON.parse(Buffer.from(result.contents[0].blob, 'base64').toString('utf8'));
    const d1 = performance.now();

    gc();
    const heapAfter = process.memoryUsage().heapUsed;
    out.ok = decoded !== undefined && (decoded.tree !== undefined || decoded.nodes !== undefined);
    out.wallMs = +(t1 - t0).toFixed(1);
    out.appDecodeMs = +(d1 - d0).toFixed(1);
    out.transportSerializeMs = +stats.serializeMs.toFixed(1);
    out.transportParseMs = +stats.parseMs.toFixed(1);
    out.wireMB = +(Math.max(stats.serverToClientBytes, stats.bridgeToAppBytes) / 1048576).toFixed(2);
    out.heapDeltaMB = +((heapAfter - heapBefore) / 1048576).toFixed(1);
    if (!out.ok) out.error = 'payload missing after decode';
  } catch (error) {
    out.ok = false;
    out.error = `${error.name}: ${String(error.message).slice(0, 200)}`;
  } finally {
    await stack?.app.close().catch(() => {});
    await stack?.bridge.close().catch(() => {});
    await stack?.client.close().catch(() => {});
    await stack?.server.close().catch(() => {});
  }
  return out;
}

// ── depth stress: host-independent decoder limits (zod/ajv/JSON) ───────────
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';

function depthProbe(depth) {
  let deep = { ok: true };
  for (let i = 0; i < depth; i++) deep = { ok: true, child: deep };
  const res = { depth, stringifyMs: 0, parseMs: 0, zodMs: 0, error: null };
  const stage = (name, fn) => {
    if (res.error) return;
    try {
      const t0 = performance.now();
      const out = fn();
      res[name + 'Ms'] = +(performance.now() - t0).toFixed(1);
      return out;
    } catch (error) {
      res.error = `${name}: ${error.name}: ${String(error.message).slice(0, 100)}`;
    }
  };
  const text = stage('stringify', () => JSON.stringify({ structuredContent: { payload: deep } }));
  const obj = stage('parse', () => JSON.parse(text));
  stage('zod', () => CallToolResultSchema.parse({ content: [], structuredContent: obj }));
  return res;
}

// Recursive zod object (what a *concrete* TaskCard outputSchema would compile
// to via z.lazy): does zod's own recursion survive deep trees? Note the real
// plugin would define its schema statically, but recursion cost is comparable.
function lazyZodProbe(depth) {
  const lazy = z;
  const Node = lazy.object({ ok: lazy.boolean(), child: lazy.lazy(() => Node.optional()) });
  let deep = { ok: true };
  for (let i = 0; i < depth; i++) deep = { ok: true, child: deep };
  const res = { depth, ms: 0, error: null };
  try {
    const t0 = performance.now();
    Node.parse(deep);
    res.ms = +(performance.now() - t0).toFixed(1);
  } catch (error) {
    res.error = `${error.name}: ${String(error.message).slice(0, 100)}`;
  }
  return res;
}

function flagValue(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

// ── main ────────────────────────────────────────────────────────────────────
console.log(`node ${process.version}, ${ONLY.join(',')} variants${QUICK ? ' (quick)' : ''}`);
const { fixtures, fixtureHeapMB } = buildFixtures();
console.log(`fixtures ready (+${fixtureHeapMB.toFixed(0)} MB heap held)`);

const results = [];
for (const fx of fixtures) {
  for (const variant of ONLY) {
    const r = await runTrial(variant, fx);
    results.push(r);
    console.log(`${variant} ${fx.kind} ${r.mb}MB d${r.depth}: ${r.ok ? 'OK' : 'FAIL'} wall=${r.wallMs}ms appDecode=${r.appDecodeMs}ms txS=${r.transportSerializeMs}ms txP=${r.transportParseMs}ms wire=${r.wireMB}MB heap=${r.heapDeltaMB}MB ${r.error ?? ''}`);
  }
}

const depths = [];
for (const d of (QUICK ? [500] : [500, 2000, 5000, 10000, 15000, 20000])) depths.push(depthProbe(d));
for (const d of depths) console.log(`depth ${d.depth}: ${d.error ? 'FAIL ' + d.error : `OK stringify=${d.stringifyMs}ms parse=${d.parseMs}ms zod=${d.zodMs}ms`}`);

const lazy = [];
for (const d of (QUICK ? [500] : [500, 2000, 5000, 10000])) lazy.push(lazyZodProbe(d));
for (const d of lazy) console.log(`lazy-zod depth ${d.depth}: ${d.error ? 'FAIL ' + d.error : `OK ${d.ms}ms`}`);

await mkdir(new URL('./out/', import.meta.url), { recursive: true });
await writeFile(new URL('./out/bridge-results.json', import.meta.url), JSON.stringify({ node: process.version, results, depths }, null, 2));
console.log('wrote spike/out/bridge-results.json');
process.exit(0);
