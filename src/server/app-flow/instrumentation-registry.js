/** In-app references never cross the inspector bridge or enter telemetry. */
export function createFlowRegistry(preparePreview) {
  const owners = new Map(), listeners = new Set();
  const loaders = new Map();
  let revision = 0, sequence = 0, projection, releasePreview;
  const notify = () => { revision++; for (const listener of [...listeners]) listener(); };
  return {
    version: 1,
    get revision() { return revision; },
    get projection() { return projection; },
    registerLoaders(entries) { for (const [id, load] of entries) loaders.set(id,load); },
    async project({source, owner, site, value}) {
      if (projection) throw new Error('Close the current preview before mounting another owner.');
      const hosts = [...owners.values()].filter(item=>item.host && !item.preview);
      if (hosts.length !== 1) throw new Error('A unique capture host is required for this preview.');
      const type = owner?.type ?? await loaders.get(source)?.();
      if (!type) throw new Error('The source component is not registered in this build.');
      if (!hosts[0].mounted || owner && !owner.mounted) throw new Error('The preview owner unmounted while preparing its component.');
      const seeds = new Map();
      for (const [id,entry] of owner?.entries ?? []) if (entry.kind==='state') seeds.set(id,entry.tuple[0]);
      if (site) seeds.set(site,value);
      const next = {host:hosts[0].id,type,props:owner?.props ?? {},seeds,source,error:undefined};
      const context = preparePreview?.(owner ?? hosts[0], next, () => {
        if (projection === next) { next.error='The isolated view failed to render with the available data.'; notify(); }
      });
      next.providers=context?.providers ?? []; releasePreview=context?.release;
      projection=next; notify();
    },
    unproject() { projection=undefined; try { notify(); } finally { releasePreview?.(); releasePreview=undefined; } },
    previewFailed() { if(projection){projection.error='The isolated view failed to render with the available data.';notify();} },
    create(source, sourceHash) { return {id: `flow-owner-${++sequence}`, source, sourceHash, pending: new Map(), entries: new Map(), mounted: false}; },
    stage(owner, id, value) { owner.pending.set(id, value); return value; },
    commit(owner, entries = owner.pending) {
      owner.entries = new Map(entries); owner.mounted = true;
      owners.set(owner.id, owner); notify();
    },
    remove(owner) { owner.mounted = false; owner.entries.clear(); owners.delete(owner.id); notify(); },
    components(name) {
      return [...owners.values()].filter(owner=>owner.source.endsWith(`#${name}`) && (!projection || owner.preview===projection));
    },
    find(id, ownerId) {
      const matches = [];
      for (const owner of owners.values()) if ((!ownerId || owner.id === ownerId) && owner.entries.has(id)) matches.push({owner, value: owner.entries.get(id)});
      // Repeated rows must be disambiguated by a source-proven owner/real props.
      const scoped=projection?matches.filter(match=>match.owner.preview===projection):matches;
      if(projection && scoped.some(match=>match.value.kind==='control' && matches.some(other=>!other.owner.preview && other.value.kind==='control' && other.value.control===match.value.control)))return undefined;
      return scoped.length === 1 ? scoped[0] : undefined;
    },
    inventory() {
      const counts = new Map();
      for (const owner of owners.values()) for (const id of owner.entries.keys()) counts.set(id, (counts.get(id) || 0) + 1);
      return {revision, sourceHashes:[...new Set([...owners.values()].map(owner=>owner.sourceHash))], sites: [...counts].map(([id, instances]) => ({id, instances})), owners: owners.size};
    },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  };
}
