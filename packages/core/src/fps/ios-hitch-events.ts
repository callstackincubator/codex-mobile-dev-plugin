import { SaxesParser } from "saxes";
import type { IosHitch } from "@mobile-dev/shared/ios-hitches.ts";

const caSubclass = 0xca;
const frameInfo = 0x0b;
const frameStall = 0x78;
const stallContext = 0x79;
const stallInfo = 0x91;

type Stall = {
  presentation?: number;
  late?: number;
  refresh?: number;
  expectedContexts?: number;
  contexts: Set<number>;
  includesApp: boolean;
};

const scalarTags = new Set(["mach-absolute-time", "mach-timebase-info-field", "kdebug-class",
  "kdebug-subclass", "kdebug-code", "kdebug-func", "kdebug-arg"]);

/** Decode Instruments' shared XML ID references while streaming the two exported tables. */
export async function readIosHitchEvents(xml: AsyncIterable<string>, pid: number, offsetSeconds: number, end: number) {
  const parser = new SaxesParser();
  const values: number[] = [];
  const stalls = new Map<number, Stall>();
  let field = "";
  let id = "";
  let ref = "";
  let text = "";
  let inRow = false;
  let traceEpoch = 0;
  let tickNs = 0;
  let frameCount = 0;
  let sourceClass = 0;
  let subclass = 0;
  let code = 0;
  let func = 0;
  const args: number[] = [];
  const timebase: number[] = [];

  function recordRow() {
    if (sourceClass !== 0x31 || subclass !== caSubclass || func !== 0) return;
    if (code === frameInfo) frameCount++;
    if (code !== frameStall && code !== stallContext && code !== stallInfo) return;
    if (args.length !== 4 || args.some(value => Number.isSafeInteger(value) === false)) {
      throw new Error("Invalid Core Animation stall arguments.");
    }
    const [swap, second, third, fourth] = args;
    let stall = stalls.get(swap);
    if (stall === undefined) {
      stall = { contexts: new Set(), includesApp: false };
      stalls.set(swap, stall);
    }
    if (code === frameStall) {
      // QuartzCore records acceptable latency, presentation and earliest start in Mach ticks.
      stall.presentation = third;
      stall.late = third - fourth - second;
    } else if (code === stallInfo) {
      stall.refresh = fourth;
      stall.expectedContexts = second;
    } else {
      stall.contexts.add(second);
      if (third === pid) stall.includesApp = true;
    }
  }

  parser.on("opentag", tag => {
    if (tag.name === "row") {
      inRow = true;
      sourceClass = 0;
      subclass = 0;
      code = 0;
      func = -1;
      args.length = 0;
      timebase.length = 0;
    }
    if (inRow === false || scalarTags.has(tag.name) === false) return;
    field = tag.name;
    id = tag.attributes.id;
    ref = tag.attributes.ref;
    text = "";
  });
  parser.on("text", value => { if (field) text += value; });
  parser.on("closetag", tag => {
    if (tag.name === "row") {
      recordRow();
      if (timebase.length === 2) tickNs = timebase[0] / timebase[1];
      inRow = false;
    }
    if (field !== tag.name) return;
    const raw = text.trim();
    const value = ref ? values[Number(ref)] : Number(raw);
    if (value === undefined || (ref === undefined && raw.length === 0) || Number.isFinite(value) === false) {
      throw new Error("Invalid Instruments timing column.");
    }
    if (id) values[Number(id)] = value;
    switch (field) {
      case "mach-absolute-time": traceEpoch = value; break;
      case "mach-timebase-info-field": timebase.push(value); break;
      case "kdebug-class": sourceClass = value; break;
      case "kdebug-subclass": subclass = value; break;
      case "kdebug-code": code = value; break;
      case "kdebug-func": func = value; break;
      case "kdebug-arg": args.push(value); break;
    }
    field = "";
  });
  for await (const chunk of xml) parser.write(chunk);
  parser.close();
  if (frameCount === 0 || traceEpoch <= 0 || Number.isFinite(tickNs) === false || tickNs <= 0) {
    throw new Error("The trace is missing Core Animation frame timing.");
  }
  const events: IosHitch[] = [];
  for (const stall of stalls.values()) {
    if (stall.presentation === undefined || stall.late === undefined) {
      throw new Error("Incomplete Core Animation stall record.");
    }
    const time = (stall.presentation - traceEpoch) * tickNs / 1e9 + offsetSeconds;
    if (time < 0 || time >= end || stall.late <= 0) continue;
    if (stall.refresh === undefined || stall.refresh <= 0 || stall.contexts.size !== stall.expectedContexts) {
      throw new Error("Incomplete Core Animation stall attribution.");
    }
    if (stall.includesApp) events.push({ time, lateMs: stall.late * tickNs / 1e6, refreshIntervalMs: stall.refresh * tickNs / 1e6 });
  }
  events.sort((left, right) => left.time - right.time);
  return events;
}
