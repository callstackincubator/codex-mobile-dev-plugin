/**
 * End-to-end check of the TraceSift capture flow, driven the way the panel
 * drives it: through this plugin's own MCP tools, against a real Chrome and a
 * real TraceSift.
 *
 * It covers everything about the feature except the panel's buttons, which need
 * a Codex host to press. Run it before testing by hand, so that anything it
 * finds is found before Chrome is on screen.
 *
 * Prerequisites: a checkout of the TraceSift repo beside this one (or
 * TRACESIFT_REPO naming it), Chrome installed, and this plugin built
 * (`npm run build`).
 *
 *   node scripts/smoke-tracesift-capture.mjs
 *   node scripts/smoke-tracesift-capture.mjs --url https://your.app --unattended
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}
const unattended = process.argv.includes("--unattended");
const url = option("--url", "https://example.com");
const repo = resolve(process.env.TRACESIFT_REPO ?? option("--tracesift-repo", "../perf-ai"));
const step = message => console.log(`\n→ ${message}`);
const done = message => console.log(`  ✓ ${message}`);

/**
 * Wait for the person, or for the clock when nobody is watching. The pauses are
 * the point of the exercise: the whole flow exists so a recording can start
 * after a sign-in rather than at page load.
 */
async function pause(prompt, seconds) {
  if (unattended) { console.log(`  … ${prompt} (waiting ${seconds}s)`); await delay(seconds * 1000); return; }
  const reader = createInterface({ input: process.stdin, output: process.stdout });
  try { await reader.question(`  ${prompt}, then press Enter: `); }
  finally { reader.close(); }
}

async function freePort() {
  const { createServer } = await import("node:net");
  return new Promise((done, fail) => {
    const server = createServer();
    server.once("error", fail);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(error => error ? fail(error) : done(port));
    });
  });
}

if (!existsSync(join(repo, "packages/cli/src/cli.js"))) {
  throw new Error(`No TraceSift checkout at ${repo}. Pass --tracesift-repo <path> or set TRACESIFT_REPO.`);
}
if (!existsSync(resolve("dist/server.mjs"))) throw new Error("Build the plugin first: npm run build.");

const home = await mkdtemp(join(tmpdir(), "tracesift-capture-smoke-"));
await chmod(home, 0o700);
// The published CLI has no `record` verb yet, so the checkout's own CLI is what
// this exercises — and it must be a file the plugin can spawn.
const command = join(home, "tracesift");
await writeFile(command, `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(join(repo, "packages/cli/src/cli.js"))} "$@"\n`, { mode: 0o755 });
await chmod(command, 0o755);

const token = randomUUID().replace(/-/g, "");
const instance = `capture-smoke-${process.pid}`;
const port = await freePort();
let service;
let client;
let browserOpen = false;

const call = async (name, args = {}) => {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) throw new Error(`${name}: ${result.content.map(item => item.text).join(" ")}`);
  return result.structuredContent;
};

