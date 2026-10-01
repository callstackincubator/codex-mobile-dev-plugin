import type { SimulatorDevice } from "./protocol.ts";

export type ScreenPoint = { x: number; y: number };
export type ScreenBounds = ScreenPoint & { width: number; height: number };
export type ScreenComponent = { name: string; bounds: ScreenBounds; role?: string; identifier?: string; label?: string; value?: string; depth: number; source?: "accessibility" | "screen" };
export type ScreenAnnotation = {
  id: string;
  number: number;
  text: string;
  simulator: SimulatorDevice;
  point: ScreenPoint;
  screen: { width: number; height: number; units: "points" | "pixels" };
  component: ScreenComponent;
  screenshot: { id: string; data: string; capturedAt: string };
};

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
function text(value: unknown): string | undefined { return typeof value === "string" && value.trim() ? value : undefined; }
function bounds(value: unknown): ScreenBounds | undefined {
  const rect = record(value);
  if (!rect) return;
  const x = rect.x ?? rect.left, y = rect.y ?? rect.top;
  const width = rect.width ?? (typeof rect.right === "number" && typeof x === "number" ? rect.right - x : undefined);
  const height = rect.height ?? (typeof rect.bottom === "number" && typeof y === "number" ? rect.bottom - y : undefined);
  if ([x, y, width, height].every(item => typeof item === "number" && Number.isFinite(item)) && (width as number) > 0 && (height as number) > 0)
    return { x: x as number, y: y as number, width: width as number, height: height as number };
}

// Baguette returns nested AX nodes; serve-emu returns flat nodes with pixel bounds.
export function screenComponents(tree: unknown): ScreenComponent[] {
  const components: ScreenComponent[] = [];
  function visit(value: unknown, depth: number) {
    if (depth > 60 || components.length >= 10000) return;
    if (Array.isArray(value)) { for (const child of value) visit(child, depth); return; }
    const node = record(value);
    if (!node || node.hidden === true) return;
    const frame = bounds(node.frame ?? node.bounds);
    if (frame && !/^(AX)?(Application|Window)$/i.test(String(node.role ?? node.type ?? ""))) {
      const label = text(node.label) ?? text(node.text) ?? text(node.contentDescription) ?? text(node.title);
      const identifier = text(node.identifier) ?? text(node.resourceId) ?? text(node.id);
      const role = text(node.role) ?? text(node.className);
      components.push({ name: label ?? identifier ?? role ?? "Screen region", bounds: frame, label, identifier, role, value: text(node.value), depth, source: "accessibility" });
    }
    for (const key of ["children", "elements", "nodes", "tree", "root"]) if (node[key]) visit(node[key], depth + 1);
  }
  visit(tree, 0);
  return components;
}

export function componentAt(components: ScreenComponent[], point: ScreenPoint, screen?: { width: number; height: number }): ScreenComponent | undefined {
  return components.filter(({ bounds: b }) => (!screen || b.width < screen.width * .95 || b.height < screen.height * .95) && point.x >= b.x && point.x < b.x + b.width && point.y >= b.y && point.y < b.y + b.height)
    .sort((a, b) => a.bounds.width * a.bounds.height - b.bounds.width * b.bounds.height || b.depth - a.depth)[0];
}

export function annotationDetails(annotation: ScreenAnnotation) {
  const { screenshot, ...details } = annotation;
  return { ...details, screenshotId: screenshot.id, capturedAt: screenshot.capturedAt };
}

export function formatAnnotationContext(annotation: ScreenAnnotation): string {
  return `Simulator screen annotation #${annotation.number}\nUser note: ${annotation.text}\nScreen and element context: ${JSON.stringify(annotationDetails(annotation))}\nCoordinates start at the screen's top-left, excluding the device frame. ${annotation.component.source === "screen" ? "These bounds describe a region detected from screen pixels. No native component name is available." : "Component names come from the accessibility tree, not source code."} The screenshot shows the screen captured when select mode started.`;
}
