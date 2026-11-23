import { resolveComponentSelector, selectorSource } from "@mobile-dev/shared/test-recording.ts";
import type { ScreenComponent, ScreenSize } from "@mobile-dev/shared/screen-annotations.ts";
import type { TestRunResult, TestRunStep } from "./testing-run.ts";

/**
 * What an agent needs to repair a failed lane without another round trip: the line that failed,
 * what the runner said, and the device's own screen as compact rows with the locator each one
 * would be written with. Attached to the lane, so `run_test` and `run_progress` both carry it.
 */
export interface LaneFailure {
  /** The 1-based line in the test file, or 0 when the failure has no line of its own (`app.open`, a crash). */
  line: number;
  /** That line's text, trimmed. */
  source: string;
  error: string;
  /** One row per element on the device's screen, at most `MAX_FAILURE_ELEMENTS`, each ending in its locator. */
  elements?: string[];
  /** How many elements the read had beyond those listed. */
  omitted?: number;
  /** Why no element list is attached, e.g. the device could not be read. */
  elementsError?: string;
}

export const MAX_FAILURE_ELEMENTS = 60;

const PASSING = new Set(["passed", "skipped", "unknown", ""]);

/** The first step that failed: one with an error, else one whose status is not a passing one. */
export function failedStep(steps: readonly TestRunStep[]): TestRunStep | undefined {
  return steps.find(step => step.error) ?? steps.find(step => !PASSING.has(step.status));
}

/** The failure of a finished run, or undefined when it passed. `source` is the text of the file that ran. */
export function describeFailure(result: TestRunResult, source: string): LaneFailure | undefined {
  if (result.status === "passed") return undefined;
  const step = failedStep(result.steps);
  const text = step ? source.split("\n")[step.line - 1]?.trim() ?? step.label : "";
  const error = step?.error ?? result.error ?? result.output?.trim().slice(-600) ?? `The run ${result.status}.`;
  return { line: step?.line ?? 0, source: text, error };
}

/** `role "name" · text "…" · placeholder · testId → screen.getBy…`, one element per row, offscreen ones flagged. */
export function compactElements(tree: readonly ScreenComponent[], screen?: ScreenSize, limit = MAX_FAILURE_ELEMENTS): { elements: string[]; omitted: number } {
  const all = [...tree];
  const named = all.flatMap(component => {
    const resolved = resolveComponentSelector(all, component, screen);
    if (!resolved) return [];
    const parts = [
      component.role ?? "element",
      component.label ? `"${component.label}"` : "",
      component.text && component.text !== component.label ? `text "${component.text}"` : "",
      component.placeholder ? `placeholder "${component.placeholder}"` : "",
      component.value ? `value "${component.value}"` : "",
      component.disabled ? "disabled" : "",
      component.hidden ? "offscreen" : "",
    ].filter(Boolean);
    return [`${parts.join(" ")} → ${selectorSource(resolved.selector)}${resolved.ambiguous ? " (not unique)" : ""}`];
  });
  return { elements: named.slice(0, limit), omitted: Math.max(0, named.length - limit) };
}
