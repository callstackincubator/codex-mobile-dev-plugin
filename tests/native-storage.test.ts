import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyFiles, protobufEntries } from "../src/server/app-storage/formats.ts";
import { readStorage } from "../src/server/app-storage/reader.ts";
import { previewFile, unarchive } from "../src/server/app-storage/preview.ts";
import { SimulatorContainer } from "../src/server/app-storage/container.ts";
import type { AppContainer } from "../src/server/app-storage/container.ts";
import { systemCommands } from "../src/server/app-control/commands.ts";
import { expectedOutcome } from "../src/shared/error-reporting.ts";

const fixture = (name: string) => readFile(new URL(`./fixtures/app-storage/native/${name}`, import.meta.url));
const udid = "B5C969F6-58A4-4C31-AB12-FB9E56D681DE";
const preview = { maxBytes: 1024 * 1024, maxLength: 10000, hexBytes: 16, run: systemCommands.run };

class MemoryContainer implements AppContainer {
  readonly platform: "ios" | "android";
  readonly files: Map<string, Buffer>;
  constructor(platform: "ios" | "android", files: Record<string, Buffer | string>) {
    this.platform = platform;
    this.files = new Map(Object.entries(files).map(([path, value]) => [path, Buffer.from(value)]));
  }
  async list() { return [...this.files].map(([path, value]) => ({ path, bytes: value.length })); }
  async read(path: string) { const value = this.files.get(path); if (!value) throw new Error("missing"); return value; }
  async remove() {}
  async reset() {}
}

test("native stores are found by their files: SwiftData, Core Data with any name, App Group defaults, and Proto DataStore", () => {
  const kinds = (platform: "ios" | "android", paths: string[]) => classifyFiles(paths, platform).map(store => `${store.kind}:${store.name}:${store.files.length}`);
  assert.deepEqual(kinds("ios", [
    "AppGroup/group.dev.example/Library/Application Support/default.store", "AppGroup/group.dev.example/Library/Application Support/default.store-wal",
    "Library/Application Support/Model", "Library/Application Support/Model-wal",
    "AppGroup/group.dev.example/Library/Preferences/group.dev.example.plist",
    "Documents/profile.json", "Library/Caches/thumbnails-wal",
  ]), ["sqlite:default.store:2", "sqlite:Model:2", "user-defaults:group.dev.example:1"]);
  assert.deepEqual(kinds("android", ["files/datastore/profile.pb", "files/datastore/settings.preferences_pb", "files/other.pb"]),
    ["datastore:profile:1", "datastore:settings:1"]);
});

test("Proto DataStore without a schema reads as numbered fields, with repeats indexed and nested messages flattened", async () => {
  assert.deepEqual(protobufEntries(await fixture("profile.pb")).map(entry => [entry.key, entry.type, entry.value]), [
    ["1", "string", "Ada Lovelace"], ["2", "integer", "36"], ["3", "integer", "1"],
    ["4[0]", "string", "beta"], ["4[1]", "string", "admin"], ["5.1", "string", "Berlin"], ["5.2", "string", "10115"],
  ]);
});

test("EncryptedSharedPreferences reads as encrypted instead of ciphertext keys and values", async () => {
  const container = new MemoryContainer("android", {
    "shared_prefs/secret_prefs.xml": await fixture("secret_prefs.xml"),
    "files/datastore/profile.pb": await fixture("profile.pb"),
  });
  const snapshot = await readStorage(container, { bundleId: "dev.example", entries: 50, valueLength: 100, run: systemCommands.run });
  const secret = snapshot.stores.find(store => store.name === "secret_prefs");
  assert.equal(secret?.status, "encrypted");
  assert.deepEqual(secret?.entries, []);
  assert.match(snapshot.stores.find(store => store.name === "profile")?.note ?? "", /no schema/);
});

