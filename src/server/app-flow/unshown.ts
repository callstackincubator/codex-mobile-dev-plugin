import type {FlowNode, FlowPresentationAction, FlowRenderCondition, FlowRun, FlowUiCondition} from '../../shared/app-flow.ts';
import {presentationNodeId, presentationSite, viewOpener} from './screen-catalog.ts';

const at = (condition: FlowRenderCondition) => `${condition.file.split('/').at(-1)}:${condition.line}`;
const phrase = (condition: FlowRenderCondition) => condition.kind === 'each' ? `\`${condition.text}\` has items (${at(condition)})`
  : condition.kind === 'unless' ? `not \`${condition.text}\` (${at(condition)})` : `\`${condition.text}\` (${at(condition)})`;
const joined = (items: string[]) => items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
// A handler condition, such as `if (role === 'verifier') control.open()`.
const written = (condition: FlowUiCondition, depth = 0): string => {
  if (depth > 6) return '…';
  if ('prop' in condition) return condition.prop.join('.');
  if ('value' in condition) return JSON.stringify(condition.value) ?? 'undefined';
  const [first, second] = condition.args.map(arg => written(arg, depth + 1));
  return condition.op === '!' ? `!${'op' in condition.args[0] && condition.args[0].op !== '!' ? `(${first})` : first}` : `${first} ${condition.op} ${second}`;
};

/** Why a view's opener is absent, from source facts only: no model, no app data. */
export function unshownReason(action: FlowPresentationAction, host?: string) {
  const where = host ? `Not found on ${host} in this app state.` : 'Its opener was not found in this app state.';
  const when = action.when?.length ? ` It renders when ${joined(action.when.map(phrase))}.` : '';
  const guard = action.guard ? ` Its handler opens it when \`${written(action.guard).slice(0, 100)}\`.` : '';
  return `${where}${when}${guard} Opener: ${action.owner} at ${action.file}:${action.line}.`;
}

// A component passed a controller by more callers than this is a shared shell,
// such as a generic prompt; each caller is its own view.
const shellCallers = 3;

/** After discovery, source-proven openers this run never found on a screen it
 * explored become needs-data nodes under that screen, with the conditions that
 * can hide them. Nothing is opened. Retrying such a node later tries for real. */
