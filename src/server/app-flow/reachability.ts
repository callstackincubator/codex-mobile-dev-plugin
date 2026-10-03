import { createHash } from 'node:crypto';
import type { FlowEdge, FlowGraph, FlowNode, FlowParams } from '../../shared/app-flow.ts';
import { missingFlowParams } from '../../shared/app-flow.ts';

export type FlowEvidence = {
  active?: string[];
  entries?: string[][];
  registrations?: { name: string; path: string[] }[];
  links?: (string | { screen?: string; name?: string; pathname?: string; params?: FlowParams })[];
  components?: string[];
  candidates?: { name: string; params: FlowParams }[];
};

const samePath = (a: string[], b: string[]) => a.length === b.length && a.every((part, index) => part === b[index]);
const prefix = (a: string[], b: string[]) => { let count = 0; while (count < a.length && a[count] === b[count]) count++; return count; };

/** Match route templates without evaluating app code. Extract only values from real links. */
export function matchFlowLink(pattern: string, link: string): FlowParams | undefined {
  const parts = (value: string) => value.split(/[?#]/)[0].split('/').filter(part => part && part !== 'index' && !/^\(.+\)$/.test(part));
  const expected = parts(pattern), actual = parts(link), params: FlowParams = {};
  let offset = 0;
  for (const part of expected) {
    const key = /^:([^?]+)\??$/.exec(part)?.[1] ?? /^\[(?:\.\.\.)?([^\]]+)\]$/.exec(part)?.[1];
    if (part.startsWith('[...') && key) { params[key] = actual.slice(offset); offset = actual.length; continue; }
    if (actual[offset] === undefined) return;
    if (key) { try { params[key] = decodeURIComponent(actual[offset]); } catch { return; } }
    else if (part !== actual[offset]) return;
    offset++;
  }
  if (offset !== actual.length) return;
  const query = link.indexOf('?');
  if (query >= 0) for (const [key, value] of new URLSearchParams(link.slice(query + 1).split('#')[0])) {
    if (!/token|password|secret|authorization|cookie|^(__proto__|constructor|prototype)$/i.test(key) && !Object.hasOwn(params, key)) params[key] = value;
  }
  return params;
}

/** Registration is a catalog. Only entry screens and links in the mounted UI enter the run. */
export class FlowReachability {
  readonly nodes: FlowNode[];
  private edges: FlowEdge[];
  private selected = new Set<string>();
  private edgeKeys = new Set<string>();
  private graph: FlowGraph;
  constructor(graph: FlowGraph, evidence: FlowEvidence, previous?: Pick<FlowGraph, 'nodes' | 'edges'>) {
    this.graph = graph;
    const top = new Set(evidence.registrations?.filter(route => route.path.length === 1).map(route => route.name));
    for (const route of evidence.registrations ?? []) {
      if (graph.nodes.some(node => samePath(node.path, route.path)) || evidence.registrations?.some(child => child.path.length > route.path.length && prefix(child.path, route.path) === route.path.length)) continue;
      graph.nodes.push({ id: `runtime-${createHash('sha256').update(JSON.stringify(route.path)).digest('hex').slice(0,20)}`, name: route.name, definition: `runtime:${route.name}`, kind: 'screen', path: route.path, required: [], status: 'pending' });
    }
    const canonical = new Map<string, FlowNode>(), ids = new Map<string, string>();
    for (const source of graph.nodes) {
      if (source.kind !== 'screen' || top.size && source.component !== 'expo-router' && !top.has(source.path[0])) continue;
      const key = JSON.stringify([source.definition ?? source.component ?? source.id, source.name, source.required, source.params]);
      let node = canonical.get(key);
      if (!node) { node = { ...source, paths: [] }; canonical.set(key, node); }
      node.paths!.push(source.path); node.entry ||= source.entry;
      ids.set(source.id, node.id);
    }
    this.nodes = [...canonical.values()];
    const canonicalEdges = new Map<string, FlowEdge>();
    for (const edge of graph.edges) {
      const from = ids.get(edge.from), to = ids.get(edge.to);
      if (edge.kind === 'navigation' && from && to && from !== to) canonicalEdges.set(JSON.stringify([from, to, edge.owner, edge.via, edge.guarded]), { ...edge, from, to });
    }
    this.edges = [...canonicalEdges.values()];
    graph.nodes = []; graph.edges = [];
    // Keep confirmed screens, completed previews, and their links when extending
    // a saved map. The fresh catalog still supplies undiscovered destinations.
    for (const saved of previous?.nodes ?? []) {
      let node = this.nodes.find(node => node.id === saved.id);
      if (node) Object.assign(node, saved);
      else { node = { ...saved }; this.nodes.push(node); }
      this.add(node);
    }
    for (const edge of previous?.edges ?? []) {
      const from = graph.nodes.find(node => node.id === edge.from), to = graph.nodes.find(node => node.id === edge.to);
      if (from && to) this.add(to, from);
    }
    for (const node of this.nodes) {
      node.paths!.sort((a, b) => prefix(b, evidence.active ?? []) - prefix(a, evidence.active ?? []));
      node.path = node.paths![0];
      const candidate = evidence.candidates?.find(item => item.name === node.name && !missingFlowParams({ ...node, params: item.params }).length);
      if (candidate && missingFlowParams(node).length && node.status !== 'captured') { node.params = { ...node.params, ...Object.fromEntries(node.required.filter(key => candidate.params[key] !== undefined).map(key => [key, candidate.params[key]])) }; node.status = 'pending'; }
      if (node.entry || evidence.entries?.some(path => node.paths!.some(candidate => samePath(candidate, path))) || node.paths!.some(path => samePath(path, evidence.active ?? []))) this.add(node);
    }
    // Older runtimes and caller-provided graphs may not carry entry metadata.
    if (!evidence.entries && !evidence.active && !this.nodes.some(node => node.entry)) for (const node of this.nodes) this.add(node);
    const current = graph.nodes.find(node => node.paths?.some(path => samePath(path, evidence.active ?? []))) ?? graph.nodes[0];
    if (current) this.reveal(current, evidence);
  }
  private add(node: FlowNode, from?: FlowNode) {
    if (!this.selected.has(node.id)) { this.selected.add(node.id); this.graph.nodes.push(node); }
    if (from && from.id !== node.id) {
      const key = `${from.id}:${node.id}`;
      if (!this.edgeKeys.has(key)) { this.edgeKeys.add(key); this.graph.edges.push({ from: from.id, to: node.id, kind: 'navigation' }); }
    }
  }
  reveal(from: FlowNode, evidence: FlowEvidence) {
    // Direct navigation calls are accepted only from components that actually rendered.
    // Conditional links are resolved from their live props below, including dynamic URLs.
    const components = new Set(evidence.components ?? []);
    for (const edge of this.edges) {
      if (edge.from !== from.id || edge.via === 'link' || edge.guarded) continue;
      if (edge.owner && edge.owner !== 'default' && !components.has(edge.owner)) continue;
      const node = this.nodes.find(node => node.id === edge.to);
      if (node) this.add(node, from);
    }
    const global = (this.graph.links ?? []).filter(link => !link.guarded && components.has(link.owner)).map(link => ({screen: link.target, params: link.params}));
    for (const link of [...(evidence.links ?? []), ...global]) {
      const target = typeof link === 'string' ? link : link.screen ?? link.name ?? link.pathname;
      if (!target || /^[a-z]+:/i.test(target)) continue;
      const matches = this.nodes.flatMap(node => {
        if (node.name === target) return [{node, params: {}, rank: 10000}];
        return (node.urls ?? []).flatMap(url => {
          const params = matchFlowLink(url, target);
          const rank = url.split('/').filter(part => part && !/^[:[(]/.test(part)).length * 100 - Object.keys(params ?? {}).length;
          return params ? [{node,params,rank}] : [];
        });
      });
      const best = Math.max(-1, ...matches.map(match => match.rank));
      for (const {node,params,rank} of matches) {
        if (rank !== best) continue;
        const data = { ...params, ...(typeof link === 'object' ? link.params : {}) };
        // Optional navigation flags can open dialogs or perform actions on mount.
        // Keep registered defaults, and infer only required route data.
        const provided = Object.fromEntries(node.required.filter(key => data[key] !== undefined).map(key => [key, data[key]]));
        if (Object.keys(provided).length && missingFlowParams(node).length && node.status !== 'captured' && node.status !== 'capturing') {
          node.params = { ...node.params, ...provided };
          node.status = missingFlowParams(node).length ? 'needs-data' : 'pending';
        }
        this.add(node, from);
      }
    }
  }
  finish() {
    const excluded = this.nodes.length - this.selected.size;
    if (excluded) this.graph.warnings.push(`${excluded} registered screens had no visible entry or confirmed navigation link and were left out. Hidden menus and unresolved navigation expressions may expose more screens.`);
  }
}
