import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { ErrorEvent } from "@sentry/core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { scrubErrorEvent, scrubMetric } from "@mobile-dev/shared/telemetry.ts";
import { setAndroidStartupDiagnostic } from "@mobile-dev/shared/android-startup-diagnostics.ts";
import { instrumentMcpServer } from "../src/telemetry.ts";
import { createDrivers, registerAppControlTools } from "../src/app-control/tools.ts";
import { registerDeviceSettingsTools } from "../src/device-settings.ts";
import type { ServeEmu } from "../src/serve-emu.ts";
import { attachedBaguette } from "@mobile-dev/test-support/fixtures.ts";
import { assertFragment, captureSentry } from "@mobile-dev/test-support/sentry.ts";
import { connectClient } from "@mobile-dev/test-support/mcp.ts";

// The cause tags a fixed-message report carries, without the scope and operation tags around them.
function causeTags(event: ErrorEvent | undefined) {
  return Object.fromEntries(Object.entries(event?.tags ?? {}).filter(([key]) => key === "device_platform" || key.startsWith("device_command")));
}

test("app control reports how unexpected commands failed without command output and skips expected outcomes", async t => {
  const sentry = captureSentry(t, { environment: "release", beforeSend: scrubErrorEvent, beforeSendMetric: scrubMetric });
  const run = async (_file: string, args: string[]) => {
    const command = args.join(" ");
    if (command.includes("openurl")) throw Object.assign(new Error(`Command failed: xcrun simctl ${command}`), { code: 1, stderr: "PRIVATE_FAILURE for myapp://PRIVATE_ROUTE", stdout: "" });
    if (command.includes("privacy")) throw Object.assign(new Error(`Command failed: xcrun simctl ${command}`), { killed: true, signal: "SIGTERM", code: null, stderr: "", stdout: "" });
    if (command.includes("terminate")) throw Object.assign(new Error("Command failed"), { code: 149, stderr: "Unable to lookup in current state: Shutting Down", stdout: "" });
    if (command.includes("get-app-locales")) return "PRIVATE_LOCALE_OUTPUT";
    throw Object.assign(new Error("Command failed"), { code: 4, stderr: "FBSOpenApplicationServiceErrorDomain PRIVATE_BUNDLE", stdout: "" });
  };
  const server = new McpServer({ name: "app-control-telemetry", version: "1" });
  instrumentMcpServer(server);
  registerAppControlTools(server, createDrivers({ run, readBinary: async () => Buffer.alloc(0), adb: async () => "adb", aapt2: async () => null, platform: "darwin" }));
  const client = await connectClient(t, server);
  const target = { platform: "ios", deviceId: "B5C969F6-58A4-4C31-AB12-FB9E56D681DE" };
  const failed = await client.callTool({ name: "mobile_open_url", arguments: { ...target, url: "myapp://PRIVATE_ROUTE" } });
  assert.equal(failed.isError, true);
  assert.match(JSON.stringify(failed.content), /PRIVATE_FAILURE/, "the agent still sees the command error");
  const missing = await client.callTool({ name: "mobile_launch_app", arguments: { ...target, bundleId: "com.private.app" } });
  assert.equal(missing.isError, true);
  const stopping = await client.callTool({ name: "mobile_stop_app", arguments: { ...target, bundleId: "com.private.app" } });
  assert.equal(stopping.isError, true);
  await client.callTool({ name: "mobile_set_app_permission", arguments: { ...target, bundleId: "com.private.app", permission: "photos", state: "allow" } });
  await client.callTool({ name: "mobile_set_app_language", arguments: { platform: "android", deviceId: "emulator-5554", bundleId: "com.private.app", language: "de" } });
  const events = await sentry.events();
  assert.equal(events.length, 3, "a missing app and a simulator that is shutting down are expected outcomes");
  const byOperation = new Map(events.map(event => [event.tags?.operation, event]));
  assert.equal(byOperation.get("app_control.open_url")?.exception?.values?.[0]?.value, "App open_url command failed.");
  assert.deepEqual(causeTags(byOperation.get("app_control.open_url")), { device_platform: "ios", device_command: "simctl_openurl", device_command_failure: "exit", device_command_status: "1" });
  assert.deepEqual(causeTags(byOperation.get("app_control.permission")), { device_platform: "ios", device_command: "simctl_privacy", device_command_failure: "deadline" });
  assert.deepEqual(causeTags(byOperation.get("app_control.set_language")), { device_platform: "android", device_command: "adb_shell_cmd", device_command_failure: "unexpected_output" });
  const encoded = await sentry.text();
  assertFragment(encoded, "device_unavailable");
  assertFragment(encoded, "PRIVATE", false);
  assertFragment(encoded, "B5C969F6", false);
  assertFragment(encoded, "emulator-5554", false);
});

