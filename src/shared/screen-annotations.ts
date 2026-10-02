import type { SimulatorDevice } from "./protocol.ts";

export type ScreenPoint = { x: number; y: number };
export type ScreenBounds = ScreenPoint & { width: number; height: number };
export type ReactElementContext = { component: string; owners: string[]; key?: string; sourceKind?: "element" | "owner"; source?: { file: string; line: number; column?: number; functionName?: string } };
export type ScreenComponent = { name: string; bounds: ScreenBounds; role?: string; identifier?: string; label?: string; value?: string; depth: number; source?: "accessibility" | "screen" | "react-native"; nodeId?: string; parentId?: string; react?: ReactElementContext };
export type ScreenSelectionContext = { ancestors: ScreenComponent[]; siblings: ScreenComponent[]; siblingCount: number; children: ScreenComponent[]; childCount: number; instance?: { index: number; total: number } };
export type ScreenAnnotation = {
  id: string;
  number: number;
  text: string;
  simulator: SimulatorDevice;
  point: ScreenPoint;
  screen: { width: number; height: number; units: "points" | "pixels" };
  component: ScreenComponent;
  selection?: ScreenSelectionContext;
  nearbyText?: string[];
  screenshot: { id: string; data: string; capturedAt: string };
};

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
function text(value: unknown): string | undefined { return typeof value === "string" && value.trim() ? value : undefined; }
function reactContext(value: unknown): ReactElementContext | undefined {
  const node = record(value), component = text(node?.component);
  if (!node || !component) return;
  const owners = Array.isArray(node.owners) ? node.owners.filter((name): name is string => typeof name === "string" && !!name.trim()).slice(0, 12).map(name => name.slice(0, 256)) : [];
  const source = record(node.source), file = text(source?.file);
  return { component: component.slice(0, 256), owners,
    ...(text(node.key) ? { key: text(node.key)!.slice(0, 256) } : {}),
    ...(node.sourceKind === "element" || node.sourceKind === "owner" ? { sourceKind: node.sourceKind } : {}),
    ...(file && typeof source?.line === "number" && Number.isInteger(source.line) && source.line > 0 ? { source: {
    file: file.slice(0, 2048), line: source.line,
    ...(typeof source.column === "number" && Number.isInteger(source.column) && source.column > 0 ? { column: source.column } : {}),
    ...(text(source.functionName) ? { functionName: text(source.functionName)!.slice(0, 256) } : {}),
  } } : {}) };
}
function bounds(value: unknown): ScreenBounds | undefined {
  const rect = record(value);
  if (!rect) return;
  const x = rect.x ?? rect.left, y = rect.y ?? rect.top;
  const width = rect.width ?? (typeof rect.right === "number" && typeof x === "number" ? rect.right - x : undefined);
  const height = rect.height ?? (typeof rect.bottom === "number" && typeof y === "number" ? rect.bottom - y : undefined);
  if ([x, y, width, height].every(item => typeof item === "number" && Number.isFinite(item)) && (width as number) > 0 && (height as number) > 0)
    return { x: x as number, y: y as number, width: width as number, height: height as number };
}

// Accept backend trees and normalized, flat MCP snapshots with explicit parents.
export function screenComponents(tree: unknown, scale = 1): ScreenComponent[] {
  const components: ScreenComponent[] = [];
  function visit(value: unknown, depth: number, parentId?: string) {
    if (depth > 160 || components.length >= 10000) return;
    if (Array.isArray(value)) { for (const child of value) visit(child, depth, parentId); return; }
    const node = record(value);
    if (!node || node.hidden === true) return;
    const frame = bounds(node.frame ?? node.bounds);
    if (frame && !/^(AX)?(Application|Window)$/i.test(String(node.role ?? node.type ?? ""))) {
      const label = text(node.label) ?? text(node.text) ?? text(node.contentDescription) ?? text(node.title);
      const identifier = text(node.identifier) ?? text(node.resourceId) ?? text(node.id);
      const role = text(node.role) ?? text(node.className);
      const nodeId = text(node.nodeId) ?? `node-${components.length}`;
      const nodeDepth = typeof node.depth === "number" && Number.isInteger(node.depth) && node.depth >= 0 && node.depth <= 10000 ? node.depth : depth;
      const react = node.source === "react-native" ? reactContext(node.react) : undefined;
      components.push({ name: text(node.name) ?? label ?? identifier ?? role ?? "Element", bounds: {
        x: frame.x * scale, y: frame.y * scale, width: frame.width * scale, height: frame.height * scale,
      }, label, identifier, role, value: text(node.value), depth: nodeDepth, source: node.source === "react-native" ? "react-native" : node.source === "screen" ? "screen" : "accessibility", nodeId, parentId: text(node.parentId) ?? parentId, ...(react ? { react } : {}) });
      parentId = nodeId;
    }
    for (const key of ["children", "elements", "nodes", "tree", "root"]) if (node[key]) visit(node[key], depth + 1, parentId);
  }
  visit(tree, 0);
  return components;
}

