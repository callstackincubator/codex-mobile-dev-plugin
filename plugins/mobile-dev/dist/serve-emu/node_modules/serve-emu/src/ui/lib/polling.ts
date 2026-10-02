export type PollContext<Key> = Readonly<{
  signal: AbortSignal;
  generation: number;
  key: Key;
}>;

export type PollScheduler = {
  setTimeout: (callback: () => void, delayMs: number) => unknown;
  clearTimeout: (handle: unknown) => void;
};

export type PollControllerOptions<Result, Key> = {
  task: (context: PollContext<Key>) => Promise<Result>;
  onResult: (result: Result, context: PollContext<Key>) => void;
  onError?: (error: unknown, context: PollContext<Key>) => void;
  intervalMs: number | null;
  scheduler?: PollScheduler;
};

export type PollControllerSnapshot<Key> = Readonly<{
  active: boolean;
  visible: boolean;
  running: boolean;
  scheduled: boolean;
  generation: number;
  key: Key | undefined;
}>;

export type PollController<Key> = {
  start: (key: Key) => void;
  restart: (key: Key) => void;
  refresh: () => void;
  stop: () => void;
  setVisible: (visible: boolean) => void;
  setIntervalMs: (intervalMs: number | null) => void;
  snapshot: () => PollControllerSnapshot<Key>;
};

export type VisibilitySource = {
  readonly hidden: boolean;
  addEventListener: (type: "visibilitychange", listener: () => void) => void;
  removeEventListener: (type: "visibilitychange", listener: () => void) => void;
};

const defaultScheduler: PollScheduler = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

function checkedInterval(intervalMs: number | null): number | null {
  if (intervalMs === null) return null;
  if (!Number.isFinite(intervalMs) || intervalMs < 0) {
    throw new Error("poll interval must be a finite, non-negative number or null");
  }
  return intervalMs;
}

export function shouldApplyPollResult<Key>(
  enabled: boolean,
  desiredKey: Key,
  resultKey: Key,
): boolean {
  return enabled && Object.is(desiredKey, resultKey);
}

/**
 * Runs at most one live poll per generation and schedules the next poll only
 * after the previous task settles. Restarting, hiding, or stopping aborts the
 * current generation and makes late results inert even when a task ignores its
 * AbortSignal.
 */
export function createPollController<Result, Key>(
  options: PollControllerOptions<Result, Key>,
): PollController<Key> {
  let intervalMs = checkedInterval(options.intervalMs);
  const scheduler = options.scheduler ?? defaultScheduler;
  let active = false;
  let visible = true;
  let generation = 0;
  let hasKey = false;
  let key: Key | undefined;
  let abortController: AbortController | null = null;
  let timer: unknown | null = null;

  const clearScheduled = () => {
    if (timer === null) return;
    scheduler.clearTimeout(timer);
    timer = null;
  };

  const abortRunning = () => {
    abortController?.abort();
  };

  const isCurrent = (runGeneration: number, controller: AbortController) =>
    active &&
    visible &&
    generation === runGeneration &&
    abortController === controller &&
    !controller.signal.aborted;

  const run = async () => {
    if (!active || !visible || abortController || !hasKey) return;
    const runGeneration = generation;
    const runKey = key as Key;
    const controller = new AbortController();
    abortController = controller;
    const context: PollContext<Key> = {
      signal: controller.signal,
      generation: runGeneration,
      key: runKey,
    };

    try {
      const result = await options.task(context);
      if (isCurrent(runGeneration, controller)) options.onResult(result, context);
    } catch (error) {
      if (isCurrent(runGeneration, controller)) options.onError?.(error, context);
    } finally {
      if (abortController !== controller) return;
      abortController = null;
      if (generation !== runGeneration) {
        if (active && visible) void run();
        return;
      }
      if (!active || !visible || intervalMs === null) return;
      timer = scheduler.setTimeout(() => {
        timer = null;
        void run();
      }, intervalMs);
    }
  };

  const replaceGeneration = (nextKey: Key) => {
    generation += 1;
    hasKey = true;
    key = nextKey;
    clearScheduled();
    abortRunning();
    if (active && visible && !abortController) void run();
  };

  return {
    start(nextKey) {
      active = true;
      replaceGeneration(nextKey);
    },
    restart(nextKey) {
      if (!active) {
        active = true;
      }
      replaceGeneration(nextKey);
    },
    refresh() {
      if (!active || !hasKey) return;
      replaceGeneration(key as Key);
    },
    stop() {
      if (!active && !abortController && timer === null) return;
      active = false;
      generation += 1;
      clearScheduled();
      abortRunning();
    },
    setVisible(nextVisible) {
      if (visible === nextVisible) return;
      visible = nextVisible;
      generation += 1;
      clearScheduled();
      abortRunning();
      if (active && visible && !abortController) void run();
    },
    setIntervalMs(nextIntervalMs) {
      const checked = checkedInterval(nextIntervalMs);
      if (checked === intervalMs) return;
      intervalMs = checked;
      if (timer !== null) clearScheduled();
      if (active && visible && !abortController && hasKey && intervalMs !== null) {
        timer = scheduler.setTimeout(() => {
          timer = null;
          void run();
        }, intervalMs);
      }
    },
    snapshot() {
      return {
        active,
        visible,
        running: abortController !== null,
        scheduled: timer !== null,
        generation,
        key,
      };
    },
  };
}

export function bindPollVisibility(
  controller: Pick<PollController<unknown>, "setVisible">,
  source: VisibilitySource,
): () => void {
  const sync = () => controller.setVisible(!source.hidden);
  sync();
  source.addEventListener("visibilitychange", sync);
  return () => source.removeEventListener("visibilitychange", sync);
}
