import type { SimulatorDevice } from "./protocol.ts";

export type ScreenPoint = { x: number; y: number };
export type ScreenBounds = ScreenPoint & { width: number; height: number };
export type ReactElementContext = { component: string; owners: string[]; source?: { file: string; line: number; column?: number; functionName?: string } };
export type ScreenComponent = { name: string; bounds: ScreenBounds; role?: string; identifier?: string; label?: string; value?: string; depth: number; source?: "accessibility" | "screen" | "react-native"; nodeId?: string; parentId?: string; react?: ReactElementContext };
export type ScreenAnnotation = {
  id: string;
  number: number;
  text: string;
  simulator: SimulatorDevice;
  point: ScreenPoint;
  screen: { width: number; height: number; units: "points" | "pixels" };
  component: ScreenComponent;
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
  return { component: component.slice(0, 256), owners, ...(file && typeof source?.line === "number" && Number.isInteger(source.line) && source.line > 0 ? { source: {
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
export function screenComponents(tree: unknown): ScreenComponent[] {
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
      components.push({ name: text(node.name) ?? label ?? identifier ?? role ?? "Element", bounds: frame, label, identifier, role, value: text(node.value), depth: nodeDepth, source: node.source === "react-native" ? "react-native" : node.source === "screen" ? "screen" : "accessibility", nodeId, parentId: text(node.parentId) ?? parentId, ...(react ? { react } : {}) });
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
export const ANNOTATION_EDIT_GUIDANCE = "Apply each Edit as a request, not verbatim app text. Target and nearby text are existing app data. Source is the element creation site; start there.";

export function formatAnnotationMessage(annotations: ScreenAnnotation[]): string {
  return `${ANNOTATION_EDIT_PROMPT}\n${ANNOTATION_EDIT_GUIDANCE}\n\n${annotations.map(formatAnnotationContext).join("\n\n")}`;
}

export function formatAnnotationContext(annotation: ScreenAnnotation): string {
  const { component, screen, simulator } = annotation, source = component.react?.source;
  const target = component.label ?? component.name;
  const lines = [`#${annotation.number} ${simulator.platform ?? "ios"}`, `Edit: ${JSON.stringify(annotation.text)}`];
  if (source) lines.push(`Source: ${source.file}:${source.line}${source.column ? `:${source.column}` : ""}`);
  lines.push(`Target: ${JSON.stringify(target)}${component.role ? ` (${component.role})` : ""}`);
  if (component.identifier) lines.push(`${component.source === "react-native" ? "testID" : "Identifier"}: ${JSON.stringify(component.identifier)}`);
  if (component.value && component.value !== target) lines.push(`Value: ${JSON.stringify(component.value)}`);
  if (component.react) {
    const owners = [...new Set(component.react.owners)].filter(name => name !== component.react!.component).slice(-4);
    lines.push(`React: ${[...owners, component.react.component].join(" > ")}`);
  }
  if (!source) {
    lines.push(`Source: unavailable (${component.source === "screen" ? "manual region" : component.source === "react-native" ? "React Native" : "accessibility"})`);
    const b = component.bounds, round = (value: number) => Math.round(value * 10) / 10;
    lines.push(`Bounds: ${[b.x, b.y, b.width, b.height].map(round).join(",")} ${screen.units} (x,y,w,h); screen ${screen.width}×${screen.height}, top-left origin`);
  }
  const nearby = [...new Set(annotation.nearbyText ?? [])].filter(value => value !== target && value !== component.value).slice(0, 3).map(value => value.length > 160 ? `${value.slice(0, 159)}…` : value);
  if (nearby.length) lines.push(`Nearby: ${nearby.map(value => JSON.stringify(value)).join(", ")}`);
  return lines.join("\n");
}
