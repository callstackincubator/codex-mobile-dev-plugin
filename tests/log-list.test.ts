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

test("keyword queries combine with source and level controls and apply to new batches", () => {
  const { list } = fixture();
  list.search("level:error level:warn message:network -tag:noise");
  list.append([
    entry(1, { message: "Network failed", level: "error", source: "native", origin: "ios" }),
    entry(2, { message: "Network retry", level: "warn" }),
    entry(3, { message: "Network noise", level: "error", tag: "noise" }),
    entry(4, { message: "Network ready" }),
  ], 0);
  let snapshot = list.getSnapshot();
  assert.equal(snapshot.queryError, "");
  assert.deepEqual(snapshot.filtered.map(log => log.message), ["Network failed", "Network retry"]);
  list.setFilters("sources", ["js"]);
  snapshot = list.getSnapshot();
  assert.deepEqual(snapshot.filtered.map(log => log.message), ["Network retry"]);
  list.setFilters("levels", ["error"]);
  snapshot = list.getSnapshot();
  assert.equal(snapshot.filtered.length, 0);
  list.search("level:");
  snapshot = list.getSnapshot();
  assert.ok(snapshot.queryError);
  list.search("");
  snapshot = list.getSnapshot();
  assert.equal(snapshot.queryError, "");
  assert.equal(snapshot.filtered.length, 1);
});

test("age filters count matching repeats and expire even without new logs", t => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-09-30T12:01:00Z") });
  const { list } = fixture();
  list.append([entry(1), entry(2, { message: "Log 1", timestamp: "2026-09-30T12:00:50Z" })], 0);
  list.select(1);
  list.search("age:30s");
  let snapshot = list.getSnapshot();
  assert.equal(snapshot.filtered[0].count, 1);
  assert.equal(snapshot.filtered[0].sequence, 2);
  assert.equal(snapshot.selected?.count, 2, "Filtering preserves the selected full log.");
  list.select(2);
  snapshot = list.getSnapshot();
  assert.equal(snapshot.selected?.sequence, 2, "A matching recent occurrence can be selected after its older repeat is filtered out.");
  assert.equal(snapshot.selected?.count, 2);
  t.mock.timers.tick(21000);
  list.refreshAge();
  snapshot = list.getSnapshot();
  assert.equal(snapshot.filtered.length, 0);
  list.search("");
  snapshot = list.getSnapshot();
  assert.equal(snapshot.filtered[0].count, 2);
  list.refreshAge();
  assert.equal(list.getSnapshot(), snapshot);
});

test("the message budget limits retained logs even before the row limit", () => {
  const { list } = fixture();
  list.append([entry(1, { message: "a".repeat(1200000) }), entry(2, { message: "b".repeat(1200000) })], 0);
  assert.equal(list.getSnapshot().buffered, 1);
  assert.ok(list.getSnapshot().filtered[0].message.startsWith("b"));
});

test("app discovery labels native rows without overwriting existing identities across PID reuse", () => {
  const { list } = fixture();
  const native = { source: "native" as const, origin: "ios" as const, pid: 123, message: "Same log" };
  const beforeDiscovery = entry(1, native);
  const metro = entry(2, { pid: 123, message: "Metro without app metadata" });
  list.append([beforeDiscovery, metro], 0);
  list.setApps([{ bundleId: "com.first.app", pid: 123 }], null);
  list.search("app:com.first.app");
  const discovered = list.getSnapshot();
  assert.equal(discovered.filtered.length, 1);
  assert.equal(discovered.filtered[0].appId, "com.first.app");
  list.setApps([], { bundleId: "com.second.app", pid: 123 });
  const reused = entry(3, native);
  const authoritative = entry(4, { ...native, appId: "com.authoritative.app" });
  list.append([reused, authoritative], 0);
  list.search("app:com.second.app");
  const second = list.getSnapshot();
  assert.equal(second.filtered.length, 1);
  assert.equal(second.filtered[0].appId, "com.second.app");
  list.search("app:com.first.app");
  const first = list.getSnapshot();
  assert.equal(first.filtered.length, 1);
  assert.equal(first.filtered[0].appId, "com.first.app");
  list.search("");
  const all = list.getSnapshot();
  assert.equal(all.buffered, 4);
  assert.equal(all.filtered.length, 4, "Identical logs from different apps are not grouped together.");
  assert.equal(all.filtered[1].appId, undefined, "Metro uses target metadata, not a native PID join.");
  assert.equal(all.filtered[3].appId, "com.authoritative.app");
});

