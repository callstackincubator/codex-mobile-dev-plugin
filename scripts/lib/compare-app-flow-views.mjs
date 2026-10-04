import { isDeepStrictEqual } from 'node:util';

// Keep this key equal to the mapper's destination key in presentations.ts.
export function presentationDestination(action) {
  const effect = action.effect;
  return JSON.stringify(effect.kind === 'state'
    ? [effect.site, effect.path, effect.value]
    : [action.file, action.owner, effect]);
}

const controlMatches = (selector, target) => (selector.prop === undefined || selector.prop === target.prop) &&
  (selector.line !== undefined ? selector.file === target.file && selector.line === target.line
    : selector.file === target.definition?.file && selector.component === target.definition.component ||
      selector.file === target.file && selector.component === target.owner && target.generic);

/** Compare reviewed identities, never labels inferred from a whole render branch. */
export function compareViewReference(graph, reference, targetsForAction) {
  const states = new Map((graph.presentations?.states ?? []).map(site => [site.id, site]));
  const groups = new Map();
  for (const action of graph.presentations?.actions ?? []) {
    const key = presentationDestination(action);
    const group = groups.get(key) ?? { key, actions: [], targets: [] };
    group.actions.push(action);
    if (action.effect.kind === 'control') group.targets.push(...targetsForAction(action));
    groups.set(key, group);
  }
  for (const group of groups.values()) group.targets = [...new Map(group.targets.map(target => [JSON.stringify(target), target])).values()];
  const matches = (selector, group) => {
    const action = group.actions[0], effect = action.effect;
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
      return results.length ? [{ key: group.key, result: covered || results.includes('exact') ? 'exact' : 'ambiguous' }] : [];
    });
    return { ...row, status: routeMatches(row) || candidates.some(candidate => candidate.result === 'exact') ? 'matched'
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
    rawPresentationActions: graph.presentations?.actions.length ?? 0, presentationDestinations: groups.size,
    collisions,
    unclassifiedDestinations: [...groups.values()].filter(group => !claims.has(group.key)).map(group => ({
      key: group.key, targets: group.targets, actions: group.actions.map(({ file, line, owner, name, effect }) => ({ file, line, owner, name, effect })),
    })),
    rows,
  };
}
