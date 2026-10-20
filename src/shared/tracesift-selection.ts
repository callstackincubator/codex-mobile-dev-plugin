/**
 * The evidence behind frames a reader picked inside Explore.
 *
 * The card's Investigate button asks about a whole task, and TraceSift's own
 * service writes that hand-off. This is the other question: not "what is wrong
 * with this task" but "what do you make of these four frames I have my eye on",
 * which only the reader can ask and only the view can answer — the picks live in
 * the panel, and the whole call tree is already in this frame.
 *
 * So this is written here rather than fetched, for the same reason the slice
 * arithmetic is: a round trip to the service could not know what was clicked
 * anyway, and an older installed TraceSift would not know the question.
 *
 * The rules are the ones the service's own hand-offs keep. Everything measured,
 * nothing concluded; a figure is labelled with what it counts; time that cannot
 * be attributed is named rather than folded into a total; and the caveats that
 * decide how a number should be read travel with the number. A model reads this
 * as evidence about a profile it did not record, so the one thing it must not
 * have to guess is how the figures add up.
 */

import { formatMs } from "./tracesift-labels.ts";

/** The part of a task hand-off this reads. `TaskHandoff` from @callstack/tracesift-explore, structurally. */
export interface SelectionTree {
  id: string;
  name: string;
  location?: string;
  frameClass: string;
  totalMs: number;
  selfMs: number;
  invocations: number;
  children: SelectionTree[];
}

export interface SelectionCard {
  durationMs: number;
  percentOfProfile?: number;
  boundaries?: string;
  headline?: string;
  pathline?: string;
  tree: SelectionTree;
  /** The card's ranked culprits, which the views list and a reader can pick from. */
  culprits?: readonly { nodeId: string; selfMs: number; invocations: number; longestCallMs?: number }[];
}

export interface SelectedFrame {
  /**
   * Which pick this is, counting from one, matching the number the views draw
   * beside it.
   *
   * Carried rather than derived from a position in the result, because a pick
   * that turns out not to name a frame is dropped from the list and must not
   * renumber the ones after it: the reader counted these off the screen.
   */
  pick: number;
  nodeId: string;
  name: string;
  location?: string;
  frameClass: string;
  totalMs: number;
  selfMs: number;
  invocations: number;
  /** Root to this frame, itself last, names only. */
  path: string[];
  /**
   * The task's own culprit row for this frame, when it has one.
   *
   * Its figures are measured across every call site of the frame, while the
   * figures above it are this one node's, so the two are never the same number
   * and the prompt says which is which rather than printing one frame's cost
   * twice.
   */
  culprit?: { selfMs: number; invocations: number; longestCallMs?: number };
}

export interface FrameSelectionEvidence {
  /** In the order the reader picked, minus any id the tree does not hold. */
  frames: SelectedFrame[];
  /** Picked ids the tree in hand holds no node for. */
  unresolved: string[];
  /**
   * Picks that contain another pick, as `[outerId, innerId]` pairs.
   *
   * Nested picks are not a mistake — a reader often wants both a function and
   * the call inside it — but their totals overlap, so the set's cost cannot be
   * stated as a sum until they are named.
   */
  overlaps: [string, string][];
  /** Self time across the picks, counted once per frame even when one called another. */
  selfMsTogether: number;
  /** How much of the task that is, 0-100. */
  selfShare: number;
  /**
   * Self time across every frame in the tree, which is the whole the picks and
   * the remainder divide.
   *
   * Measured rather than assumed equal to `durationMs`: a frame's self time is
   * its own plus the collection and deoptimisation it caused, so the frames of a
   * task do partition its measured time — but rounding, and any recording that
   * left the tree a few tenths short, are exactly the kind of thing a stated
   * subtraction should not have to rely on.
   */
  treeSelfMs: number;
}

/** The synthetic node every task's tree starts at, which is not a frame. */
const SYNTHETIC_ROOT = "(root)";

interface Located { node: SelectionTree; path: string[] }

/** Every node in the tree, by id, with the names of the real frames above it. */
function indexTree(root: SelectionTree): Map<string, Located> {
  const found = new Map<string, Located>();
  const walk = (node: SelectionTree, path: string[]) => {
    const here = node.name === SYNTHETIC_ROOT ? path : [...path, node.name];
    found.set(node.id, { node, path: here });
    for (const child of node.children) walk(child, here);
  };
  walk(root, []);
  return found;
}

const percentOf = (value: number, total: number) => (total > 0 ? (value / total) * 100 : 0);
const rounded = (value: number) => Math.round(value * 10) / 10;

