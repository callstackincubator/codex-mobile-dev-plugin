/**
 * How a figure and a frame's position are written on a card.
 *
 * Ported from TraceSift's `src/lib/format.ts`, `src/lib/source-location.ts` and
 * `src/lib/frame-location.ts`, for the same reason the slice arithmetic is
 * ported: a reader comparing the card in this chat against the card in the
 * TraceSift tab must not find two spellings of one number, or a file path on
 * one and a bundle chunk on the other.
 */

/** Durations as a reader scans them: whole milliseconds until seconds are clearer. */
export function formatMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0 ms";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const seconds = ms / 1000;
  if (seconds < 10) return `${seconds.toFixed(2)} s`;
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} m ${Math.round(seconds % 60)} s`;
}

/** React commit durations keep the sub-millisecond precision the profiler records. */
export function formatReactMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0 ms";
  if (ms < 1) return `${Number(ms.toFixed(2))} ms`;
  if (ms < 1000) return `${Number(ms.toFixed(1))} ms`;
  return formatMs(ms);
}

/** `location` may be a bare path or a full `path:line:column` label. */
function isReadableSourcePath(location: string): boolean {
  // V8 and Hermes label built-ins `native array.js` and the like. Those end in
  // `.js` and carry no scheme, so the tests below would otherwise accept them
  // as a file a developer could open.
  if (/^native\s/i.test(location)) return false;
  const readable = !/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(location) || /^[a-z]:[\\/]/i.test(location);
  return readable && /\.(?:[cm]?[jt]sx?|vue|svelte)(?::|$)/i.test(location);
}

/**
 * Whether a compacted label names a source file rather than a build artefact.
 *
 * A readable URL keeps its directories through compaction and everything else
 * is cut back to a bare file name, so a label carrying a separator is the
 * readable branch. A bare name is judged on its extension instead: no bundler
 * emits `.tsx`, `.ts`, `.vue` or `.svelte`, while a chunk is always plain
 * JavaScript.
 */
export function isSourceLabel(location: string): boolean {
  if (!isReadableSourcePath(location)) return false;
  return /[\\/]/.test(location) || !/\.[cm]?js(?::|$)/i.test(location);
}

/**
 * A readable path cut down to the part that tells a reader where they are.
 *
 * A profile recorded on another machine carries that machine's home directory,
 * and sixty characters pass before the first thing that distinguishes one row
 * from every other. What survives: the package, once a path passes through
 * `node_modules`, and otherwise the last few segments — prefixed `…/` so the
 * label never reads as the whole path. Every caller keeps the full one in a
 * `title`.
 */
export function shortLocationLabel(label: string): string {
  const position = /(?::\d+){1,2}$/.exec(label)?.[0] ?? "";
  const path = position ? label.slice(0, -position.length) : label;
  if (!isSourceLabel(label) || !path.includes("/")) return label;

  const segments = path.split("/");
  const vendored = segments.lastIndexOf("node_modules");
  const start = vendored >= 0 ? vendored : Math.max(segments.length - 3, 0);
  // A leading `/` splits to an empty first segment, so `/src/app/list.tsx` has
  // one segment to drop and nothing in it. Cutting there would add a `…/` that
  // promises a prefix the reader was never missing.
  if (segments.slice(0, start).every(segment => segment === "")) return label;
  return `…/${segments.slice(start).join("/")}${position}`;
}

const TRANSPARENT_NAMES = new Set(["(root)", "(program)", "(idle)", "(garbage collector)", "(optimized code)", "(anonymous function)"]);
const DISPATCH_NAMES = new Set(["processTicksAndRejections", "runMicrotasks", "processTimers", "listOnTimeout", "flushWork", "workLoop", "performWorkUntilDeadline"]);
const ANONYMOUS_NAMES = new Set(["", "(anonymous)", "anonymous", "<anonymous>"]);
const OPAQUE_NAMES = new Set(["Function call", "FunctionCall", "(unknown)", "eval", "require", "metroRequire", "__webpack_require__",
  "loadModuleImplementation", "guardedLoadModule", "call", "apply", "bind", "tryCatch", "asyncGeneratorStep", "_asyncToGenerator", "step", "invokeFunc"]);
/**
 * Two characters per segment, not three: `map`, `get`, `run` and `top` are far
 * more often something a developer wrote than a mangled identifier. Every
 * segment has to be mangled for the name to be, so `eK.useMemo` is not matched.
 */
const MANGLED = /^(?:[_$A-Za-z][_$A-Za-z0-9]?\.)*[_$A-Za-z][_$A-Za-z0-9]?$/;

/** A name that locates the frame by itself, needing no position beside it. */
function namesItself(name: string): boolean {
  if (ANONYMOUS_NAMES.has(name) || TRANSPARENT_NAMES.has(name) || OPAQUE_NAMES.has(name) || DISPATCH_NAMES.has(name)) return false;
  return !MANGLED.test(name);
}

export interface FrameLocations {
  /** The position to show for this frame, or nothing when its name suffices. */
  shown: (name: string, location: string | undefined) => string | undefined;
}

interface NamedFrame { name: string; location?: string }

/**
 * Whether a frame's recorded position is worth printing beside its name.
 *
 * On a bundled build that position is a chunk and an offset, which is a build
 * artefact on forty rows and says nothing the name search would not. It is not
 * noise everywhere, though: a position is the only thing separating
 * `(anonymous)` from `(anonymous)`, or a profile's two `compute` frames. So a
 * source path is shown whole, and an artefact is shown exactly where the name
 * does not stand on its own — a name that says nothing by itself, or a name
 * recorded at more than one position.
 *
 * Ambiguity is counted over the whole card rather than per row, so a frame
 * reads the same in the chart, the detail panel and Explore.
 */
export function frameLocations(frames: Iterable<NamedFrame>): FrameLocations {
  const positions = new Map<string, Set<string>>();
  for (const frame of frames) {
    if (!frame.location) continue;
    const seen = positions.get(frame.name);
    if (seen) seen.add(frame.location);
    else positions.set(frame.name, new Set([frame.location]));
  }
  return {
    shown: (name, location) => {
      if (!location) return undefined;
      if (isSourceLabel(location)) return location;
      if (namesItself(name) && (positions.get(name)?.size ?? 0) < 2) return undefined;
      return location;
    },
  };
}

interface LocatableCard {
  boundaryFrames: readonly (NamedFrame & { culprits?: readonly NamedFrame[]; inside?: readonly NamedFrame[] })[];
  culprits: readonly NamedFrame[];
  tree?: { name: string; location?: string; children: readonly unknown[] };
}

function* treeFrames(root: LocatableCard["tree"]): Generator<NamedFrame> {
  if (!root) return;
  const pending = [root];
  while (pending.length > 0) {
    const node = pending.pop()!;
    yield node;
    for (const child of node.children) pending.push(child as NonNullable<LocatableCard["tree"]>);
  }
}

/**
 * Every frame a task card can name, which is the scope its positions are judged
 * over.
 *
 * The web app walks the call tree here, because its card always carries one.
 * This one's does not: the analysis response leaves the tree out and Explore
 * fetches it, so the walk is optional and the frames the card itself draws —
 * the boundaries, what they called and what burned them — stand in for it.
 * Judging ambiguity over a smaller scope can only hide a position, never invent
 * one, and the frames left out are the ones no card row prints.
 */
export function taskCardLocations(card: LocatableCard): FrameLocations {
  return frameLocations([
    ...card.boundaryFrames,
    ...card.boundaryFrames.flatMap(frame => [...(frame.culprits ?? []), ...(frame.inside ?? [])]),
    ...card.culprits,
    ...treeFrames(card.tree),
  ]);
}