test("device settings report the failed backend request without its reply and count a device that stopped mid-request as expected", async t => {
  // The server keeps only its own breadcrumbs; fetch instrumentation another test installed would record backend URLs.
  const sentry = captureSentry(t, { environment: "release", beforeSend: scrubErrorEvent, beforeSendMetric: scrubMetric, beforeBreadcrumb: () => null });
  const udid = "B5C969F6-58A4-4C31-AB12-FB9E56D681DE";
  let state = "Booted";
  let stopDuringRead = false;
  const http = createServer((request, response) => {
    response.setHeader("Content-Type", "application/json");
    if (request.url === "/simulators.json") { response.end(JSON.stringify({ running: [{ udid, name: "PRIVATE_NAME", state }], available: [] })); return; }
    // Baguette answers 404 for a simulator it no longer knows and 500 when simctl fails.
    if (stopDuringRead) { state = "Shutdown"; response.writeHead(404).end(JSON.stringify({ ok: false, error: `unknown udid: ${udid}` })); return; }
    response.writeHead(500).end(JSON.stringify({ ok: false, error: `PRIVATE_REPLY ${udid}` }));
  });
  http.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => { http.once("listening", resolve); });
  const address = http.address();
  assert.ok(address && typeof address === "object");
  const baguette = attachedBaguette(`http://127.0.0.1:${address.port}`);
  const startup = new Error("serve-emu exited before it became ready. PRIVATE_DIAGNOSTICS");
  setAndroidStartupDiagnostic(startup, { stage: "process-launch", outcome: "error" }, {
    deviceKind: "emulator", transport: "emulator", stateBefore: "online", activeBackends: 0, stoppingBackends: 0, startingBackends: 0,
  });
  const android = { onStart: () => () => {}, async start() { throw startup; }, async device() {} } as unknown as ServeEmu;
  const server = new McpServer({ name: "device-settings-telemetry", version: "1" });
  instrumentMcpServer(server);
  const close = registerDeviceSettingsTools(server, baguette, android);
  const client = await connectClient(t, server);
  t.after(async () => { await close(); baguette.dispose(); http.closeAllConnections(); http.close(); });
  const failed = await client.callTool({ name: "mobile_device_settings", arguments: { target: { platform: "ios", id: udid } } });
  assert.equal(failed.isError, true);
  assert.match(JSON.stringify(failed.content), /HTTP 500/, "the panel still sees the backend error");
  const backend = await client.callTool({ name: "mobile_device_settings", arguments: { target: { platform: "android", id: "emulator-5554" } } });
  assert.equal(backend.isError, true);
  stopDuringRead = true;
  const stopped = await client.callTool({ name: "mobile_device_settings", arguments: { target: { platform: "ios", id: udid } } });
  assert.match(JSON.stringify(stopped.content), /simulator is stopped/);
  const events = await sentry.events();
  assert.equal(events.length, 2, "a simulator that stopped mid-read is an expected outcome");
  const [ios, serveEmu] = events;
  assert.equal(ios.exception?.values?.[0]?.value, "Device setting command failed.");
  assert.equal(ios.tags?.operation, "device_settings.read");
  assert.deepEqual(causeTags(ios), { device_platform: "ios", device_command: "baguette_interface", device_command_failure: "http_status", device_command_status: "500" });
  assert.deepEqual(causeTags(serveEmu), { device_platform: "android", device_command: "serve_emu_start", device_command_failure: "unknown" });
  assert.equal(serveEmu.tags?.android_startup_stage, "process-launch", "serve-emu startup diagnostics stay attached");
  const encoded = await sentry.text();
  assertFragment(encoded, "device_unavailable");
  assertFragment(encoded, "PRIVATE", false);
  assertFragment(encoded, udid, false);
  assertFragment(encoded, "emulator-5554", false);
});
