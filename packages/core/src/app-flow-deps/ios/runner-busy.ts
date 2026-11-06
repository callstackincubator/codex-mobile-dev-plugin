/**
 * The iOS runner refuses commands with RUNNER_BUSY while an abandoned main-queue block drains —
 * deliberately fast, so callers back off rather than queueing more work behind it. An accessibility
 * capture on a heavy or continuously animating screen is what blows its execution watchdog and
 * leaves that block draining, so anything that snapshots the UI hits this routinely.
 */
export const RUNNER_BUSY_RETRIES = 3
export const RUNNER_BUSY_BACKOFF_MS = [5_000, 12_000, 25_000]

export function isRunnerBusyError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /RUNNER_BUSY|still finishing a previous command/i.test(message)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export interface RunnerBusyRetryOptions {
  /** Called before each backoff wait, for progress logging. */
  onRetry?: (attempt: number, waitMs: number) => void
  signal?: AbortSignal
  retries?: number
  /**
   * Absolute timestamp the caller stops caring about this work at. When the next backoff would not
   * leave room for the retry that follows it, the busy error is raised now instead of after a sleep
   * whose outcome is already decided.
   *
   * Without this the schedule cannot fit its own budget: the waits total 42s (5 + 12 + 25) and the
   * hottest caller is `waitForAppReady`, which runs on a 30s route-settle deadline. A device log
   * shows the result on every deep link — three retries announced, then "still loading after 30s,
   * capturing anyway". The third was never survivable; it only spent wall clock the walk still
   * needed. Absolute rather than a duration because `work` is re-run whole and each attempt's own
   * runtime has to count against the same budget.
   */
  deadlineAt?: number
}

/**
 * Runs `work`, retrying with escalating backoff while the runner reports itself busy. `work` must
 * be idempotent — it is re-run whole. The waits also give the runner's daemon time to recycle a
 * wedged runner. Any other error, and a busy error past the last attempt, propagates unchanged.
 *
 * With `deadlineAt`, a backoff that would not leave room for the attempt after it is skipped and
 * the busy error propagates immediately — see that option.
 */
export async function retryWhileRunnerBusy<T>(
  work: () => Promise<T>,
  options: RunnerBusyRetryOptions = {}
): Promise<T> {
  const retries = options.retries ?? RUNNER_BUSY_RETRIES
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await work()
    } catch (error) {
      if (!isRunnerBusyError(error) || attempt >= retries) throw error
      const waitMs = RUNNER_BUSY_BACKOFF_MS[Math.min(attempt, RUNNER_BUSY_BACKOFF_MS.length - 1)]
      // Strictly greater: a wait that exactly consumes the budget leaves nothing to retry into.
      if (options.deadlineAt !== undefined && waitMs >= options.deadlineAt - Date.now()) throw error
      options.onRetry?.(attempt + 1, waitMs)
      await sleep(waitMs)
      if (options.signal?.aborted) throw new Error('Cancelled')
    }
  }
}
