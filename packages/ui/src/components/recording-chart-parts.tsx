import { useRef } from "react";
import type { PointerEvent } from "react";
import { ReferenceArea } from "recharts";
import type { RecordingRange } from "@mobile-dev/shared/recordings.ts";

// The plot spans the chart minus the Y axis on the left and the margin on the right.
export const CHART_Y_AXIS_WIDTH = 52;
export const CHART_RIGHT_MARGIN = 12;
export const CHAT_SELECTION_UNSUPPORTED = "This host does not support sending chart selections to chat.";

/**
 * Selects a time range by dragging across a recording chart. `onDrag` follows the
 * pointer and `onSelect` receives the final range, or undefined for a click.
 * `clampToDuration` keeps times rounded past the end within `duration`.
 */
export function useRangeDrag(duration: number, { onDrag, onSelect, onStart, clampToDuration = false }: {
  onDrag: (range?: RecordingRange) => void;
  onSelect: (range?: RecordingRange) => void;
  onStart?: () => void;
  clampToDuration?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const anchor = useRef<number | undefined>(undefined);
  function timeAt(event: PointerEvent<HTMLDivElement>) {
    const bounds = ref.current!.getBoundingClientRect();
    const fraction = (event.clientX - bounds.left - CHART_Y_AXIS_WIDTH) / Math.max(1, bounds.width - CHART_Y_AXIS_WIDTH - CHART_RIGHT_MARGIN);
    const clamped = Math.max(0, Math.min(1, fraction));
    const rounded = Math.round(clamped * duration * 10) / 10;
    return clampToDuration ? Math.min(duration, rounded) : rounded;
  }
  function selection(event: PointerEvent<HTMLDivElement>) {
    if (anchor.current === undefined) return;
    const time = timeAt(event);
    const start = Math.min(anchor.current, time);
    const end = Math.max(anchor.current, time);
    if (end > start) return { start, end };
  }
  const handlers = {
    onPointerDown(event: PointerEvent<HTMLDivElement>) {
      if (event.button !== 0) return;
      onStart?.();
      anchor.current = timeAt(event);
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerMove(event: PointerEvent<HTMLDivElement>) { if (anchor.current !== undefined) onDrag(selection(event)); },
    onPointerUp(event: PointerEvent<HTMLDivElement>) {
      if (anchor.current === undefined) return;
      const next = selection(event);
      anchor.current = undefined;
      onDrag(undefined);
      onSelect(next);
      event.currentTarget.releasePointerCapture(event.pointerId);
    },
    onPointerCancel() { anchor.current = undefined; onDrag(undefined); },
  };
  return { ref, handlers };
}

/** The selected range on a recording chart. */
export function RangeHighlight({ range }: { range?: RecordingRange }) {
  if (range === undefined) return null;
  return <ReferenceArea className="recording-range-highlight" x1={range.start} x2={range.end} fill="#2583ff" fillOpacity={0.12} stroke="#2583ff" strokeOpacity={0.5} />;
}

export function RecordingLoading({ label, error }: { label: string; error?: string }) {
  return <article className="recording-card"><p role="status">{label}</p>{error && <p role="alert">{error}</p>}</article>;
}
