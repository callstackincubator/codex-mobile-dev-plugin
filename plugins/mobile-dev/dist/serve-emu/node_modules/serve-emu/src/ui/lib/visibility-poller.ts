export type VisibilityPollerClock<Handle> = {
  setTimeout(callback: () => void, delayMs: number): Handle;
  clearTimeout(handle: Handle): void;
};

export type VisibilityPollerOptions<T, Handle> = {
  intervalMs: number;
  poll(signal: AbortSignal): Promise<T>;
  onResult(value: T): void;
  onError?(error: unknown): void;
  clock: VisibilityPollerClock<Handle>;
};

const browserClock: VisibilityPollerClock<number> = {
  setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
  clearTimeout: (handle) => window.clearTimeout(handle),
};

/**
 * Runs one abortable poll at a time while active. A generation token prevents a
 * request that ignores abort from publishing after the poller is hidden,
 * restarted, invalidated, or disposed.
 */
export class VisibilityPoller<T, Handle = number> {
  readonly #intervalMs: number;
  readonly #poll: (signal: AbortSignal) => Promise<T>;
  readonly #onResult: (value: T) => void;
  readonly #onError?: (error: unknown) => void;
  readonly #clock: VisibilityPollerClock<Handle>;

  #active = false;
  #disposed = false;
  #inFlight = false;
  #runAfterFlight = false;
  #generation = 0;
  #timer: Handle | null = null;
  #controller: AbortController | null = null;

  constructor(options: VisibilityPollerOptions<T, Handle>);
  constructor(
    options: Omit<VisibilityPollerOptions<T, number>, "clock"> & {
      clock?: VisibilityPollerClock<number>;
    },
  );
  constructor(
    options:
      | VisibilityPollerOptions<T, Handle>
      | (Omit<VisibilityPollerOptions<T, number>, "clock"> & {
          clock?: VisibilityPollerClock<number>;
        }),
  ) {
    if (!Number.isSafeInteger(options.intervalMs) || options.intervalMs < 1) {
      throw new RangeError("intervalMs must be a positive safe integer");
    }
    this.#intervalMs = options.intervalMs;
    this.#poll = options.poll;
    this.#onResult = options.onResult;
    this.#onError = options.onError;
    this.#clock = (options.clock ?? browserClock) as VisibilityPollerClock<Handle>;
  }

  setActive(active: boolean): void {
    if (this.#disposed || this.#active === active) return;
    this.#active = active;
    this.#clearTimer();

    if (!active) {
      this.#generation++;
      this.#runAfterFlight = false;
      this.#controller?.abort();
      return;
    }

    if (this.#inFlight) {
      this.#runAfterFlight = true;
    } else {
      this.#run();
    }
  }

  /** Discards and aborts the current result without changing visibility. */
  invalidate(): void {
    if (this.#disposed) return;
    this.#generation++;
    this.#runAfterFlight = false;
    this.#clearTimer();
    this.#controller?.abort();
  }

  /** Requests an immediate poll if active, still preserving single flight. */
  pollNow(): void {
    if (this.#disposed || !this.#active) return;
    this.#clearTimer();
    if (this.#inFlight) {
      this.#runAfterFlight = true;
    } else {
      this.#run();
    }
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#active = false;
    this.#generation++;
    this.#runAfterFlight = false;
    this.#clearTimer();
    this.#controller?.abort();
  }

  #run(): void {
    if (this.#disposed || !this.#active || this.#inFlight) return;
    this.#inFlight = true;
    this.#runAfterFlight = false;
    const generation = ++this.#generation;
    const controller = new AbortController();
    this.#controller = controller;

    let request: Promise<T>;
    try {
      request = this.#poll(controller.signal);
    } catch (error) {
      request = Promise.reject(error);
    }

    void request
      .then((value) => {
        if (
          !this.#disposed &&
          this.#active &&
          !controller.signal.aborted &&
          generation === this.#generation
        ) {
          this.#onResult(value);
        }
      })
      .catch((error) => {
        if (
          !this.#disposed &&
          this.#active &&
          !controller.signal.aborted &&
          generation === this.#generation
        ) {
          this.#onError?.(error);
        }
      })
      .finally(() => {
        if (this.#controller === controller) this.#controller = null;
        this.#inFlight = false;
        if (this.#disposed || !this.#active) return;
        if (this.#runAfterFlight) {
          this.#run();
        } else {
          this.#timer = this.#clock.setTimeout(
            () => {
              this.#timer = null;
              this.#run();
            },
            this.#intervalMs,
          );
        }
      });
  }

  #clearTimer(): void {
    if (this.#timer === null) return;
    this.#clock.clearTimeout(this.#timer);
    this.#timer = null;
  }
}
