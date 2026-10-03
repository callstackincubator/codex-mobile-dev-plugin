import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { recordUiTiming } from '../telemetry.ts';

type Point = { x: number; y: number };
type Camera = { scale: number; left: number; top: number; started?: number };
export const clampFlowScale = (scale: number) => Math.min(1.5, Math.max(.15, scale));

function applyCamera(element: HTMLDivElement, camera: Camera) {
  element.scrollLeft = camera.left;
  element.scrollTop = camera.top;
  if (camera.started !== undefined) recordUiTiming('ui.app_flow.zoom', performance.now() - camera.started);
}

/** Keep zoom and scrolling together so a pinch stays anchored in the graph. */
export function useFlowGestures(viewport: RefObject<HTMLDivElement | null>, scale: number, onScaleChange: (scale: number) => void) {
  const rendered = useRef({ scale, onScaleChange });
  const committing = useRef<Camera | undefined>(undefined);
  useLayoutEffect(() => {
    rendered.current = { scale, onScaleChange };
    if (committing.current?.scale === scale && viewport.current) {
      // Wait for the scaled canvas size before scrolling; the old size could
      // clamp an otherwise valid anchor at the right or bottom edge.
      applyCamera(viewport.current, committing.current);
      committing.current = undefined;
    }
  });
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    let frame = 0, queued: Camera | undefined, suppressClick = false;
    let pan: { id: number; point: Point; camera: Camera } | undefined;
    let pinch: { distance: number; scale: number; world: Point } | undefined;
    const touches = new Map<number, Point>();
    const camera = (): Camera => queued ?? committing.current ?? { scale: rendered.current.scale, left: element.scrollLeft, top: element.scrollTop };
    const point = (event: MouseEvent): Point => {
      const rect = element.getBoundingClientRect();
      return { x: event.clientX - rect.left - element.clientLeft, y: event.clientY - rect.top - element.clientTop };
    };
    const schedule = (next: Camera, zoom = false) => {
      queued = { ...next, started: queued?.started ?? (zoom ? performance.now() : undefined) };
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const next = queued!;
        queued = undefined;
        if (next.scale === rendered.current.scale) applyCamera(element, next);
        else {
          committing.current = next;
          rendered.current.onScaleChange(next.scale);
        }
      });
    };
    const wheel = (event: WheelEvent) => {
      // Chromium reports a trackpad pinch as a Ctrl+wheel event. Leave normal
      // two-finger scrolling to the browser, including its momentum.
      if (!event.ctrlKey) return;
      event.preventDefault();
      const current = camera(), anchor = point(event);
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1;
      const next = clampFlowScale(current.scale * Math.exp(-event.deltaY * unit * .01));
      if (next === current.scale) return;
      schedule({ scale: next, left: (current.left + anchor.x) * next / current.scale - anchor.x, top: (current.top + anchor.y) * next / current.scale - anchor.y }, true);
    };
    const measurePinch = () => {
      const [a, b] = [...touches.values()];
      return { center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, distance: Math.hypot(a.x - b.x, a.y - b.y) };
    };
    const down = (event: PointerEvent) => {
      if (!touches.size) suppressClick = false;
      if (event.pointerType === 'touch') {
        if (touches.size === 2) return;
        touches.set(event.pointerId, point(event));
        if (touches.size === 2) {
          const { center, distance } = measurePinch(), current = camera();
          pinch = { distance: Math.max(1, distance), scale: current.scale, world: { x: (current.left + center.x) / current.scale, y: (current.top + center.y) / current.scale } };
          pan = undefined; suppressClick = true;
          for (const id of touches.keys()) element.setPointerCapture(id);
        } else pan = { id: event.pointerId, point: point(event), camera: camera() };
      } else if (event.button === 0 && !(event.target as Element).closest('button')) {
        pan = { id: event.pointerId, point: point(event), camera: camera() };
        element.setPointerCapture(event.pointerId);
      }
    };
    const move = (event: PointerEvent) => {
      if (pinch ? !touches.has(event.pointerId) : pan?.id !== event.pointerId) return;
      const position = point(event);
      if (touches.has(event.pointerId)) touches.set(event.pointerId, position);
      if (pinch && touches.size === 2) {
        const { center, distance } = measurePinch();
        const next = clampFlowScale(pinch.scale * distance / pinch.distance);
        schedule({ scale: next, left: pinch.world.x * next - center.x, top: pinch.world.y * next - center.y }, true);
      } else if (pan?.id === event.pointerId) {
        const dx = pan.point.x - position.x, dy = pan.point.y - position.y;
        if (!suppressClick && Math.hypot(dx, dy) < 4) return;
        suppressClick = true;
        element.setPointerCapture(event.pointerId);
        schedule({ ...pan.camera, left: pan.camera.left + dx, top: pan.camera.top + dy });
      }
    };
    const up = (event: PointerEvent) => {
      // Moving implicit touch capture from a card to the viewport emits a
      // bubbling loss on the card. The viewport still owns that gesture.
      if (event.type === 'lostpointercapture' && event.target !== element) return;
      touches.delete(event.pointerId);
      if (pan?.id === event.pointerId) pan = undefined;
      if (pinch && touches.size < 2) {
        pinch = undefined;
        const remaining = [...touches.entries()][0];
        if (remaining) pan = { id: remaining[0], point: remaining[1], camera: camera() };
      }
      if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
    };
    const click = (event: MouseEvent) => {
      if (suppressClick && event.detail !== 0) { event.preventDefault(); event.stopPropagation(); }
    };
    element.addEventListener('wheel', wheel, { passive: false });
    element.addEventListener('pointerdown', down);
    element.addEventListener('pointermove', move);
    element.addEventListener('pointerup', up);
    element.addEventListener('pointercancel', up);
    element.addEventListener('lostpointercapture', up);
    element.addEventListener('click', click, true);
    return () => {
      cancelAnimationFrame(frame); committing.current = undefined;
      element.removeEventListener('wheel', wheel);
      element.removeEventListener('pointerdown', down);
      element.removeEventListener('pointermove', move);
      element.removeEventListener('pointerup', up);
      element.removeEventListener('pointercancel', up);
      element.removeEventListener('lostpointercapture', up);
      element.removeEventListener('click', click, true);
      for (const id of new Set([...touches.keys(), ...(pan ? [pan.id] : [])])) if (element.hasPointerCapture(id)) element.releasePointerCapture(id);
    };
  }, [viewport]);
}
