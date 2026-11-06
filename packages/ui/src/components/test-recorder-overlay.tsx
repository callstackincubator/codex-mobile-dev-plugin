import { useSyncExternalStore } from "react";
import type { ScreenAnnotationsStore } from "../screen-annotations";
import { testRecorder } from "../test-recorder";

/**
 * The outline over the mirror while the Testing panel records: the element a tap would name, and
 * the step it would add.
 *
 * It borrows the annotation store's viewport — the canvas rectangle inside the stage, which the
 * simulator panel keeps current through every resize and bezel change — rather than measuring the
 * canvas again. The bounds themselves come from the recorder, in the same screen space it resolved
 * them in, so the outline cannot drift from what gets recorded.
 */
export function TestRecorderOverlay({ store }: { store: ScreenAnnotationsStore }) {
  const { viewport: v } = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const { hover } = useSyncExternalStore(testRecorder.subscribe, testRecorder.getSnapshot);
  if (!hover || !v.width || !v.height) return null;
  const { bounds, screen } = hover;
  const rect = {
    left: v.x + bounds.x / screen.width * v.width,
    top: v.y + bounds.y / screen.height * v.height,
    width: bounds.width / screen.width * v.width,
    height: bounds.height / screen.height * v.height,
  };
  // Above the outline when there is room, inside its top edge when it is against the stage top.
  const above = rect.top > v.y + 22;
  return <div className="pointer-events-none absolute inset-0 z-20" data-element="recorder-hover">
    <div className={`absolute border-2 border-solid ${hover.ambiguous ? "border-amber-500 bg-amber-500/10" : "border-blue-500 bg-blue-500/10"}`} style={rect} />
    <span
      className={`absolute max-w-[min(18rem,100%)] truncate rounded px-1.5 py-0.5 text-[10px] font-medium text-white shadow-sm ${hover.ambiguous ? "bg-amber-600" : "bg-blue-600"}`}
      style={{ left: Math.max(4, Math.min(rect.left, v.stageWidth - 16)), top: Math.max(2, above ? rect.top - 20 : rect.top + 2) }}
    >{hover.label}</span>
  </div>;
}
