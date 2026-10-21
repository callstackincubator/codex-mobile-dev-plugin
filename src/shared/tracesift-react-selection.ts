/**
 * Evidence behind components picked in a React Explore (`tracesift-selection.ts`
 * is the CPU side). Unsampled, so exact for renders and silent about the rest.
 */

import { formatReactMs, shortLocationLabel } from "./tracesift-labels.ts";

/** One rendered fiber. `ReactExploreNode` from @callstack/tracesift-explore, structurally. */
export interface ReactSelectionNode {
  id: number;
  name: string;
  componentClass: string;
  selfMs: number;
  actualMs: number;
  cause: string;
  changedProps: string[];
  changedHooks: string[];
  compiledWithForget: boolean;
  sourceHint: string | null;
  children: ReactSelectionNode[];
}

/** One commit. `ReactExploreCommit`, structurally, minus the fields no prompt quotes. */
export interface ReactSelectionCommit {
  rootId: number;
  commitIndex: number;
  startMs: number;
  durationMs: number;
  renderedCount: number;
  /** Every rendered component's own time, added up: the partition's measured total. */
  summedSelfMs: number;
  /** Render time that reached no component: the reconciler walking the tree. */
  unattributedMs: number;
  overBudget: boolean;
  causesRecorded: boolean;
  treeDropped: boolean;
  tree: ReactSelectionNode[];
}

/** The recording the picks were made in. `ReactExplore`, structurally. */
export interface ReactSelectionRecording {
  budgetMs: number;
  spanMs: number;
  commitsOverBudget: number;
  commits: ReactSelectionCommit[];
}

export interface SelectedComponent {
  /**
   * Which pick this is, matching the number the views draw. Carried, not derived:
   * a dropped pick must not renumber the ones counted off the screen.
   */
  pick: number;
  key: string;
  rootId: number;
  commitIndex: number;
  fiberId: number;
  name: string;
  componentClass: string;
  sourceHint?: string;
  selfMs: number;
  actualMs: number;
  cause: string;
  changedProps: string[];
  changedHooks: string[];
  compiledWithForget: boolean;
  /** The rendered components above this one, itself last, names only. */
  path: string[];
}

/** The picks of one commit, and what that commit measured. */
export interface SelectedCommit {
  rootId: number;
  commitIndex: number;
  startMs: number;
  durationMs: number;
  renderedCount: number;
  summedSelfMs: number;
  unattributedMs: number;
  overBudget: boolean;
  causesRecorded: boolean;
  picks: SelectedComponent[];
  /** Own time across this commit's picks, counted once per component. */
  selfMsTogether: number;
  /** How much of this commit's render duration that is, 0-100. */
  selfShare: number;
}

export interface ReactSelectionEvidence {
  /** In the order the reader picked, minus any key the recording does not hold. */
  components: SelectedComponent[];
  /** The same picks grouped by the commit they were made in, in commit order. */
  commits: SelectedCommit[];
  /** Picked keys the recording in hand holds no component for. */
  unresolved: string[];
  /**
   * Picks that rendered another pick, within one commit. Named because `actualMs`
   * double-counts across such a pair (`selfMs` never does).
   */
  overlaps: [string, string][];
  /** Own time across every pick, in every commit, counted once per component. */
  selfMsTogether: number;
  /** Render duration across the commits the picks were made in. */
  pickedCommitsMs: number;
  /** Render duration across every commit of the recording. */
  recordedCommitsMs: number;
}

const percentOf = (value: number, total: number) => (total > 0 ? (value / total) * 100 : 0);
const rounded = (value: number) => Math.round(value * 100) / 100;

/** The id a picked component is held by: `<rootId>.<commitIndex>.<fiberId>`. */
export function parseReactPick(key: string): { rootId: number; commitIndex: number; fiberId: number } | undefined {
  const parts = key.split(".");
  if (parts.length !== 3) return undefined;
  const [rootId, commitIndex, fiberId] = parts.map(Number);
  if (![rootId, commitIndex, fiberId].every(Number.isInteger)) return undefined;
  return { rootId: rootId!, commitIndex: commitIndex!, fiberId: fiberId! };
}

interface Located { node: ReactSelectionNode; path: string[]; ancestors: number[] }