export function frameSelectionEvidence(card: SelectionCard, selectedNodeIds: readonly string[]): FrameSelectionEvidence {
  const index = indexTree(card.tree);
  const culprits = new Map((card.culprits ?? []).map(culprit => [culprit.nodeId, culprit]));
  const frames: SelectedFrame[] = [];
  const unresolved: string[] = [];
  // A reader can click the same frame twice through two views before the state
  // settles, and a duplicated line in a hand-off reads as two findings. The
  // number carried is the first-occurrence position in the order chosen, which
  // is exactly what the views numbered the frames on screen with.
  for (const nodeId of new Set(selectedNodeIds)) {
    const hit = index.get(nodeId);
    if (!hit) {
      unresolved.push(nodeId);
      continue;
    }
    const culprit = culprits.get(nodeId);
    frames.push({
      pick: selectedNodeIds.indexOf(nodeId) + 1,
      nodeId,
      name: hit.node.name,
      ...(hit.node.location ? { location: hit.node.location } : {}),
      frameClass: hit.node.frameClass,
      totalMs: hit.node.totalMs,
      selfMs: hit.node.selfMs,
      invocations: hit.node.invocations,
      path: hit.path,
      ...(culprit
        ? {
          culprit: {
            selfMs: culprit.selfMs,
            invocations: culprit.invocations,
            ...(culprit.longestCallMs === undefined ? {} : { longestCallMs: culprit.longestCallMs }),
          },
        }
        : {}),
    });
  }

  // A frame's id is the path of sibling indices to it, so one id is inside
  // another exactly when the other is a prefix of it. Judging that on the ids
  // rather than by walking back up means it holds whatever the tree's own
  // nesting looks like once a mode has collapsed frames away.
  const overlaps: [string, string][] = [];
  for (const outer of frames) {
    for (const inner of frames) {
      if (inner.nodeId.startsWith(`${outer.nodeId}.`)) overlaps.push([outer.nodeId, inner.nodeId]);
    }
  }
  // Self time is what a frame burned in its own body, so it does not double up
  // across a nested pair the way their totals do — every frame charges only
  // itself. That is also why the rest of the task falls out by subtraction: a
  // frame's self time is its own plus the collection and deoptimisation it
  // caused, which is how the frames of a task divide its measured time between
  // them. Measured over the tree rather than read off `durationMs`, so the
  // remainder is the difference of two figures in this document.
  const selfMsTogether = rounded(frames.reduce((sum, frame) => sum + frame.selfMs, 0));
  let treeSelfMs = 0;
  for (const located of index.values()) treeSelfMs += located.node.selfMs;
  treeSelfMs = rounded(treeSelfMs);
  return {
    frames,
    unresolved,
    overlaps,
    selfMsTogether,
    selfShare: rounded(percentOf(selfMsTogether, card.durationMs)),
    treeSelfMs,
  };
}

/** Durations as a reader scans them, in the same words the cards use. */
const ms = formatMs;

/** What each non-application class is called when a run of them is folded away. */
const FOLD_WORDS: Record<string, string> = {
  framework: "framework",
  native: "engine",
  anonymous: "unnamed",
  library: "dependency",
};

/**
 * Which frames the tree prints rather than folds.
 *
 * Ported from Explore's `isShownFrame`/`SHOWN_CLASSES` — the same cut the
 * timeline, the focused call tree and the flame graph draw by — because this
 * describes what the reader was looking at when they clicked, and a fold that
 * kept a frame the view had collapsed (or the other way round) would describe
 * some other stack. It lives here rather than as an import for the reason the
 * label and slice helpers do: this file sits on the shared side of the build,
 * where the Explore package's React peer dependency cannot come along.
 *
 * `native` is dropped as a class and kept as an exception, which is the part
 * that carries weight: `intlDateTimeFormatFormat` is a call the product made at
 * a cost it controls, and it is frequently the whole finding. The bar the package
 * holds it to is the one a card title clears; the approximation below keeps
 * engine-state names and an unnamed built-in folded, which is the half that
 * matters for a tree, and errs toward printing a frame rather than hiding one.
 */
const KEPT_CLASSES = new Set(["app", "library", "anonymous"]);

/** The engine's own housekeeping, which names nothing a reader can act on. */
const ENGINE_STATE = new Set(["(idle)", "(program)", "(garbage collector)", "(gc)", "(bootstrap)"]);

/** Names a frame carries because the profiler needed something to print. */
const NAMES_NOTHING = new Set(["", "(anonymous)", "anonymous", "<anonymous>", "(root)", "(function)", "Function call", "FunctionCall"]);

