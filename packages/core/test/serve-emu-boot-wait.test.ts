import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { buildServeEmu } from "../../../tooling/build-serve-emu.mjs";

type Boot = "boots" | "booting" | "missing";

// A fake adb that reports sys.boot_completed=1 only from its third probe ("boots"), never
// ("booting"), or fails the probe as adb does for a device that went away ("missing").
async function androidFixture(t: test.TestContext, boot: Boot, withRuntime: boolean) {
  const directory = await mkdtemp(join(tmpdir(), "android-boot-wait-"));
  const previousHome = process.env.ANDROID_HOME;
  const previousTelemetry = process.env.MOBILE_DEV_TELEMETRY;
  process.env.ANDROID_HOME = directory;
  process.env.MOBILE_DEV_TELEMETRY = "off";
  t.after(async () => {
    if (previousHome === undefined) delete process.env.ANDROID_HOME;
    else process.env.ANDROID_HOME = previousHome;
    if (previousTelemetry === undefined) delete process.env.MOBILE_DEV_TELEMETRY;
    else process.env.MOBILE_DEV_TELEMETRY = previousTelemetry;
    await rm(directory, { recursive: true, force: true });
  });
  const output = join(directory, "server.mjs");
  await build({
    stdin: { contents: 'export { ServeEmu } from "./packages/core/src/serve-emu.ts";', resolveDir: resolve("."), loader: "ts" },
    outfile: output, bundle: true, format: "esm", platform: "node", target: "node22.18",
    banner: { js: 'import { createRequire as testCreateRequire } from "node:module"; const require = testCreateRequire(import.meta.url);' },
  });
  await writeFile(join(directory, "telemetry-environment.json"), '{"environment":"development"}');
  if (withRuntime) await buildServeEmu(join(directory, "serve-emu"));
  const platformTools = join(directory, "platform-tools");
  const emulatorDirectory = join(directory, "emulator");
  await mkdir(platformTools);
  await mkdir(emulatorDirectory);
  const calls = join(directory, "adb-calls.log");
  const probes = join(directory, "boot-probes");
  const program = `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(calls)}, args.join(' ') + '\\n');
if (args[0] === 'devices') { console.log('List of devices attached'); console.log('booting-device device model:BootingDevice'); }
else {
  const command = args.slice(2);
  if (command[1] === 'getprop') {
    const count = (fs.existsSync(${JSON.stringify(probes)}) ? Number(fs.readFileSync(${JSON.stringify(probes)}, 'utf8')) : 0) + 1;
    fs.writeFileSync(${JSON.stringify(probes)}, String(count));
    if (${JSON.stringify(boot)} === 'missing') { process.stderr.write("adb: device 'booting-device' not found"); process.exitCode = 1; }
    else console.log(${JSON.stringify(boot)} === 'boots' && count >= 3 ? '1' : '');
  }
  else if (command[0] === 'forward' && command[1] === 'tcp:0') process.stdout.write('28000');
  else if (command.includes('app_process')) setInterval(() => {}, 1000);
  else if (command[1] === 'cat') { process.stderr.write('device booting-device not found'); process.exitCode = 1; }
}
`;
  await writeFile(join(platformTools, "adb"), program, { mode: 0o755 });
  await writeFile(join(emulatorDirectory, "emulator"), `#!${process.execPath}\n`, { mode: 0o755 });
  const runtime = await import(pathToFileURL(output).href);
  const backend = new runtime.ServeEmu();
  t.after(() => backend.dispose());
  const adbCalls = async () => (await readFile(calls, "utf8")).trim().split("\n").filter(line => line.startsWith("devices") === false);
  return { backend, adbCalls };
}

test("serve-emu starts only after Android reports that it finished booting", async t => {
  const { backend, adbCalls } = await androidFixture(t, "boots", true);
  // The fake device lists no scrcpy socket, so the backend fails after scrcpy launches.
  await assert.rejects(backend.start("booting-device"), /serve-emu exited before it became ready/);
  const calls = await adbCalls();
  const probes = calls.filter(call => call.endsWith("getprop sys.boot_completed"));
  assert.equal(probes.length, 3);
  const launched = calls.findIndex(call => call.includes("app_process"));
  assert.ok(launched > calls.lastIndexOf(probes.at(-1)!), "scrcpy launches after the last boot probe");
});

test("a device that disappears while booting fails at once without starting serve-emu", async t => {
  const { backend, adbCalls } = await androidFixture(t, "missing", false);
  await assert.rejects(backend.start("booting-device"), /stopped or offline/);
  const calls = await adbCalls();
  assert.deepEqual(calls, ["-s booting-device shell getprop sys.boot_completed"]);
});

test("closing the plugin server ends a boot wait without starting serve-emu", async t => {
  const { backend, adbCalls } = await androidFixture(t, "booting", false);
  const started = backend.start("booting-device");
  const deadline = Date.now() + 5000;
  while ((await adbCalls().catch(() => [])).length === 0 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
  backend.dispose();
  await assert.rejects(started, /The plugin server has closed/);
  const calls = await adbCalls();
  assert.ok(calls.length > 0 && calls.every(call => call.endsWith("getprop sys.boot_completed")), calls.join("\n"));
});