/** Every rendered fiber of one commit, by id, with the components above it. */
function indexCommit(commit: ReactSelectionCommit): Map<number, Located> {
  const found = new Map<number, Located>();
  const walk = (nodes: readonly ReactSelectionNode[], path: string[], ancestors: number[]) => {
    for (const node of nodes) {
      found.set(node.id, { node, path: [...path, node.name], ancestors });
      walk(node.children, [...path, node.name], [...ancestors, node.id]);
    }
  };
  walk(commit.tree, [], []);
  return found;
}

export function reactSelectionEvidence(
  recording: ReactSelectionRecording,
  selectedKeys: readonly string[],
): ReactSelectionEvidence {
  const byCommit = new Map(recording.commits.map(commit => [`${commit.rootId}.${commit.commitIndex}`, commit]));
  const indexes = new Map<string, Map<number, Located>>();
  const components: SelectedComponent[] = [];
  const unresolved: string[] = [];

  // A reader can click the same component through the tree and the table before
  // the state settles, and a duplicated line in a hand-off reads as two
  // findings. The number carried is the first-occurrence position in the order
  // chosen, which is what the views numbered the picks on screen with.
  for (const key of new Set(selectedKeys)) {
    const parts = parseReactPick(key);
    const commit = parts ? byCommit.get(`${parts.rootId}.${parts.commitIndex}`) : undefined;
    if (!parts || !commit) {
      unresolved.push(key);
      continue;
    }
    const commitKey = `${parts.rootId}.${parts.commitIndex}`;
    let index = indexes.get(commitKey);
    if (!index) { index = indexCommit(commit); indexes.set(commitKey, index); }
    const hit = index.get(parts.fiberId);
    if (!hit) {
      unresolved.push(key);
      continue;
    }
    components.push({
      pick: selectedKeys.indexOf(key) + 1,
      key,
      rootId: parts.rootId,
      commitIndex: parts.commitIndex,
      fiberId: parts.fiberId,
      name: hit.node.name,
      componentClass: hit.node.componentClass,
      ...(hit.node.sourceHint ? { sourceHint: hit.node.sourceHint } : {}),
      selfMs: hit.node.selfMs,
      actualMs: hit.node.actualMs,
      cause: hit.node.cause,
      changedProps: hit.node.changedProps,
      changedHooks: hit.node.changedHooks,
      compiledWithForget: hit.node.compiledWithForget,
      path: hit.path,
    });
  }
  components.sort((a, b) => a.pick - b.pick);

  // Nesting is read off the commit's tree, not the ids: a fiber id is just the
  // number React handed out. Picks in different commits never overlap.
  const overlaps: [string, string][] = [];
  for (const inner of components) {
    const index = indexes.get(`${inner.rootId}.${inner.commitIndex}`);
    const ancestors = new Set(index?.get(inner.fiberId)?.ancestors ?? []);
    for (const outer of components) {
      if (outer.rootId !== inner.rootId || outer.commitIndex !== inner.commitIndex) continue;
      if (ancestors.has(outer.fiberId)) overlaps.push([outer.key, inner.key]);
    }
  }

  const commits: SelectedCommit[] = [];
  for (const commit of recording.commits) {
    const picks = components.filter(pick => pick.rootId === commit.rootId && pick.commitIndex === commit.commitIndex);
    if (picks.length === 0) continue;
    // Own time is React's `selfDuration`, a true partition of the render phase,
    // so it adds across picks whether or not one rendered another.
    const selfMsTogether = rounded(picks.reduce((sum, pick) => sum + pick.selfMs, 0));
    commits.push({
      rootId: commit.rootId,
      commitIndex: commit.commitIndex,
      startMs: commit.startMs,
      durationMs: commit.durationMs,
      renderedCount: commit.renderedCount,
      summedSelfMs: commit.summedSelfMs,
      unattributedMs: commit.unattributedMs,
      overBudget: commit.overBudget,
      causesRecorded: commit.causesRecorded,
      picks,
      selfMsTogether,
      selfShare: rounded(percentOf(selfMsTogether, commit.durationMs)),
    });
  }

  return {
    components,
    commits,
    unresolved,
    overlaps,
    selfMsTogether: rounded(components.reduce((sum, pick) => sum + pick.selfMs, 0)),
    // Commits do not overlap in time, so these do add — which is the whole
    // reason a selection is allowed to cross them.
    pickedCommitsMs: rounded(commits.reduce((sum, commit) => sum + commit.durationMs, 0)),
    recordedCommitsMs: rounded(recording.commits.reduce((sum, commit) => sum + commit.durationMs, 0)),
  };
}

/** Durations at the precision React recorded them at: a frame budget is 16 ms. */
const ms = formatReactMs;

