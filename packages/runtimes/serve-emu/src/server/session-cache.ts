export class SessionScopedCache<T> {
  #cached: {
    generation: number;
    expiresAt: number;
    value: T;
  } | null = null;
  #inFlight: {
    generation: number;
    promise: Promise<T>;
  } | null = null;

  constructor(
    private readonly currentGeneration: () => number,
    private readonly now: () => number,
    private readonly load: () => T | Promise<T>,
  ) {}

  get(cacheMs: number): Promise<T> {
    const generation = this.currentGeneration();
    if (
      this.#cached?.generation === generation &&
      this.#cached.expiresAt > this.now()
    ) {
      return Promise.resolve(this.#cached.value);
    }
    if (this.#inFlight?.generation === generation) {
      return this.#inFlight.promise;
    }

    let promise: Promise<T>;
    try {
      promise = Promise.resolve(this.load());
    } catch (error) {
      promise = Promise.reject(error);
    }
    promise = promise
      .then((value) => {
        if (
          this.currentGeneration() === generation &&
          this.#inFlight?.promise === promise
        ) {
          this.#cached = {
            generation,
            expiresAt: this.now() + cacheMs,
            value,
          };
        }
        return value;
      })
      .finally(() => {
        if (this.#inFlight?.promise === promise) this.#inFlight = null;
      });
    this.#inFlight = { generation, promise };
    return promise;
  }

  reset(): void {
    this.#cached = null;
    this.#inFlight = null;
  }
}