export function markUnshown(run: FlowRun, explored: (nodeId: string) => boolean) {
  const actions = [...run.presentations?.actions ?? [], ...run.presentations?.previews ?? []];
  const byId = new Map(actions.map(action => [action.id, action]));
  const nodes = new Map(run.nodes.map(node => [node.id, node]));
  // Distinct elements passing each component a controller; a live opener and
  // a preview of the same element count once.
  const callers = new Map<string, Set<string>>();
  for (const action of actions) if (action.effect.kind === 'control') callers.set(action.effect.component, (callers.get(action.effect.component) ?? new Set()).add(presentationSite(action)));
  const body = (component: string) => (callers.get(component)?.size ?? 0) <= shellCallers;
  // A dialog body passes a controller to a shared primitive, such as a
  // generic sheet. Two different bodies given one controller in alternative
  // branches are two views; a pass-through component and its dialog are one.
  const bodies = new Set(actions.filter(action => action.effect.kind === 'control' && viewOpener(action) && !body(action.effect.component)).map(action => action.owner));
  const distinct = (first: string, second: string) => first !== second && bodies.has(first) && bodies.has(second);
  // What the map already holds: opened sites, compiled caller sites of
  // captured shells, and bodies opened by a specific caller.
  const sites = new Set<string>(), compiled = new Set<string>(), opened = new Set<string>(), inside = new Set<string>();
  const controllers = new Map<string, Set<string>>();
  const share = (key: string | undefined, component: string) => { if (key) controllers.set(key, (controllers.get(key) ?? new Set()).add(component)); };
  const shared = (key: string | undefined, component: string) => [...controllers.get(key ?? '') ?? []].some(other => !distinct(component, other));
  const controllerKey = (action: FlowPresentationAction) => action.controller ? `${action.file}#${action.owner}#${action.controller}` : undefined;
  for (const node of run.nodes) {
    for (const site of node.capturedSites ?? []) compiled.add(site);
    const last = node.presentation?.actions.at(-1), action = last ? byId.get(last) : undefined;
    if (!action) continue;
    sites.add(presentationSite(action));
    share(controllerKey(action), action.effect.kind === 'control' ? action.effect.component : action.owner);
    // Any caller's capture shows a dialog's own body, shared or not; an
    // opener inside a dialog's component stands for that dialog's view.
    if (action.effect.kind === 'control') opened.add(action.effect.component);
    inside.add(action.owner);
  }
  const hostOf = (action: FlowPresentationAction) => action.parents?.map(id => nodes.get(id))
    .find(node => node?.kind === 'screen' && !node.presentation && node.status === 'captured' && explored(node.id));
  type Candidate = {action: FlowPresentationAction; host: FlowNode; group: number};
  const candidates = new Map<string, Candidate>(), pending: {action: FlowPresentationAction; host: FlowNode}[] = [];
  for (const action of actions) {
    if (action.effect.kind !== 'control' || !viewOpener(action)) continue;
    const host = hostOf(action), target = action.effect.target, key = controllerKey(action), component = action.effect.component;
    if (!host) continue;
    // Covered: an opened site, a compiled caller site of a captured shell,
    // the body of a dialog the map already opened through its caller, or
    // another caller of a specific dialog already on the map.
    const covered = sites.has(presentationSite(action)) || nodes.has(presentationNodeId(action)) ||
      !!target && compiled.has(`${target.file}:${target.source.line}:${target.source.column}:${action.effect.prop}`) ||
      action.preview && opened.has(action.owner) || body(component) && (opened.has(component) || inside.has(component));
    // Elements passing the same controller value share whichever view covers one.
    if (covered) { share(key, component); continue; }
    pending.push({action, host});
  }
  for (const {action, host} of pending) {
    if (shared(controllerKey(action), (action.effect as {component: string}).component)) continue;
    const key = presentationSite(action), previous = candidates.get(key);
    if (!previous || previous.action.preview && !action.preview) candidates.set(key, {action, host, group: candidates.size});
  }
  // One view, several openers: elements of one owner passing the same
  // controller value, and a dialog's own body with the caller passing it.
  const list = [...candidates.values()];
  list.forEach((candidate, index) => { candidate.group = index; });
  const find = (index: number): number => list[index].group === index ? index : (list[index].group = find(list[index].group));
  const join = (a: number, b: number) => { const left = find(a), right = find(b); if (left !== right) list[Math.max(left, right)].group = Math.min(left, right); };
  for (let a = 0; a < list.length; a++) for (let b = a + 1; b < list.length; b++) {
    const first = list[a].action, second = list[b].action;
    const effect = (action: FlowPresentationAction) => action.effect as Extract<FlowPresentationAction['effect'], {kind: 'control'}>;
    const sameController = first.controller && first.file === second.file && first.owner === second.owner && first.controller === second.controller &&
      !distinct(effect(first).component, effect(second).component);
    const bodyOf = (outer: FlowPresentationAction, inner: FlowPresentationAction) => body(effect(outer).component) && effect(outer).component === inner.owner;
    if (sameController || bodyOf(first, second) || bodyOf(second, first)) join(a, b);
  }
  // A live opener represents its group; otherwise the element whose component
  // renders the group's body, so a pass-through prop never names the view.
  const groups = new Map<number, Candidate[]>();
  list.forEach((candidate, index) => { const root = find(index); groups.set(root, [...groups.get(root) ?? [], candidate]); });
  const added: FlowNode[] = [];
  for (const members of groups.values()) {
    const score = ({action}: Candidate) => (action.preview ? 0 : 2) + (members.some(other => other.action.owner === (action.effect as {component: string}).component) ? 1 : 0);
    const {action, host} = members.reduce((best, item) => score(item) > score(best) ? item : best);
    const id = presentationNodeId(action);
    if (nodes.has(id)) continue;
    const node: FlowNode = {id, name: action.name, kind: 'screen', path: [], required: [], status: 'needs-data', reason: unshownReason(action, host.name), file: action.file, line: action.line,
      sourceViews: [...new Set(members.flatMap(member => member.action.views ?? []))],
      presentation: {actions: [action.id], ...(action.preview ? {preview: true} : {}), basePath: host.path, ...(host.params && Object.keys(host.params).length ? {baseParams: host.params} : {}), expo: host.component === 'expo-router'}};
    run.nodes.push(node); nodes.set(id, node); added.push(node);
    if (!run.edges.some(edge => edge.from === host.id && edge.to === id)) run.edges.push({from: host.id, to: id, kind: 'navigation'});
  }
  if (added.length) run.revision++;
  return added;
}
