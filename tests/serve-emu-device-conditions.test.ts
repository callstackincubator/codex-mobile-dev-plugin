import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

type Adb = typeof import("../runtimes/serve-emu/src/adb.ts");
type Exec = NonNullable<Parameters<Adb["getStatusBar"]>[1]>;
let directory: string;
let adb: Adb;

// serve-emu uses TypeScript syntax Node cannot strip, so the module is bundled like the packaged runtime.
before(async () => {
  directory = await mkdtemp(join(tmpdir(), "mobile-dev-emu-conditions-"));
  const output = join(directory, "adb.mjs");
  await build({ entryPoints: [resolve("runtimes/serve-emu/src/adb.ts")], outfile: output, bundle: true, platform: "node", format: "esm", target: "node22.18" });
  adb = await import(pathToFileURL(output).href);
});

after(async () => { await rm(directory, { recursive: true, force: true }); });

function device(respond: (args: string[]) => { stdout?: string; stderr?: string; status?: number }) {
  const calls: string[][] = [];
  const run = (async (_file: string, args: string[]) => {
    calls.push(args);
    const { stdout = "", stderr = "", status = 0 } = respond(args);
    return { status, signal: null, stdout, stderr, timedOut: false, error: null };
  }) as Exec;
  return { run, calls };
}

test("a clean status bar holds only for the boot that entered demo mode", async () => {
  let marker = "null";
  let boot = "boot-1";
  const { run, calls } = device(args => {
    const command = args[3];
    if (command.startsWith("settings get global mobile_dev_status_bar_boot")) return { stdout: `${marker}\n${boot}\n` };
    if (command.includes("settings put global mobile_dev_status_bar_boot")) marker = boot;
    if (command.includes("settings delete global mobile_dev_status_bar_boot")) marker = "null";
    return { stdout: "Broadcast completed: result=0\n" };
  });
  assert.deepEqual(await adb.getStatusBar("emulator-5554", run), { mode: "live" });
  assert.deepEqual(await adb.setStatusBar("emulator-5554", "clean", run), { mode: "clean" });
  const entered = calls.find(args => args[3].includes("command enter"))![3];
  assert.match(entered, /^settings put global sysui_demo_allowed 1 && am broadcast -a com\.android\.systemui\.demo -e command exit && am broadcast -a com\.android\.systemui\.demo -e command enter && /);
  assert.match(entered, /-e command network -e wifi show -e level 4 -e fully true && .*-e command network -e mobile hide/);
  assert.match(entered, /-e command clock -e hhmm 0941/);
  assert.match(entered, /settings put global mobile_dev_status_bar_boot \$\(cat \/proc\/sys\/kernel\/random\/boot_id\)$/);
  boot = "boot-2";
  assert.deepEqual(await adb.getStatusBar("emulator-5554", run), { mode: "live" }, "a reboot leaves demo mode");
  boot = "boot-1";
  assert.deepEqual(await adb.setStatusBar("emulator-5554", "live", run), { mode: "live" });
  assert.match(calls.at(-2)![3], /command exit && settings put global sysui_demo_allowed 0 && settings delete global mobile_dev_status_bar_boot$/);
});

test("Wi-Fi-only devices still go offline and back without a telephony service", async () => {
  const { run, calls } = device(args => {
    if (args[3] === "svc" && args[4] === "data") return { stderr: "cmd: Can't find service: phone\n", status: 20 };
    if (args[3] === "settings") return { stdout: args[6] === "wifi_on" ? "0\n" : "null\n" };
    return {};
  });
  assert.equal((await adb.setNetworkEnabled("R5CT1234", false, run)).enabled, false);
  assert.deepEqual(calls.slice(0, 2).map(args => args.slice(3)), [["svc", "wifi", "disable"], ["svc", "data", "disable"]]);
  const broken = device(args => args[4] === "wifi" ? { stderr: "Failure\n", status: 1 } : {});
  await assert.rejects(adb.setNetworkEnabled("R5CT1234", true, broken.run), /svc wifi enable failed/);
});
