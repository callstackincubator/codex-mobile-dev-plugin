import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { buildServeEmu } from "../scripts/build-serve-emu.mjs";
import type { Envelope } from "@sentry/core";

test("owned startup receives child summaries, preserves the original failure and checks post-failure device state", async t => {
  const prefix = join(tmpdir(), "android-owned-startup-");
  const directory = await mkdtemp(prefix);
  const previousHome = process.env.ANDROID_HOME;
  const previousTelemetry = process.env.MOBILE_DEV_TELEMETRY;
  process.env.ANDROID_HOME = directory;
  process.env.MOBILE_DEV_TELEMETRY = "on";
  t.after(async () => {
    if (previousHome === undefined) delete process.env.ANDROID_HOME;
    else process.env.ANDROID_HOME = previousHome;
    if (previousTelemetry === undefined) delete process.env.MOBILE_DEV_TELEMETRY;
    else process.env.MOBILE_DEV_TELEMETRY = previousTelemetry;
    await rm(directory, { recursive: true, force: true });
  });
  const output = join(directory, "server.mjs");
  const repository = resolve(".");
  await build({
    stdin: { contents: 'export { ServeEmu } from "./src/server/serve-emu.ts"; export { androidStartupDiagnosticTags } from "./src/shared/android-startup-diagnostics.ts"; export * as Sentry from "@sentry/node";', resolveDir: repository, loader: "ts" },
    outfile: output, bundle: true, format: "esm", platform: "node", target: "node22.18",
    banner: { js: 'import { createRequire as testCreateRequire } from "node:module"; const require = testCreateRequire(import.meta.url);' },
  });
  const childDirectory = join(directory, "serve-emu");
  await buildServeEmu(childDirectory);
  const platformTools = join(directory, "platform-tools");
  const emulatorDirectory = join(directory, "emulator");
  await mkdir(platformTools);
  await mkdir(emulatorDirectory);
  const adb = join(platformTools, "adb");
  const disconnected = join(directory, "disconnected");
  const program = `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
const state = ${JSON.stringify(disconnected)};
if (args[0] === 'devices') { console.log('List of devices attached'); if (fs.existsSync(state) === false) console.log('private-device-id device model:PrivateDevice'); }
else {
  const command = args.slice(2);
  if (command[0] === 'forward' && command[1] === 'tcp:0') process.stdout.write('28000');
  else if (command.includes('app_process')) setInterval(() => {}, 1000);
  else if (command[1] === 'cat') { fs.writeFileSync(state, ''); process.stderr.write('device private-device-id not found'); process.exitCode = 1; }
}
`;
  await writeFile(adb, program, { mode: 0o755 });
  const emulator = join(emulatorDirectory, "emulator");
  await writeFile(emulator, `#!${process.execPath}\n`, { mode: 0o755 });
  const url = pathToFileURL(output);
  const environment = join(directory, "telemetry-environment.json");
  await writeFile(environment, '{"environment":"development"}');
  const runtime = await import(url.href);
  const envelopes: Envelope[] = [];
  runtime.Sentry.init({
    dsn: "https://public@example.com/1", defaultIntegrations: false,
    transport: () => ({ async send(envelope: Envelope) { envelopes.push(envelope); return { statusCode: 200 }; }, async flush() { return true; } }),
  });
  t.after(async () => { await runtime.Sentry.close(); });
  const backend = new runtime.ServeEmu();
  t.after(() => backend.dispose());
  let original: unknown;
  try { await backend.start("private-device-id"); }
  catch (error) { original = error; }
  assert.ok(original instanceof Error);
  assert.match(original.message, /serve-emu exited before it became ready/);
  const tags = runtime.androidStartupDiagnosticTags(original);
  assert.equal(tags.android_startup_stage, "socket-poll");
  assert.equal(tags.android_startup_outcome, "missing");
  assert.equal(tags.device_kind, "physical");
  const deadline = Date.now() + 2000;
  let serialized = "";
  while (Date.now() < deadline) {
    await runtime.Sentry.flush();
    serialized = JSON.stringify(envelopes);
    if (serialized.includes("android.backend.startup.device_state.samples")) break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  for (const metric of ["android.backend.startup.samples", "android.backend.startup.stage.mean", "android.backend.startup.device_state.samples", '"android_device_state_after":{"value":"missing"']) {
    const included = serialized.includes(metric);
    assert.equal(included, true, metric);
  }
  for (const privateValue of ["private-device-id", directory, "PrivateDevice"]) {
    const included = serialized.includes(privateValue);
    assert.equal(included, false, privateValue);
  }
});
