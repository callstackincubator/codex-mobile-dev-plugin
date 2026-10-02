import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

test("bundled scrcpy stays below Samsung's command limit while preserving encoder settings", async t => {
  const prefix = join(tmpdir(), "mobile-dev-scrcpy-test-");
  const directory = await mkdtemp(prefix);
  t.after(() => rm(directory, { recursive: true, force: true }));
  const output = join(directory, "scrcpy.mjs");
  await build({
    entryPoints: ["runtimes/serve-emu/src/scrcpy.ts"],
    outfile: output, bundle: true, format: "esm", platform: "node", target: "node22",
  });
  const moduleUrl = pathToFileURL(output);
  const { startScrcpy } = await import(moduleUrl.href);
  const fingerprint = "0".repeat(64);
  const capturedLaunch = new Error("Captured scrcpy launch");

  for (const options of [{ maxFps: 30 }, { maxFps: 60, maxSize: 1920, bitRate: 16_000_000, repeatFrameMs: 100 }]) {
    let launch: string[] = [];
    const startup = startScrcpy({ serial: "physical-phone", ...options }, {
      ensureServer: async () => "/test/scrcpy-server-v4.0",
      serverFingerprint: async () => fingerprint,
      randomScid: () => "12345678",
      async runAdb(_serial: string, args: string[]) {
        const stdout = args[0] === "forward" && args[1] === "tcp:0" ? "28000" : "";
        return { status: 0, stdout, stderr: "" };
      },
      spawnAdb(serial: string, args: string[]) {
        assert.equal(serial, "physical-phone");
        launch = args;
        throw capturedLaunch;
      },
    });
    await assert.rejects(startup, capturedLaunch);

    const argv = launch.slice(2);
    const command = argv.join(" ");
    const commandBytes = Buffer.byteLength(command);
    assert.ok(commandBytes <= 255, `Samsung app_process command is ${commandBytes} bytes`);
    const prefix = launch.slice(0, 6);
    assert.deepEqual(prefix, ["shell", "CLASSPATH=/data/local/tmp/serve-emu-scrcpy-12345678.jar", "app_process", "/", "com.genymobile.scrcpy.Server", "4.0"]);
    for (const option of ["scid=12345678", "audio=false", "tunnel_forward=true", `max_fps=${options.maxFps}`, "video_codec_options=i-frame-interval=10"]) {
      const present = launch.some(argument => argument.startsWith(option));
      assert.equal(present, true, `Missing required option ${option}`);
    }
    const maxSize = options.maxSize ?? 1280;
    const bitRate = options.bitRate ?? 8_000_000;
    const hasSize = launch.includes(`max_size=${maxSize}`);
    const hasBitRate = launch.includes(`video_bit_rate=${bitRate}`);
    assert.equal(hasSize, true);
    assert.equal(hasBitRate, true);
    for (const option of ["control", "send_dummy_byte", "send_stream_meta", "send_frame_meta", "send_device_meta", "cleanup"]) {
      const overridesDefault = launch.some(argument => argument.startsWith(`${option}=`));
      assert.equal(overridesDefault, false, `${option} already defaults to true in the pinned server`);
    }
  }
});
