/**
 * Zooming a chart that is laid out in percentages.
 *
 * A port of TraceSift's `src/app/explore/stretch-zoom.tsx`. Both charts in
 * Explore place everything they draw as a share of one element: the timeline's
 * boxes are percentages of the task's duration, the flame graph's frames
 * percentages of the subtree's time. So neither needs a measured layout to fit,
 * and neither needs one to zoom either — widening that element past its
 * scrolling parent is the whole of it, and every box inside follows for free.
 *
 * That is also why a gesture here writes to the DOM rather than to state. A
 * wheel fires far faster than a chart of a thousand boxes can re-render, and
 * the one thing a zoom control must do is keep up with the hand. React hears
 * about the zoom once the gesture settles, which is when the things that
 * genuinely need a render — the ruler, the floors on what is drawn and what is
 * labelled — catch up.
 */

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

/** The rungs the buttons jump to. The wheel lands wherever it lands. */
export const ZOOM_STEPS = [1, 2, 4, 8, 16, 32, 64];

const MIN_ZOOM = ZOOM_STEPS[0];
const MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1];

/**
 * Zoom per unit of wheel delta, as a multiplier: one notch of a mouse wheel is
 * 100 or 120 units and lands on about 1.3×, while a trackpad reports a stream
 * of small deltas that each move the chart a little. Zooming is continuous
 * rather than a walk along `ZOOM_STEPS`: stepping made the wheel feel stuck,
 * since a notch would do nothing at all and the next one would double.
 */
const WHEEL_ZOOM_RATE = 0.0026;

/** A line- or page-mode wheel reports a handful of units where a pixel-mode one reports a hundred. */
const WHEEL_LINE_UNITS = 16;

/** How long after the last wheel event the zoom is committed to React state. */
const COMMIT_MS = 120;

const clampZoom = (value: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));

/** `1×`, `2.4×`, `37×` — enough precision to see the wheel moving, not enough to jitter. */
export function formatZoom(zoom: number): string {
  return `${zoom < 10 ? Math.round(zoom * 10) / 10 : Math.round(zoom)}×`;
}

export interface StretchZoom {
  /** The committed zoom. A gesture in flight may already be past it. */
  zoom: number;
  /** The scrolling box. Carries the wheel listener. */
  viewport: RefObject<HTMLDivElement | null>;
  /** The element that is stretched. Its width is `zoom * 100%`. */
  canvas: RefObject<HTMLDivElement | null>;
  /** The live `4.8×` readout, written to directly during a gesture. */
  readout: RefObject<HTMLSpanElement | null>;
  /** Go to a zoom outright, as the buttons do. */
  jumpTo: (zoom: number) => void;
  /** Put the view back at the left edge, for when what it held has been re-laid out. */
  scrollToStart: () => void;
}

export function useStretchZoom(): StretchZoom {
  const [zoom, setZoom] = useState(1);
  const liveZoom = useRef(1);
  const viewport = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const readout = useRef<HTMLSpanElement>(null);
  const commit = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Where a gesture has got to, and the frame on which it will be drawn. A
  // trackpad fires several wheel events between two frames and each one would
  // otherwise resize the canvas on its own, relaying out every box for a
  // picture nobody ever sees.
  const pending = useRef<{ zoom: number; pivot: number } | null>(null);
  const frame = useRef<number | null>(null);

  /**
   * Stretch the canvas to `next`, holding whatever sits `pivot` pixels into the
   * view where it is. Zooming towards the left edge is the one thing that makes
   * a zoom control useless on a chart: the box being examined slides out of the
   * view.
   */
  const applyZoom = useCallback((next: number, pivot: number) => {
    const el = viewport.current;
    const scale = canvas.current;
    if (!el || !scale || el.clientWidth <= 0) return;
    const at = (el.scrollLeft + pivot) / (el.clientWidth * liveZoom.current);
    liveZoom.current = next;
    scale.style.width = `${next * 100}%`;
    el.scrollLeft = Math.max(0, at * el.clientWidth * next - pivot);
    if (readout.current) readout.current.textContent = formatZoom(next);
  }, []);

  /** Coalesce a burst of wheel events into one resize on the next frame. */
  const scheduleZoom = useCallback((next: number, pivot: number) => {
    pending.current = { zoom: next, pivot };
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const queued = pending.current;
      pending.current = null;
      if (queued) applyZoom(queued.zoom, queued.pivot);
    });
  }, [applyZoom]);

  const jumpTo = useCallback((next: number) => {
    const el = viewport.current;
    // A button names a zoom outright, so it supersedes anything a gesture had
    // queued, commits at once, and pivots on the middle of the view, there
    // being no pointer to pivot on.
    pending.current = null;
    applyZoom(next, el ? el.clientWidth / 2 : 0);
    if (commit.current) clearTimeout(commit.current);
    commit.current = null;
    setZoom(next);
  }, [applyZoom]);

  const scrollToStart = useCallback(() => {
    if (viewport.current) viewport.current.scrollLeft = 0;
  }, []);

  // Modifier-wheel is how every other profiler zooms a chart, and it cannot be
  // an `onWheel` prop: React attaches those passively, and a passive listener
  // may not call `preventDefault`, so the surface around us would zoom instead.
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const delta = event.deltaY * (event.deltaMode === 0 ? 1 : WHEEL_LINE_UNITS);
      const from = pending.current?.zoom ?? liveZoom.current;
      const next = clampZoom(from * Math.exp(-delta * WHEEL_ZOOM_RATE));
      if (next === from) return;
      // Zoom about the pointer rather than the centre: the reader is already
      // pointing at the part they want bigger.
      scheduleZoom(next, event.clientX - el.getBoundingClientRect().left);
      if (commit.current) clearTimeout(commit.current);
      commit.current = setTimeout(() => {
        commit.current = null;
        setZoom(next);
      }, COMMIT_MS);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      if (commit.current) clearTimeout(commit.current);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, [scheduleZoom]);

  return { zoom, viewport, canvas, readout, jumpTo, scrollToStart };
}

/** The ladder, plus where a gesture actually landed. */
export function ZoomControls({ zoom, jumpTo, readout }: Pick<StretchZoom, "zoom" | "jumpTo" | "readout">) {
  return <>
    <span className="explore-path-label">zoom</span>
    {ZOOM_STEPS.map(step => <button
      key={step}
      type="button"
      className={step === zoom ? "timeline-zoom is-current" : "timeline-zoom"}
      aria-pressed={step === zoom}
      onClick={() => jumpTo(step)}
    >{step}×</button>)}
    {/* The wheel lands between the rungs, so the buttons alone cannot say where
        the view is. Written to directly during a gesture, for the same reason
        the canvas is. */}
    <span className="zoom-readout" ref={readout} aria-live="off">{formatZoom(zoom)}</span>
  </>;
}