test("scrolling away from the bottom pauses following until the list reaches the bottom again", () => {
  const { list } = fixture();
  const first = entry(1);
  list.append([first], 0);
  list.updateScroll(800, 1200, 400, false);
  const initial = list.getSnapshot();
  assert.equal(initial.follow, true);

  list.updateScroll(780, 1200, 400, true);
  const scrolledUp = list.getSnapshot();
  assert.equal(scrolledUp.follow, false);
  assert.equal(list.scrollOffset, 780);
  const second = entry(2);
  list.append([second], 0);
  const appended = list.getSnapshot();
  assert.equal(appended.follow, false);
  assert.equal(list.scrollOffset, 780);

  const paused = list.getSnapshot();
  list.updateScroll(900, 1400, 400, true);
  const scrolledDown = list.getSnapshot();
  assert.equal(scrolledDown, paused, "Scrolling within history does not refilter logs.");
  list.updateScroll(998, 1400, 400, true);
  const nearBottom = list.getSnapshot();
  assert.equal(nearBottom.follow, false);
  list.updateScroll(999.5, 1400, 400, true);
  const atBottom = list.getSnapshot();
  assert.equal(atBottom.follow, true, "Fractional scroll offsets count as reaching the bottom.");
});

test("unchanged scroll offsets preserve manual follow choices across content and layout changes", () => {
  const { list } = fixture();
  list.updateScroll(800, 1200, 400, false);
  list.updateScroll(800, 1400, 400, false);
  const following = list.getSnapshot();
  assert.equal(following.follow, true, "New content does not pause following before scrolling to it.");

  list.setFollow(false);
  const paused = list.getSnapshot();
  list.updateScroll(800, 1200, 400, false);
  list.setFollow(false);
  const repeated = list.getSnapshot();
  assert.equal(repeated, paused, "Repeated bottom events do not undo a manual pause or republish.");
  list.updateScroll(800, 1200, 500, false);
  const resized = list.getSnapshot();
  assert.equal(resized.follow, false, "Resizing alone does not reactivate following.");
});

test("automatic scroll adjustments preserve following while new rows are being measured", () => {
  const { list } = fixture();
  list.updateScroll(800, 1200, 400, false);
  const following = list.getSnapshot();
  list.updateScroll(828, 1260, 400, false);
  const measured = list.getSnapshot();
  assert.equal(measured, following);
  assert.equal(list.scrollOffset, 828);
  list.updateScroll(810, 1260, 400, false);
  const adjusted = list.getSnapshot();
  assert.equal(adjusted, following, "Automatic upward adjustments do not count as user scrolling.");

  list.setFollow(false);
  const paused = list.getSnapshot();
  list.updateScroll(860, 1260, 400, false);
  const atBottom = list.getSnapshot();
  assert.equal(atBottom, paused, "Automatic bottom adjustments do not undo a manual pause.");
  list.updateScroll(860, 1260, 400, true);
  const resumed = list.getSnapshot();
  assert.equal(resumed.follow, true, "User input at the bottom resumes following.");
});

test("downward scrolling short of the bottom does not interrupt an active follow request", () => {
  const { list } = fixture();
  list.updateScroll(800, 1200, 400, false);
  list.updateScroll(828, 1260, 400, true);
  const following = list.getSnapshot();
  assert.equal(following.follow, true);
  list.updateScroll(820, 1260, 400, true);
  const paused = list.getSnapshot();
  assert.equal(paused.follow, false);
});
