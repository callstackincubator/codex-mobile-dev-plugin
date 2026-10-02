#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { randomBytes } from "node:crypto";
import { pickDevice } from "./adb.ts";
import { listAvds, listRunningAvds, startEmulator } from "./emulator.ts";
import { SCRCPY_DEFAULTS } from "./scrcpy.ts";
import {
  DEFAULT_HOST,
  DEFAULT_MAX_ACTIVE_UPLOADS,
  DEFAULT_MAX_APK_UPLOAD_BYTES,
  DEFAULT_MAX_MEDIA_UPLOAD_BYTES,
  DEFAULT_MAX_QUEUED_UPLOADS,
  DEFAULT_UPLOAD_QUEUE_TIMEOUT_MS,
  startServer,
} from "./server.ts";
import { getUpdateNotice } from "./update-check.ts";
import packageJson from "../package.json";

const argv = Bun.argv.slice(2);
const { values } = parseArgs({
  args: argv,
  options: {
    port: { type: "string", short: "p", default: "3300" },
    host: { type: "string" },
    token: { type: "string" },
    "unsafe-no-auth": { type: "boolean" },
    serial: { type: "string", short: "s" },
    "max-fps": { type: "string", default: String(SCRCPY_DEFAULTS.maxFps) },
    "bit-rate": { type: "string", default: String(SCRCPY_DEFAULTS.bitRate) },
    "max-size": { type: "string", default: String(SCRCPY_DEFAULTS.maxSize) },
    "key-frame-interval": { type: "string", default: String(SCRCPY_DEFAULTS.keyFrameInterval) },
    "repeat-frame-ms": { type: "string", default: String(SCRCPY_DEFAULTS.repeatFrameMs) },
    "max-apk-upload-bytes": { type: "string", default: String(DEFAULT_MAX_APK_UPLOAD_BYTES) },
    "max-media-upload-bytes": { type: "string", default: String(DEFAULT_MAX_MEDIA_UPLOAD_BYTES) },
    "max-active-uploads": { type: "string", default: String(DEFAULT_MAX_ACTIVE_UPLOADS) },
    "max-queued-uploads": { type: "string", default: String(DEFAULT_MAX_QUEUED_UPLOADS) },
    "upload-queue-timeout-ms": { type: "string", default: String(DEFAULT_UPLOAD_QUEUE_TIMEOUT_MS) },
    avd: { type: "string" },
    "avd-list": { type: "boolean" },
    "running-avds": { type: "boolean" },
    "restart-avd": { type: "boolean" },
    emulator: { type: "string" },
    "emulator-port": { type: "string" },
    gpu: { type: "string", default: "host" },
    help: { type: "boolean", short: "h" },
  },
  allowPositionals: true,
});

function numberOption(name: string, fallback: number): number {
  const value = values[name as keyof typeof values];
  if (typeof value !== "string") return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`--${name} must be a number.`);
  return n;
}

function isLoopbackHost(host: string): boolean {
  const h = host.toLowerCase();
  return h === "localhost" || h === "::1" || h === "[::1]" || h.startsWith("127.");
}

