import { isDeepStrictEqual } from 'node:util';

// Keep this key equal to the mapper's destination key in presentations.ts.
export function presentationDestination(action) {
  const effect = action.effect;
  return JSON.stringify(effect.kind === 'state'
    ? [effect.site, effect.path, effect.value]
    : [action.file, action.owner, effect]);
}

// A generic boundary belongs to its owner. `export const A = memo(function B…)`
// gives that owner two source names; either identifies the same body.
const ownedBy = (target, name) => target.owner === name || !!target.ownerAliases?.includes(name);
const controlMatches = (selector, target) => (selector.prop === undefined || selector.prop === target.prop) &&
  (selector.line !== undefined ? selector.file === target.file && selector.line === target.line
    : selector.file === target.definition?.file && selector.component === target.definition.component ||
      selector.file === target.file && ownedBy(target, selector.component) && target.generic);

/** Compare reviewed identities, never labels inferred from a whole render branch.
 * `ownerAliases(file, owner)` may return other source names of the same owner. */
export function compareViewReference(graph, reference, targetsForAction, ownerAliases = () => []) {
  const states = new Map([...(graph.presentations?.states ?? []),...(graph.presentations?.viewStates ?? [])].map(site => [site.id, site]));
  const groups = new Map();
  const viewsById=new Map((graph.presentations?.views??[]).map(view=>[view.id,view]));
  for (const action of [...(graph.presentations?.actions ?? []),...(graph.presentations?.previews??[])]) {
    const key = presentationDestination(action);
    const group = groups.get(key) ?? { key, actions: [], targets: [], executable: action.preview?'preview':'action' };
    if(!action.preview)group.executable='action';
    group.actions.push(action);
    group.views=[...new Map([...(group.views??[]),...(action.views??[]).flatMap(id=>viewsById.has(id)?[viewsById.get(id)]:[])].map(view=>[view.id,view])).values()];
    if (action.effect.kind === 'control') group.targets.push(...targetsForAction(action));
    groups.set(key, group);
  }
  for (const view of graph.presentations?.views ?? []) {
    if (view.state) {
      const effect = {kind:'state', ...view.state}, key = presentationDestination({effect});
      const group = groups.get(key) ?? {key, actions:[{effect}], targets:[]};
      group.views = [...(group.views ?? []), view]; groups.set(key, group);
    } else if (view.control) {
      const aliases = ownerAliases(view.file, view.owner).filter(name => name !== view.owner);
      const key = `source:${view.id}`, target = {file:view.file,line:view.line,prop:view.control.prop,owner:view.owner,...(aliases.length?{ownerAliases:aliases}:{}),generic:view.control.boundary&&view.control.generic,
        definition:view.components.find(c=>c.component===view.control.component) ?? view.components[0]};
      groups.set(key,{key,actions:[{effect:{kind:'control'}}],targets:[target],views:[view]});
    } else groups.set(`source:${view.id}`,{key:`source:${view.id}`,actions:[{effect:{kind:view.kind}}],targets:[],views:[view]});
  }
  for (const group of groups.values()) group.targets = [...new Map(group.targets.map(target => [JSON.stringify(target), target])).values()];
  const matches = (selector, group) => {
    const action = group.actions[0], effect = action.effect;
    if (selector.component) return group.views?.some(view=>view.kind==='component'&&view.file===selector.component.file&&view.owner===selector.component.name&&
      view.entries?.some(entry=>entry.file===selector.component.entry.file&&entry.line===selector.component.entry.line))?'exact':undefined;
    if (selector.branch) return group.views?.some(view=>view.kind==='branch'&&view.file===selector.branch.file&&view.branch?.side===selector.branch.side&&
      view.branch.condition.replace(/\s/g,'')===selector.branch.condition.replace(/\s/g,'')&&view.source.line<=selector.branch.line&&view.source.endLine>=selector.branch.line)?'exact':undefined;
    if (selector.state && effect.kind === 'state') {
      const site = states.get(effect.site), expected = selector.state;
      return site?.file === expected.file && site.line === expected.line &&
        isDeepStrictEqual(effect.path, expected.path) && isDeepStrictEqual(effect.value, expected.value) ? 'exact' : undefined;
    }
    if (selector.control && effect.kind === 'control') {
      if (!group.targets.some(target => controlMatches(selector.control, target))) return;
      return group.targets.every(target => controlMatches(selector.control, target)) ? 'exact' : 'ambiguous';
    }
  };
  const names = new Map(graph.nodes.map(node => [node.id, node.name]));
  const routeMatches = row => row.selectors.some(selector => selector.route && (
    row.access === 'entry' && graph.nodes.some(node => node.name === selector.route && node.entry) ||
    graph.edges.some(edge => edge.kind === 'navigation' && names.get(edge.to) === selector.route && row.parents?.includes(names.get(edge.from))) ||
    graph.links?.some(link => link.target === selector.route && row.sharedOwners?.includes(link.owner))
  ));
  const rows = reference.views.map(row => {
    const candidates = [...groups.values()].flatMap(group => {
      const results = row.selectors.map(selector => matches(selector, group)).filter(Boolean);
      const controls = row.selectors.filter(selector => selector.control);
      const covered = group.targets.length && group.targets.every(target => controls.some(selector => controlMatches(selector.control, target)));
      return results.length ? [{ key: group.key, evidence: group.executable??'source', result: covered || results.includes('exact') ? 'exact' : 'ambiguous' }] : [];
    });
    return { ...row, coverage:routeMatches(row)?'route':candidates.some(c=>c.result==='exact'&&c.evidence==='action')?'action':candidates.some(c=>c.result==='exact'&&c.evidence==='preview')?'preview':'source', status: routeMatches(row) || candidates.some(candidate => candidate.result === 'exact') ? 'matched'
      : candidates.length ? 'ambiguous' : 'missing', candidates };
  });
  // Several distinct views cannot all be credited to one collapsed destination.
  const claims = new Map();
  for (const row of rows) for (const candidate of row.candidates) {
    const ids = claims.get(candidate.key) ?? new Set(); ids.add(row.id); claims.set(candidate.key, ids);
  }
  const collisions = [...claims].filter(([, ids]) => ids.size > 1).map(([key, ids]) => ({ key, views: [...ids] }));
  for (const row of rows) if (row.status === 'matched' && row.category !== 'route' &&
    !row.candidates.some(candidate => candidate.result === 'exact' && claims.get(candidate.key).size === 1)) row.status = 'ambiguous';
  for (const row of rows) {
    if (row.status !== 'missing') continue;
    const containers = (row.containers ?? []).flatMap(selector => [...groups.values()].filter(group => matches(selector, group)).map(group => group.key));
    if (containers.length || rows.some(parent => parent.id === row.parent && ['matched', 'ambiguous'].includes(parent.status))) {
      row.status = 'container-only';
      row.containerCandidates = containers;
    }
  }
  const byCategory = Object.fromEntries([...new Set(rows.map(row => row.category))].map(category => {
    const items = rows.filter(row => row.category === category);
    return [category, { manual: items.length, ...Object.fromEntries(['matched', 'container-only', 'ambiguous', 'missing'].map(status => [status, items.filter(row => row.status === status).length])) }];
  }));
  return {
    manualViews: rows.length, matchedViews: rows.filter(row => row.status === 'matched').length, byCategory,
    rawPresentationActions: graph.presentations?.actions.length ?? 0, presentationDestinations: [...groups.values()].filter(group=>group.executable).length,
    rawPreviewPlans:graph.presentations?.previews?.length??0,
    sourceCandidates:graph.presentations?.views?.length??0,
    actionableViews:rows.filter(row=>row.status==='matched'&&['route','action'].includes(row.coverage)).length,
    previewPlannedViews:rows.filter(row=>row.status==='matched'&&row.coverage==='preview').length,
    plannedViews:rows.filter(row=>row.status==='matched'&&row.coverage!=='source').length,
    sourceOnlyViews:rows.filter(row=>row.status==='matched'&&row.coverage==='source').length,
    collisions,
    unclassifiedSourceCandidates:[...groups.values()].filter(group=>!group.executable&&!claims.has(group.key)).length,
    unclassifiedDestinations: [...groups.values()].filter(group => group.executable&&!claims.has(group.key)).map(group => ({
      key: group.key, targets: group.targets, actions: group.actions.map(({ file, line, owner, name, effect }) => ({ file, line, owner, name, effect })),
    })),
    rows,
  };
}
