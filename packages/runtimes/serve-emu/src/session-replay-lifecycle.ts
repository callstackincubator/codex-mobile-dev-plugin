import type { SessionRecorder } from "./session-recorder.ts";

type ReplayLifecycleOpts<T> = {
  recorder: Pick<SessionRecorder, "dispose">;
  stopRoute: () => void;
  afterReplayStopped: () => T | Promise<T>;
};

export async function disposeReplayBefore<T>(
  opts: ReplayLifecycleOpts<T>,
): Promise<T> {
  opts.stopRoute();
  await opts.recorder.dispose();
  return opts.afterReplayStopped();
}