/** Why React rendered a component, in the words the views print. */
const CAUSE_TEXT: Record<string, string> = {
  "first-mount": "first mount",
  state: "state changed",
  hooks: "a hook changed",
  props: "props changed",
  context: "context changed",
  "nothing-changed": "nothing changed",
  unknown: "render reason not recorded",
};

/** Keep component ancestry useful without handing the model a page of navigator scaffolding. */
function compactPath(path: readonly string[]): string {
  if (path.length <= 4) return path.map(part => `\`${part}\``).join(" › ");
  return [`\`${path[0]}\``, "…", ...path.slice(-3).map(part => `\`${part}\``)].join(" › ");
}

/** A share, with the one decimal the CPU hand-off uses and for the same reason. */
const percentText = (value: number) => `${value.toFixed(1)}%`;

/** Why one component rendered, with whatever React named as having changed. */
function causeText(pick: SelectedComponent): string {
  const base = CAUSE_TEXT[pick.cause] ?? pick.cause;
  const named = [...pick.changedProps, ...pick.changedHooks].slice(0, 6);
  return named.length > 0 ? `${base}: ${named.join(", ")}` : base;
}

/**
 * The hand-off for a set of picked components, numbered in the order chosen and
 * grouped by commit — the unit every figure here is a share of.
 */
