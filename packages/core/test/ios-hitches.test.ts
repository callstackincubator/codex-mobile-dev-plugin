import test from "node:test";
import assert from "node:assert/strict";
import { readIosHitchEvents } from "../src/fps/ios-hitch-events.ts";
import { summarizeIosHitches } from "../../shared/src/ios-hitches.ts";
import type { IosHitches } from "../../shared/src/ios-hitches.ts";

const frame = '<row><kdebug-class id="7">49</kdebug-class><kdebug-subclass id="8">202</kdebug-subclass><kdebug-code>11</kdebug-code><kdebug-func>0</kdebug-func></row>';
const clock = "<row><mach-absolute-time>1000</mach-absolute-time><mach-timebase-info><mach-timebase-info-field>125</mach-timebase-info-field><mach-timebase-info-field>3</mach-timebase-info-field></mach-timebase-info></row>";

function event(code: number, args: number[]) {
  const values = args.map(value => `<kdebug-arg>${value}</kdebug-arg>`);
  const columns = values.join("");
  return `<row><kdebug-class ref="7"/><kdebug-subclass ref="8"/><kdebug-code>${code}</kdebug-code><kdebug-func>0</kdebug-func>${columns}</row>`;
}

async function* xml(rows: string[]) {
  yield `<trace-query-result><node>${frame}`;
  for (const row of rows) yield row;
  yield `</node><node>${clock}</node></trace-query-result>`;
}

test("QuartzCore stall timing, context membership and changing refresh intervals are decoded per swap", async () => {
  const rows = [
    event(0x79, [12, 4, 99, 0]),
    event(0x78, [12, 200000, 24001000, 23601000]),
    event(0x91, [12, 2, 3, 200000]),
    event(0x79, [12, 5, 42, 0]),
    event(0x78, [13, 400000, 48001000, 47201000]),
    event(0x91, [13, 1, 2, 400000]),
    event(0x79, [13, 5, 99, 0]),
  ];
  const source = xml(rows);
  const own = await readIosHitchEvents(source, 42, -0.5, 3);
  assert.equal(own.length, 1);
  assert.equal(own[0].time, 0.5);
  assert.ok(Math.abs(own[0].lateMs - 1000 / 120) < 1e-8);
  assert.equal(own[0].refreshIntervalMs, own[0].lateMs);
  const sharedSource = xml(rows);
  const shared = await readIosHitchEvents(sharedSource, 99, -0.5, 3);
  assert.equal(shared[1].time, 1.5);
  assert.equal(shared[1].refreshIntervalMs, 2 * own[0].refreshIntervalMs);
  const incomplete = xml(rows.slice(0, 3));
  await assert.rejects(readIosHitchEvents(incomplete, 42, 0, 3), /attribution/);
  const idle = xml([]);
  const events = await readIosHitchEvents(idle, 42, 0, 3);
  assert.deepEqual(events, []);
});

test("hitch count uses presentation times and time lost clips overlapping delays to the selected range", () => {
  const capture: IosHitches = { status: "finished", end: 5, events: [
    { time: 1.5, lateMs: 500, refreshIntervalMs: 10 },
    { time: 1.75, lateMs: 500, refreshIntervalMs: 10 },
    { time: 3, lateMs: 1000, refreshIntervalMs: 10 },
  ] };
  assert.deepEqual(summarizeIosHitches(capture, 0, 5), { count: 3, lateMs: 1750 });
  assert.deepEqual(summarizeIosHitches(capture, 1.5, 1.75), { count: 1, lateMs: 250 });
  assert.deepEqual(summarizeIosHitches(capture, 2, 2.5), { count: 0, lateMs: 500 });
  assert.deepEqual(summarizeIosHitches(capture, 4, 5), { count: 0, lateMs: 0 });
  assert.equal(summarizeIosHitches(capture, 5, 6), null);
  assert.equal(summarizeIosHitches(undefined, 0, 5), null);
});
