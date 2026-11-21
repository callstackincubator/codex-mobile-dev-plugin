import test from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { androidSdkRoots, androidToolPath, sdkToolPath } from "../src/android-sdk.ts";
import { registerAndroidTools } from "../src/android-tools.ts";
import { systemCommands } from "../src/app-control/commands.ts";
import { AndroidContainer } from "../src/app-storage/container.ts";
import { ServeEmu } from "../src/serve-emu.ts";

async function isolatedProfile(t: TestContext) {
  const profile = await mkdtemp(join(tmpdir(), "mobile sdk "));
  const variables = ["HOME", "USERPROFILE", "LOCALAPPDATA", "ANDROID_HOME", "ANDROID_SDK_ROOT", "PATH"];
  const previous = variables.map(key => [key, process.env[key]] as const);
  t.after(async () => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await rm(profile, { recursive: true, force: true });
  });
  process.env.HOME = process.env.USERPROFILE = profile;
  process.env.LOCALAPPDATA = join(profile, "Local App Data");
  process.env.PATH = profile;
  delete process.env.ANDROID_HOME;
  delete process.env.ANDROID_SDK_ROOT;
  return profile;
}

const executable = (name: string) => process.platform === "win32" ? name + ".exe" : name;

async function installTool(root: string, directory: string, name: string, mode = 0o755) {
  const file = join(root, directory, executable(name));
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, "", { mode });
  return file;
}

test("Android tools use the host's default SDK and preserve spaced directories on the child PATH", async t => {
  const profile = await isolatedProfile(t);
  const root = process.platform === "win32" ? join(profile, "Local App Data", "Android", "Sdk")
    : process.platform === "darwin" ? join(profile, "Library", "Android", "sdk") : join(profile, "Android", "Sdk");
  assert.deepEqual(androidSdkRoots(), [root]);
  assert.equal(await sdkToolPath("adb"), executable("adb"));
  const adb = await installTool(root, "platform-tools", "adb");
  const emulator = await installTool(root, "emulator", "emulator");
  const aapt2 = await installTool(root, "build-tools/35", "aapt2");
  await installTool(root, "build-tools/9", "aapt2");
  if (process.platform !== "win32") await installTool(root, "build-tools/36", "aapt2", 0o644);
  assert.equal(await sdkToolPath("adb"), adb);
  assert.equal(await sdkToolPath("emulator"), emulator);
  assert.equal(await systemCommands.aapt2(), aapt2);
  const userPath = [join(profile, "Other Tools"), dirname(adb)].join(delimiter);
  assert.equal(androidToolPath([adb, emulator], userPath), [dirname(adb), dirname(emulator), join(profile, "Other Tools")].join(delimiter));
  assert.equal(androidToolPath([executable("adb")], userPath), userPath);
  assert.equal(androidToolPath([adb], ""), dirname(adb));
  if (process.platform === "win32") {
    delete process.env.LOCALAPPDATA;
    assert.deepEqual(androidSdkRoots(), [join(profile, "AppData", "Local", "Android", "Sdk")]);
  }
});

test("Android tools search ANDROID_HOME before ANDROID_SDK_ROOT and fall back per executable", async t => {
  const profile = await isolatedProfile(t);
  const [defaultRoot] = androidSdkRoots();
  const customRoot = process.env.ANDROID_HOME = join(profile, "custom SDK");
  const legacyRoot = process.env.ANDROID_SDK_ROOT = join(profile, "legacy SDK");
  assert.deepEqual(androidSdkRoots(), [customRoot, legacyRoot, defaultRoot]);
  const defaultAdb = await installTool(defaultRoot, "platform-tools", "adb");
  assert.equal(await sdkToolPath("adb"), defaultAdb);
  const legacyAdb = await installTool(legacyRoot, "platform-tools", "adb");
  assert.equal(await sdkToolPath("adb"), legacyAdb);
  const customAdb = await installTool(customRoot, "platform-tools", "adb");
  assert.equal(await sdkToolPath("adb"), customAdb);
  const legacyEmulator = await installTool(legacyRoot, "emulator", "emulator");
  if (process.platform !== "win32") await installTool(customRoot, "emulator", "emulator", 0o644);
  assert.equal(await sdkToolPath("emulator"), legacyEmulator);
  process.env.ANDROID_SDK_ROOT = customRoot;
  assert.deepEqual(androidSdkRoots(), [customRoot, defaultRoot]);
});

test("Android discovery returns SDK installation guidance to MCP clients with no SDK installed", async t => {
  await isolatedProfile(t);
  const backend = new ServeEmu();
  const server = new McpServer({ name: "android-setup-test", version: "1" });
  registerAndroidTools(server, backend, "ui://mobile-dev/test.html", async () => {}, async () => {});
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "android-setup-test", version: "1" });
  t.after(async () => { await client.close(); await server.close(); backend.dispose(); });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const result = await client.callTool({ name: "mobile_list_android_devices", arguments: {} });
  assert.equal(result.isError, undefined);
  assert.equal(result.structuredContent?.connected, false);
  assert.deepEqual(result.structuredContent?.devices, []);
  assert.match(String(result.structuredContent?.error), /Platform-Tools \(adb\).*SDK Manager.*ANDROID_HOME.*PATH/);
  assert.deepEqual(result.content, [{ type: "text", text: result.structuredContent?.error }]);
  const container = new AndroidContainer("setup-test-phone", "com.example", systemCommands);
  await assert.rejects(() => container.list(), /Listing app data needs Android SDK Platform-Tools/);
});
