/**
 * Re-issues a stalled model call instead of waiting it out.
 *
 * Measured across two instrumented sweeps, this backend's latency for these calls is tail-dominated
 * rather than slow on average: the arrival judge's p50 is 2.1s and its p90 is 8.7s, but single calls
 * reached 16.6s and 24.9s. The giveaway is what those calls returned — 165 and 130 output tokens,
 * against a p50 call's ~140. They were not deliberating and they were not generating; they were
 * waiting. Four such calls across one 39-call sweep cost ~81s, about 16% of the run's wall clock,
 * and produced nothing a fast call would not have produced.
 *
 * A retry cannot recover that, because a retry needs the first attempt to fail and these attempts
 * succeed — eventually. The only thing that converts "eventually" into p50 is a second attempt
 * racing the first, which is what this does: start one, and if it has not answered within
 * `afterMs`, start another and take whichever finishes first.
 *
 * Safe only for a call that can be run twice with no consequence. `runAgent`'s one-shot, `tools: []`
 * judges qualify: one system prompt, one image, no tools, no session history, and a JSON verdict as
 * the entire result. Session-backed calls do not, and the caller is where that line is drawn — see
 * the guard at this module's one call site. Nothing here can check it.
 */

export interface HedgeOutcome<T> {
  result: T
  /** Attempts started, so a caller can bill the ones it did not use. 1 when no hedge fired. */
  attempts: number
  /** Which attempt produced `result`, zero-based. 1 means the hedge won. */
  winner: number
}

/**
 * Runs `attempt(0)`, and if it has not settled within `afterMs`, runs `attempt(1)` alongside it and
 * returns whichever fulfils first.
 *
 * `afterMs` of `Infinity` (or anything non-positive) disables hedging, which is how a caller turns
 * this off without branching around it.
 *
 * A rejection does not end the race while the other attempt is still running. The whole premise is
 * that one of these calls can be having a bad time independently of the other, and a hedge that
 * surfaced the first error would throw away a good answer that was seconds away. Only when both
 * have rejected does this reject, and with attempt 0's error: that is the call the caller actually
 * asked for, and its failure is the one that describes the real problem rather than the duplicate's.
 */
export async function hedge<T>(options: {
  attempt: (index: number) => Promise<T>
  afterMs: number
  /** Called when the hedge is issued, for logging. Never called when the first attempt wins. */
  onHedge?: () => void
}): Promise<HedgeOutcome<T>> {
  const first = options.attempt(0)
  if (!(options.afterMs > 0) || !Number.isFinite(options.afterMs)) {
    return { result: await first, attempts: 1, winner: 0 }
  }

  // Tagged so the race can tell a fulfilment from the timer firing without a sentinel value that a
  // generic `T` could legitimately be.
  const tagged = (promise: Promise<T>, index: number): Promise<{ index: number; result: T }> =>
    promise.then((result) => ({ index, result }))

  let timer: ReturnType<typeof setTimeout> | undefined
  const elapsed = new Promise<'elapsed'>((resolve) => {
    timer = setTimeout(() => resolve('elapsed'), options.afterMs)
  })

  // A rejection here is the first attempt failing before the timer fired, and it propagates: there
  // is no race left to run and no reason to pay for a duplicate, because a call that fails this
  // fast is failing for a reason a second identical call will hit too. Only an *elapsed* timer
  // means the attempt is still in flight and worth racing.
  let firstOrTimer: { index: number; result: T } | 'elapsed'
  try {
    firstOrTimer = await Promise.race([tagged(first, 0), elapsed])
  } finally {
    clearTimeout(timer)
  }
  if (firstOrTimer !== 'elapsed') {
    return { result: firstOrTimer.result, attempts: 1, winner: 0 }
  }

  options.onHedge?.()
  const second = options.attempt(1)
  // Attached before the race so that whichever promise loses cannot surface as an unhandled
  // rejection after this function has already returned the winner's answer.
  const settled = [tagged(first, 0), tagged(second, 1)].map((promise) =>
    promise.then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error })
    )
  )

  const firstSettled = await Promise.race(settled)
  if (firstSettled.ok) {
    return { result: firstSettled.value.result, attempts: 2, winner: firstSettled.value.index }
  }
  // One side has failed; the other is still the caller's best chance of an answer.
  const both = await Promise.all(settled)
  const won = both.find((outcome) => outcome.ok)
  if (won?.ok) return { result: won.value.result, attempts: 2, winner: won.value.index }
  throw both[0].ok ? new Error('Hedged call failed') : both[0].error
}
