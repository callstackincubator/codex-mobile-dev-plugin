/**
 * How a figure and a frame's position are written on a card. Ported from TraceSift's
 * `format.ts`, `source-location.ts` and `frame-location.ts` so both cards print the same.
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
  // V8 and Hermes label built-ins `native array.js`; they'd pass the tests below as files.
  if (/^native\s/i.test(location)) return false;
  const readable = !/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(location) || /^[a-z]:[\\/]/i.test(location);
  return readable && /\.(?:[cm]?[jt]sx?|vue|svelte)(?::|$)/i.test(location);
}

/**
 * Whether a compacted label names a source file rather than a build artefact.
 * A label with a separator is a readable URL; a bare name is judged by extension,
 * since bundlers never emit `.tsx`, `.ts`, `.vue` or `.svelte`.
 */
export function isSourceLabel(location: string): boolean {
  if (!isReadableSourcePath(location)) return false;
  return /[\\/]/.test(location) || !/\.[cm]?js(?::|$)/i.test(location);
}

/**
 * Cuts a path to the package (after `node_modules`) or the last few segments,
 * prefixed `…/`, dropping the recording machine's home directory. Callers keep the full path in a `title`.
 */
export function shortLocationLabel(label: string): string {
  const position = /(?::\d+){1,2}$/.exec(label)?.[0] ?? "";
  const path = position ? label.slice(0, -position.length) : label;
  if (!isSourceLabel(label) || !path.includes("/")) return label;

  const segments = path.split("/");
  const vendored = segments.lastIndexOf("node_modules");
  const start = vendored >= 0 ? vendored : Math.max(segments.length - 3, 0);
  // A leading `/` gives an empty first segment; cutting there would add a misleading `…/`.
  if (segments.slice(0, start).every(segment => segment === "")) return label;
  return `…/${segments.slice(start).join("/")}${position}`;
}

const TRANSPARENT_NAMES = new Set(["(root)", "(program)", "(idle)", "(garbage collector)", "(optimized code)", "(anonymous function)"]);
const DISPATCH_NAMES = new Set(["processTicksAndRejections", "runMicrotasks", "processTimers", "listOnTimeout", "flushWork", "workLoop", "performWorkUntilDeadline"]);
const ANONYMOUS_NAMES = new Set(["", "(anonymous)", "anonymous", "<anonymous>"]);
const OPAQUE_NAMES = new Set(["Function call", "FunctionCall", "(unknown)", "eval", "require", "metroRequire", "__webpack_require__",
  "loadModuleImplementation", "guardedLoadModule", "call", "apply", "bind", "tryCatch", "asyncGeneratorStep", "_asyncToGenerator", "step", "invokeFunc"]);
/** Two characters per segment, not three: `map`, `get`, `run` are usually real names. Every segment must be mangled, so `eK.useMemo` doesn't match. */
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
 * Whether a frame's position is worth printing beside its name. Source paths always
 * are; a build artefact (chunk and offset) only when the name is uninformative or
 * recorded at more than one position. Ambiguity is counted over the whole card so a
 * frame reads the same in the chart, detail panel and Explore.
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
 * Every frame a task card can name, the scope positions are judged over. The web app
 * walks the call tree; here the analysis response omits it, so the tree is optional and
 * the card's own frames stand in. A smaller scope can only hide a position, never invent one.
 */
export function taskCardLocations(card: LocatableCard): FrameLocations {
  return frameLocations([
    ...card.boundaryFrames,
    ...card.boundaryFrames.flatMap(frame => [...(frame.culprits ?? []), ...(frame.inside ?? [])]),
    ...card.culprits,
    ...treeFrames(card.tree),
  ]);
}
