import type { ManualSnapshotNode, ManualSnapshotRect } from "../../shared/app-flow.ts";

export const STATUS_BAR_POINTS = 50;
export interface WireframeBox {
  node: ManualSnapshotNode;
  left: number; top: number; width: number; height: number;
  caption: string; addressable: boolean;
}

function caption(node: ManualSnapshotNode): string {
  return (node.label ?? node.value ?? node.role ?? node.type ?? "").trim();
}
function addressable(node: ManualSnapshotNode): boolean {
  return Boolean(node.identifier?.trim() || node.label?.trim() || node.value?.trim());
}

export function layoutWireframe(nodes: readonly ManualSnapshotNode[], bounds: ManualSnapshotRect, panelWidth: number): { boxes: WireframeBox[]; scale: number; height: number } {
  if (bounds.width <= 0 || bounds.height <= 0 || panelWidth <= 0) return { boxes: [], scale: 1, height: 0 };
  const scale = panelWidth / bounds.width;
  const right = bounds.x + bounds.width;
  const bottom = bounds.y + bounds.height;
  const chromeFloor = bounds.y + STATUS_BAR_POINTS;
  const boxes: WireframeBox[] = [];
  for (const node of nodes) {
    const rect = node.rect;
    if (!rect || rect.width <= 0 || rect.height <= 0) continue;
    if (rect.x >= right || rect.y >= bottom) continue;
    if (rect.x + rect.width <= bounds.x || rect.y + rect.height <= bounds.y) continue;
    if (rect.y + rect.height <= chromeFloor) continue;
    boxes.push({ node, left: (rect.x - bounds.x) * scale, top: (rect.y - bounds.y) * scale,
      width: rect.width * scale, height: rect.height * scale, caption: caption(node), addressable: addressable(node) });
  }
  boxes.sort((a, b) => b.width * b.height - a.width * a.height);
  return { boxes, scale, height: bounds.height * scale };
}

export function isTextInput(node: ManualSnapshotNode): boolean {
  const semantic = `${node.role ?? node.type ?? ""}`.toLowerCase().replace(/^xcuielementtype/, "");
  return /textfield|searchfield|textview|edittext|searchbar/.test(semantic);
}
