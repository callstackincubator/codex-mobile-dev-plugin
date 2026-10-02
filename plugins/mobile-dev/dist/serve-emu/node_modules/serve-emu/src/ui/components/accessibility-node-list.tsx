import { memo, useEffect, useRef, useState } from "react";
import type { KeyboardEvent, UIEvent } from "react";
import {
  getFixedNavigationIndex,
  getFixedRovingIndex,
  getFixedScrollTopForIndex,
  getFixedVirtualRange,
} from "../lib/fixed-virtual-list";
import type { AccessibilityNode } from "./accessibility-panel";

export const ACCESSIBILITY_ROW_HEIGHT = 40;
export const ACCESSIBILITY_VIEWPORT_HEIGHT = 220;
export const ACCESSIBILITY_OVERSCAN = 3;

type Props = {
  nodes: readonly AccessibilityNode[];
  highlightedId: string | null;
  onHighlight: (id: string | null) => void;
  onTapNode: (node: AccessibilityNode) => void | Promise<void>;
};

function nodeLabel(node: AccessibilityNode): string {
  return node.text || node.contentDescription || node.resourceId || node.className || "Unlabeled";
}

function nodeMeta(node: AccessibilityNode): string {
  const role = node.className.split(".").pop() || "node";
  const width = node.bounds.right - node.bounds.left;
  const height = node.bounds.bottom - node.bounds.top;
  return `${role} · ${width}x${height}`;
}

/**
 * Keeps accessibility snapshots bounded to the visible rows. A 50k-node
 * snapshot therefore reconciles the same small React tree as a 50-node one.
 */
export const AccessibilityNodeList = memo(function AccessibilityNodeList({
  nodes,
  highlightedId,
  onHighlight,
  onTapNode,
}: Props) {
  const [scrollTop, setScrollTop] = useState(0);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef(new Map<number, HTMLButtonElement>());
  const pendingScrollTopRef = useRef(0);
  const scrollFrameRef = useRef<number | null>(null);
  const focusedIndexRef = useRef(0);
  const pendingFocusRef = useRef<number | null>(null);
  const range = getFixedVirtualRange({
    itemCount: nodes.length,
    scrollTop,
    rowHeight: ACCESSIBILITY_ROW_HEIGHT,
    viewportHeight: ACCESSIBILITY_VIEWPORT_HEIGHT,
    overscan: ACCESSIBILITY_OVERSCAN,
  });
  const rovingIndex = getFixedRovingIndex({
    preferredIndex: focusedIndex,
    itemCount: nodes.length,
    scrollTop,
    rowHeight: ACCESSIBILITY_ROW_HEIGHT,
    viewportHeight: ACCESSIBILITY_VIEWPORT_HEIGHT,
  });

  useEffect(
    () => () => {
      if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current);
    },
    [],
  );

  useEffect(() => {
    const next = nodes.length === 0 ? 0 : Math.min(focusedIndexRef.current, nodes.length - 1);
    focusedIndexRef.current = next;
    setFocusedIndex(next);
  }, [nodes.length]);

  useEffect(() => {
    const index = pendingFocusRef.current;
    if (index === null) return;
    const button = buttonRefs.current.get(index);
    if (!button) return;
    pendingFocusRef.current = null;
    button.focus({ preventScroll: true });
  }, [focusedIndex, range.end, range.start]);

  const onScroll = (event: UIEvent<HTMLDivElement>) => {
    pendingScrollTopRef.current = event.currentTarget.scrollTop;
    if (scrollFrameRef.current !== null) return;
    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      const nextScrollTop = pendingScrollTopRef.current;
      const listOwnsFocus = containerRef.current?.contains(document.activeElement) ?? false;
      setScrollTop(nextScrollTop);
      if (!listOwnsFocus) return;

      const nextFocusedIndex = getFixedRovingIndex({
        preferredIndex: focusedIndexRef.current,
        itemCount: nodes.length,
        scrollTop: nextScrollTop,
        rowHeight: ACCESSIBILITY_ROW_HEIGHT,
        viewportHeight: ACCESSIBILITY_VIEWPORT_HEIGHT,
      });
      if (nextFocusedIndex < 0 || nextFocusedIndex === focusedIndexRef.current) return;
      focusedIndexRef.current = nextFocusedIndex;
      pendingFocusRef.current = nextFocusedIndex;
      setFocusedIndex(nextFocusedIndex);
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const nextFocusedIndex = getFixedNavigationIndex(
      event.key,
      focusedIndexRef.current,
      nodes.length,
      Math.floor(ACCESSIBILITY_VIEWPORT_HEIGHT / ACCESSIBILITY_ROW_HEIGHT),
    );
    if (nextFocusedIndex === null) return;

    event.preventDefault();
    const nextScrollTop = getFixedScrollTopForIndex({
      index: nextFocusedIndex,
      itemCount: nodes.length,
      scrollTop,
      rowHeight: ACCESSIBILITY_ROW_HEIGHT,
      viewportHeight: ACCESSIBILITY_VIEWPORT_HEIGHT,
    });
    if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current);
    scrollFrameRef.current = null;
    pendingScrollTopRef.current = nextScrollTop;
    pendingFocusRef.current = nextFocusedIndex;
    focusedIndexRef.current = nextFocusedIndex;
    setFocusedIndex(nextFocusedIndex);
    setScrollTop(nextScrollTop);
    if (containerRef.current) containerRef.current.scrollTop = nextScrollTop;
  };

  return (
    <div
      ref={containerRef}
      className="ax-list"
      role="list"
      aria-label="Accessibility nodes"
      tabIndex={nodes.length === 0 ? 0 : -1}
      onScroll={onScroll}
      onKeyDown={onKeyDown}
    >
      {nodes.length === 0 ? (
        <div className="ax-empty">No accessibility nodes yet.</div>
      ) : (
        <div className="ax-list-window" style={{ height: `${range.totalHeight}px` }}>
          {nodes.slice(range.start, range.end).map((node, offset) => {
            const index = range.start + offset;
            return (
              <div
                key={node.id}
                className="ax-node-slot"
                role="listitem"
                style={{ top: `${index * ACCESSIBILITY_ROW_HEIGHT}px` }}
                aria-posinset={index + 1}
                aria-setsize={nodes.length}
              >
                <button
                  ref={(button) => {
                    if (button) buttonRefs.current.set(index, button);
                    else buttonRefs.current.delete(index);
                  }}
                  type="button"
                  tabIndex={index === rovingIndex ? 0 : -1}
                  className={node.id === highlightedId ? "ax-node active" : "ax-node"}
                  onMouseEnter={() => onHighlight(node.id)}
                  onMouseLeave={() => onHighlight(null)}
                  onFocus={() => {
                    focusedIndexRef.current = index;
                    setFocusedIndex(index);
                    onHighlight(node.id);
                  }}
                  onBlur={() => onHighlight(null)}
                  onClick={() => void onTapNode(node)}
                  title={node.resourceId || node.packageName}
                >
                  <span>{nodeLabel(node)}</span>
                  <code>{nodeMeta(node)}</code>
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});
