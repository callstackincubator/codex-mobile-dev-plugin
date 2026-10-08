import {createHash} from 'node:crypto';
import {missingFlowParams, type FlowEdge, type FlowGraph, type FlowNode, type FlowParams, type FlowPresentationAction, type FlowRun, type FlowStatus} from '../../shared/app-flow.ts';

/** What a screen needs before the fast path can open it. */
export type FlowCatalogCategory = 'no-inputs' | 'real-inputs' | 'app-state';
export type FlowCatalogResult = {runId: string; status: FlowStatus; reason?: string; image?: string; captureMs?: number; sites?: string[]; at: number};
export type FlowCatalogEntry = {
  id: string;
  name: string;
  category: FlowCatalogCategory;
  /** The best known way to open the screen: path, real params and opening chain. */
  node: FlowNode;
  /** The latest attempt, successful or not. */
  last?: FlowCatalogResult;
  /** The latest accepted capture; a later failure does not erase it. */
  captured?: FlowCatalogResult;
  /** A reviewer's verdict on the latest attempt's image. Local only. */
  review?: {runId: string; accepted: boolean; reason?: string; at: number};
  /** Planned from source before any run reached the screen. */
  seeded?: boolean;
};
export type FlowCatalogReview = {nodeId: string; accepted: boolean; reason?: string};
/** Persistent per-project screen list. It holds local app data, never telemetry. */
export type FlowCatalog = {version: 1; sourceHash?: string; updatedAt: number; entries: FlowCatalogEntry[]; edges: FlowEdge[]};
export type FlowCatalogSelection = 'all' | 'missing';

const actionMap = (graph: Pick<FlowGraph, 'presentations'>) =>
  new Map<string, FlowPresentationAction>([...(graph.presentations?.actions ?? []), ...(graph.presentations?.previews ?? [])].map(action => [action.id, action]));

/** UI previews render guarded state; routes and openers that take real
 * records need inputs; everything else opens directly. */
export function catalogCategory(node: FlowNode, actions: Map<string, FlowPresentationAction>): FlowCatalogCategory {
  if (node.presentation?.preview) return 'app-state';
  const chain = (node.presentation?.actions ?? []).map(id => actions.get(id));
  const needsParams = node.presentation ? Object.keys(node.presentation.baseParams ?? {}).length > 0
    : node.required.length > 0 || !!node.paramVariants?.some(variant => variant.required.length);
  return needsParams || chain.some(action => action?.input) ? 'real-inputs' : 'no-inputs';
}

// Run-specific capture fields stay in the run; the catalog keeps the recipe.
function executable(node: FlowNode): FlowNode {
  const {image, imageSourceHash, reason, failure, captureMs, captureDiagnostics, captureAttempts, capturedSites, groupId, capture, ...recipe} = structuredClone(node);
  return {...recipe, status: 'pending'};
}

const attempted = (node: FlowNode) => node.status !== 'pending' && node.status !== 'capturing' && !(node.status === 'timed-out' && node.reason === 'Run stopped.');

/** Merge one finished run into the catalog. A capture replaces the recipe; a
 * failure keeps the last working recipe and only records the attempt. */
export function mergeCatalog(previous: FlowCatalog | undefined, run: FlowRun, at = Date.now()): FlowCatalog {
  const actions = actionMap(run);
  const entries = new Map((previous?.entries ?? []).map(entry => [entry.id, structuredClone(entry)]));
  for (const node of run.nodes) {
    if (node.kind !== 'screen' || node.capture === 'observed' || node.presentation?.entryKey) continue;
    const existing = entries.get(node.id);
    const result: FlowCatalogResult = {runId: run.id, status: node.status, at,
      ...(node.reason ? {reason: node.reason} : {}), ...(node.image ? {image: node.image} : {}), ...(node.captureMs !== undefined ? {captureMs: node.captureMs} : {}), ...(node.image && node.capturedSites ? {sites: node.capturedSites} : {})};
    const better = !existing || node.status === 'captured' ||
      !existing.captured && missingFlowParams(node).length <= missingFlowParams(existing.node).length;
    const entry: FlowCatalogEntry = existing ?? {id: node.id, name: node.name, category: 'no-inputs', node: executable(node)};
    if (better) { entry.node = executable(node); entry.name = node.name; }
    entry.category = catalogCategory(entry.node, actions);
    if (attempted(node)) { entry.last = result; if (entry.review?.runId !== run.id) delete entry.review; }
    if (node.status === 'captured' && node.image) entry.captured = result;
    entries.set(node.id, entry);
  }
  // An older entry for a shared shell opened its caller without naming it.
  // The same recipe now carries the caller site under its own ID.
  const recipe = (plan: NonNullable<FlowNode['presentation']>) => JSON.stringify([plan.basePath, plan.baseParams ?? {}, !!plan.expo, plan.actions]);
  const named = new Map(run.nodes.flatMap(node => node.presentation?.instances ? [[recipe(node.presentation), node.id] as const] : []));
  for (const [id, entry] of entries) {
    const plan = entry.node.presentation, replacement = plan && !plan.instances ? named.get(recipe(plan)) : undefined;
    if (replacement && replacement !== id) entries.delete(id);
  }
  const edges = new Map((previous?.edges ?? []).map(edge => [JSON.stringify([edge.from, edge.to, edge.kind]), edge]));
  for (const edge of run.edges) if (entries.has(edge.from) && entries.has(edge.to)) edges.set(JSON.stringify([edge.from, edge.to, edge.kind]), structuredClone(edge));
  for (const [key, edge] of edges) if (!entries.has(edge.from) || !entries.has(edge.to)) edges.delete(key);
  return {version: 1, sourceHash: run.sourceHash ?? previous?.sourceHash, updatedAt: at, entries: [...entries.values()], edges: [...edges.values()]};
}