export function buildReactSelectionPrompt(input: {
  recording: ReactSelectionRecording;
  evidence: ReactSelectionEvidence;
  /** The profile this came from, when the panel knows it. */
  profileTitle?: string;
}): string {
  const { recording, evidence } = input;
  const lines: string[] = [];
  const count = evidence.components.length;
  const commitCount = evidence.commits.length;

  lines.push(
    `Use the measured evidence below to investigate ${count} component render${count === 1 ? "" : "s"} I selected in a React profile. Explain what the evidence supports about the slow interaction, what it cannot establish, and what would be worth investigating or changing first.`,
  );
  lines.push("");

  lines.push(`## The recording they sit in`);
  lines.push(
    `- Measured by React's own profiler on a running build: ${recording.commits.length} commit${recording.commits.length === 1 ? "" : "s"} across ${ms(recording.spanMs)}, ${ms(evidence.recordedCommitsMs)} of it spent rendering.`,
  );
  if (input.profileTitle) lines.push(`- Recording: ${input.profileTitle}`);
  lines.push("");

  lines.push(`## What I selected`);
  for (const commit of evidence.commits) {
    lines.push("");
    lines.push(
      `### Commit ${commit.commitIndex} — ${ms(commit.durationMs)} rendering${commit.overBudget ? `, over the ${recording.budgetMs} ms budget` : ""}, ${commit.renderedCount} component${commit.renderedCount === 1 ? "" : "s"} rendered, ${ms(commit.startMs)} into the recording`,
    );
    if (!commit.causesRecorded) {
      lines.push(
        `This commit was recorded without "Record why each component rendered", so React captured no render reasons for it. Every duration below is measured.`,
      );
    }
    for (const pick of commit.picks) {
      lines.push(`${pick.pick}. \`${pick.name}\`${pick.sourceHint ? ` — ${shortLocationLabel(pick.sourceHint)}` : ""}`);
      lines.push(
        `   - ${ms(pick.selfMs)} of its own render time (${percentText(percentOf(pick.selfMs, commit.durationMs))} of this commit), ${ms(pick.actualMs)} including everything it rendered.`,
      );
      if (commit.causesRecorded) lines.push(`   - Why it rendered: ${causeText(pick)}.`);
      if (pick.componentClass !== "app") {
        lines.push(`   - Classified as \`${pick.componentClass}\`, not application code.`);
      }
      if (pick.compiledWithForget) lines.push(`   - Compiled by the React Compiler, so its memoization is generated rather than written.`);
      lines.push(`   - Location: ${compactPath(pick.path)}.`);
    }
  }
  lines.push("");

  // The same component picked twice is a different fact here than on the CPU
  // side. Two call sites of one function are two places in the code; two renders
  // of one component are usually one component rendering repeatedly, which is
  // the finding rather than a coincidence to be explained away.
  const byComponent = new Map<string, SelectedComponent[]>();
  for (const pick of evidence.components) {
    const key = `${pick.name}\u0000${pick.sourceHint ?? ""}`;
    byComponent.set(key, [...(byComponent.get(key) ?? []), pick]);
  }
  const repeated = [...byComponent.values()].filter(picks => picks.length > 1);
  if (repeated.length > 0) {
    lines.push(`## The same component, picked more than once`);
    for (const picks of repeated) {
      const commits = new Set(picks.map(pick => pick.commitIndex));
      const together = rounded(picks.reduce((sum, pick) => sum + pick.selfMs, 0));
      lines.push(
        commits.size > 1
          ? `- \`${picks[0]!.name}\` is selection${picks.length === 1 ? "" : "s"} ${picks.map(pick => pick.pick).join(", ")}: the same component rendering in ${commits.size} separate commits, ${ms(together)} of its own time across them. These are separate renders at separate times and their own times do add.`
          : `- \`${picks[0]!.name}\` is selections ${picks.map(pick => pick.pick).join(", ")} within commit ${picks[0]!.commitIndex}: separate instances rendered in the same commit, ${ms(together)} of their own time together.`,
      );
    }
    lines.push("");
  }

  if (evidence.overlaps.length > 0) {
    lines.push(`## How these overlap`);
    for (const [outerKey, innerKey] of evidence.overlaps) {
      const outer = evidence.components.find(pick => pick.key === outerKey);
      const inner = evidence.components.find(pick => pick.key === innerKey);
      if (!outer || !inner) continue;
      lines.push(
        `- Selection ${outer.pick} (\`${outer.name}\`) rendered selection ${inner.pick} (\`${inner.name}\`) in commit ${outer.commitIndex}. Their \`including everything it rendered\` figures count the same milliseconds; treat ${inner.pick} as where the time inside ${outer.pick} went, not as extra cost. Their own times do not overlap and do add.`,
      );
    }
    lines.push("");
  }

  lines.push(`## Coverage outside the selection`);
  if (count > 1) {
    lines.push(
      `- The selections account for ${ms(evidence.selfMsTogether)} of their own render time${commitCount > 1 ? ` across ${commitCount} commits totalling ${ms(evidence.pickedCommitsMs)}` : ` — ${percentText(percentOf(evidence.selfMsTogether, evidence.pickedCommitsMs))} of the commit`}.`,
    );
  }
  for (const commit of evidence.commits) {
    // Every figure in this subtraction is one this document states, so the
    // remainder is arithmetically true here rather than true only if React's
    // own totals happen to agree to the hundredth.
    const otherComponents = rounded(commit.summedSelfMs - commit.selfMsTogether);
    const parts: string[] = [];
    if (otherComponents > 0.005) parts.push(`${ms(otherComponents)} in the other components it rendered`);
    if (commit.unattributedMs > 0.005) parts.push(`${ms(commit.unattributedMs)} in React's own walk of the tree, which reached no component`);
    if (parts.length === 0) continue;
    const scope = count > 1
      ? `after the selected ${ms(commit.selfMsTogether)} (${percentText(commit.selfShare)})`
      : `outside the selected component`;
    lines.push(`- Commit ${commit.commitIndex}: ${scope}, the remaining render time is ${parts.join(" plus ")}.`);
  }
  lines.push("");

  if (evidence.unresolved.length > 0) {
    lines.push(`## I could not place ${evidence.unresolved.length === 1 ? "one selection" : `${evidence.unresolved.length} selections`}`);
    lines.push(
      `The view reported ${evidence.unresolved.length === 1 ? "it" : "them"} as selected but this recording holds no rendered component with ${evidence.unresolved.length === 1 ? "that reference" : "those references"}, so ${evidence.unresolved.length === 1 ? "it carries" : "they carry"} no figures. Say which selections those are rather than guessing at what they were.`,
    );
    lines.push("");
  }

  lines.push(`## Interpretation constraints`);
  lines.push(`- This has only component names, source hints and timings. It has not read any source file. Confirm what each of these components actually does before changing it.`);
  lines.push(`- These are React's own measurements, not samples. Own time is \`selfDuration\`; inclusive time is \`actualDuration\`.`);
  lines.push(`- They cover the render phase only. Layout and passive effects, the commit phase, native view updates, and every millisecond between two commits are not in this document, so a slow interaction can have most of its cost outside everything measured here.`);
  lines.push(`- Own time partitions render cost and can be added. Inclusive time overlaps descendants and must not be summed.`);
  lines.push(`- Treat each selection and render reason as a lead, not proof of causation or avoidable work. Tie conclusions to specific measurements, and say when the evidence cannot distinguish between explanations.`);

  return lines.join("\n");
}
