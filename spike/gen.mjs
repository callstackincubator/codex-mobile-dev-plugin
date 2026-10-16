// Synthetic payload generators for the Phase-0 bridge spike.
//
// Shapes mimic what `mobile_tracesift_explore_payload` will return:
//  - TaskCard-like: nested `tree` (TaskTreeNode with children[]) + `timeline`
//    (flat box list), i.e. one deep tree + one wide flat array.
//  - ReactExplore-like: up to 60k nodes / 5k commits (perf-ai caps), flattened
//    here as nodeId/parentId records — the worst-case *wide* payload.
//
// Usage from other spike scripts: `import { makeTaskCard, makeFlatExplore, sizeOf } from './gen.mjs'`
// CLI: `node spike/gen.mjs --mb 5 --depth 50 --out spike/out/taskcard-5mb-d50.json`

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const NAMES = [
  'runRoot', 'scheduleUpdate', 'performUnitOfWork', 'workLoopSync', 'renderWithHooks',
  'commitPassiveMountEffects', 'beginWork', 'completeUnitOfWork', 'reconcileChildFibers',
  'mountLayoutEffect', 'FlameGraph.render', 'Legend.draw', 'useMemo', 'commitHookEffectList',
  'ScrollView.onScroll', 'measureInWindow', 'SymbolTree.visit', 'Timeline.paint',
];

function hash(i) {
  // deterministic pseudo-random from an integer
  let x = (i * 2654435761) >>> 0;
  x ^= x >>> 13; x = (x * 1274126177) >>> 0; x ^= x >>> 16;
  return x;
}

/**
 * Build a TaskCard-like object whose `tree` is a nested call tree of maximum
 * nesting depth `depth` plus a flat `timeline` box list. When `mb` > 0 the
 * counts are chosen (and the timeline trimmed) so the JSON text lands at
 * ~`mb` megabytes — no synthetic filler fields, realistic TaskCard shape only.
 */
export function makeTaskCard({ nodes, depth = 50, mb = 5, timeline } = {}) {
  // Size budget: 40% of the target for the nested tree, 60% for the flat
  // timeline (typical TaskCard split). Measured costs: ~148 B/node, ~88 B/box.
  const target = Math.round(mb * 1024 * 1024);
  if (nodes === undefined && target > 0) nodes = Math.max(depth + 1, Math.round((target * 0.4) / 148));
  if (timeline === undefined && target > 0) timeline = Math.max(1, Math.round((target * 0.6) / 88));
  nodes ??= 20_000;
  timeline ??= 20_000;

  // Build one trunk of `depth` nodes, then fill the remaining node budget as
  // a wide set of children distributed along the trunk (realistic flame-graph
  // shape: a deep spine with shallow wide branches).
  const id = { n: 0 };
  const mkNode = (extra) => {
    const i = ++id.n;
    const r = hash(i);
    return {
      id: `n${i}`,
      name: NAMES[r % NAMES.length] + (i % 7 === 0 ? `#${i % 97}` : ''),
      selfMs: +(r % 4000 / 100).toFixed(2),
      totalMs: +((r % 90000) / 100).toFixed(2),
      hits: 1 + (r % 250),
      file: `src/${(r % 37) === 0 ? 'components' : 'lib'}/Module${r % 211}.tsx`,
      line: 1 + (r % 900),
      column: 1 + (r % 80),
      category: ['react', 'app', 'system', 'layout', 'effect'][r % 5],
      ...extra,
    };
  };

  const root = mkNode({ children: [] });
  const trunk = [root];
  for (let d = 1; d < depth; d++) {
    const node = mkNode({ children: [] });
    trunk[trunk.length - 1].children.push(node);
    trunk.push(node);
  }
  const leaves = trunk[depth - 1].children;
  let remaining = Math.max(0, nodes - depth);
  let level = 0;
  while (remaining > 0) {
    const parent = trunk[Math.min(trunk.length - 1, 2 + (level % Math.max(1, depth - 3)))];
    const target = parent === trunk[depth - 1] ? leaves : parent.children;
    const take = Math.min(400, remaining);
    for (let k = 0; k < take; k++) target.push(mkNode({ children: undefined }));
    remaining -= take;
    level++;
  }

  // Flat timeline: the wide part of a TaskCard. ~120 bytes/box.
  const boxes = [];
  for (let i = 0; i < timeline; i++) {
    const r = hash(i + 0x9e3779b9);
    boxes.push({
      startMs: +((r % 2_500_000) / 1000).toFixed(3),
      durMs: +((r % 30_000) / 1000).toFixed(3),
      lane: r % 12,
      label: NAMES[r % NAMES.length],
      nodeId: `n${1 + (r % Math.max(1, id.n))}`,
      depth: r % depth,
    });
  }

  const card = {
    apiVersion: 1,
    analysisId: 'spike-analysis',
    taskIndex: 0,
    title: 'Spike task card',
    summary: { totalMs: 1234.5, samples: timeline, hotspots: NAMES.slice(0, 8).map(name => ({ name, ms: 12.5 })) },
    tree: root,
    timeline: { boxes },
  };

  // Trim (or extend) the flat timeline so the JSON text hits the target size.
  if (target > 0) {
    for (let pass = 0; pass < 6; pass++) {
      const size = sizeOf(card);
      const within = Math.abs(size - target) <= target * 0.01;
      if (within || boxes.length < 2) break;
      const tlSize = sizeOf(card.timeline);
      const per = Math.max(1, tlSize / boxes.length);
      const delta = target - size;
      const step = Math.ceil(Math.abs(delta) / per);
      if (delta > 0) {
        for (let k = 0; k < step; k++) {
          const r = hash(0x1234 + boxes.length + k);
          boxes.push({
            startMs: +((r % 2_500_000) / 1000).toFixed(3),
            durMs: +((r % 30_000) / 1000).toFixed(3),
            lane: r % 12,
            label: NAMES[r % NAMES.length],
            nodeId: `n${1 + (r % Math.max(1, id.n))}`,
            depth: r % depth,
          });
        }
      } else {
        boxes.length = Math.max(1, boxes.length - step);
      }
    }
  }
  return card;
}

