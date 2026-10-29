import test from "node:test";
import assert from "node:assert/strict";
import type { StorageSnapshot } from "@mobile-dev/shared/app-storage.ts";
import { appleTimestamp, containerBreakdown, plural } from "../src/storage-labels.ts";

test("counts read as words, with irregular plurals", () => {
  assert.equal(plural(1, "file"), "1 file");
  assert.equal(plural(3, "file"), "3 files");
  assert.equal(plural(2, "match", "matches"), "2 matches");
});

test("only numeric TIMESTAMP cells read as Apple reference dates", () => {
  assert.equal(appleTimestamp("TIMESTAMP", 0), "2001-01-01T00:00:00.000Z");
  assert.equal(appleTimestamp("timestamp", 60), "2001-01-01T00:01:00.000Z");
  assert.equal(appleTimestamp("INTEGER", 0), undefined);
  assert.equal(appleTimestamp("TIMESTAMP", "0"), undefined);
});

test("the data directory splits by what owns each file, and the rest is other", () => {
  const snapshot = {
    totalBytes: 1000,
    stores: [{ id: "db", kind: "sqlite" }, { id: "prefs", kind: "user-defaults" }],
    files: [
      { path: "Documents/app.sqlite", bytes: 400, store: "db" },
      { path: "Library/Preferences/app.plist", bytes: 100, store: "prefs" },
      { path: "Library/Caches/image.png", bytes: 300 },
      { path: "Documents/notes.txt", bytes: 50 },
    ],
  } as unknown as StorageSnapshot;
  assert.deepEqual(containerBreakdown(snapshot), [
    { part: "Caches", bytes: 300 }, { part: "Databases", bytes: 400 }, { part: "Preferences", bytes: 100 }, { part: "Other", bytes: 200 },
  ]);
});