/** Address to show in the clickable startup URL (wildcard binds → localhost). */
function displayHost(host: string): string {
  if (host === "0.0.0.0" || host === "::" || host === "[::]") return "localhost";
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

async function checkForUpdate() {
  if (process.env.SERVE_EMU_UPDATE_CHECK === "0") return;

  const notice = await getUpdateNotice({
    packageName: packageJson.name,
    currentVersion: packageJson.version,
    cachePath: process.env.SERVE_EMU_UPDATE_CHECK_CACHE,
  });
  if (notice) console.error(notice);
}

if (values.help) {
  console.log(`serve-emu — host an Android device over scrcpy + WebSocket

Usage:
  serve-emu [-p <port>] [--host <addr>] [--token <secret>] [-s <serial>] [--max-fps N] [--bit-rate N] [--max-size N] [--key-frame-interval sec] [--repeat-frame-ms ms]
  serve-emu --avd <name> [--restart-avd]
  serve-emu --avd-list
  serve-emu --running-avds

Options:
  -p, --port <port>      Port to listen on (default: 3300)
      --host <addr>      Address to bind (default: 127.0.0.1, loopback only).
                         Use 0.0.0.0 to expose over the LAN — this requires
                         authentication (see --token) unless --unsafe-no-auth.
      --token <secret>   Require this shared secret on every request. Browsers
                         authenticate by opening the printed ?token= URL once
                         (exchanged for an HttpOnly cookie); agents send
                         'Authorization: Bearer <secret>'. On a non-loopback
                         bind a token is generated automatically if omitted.
      --unsafe-no-auth   Allow a non-loopback bind with NO authentication.
                         Anyone who can reach the port can control the device.
  -s, --serial <serial>  adb device serial (defaults to the only booted device)
      --max-fps <n>      Cap source frame rate (default: ${SCRCPY_DEFAULTS.maxFps})
      --bit-rate <bps>   H.264 bit rate (default: ${SCRCPY_DEFAULTS.bitRate})
      --max-size <px>    Cap longest screen edge in pixels; 0 = native. The
                         emulator only has a software H.264 encoder, which
                         sustains 60fps only below ~1 megapixel, so this
                         defaults to ${SCRCPY_DEFAULTS.maxSize}.
      --key-frame-interval <sec>
                         Ask the encoder for regular keyframes; 0 disables this
                         codec option (default: ${SCRCPY_DEFAULTS.keyFrameInterval}). Late joiners get keyframes
                         on demand via reset-video, so a long interval avoids
                         periodic keyframe bursts.
      --repeat-frame-ms <ms>
                         Re-encode the previous frame after this many ms with no
                         screen change, so static screens keep producing frames
                         (16 ≈ steady 60fps at the cost of extra CPU/bandwidth;
                         0 keeps the encoder default of one repeat per 100ms)
      --max-apk-upload-bytes <n>    Maximum streamed APK bytes (default: ${DEFAULT_MAX_APK_UPLOAD_BYTES})
      --max-media-upload-bytes <n>  Maximum streamed media bytes (default: ${DEFAULT_MAX_MEDIA_UPLOAD_BYTES})
      --max-active-uploads <n>      Concurrent uploads (default: ${DEFAULT_MAX_ACTIVE_UPLOADS})
      --max-queued-uploads <n>      Queued uploads (default: ${DEFAULT_MAX_QUEUED_UPLOADS})
      --upload-queue-timeout-ms <ms> Upload queue wait limit (default: ${DEFAULT_UPLOAD_QUEUE_TIMEOUT_MS})
      --avd <name>       Launch this Android Virtual Device before streaming
      --gpu <mode>       Emulator GPU mode for --avd launches (default: host).
                         host uses the real GPU for smooth ~60fps; the AVD's
                         own auto often falls back to a software compositor that
                         stutters. Use swiftshader_indirect on headless hosts.
      --restart-avd      Stop a running matching AVD before launching it
      --avd-list         Print available Android Virtual Device names
      --running-avds     Print currently running emulator AVDs
      --emulator <path>  Android Emulator binary (default: PATH or Android SDK)
      --emulator-port <n>
                         Emulator console port for --avd (even 5554-5682)
  -h, --help             Show this help
`);
  process.exit(0);
}

async function main() {
  await checkForUpdate().catch(() => {});

  if (values["avd-list"]) {
    console.log((await listAvds(values.emulator)).join("\n"));
    return;
  }

  if (values["running-avds"]) {
    const running = await listRunningAvds();
    console.log(running.length ? running.map((avd) => `${avd.serial}\t${avd.avd}\t${avd.state}`).join("\n") : "");
    return;
  }

  if ((values["emulator-port"] || values["restart-avd"]) && !values.avd) {
    throw new Error("--emulator-port and --restart-avd require --avd.");
  }

  if (values.avd && values.serial) {
    throw new Error("Use either --avd to launch an emulator or --serial to attach to an existing device, not both.");
  }

  let emulatorLaunch: Awaited<ReturnType<typeof startEmulator>> | null = null;
  const serial = values.avd
    ? (emulatorLaunch = await startEmulator({
        avd: values.avd,
        emulatorPath: values.emulator,
        port: values["emulator-port"] ? Number(values["emulator-port"]) : undefined,
        restartAvd: values["restart-avd"],
        gpu: values.gpu,
      })).serial
    : await pickDevice(values.serial);
  const port = Number(values.port);
  const maxFps = numberOption("max-fps", SCRCPY_DEFAULTS.maxFps);
  const bitRate = numberOption("bit-rate", SCRCPY_DEFAULTS.bitRate);
  const maxSize = numberOption("max-size", SCRCPY_DEFAULTS.maxSize);
  const keyFrameInterval = numberOption("key-frame-interval", SCRCPY_DEFAULTS.keyFrameInterval);
  const repeatFrameMs = numberOption("repeat-frame-ms", SCRCPY_DEFAULTS.repeatFrameMs);
  const maxApkUploadBytes = numberOption("max-apk-upload-bytes", DEFAULT_MAX_APK_UPLOAD_BYTES);
  const maxMediaUploadBytes = numberOption("max-media-upload-bytes", DEFAULT_MAX_MEDIA_UPLOAD_BYTES);
  const maxActiveUploads = numberOption("max-active-uploads", DEFAULT_MAX_ACTIVE_UPLOADS);
  const maxQueuedUploads = numberOption("max-queued-uploads", DEFAULT_MAX_QUEUED_UPLOADS);
  const uploadQueueTimeoutMs = numberOption("upload-queue-timeout-ms", DEFAULT_UPLOAD_QUEUE_TIMEOUT_MS);

  const host = values.host ?? DEFAULT_HOST;
  const loopback = isLoopbackHost(host);
  const unsafeNoAuth = Boolean(values["unsafe-no-auth"]);

  // Access-control policy:
  //  - loopback (default): auth off unless the user opts in with --token.
  //  - non-loopback: auth required. Use --token if given, otherwise generate a
  //    token so the bind is never exposed unauthenticated. --unsafe-no-auth is
  //    the explicit override that turns auth off on a non-loopback bind.
  let token: string | undefined = values.token || undefined;
  if (!loopback) {
    if (unsafeNoAuth) {
      token = undefined;
    } else if (!token) {
      token = randomBytes(24).toString("base64url");
    }
  }

  type ActiveServer = Awaited<ReturnType<typeof startServer>>;
  const lifecycleController = new AbortController();
  let activeServer: ActiveServer | null = null;
  let startupTask: Promise<ActiveServer> | null = null;
  let stopping: Promise<void> | null = null;
  const stop = (): Promise<void> => {
    if (stopping) return stopping;
    lifecycleController.abort(new Error("serve-emu stopping"));
    stopping = (async () => {
      try {
        const started =
          activeServer ?? (await startupTask?.catch(() => null)) ?? null;
        await started?.stop();
      } finally {
        emulatorLaunch?.stop();
      }
    })();
    return stopping;
  };
  process.once("SIGINT", () => {
    void stop()
      .catch((err) => console.error("Shutdown cleanup failed:", err))
      .finally(() => process.exit(0));
  });
  process.once("SIGTERM", () => {
    void stop()
      .catch((err) => console.error("Shutdown cleanup failed:", err))
      .finally(() => process.exit(0));
  });

  startupTask = startServer({
    serial,
    port,
    host,
    token,
    signal: lifecycleController.signal,
    maxFps,
    bitRate,
    maxSize,
    keyFrameInterval,
    repeatFrameMs,
    maxApkUploadBytes,
    maxMediaUploadBytes,
    maxActiveUploads,
    maxQueuedUploads,
    uploadQueueTimeoutMs,
  });
  try {
    activeServer = await startupTask;
  } catch (err) {
    emulatorLaunch?.stop();
    if (lifecycleController.signal.aborted) {
      await stop();
      return;
    }
    throw err;
  }
  if (lifecycleController.signal.aborted) {
    await stop();
    return;
  }
  const { server } = activeServer;

  const base = `http://${displayHost(host)}:${server.port}`;
  if (token) {
    console.log(`serve-emu → ${base}/?token=${token}  (device: ${serial})`);
    console.error(
      "Authentication is ON. Open the URL above once to authenticate this browser " +
        "(the token is exchanged for an HttpOnly cookie). Agents send " +
        "'Authorization: Bearer <token>' or append ?token=<token>.",
    );
  } else {
    console.log(`serve-emu → ${base}/  (device: ${serial})`);
    if (!loopback) {
      console.error(
        `WARNING: bound to non-loopback address ${host} with --unsafe-no-auth. ` +
          "The device is reachable and controllable without authentication.",
      );
    }
  }
}

await main().catch((err) => {
  console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
