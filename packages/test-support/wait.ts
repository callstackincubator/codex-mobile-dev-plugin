import { setTimeout } from "node:timers/promises";

export type WaitOptions = {
  /** Milliseconds before giving up. Defaults to 2000. */
  timeout?: number;
  /** Milliseconds between checks. Defaults to 5. */
  interval?: number;
  /** The failure message, naming the state that was not reached. */
  message?: string;
};

/** Checks `predicate` until it holds, and fails once `timeout` passes without it holding. */
export async function waitFor(predicate: () => boolean | Promise<boolean>, { timeout = 2000, interval = 5, message = "The expected state was not reached" }: WaitOptions = {}) {
  const deadline = Date.now() + timeout;
  while (!await predicate()) {
    if (Date.now() >= deadline) throw new Error(`${message} within ${timeout} ms.`);
    await setTimeout(interval);
  }
}
