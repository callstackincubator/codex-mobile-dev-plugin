import test from "node:test";
import assert from "node:assert/strict";
import { LogList } from "../src/ui/log-list.ts";
import { logKey } from "../src/shared/logs.ts";
import type { LogEntry, StackedLog } from "../src/shared/logs.ts";
import type { PanelContext } from "../src/ui/model-context.ts";

function fixture() {
  const context = { canAttach: true, attachedKey: undefined as string | undefined, onChange() {},
    async attach(log?: StackedLog) { this.attachedKey = log ? logKey(log) : undefined; this.onChange(); } };
  return { list: new LogList(context as PanelContext), context };
}
const entry = (sequence: number, values: Partial<LogEntry> = {}): LogEntry => ({ sequence, timestamp: "2026-09-30T12:00:00Z", level: "info", source: "js", origin: "metro", message: `Log ${sequence}`, ...values });

test("the list exposes more than 500 rows and retains at most 2000 with stable keys after clear", () => {
  const { list } = fixture();
  list.append(Array.from({ length: 2100 }, (_, i) => entry(i)), 3);
  assert.equal(list.getSnapshot().filtered.length, 2000);
  assert.equal(list.getSnapshot().filtered[0].message, "Log 100");
  assert.equal(list.getSnapshot().dropped, 3);
  const lastKey = list.getSnapshot().filtered.at(-1)!.sequence;
  list.clear(); list.append([entry(1)], 0);
  assert.ok(list.getSnapshot().filtered[0].sequence > lastKey);
});

test("grouping preserves selection and filters include stack traces and source metadata", () => {
  const { list } = fixture();
  list.append([entry(1, { message: "Failed", level: "error", stack: "loadProfile", process: "Example" }), entry(2, { message: "Failed", level: "error", stack: "loadProfile", process: "Example" }), entry(3, { source: "native", origin: "ios" })], 0);
  assert.equal(list.getSnapshot().filtered[0].count, 2);
  list.select(list.getSnapshot().filtered[0].sequence);
  list.search("loadprofile");
  assert.equal(list.getSnapshot().filtered.length, 1);
  list.setFilters("levels", ["info", "warn", "debug"]);
  assert.equal(list.getSnapshot().filtered.length, 0);
  assert.equal(list.getSnapshot().selected?.message, "Failed");
  list.setFilters("levels", ["info", "warn", "error", "debug"]); list.setStacked(false);
  assert.equal(list.getSnapshot().filtered.length, 2);
  assert.equal(list.getSnapshot().selected?.count, 1);
});

test("buffer eviction removes stale selection, and host removal clears the attached state", async () => {
  const { list, context } = fixture();
  list.append([entry(1)], 0); list.select(list.getSnapshot().filtered[0].sequence);
  await list.attach(); assert.equal(list.getSnapshot().selectedAttached, true);
  context.attachedKey = undefined; context.onChange();
  assert.equal(list.getSnapshot().selectedAttached, false);
  list.append(Array.from({ length: 2000 }, (_, i) => entry(i + 2)), 0);
  assert.equal(list.getSnapshot().selected, undefined);
});

test("the message budget limits retained logs even before the row limit", () => {
  const { list } = fixture();
  list.append([entry(1, { message: "a".repeat(1200000) }), entry(2, { message: "b".repeat(1200000) })], 0);
  assert.equal(list.getSnapshot().buffered, 1);
  assert.ok(list.getSnapshot().filtered[0].message.startsWith("b"));
});
