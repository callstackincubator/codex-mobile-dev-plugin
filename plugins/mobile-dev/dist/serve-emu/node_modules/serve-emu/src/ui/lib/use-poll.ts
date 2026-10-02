import { useCallback, useEffect, useRef } from "react";
import {
  bindPollVisibility,
  createPollController,
  shouldApplyPollResult,
  type PollContext,
  type VisibilitySource,
} from "./polling";

type UsePollOptions<Result, Key> = {
  poll: (context: PollContext<Key>) => Promise<Result>;
  onResult: (result: Result, context: PollContext<Key>) => void;
  onError?: (error: unknown, context: PollContext<Key>) => void;
  intervalMs: number | null;
  pollKey: Key;
  enabled?: boolean;
  pauseWhenHidden?: boolean;
};

/** Completion-based polling with abortable lifecycle and stale-result guards. */
export function usePoll<Result, Key>({
  poll,
  onResult,
  onError,
  intervalMs,
  pollKey,
  enabled = true,
  pauseWhenHidden = true,
}: UsePollOptions<Result, Key>): { refresh: () => void } {
  const pollRef = useRef(poll);
  const onResultRef = useRef(onResult);
  const onErrorRef = useRef(onError);
  const desiredKeyRef = useRef(pollKey);
  const desiredEnabledRef = useRef(enabled);
  const controllerRef = useRef<ReturnType<typeof createPollController<Result, Key>> | null>(null);
  pollRef.current = poll;
  onResultRef.current = onResult;
  onErrorRef.current = onError;
  desiredKeyRef.current = pollKey;
  desiredEnabledRef.current = enabled;

  useEffect(() => {
    if (!controllerRef.current) {
      controllerRef.current = createPollController<Result, Key>({
        intervalMs,
        task: (context) => pollRef.current(context),
        onResult: (result, context) => {
          if (shouldApplyPollResult(desiredEnabledRef.current, desiredKeyRef.current, context.key)) {
            onResultRef.current(result, context);
          }
        },
        onError: (error, context) => {
          if (shouldApplyPollResult(desiredEnabledRef.current, desiredKeyRef.current, context.key)) {
            onErrorRef.current?.(error, context);
          }
        },
      });
    }
    const controller = controllerRef.current;

    return () => controller.stop();
  }, []);

  useEffect(() => {
    controllerRef.current?.setIntervalMs(intervalMs);
  }, [intervalMs]);

  useEffect(() => {
    const controller = controllerRef.current;
    if (!controller) return;
    const visibilitySource =
      pauseWhenHidden && typeof document !== "undefined"
        ? document as VisibilitySource
        : null;
    const unbindVisibility = visibilitySource
      ? bindPollVisibility(controller, visibilitySource)
      : null;
    if (!visibilitySource) controller.setVisible(true);

    return () => unbindVisibility?.();
  }, [pauseWhenHidden]);

  useEffect(() => {
    const controller = controllerRef.current;
    if (!controller) return;
    if (enabled) controller.restart(pollKey);
    else controller.stop();
  }, [enabled, pollKey]);

  const refresh = useCallback(() => controllerRef.current?.refresh(), []);
  return { refresh };
}
