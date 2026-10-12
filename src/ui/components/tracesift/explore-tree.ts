/**
 * The arithmetic behind Explore: which frames a focused view keeps, the path to
 * the frame the reader opened, where a ruler puts its ticks, and where a flame
 * graph puts its boxes.
 *
 * Ported from TraceSift's `src/lib/task-timeline.ts`, `src/lib/task-cards.ts`
 * and the layout `@rozenite/ui`'s `FlameGraph` did for the web app. It is kept
 * out of `explore.tsx` for the reason the contribution maths is kept out of the
 * card: a cut that decides which frames a reader sees has to be readable, and
 * testable, without a DOM around it.
 *
 * The frame-name tests below are a second copy of the ones in
 * `tracesift-labels.ts`, which keeps its own private pair. They answer
 * different questions — that one asks whether a name locates a frame well
 * enough to drop the file path beside it, this one asks whether a frame
 * survives the cut — and TraceSift itself carries both, in `frame-location.ts`
 * and `frame-names.ts`. Merging them here would tie two unrelated decisions to
 * one list.
 */

import type { TraceSiftTreeNode } from "../../../shared/tracesift.ts";

/**
 * The classes a focused view keeps.
 *
 * `native` is dropped as a class and kept as an exception, which
 * `isShownFrame` holds: a built-in that names itself is the one engine frame a
 * reader can act on.
 */
export const SHOWN_CLASSES: readonly string[] = ["app", "library", "anonymous"];

/** `SHOWN_CLASSES` as the set `isShownFrame` tests against. Never mutated. */
export const DRAWN_CLASSES: ReadonlySet<string> = new Set(SHOWN_CLASSES);

const TRANSPARENT_NAMES = new Set(["(root)", "(program)", "(idle)", "(garbage collector)", "(optimized code)", "(anonymous function)"]);
const DISPATCH_NAMES = new Set(["processTicksAndRejections", "runMicrotasks", "processTimers", "listOnTimeout", "flushWork", "workLoop", "performWorkUntilDeadline"]);
const ANONYMOUS_NAMES = new Set(["", "(anonymous)", "anonymous", "<anonymous>"]);
const OPAQUE_NAMES = new Set(["Function call", "FunctionCall", "(unknown)", "eval", "require", "metroRequire", "__webpack_require__",
  "loadModuleImplementation", "guardedLoadModule", "call", "apply", "bind", "tryCatch", "asyncGeneratorStep", "_asyncToGenerator", "step", "invokeFunc"]);

/**
 * `t`, `_r`, `Ci`, `t.A` — a real name from a minified bundle that still says
 * nothing. Two characters per segment, not three: `map`, `get`, `run` and `top`
 * are far more often something a developer wrote than a mangled identifier, and
 * every segment has to be mangled for the name to be, so `eK.useMemo` survives.
 */
const MANGLED = /^(?:[_$A-Za-z][_$A-Za-z0-9]?\.)*[_$A-Za-z][_$A-Za-z0-9]?$/;

/**
 * Hermes reports a collection pause as a frame — `[GC Young Gen]` — where V8
 * reports `(garbage collector)`. It is the engine's own housekeeping rather
 * than a call the product made, so it is held apart from the built-ins that
 * are: nobody rewrites a young-generation collection.
 */
const ENGINE_STATE = /^\[GC\b/;

function isEngineStateName(name: string): boolean {
  return TRANSPARENT_NAMES.has(name) || ENGINE_STATE.test(name);
}

/** A name that says something a developer wrote, rather than machinery or mangling. */
function isMeaningfulName(name: string): boolean {
  if (ANONYMOUS_NAMES.has(name) || TRANSPARENT_NAMES.has(name) || OPAQUE_NAMES.has(name) || DISPATCH_NAMES.has(name)) return false;
  return !MANGLED.test(name);
}

/**
 * A built-in the product asked for by name: `[Native] intlDateTimeFormatFormat`
 * under Hermes, `toLocaleString (native date.js)` under V8.
 *
 * The rest of the engine is collapsed because a reader cannot act on it, and
 * these are the frames that test fails on. `intlDateTimeFormatFormat` names a
 * call the product made at a cost the product controls — a formatter hoisted
 * out of a loop, a `localeCompare` swapped for a collator. It is frequently the
 * whole finding, and collapsing it charged its time upward as self time, so the
 * chart read `applyMerge — 2.05 s of its own` and named nothing to go and change.
 */
function isNamedBuiltin(name: string, frameClass: string): boolean {
  return frameClass === "native" && isMeaningfulName(name) && !isEngineStateName(name);
}

/** Whether a focused view draws this frame at all. */
export function isShownFrame(name: string, frameClass: string, kept: ReadonlySet<string> = DRAWN_CLASSES): boolean {
  return kept.has(frameClass) || isNamedBuiltin(name, frameClass);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * The subtree with the framework and the engine collapsed away: the cut the
 * timeline draws by, applied to the rows instead of the boxes.
 *
 * Dropping a frame lifts its children into its place and charges the time it
 * burned in its own body to the nearest kept frame above it, which is what the
 * timeline does with the same frames. So a parent's total still accounts for
 * its own self time plus its children's totals, and the figures on the two
 * views agree where a frame appears on both.
 *
 * `node` itself is always kept, whatever it is: it is the frame the reader
 * focused the view on, and a tree rendered without its own root is not a tree.
 */
export function focusedTree(node: TraceSiftTreeNode, kept: ReadonlySet<string> = DRAWN_CLASSES): TraceSiftTreeNode {
  const below = focusedChildren(node.children, kept);
  return { ...node, selfMs: round1(node.selfMs + below.strippedMs), children: below.nodes };
}

function focusedChildren(nodes: readonly TraceSiftTreeNode[], kept: ReadonlySet<string>): { nodes: TraceSiftTreeNode[]; strippedMs: number } {
  const out: TraceSiftTreeNode[] = [];
  let strippedMs = 0;
  for (const node of nodes) {
    const below = focusedChildren(node.children, kept);
    if (isShownFrame(node.name, node.frameClass, kept)) {
      out.push({ ...node, selfMs: round1(node.selfMs + below.strippedMs), children: below.nodes });
      continue;
    }
    // The frame goes, its children come up a row, and its own time travels on
    // up to whichever kept frame delegated into it.
    strippedMs += node.selfMs + below.strippedMs;
    out.push(...below.nodes);
  }
  // Hoisted children arrive interleaved with the siblings they are joining, and
  // every other ranking in this tool is heaviest first.
  out.sort((a, b) => b.totalMs - a.totalMs);
  return { nodes: out, strippedMs };
}

/** Root to `id`, or just the root when the id names nothing in this task. */
export function pathTo(root: TraceSiftTreeNode, id: string): TraceSiftTreeNode[] {
  const stack: TraceSiftTreeNode[][] = [[root]];
  while (stack.length > 0) {
    const path = stack.pop()!;
    const node = path[path.length - 1];
    if (node.id === id) return path;
    for (const child of node.children) stack.push([...path, child]);
  }
  return [root];
}

/** Round tick spacing: a ruler labelled 322.7 ms apart is a ruler nobody reads. */
export function tickStepMs(visibleMs: number): number {
  const rough = visibleMs / 10;
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(rough, 0.001)));
  for (const step of [1, 2, 5, 10]) {
    if (rough <= step * magnitude) return step * magnitude;
  }
  return 10 * magnitude;
}