/** Nodes to queue from the catalog. Entries whose opening chain or base route
 * no longer exists in the current scan are stale and stay out. */
export function catalogNodes(catalog: FlowCatalog | undefined, graph: Pick<FlowGraph, 'nodes' | 'presentations'>, select: FlowCatalogSelection = 'all') {
  const actions = actionMap(graph);
  const routes = new Set(graph.nodes.flatMap(node => [node.name, node.path.at(-1)]).filter((name): name is string => !!name));
  const nodes: FlowNode[] = [], stale: string[] = [];
  for (const entry of catalog?.entries ?? []) {
    if (select === 'missing' && entry.last?.status === 'captured' && entry.review?.accepted !== false) continue;
    const node = entry.node, base = node.presentation ? node.presentation.basePath.at(-1) : node.path.at(-1) ?? node.name;
    const current = (!base || routes.has(base)) && (node.presentation?.actions ?? []).every(id => actions.has(id));
    if (!current) { stale.push(entry.id); continue; }
    nodes.push(structuredClone(node));
  }
  return {nodes, stale};
}

/** Record review verdicts for one run's images. A rejected image stops being
 * the entry's accepted capture, so a missing run attempts that screen again. */
export function reviewCatalog(catalog: FlowCatalog, runId: string, reviews: FlowCatalogReview[], at = Date.now()) {
  const entries = new Map(catalog.entries.map(entry => [entry.id, entry]));
  let applied = 0;
  for (const review of reviews) {
    const entry = entries.get(review.nodeId);
    if (!entry || entry.last?.runId !== runId || entry.last.status !== 'captured') continue;
    entry.review = {runId, accepted: review.accepted, at, ...(review.reason ? {reason: review.reason.slice(0, 200)} : {})};
    if (!review.accepted && entry.captured?.runId === runId) delete entry.captured;
    applied++;
  }
  return {catalog: {...catalog, updatedAt: at}, applied};
}

// Same identity as runtime discovery, so a seeded screen and a discovered one
// share one entry.
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24);
const destination = (action: FlowPresentationAction) => action.effect.kind === 'state' ? [action.effect.site, action.effect.path, action.effect.value] : [action.file, action.owner, action.effect];
// A live opener and a preview of the same controlled element open one view.
const site = (action: FlowPresentationAction) => action.effect.kind === 'control' && action.effect.target
  ? `control:${action.effect.target.file}:${action.effect.target.line}:${action.effect.prop}` : JSON.stringify(destination(action));
// Refs on primitives and React Native refresh controls are not views.
const viewOpener = (action: FlowPresentationAction) => action.effect.kind !== 'control' || !['ref', 'refreshControl'].includes(action.effect.prop);

/** Add screens no run has reached yet. Routes need a source link from app UI;
 * an opener gets a one-step recipe: open a screen that renders its owner, or
 * the entry screen for openers outside any route, then bind the opener. Live
 * binding still decides whether each recipe works. */
