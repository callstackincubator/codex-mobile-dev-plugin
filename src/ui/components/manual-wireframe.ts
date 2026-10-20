import type { ManualSnapshotNode, ManualSnapshotRect } from "../../shared/app-flow.ts";

export const STATUS_BAR_POINTS = 50;
export interface WireframeBox {
  node: ManualSnapshotNode;
  left: number; top: number; width: number; height: number;
  caption: string; addressable: boolean;
  /**
   * This box fully encloses at least one other box, so it is a layout wrapper (a screen, a list,
   * a row, a card) rather than the thing the user means to tap. The panel draws it as an outline
   * that does not take clicks, with a small chip for the cases where the wrapper itself is the
   * target — otherwise a full-screen container sits over every control inside it and nothing in
   * the tab bar can be reached.
   */
  container: boolean;
  /** Paint and hit-test order: smallest box on top, so the innermost element always wins a click. */
  z: number;
}

/** How much a child may spill past its parent and still count as enclosed, in panel pixels. */
const CONTAINMENT_SLACK = 2;
/**
 * What makes a box a wrapper rather than a control with something drawn inside it.
 *
 * Enclosing one child is not enough: a tab button holds a badge, a row holds its own label, and
 * turning either into an outline would take away the tap the user came for. Two or more enclosed
 * siblings is the shape of a container — and only a *big* container can obscure anything, which
 * is the whole problem being solved, so a box also has to span most of the width or a quarter of
 * the screen before it gives up its clicks. A 60pt tab button holding a badge passes neither
 * test; the tab bar around it passes both.
 */
const MIN_ENCLOSED_FOR_WRAPPER = 2;
const WRAPPER_WIDTH_SHARE = 0.8;
const WRAPPER_AREA_SHARE = 0.25;
/**
 * Containment is O(n²) and the snapshot is unbounded — a dense feed reports a few hundred nodes.
 * Past this the wrapper detection is skipped rather than run: the list view is the way through a
 * screen that size anyway, and a frozen panel is worse than an overlapping one.
 */
const MAX_CONTAINMENT_NODES = 600;

function caption(node: ManualSnapshotNode): string {
  return (node.label ?? node.value ?? node.role ?? node.type ?? "").trim();
}
function addressable(node: ManualSnapshotNode): boolean {
  return Boolean(node.identifier?.trim() || node.label?.trim() || node.value?.trim());
}
function encloses(outer: WireframeBox, inner: WireframeBox): boolean {
  return inner.left >= outer.left - CONTAINMENT_SLACK
    && inner.top >= outer.top - CONTAINMENT_SLACK
    && inner.left + inner.width <= outer.left + outer.width + CONTAINMENT_SLACK
    && inner.top + inner.height <= outer.top + outer.height + CONTAINMENT_SLACK;
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
      width: rect.width * scale, height: rect.height * scale, caption: caption(node), addressable: addressable(node),
      container: false, z: 1 });
  }
  // Largest first, so the explicit z below puts the smallest box on top. Sorting alone used to
  // carry that through DOM order, which the hover and selected states then overrode — a hovered
  // wrapper jumped above the controls inside it and swallowed the click that was aimed at them.
  boxes.sort((a, b) => b.width * b.height - a.width * a.height);
  const detectContainers = boxes.length <= MAX_CONTAINMENT_NODES;
  const panelArea = panelWidth * bounds.height * scale;
  for (let index = 0; index < boxes.length; index += 1) {
    const box = boxes[index];
    box.z = index + 1;
    if (!detectContainers) continue;
    const big = box.width >= panelWidth * WRAPPER_WIDTH_SHARE
      || (panelArea > 0 && box.width * box.height >= panelArea * WRAPPER_AREA_SHARE);
    if (!big) continue;
    // Only boxes after this one in the sort can be enclosed by it: anything equal or larger in
    // area either is this box or cannot fit inside it.
    let enclosed = 0;
    for (let other = index + 1; other < boxes.length && enclosed < MIN_ENCLOSED_FOR_WRAPPER; other += 1) {
      if (encloses(box, boxes[other])) enclosed += 1;
    }
    box.container = enclosed >= MIN_ENCLOSED_FOR_WRAPPER;
  }
  return { boxes, scale, height: bounds.height * scale };
}

export function isTextInput(node: ManualSnapshotNode): boolean {
  const semantic = `${node.role ?? node.type ?? ""}`.toLowerCase().replace(/^xcuielementtype/, "");
  return /textfield|searchfield|textview|edittext|searchbar/.test(semantic);
}