test("simulator containers include App Group containers under a prefix and keep paths inside them", async () => {
  const root = await mkdtemp(join(tmpdir(), "mobile-dev-groups-"));
  try {
    const data = join(root, "data");
    const group = join(root, "group");
    await mkdir(join(data, "Documents"), { recursive: true });
    await mkdir(join(group, "Library/Preferences"), { recursive: true });
    await writeFile(join(data, "Documents/notes.txt"), "app");
    await writeFile(join(group, "widget.json"), "{}");
    await writeFile(join(group, ".com.apple.mobile_container_manager.metadata.plist"), "keep");
    const container = new SimulatorContainer(data, udid, systemCommands, new Map([["group.dev.example", group]]));
    assert.deepEqual((await container.list()).map(file => file.path).sort(), [
      "AppGroup/group.dev.example/.com.apple.mobile_container_manager.metadata.plist", "AppGroup/group.dev.example/widget.json", "Documents/notes.txt",
    ]);
    assert.equal((await container.read("AppGroup/group.dev.example/widget.json")).toString(), "{}");
    await assert.rejects(container.read("AppGroup/group.other/widget.json"), error => expectedOutcome(error) === "invalid_input");
    await assert.rejects(container.read("AppGroup/group.dev.example/../data/Documents/notes.txt"), error => expectedOutcome(error) === "invalid_input");
    await container.remove(["AppGroup/group.dev.example/widget.json"]);
    assert.deepEqual(await readdir(group), [".com.apple.mobile_container_manager.metadata.plist", "Library"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("file previews decode JSON, text, and binary, and reject files that are not listed", async () => {
  const container = new MemoryContainer("android", {
    "files/profile.json": "{\"name\":\"Ada\",\"tags\":[\"beta\"]}",
    "files/notes.txt": "first line\nsecond line\n",
    "cache/blob.bin": Buffer.from([0, 1, 2, 3, 255, 254]),
  });
  const json = await previewFile(container, "files/profile.json", preview);
  assert.deepEqual([json.format, JSON.parse(json.content)], ["json", { name: "Ada", tags: ["beta"] }]);
  assert.deepEqual(await previewFile(container, "files/notes.txt", preview), { path: "files/notes.txt", bytes: 23, format: "text", content: "first line\nsecond line\n", truncated: false });
  assert.deepEqual(await previewFile(container, "cache/blob.bin", preview), { path: "cache/blob.bin", bytes: 6, format: "binary", content: "00010203fffe", truncated: false });
  await assert.rejects(previewFile(container, "files/missing.txt", preview), error => expectedOutcome(error) === "invalid_input");
});

test("binary property lists and NSKeyedArchiver archives preview as JSON", { skip: process.platform !== "darwin" && "needs plutil" }, async () => {
  const container = new MemoryContainer("ios", { "state.plist": await fixture("state.plist"), "session.archive": await fixture("session.archive") });
  const plist = await previewFile(container, "state.plist", preview);
  assert.deepEqual([plist.format, JSON.parse(plist.content)], ["plist", { featureFlags: { darkIcons: false, newOnboarding: true }, lastScreen: "settings", launches: 7 }]);
  const archive = await previewFile(container, "session.archive", preview);
  assert.deepEqual([archive.format, JSON.parse(archive.content)], ["archive", { recentSearches: ["swiftui", "core data"], scrollOffset: 240 }]);
});

test("unarchiving follows UIDs, resolves NSDate, and stops at cycles", () => {
  const archive = { $archiver: "NSKeyedArchiver", $top: { root: { "CF$UID": 1 } }, $objects: ["$null",
    { "NS.keys": [{ "CF$UID": 2 }, { "CF$UID": 3 }], "NS.objects": [{ "CF$UID": 4 }, { "CF$UID": 1 }], $class: { "CF$UID": 5 } },
    "opened", "self", { "NS.time": 0, $class: { "CF$UID": 6 } }, { $classname: "NSDictionary" }, { $classname: "NSDate" }] };
  assert.deepEqual(unarchive(archive), { opened: "2001-01-01T00:00:00.000Z", self: "<cycle>" });
});

test("SQLite files with any name list every table's rows and columns in one read", { skip: process.platform !== "darwin" && "needs sqlite3" }, async () => {
  const root = await mkdtemp(join(tmpdir(), "mobile-dev-swiftdata-"));
  try {
    const support = join(root, "Library/Application Support");
    await mkdir(support, { recursive: true });
    execFileSync("/usr/bin/sqlite3", [join(support, "default.store"), "CREATE TABLE ZITEM (Z_PK INTEGER PRIMARY KEY, ZTITLE TEXT); INSERT INTO ZITEM VALUES (1, 'a'), (2, 'b'); CREATE TABLE Z_METADATA (Z_VERSION INTEGER); CREATE TABLE \"odd 'name\" (x);"]);
    const container = new SimulatorContainer(root, udid, systemCommands);
    const snapshot = await readStorage(container, { bundleId: "dev.example", entries: 50, valueLength: 100, run: systemCommands.run });
    assert.deepEqual(snapshot.stores.find(store => store.name === "default.store")?.entries.map(entry => entry.value), [
      "2 rows · Z_PK, ZTITLE", "0 rows · Z_VERSION", "0 rows · x",
    ]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
