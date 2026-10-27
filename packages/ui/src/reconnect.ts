export class StopReconnectError extends Error {}

export class ReconnectLoop {
  private controller?: AbortController;
  private failures = 0;
  private readonly delays: readonly number[];

  constructor(delays: readonly number[] = [500, 1000, 2000, 5000, 10000]) { this.delays = delays; }

  get active(): boolean { return this.controller != null; }
  connected() { this.failures = 0; }
  stop() { this.controller?.abort(); this.controller = undefined; }

  start(work: (signal: AbortSignal) => Promise<void>, retry: (error: unknown) => void, stopped: (error: unknown) => void) {
    this.stop();
    const controller = new AbortController();
    this.controller = controller;
    this.failures = 0;
    void this.run(controller, work, retry, stopped);
  }

  private async run(controller: AbortController, work: (signal: AbortSignal) => Promise<void>, retry: (error: unknown) => void, stopped: (error: unknown) => void) {
    const signal = controller.signal;
    while (!signal.aborted) {
      try { await work(signal); break; }
      catch (error) {
        if (signal.aborted) return;
        if (error instanceof StopReconnectError) {
          if (this.controller === controller) this.controller = undefined;
          stopped(error);
          return;
        }
        retry(error);
        const delay = this.delays[Math.min(this.failures++, this.delays.length - 1)] ?? 10000;
        await new Promise<void>(resolve => {
          const done = () => { clearTimeout(timer); signal.removeEventListener("abort", done); resolve(); };
          const timer = setTimeout(done, delay);
          signal.addEventListener("abort", done, { once: true });
          if (signal.aborted) done();
        });
      }
    }
    if (this.controller === controller) this.controller = undefined;
  }
}
