import assert from "node:assert/strict";
import { test } from "node:test";
import {
  defaultScreenInfo,
  fallbackScreenKey,
  uniqueScreenKey,
} from "../src/app-flow/screen-keys.ts";

test("App Flow falls back to the node id when a screen has no title", () => {
  assert.equal(fallbackScreenKey({ title: "Profile Settings", id: "app/settings" }), "Profile-Settings");
  assert.equal(fallbackScreenKey({ title: "", id: "app/settings" }), "app-settings");
  assert.equal(fallbackScreenKey({ title: "", id: "///" }), "Screen");
});

test("App Flow screen keys suffix collisions and reserve returned keys", () => {
  const used = new Set<string>();
  assert.equal(uniqueScreenKey("Feed", used), "Feed");
  assert.equal(uniqueScreenKey("Feed", used), "Feed-2");
  assert.equal(uniqueScreenKey("Feed", used), "Feed-3");
  assert.deepEqual([...used].sort(), ["Feed", "Feed-2", "Feed-3"]);
});

test("App Flow default screen info includes a route only when present", () => {
  assert.equal(
    defaultScreenInfo({ title: "Feed", id: "app/feed", urlPath: "/feed" }),
    "Feed screen at /feed.",
  );
  assert.equal(defaultScreenInfo({ title: "Feed", id: "app/feed", urlPath: null }), "Feed screen.");
});
