/**
 * A write that may be delayed but must never be lost — the sweep's crash-resume checkpoint.
 *
 * `writeSweepProgress` serialises the whole capture map (~38KB on the reference app) and used to
 * run unthrottled on every screen *and* on every opportunistic sighting, chrome detection and
 * runtime-node mint. The live document publisher next door was throttled for exactly this reason;
 * the checkpoint never was.
 *
 * Two bounds, and a rule:
 *
 * - A **revision counter**. `mark` says something changed; a write that finds nothing new since
 *   the last one does nothing at all. This is what makes a redundant flush free, and what makes a
 *   trailing write racing a forced one harmless.
 * - A **coalescing window**. A `mark` inside the window does not write; it schedules a trailing
 *   write that carries it and everything that joins it. A burst costs one write.
 * - **Force always writes if anything is pending.** Crash-resume is the entire point of the file,
 *   so every durable path — stopped, finished, cancelled, failed, and the sweep's `finally` —
 *   calls `flush`, and the window can therefore only ever delay a write a still-running sweep was
 *   going to supersede. The worst case a kill can hit is one window's worth of work, and the
 *   resume logic re-explores that node rather than losing it.
 *
 * Pure except for the `write` and the timer it is handed, so the discipline above is testable
 * without a device, a project directory or 38KB of JSON.
 */
export interface CoalescedWriter {
  /** Something changed. Writes now, or schedules a trailing write inside the window. */
  mark(): Promise<void>
  /** Write immediately if anything is pending, cancelling any scheduled trailing write. */
  flush(): Promise<void>
  /** Writes actually issued — diagnostic; nothing branches on it. */
  readonly writes: number
}

export function createCoalescedWriter(options: {
  write: () => Promise<void>
  windowMs: number
  now: () => number
  /** Reported rather than thrown: a trailing write has no caller left to reject to. */
  onError?: (error: unknown) => void
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
}): CoalescedWriter {
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
  const clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as never))
  let revision = 0
  let saved = 0
  let lastWriteAt = -Infinity
  let timer: unknown = null
  let writes = 0

  const writeNow = async (): Promise<void> => {
    const pending = revision
    if (saved >= pending) return
    saved = pending
    lastWriteAt = options.now()
    writes += 1
    await options.write()
  }

  const flush = async (): Promise<void> => {
    if (timer !== null) {
      clearTimer(timer)
      timer = null
    }
    await writeNow()
  }

  return {
    get writes() {
      return writes
    },
    async mark(): Promise<void> {
      revision += 1
      if (options.now() - lastWriteAt < options.windowMs) {
        if (timer === null) {
          timer = setTimer(() => {
            timer = null
            void writeNow().catch((error: unknown) => options.onError?.(error))
          }, options.windowMs)
          ;(timer as { unref?: () => void })?.unref?.()
        }
        return
      }
      await flush()
    },
    flush
  }
}
