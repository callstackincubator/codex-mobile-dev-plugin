import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { decodeMmkv, guessMmkvValue } from "../src/server/app-storage/mmkv.ts";
import { classifyFiles, parseDataStorePreferences, parsePlistXml, parseSharedPreferences, plistEntries } from "../src/server/app-storage/formats.ts";
import { clearStore, readStorage } from "../src/server/app-storage/reader.ts";
import type { AppContainer } from "../src/server/app-storage/container.ts";
import { runAsError } from "../src/server/app-storage/container.ts";
import { registerAppStorageTools } from "../src/server/app-storage/tools.ts";
import type { AppDriver } from "../src/server/app-control/driver.ts";
import type { Commands } from "../src/server/app-control/commands.ts";
import { storageSnapshotSchema } from "../src/shared/app-storage.ts";
import { expectedOutcome } from "../src/shared/error-reporting.ts";

const fixtures = join(import.meta.dirname, "fixtures/app-storage/mmkv");
const mmkv = async (id: string) => [await readFile(join(fixtures, id)), await readFile(join(fixtures, `${id}.crc`))] as const;

test("MMKV files written by MMKV 2.4 decode with the last write winning and removals applied", async () => {
  const decoded = decodeMmkv(...await mmkv("fixture"));
  assert.equal(decoded.status, "ok");
  if (decoded.status !== "ok") return;
  assert.equal(decoded.crcValid, true);
  const values = Object.fromEntries(decoded.records.map(record => [record.key, guessMmkvValue(record.value)]));
  assert.deepEqual(values.greeting, { type: "string", value: "hello" });
  assert.deepEqual(values.flag, { type: "boolean", value: "true" });
  assert.deepEqual(values.off, { type: "boolean", value: "false" });
  assert.deepEqual(values.ratio, { type: "number", value: "3.5" });
  assert.deepEqual(values.count, { type: "integer", value: "42" });
  assert.deepEqual(values.negative, { type: "integer", value: "-7" });
  assert.deepEqual(values.json, { type: "json", value: "{\"a\":[1,2]}" });
  assert.deepEqual(values.bytes, { type: "data", value: "ff001080" });
  assert.deepEqual(values.replaced, { type: "string", value: "new" });
  // An empty string and false share one byte on disk.
  assert.deepEqual(values.empty, { type: "boolean", value: "false" });
  assert.equal("removed" in values, false);
  assert.deepEqual(decoded.records.map(record => record.key), ["greeting", "flag", "off", "ratio", "count", "negative", "json", "empty", "bytes", "replaced"]);
});

test("MMKV encryption, key expiry, and corruption are reported instead of misread", async () => {
  assert.deepEqual(decodeMmkv(...await mmkv("locked")), { status: "encrypted" });
  const expiring = decodeMmkv(...await mmkv("expiring"));
  assert.equal(expiring.status, "ok");
  if (expiring.status === "ok") assert.deepEqual(expiring.records.map(record => [record.key, guessMmkvValue(record.value).value]), [["session", "soon"], ["seen", "true"]]);
  const [data, meta] = await mmkv("fixture");
  const changed = Buffer.from(data);
  changed[20] ^= 0xff;
  const tampered = decodeMmkv(changed, meta);
  assert.equal(tampered.status === "ok" ? tampered.crcValid : tampered.status, false);
  assert.equal(decodeMmkv(data.subarray(0, 40), meta).status, "unreadable");
  // Without a meta file, older files keep the size in the data header.
  const legacy = Buffer.concat([Buffer.from([7, 0, 0, 0]), Buffer.from([0x00, 0x01, 0x61, 0x02, 0x01, 0x78, 0x00])]);
  const decoded = decodeMmkv(legacy);
  assert.deepEqual(decoded.status === "ok" ? decoded.records.map(record => record.key) : decoded, ["a"]);
});

