import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type UIEvent } from "react";
import type { CpuSample } from "../../shared/cpu";
import { CHART_RIGHT_PADDING, LIVE_VIEW_DURATION, SIDEBAR_WIDTH } from "./constants";
import type { ZoomState } from "./types";

export function useTimelineViewport(samples: CpuSample[], scrollElement: HTMLDivElement | null) {
  const first = samples[0];
  const last = samples.at(-1);
  const left = first?.time ?? 0;
  const right = Math.max(last?.time ?? 0, left + LIVE_VIEW_DURATION);
  const [following, setFollowing] = useState(true);
  const [selection, setSelection] = useState<ZoomState | null>(null);
  const [viewportWidth, setViewportWidth] = useState(0);
  const scrollLeft = useRef(0);
  const previousViewport = useRef<{ left: number; pixelsPerSecond: number } | null>(null);
  const live = useMemo<ZoomState>(() => ({ left, right, viewDuration: LIVE_VIEW_DURATION, isZoomed: false,
    refAreaLeft: undefined, refAreaRight: undefined }), [left, right]);
  const zoom = selection ?? live;
  const plotWidth = Math.max(0, viewportWidth - SIDEBAR_WIDTH - CHART_RIGHT_PADDING);
  const pixelsPerSecond = plotWidth / zoom.viewDuration;
  const contentWidth = SIDEBAR_WIDTH + CHART_RIGHT_PADDING + (zoom.right - zoom.left) * pixelsPerSecond;

  const reset = useCallback(() => {
    setSelection(null);
    setFollowing(true);
  }, []);
  const change = useCallback((next: ZoomState) => {
    setFollowing(false);
    setSelection(next);
  }, []);

  useLayoutEffect(() => {
    if (scrollElement === null) return;
    const measure = () => setViewportWidth(scrollElement.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(scrollElement);
    return () => observer.disconnect();
  }, [scrollElement]);

  useLayoutEffect(() => {
    if (scrollElement === null) return;
    const previous = previousViewport.current;
    let offset = scrollElement.scrollLeft;
    if (following) offset = contentWidth - scrollElement.clientWidth;
    else if (previous && previous.pixelsPerSecond > 0) {
      const time = previous.left + scrollLeft.current / previous.pixelsPerSecond;
      offset = (time - zoom.left) * pixelsPerSecond;
    }
    scrollElement.scrollLeft = Math.max(0, offset);
    scrollLeft.current = scrollElement.scrollLeft;
    previousViewport.current = { left: zoom.left, pixelsPerSecond };
  }, [scrollElement, following, contentWidth, pixelsPerSecond, zoom.left]);

  useEffect(() => {
    if (selection && selection.right < left) reset();
  }, [selection, left, reset]);

  const handleScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    const element = event.currentTarget;
    const offset = element.scrollLeft;
    if (Math.abs(offset - scrollLeft.current) < 1) return;
    scrollLeft.current = offset;
    const maximum = element.scrollWidth - element.clientWidth;
    setFollowing(selection === null && offset >= maximum - 1);
  }, [selection]);

  return { zoom, following, contentWidth, reset, change, handleScroll };
}