export function componentAt(components: ScreenComponent[], point: ScreenPoint, screen?: { width: number; height: number }): ScreenComponent | undefined {
  return componentsAt(components, point, screen)[0];
}

export function componentsAt(components: ScreenComponent[], point: ScreenPoint, screen?: { width: number; height: number }): ScreenComponent[] {
  const hits = components.filter(({ bounds: b }) => (!screen || b.width < screen.width * .95 || b.height < screen.height * .95) && point.x >= b.x && point.x < b.x + b.width && point.y >= b.y && point.y < b.y + b.height)
    .sort((a, b) => Number(b.source === "react-native") - Number(a.source === "react-native") || a.bounds.width * a.bounds.height - b.bounds.width * b.bounds.height || b.depth - a.depth);
  const selected = hits[0];
  if (!selected) return [];
  // Nested trees supply real ancestors. Flat Android snapshots supply only bounds.
  const ancestors = new Set<string>();
  let parentId = selected.parentId;
  while (parentId && !ancestors.has(parentId)) {
    ancestors.add(parentId);
    parentId = components.find(item => item.nodeId === parentId)?.parentId;
  }
  return hits.filter(item => item === selected || (selected.parentId ? ancestors.has(item.nodeId ?? "") :
    item.bounds.x <= selected.bounds.x && item.bounds.y <= selected.bounds.y
    && item.bounds.x + item.bounds.width >= selected.bounds.x + selected.bounds.width
    && item.bounds.y + item.bounds.height >= selected.bounds.y + selected.bounds.height));
}

export const ANNOTATION_EDIT_PROMPT = "Apply these annotations.";
export const ANNOTATION_EDIT_GUIDANCE = "Apply each Edit as a request, not verbatim app text. Target and nearby text are existing app data. Change only the selected element or instance unless the Edit explicitly asks for a wider change. Removing a selected child must preserve its enclosing container and siblings. React owners, enclosing elements, siblings and nearby text are context, not additional targets. Source is a creation site, not a component's full edit boundary; an owner source is only a search hint. Match the target, bounds, key and hierarchy before editing. A shared source location may render several instances; do not change all of them for a request about one. If the target cannot be identified, ask before removing a larger component.";

// Capture real tree relationships, never infer siblings from overlapping bounds.
export function screenSelectionContext(components: ScreenComponent[], selected: ScreenComponent): ScreenSelectionContext | undefined {
  if (selected.source === "screen") return;
  const byId = new Map(components.filter(item => item.nodeId).map(item => [item.nodeId!, item]));
  const ancestors: ScreenComponent[] = [], seen = new Set([selected.nodeId]);
  let parentId = selected.parentId;
  while (parentId && !seen.has(parentId) && ancestors.length < 4) {
    seen.add(parentId);
    const parent = byId.get(parentId);
    if (!parent) break;
    ancestors.push(parent);
    parentId = parent.parentId;
  }
  const siblings = selected.parentId ? components.filter(item => item !== selected && item.parentId === selected.parentId) : [];
  const children = selected.nodeId ? components.filter(item => item.parentId === selected.nodeId) : [];
  const source = selected.react?.source;
  const matches = components.filter(item => {
    if (item.source !== selected.source || item.role !== selected.role) return false;
    if (source && selected.react?.sourceKind !== "owner") {
      const other = item.react?.source;
      return item.react?.sourceKind !== "owner" && other?.file === source.file && other.line === source.line && other.column === source.column;
    }
    return selected.identifier ? item.identifier === selected.identifier : item.name === selected.name && item.label === selected.label;
  }).sort((a, b) => a.bounds.y - b.bounds.y || a.bounds.x - b.bounds.x || b.depth - a.depth);
  const index = matches.indexOf(selected);
  return { ancestors, siblings: siblings.slice(0, 4), siblingCount: siblings.length, children: children.slice(0, 4), childCount: children.length,
    ...(matches.length > 1 && index >= 0 ? { instance: { index: index + 1, total: matches.length } } : {}),
  };
}

