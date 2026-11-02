import type { Gesture } from "./input.ts";
import type { GeoFix } from "./location.ts";
import {
  SessionReplayConflictError,
  type ReplayHandlers,
} from "./session-recorder.ts";

type SessionReplayHandlersOpts = {
  generation: number;
  getGeneration: () => number;
  dispatchGesture: (
    gesture: Gesture,
    signal: AbortSignal,
  ) => Promise<void> | void;
  setLocation: (fix: GeoFix, signal: AbortSignal) => Promise<void> | void;
};

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("session replay cancelled", "AbortError");
}

export function createSessionReplayHandlers(
  opts: SessionReplayHandlersOpts,
): ReplayHandlers {
  const assertCurrent = (signal: AbortSignal) => {
    if (signal.aborted) throw abortReason(signal);
    if (opts.generation !== opts.getGeneration()) {
      throw new SessionReplayConflictError(
        "device session changed during session replay",
      );
    }
  };

  return {
    dispatchGesture: async (gesture, signal) => {
      assertCurrent(signal);
      await opts.dispatchGesture(gesture, signal);
      assertCurrent(signal);
    },
    setLocation: async (fix, signal) => {
      assertCurrent(signal);
      await opts.setLocation(fix, signal);
      assertCurrent(signal);
    },
  };
}