/**
 * How hot a frame is, as its own time against the hottest frame's own time in
 * this one graph — not against the profile and not against its parent. That is
 * why a field of green around a single red box is the usual shape, and reading
 * it as "almost nothing is hot" is reading it right.
 */
export type FlameBucket = "heaviest" | "heavy" | "moderate" | "light" | "none";

export interface FlameBox {
  /** Position in the graph, unique even where two frames share a node id. */
  key: string;
  id: string;
  name: string;
  frameClass: string;
  depth: number;
  /** Offset from the graph root's left edge, in ms. */
  startMs: number;
  totalMs: number;
  selfMs: number;
  bucket: FlameBucket;
}

export interface FlameLayout {
  boxes: FlameBox[];
  /** The root's duration, which every box's `left` and `width` are a share of. */
  totalMs: number;
  rows: number;
  /** Frames past the ceiling, which are never drawn at any zoom. */
  omitted: number;
}

/**
 * More boxes than a browser lays out without stalling. A deep React stack runs
 * to tens of thousands of nodes and the graph is read by eye, so this is a
 * guard rail rather than a working limit — the call tree still holds all of it.
 */
const MAX_FLAME_BOXES = 20_000;

/**
 * The subtree as a flame graph, laid out in milliseconds from the root's left
 * edge.
 *
 * Children are packed left to right from their parent's start, so the stretch
 * a parent kept for itself falls at its right-hand end. Nothing here is in
 * pixels: a box's `left` and `width` are shares of `totalMs`, which is why
 * zooming is one width on the scrolling canvas and every box follows for free.
 *
 * Walked with an explicit stack. A real stack runs hundreds of frames deep —
 * 936 in TraceSift's trace fixture — and a recursive walk of a tree that shape
 * is a stack overflow waiting for a slightly worse recording.
 */
export function flameLayout(root: TraceSiftTreeNode): FlameLayout {
  const boxes: FlameBox[] = [];
  const pending: { node: TraceSiftTreeNode; depth: number; startMs: number; key: string }[] = [{ node: root, depth: 0, startMs: 0, key: "0" }];
  let hottest = 0;
  let rows = 0;
  let omitted = 0;

  while (pending.length > 0) {
    const { node, depth, startMs, key } = pending.pop()!;
    if (boxes.length >= MAX_FLAME_BOXES) {
      omitted += 1;
      continue;
    }
    boxes.push({ key, id: node.id, name: node.name, frameClass: node.frameClass, depth, startMs, totalMs: node.totalMs, selfMs: node.selfMs, bucket: "none" });
    if (node.selfMs > hottest) hottest = node.selfMs;
    if (depth + 1 > rows) rows = depth + 1;

    // Offsets run left to right while the stack pops right to left, so the
    // children go on in reverse and come off in reading order.
    let at = startMs;
    const offsets: number[] = [];
    for (const child of node.children) {
      offsets.push(at);
      at += child.totalMs;
    }
    for (let index = node.children.length - 1; index >= 0; index -= 1) {
      pending.push({ node: node.children[index], depth: depth + 1, startMs: offsets[index], key: `${key}.${index}` });
    }
  }

  for (const box of boxes) box.bucket = flameBucket(box.selfMs, hottest);
  return { boxes, totalMs: root.totalMs, rows, omitted };
}

function flameBucket(selfMs: number, hottest: number): FlameBucket {
  if (selfMs <= 0 || hottest <= 0) return "none";
  const share = selfMs / hottest;
  if (share > 0.7) return "heaviest";
  if (share > 0.4) return "heavy";
  if (share > 0.2) return "moderate";
  return "light";
}