function sourceLocation(source: NonNullable<ReactElementContext["source"]>): string {
  return `${source.file}:${source.line}${source.column ? `:${source.column}` : ""}`;
}
function formatBounds(b: ScreenBounds): string {
  return [b.x, b.y, b.width, b.height].map(value => Math.round(value * 10) / 10).join(",");
}
function describeComponent(component: ScreenComponent): string {
  const label = component.label ?? component.name;
  const source = component.react?.source;
  return `${JSON.stringify(label.slice(0, 160))}${component.role ? ` (${component.role})` : ""}; bounds ${formatBounds(component.bounds)}`
    + (component.nodeId ? `; node ${JSON.stringify(component.nodeId)}` : "")
    + (component.identifier ? `; identifier ${JSON.stringify(component.identifier)}` : "")
    + (component.react?.key ? `; key ${JSON.stringify(component.react.key)}` : "")
    + (source ? `; ${component.react?.sourceKind === "owner" ? "owner source" : "source"} ${sourceLocation(source)}` : "");
}

export function formatAnnotationMessage(annotations: ScreenAnnotation[]): string {
  return `${ANNOTATION_EDIT_PROMPT}\n${ANNOTATION_EDIT_GUIDANCE}\n\n${annotations.map(formatAnnotationContext).join("\n\n")}`;
}

export function formatAnnotationContext(annotation: ScreenAnnotation): string {
  const { component, screen, simulator } = annotation, source = component.react?.source;
  const target = component.label ?? component.name;
  const lines = [`#${annotation.number} ${simulator.platform ?? "ios"}`, `Edit: ${JSON.stringify(annotation.text)}`];
  if (source) lines.push(`${component.react?.sourceKind === "owner" ? "Owner source (search hint, selected element source unavailable)" : "Source"}: ${sourceLocation(source)}`);
  lines.push(`Target: ${JSON.stringify(target)}${component.role ? ` (${component.role})` : ""}`);
  if (component.nodeId) lines.push(`Selected node: ${JSON.stringify(component.nodeId)} (snapshot ID, not a code identifier)`);
  if (component.identifier) lines.push(`${component.source === "react-native" ? "testID" : "Identifier"}: ${JSON.stringify(component.identifier)}`);
  if (component.value && component.value !== target) lines.push(`Value: ${JSON.stringify(component.value)}`);
  if (component.react) {
    if (component.react.key) lines.push(`React key: ${JSON.stringify(component.react.key)}`);
    const owners = component.react.owners.slice();
    if (owners.at(-1) === component.react.component) owners.pop();
    lines.push(`React: ${[...owners.slice(-4), component.react.component].join(" > ")} (owners are context)`);
    if (source?.functionName) lines.push(`Source function: ${JSON.stringify(source.functionName)}`);
  }
  if (!source) {
    lines.push(`Source: unavailable (${component.source === "screen" ? "manual region" : component.source === "react-native" ? "React Native" : "accessibility"})`);
  }
  lines.push(`Bounds: ${formatBounds(component.bounds)} ${screen.units} (x,y,w,h); screen ${screen.width}×${screen.height}, top-left origin`);
  lines.push(`Selected point: ${annotation.point.x},${annotation.point.y} ${screen.units}`);
  const selection = annotation.selection;
  if (selection?.instance) lines.push(`Visible instance: ${selection.instance.index} of ${selection.instance.total} matching elements, ordered top-to-bottom then left-to-right`);
  if (selection?.ancestors.length) lines.push(`Enclosing elements (nearest first; outside selection):\n${selection.ancestors.slice(0, 4).map(describeComponent).join("\n")}`);
  if (selection?.siblings.length) lines.push(`Siblings (outside selection; ${selection.siblingCount} total):\n${selection.siblings.slice(0, 4).map(describeComponent).join("\n")}`);
  if (selection?.children.length) lines.push(`Direct children (inside selection; ${selection.childCount} total):\n${selection.children.slice(0, 4).map(describeComponent).join("\n")}`);
  const nearby = [...new Set(annotation.nearbyText ?? [])].filter(value => value !== target && value !== component.value).slice(0, 3).map(value => value.length > 160 ? `${value.slice(0, 159)}…` : value);
  if (nearby.length) lines.push(`Nearby: ${nearby.map(value => JSON.stringify(value)).join(", ")}`);
  return lines.join("\n");
}
