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

test("scrolling away from the bottom pauses following until the list reaches the bottom again", () => {
  const { list } = fixture();
  const first = entry(1);
  list.append([first], 0);
  list.updateScroll(800, 1200, 400);
  const initial = list.getSnapshot();
  assert.equal(initial.follow, true);

  list.updateScroll(780, 1200, 400);
  const scrolledUp = list.getSnapshot();
  assert.equal(scrolledUp.follow, false);
  assert.equal(list.scrollOffset, 780);
  const second = entry(2);
  list.append([second], 0);
  const appended = list.getSnapshot();
  assert.equal(appended.follow, false);
  assert.equal(list.scrollOffset, 780);

  const paused = list.getSnapshot();
  list.updateScroll(900, 1400, 400);
  const scrolledDown = list.getSnapshot();
  assert.equal(scrolledDown, paused, "Scrolling within history does not refilter logs.");
  list.updateScroll(998, 1400, 400);
  const nearBottom = list.getSnapshot();
  assert.equal(nearBottom.follow, false);
  list.updateScroll(999.5, 1400, 400);
  const atBottom = list.getSnapshot();
  assert.equal(atBottom.follow, true, "Fractional scroll offsets count as reaching the bottom.");
});

test("unchanged scroll offsets preserve manual follow choices across content and layout changes", () => {
  const { list } = fixture();
  list.updateScroll(800, 1200, 400);
  list.updateScroll(800, 1400, 400);
  const following = list.getSnapshot();
  assert.equal(following.follow, true, "New content does not pause following before scrolling to it.");

  list.setFollow(false);
  const paused = list.getSnapshot();
  list.updateScroll(800, 1200, 400);
  list.setFollow(false);
  const repeated = list.getSnapshot();
  assert.equal(repeated, paused, "Repeated bottom events do not undo a manual pause or republish.");
  list.updateScroll(800, 1200, 500);
  const resized = list.getSnapshot();
  assert.equal(resized.follow, false, "Resizing alone does not reactivate following.");
});
