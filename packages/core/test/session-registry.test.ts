import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { SESSION_IDLE_MS, SessionRegistry, sessionIdSchema } from "../src/session-registry.ts";
import { RevisionBuffer, Waiters } from "../src/revision-buffer.ts";

type Session = { device: string; app?: string; stop?: () => void | Promise<void> };

function registry(limit = 2) {
  const stopped: Session[] = [];
  const sessions = new SessionRegistry<Session>({
    limit, name: "Test session", limitMessage: "Too many.", expiredMessage: "Expired.", duplicateMessage: "Duplicate.",
    key: session => session.app ?? session.device, deviceId: session => session.device,
    stop: session => { stopped.push(session); return session.stop?.(); },
  });
  return { sessions, stopped };
}

test("sessions get unguessable IDs, a cap, one session per key and a shared stop", async t => {
  const { sessions, stopped } = registry();
  t.after(() => sessions.close());
  let finish!: () => void;
  const first: Session = { device: "a", stop: () => new Promise<void>(resolve => { finish = resolve; }) };
  const id = sessions.add(first);
  assert.equal(sessionIdSchema.safeParse(id).success, true);
  assert.throws(() => sessions.add({ device: "a" }), /Duplicate/);
  sessions.add({ device: "b" });
  assert.throws(() => sessions.add({ device: "c" }), /Too many/);
  const closing = [sessions.closeSession(id), sessions.closeSession(id)];
  assert.equal(closing[0], closing[1]);
  // A closing session keeps its key and slot until its stop settles.
  assert.throws(() => sessions.add({ device: "a" }), /Too many/);
  assert.equal(sessions.get(id, { stopping: true }), first);
  assert.throws(() => sessions.get(id), /Expired/);
  finish();
  await Promise.all(closing);
  assert.equal(stopped.length, 1);
  assert.throws(() => sessions.get(id), /Expired/);
  sessions.add({ device: "a" });
});

test("synchronous stops release at once and idle sessions expire on lookup", t => {
  const { sessions, stopped } = registry();
  t.after(() => sessions.close());
  const id = sessions.add({ device: "a" });
  void sessions.closeSession(id);
  assert.equal(stopped.length, 1);
  assert.throws(() => sessions.get(id), /Expired/);
  const now = Date.now();
  t.mock.method(Date, "now", () => now);
  const idle = sessions.add({ device: "b" });
  Date.now = () => now + SESSION_IDLE_MS + 1;
  assert.throws(() => sessions.get(idle), /Expired/);
  assert.equal(stopped.length, 2);
});

test("closing a device or the registry reports every failed stop and refuses new sessions", async () => {
  const { sessions, stopped } = registry(4);
  const fails = (message: string) => async () => { throw new Error(message); };
  sessions.add({ device: "phone", app: "one", stop: fails("one") });
  sessions.add({ device: "phone", app: "two" });
  const other = sessions.add({ device: "tablet", stop: fails("tablet") });
  await assert.rejects(sessions.closeDevice("phone"), /one/);
  assert.equal(stopped.length, 2);
  sessions.add({ device: "phone", app: "three", stop: fails("three") });
  await assert.rejects(sessions.close(), (error: unknown) => error instanceof AggregateError && error.errors.length === 2);
  assert.throws(() => sessions.get(other), /Expired/);
  assert.throws(() => sessions.add({ device: "phone" }), /server has closed/);
});

test("opening holds a slot and stops a session that finishes after the registry closed", async () => {
  const { sessions, stopped } = registry(1);
  let created!: (session: Session) => void;
  const opening = sessions.open(() => new Promise(resolve => { created = resolve; }));
  assert.throws(() => sessions.add({ device: "b" }), /Too many/);
  await sessions.close();
  created({ device: "a" });
  await assert.rejects(opening, /server has closed/);
  assert.equal(stopped.length, 1);
});

test("revision buffers keep a time window, replace revised times and wake waiting readers", async () => {
  const buffer = new RevisionBuffer<{ time: number }>({ limit: 3, window: { seconds: 10, time: value => value.time } });
  for (const time of [0, 5, 12, 11]) buffer.append({ time });
  assert.deepEqual(buffer.since(0).map(entry => entry.value.time), [5, 11, 12]);
  buffer.append({ time: 12 });
  assert.deepEqual(buffer.since(0).map(entry => entry.revision), [2, 4, 5]);
  const waiting = buffer.wait(buffer.revision, 60000);
  buffer.bump();
  await waiting;
  assert.equal(buffer.revision, 6);
  assert.deepEqual(buffer.since(5), []);
  const closed = buffer.wait(buffer.revision, 60000);
  buffer.close();
  await closed;
  buffer.append({ time: 13 });
  assert.equal(buffer.revision, 6);
});

test("waiters end on wake, timeout or abort", async () => {
  const waiters = new Waiters();
  const abort = new AbortController();
  let woken = 0;
  const pending = [waiters.wait(60000).then(() => woken++), waiters.wait(60000, abort.signal).then(() => woken++)];
  abort.abort();
  await setImmediate();
  assert.equal(woken, 1);
  waiters.wake();
  await Promise.all(pending);
  await waiters.wait(1);
  assert.equal(woken, 2);
});
