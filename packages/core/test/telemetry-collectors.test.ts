import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scrubErrorEvent, scrubMetric } from "@mobile-dev/shared/telemetry.ts";
import { captureServerError } from "../src/telemetry.ts";
import { directoryBytes, startStorageMetrics } from "../src/storage-metrics.ts";
import { MissingRuntimeError } from "../src/install-integrity.ts";
import { CpuSessions } from "../src/cpu/sessions.ts";
import { DisplayFpsSessions } from "../src/fps/sessions.ts";
import { UDID } from "@mobile-dev/test-support/fixtures.ts";
import { setTelemetry } from "@mobile-dev/test-support/env.ts";
import { assertFragment, captureSentry } from "@mobile-dev/test-support/sentry.ts";

test("collector readiness measures each CPU and FPS start once, without device or app identifiers", async t => {
  const sentry = captureSentry(t, { telemetry: "on", beforeSendMetric: scrubMetric });
  const monitor = { closed: new Promise<Error>(() => {}), async stop() {} };
  const cpu = new CpuSessions({ apps: async () => [{ bundleId: "dev.private.app", pid: 123 }], monitor: async () => monitor });
  const attaching = new CpuSessions({ apps: (_deviceId, signal) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason))), monitor: async () => monitor });
  const fps = new DisplayFpsSessions(async () => { throw new Error("FrameTimeline unavailable"); });
  t.after(async () => { await Promise.all([cpu.close(), attaching.close(), fps.close()]); });
  const ready = cpu.open({ deviceId: UDID, bundleId: "dev.private.app" });
  fps.open({ platform: "android", deviceId: "emulator-5554" });
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal((await cpu.read(ready, 0, 0)).phase, "recording");
  await cpu.closeSession(ready);
  await attaching.closeSession(attaching.open({ platform: "android", deviceId: "R5CT1234", bundleId: "dev.private.app" }));
  const sent = await sentry.text();
  for (const fragment of ["collector.ready.samples", "collector.ready.duration", "millisecond", '"surface":{"value":"performance"',
    '"collector":{"value":"cpu"', '"collector":{"value":"fps"', '"outcome":{"value":"ready"', '"outcome":{"value":"failed"', '"outcome":{"value":"cancelled"',
    '"device_kind":{"value":"simulator"', '"device_kind":{"value":"emulator"', '"device_kind":{"value":"physical"']) assertFragment(sent, fragment);
  for (const fragment of [UDID, "dev.private.app", "emulator-5554", "R5CT1234", "FrameTimeline"]) assertFragment(sent, fragment, false);
  // Readiness is recorded once: stopping a ready session adds nothing.
  assert.equal(sent.match(/collector\.ready\.samples/g)?.length, 3);
  sentry.setTelemetry("off");
  await cpu.closeSession(cpu.open({ deviceId: UDID, bundleId: "dev.private.app" }));
  assert.equal(await sentry.text(), sent);
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

test("storage measurements never start while telemetry is off", t => {
  setTelemetry(t, "off");
  let walked = false;
  const directories = new Proxy<Record<string, string>>({ recordings: join(tmpdir(), "mobile-dev-absent-storage") }, { ownKeys(target) { walked = true; return Reflect.ownKeys(target); } });
  startStorageMetrics(directories)();
  assert.equal(walked, false);
  setTelemetry(t, "on");
  startStorageMetrics(directories)();
  assert.equal(walked, true, "the same directories are measured with telemetry on");
});

test("missing bundled runtimes report the runtime and install integrity with anonymous attribution", async t => {
  const sentry = captureSentry(t, {
    telemetry: "on", environment: "release", release: "mobile-dev@test", beforeSend: scrubErrorEvent,
    initialScope: { user: { id: "anon_0123456789abcdef0123456789abcdef" } },
  });
  captureServerError(new MissingRuntimeError("serve-emu"), "android.tool");
  const sent = await sentry.text();
  for (const fragment of ['"install_integrity":"incomplete"', '"bundled_runtime":"serve-emu"', '"operation":"android.tool"', "anon_0123456789abcdef0123456789abcdef", "mobile-dev@test"]) assertFragment(sent, fragment);
});
