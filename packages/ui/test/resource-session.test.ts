import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { CollectorSessions, openCursorSession, readJsonResource, ResourceSession } from "../src/resource-session.ts";

const batchSchema = z.object({ cursor: z.number(), values: z.array(z.number()) });
const json = (uri: string, value: unknown) => ({ contents: [{ uri, mimeType: "application/json", text: JSON.stringify(value) }] });

test("cursor sessions resume after each batch and close once when reading ends", async () => {
  const reads: string[] = [];
  const closes: string[] = [];
  const app = {
    async readServerResource({ uri }: { uri: string }) {
      reads.push(uri);
      const after = Number(new URL(uri).searchParams.get("after"));
      return json(uri, { cursor: after + 2, values: [after] });
    },
  };
  const values: number[] = [];
  await openCursorSession({
    app, open: async () => ({ id: "one", uri: "cpu://mobile-dev/one/batch" }), close: async id => { closes.push(id); }, closePolicy: "ignore",
    schema: batchSchema, invalid: () => new Error("invalid"), cursor: batch => batch.cursor, timeout: 1000,
    onBatch: batch => { values.push(...batch.values); return values.length < 3; },
  });
  assert.deepEqual(values, [0, 2, 4]);
  assert.deepEqual(reads.map(uri => new URL(uri).searchParams.get("after")), ["0", "2", "4"]);
  assert.deepEqual(closes, ["one"]);
});

test("a dropped read is read again from the same cursor and malformed batches throw the caller's error", async () => {
  const reads: string[] = [];
  let drop: AbortController | undefined;
  const app = {
    async readServerResource({ uri }: { uri: string }, { signal }: { signal?: AbortSignal }) {
      reads.push(new URL(uri).searchParams.get("after")!);
      if (reads.length === 1) {
        await new Promise((_resolve, reject) => signal!.addEventListener("abort", () => reject(new Error("Aborted")), { once: true }));
      }
      if (reads.length === 3) return json(uri, { cursor: "broken" });
      return json(uri, { cursor: 5, values: [] });
    },
  };
  const reading = openCursorSession({
    app, open: async () => ({ id: "logs", uri: "logs://mobile-dev/logs/batch" }), close: async () => {}, closePolicy: "ignore",
    schema: batchSchema, invalid: () => new Error("The plugin returned an invalid log batch."), cursor: batch => batch.cursor, timeout: 1000,
    beforeRead: async () => { drop = new AbortController(); return drop.signal; },
    onBatch: () => {},
  });
  await new Promise(resolve => setTimeout(resolve, 5));
  drop!.abort();
  await assert.rejects(reading, /invalid log batch/);
  assert.deepEqual(reads, ["0", "0", "5"]);
  await assert.rejects(readJsonResource({ async readServerResource() { return { contents: [] }; } }, "x://y", batchSchema, { timeout: 1000, invalid: () => new Error("missing") }), /missing/);
});

test("a retried close keeps the collector session current until the server closes it", async () => {
  let failClose = true;
  const closes: string[] = [];
  const sessions = new CollectorSessions();
  const session = new ResourceSession("cpu", "cpu://mobile-dev/cpu/batch", async id => {
    closes.push(id);
    if (failClose) throw new Error("close failed");
  }, "retry");
  assert.equal(sessions.adopt(session, sessions.epoch), true);
  await assert.rejects(sessions.stop(), /close failed/);
  assert.equal(session.abort.signal.aborted, true);
  failClose = false;
  assert.equal(await sessions.prepare(sessions.epoch, sessions.settled), true, "The next run starts after closing the leftover session.");
  assert.deepEqual(closes, ["cpu", "cpu"]);
  await sessions.stop();
  assert.deepEqual(closes, ["cpu", "cpu"], "A closed session is not closed again.");
  const ignored = new ResourceSession("logs", "logs://mobile-dev/logs/batch", async () => { throw new Error("expired"); }, "ignore");
  await ignored.close();
  await ignored.closed;
});
