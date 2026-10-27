import { useCallback, useLayoutEffect, useRef, type MouseEvent, type RefObject } from 'react';
import { CHART_RIGHT_PADDING } from './constants';
import type { ZoomState } from './types';
import { formatTime } from './utils';

export function useCursorTracking(containerRef: RefObject<HTMLDivElement | null>, scrollElement: HTMLDivElement | null, offsetX: number, zoomState: ZoomState) {
  const cursorLabel = useRef<HTMLSpanElement>(null);
  const position = useRef<number | null>(null);
  const { left, right } = zoomState;
  const update = useCallback((x: number | null, width: number) => {
    const container = containerRef.current;
    if (container === null) return;
    if (x === null || width <= 0) {
      container.style.setProperty('--performance-cursor-opacity', '0');
      return;
    }
    const time = left + x / width * (right - left);
    const label = formatTime(time);
    if (cursorLabel.current) cursorLabel.current.textContent = label;
    container.style.setProperty('--performance-cursor-x', `${x}px`);
    container.style.setProperty('--performance-cursor-opacity', '1');
  }, [containerRef, left, right]);
  const refresh = useCallback(() => {
    const container = containerRef.current;
    if (container === null || scrollElement === null) return;
    const rect = container.getBoundingClientRect();
    const viewport = scrollElement.getBoundingClientRect();
    const width = rect.width - offsetX - CHART_RIGHT_PADDING;
    const clientX = position.current;
    let x: number | null = null;
    if (clientX !== null && clientX >= viewport.left + offsetX && clientX <= viewport.left + scrollElement.clientWidth) {
      x = clientX - rect.left - offsetX;
      if (x > width) x = null;
    }
    update(x, width);
  }, [containerRef, scrollElement, offsetX, update]);
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (container === null || scrollElement === null) return;
    refresh();
    const observer = new ResizeObserver(refresh);
    observer.observe(container);
    observer.observe(scrollElement);
    scrollElement.addEventListener('scroll', refresh);
    return () => {
      observer.disconnect();
      scrollElement.removeEventListener('scroll', refresh);
    };
  }, [containerRef, scrollElement, refresh]);
  const handleMouseMove = useCallback((event: MouseEvent) => {
    position.current = event.clientX;
    refresh();
  }, [refresh]);
  const handleMouseLeave = useCallback(() => {
    position.current = null;
    update(null, 0);
  }, [update]);
  return { cursorLabel, handleMouseMove, handleMouseLeave };
}