try {
  // A TraceSift to analyze against. The checkout's dev server is used rather
  // than an installed release, because the gzip support a capture depends on
  // lives in this working tree.
  step(`Starting the TraceSift dev server from ${repo} on port ${port}`);
  service = spawn("npm", ["run", "dev", "--", "--port", String(port)], {
    cwd: repo, stdio: ["ignore", "ignore", "inherit"],
    env: { ...process.env, TRACE_SIFT_HOME: home, TRACE_SIFT_INTEGRATION_TOKEN: token, TRACE_SIFT_INSTANCE: instance, TRACE_SIFT_VERSION: "0.0.0-smoke" },
  });
  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 180_000;
  for (;;) {
    if (service.exitCode !== null) throw new Error("The TraceSift dev server exited before it was ready.");
    const ok = await fetch(new URL("/api/integration/v1/health", baseUrl), { headers: { Authorization: `Bearer ${token}` } })
      .then(response => response.ok).catch(() => false);
    if (ok) break;
    if (Date.now() > deadline) throw new Error("The TraceSift dev server did not become ready in three minutes.");
    await delay(1000);
  }
  // The descriptor the plugin looks for. A dev server does not write one, so
  // the smoke test stands in for `tracesift start`.
  await writeFile(join(home, "service.json"), JSON.stringify({
    version: "0.0.0-smoke", apiVersion: 1, pid: service.pid, childPid: service.pid,
    instance, baseUrl, token, startedAt: Date.now(),
  }), { mode: 0o600 });
  await chmod(join(home, "service.json"), 0o600);
  await mkdir(join(home, "recordings"), { recursive: true, mode: 0o700 });
  done(`TraceSift is answering on ${baseUrl}`);

  step("Connecting to this plugin's MCP server, as the panel does");
  client = new Client({ name: "tracesift-capture-smoke", version: "1" });
  await client.connect(new StdioClientTransport({
    command: process.execPath, args: [resolve("dist/server.mjs")], stderr: "pipe",
    env: { ...process.env, TRACE_SIFT_HOME: home, TRACE_SIFT_COMMAND: command },
  }));
  const idle = await call("mobile_tracesift_capture_state");
  if (idle.recording || idle.browser) throw new Error("A recording or browser was already open in a brand-new home.");
  done("No browser, no recording");

  step(`Opening ${url} in a Chrome that stays open`);
  const launched = await call("mobile_tracesift_launch_browser", { url });
  browserOpen = true;
  done(`Chrome is showing ${launched.browser?.url}`);

  await pause("Sign in, navigate, or open a second tab — whatever you want the recording to be of", 8);

  step("Starting the recording of whatever is on screen");
  await call("mobile_tracesift_start_recording");
  const during = await call("mobile_tracesift_capture_state");
  if (!during.recording) throw new Error("The recorder did not report a running recording.");
  done("Recording");

  await pause("Do the slow thing you want measured", 8);

  step("Stopping, and waiting for Chrome to write the trace");
  const capture = await call("mobile_tracesift_stop_recording");
  if (!capture.path.endsWith(".json.gz")) throw new Error(`Expected a gzipped trace, got ${capture.path}`);
  done(`${capture.eventCount.toLocaleString()} events, ${(capture.sizeBytes / 1_048_576).toFixed(1)} MB`);
  const after = await call("mobile_tracesift_capture_state");
  if (!after.browser) throw new Error("The browser closed on stop; it should stay open for another recording.");
  done("The browser stayed open, so another recording could follow");

  // The part that was broken until TraceSift learned to read gzip: a recording
  // is only worth making if it becomes cards.
  step("Analyzing the trace, exactly as the panel does after a stop");
  const analysis = await call("mobile_analyze_profile", { path: capture.path, profileType: "cpu" });
  if (analysis.profileType !== "cpu") throw new Error(`Expected a CPU analysis, got ${analysis.profileType}`);
  done(`${analysis.cards.length} ${analysis.cards.length === 1 ? "card" : "cards"} from ${analysis.title}`);
  for (const card of analysis.cards.slice(0, 5)) console.log(`      · ${card.headline}`);
  if (analysis.cards.length === 0) console.log("      (no long tasks in this recording — try an app that does real work)");

  step("Closing the browser");
  await call("mobile_tracesift_close_browser");
  browserOpen = false;
  const closed = await call("mobile_tracesift_capture_state");
  if (closed.browser) throw new Error("Chrome did not close.");
  done("Closed, and its throwaway profile is gone");

  console.log(`\nThe capture flow works end to end. Trace kept at:\n  ${capture.path}`);
  console.log(`Remove the scratch home when you are done:\n  rm -rf ${home}`);
  console.log("\nWhat this cannot press: the panel's own buttons. In Codex, open Mobile Dev → TraceSift,");
  console.log("choose JavaScript CPU, then check that the Record a web app row launches, records, and lands on cards.");
} finally {
  if (browserOpen) await call("mobile_tracesift_close_browser").catch(() => {});
  await client?.close().catch(() => {});
  service?.kill("SIGTERM");
}
