export type FlowParams = Record<string, unknown>;
export type FlowStatus = "pending" | "needs-data" | "capturing" | "captured" | "blocked" | "timed-out";
export type FlowNode = {
  id: string;
  name: string;
  kind: "navigator" | "screen";
  component?: string;
  definition?: string;
  sharedFrom?: string;
  file?: string;
  line?: number;
  path: string[];
  paths?: string[][];
  entry?: boolean;
  urls?: string[];
  required: string[];
  paramVariants?: { required: string[]; literals: FlowParams }[];
  params?: FlowParams;
  status: FlowStatus;
  reason?: string;
  /** Local failure evidence only. Never send it to telemetry. */
  failure?: {operation:string;detail?:string};
  image?: string;
  imageSourceHash?: string;
  captureMs?: number;
  captureAttempts?: number;
  groupId?: string;
  capture?: 'observed';
  sourceViews?: string[];
  presentation?: { actions: string[]; projections?: string[]; preview?: boolean; basePath: string[]; baseParams?: FlowParams; expo?: boolean; entryKey?: string };
};
export type FlowEdge = { from: string; to: string; kind: "contains" | "navigation"; owner?: string; via?: "link" | "call"; guarded?: boolean; file?: string; line?: number };
export type FlowLink = { target: string; owner: string; params?: FlowParams; guarded: boolean };
export type FlowStateExpression = {value: string|number|boolean|null} | {undefined:true} | {unknown:true} | {input:'state'|'payload'|'props'|'locals'} | {data:{file:string;name:string}} | {object:Record<string,FlowStateExpression>} | {has:FlowStateExpression;item:FlowStateExpression} | {get:FlowStateExpression;key:string} | {op:'?'|'!'|'==='|'!=='|'&&'|'||'|'??'|'<'|'<='|'>'|'>=';args:FlowStateExpression[]};
export type FlowStateSelection = {id:string;file:string;owner:string;component:string;source:{line:number;column:number;endLine:number;endColumn:number};locals?:string[];payload:Record<string,FlowStateExpression>;patch:Record<string,FlowStateExpression>};
export type FlowStateSite = { id: string; file: string; line: number; column: number; endLine: number; endColumn?: number; owner: string; paths: string[][]; selections?: FlowStateSelection[]; data?: {file:string;name:string}[]; hook?: 'useState' | 'useReducer'; valueName?: string; owners?: string[]; ownerSites?: {file: string; owner: string}[]; ownerEntries?: {component:string; file:string; owner:string; source:{line:number;column:number;endLine:number;endColumn:number}}[] };
export type FlowPresentationAction = {
  id: string; file: string; line: number; owner: string; component: string; prop: string; name: string;
  source?: { line: number; column: number; endLine: number; endColumn: number };
  trigger?: Record<string,string|number|boolean>;
  handler?: string;
  guard?: FlowUiCondition;
  preview?: boolean;
  views?: string[];
  expected?: {scope?: 'owner'; component: string; file: string; owner: string; source: {line: number; column: number; endLine: number; endColumn: number}};
  handoffs?: {file: string; owner: string; component: string; prop: string; source: {line: number; column: number; endLine: number; endColumn: number}; contextPath: string[]; close: string}[];
  consumer?: {component: string; entries: {file: string; owner: string; source: {line: number; column: number; endLine: number; endColumn: number}}[]};
  effect: { kind:'mount'; file:string; export:string } | { kind: 'state'; site: string; path: string[]; value: unknown } | { kind: 'control'; component: string; prop: string; method: string; close: string | string[]; target?: {file: string; owner: string; line: number; source: {line: number; column: number; endLine: number; endColumn: number}} };
};
export type FlowUiCondition = { prop: string[] } | { value: unknown } | { op: '!' | '&&' | '||' | '===' | '!==' | '==' | '!='; args: FlowUiCondition[] };
export type FlowSourceView = {
  id: string; name: string; file: string; owner: string; line: number;
  kind: 'state' | 'control' | 'branch' | 'component';
  source: {line: number; column: number; endLine: number; endColumn: number};
  components: {file: string; component: string; guards?: number; entry?: {file: string; source: {line: number; column: number; endLine: number; endColumn: number}}}[];
  state?: {site: string; path: string[]; value: unknown};
  control?: {component: string; prop: string; boundary: boolean; generic: boolean};
  branch?: {condition: string; side: 'true' | 'false' | 'case'};
  availability: 'observed-only';
  renderBody?: boolean;
  /** Render sites sharing one finite state; keep callbacks distinct from form owners. */
  renders?: {file: string; owner: string; line: number; source: FlowSourceView['source']; components: FlowSourceView['components']; renderBody: boolean; callbackOwner?: string; branch?: FlowSourceView['branch']}[];
  /** Exported owner whose ordinary initial render needs no supplied props. */
  mount?: {export:string};
  entries?: {file: string; line: number; owner: string; source?: {line: number; column: number; endLine: number; endColumn: number}}[];
};
export type FlowPresentations = { states: FlowStateSite[]; actions: FlowPresentationAction[]; previews?: FlowPresentationAction[]; previewStates?: FlowStateSite[]; views?: FlowSourceView[]; viewStates?: FlowStateSite[] };
export type FlowGraph = { presentations?: FlowPresentations; sourceHash?: string; catalogMs?: number; links?: FlowLink[]; nodes: FlowNode[]; edges: FlowEdge[]; warnings: string[]; files: number; scanMs: number };
export type FlowRun = FlowGraph & {
  id: string;
  pluginVersion?: string;
  runtimeTimings?: {operation:string;count:number;totalMs:number;maxMs:number;timeouts:number}[];
  phase: "scanning" | "connecting" | "reconnecting" | "capturing" | "recording" | "finishing" | "complete" | "partial" | "stopped" | "failed";
  discoveryFailures?: {nodeId:string;operation:string;message:string;detail?:string}[];
  groups?: { id: string; name: string }[];
  recording?: { groupId: string; message: string };
  startedAt: number;
  finishedAt?: number;
  elapsedMs?: number;
  captureStartedAt?: number;
  captureMode?: 'instrumented';
  preparationMs?: number;
  manifestTotal?: number;
  error?: string;
  revision: number;
  retrying?: boolean;
  sourceCatalogKey?: string;
  ai: "off" | "waiting" | "resolving" | "done" | "unavailable";
};
/** Source facts are immutable scan data, not canvas polling data. */
export function publicFlowRun(run: FlowRun): FlowRun {
  return {...run,presentations:run.presentations?{states:run.presentations.states,actions:run.presentations.actions,previews:run.presentations.previews,previewStates:run.presentations.previewStates}:undefined};
}
/** Polling renders a graph, not its source analysis or executable recipes. */
export function flowProgressRun(run: FlowRun): FlowRun {
  const {presentations,links,...progress}=run;
  return progress;
}
export type FlowResolution = { nodeId: string; params: FlowParams };
export const flowRunning = (run?: FlowRun) => !!run && ["scanning", "connecting", "reconnecting", "capturing", "recording", "finishing"].includes(run.phase);
export function flowProgress(run: FlowRun) {
  const screens = run.nodes.filter(node => node.kind === 'screen');
  return {
    discovered: screens.length,
    captured: screens.filter(node => node.status === 'captured').length,
    queued: screens.filter(node => node.status === 'pending' || node.status === 'capturing').length,
    needsData: screens.filter(node => node.status === 'needs-data').length,
    unsuccessful: screens.filter(node => node.status === 'blocked' || node.status === 'timed-out').length,
  };
}
export function missingFlowParams(node: Pick<FlowNode, "required" | "params" | "paramVariants">): string[] {
  const missing = (keys: string[]) => keys.filter(key => node.params?.[key] === undefined || node.params[key] === null || node.params[key] === "");
  if (!node.paramVariants?.length) return missing(node.required);
  const matches = node.paramVariants.filter(variant => Object.entries(variant.literals).every(([key, value]) => node.params?.[key] === undefined || node.params[key] === value));
  if (!matches.length) return ["$variant"];
  return matches.map(variant => missing(variant.required)).sort((a, b) => a.length - b.length)[0];
}

