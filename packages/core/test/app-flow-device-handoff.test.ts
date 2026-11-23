import assert from "node:assert/strict";
import test from "node:test";
import { handoffCaptureDevice } from "../src/app-flow/capture.ts";

test("App Flow releases only sessions that own its selected device", async () => {
  const closed: string[] = [];
  const client = {
    sessions: {
      list: async () => [
        { name: "experimenta", address: "cwd:chat:experimenta", device: { id: "ios-selected" } },
        { name: "android-task", address: "cwd:chat:android-task", device: { id: "android-other" } },
      ],
      close: async ({ session }: { session: string }) => { closed.push(session); },
    },
  };

  await handoffCaptureDevice(client, "ios-selected");

  assert.deepEqual(closed, ["cwd:chat:experimenta"]);
});

test("App Flow names the owning session when a handoff cannot complete", async () => {
  const client = {
    sessions: {
      list: async () => [{ name: "experimenta", device: { id: "ios-selected" } }],
      close: async () => { throw new Error("session is busy"); },
    },
  };

  await assert.rejects(
    handoffCaptureDevice(client, "ios-selected"),
    /session "experimenta".*finish its current command.*session is busy/i,
  );
});
