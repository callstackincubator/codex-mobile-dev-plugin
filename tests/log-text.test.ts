import test from "node:test";
import assert from "node:assert/strict";
import { logText } from "../src/ui/log-text.ts";

test("embedded Hermes stacks leave the whole error message visible and retain Metro's call site", () => {
  const message = "[recordLike] Failed to record like: TypeError:\nCannot read property 'id' of undefined";
  const embedded = "    at recordLike (http://localhost:8081/src/utils/recordLike.bundle//&platform=ios&dev=true:21:38)\n    at anonymous (http://localhost:8081/App.bundle//&platform=ios:268:50)";
  const log = { message: `${message}\n${embedded}`, stack: "at consoleError (console.js:20:1)" };
  const original = { ...log };
  assert.deepEqual(logText(log), { message, stack: `${embedded}\n${log.stack}` });
  assert.deepEqual(log, original, "Presentation does not alter search, copying or chat context.");
});

test("stack locations on a separate line, CRLF and JavaScriptCore frames stay in details", () => {
  for (const stack of [
    "    at recordLike\n    (http://localhost:8081/recordLike.bundle:21:38)",
    "    at recordLike (App.tsx:21:38)\r\n    at anonymous (App.tsx:268:50)",
    "recordLike@http://localhost:8081/recordLike.bundle:21:38\nanonymous@App.tsx:268:50",
    "    at async recordLike (file:///app/recordLike.js:21:38)\n    at Array.map (<anonymous>)",
  ]) {
    assert.deepEqual(logText({ message: `TypeError: broken\n${stack}` }), { message: "TypeError: broken", stack });
  }
});

test("ordinary multiline output, URLs and sentences beginning with at remain messages", () => {
  for (const message of [
    "Request failed\nRetry after signing in",
    "Request failed\nhttp://localhost:8081/api/items:21:38",
    "Wait\n    at least one request is still running",
    "Directions\n    at home (usually)",
    "Coordinates\n    at 12:30",
  ]) {
    assert.deepEqual(logText({ message }), { message, stack: undefined });
  }
});

test("separate stacks remain separate and identical embedded stacks are not repeated", () => {
  const stack = "    at loadProfile (App.tsx:9:3)";
  assert.deepEqual(logText({ message: "Failed", stack }), { message: "Failed", stack });
  assert.deepEqual(logText({ message: `Failed\n${stack}`, stack }), { message: "Failed", stack });
});