export const FLOW_CARD_WIDTH = 202;
export const FLOW_PREVIEW_ASPECT_RATIO = 9 / 16;
// The frame is inset by 10px on each side; title, status and borders use 66px.
export const FLOW_CARD_HEIGHT = Math.ceil((FLOW_CARD_WIDTH - 20) / FLOW_PREVIEW_ASPECT_RATIO) + 66;
const columnGap = 48, rowGap = 28;

/** Build a spanning forest from navigation links, then pack sibling branches in short columns. */
export function layoutFlow(graph: Pick<FlowGraph, "nodes" | "edges">) {
  const positions = new Map<string, { x: number; y: number }>();
  const byId = new Map(graph.nodes.map(node => [node.id, node]));
  const outgoing = new Map<string, string[]>(), incoming = new Set<string>();
  const navigation = graph.edges.filter(edge => edge.kind === "navigation");
  for (const edge of navigation.length ? navigation : graph.edges) {
    if (!byId.has(edge.from) || !byId.has(edge.to) || edge.from === edge.to) continue;
    const list = outgoing.get(edge.from) ?? [];
    if (!list.includes(edge.to)) list.push(edge.to);
    outgoing.set(edge.from, list); incoming.add(edge.to);
  }
  const children = new Map<string, string[]>(), assigned = new Set<string>(), roots: string[] = [];
  const treeEdges = new Set<string>();
  const grow = (root: string) => {
    roots.push(root); assigned.add(root);
    const queue = [root];
    for (let index = 0; index < queue.length; index++) for (const child of outgoing.get(queue[index]) ?? []) {
      if (assigned.has(child) || byId.get(child)?.entry) continue;
      assigned.add(child); queue.push(child);
      const list = children.get(queue[index]) ?? []; list.push(child); children.set(queue[index], list);
      treeEdges.add(`${queue[index]}:${child}`);
    }
  };
  for (const node of graph.nodes) if (node.entry || !incoming.has(node.id)) { if (!assigned.has(node.id)) grow(node.id); }
  for (const node of graph.nodes) if (!assigned.has(node.id)) grow(node.id);
  type Box = { width: number; height: number; items: { id: string; x: number; y: number }[] };
  const pack = (ids: string[], depth = 0): Box => {
    let x = 0, height = 0;
    const items: Box["items"] = [];
    const rows = depth === 0 ? 1 : 3;
    for (let offset = 0; offset < ids.length; offset += rows) {
      let y = 0, width = 0;
      for (const id of ids.slice(offset, offset + rows)) {
        const nested = pack(children.get(id) ?? [], depth + 1);
        items.push({ id, x, y });
        for (const item of nested.items) items.push({ ...item, x: item.x + x + FLOW_CARD_WIDTH + columnGap, y: item.y + y });
        width = Math.max(width, FLOW_CARD_WIDTH + (nested.width ? columnGap + nested.width : 0));
        y += Math.max(byId.get(id)?.kind === "navigator" ? 56 : FLOW_CARD_HEIGHT, nested.height) + rowGap;
      }
      height = Math.max(height, y - rowGap); x += width + columnGap;
    }
    return { width: Math.max(0, x - columnGap), height, items };
  };
  const box = pack(roots);
  for (const { id, x, y } of box.items) positions.set(id, { x: x + 36, y: y + 36 });
  return { positions, treeEdges, width: Math.max(600, box.width + 72), height: Math.max(420, box.height + 72) };
}

export type FlowViewport = { x: number; y: number; width: number; height: number };
export function visibleFlowNodes(positions: Map<string, { x: number; y: number }>, viewport: FlowViewport, margin = 180) {
  const visible = new Set<string>();
  for (const [id, point] of positions) if (point.x + FLOW_CARD_WIDTH >= viewport.x - margin && point.x <= viewport.x + viewport.width + margin && point.y + FLOW_CARD_HEIGHT >= viewport.y - margin && point.y <= viewport.y + viewport.height + margin) visible.add(id);
  return visible;
}
