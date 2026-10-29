import { useCallback, useEffect, useRef } from "react";
import type { KeyboardEvent, PointerEvent, RefObject, TouchEvent, WheelEvent } from "react";
import type { LegendListRef } from "@legendapp/list/react";
import type { LogsPanel } from "../logs-panel.ts";

/**
 * Follows new logs until the user scrolls up. Returns capture handlers for the list's
 * container that tell the user's wheel, touch, key and scrollbar scrolling from the
 * list's own, and `stopUserScroll` for when the user turns following on or off.
 */
export function useFollowScroll(listRef: RefObject<LegendListRef | null>, panel: LogsPanel, { open, follow }: { open: boolean; follow: boolean }) {
  const userScrolling = useRef(false);
  const scrollbarDragging = useRef(false);
  const touchY = useRef<number | undefined>(undefined);
  const beginUserScroll = useCallback((up: boolean) => {
    userScrolling.current = true;
    if (up) panel.list.setFollow(false);
  }, [panel]);
  const updateScroll = useCallback(() => {
    const scroller = listRef.current?.getScrollableNode();
    if (scroller) panel.list.updateScroll(scroller.scrollTop, scroller.scrollHeight, scroller.clientHeight, userScrolling.current);
  }, [listRef, panel]);
  const endUserScroll = useCallback(() => {
    updateScroll();
    userScrolling.current = false;
    scrollbarDragging.current = false;
  }, [updateScroll]);

  useEffect(() => {
    if (follow) userScrolling.current = scrollbarDragging.current;
    if (!open) {
      userScrolling.current = false;
      scrollbarDragging.current = false;
      touchY.current = undefined;
    }
    if (follow && open) void listRef.current?.scrollToEnd({ animated: false });
  }, [listRef, follow, open]);

  const handlers = {
    onScrollCapture: updateScroll,
    onScrollEndCapture() {
      if (scrollbarDragging.current) return;
      endUserScroll();
    },
    onWheelCapture(event: WheelEvent) {
      if (event.ctrlKey || event.shiftKey || event.deltaY === 0) return;
      beginUserScroll(event.deltaY < 0);
    },
    onTouchStartCapture(event: TouchEvent) { touchY.current = event.touches[0]?.clientY; },
    onTouchMoveCapture(event: TouchEvent) {
      const nextY = event.touches[0]?.clientY;
      if (nextY !== undefined && touchY.current !== undefined && nextY !== touchY.current) beginUserScroll(nextY > touchY.current);
      touchY.current = nextY;
    },
    onTouchEndCapture() { touchY.current = undefined; },
    onTouchCancelCapture: endUserScroll,
    onKeyDownCapture(event: KeyboardEvent) {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const scroller = listRef.current?.getScrollableNode();
      const space = event.key === " " && event.target === scroller;
      const up = event.key === "ArrowUp" || event.key === "PageUp" || event.key === "Home" || (space && event.shiftKey);
      const down = event.key === "ArrowDown" || event.key === "PageDown" || event.key === "End" || (space && !event.shiftKey);
      if (up || down) beginUserScroll(up);
    },
    onPointerDownCapture(event: PointerEvent) {
      const scroller = listRef.current?.getScrollableNode();
      if (event.target !== scroller) return;
      scrollbarDragging.current = true;
      userScrolling.current = true;
    },
    onPointerUpCapture() { if (scrollbarDragging.current) endUserScroll(); },
    onPointerCancelCapture: endUserScroll,
  };
  const stopUserScroll = useCallback(() => { userScrolling.current = false; }, []);
  return { handlers, stopUserScroll };
}