function isPrintedFrame(name: string, frameClass: string): boolean {
  // A name the recorder invented says nothing even on a frame of a kept class:
  // an `(anonymous)` row is exactly the scaffolding a fold exists to hide.
  if (NAMES_NOTHING.has(name.trim())) return false;
  if (KEPT_CLASSES.has(frameClass)) return true;
  if (frameClass !== "native") return false;
  return !name.startsWith("(") && !ENGINE_STATE.has(name.toLowerCase());
}

/** How far below a selected frame to follow the heaviest child. */
const MAX_HOT_DESCENT = 3;

/** Below this many frames folded, it is not worth a line of its own. */
const MIN_COLLAPSED_RUN = 3;

interface TreeRow {
  label: string;
  /** The suffix naming a selection, kept out of the folding test below. */
  note?: string;
  /** A frame worth printing on its own: application code, or a run-break. */
  named: boolean;
  frameClass: string;
  children: TreeRow[];
}

/**
 * The frames joining the task to every selection, and the heaviest frames inside
 * each of them, as one tree.
 *
 * Same reason the service's hand-off merges rather than printing a stack per
 * frame: four picks under one render share the dozen frames above them, and four
 * stacks would be four copies of one chain, burying the branch point that is the
 * actually useful fact. Folding says which runs of frames between the picks were
 * dropped rather than leaving a jump unexplained.
 *
 * The shape is shared with TraceSift's own hand-offs — `├─`, `←`, and `… (N
 * framework frames)` for a folded run — so a reader who has copied a card sees
 * one kind of tree rather than two.
 */
function selectionsTree(card: SelectionCard, frames: readonly SelectedFrame[]): string[] {
  const byId = new Map<string, { node: SelectionTree; parent: SelectionTree | null }>();
  const pending: { node: SelectionTree; parent: SelectionTree | null }[] = [{ node: card.tree, parent: null }];
  while (pending.length > 0) {
    const here = pending.pop()!;
    byId.set(here.node.id, here);
    for (const child of here.node.children) pending.push({ node: child, parent: here.node });
  }

  // Only ids the tree actually holds are drawn; the rest are told separately.
  // The number is the pick's own, so a frame the tree dropped does not renumber
  // the ones after it away from what the reader saw on screen.
  const marked = new Map<string, number>();
  for (const frame of frames) {
    if (byId.has(frame.nodeId)) marked.set(frame.nodeId, frame.pick);
  }
  if (marked.size === 0) return [];

  const keep = new Set<string>();
  for (const id of marked.keys()) {
    // Ancestors of a kept node are kept, so meeting one ends the walk. Parent
    // links come from the walk above rather than from cutting the id up, so a
    // tree whose ids are not plain dotted paths still resolves.
    let here = byId.get(id);
    while (here && !keep.has(here.node.id)) {
      keep.add(here.node.id);
      here = here.parent ? byId.get(here.parent.id) : undefined;
    }
  }
  // And the heaviest few frames inside each pick: where its own time went.
  for (const id of marked.keys()) {
    let node = byId.get(id)?.node;
    for (let depth = 0; depth < MAX_HOT_DESCENT && node; depth += 1) {
      const next = [...node.children].sort((a, b) => b.totalMs - a.totalMs)[0];
      // A frame descending into itself is recursion, already said on its row.
      if (!next || next.name === node.name) break;
      keep.add(next.id);
      node = next;
    }
  }

  const rowFor = (node: SelectionTree): TreeRow => ({
    label: node.name,
    ...(marked.has(node.id) ? { note: `  ← selection #${marked.get(node.id)}` } : {}),
    named: isPrintedFrame(node.name, node.frameClass),
    frameClass: node.frameClass,
    children: node.children
      .filter(child => keep.has(child.id))
      .sort((a, b) => b.totalMs - a.totalMs)
      .map(rowFor),
  });

  // The synthetic root is not a frame, so the tree starts at its children.
  return rowFor(card.tree).children.flatMap(row => drawRow(collapse(row), "", true, true));
}

/** Fold a run of single-child scaffolding into one line; never fold a named frame. */
function collapse(row: TreeRow): TreeRow {
  const run: TreeRow[] = [];
  let current = row;
  while (!current.note && !current.named && current.children.length === 1) {
    run.push(current);
    current = current.children[0];
  }
  const tail: TreeRow = { ...current, children: current.children.map(collapse) };
  if (run.length >= MIN_COLLAPSED_RUN) {
    const kinds = new Set(run.map(node => FOLD_WORDS[node.frameClass]));
    const kind = kinds.size === 1 ? [...kinds][0] : undefined;
    return {
      label: `… (${run.length} ${kind ? `${kind} ` : ""}frames)`,
      named: false,
      frameClass: run[0].frameClass,
      children: [tail],
    };
  }
  return run.reduceRight<TreeRow>((child, node) => ({ ...node, children: [child] }), tail);
}

