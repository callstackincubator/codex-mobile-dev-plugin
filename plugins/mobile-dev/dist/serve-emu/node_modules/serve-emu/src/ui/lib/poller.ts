export type PollScheduler = {
  setInterval(callback: () => void, intervalMs: number): unknown;
  clearInterval(handle: unknown): void;
};

const SYSTEM_SCHEDULER: PollScheduler = {
  setInterval: (callback, intervalMs) => setInterval(callback, intervalMs),
  clearInterval: (handle) =>
    clearInterval(handle as ReturnType<typeof setInterval>),
};

export function startPoller<T>(options: {
  request(signal: AbortSignal): Promise<T>;
  onValue(value: T): void;
  onError(error: unknown): void;
  intervalMs: number;
  scheduler?: PollScheduler;
}): () => void {
  const scheduler = options.scheduler ?? SYSTEM_SCHEDULER;
  let active = true;
  let current: AbortController | null = null;

  const poll = () => {
    current?.abort();
    const controller = new AbortController();
    current = controller;
    void options.request(controller.signal).then(
      (value) => {
        if (active && current === controller && !controller.signal.aborted) {
          options.onValue(value);
        }
      },
      (error) => {
        if (
          active &&
          current === controller &&
          !controller.signal.aborted
        ) {
          options.onError(error);
        }
      },
    );
  };

  poll();
  const timer = scheduler.setInterval(poll, options.intervalMs);
  return () => {
    if (!active) return;
    active = false;
    current?.abort();
    current = null;
    scheduler.clearInterval(timer);
  };
}
