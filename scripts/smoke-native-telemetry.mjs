import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { buildNativeSentry } from "./native-telemetry.mjs";
import { NativeTelemetryRelay, parseNativeEnvelope } from "../src/server/native-telemetry.ts";

const execute = promisify(execFile);
const sdk = await buildNativeSentry();
const directory = await mkdtemp(join(tmpdir(), "mobile-dev-native-telemetry-"));
const reports = [];
const server = createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const bytes = Buffer.concat(chunks);
  const text = bytes.toString("utf8");
  reports.push(text);
  response.writeHead(200);
  response.end("{}");
});
await new Promise(resolve => { server.listen(0, "127.0.0.1", resolve); });
const address = server.address();
const dsn = `http://public@127.0.0.1:${address.port}/1`;
const cache = join(directory, "cache");
await mkdir(cache);
const env = { ...process.env, MOBILE_DEV_NATIVE_RELEASE: "mobile-dev@native-test", MOBILE_DEV_NATIVE_ENVIRONMENT: "development",
  MOBILE_DEV_NATIVE_CACHE: cache, MOBILE_DEV_TELEMETRY: "on",
  MOBILE_DEV_NATIVE_USER_ID: "anon_0123456789abcdef0123456789abcdef",
  MOBILE_DEV_NATIVE_SESSION_ID: "run_1234567890abcdef1234567890abcdef" };

function reportItems() {
  const items = [];
  for (const report of reports) {
    const lines = report.split("\n");
    for (const line of lines) {
      if (line.length === 0) continue;
      items.push(JSON.parse(line));
    }
  }
  return items;
}

function verifyIdentityPrivacy(items) {
  const events = items.filter(item => item.platform === "native");
  assert.ok(events.length > 0);
  for (const event of events) {
    assert.deepEqual(event.user, { id: env.MOBILE_DEV_NATIVE_USER_ID });
    assert.match(event.tags.telemetry_session, /^run_[a-f0-9]{32}$/);
  }
  const batches = items.filter(item => Array.isArray(item.items));
  assert.ok(batches.length > 0);
  const metricJson = JSON.stringify(batches);
  const metricIncludesUser = metricJson.includes(env.MOBILE_DEV_NATIVE_USER_ID);
  const metricIncludesSession = metricJson.includes("telemetry_session");
  const metricIncludesEmail = metricJson.includes("user.email");
  assert.equal(metricIncludesUser, false);
  assert.equal(metricIncludesSession, false);
  assert.equal(metricIncludesEmail, false);
}