test("UserDefaults plists keep their types, including dates, data, and nested values", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>onboarding.done</key><true/>
	<key>launches</key><integer>12</integer>
	<key>scale</key><real>1.5</real>
	<key>name</key><string>Tom &amp; Jerry</string>
	<key>user</key><string>{"id":1}</string>
	<key>seen</key><date>2026-10-19T12:00:00Z</date>
	<key>blob</key><data>AAEC</data>
	<key>empty</key><string/>
	<key>list</key><array><string>a</string><integer>2</integer><dict/></array>
	<key>nested</key><dict><key>inner</key><false/></dict>
</dict>
</plist>`;
  const entries = Object.fromEntries(plistEntries(parsePlistXml(xml)).map(entry => [entry.key, [entry.type, entry.value]]));
  assert.deepEqual(entries, {
    "onboarding.done": ["boolean", "true"], launches: ["integer", "12"], scale: ["number", "1.5"], name: ["string", "Tom & Jerry"],
    user: ["json", "{\"id\":1}"], seen: ["date", "2026-10-19T12:00:00Z"], blob: ["data", "000102"], empty: ["string", ""],
    list: ["array", "[\"a\",2,{}]"], nested: ["object", "{\"inner\":false}"],
  });
  assert.deepEqual(parsePlistXml("<plist version=\"1.0\">\n<dict/>\n</plist>"), {});
});

test("SharedPreferences XML and DataStore protobuf decode every value type", () => {
  const xml = `<?xml version='1.0' encoding='utf-8' standalone='yes' ?>
<map>
    <string name="token">abc&lt;1&gt;</string>
    <boolean name="onboarded" value="true" />
    <int name="count" value="3" />
    <long name="since" value="1760870400000" />
    <float name="ratio" value="0.5" />
    <set name="tags"><string>a</string><string>b</string></set>
    <string name="empty"></string>
</map>`;
  assert.deepEqual(parseSharedPreferences(xml).map(entry => [entry.key, entry.type, entry.value]), [
    ["token", "string", "abc<1>"], ["onboarded", "boolean", "true"], ["count", "integer", "3"], ["since", "integer", "1760870400000"],
    ["ratio", "number", "0.5"], ["tags", "array", "[\"a\",\"b\"]"], ["empty", "string", ""],
  ]);
  const field = (number: number, payload: Buffer) => Buffer.concat([Buffer.from([(number << 3) | 2, payload.length]), payload]);
  const pair = (key: string, value: Buffer) => field(1, Buffer.concat([field(1, Buffer.from(key)), field(2, value)]));
  const pb = Buffer.concat([
    pair("dark", Buffer.from([0x08, 0x01])),
    pair("name", field(5, Buffer.from("Ada"))),
    pair("visits", Buffer.from([0x18, 0x05])),
    pair("tags", field(6, field(1, Buffer.from("x")))),
  ]);
  assert.deepEqual(parseDataStorePreferences(pb).map(entry => [entry.key, entry.type, entry.value]), [
    ["dark", "boolean", "true"], ["name", "string", "Ada"], ["visits", "integer", "5"], ["tags", "array", "[\"x\"]"],
  ]);
});

test("files are recognized by location and companions, wherever the app keeps them", () => {
  const ios = classifyFiles([
    "Documents/mmkv/mmkv.default", "Documents/mmkv/mmkv.default.crc", "Library/custom/user", "Library/custom/user.crc",
    "Library/Preferences/com.example.plist", "Library/Application Support/com.example/RCTAsyncLocalStorage_V1/manifest.json",
    "Library/Application Support/com.example/RCTAsyncLocalStorage_V1/0cc175b9c0f1b6a831c399e269772661",
    "Library/Application Support/async-storage/databases/cache/cache.sqlite", "Library/Application Support/async-storage/databases/cache/cache.sqlite-wal",
    "Library/HTTPStorages/com.example/httpstorages.sqlite", "Documents/default.realm", "Documents/default.realm.lock", "Documents/photo.jpg",
  ], "ios");
  assert.deepEqual(ios.map(store => [store.kind, store.name, store.files.length]), [
    ["mmkv", "mmkv.default", 2], ["mmkv", "user", 2], ["user-defaults", "com.example", 1], ["async-storage", "default", 2],
    ["sqlite", "cache.sqlite", 2], ["realm", "default", 2],
  ]);
  const android = classifyFiles(["shared_prefs/settings.xml", "shared_prefs/settings.xml.bak", "databases/RKStorage", "databases/RKStorage-journal", "files/datastore/settings.preferences_pb", "files/mmkv/mmkv.default", "files/mmkv/mmkv.default.crc", "app_webview/Default/Cookies"], "android");
  assert.deepEqual(android.map(store => [store.kind, store.name, store.files]), [
    ["shared-preferences", "settings", ["shared_prefs/settings.xml", "shared_prefs/settings.xml.bak"]],
    ["sqlite", "RKStorage", ["databases/RKStorage", "databases/RKStorage-journal"]],
    ["datastore", "settings", ["files/datastore/settings.preferences_pb"]],
    ["mmkv", "mmkv.default", ["files/mmkv/mmkv.default", "files/mmkv/mmkv.default.crc"]],
  ]);
});

class MemoryContainer implements AppContainer {
  readonly platform = "ios";
  readonly files: Map<string, Buffer>;
  removed: string[] = [];
  reset = async () => { this.files.clear(); };
  constructor(files: Record<string, Buffer | string>) { this.files = new Map(Object.entries(files).map(([path, value]) => [path, Buffer.from(value)])); }
  async list() { return [...this.files].map(([path, value]) => ({ path, bytes: value.length })); }
  async read(path: string) {
    const value = this.files.get(path);
    if (!value) throw new Error("missing");
    return value;
  }
  async copy() { throw new Error("not used"); }
  async remove(paths: string[]) { this.removed.push(...paths); for (const path of paths) this.files.delete(path); }
}

test("snapshots read every store, cap values, and only clear files of a store that exists", async () => {
  const [data, meta] = await mmkv("fixture");
  const [locked, lockedMeta] = await mmkv("locked");
  const long = "safe prose ".repeat(200);
  const manifest = JSON.stringify({ short: "1", long: null, missing: null });
  const container = new MemoryContainer({
    "Documents/mmkv/fixture": data, "Documents/mmkv/fixture.crc": meta, "Documents/mmkv/locked": locked, "Documents/mmkv/locked.crc": lockedMeta,
    "Library/Application Support/com.example/RCTAsyncLocalStorage_V1/manifest.json": manifest,
    [`Library/Application Support/com.example/RCTAsyncLocalStorage_V1/${createHash("md5").update("long").digest("hex")}`]: long,
    "Library/Preferences/com.example.plist": "<plist version=\"1.0\"><dict><key>a</key><true/></dict></plist>",
    "Documents/big.bin": Buffer.alloc(5000),
  });
  const snapshot = storageSnapshotSchema.parse(await readStorage(container, { bundleId: "com.example", entries: 3, valueLength: 100, run: async () => "" }));
  const byName = Object.fromEntries(snapshot.stores.map(store => [store.name, store]));
  assert.equal(byName.fixture.entryCount, 10);
  assert.equal(byName.fixture.entries.length, 3);
  assert.equal(byName.fixture.entries[0].guessed, true);
  assert.equal(byName.locked.status, "encrypted");
  const asyncStore = byName.default;
  assert.equal(asyncStore.kind, "async-storage");
  assert.deepEqual(asyncStore.entries.map(entry => [entry.key, entry.type, entry.value.length, entry.truncated ?? false]), [["short", "string", 1, false], ["long", "string", 100, true], ["missing", "null", 4, false]]);
  assert.equal(byName["com.example"].entries[0].value, "true");
  assert.equal(snapshot.files[0].path, "Documents/big.bin");
  assert.equal(snapshot.files.find(file => file.path === "Documents/mmkv/fixture")?.store, "mmkv:Documents/mmkv/fixture");
  // Opaque hash-named files are hidden from metadata; their selected store can still be decoded.
  assert.equal(snapshot.fileCount, 7);

  const cleared = await clearStore(container, "mmkv:Documents/mmkv/fixture");
  assert.equal(cleared.name, "fixture");
  assert.deepEqual(container.removed, ["Documents/mmkv/fixture", "Documents/mmkv/fixture.crc"]);
  await assert.rejects(clearStore(container, "mmkv:../../etc/passwd"), error => expectedOutcome(error) === "invalid_input");
});

test("Android run-as failures explain release builds and missing apps", () => {
  assert.equal(expectedOutcome(runAsError({ stderr: "run-as: package not debuggable: com.example" }, "Listing app data", "com.example")), "unsupported_platform");
  assert.match(runAsError({ stderr: "run-as: package not debuggable: com.example" }, "Listing app data", "com.example").message, /release build/);
  assert.equal(expectedOutcome(runAsError({ stderr: "run-as: unknown package: com.example" }, "Listing app data", "com.example")), "invalid_input");
});

test("storage tools stop the app before clearing and reset everything when no store is named", async () => {
  const container = new MemoryContainer({ "Library/Preferences/com.example.plist": "<plist version=\"1.0\"><dict/></plist>", "Documents/a.txt": "a" });
  const calls: string[] = [];
  const driver = { stop: async (bundleId: string) => { calls.push(`stop ${bundleId}`); } } as unknown as AppDriver;
  const commands = { run: async () => "" } as unknown as Commands;
  const server = new McpServer({ name: "test", version: "1" });
  registerAppStorageTools(server, commands, () => driver, async () => container);
  const client = new Client({ name: "client", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const target = { platform: "ios", deviceId: "B5C969F6-58A4-4C31-AB12-FB9E56D681DE", bundleId: "com.example" };

  const read = await client.callTool({ name: "mobile_app_storage", arguments: { ...target, store: "user-defaults:Library/Preferences/com.example.plist" } });
  assert.deepEqual(storageSnapshotSchema.parse(read.structuredContent).stores.map(store => store.name), ["com.example"]);
  const missing = await client.callTool({ name: "mobile_clear_app_storage", arguments: { ...target, store: "mmkv:nothing" } });
  assert.equal(missing.isError, true);
  const reset = await client.callTool({ name: "mobile_clear_app_storage", arguments: target });
  assert.deepEqual(reset.structuredContent, { cleared: "all", stopped: true });
  assert.deepEqual(calls, ["stop com.example", "stop com.example"]);
  assert.equal(container.files.size, 0);
  await client.close();
});

test("the change feed records keys added, changed, and removed between reads, and labels SDK stores", async () => {
  const { diffSnapshots } = await import("../src/ui/storage-panel.ts");
  const { changedFields, bytesAsText, isSdkStore, storeTitle } = await import("../src/ui/storage-labels.ts");
  const snapshot = (readAt: number, entries: [string, string][], entryCount = entries.length) => storageSnapshotSchema.parse({ platform: "ios", bundleId: "com.example", readAt, files: [], fileCount: 0, totalBytes: 0,
    stores: [{ id: "mmkv:a", kind: "mmkv", name: "a", path: "a", status: "ok", bytes: 0, entryCount, entries: entries.map(([key, value]) => ({ key, type: "string", value, bytes: value.length })) }] });
  const first = snapshot(1, [["kept", "1"], ["edited", "1"], ["dropped", "x"]]);
  const events = diffSnapshots(first, snapshot(2, [["kept", "1"], ["edited", "2"], ["added", "x"]]));
  assert.deepEqual(events.map(event => [event.key, event.change, event.before?.value, event.after?.value, event.at]), [
    ["edited", "changed", "1", "2", 2], ["added", "added", undefined, "x", 2], ["dropped", "removed", "x", undefined, 2],
  ]);
  // A capped read is not evidence that keys past the cap were removed.
  assert.deepEqual(diffSnapshots(first, snapshot(3, [["kept", "1"]], 3)).map(event => event.change), []);
  assert.deepEqual(changedFields({ user: "ada", count: 1 }, { user: "ada", count: 2 }), [{ path: "count", before: "1", after: "2" }]);
  assert.equal(changedFields("a", "b"), undefined);
  assert.equal(bytesAsText({ key: "k", type: "data", value: Buffer.from("[1,2]").toString("hex"), bytes: 5 }), "[1,2]");
  assert.equal(bytesAsText({ key: "k", type: "data", value: "ff00", bytes: 2 }), undefined);
  assert.equal(isSdkStore({ name: "com.google.gmp.measurement.monitor", path: "Library/Preferences/com.google.gmp.measurement.monitor.plist" }), true);
  assert.equal(isSdkStore({ name: "com.example", path: "Library/Preferences/com.example.plist" }), false);
  assert.equal(storeTitle({ kind: "user-defaults", name: "com.example" }, "com.example"), "Standard defaults");
});

test("simulator resets empty the container but keep its layout, metadata, and cfprefsd in sync", async () => {
  const { mkdtemp, mkdir, writeFile, readdir, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { SimulatorContainer } = await import("../src/server/app-storage/container.ts");
  const root = await mkdtemp(join(tmpdir(), "mobile-dev-storage-"));
  try {
    for (const directory of ["Documents/mmkv", "Library/Preferences", "Library/Caches/images", "tmp", "SystemData"]) await mkdir(join(root, directory), { recursive: true });
    for (const file of ["Documents/mmkv/mmkv.default", "Documents/mmkv/mmkv.default.crc", "Library/Preferences/com.example.plist", "Library/Caches/images/a.png", "tmp/x", ".com.apple.mobile_container_manager.metadata.plist", "SystemData/keep"]) await writeFile(join(root, file), "x");
    const calls: string[][] = [];
    const commands = { run: async (_file: string, args: string[]) => { calls.push(args); return ""; } } as unknown as Commands;
    const container = new SimulatorContainer(root, "B5C969F6-58A4-4C31-AB12-FB9E56D681DE", commands);
    assert.deepEqual((await container.list()).map(file => file.path).sort(), [".com.apple.mobile_container_manager.metadata.plist", "Documents/mmkv/mmkv.default", "Documents/mmkv/mmkv.default.crc", "Library/Caches/images/a.png", "Library/Preferences/com.example.plist", "SystemData/keep", "tmp/x"]);
    await assert.rejects(container.read("../outside"), error => expectedOutcome(error) === "invalid_input");
    await container.reset();
    assert.deepEqual(calls, [["simctl", "spawn", "B5C969F6-58A4-4C31-AB12-FB9E56D681DE", "defaults", "delete", join(root, "Library/Preferences/com.example")]]);
    assert.deepEqual((await container.list()).map(file => file.path).sort(), [".com.apple.mobile_container_manager.metadata.plist", "SystemData/keep"]);
    assert.deepEqual((await readdir(join(root, "Library"))).sort(), ["Caches", "Preferences"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("the change feed hides SDK changes until the toggle shows them", async () => {
  const { StoragePanel, shownChanges } = await import("../src/ui/storage-panel.ts");
  const deviceApps = { subscribe: () => () => {}, getSnapshot: () => ({ device: undefined }) };
  const panel = new StoragePanel({} as never, deviceApps as never);
  const store = { id: "s", kind: "user-defaults" as const, name: "n", path: "p" };
  (panel as unknown as { update(patch: object): void }).update({ changes: [
    { id: 2, at: 2, store, sdk: true, key: "firebase", change: "added" },
    { id: 1, at: 1, store, sdk: false, key: "onboarded", change: "added" },
  ] });
  assert.deepEqual(shownChanges(panel.getSnapshot()).map(event => event.key), ["onboarded"]);
  panel.setShowSdkChanges(true);
  assert.deepEqual(shownChanges(panel.getSnapshot()).map(event => event.key), ["firebase", "onboarded"]);
  panel.dispose();
});

test("database tables are read page by page with blobs redacted, and unknown tables are rejected", { skip: process.platform !== "darwin" && "needs sqlite3" }, async () => {
  const { mkdtemp, mkdir, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { execFileSync } = await import("node:child_process");
  const { SimulatorContainer } = await import("../src/server/app-storage/container.ts");
  const { readTable } = await import("../src/server/app-storage/reader.ts");
  const { systemCommands } = await import("../src/server/app-control/commands.ts");
  const root = await mkdtemp(join(tmpdir(), "mobile-dev-table-"));
  try {
    await mkdir(join(root, "Documents"), { recursive: true });
    const file = join(root, "Documents/app.db");
    execFileSync("/usr/bin/sqlite3", [file, "CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT, data BLOB); WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 250) INSERT INTO items SELECT i, 'item ' || i, CASE WHEN i = 1 THEN x'CAFE' END FROM n;"]);
    const container = new SimulatorContainer(root, "B5C969F6-58A4-4C31-AB12-FB9E56D681DE", systemCommands);
    const options = { limit: 100, valueLength: 80, run: systemCommands.run };
    const first = await readTable(container, "sqlite:Documents/app.db", "items", { ...options, offset: 0 });
    assert.equal(first.total, 250);
    assert.deepEqual(first.columns, [{ name: "id", type: "INTEGER" }, { name: "name", type: "TEXT" }, { name: "data", type: "BLOB" }]);
    assert.deepEqual(first.rows[0], [1, "item 1", "[REDACTED]"]);
    assert.deepEqual(first.rows[1], [2, "item 2", null]);
    const last = await readTable(container, "sqlite:Documents/app.db", "items", { ...options, offset: 200 });
    assert.deepEqual([last.offset, last.rows.length, last.rows[0][0]], [200, 50, 201]);
    await assert.rejects(readTable(container, "sqlite:Documents/app.db", "items\"; DROP TABLE items; --", { ...options, offset: 0 }), error => expectedOutcome(error) === "invalid_input");
    await assert.rejects(readTable(container, "sqlite:../outside.db", "items", { ...options, offset: 0 }), error => expectedOutcome(error) === "invalid_input");
    assert.equal(execFileSync("/usr/bin/sqlite3", [file, "SELECT count(*) FROM items"], { encoding: "utf8" }).trim(), "250");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("XML parsers skip comments, declarations, and doctypes, including ones that hide elements", async () => {
  const { parsePlistXml, parseSharedPreferences } = await import("../src/server/app-storage/formats.ts");
  const plist = `<?xml version="1.0"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "x"><plist><dict>
    <!-- <key>hidden</key><string>no</string> --><key>kept</key><!-- between --><string>yes</string></dict></plist>`;
  assert.deepEqual(parsePlistXml(plist), { kept: "yes" });
  const prefs = `<?xml version='1.0' encoding='utf-8' standalone='yes' ?><map>
    <!-- <string name="hidden">no</string> --><string name="kept">yes</string><!<!---->--><boolean name="on" value="true" /></map>`;
  assert.deepEqual(parseSharedPreferences(prefs).map(entry => [entry.key, entry.value]), [["kept", "yes"], ["on", "true"]]);
});

test("Expo's internal preferences count as SDK data and AsyncStorage's Android database is titled like iOS", async () => {
  const { isSdkStore, storeTitle } = await import("../src/ui/storage-labels.ts");
  assert.equal(isSdkStore({ name: "expo.modules.kotlin.PersistentDataManager", path: "shared_prefs/expo.modules.kotlin.PersistentDataManager.xml" }), true);
  assert.equal(isSdkStore({ name: "dev.mobile.storagetest_preferences", path: "shared_prefs/dev.mobile.storagetest_preferences.xml" }), false);
  assert.equal(storeTitle({ kind: "async-storage", name: "RKStorage" }, "dev.mobile.storagetest"), "default");
});
