import { useCallback, useLayoutEffect, useRef, type MouseEvent, type RefObject } from 'react';
import { TIMELINE_EXTENSION_PERCENT } from './constants';
import type { ZoomState } from './types';
import { formatTime } from './utils';

export function useCursorTracking(containerRef: RefObject<HTMLDivElement | null>, offsetX: number, zoomState: ZoomState) {
  const cursorLabel = useRef<HTMLSpanElement>(null);
  const position = useRef<number | null>(null);
  const { left, right } = zoomState;
  const update = useCallback((x: number | null, width: number) => {
    const container = containerRef.current;
    if (container === null) return;
    position.current = x;
    if (x === null || width <= 0) {
      container.style.setProperty('--performance-cursor-opacity', '0');
      return;
    }
    const extendedRight = right + (right - left) * TIMELINE_EXTENSION_PERCENT;
    const time = left + x / width * (extendedRight - left);
    const label = formatTime(time);
    if (cursorLabel.current) cursorLabel.current.textContent = label;
    container.style.setProperty('--performance-cursor-x', `${x}px`);
    container.style.setProperty('--performance-cursor-opacity', '1');
  }, [containerRef, left, right]);
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    const refresh = () => {
      const rect = container.getBoundingClientRect();
      const width = rect.width - offsetX;
      const x = position.current;
      update(x !== null && x <= width ? x : null, width);
    };
    refresh();
    const observer = new ResizeObserver(refresh);
    observer.observe(container);
    return () => observer.disconnect();
  }, [containerRef, offsetX, update]);
  const handleMouseMove = useCallback((event: MouseEvent) => {
    const container = containerRef.current;
    if (container === null) return;
    const rect = container.getBoundingClientRect();
    const x = event.clientX - rect.left - offsetX;
    const width = rect.width - offsetX;
    update(x >= 0 && x <= width ? x : null, width);
  }, [containerRef, offsetX, update]);
  const handleMouseLeave = useCallback(() => { update(null, 0); }, [update]);
  return { cursorLabel, handleMouseMove, handleMouseLeave };
}