try {
  const source = join(directory, "probe.c");
  const header = resolve("native/telemetry/telemetry.h");
  const probe = `#include ${JSON.stringify(header)}\n#include <sentry.h>\n#include <signal.h>\n#include <string.h>\n`
    + `int main(int argc, char **argv) { mobile_dev_telemetry_init("native-test");\n`
    + `if (argc > 1 && strcmp(argv[1], "private-fields") == 0) {\n`
    + `sentry_value_t user = sentry_value_new_object();\n`
    + `sentry_value_t id = sentry_value_new_string("anon_0123456789abcdef0123456789abcdef");\n`
    + `sentry_value_t email = sentry_value_new_string("private-account@example.invalid");\n`
    + `sentry_value_t name = sentry_value_new_string("private-account-name");\n`
    + `sentry_value_t ip = sentry_value_new_string("192.0.2.42");\n`
    + `sentry_value_set_by_key(user, "id", id); sentry_value_set_by_key(user, "email", email);\n`
    + `sentry_value_set_by_key(user, "username", name); sentry_value_set_by_key(user, "ip_address", ip);\n`
    + `sentry_set_user(user); mobile_dev_telemetry_error("identity.test", "Native identity test"); }\n`
    + `if (argc > 1 && strcmp(argv[1], "crash") == 0) raise(SIGSEGV);\n`
    + `mobile_dev_telemetry_timing(MOBILE_DEV_CONNECT, 5.0);\n`
    + `mobile_dev_telemetry_close(); return 0; }\n`;
  await writeFile(source, probe);
  const output = join(directory, "probe");
  const flags = ["-std=c11", "-g", "-O1", "-DSENTRY_BUILD_STATIC=1", "-I", sdk.include,
    "native/telemetry/telemetry.c", source, sdk.library, "-lcurl", "-o", output];
  const dsnDefine = `-DMOBILE_DEV_NATIVE_DSN=${JSON.stringify(dsn)}`;
  await execute("clang", [dsnDefine, ...flags]);
  let crashed = false;
  try { await execute(output, ["crash"], { env }); }
  catch (error) { crashed = error.signal === "SIGSEGV"; }
  assert.equal(crashed, true, "The isolated probe must terminate with its original crash signal.");
  const nextEnv = { ...env, MOBILE_DEV_NATIVE_SESSION_ID: "run_abcdef0123456789abcdef0123456789" };
  await execute(output, [], { env: nextEnv });
  const allReports = reports.join("\n");
  assert.match(allReports, /SIGSEGV/);
  assert.match(allReports, /debug_id/);
  assert.match(allReports, /native\.memory\.rss/);
  assert.match(allReports, /native\.connect\.mean/);
  assert.equal(allReports.includes(directory), false, "Crash reports must omit local paths.");
  const crashItems = reportItems();
  const crashes = crashItems.filter(item => {
    const exceptions = item.exception?.values ?? [];
    const hasSignal = exceptions.some(value => value.type === "SIGSEGV");
    return item.platform === "native" && hasSignal;
  });
  assert.ok(crashes.length > 0);
  assert.equal(crashes[0].tags.telemetry_session, env.MOBILE_DEV_NATIVE_SESSION_ID, "Cached crashes must retain the session that crashed.");
  await execute(output, ["private-fields"], { env: nextEnv });
  const privacyItems = reportItems();
  verifyIdentityPrivacy(privacyItems);
  const privacyReports = reports.join("\n");
  const includesAccount = privacyReports.includes("private-account");
  const includesIp = privacyReports.includes("192.0.2.42");
  assert.equal(includesAccount, false);
  assert.equal(includesIp, false);
  console.log("Native crashes retain anonymous user and original session IDs; personal details and metric user dimensions are removed.");
  console.log("A real native crash retained its signal and reported its stack, debug IDs, release and metrics to the local receiver.");

  const relayOutput = join(directory, "relay-probe");
  const relayFlags = [...flags];
  relayFlags[relayFlags.length - 1] = relayOutput;
  await execute("clang", ["-DMOBILE_DEV_TELEMETRY_RELAY=1", ...relayFlags]);
  const relayed = [];
  let diagnostics = "";
  const relay = new NativeTelemetryRelay(text => { diagnostics += text; }, encoded => { relayed.push(...parseNativeEnvelope(encoded)); });
  const collected = await execute(relayOutput, ["private-fields"], { env });
  const stderr = Buffer.from(collected.stderr);
  for (let offset = 0; offset < stderr.length; offset += 13) {
    const chunk = stderr.subarray(offset, offset + 13);
    relay.write(chunk);
  }
  relay.end();
  assert.ok(relayed.length > 0, "The actual C transport must produce envelopes accepted by the host relay.");
  const relayItems = relayed.flatMap(envelope => envelope[1]);
  const relayEvents = relayItems.filter(item => item[0].type === "event");
  assert.equal(relayEvents.length, 1);
  assert.deepEqual(relayEvents[0][1].user, { id: env.MOBILE_DEV_NATIVE_USER_ID });
  assert.equal(relayEvents[0][1].tags.telemetry_session, env.MOBILE_DEV_NATIVE_SESSION_ID);
  assert.equal(diagnostics, "");
  const disabledEnv = { ...env, MOBILE_DEV_TELEMETRY: "off" };
  const disabled = await execute(relayOutput, [], { env: disabledEnv });
  assert.equal(disabled.stderr, "");
  const invalidIdentityEnv = { ...env, MOBILE_DEV_NATIVE_USER_ID: "private-account-id" };
  const invalidIdentity = await execute(relayOutput, [], { env: invalidIdentityEnv });
  assert.equal(invalidIdentity.stderr, "");
  console.log("The C relay transport survives pipe fragmentation and honors the shared telemetry off switch.");

  const telemetryObject = join(directory, "telemetry.o");
  await execute("clang", ["-std=c11", "-g", "-DSENTRY_BUILD_STATIC=1", "-I", sdk.include, dsnDefine,
    "-c", "native/telemetry/telemetry.c", "-o", telemetryObject]);
  const library = join(directory, "libtelemetry_probe.a");
  await execute("ar", ["rcs", library, telemetryObject]);
  const rustSource = join(directory, "panic.rs");
  const rustModule = resolve("native/telemetry/src/lib.rs");
  const rust = `#[path = ${JSON.stringify(rustModule)}] mod telemetry;\nfn main() {\n`
    + `telemetry::init("rust-test"); let _ = std::panic::catch_unwind(|| panic!("private-panic-payload@example.invalid"));\n`
    + `telemetry::close(); }\n`;
  await writeFile(rustSource, rust);
  const rustOutput = join(directory, "panic-probe");
  const sdkLibraryDirectory = resolve(sdk.library, "..");
  const { stdout: runtime } = await execute("xcrun", ["clang", "--print-runtime-dir"]);
  const runtimeDirectory = runtime.trim();
  await execute("rustc", ["--edition", "2024", "-g", rustSource, "-L", directory, "-L", sdkLibraryDirectory,
    "-L", runtimeDirectory, "-l", "static=telemetry_probe", "-l", "static=sentry", "-l", "curl", "-l", "static=clang_rt.osx", "-o", rustOutput]);
  await execute(rustOutput, [], { env });
  const finalReports = reports.join("\n");
  assert.match(finalReports, /RustPanic/);
  assert.equal(finalReports.includes("private-panic-payload"), false);
  const finalItems = reportItems();
  verifyIdentityPrivacy(finalItems);
  console.log("The Rust panic hook reports an issue without sending its panic payload.");

  const androidIndex = process.argv.indexOf("--android");
  if (androidIndex >= 0) {
    const serial = process.argv[androidIndex + 1];
    if (serial === undefined) throw new Error("Pass a connected Android device serial after --android.");
    const adb = join(process.env.ANDROID_HOME ?? join(process.env.HOME, "Library/Android/sdk"), "platform-tools/adb");
    const androidSdk = await buildNativeSentry("arm64-v8a");
    const ndk = process.env.ANDROID_NDK_HOME;
    const compilerRoot = join(ndk, "toolchains/llvm/prebuilt/darwin-x86_64/bin");
    const object = join(directory, "android-telemetry.o");
    const probeObject = join(directory, "android-probe.o");
    const compiler = join(compilerRoot, "aarch64-linux-android21-clang");
    await execute(compiler, ["-std=c11", "-g", "-DSENTRY_BUILD_STATIC=1", "-I", androidSdk.include,
      "-c", "native/telemetry/telemetry.c", "-o", object]);
    await execute(compiler, ["-std=c11", "-g", "-c", source, "-o", probeObject]);
    const linker = join(compilerRoot, "aarch64-linux-android21-clang++");
    const androidProbe = join(directory, "android-probe");
    await execute(linker, ["-static-libstdc++", probeObject, object, androidSdk.library, androidSdk.unwind, "-llog", "-lz", "-o", androidProbe]);
    const remote = "/data/local/tmp/mobile-dev-telemetry-test";
    const device = ["-s", serial];
    await execute(adb, [...device, "push", androidProbe, remote]);
    await execute(adb, [...device, "shell", "chmod", "700", remote]);
    const command = `MOBILE_DEV_NATIVE_RELEASE=mobile-dev@native-test MOBILE_DEV_NATIVE_ENVIRONMENT=development MOBILE_DEV_NATIVE_USER_ID=${env.MOBILE_DEV_NATIVE_USER_ID} MOBILE_DEV_NATIVE_SESSION_ID=${env.MOBILE_DEV_NATIVE_SESSION_ID} exec ${remote}`;
    const deviceReports = [];
    let deviceDiagnostics = "";
    const deviceRelay = new NativeTelemetryRelay(text => { deviceDiagnostics += text; }, encoded => { deviceReports.push(...parseNativeEnvelope(encoded)); });
    try {
      try { await execute(adb, [...device, "shell", "-T", `${command} crash`]); }
      catch (error) { assert.notEqual(error.code, 0); }
      const nextRun = await execute(adb, [...device, "shell", "-T", command]);
      const deviceBytes = Buffer.from(nextRun.stderr);
      deviceRelay.write(deviceBytes);
      deviceRelay.end();
      const deviceJson = JSON.stringify(deviceReports);
      assert.match(deviceJson, /SIGSEGV/);
      assert.match(deviceJson, /debug_id/);
      assert.match(deviceJson, /native\.memory\.rss/);
      assert.equal(deviceJson.includes(remote), false);
      assert.equal(deviceDiagnostics, "");
      console.log("A real Android helper crash was cached, scrubbed and relayed on its next start without touching an app.");
    } finally {
      await execute(adb, [...device, "shell", "rm", "-f", remote]);
      await execute(adb, [...device, "shell", "rm", "-rf", "/data/local/tmp/mobile-dev-sentry/native-test"]);
    }
  }
} finally {
  server.closeAllConnections();
  await new Promise(resolve => { server.close(resolve); });
  await rm(directory, { recursive: true, force: true });
}