export function seedCatalog(catalog: FlowCatalog | undefined, graph: Pick<FlowGraph, 'nodes' | 'edges' | 'links' | 'presentations' | 'sourceHash'>, at = Date.now()): FlowCatalog {
  const result: FlowCatalog = catalog ? structuredClone(catalog) : {version: 1, sourceHash: graph.sourceHash, updatedAt: at, entries: [], edges: []};
  const actions = actionMap(graph), ids = new Set(result.entries.map(entry => entry.id));
  const routes = result.entries.filter(entry => !entry.node.presentation);
  const linked = new Set([...graph.edges.filter(edge => edge.kind === 'navigation').map(edge => edge.to), ...graph.nodes.filter(node => node.entry).map(node => node.id)]);
  const linkTargets = new Set((graph.links ?? []).map(link => link.target));
  const seen = new Set<string>();
  for (const node of graph.nodes) {
    if (node.kind !== 'screen' || !node.path.length) continue;
    const key = JSON.stringify([node.definition ?? node.component ?? node.id, node.name, node.required, node.params]);
    if (seen.has(key)) continue; seen.add(key);
    if (!linked.has(node.id) && !linkTargets.has(node.name) || ids.has(node.id) || routes.some(entry => entry.name === node.name)) continue;
    const recipe = executable(node);
    result.entries.push({id: node.id, name: node.name, category: catalogCategory(recipe, actions), node: recipe, seeded: true});
    ids.add(node.id);
  }
  // Real params for a parent route come from catalog entries that captured it.
  const known = (route: FlowNode): FlowParams | undefined => {
    if (!missingFlowParams(route).length) return route.params ?? {};
    const entry = result.entries.find(item => !item.node.presentation && item.name === route.name && !missingFlowParams(item.node).length);
    return entry ? entry.node.params ?? {} : undefined;
  };
  const byId = new Map(graph.nodes.map(node => [node.id, node]));
  const entryRoute = graph.nodes.find(node => node.kind === 'screen' && node.entry && node.path.length && !missingFlowParams(node).length);
  const parent = (action: FlowPresentationAction) => {
    for (const id of action.parents ?? []) {
      const route = byId.get(id), params = route && known(route);
      if (route && params) return {path: route.path, params, expo: route.component === 'expo-router'};
    }
    if (!action.parents?.length && entryRoute) return {path: entryRoute.path, params: entryRoute.params ?? {}, expo: entryRoute.component === 'expo-router'};
  };
  const covered = new Set(result.entries.flatMap(entry => {
    const last = entry.node.presentation?.actions.at(-1), action = last ? actions.get(last) : undefined;
    return action ? [site(action)] : [];
  }));
  // A step of a form that only mounts for some accounts, such as onboarding,
  // opens after a preview mounts its exported owner. An entry that never
  // captured gains that first step as well.
  const mounts = [...actions.values()].filter(action => action.preview && action.effect.kind === 'mount');
  const mountFor = (action: FlowPresentationAction) => action.preview && action.effect.kind === 'state'
    ? mounts.find(mount => mount.file === action.file && mount.owner === action.owner) : undefined;
  for (const entry of result.entries) {
    const plan = entry.node.presentation, last = plan?.actions.at(-1), action = last ? actions.get(last) : undefined, mount = action && mountFor(action);
    if (!plan || entry.captured || !mount || plan.actions.includes(mount.id)) continue;
    entry.node = {...entry.node, presentation: {...plan, actions: [mount.id, ...plan.actions]}};
  }
  const seeds = new Map<string, FlowPresentationAction>();
  for (const action of actions.values()) {
    if (!viewOpener(action)) continue;
    const previous = seeds.get(site(action));
    if (!previous || previous.preview && !action.preview) seeds.set(site(action), action);
  }
  for (const [key, action] of seeds) {
    const id = `presentation-${hash(destination(action))}`, base = parent(action), mount = mountFor(action);
    if (covered.has(key) || ids.has(id) || !base) continue;
    const node: FlowNode = {id, name: action.name, kind: 'screen', path: [], required: [], status: 'pending', file: action.file, line: action.line, sourceViews: action.views ?? [],
      presentation: {actions: [...(mount ? [mount.id] : []), action.id], ...(action.preview ? {preview: true} : {}), basePath: base.path, ...(Object.keys(base.params).length ? {baseParams: base.params} : {}), expo: base.expo}};
    result.entries.push({id, name: action.name, category: catalogCategory(node, actions), node, seeded: true});
    ids.add(id);
  }
  return result;
}

/** Counts for reports; no app data. */
export function catalogSummary(catalog: FlowCatalog | undefined) {
  const entries = catalog?.entries ?? [];
  const count = (pick: (entry: FlowCatalogEntry) => string | undefined) => {
    const counts: Record<string, number> = {};
    for (const entry of entries) { const key = pick(entry) ?? 'never-attempted'; counts[key] = (counts[key] ?? 0) + 1; }
    return counts;
  };
  return {entries: entries.length, seeded: entries.filter(entry => entry.seeded && !entry.last).length, captured: entries.filter(entry => entry.captured).length, reviewed: entries.filter(entry => entry.review).length,
    rejected: entries.filter(entry => entry.review?.accepted === false).length, byCategory: count(entry => entry.category), byLastStatus: count(entry => entry.last?.status)};
}