/**
 * ReactExplore-like worst case: `nodes` flat records (nodeId/parentId), the
 * shape perf-ai caps at 60k nodes / 5k commits.
 */
export function makeFlatExplore({ nodes = 60_000, commits = 5_000 } = {}) {
  const commitList = [];
  for (let c = 0; c < commits; c++) {
    const r = hash(c + 7);
    commitList.push({
      index: c,
      label: `commit ${c}`,
      renderedMs: +((r % 40_000) / 1000).toFixed(3),
      scriptMs: +((r % 10_000) / 1000).toFixed(3),
      commitDepth: r % 10,
      nodeCount: 1 + (r % Math.max(1, Math.floor(nodes / Math.max(1, commits)))),
    });
  }
  const list = new Array(nodes);
  for (let i = 0; i < nodes; i++) {
    const r = hash(i + 1);
    list[i] = {
      nodeId: i,
      parentId: i === 0 ? null : (i - 1 - (r % Math.min(64, i))),
      depth: r % 200,
      commit: r % commits,
      name: NAMES[r % NAMES.length],
      selfMs: +((r % 2500) / 1000).toFixed(3),
      totalMs: +((r % 60_000) / 1000).toFixed(3),
      file: `packages/app/src/${r % 3 ? 'screens' : 'components'}/View${r % 301}.tsx`,
      line: 1 + (r % 700),
      column: 1 + (r % 70),
      flags: (r & 1) === 0,
    };
  }
  return { apiVersion: 1, analysisId: 'spike-react', caps: { nodes: 60_000, commits: 5_000 }, commits: commitList, nodes: list };
}

/** Nested (non-flattened) ReactExplore-like tree of the given depth, for depth stress. */
export function makeNestedExplore({ nodes = 60_000, depth = 500 } = {}) {
  const card = makeTaskCard({ nodes, depth, mb: 0, timeline: 0 });
  return { apiVersion: 1, tree: card.tree, commits: [] };
}

export function sizeOf(value) {
  return Buffer.byteLength(JSON.stringify(value));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1]?.startsWith('--') === false ? all[i + 1] : true]);
    return acc;
  }, []));
  const kind = args.kind ?? 'taskcard';
  const payload = kind === 'flat'
    ? makeFlatExplore({ nodes: Number(args.nodes ?? 60_000), commits: Number(args.commits ?? 5_000) })
    : kind === 'nested'
      ? makeNestedExplore({ nodes: Number(args.nodes ?? 60_000), depth: Number(args.depth ?? 500) })
      : makeTaskCard({ nodes: Number(args.nodes ?? 20_000), depth: Number(args.depth ?? 50), mb: Number(args.mb ?? 5), timeline: Number(args.timeline ?? 20_000) });
  const json = JSON.stringify(payload);
  const depth = kind === 'flat' ? 1 : maxDepth(payload);
  console.log(`${kind}: ${(Buffer.byteLength(json) / 1048576).toFixed(2)} MiB, max JSON depth ${depth}`);
  if (typeof args.out === 'string') {
    await mkdir(dirname(resolve(args.out)), { recursive: true });
    await writeFile(resolve(args.out), json);
    console.log(`wrote ${args.out}`);
  }
}

export function maxDepth(value, limit = 100_000) {
  // iterative to survive deep structures
  let max = 0;
  const stack = [[value, 0]];
  while (stack.length) {
    const [v, d] = stack.pop();
    if (d > max) max = d;
    if (d > limit) continue;
    if (Array.isArray(v)) for (const c of v) stack.push([c, d + 1]);
    else if (v && typeof v === 'object') for (const k in v) stack.push([v[k], d + 1]);
  }
  return max;
}
