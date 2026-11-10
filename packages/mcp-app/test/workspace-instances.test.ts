import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { WorkspaceInstances } from "../src/workspace-instances.ts";

const scope = "dfd85435-af38-4aa4-b116-eab6ef7af217";
const key = (sequence: number, createdAt = 10) => ({ scope, sequence, createdAt });

function channels() {
  type Channel = { onmessage: ((event: MessageEvent) => void) | null; postMessage(data: unknown): void; close(): void };
  const peers = new Map<string, Set<Channel>>();
  let closed = 0;
  const create = (name: string) => {
    const group = peers.get(name) ?? new Set();
    peers.set(name, group);
    const channel = {
      onmessage: null as Channel["onmessage"],
      postMessage(data: unknown) {
        for (const peer of group) if (peer !== channel) queueMicrotask(() => peer.onmessage?.(new MessageEvent("message", { data })));
      },
      close() { group.delete(channel); closed++; },
    };
    group.add(channel);
    return channel;
  };
  return { create, closed: () => closed, size: () => [...peers.values()].reduce((n, group) => n + group.size, 0) };
}

test("new workspaces stop older ones, including an old result mounted later", async () => {
  const bus = channels();
  const retired: string[] = [];
  const older = new WorkspaceInstances(() => retired.push("older"), bus.create);
  const newer = new WorkspaceInstances(() => retired.push("newer"), bus.create);
  older.accept(key(1)); newer.accept(key(2));
  await setImmediate();
  assert.deepEqual(retired, ["older"]);
  assert.equal(bus.closed(), 1);
  const remounted = new WorkspaceInstances(() => retired.push("remounted"), bus.create);
  remounted.accept(key(1));
  await setImmediate();
  assert.deepEqual(retired, ["older", "remounted"]);
  newer.dispose(); remounted.dispose(); older.dispose();
  assert.equal(bus.size(), 0);
});

test("server time orders different calls and session scopes stay separate", async () => {
  const bus = channels();
  const retired: string[] = [];
  const older = new WorkspaceInstances(() => retired.push("older"), bus.create);
  const newer = new WorkspaceInstances(() => retired.push("newer"), bus.create);
  const other = new WorkspaceInstances(() => retired.push("other"), bus.create);
  older.accept(key(50, 10)); newer.accept(key(1, 11));
  other.accept({ ...key(1, 100), scope: "18a001fc-058f-4917-9e67-f6c4dc77d42e" });
  await setImmediate();
  assert.deepEqual(retired, ["older"]);
  newer.dispose(); other.dispose();
  assert.equal(bus.size(), 0);
});

test("old transcripts and hosts without channels keep their workspace usable", () => {
  let created = 0;
  let retired = 0;
  const view = new WorkspaceInstances(() => retired++, () => { created++; throw new Error("Denied"); });
  view.accept(undefined); view.accept({ createdAt: Date.now() });
  assert.equal(created, 0);
  view.accept(key(1));
  assert.equal(created, 1);
  assert.equal(retired, 0);
  view.dispose(); view.accept(key(2));
  assert.equal(created, 1);
});