function drawRow(row: TreeRow, prefix: string, isLast: boolean, isRoot: boolean): string[] {
  const connector = isRoot ? "" : isLast ? "└─ " : "├─ ";
  const lines = [`${prefix}${connector}${row.label}${row.note ?? ""}`];
  const childPrefix = isRoot ? prefix : `${prefix}${isLast ? "   " : "│  "}`;
  row.children.forEach((child, index) => {
    lines.push(...drawRow(child, childPrefix, index === row.children.length - 1, false));
  });
  return lines;
}

/**
 * A share, as the hand-off writes it.
 *
 * One decimal throughout: rounding to a whole percent makes 99.6 read as
 * "100% of the recording", and two frames at 70.4% and 69.5% read as the same
 * figure. The cost of the extra digit is nothing next to a stated equality that
 * the measurement does not support.
 */
const percentText = (value: number) => `${value.toFixed(1)}%`;

/**
 * The hand-off for a set of picked frames.
 *
 * Numbered in the order the reader chose them, matching the number each one
 * carries on screen, so "the third one" means the same thing in both places.
 */
export function buildSelectionPrompt(input: {
  card: SelectionCard;
  evidence: FrameSelectionEvidence;
  /** The profile this came from, when the panel knows it. */
  profileTitle?: string;
  /** The card's own headline, so the chat says which task the picks sit in. */
}): string {
  const { card, evidence } = input;
  const lines: string[] = [];

  lines.push(
    `Use the measured evidence below to investigate ${evidence.frames.length} frame${evidence.frames.length === 1 ? "" : "s"} I selected while exploring one profiled task in TraceSift, and tell me what they say about why this task is slow and what would be worth changing first.`,
  );
  lines.push("");
  lines.push(
    `I picked these myself, one at a time, in the Explorer's timeline, flame graph, call tree and culprit list. They are a starting point rather than a verdict: I have not concluded that they are the cause, and the measurements do not say they are.`,
  );
  lines.push("");

  lines.push(`## The task they sit in`);
  lines.push(`- ${card.pathline ?? card.headline ?? "A task in this recording"}`);
  lines.push(`- Measured from a CPU profile of a running build. The task ran ${ms(card.durationMs)}${card.percentOfProfile === undefined ? "" : `, ${percentText(card.percentOfProfile)} of the recording`}.`);
  if (input.profileTitle) lines.push(`- Recording: ${input.profileTitle}`);
  if (card.boundaries === "inferred") {
    lines.push(`- The profiler recorded no boundary around this task, so its start and duration were reconstructed from the gaps between sample runs and are approximate. The work inside it is measured.`);
  }
  lines.push("");

  lines.push(`## What I selected`);
  evidence.frames.forEach((frame) => {
    const share = percentText(percentOf(frame.totalMs, card.durationMs));
    const selfShare = percentText(percentOf(frame.selfMs, card.durationMs));
    lines.push(`${frame.pick}. \`${frame.name}\`${frame.location ? ` — ${frame.location}` : ""}`);
    lines.push(
      `   - ${ms(frame.totalMs)} including everything it called (${share} of the task), ${ms(frame.selfMs)} of its own (${selfShare}), ${frame.invocations} call${frame.invocations === 1 ? "" : "s"}.`,
    );
    if (frame.frameClass !== "app") lines.push(`   - Classified as \`${frame.frameClass}\` code, not application code.`);
    lines.push(`   - Reached through: ${frame.path.slice(0, -1).map(part => `\`${part}\``).join(" › ") || "the top of the task"}`);
    if (frame.culprit) {
      // Measured across every call site of this frame, not just the one above,
      // so it is larger and has to be labelled or it reads as a contradiction.
      lines.push(
        `   - It is also one of the task's ranked culprits, counted across all of its call sites rather than this one: ${ms(frame.culprit.selfMs)} of self time over ${frame.culprit.invocations} call${frame.culprit.invocations === 1 ? "" : "s"}${frame.culprit.longestCallMs === undefined ? "" : `, longest single call ${ms(frame.culprit.longestCallMs)}`}.`,
      );
    }
  });
  lines.push("");

  // Two picks can be the same function at two call sites, which the tree keeps
  // apart and a reader reasonably does not expect. Said plainly, because a model
  // reading two identically named entries either merges them into one finding and
  // loses a call site's worth of time, or reports them as two separate problems.
  const callSites = new Map<string, SelectedFrame[]>();
  for (const frame of evidence.frames) {
    const key = `${frame.name}\u0000${frame.location ?? ""}`;
    callSites.set(key, [...(callSites.get(key) ?? []), frame]);
  }
  const shared = [...callSites.values()].filter(frames => frames.length > 1);
  if (shared.length > 0) {
    lines.push(`## Two selections are the same function`);
    for (const frames of shared) {
      lines.push(
        `- ${frames.map(frame => `\`${frame.name}\` (selection ${frame.pick})`).join(" and ")} are the same function recorded at separate call sites${frames[0].location ? ` of ${frames[0].location}` : ""}. Their own times are different work and do add; their names being alike is not one finding repeated.`,
      );
    }
    lines.push("");
  }

  if (evidence.overlaps.length > 0) {
    lines.push(`## How these overlap`);
    for (const [outerId, innerId] of evidence.overlaps) {
      const outer = evidence.frames.find(frame => frame.nodeId === outerId);
      const inner = evidence.frames.find(frame => frame.nodeId === innerId);
      if (!outer || !inner) continue;
      lines.push(
        `- Selection ${outer.pick} (\`${outer.name}\`, ${ms(outer.totalMs)}) contains selection ${inner.pick} (\`${inner.name}\`, ${ms(inner.totalMs)}). Their inclusive times count the same milliseconds; treat ${inner.pick} as where the time inside ${outer.pick} went, not as extra cost.`,
      );
    }
    lines.push("");
  }

  lines.push(`## What they add up to`);
  lines.push(
    `- Their own time together is ${ms(evidence.selfMsTogether)} — ${percentText(evidence.selfShare)} of the task's ${ms(card.durationMs)}. Self time is counted once per frame, so it does not double up where one selection called another.`,
  );
  lines.push(`- Their inclusive times are not additive, so they have no sum worth quoting${evidence.overlaps.length > 0 ? ", and the overlap is spelled out above" : ""}.`);
  // Both sides of the subtraction are figures this document states, so the
  // remainder is arithmetically true here rather than true if the tree happens
  // to sum to the card's own duration to the tenth.
  const residual = rounded(evidence.treeSelfMs - evidence.selfMsTogether);
  if (residual > 0.05) {
    lines.push(
      `- The other ${ms(residual)} of the task's ${ms(evidence.treeSelfMs)} of frame self time is in frames I did not select. That is not time accounted for, and it is not nothing: it is the part of this task I have not asked you about.`,
    );
  }
  lines.push("");

  const tree = selectionsTree(card, evidence.frames);
  if (tree.length > 0) {
    lines.push(`## Where those frames sit`);
    lines.push(
      `The frames joining the task to everything I selected, with the heaviest frames inside each. \`←\` marks a selection and its number, \`…\` a run of frames carrying no name worth reading.`,
    );
    lines.push("");
    lines.push("```", ...tree, "```");
    lines.push("");
  }

  if (evidence.unresolved.length > 0) {
    lines.push(`## I could not place ${evidence.unresolved.length === 1 ? "one selection" : `${evidence.unresolved.length} selections`}`);
    lines.push(
      `The view reported ${evidence.unresolved.length === 1 ? "it" : "them"} as selected but the task's call tree holds no frame with ${evidence.unresolved.length === 1 ? "that reference" : "those references"}, so ${evidence.unresolved.length === 1 ? "it carries" : "they carry"} no figures. Say which selections those are rather than guessing at what they were.`,
    );
    lines.push("");
  }

  lines.push(`## How to read these numbers`);
  lines.push(`- This has only frame names, source positions and timings. It has not read any source file. Confirm what each of these functions actually does before changing it.`);
  lines.push(`- A CPU profile is samples, not a count of calls. Self time is what was on top of the stack; a frame's own figure is an estimate spread across the samples it appeared in, and a frame that never sat on top of the stack can show 0 ms of its own while the work it delegated to is real.`);
  lines.push(`- A frame's total includes everything it delegated to, including React and engine work and any collection pause that fell inside it, so a total can be wider than the same call's measured duration elsewhere.`);
  lines.push(`- Where I picked a frame in the timeline or the flame graph, React and engine frames were collapsed away in what I was looking at, and a dropped frame's own time was charged to the nearest frame kept above it. So the frames above a pick in the tree above are the recorded stack; what I saw on screen may have shown fewer of them.`);
  lines.push(`- Nothing here is a conclusion, and I did not rank these. Say which of these figures supports what you conclude, and where the measurement cannot tell two explanations apart, say that instead of choosing one.`);

  return lines.join("\n");
}
