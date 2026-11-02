/**
 * Where a sweep's wall clock went, measured rather than inferred.
 *
 * Token cost has been legible per call since `logAgentTokens`, and that turned out to be the
 * smaller half of the bill: one profiled run spent 124s across 37 model calls inside a seven-minute
 * sweep. The other five minutes were device work — accessibility snapshots, screenshots, URL opens,
 * boots — none of which was timed anywhere, so the only way to attribute it was to multiply a
 * hand-counted number of log lines by a latency figure written in a comment. Every conclusion drawn
 * that way is an estimate standing on another estimate, which is no basis for deciding what to
 * optimise.
 *
 * Deliberately a tally and not a tracing span tree. The question this answers is "which *kind* of
 * work owns the sweep" — reads versus screenshots versus model calls — and that needs a count and a
 * sum per kind, nothing more. Per-step attribution already exists for free once the log carries
 * elapsed stamps: differencing two consecutive lines says what happened between them, and a tally
 * is what those differences cannot give you, because most device work logs one line or none.
 *
 * It does keep each sample's *interval* rather than only its duration, because a sum of durations
 * stopped being an answer once phases began to overlap. The capture read now runs inside the
 * arrival judge's latency on purpose, so a pure tally counts those seconds twice: once as
 * `device-read` work and once as `model` work, while the sweep paid for them once. Intervals are
 * the smallest thing that can tell the two apart, and the distinction is the whole point of the
 * instrument — an optimisation that moves work off the critical path without deleting it is
 * exactly the kind this ledger exists to score, and a tally scores it as a no-op.
 */

/** A single timed sample. Half-open `[from, to)` in `Date.now()` milliseconds. */
interface Span {
  phase: Phase
  from: number
  to: number
}

/** One kind of work, summed across a sweep. */
export interface PhaseTally {
  calls: number
  /** Total work done, counting overlapping samples at full price. */
  ms: number
  /**
   * Wall clock this phase actually held — its samples merged, so time two of its own calls spent
   * running concurrently is counted once.
   *
   * Equal to `ms` for a phase whose calls never overlap each other, which is most of them; the
   * pair differs where a phase is genuinely parallel with itself. Compare `ms - clockMs` for one
   * phase, and `totalWorkMs - busyMs` across the ledger, to see how much concurrency is buying.
   */
  clockMs: number
}

/**
 * The phases worth separating. A closed union rather than free-form strings so the summary's rows
 * are stable across runs and can be compared between two sweeps — the entire point of measuring.
 *
 *  - `device-read` — `capturePressables`. The settle poll's own reads land here too, so this is
 *    both the single most-repeated device call and the one whose cost was least known.
 *  - `screenshot` — `captureScreenshot`, including its retry-while-busy waits.
 *  - `open-url` — opening a deep link or relaunching the bound app.
 *  - `boot` — `bootDevice`: simulator boot, install check and Metro startup.
 *  - `model` — every sub-agent call, mirroring what `logAgentTokens` already reports per call so
 *    the two halves of the bill appear in one table.
 *  - `replay` — `replay.run`: executing a saved `.ad` script. The sweep's main way of *driving*
 *    the app, as opposed to observing it, and the single most expensive device call there is.
 *  - `device-wait` — `command.wait` in all three of its forms: waiting for a selector to appear
 *    (the destination guards and entry gates), waiting for the UI to go quiet, and a flat
 *    duration from an explore action. Grouped because the question they answer is the same one —
 *    "is the app ready for the next instruction" — and because a run where this row is large is
 *    telling you the sweep is waiting on the app rather than on itself either way.
 *  - `press` — `interactions.press`, which carries `settle: true` and so is a wait as much as an
 *    action.
 *  - `settle-poll` — the stability poll's own interval between two reads. The sweep's *fixed*
 *    waits are deliberately absent: `wait` already prints its exact duration ("wait for route —
 *    0.8s"), so their total is readable straight off the log, and threading a ledger through every
 *    caller to re-measure a constant would buy nothing.
 */
export type Phase =
  | 'device-read'
  | 'screenshot'
  | 'open-url'
  | 'boot'
  | 'model'
  | 'settle-poll'
  | 'replay'
  | 'device-wait'
  | 'press'

const PHASE_ORDER: readonly Phase[] = [
  'model',
  'device-read',
  'replay',
  'device-wait',
  'screenshot',
  'settle-poll',
  'press',
  'open-url',
  'boot'
]

/**
 * Total length of `spans` with overlaps counted once.
 *
 * Exported because it is the only arithmetic in this module that can be wrong in a way the rows
 * would not show, and testing it through a ledger means constructing overlapping real time.
 */
export function mergedMs(spans: readonly { from: number; to: number }[]): number {
  if (!spans.length) return 0
  const sorted = [...spans].sort((a, b) => a.from - b.from)
  let total = 0
  let from = sorted[0].from
  let to = sorted[0].to
  for (const span of sorted.slice(1)) {
    if (span.from > to) {
      total += to - from
      from = span.from
      to = span.to
    } else if (span.to > to) to = span.to
  }
  return total + (to - from)
}

export class PhaseLedger {
  private readonly spans: Span[] = []
  private readonly startedAt: number

  constructor(now = Date.now()) {
    this.startedAt = now
  }

  /**
   * Records `ms` of `phase` work that finished at `endedAt`.
   *
   * The end timestamp rather than the start because the one caller that cannot use `measure` —
   * `logAgentTokens`, which is handed an already-elapsed duration after the call returns — knows
   * when the work ended and not when it began. Deriving the start from the end is exact there,
   * and the default makes every other caller read as it did before.
   */
  record(phase: Phase, ms: number, endedAt = Date.now()): void {
    const clamped = Math.max(0, ms)
    this.spans.push({ phase, from: endedAt - clamped, to: endedAt })
  }

  /**
   * Times `work` and records it under `phase`.
   *
   * Records on the way out whether or not `work` threw: a read that fails after waiting out a
   * timeout is the most expensive read there is, and dropping it would make the one sweep whose
   * timings matter most — a slow or failing one — the one the ledger under-reports.
   */
  async measure<T>(phase: Phase, work: () => Promise<T>): Promise<T> {
    const began = Date.now()
    try {
      return await work()
    } finally {
      const ended = Date.now()
      this.record(phase, ended - began, ended)
    }
  }

  private excludedMs = 0

  /**
   * Removes `ms` of wall clock from the sweep's total. Used for app boot, which depends on the
   * toolchain rather than on the sweep and would otherwise swamp every comparison between runs.
   */
  excludeWall(ms: number): void {
    this.excludedMs += Math.max(0, ms)
  }

  get excludedWallMs(): number {
    return this.excludedMs
  }

  get wallMs(): number {
    return Math.max(0, Date.now() - this.startedAt - this.excludedMs)
  }

  /** Wall clock in which *any* phase was running, overlaps counted once. */
  get busyMs(): number {
    return mergedMs(this.spans)
  }

  /** Work done across every phase, overlaps counted at full price. */
  get totalWorkMs(): number {
    return this.spans.reduce((sum, span) => sum + (span.to - span.from), 0)
  }

  /** Rows in a fixed order, skipping phases this sweep never reached. */
  rows(): { phase: Phase; tally: PhaseTally }[] {
    const rows: { phase: Phase; tally: PhaseTally }[] = []
    for (const phase of PHASE_ORDER) {
      const spans = this.spans.filter((span) => span.phase === phase)
      if (!spans.length) continue
      rows.push({
        phase,
        tally: {
          calls: spans.length,
          ms: spans.reduce((sum, span) => sum + (span.to - span.from), 0),
          clockMs: mergedMs(spans)
        }
      })
    }
    return rows
  }
}

/**
 * The closing summary, as lines for the caller to log.
 *
 * Reports an `unmeasured` remainder rather than letting the rows imply they add up to the wall
 * clock. They never will — manifest writes, parsing, IPC and anything else not on the list live in
 * the gap — and a remainder that grows is the signal that a new phase is worth naming. That
 * remainder is taken against `busyMs`, not against the sum of the rows: with overlapping phases the
 * sum can exceed the wall clock outright, which used to drive the gap towards zero and then
 * negative, hiding real unattributed time behind double-counted work.
 *
 * Shares are of the wall clock a phase *held*, so they describe the run rather than the invoice,
 * and so a column of them cannot add to more than 100%. The work figure is still printed where it
 * differs, because "1.6s of reading that cost the sweep nothing" is the thing worth knowing.
 *
 * Returning lines instead of printing them keeps this a pure function, so the arithmetic is
 * testable without capturing console output.
 */
export function formatPhaseSummary(ledger: PhaseLedger): string[] {
  const wallMs = ledger.wallMs
  const rows = ledger.rows()
  const share = (ms: number): string => (wallMs ? ` (${Math.round((ms / wallMs) * 100)}%)` : '')
  const lines = rows.map(({ phase, tally }) => {
    const each = tally.calls ? tally.ms / tally.calls / 1000 : 0
    const concurrent =
      tally.ms > tally.clockMs
        ? `, ${((tally.ms - tally.clockMs) / 1000).toFixed(1)}s overlapped`
        : ''
    return (
      `[app-flow] time by phase — ${phase}: ${tally.calls} calls, ` +
      `${(tally.clockMs / 1000).toFixed(1)}s${share(tally.clockMs)}, ${each.toFixed(2)}s each` +
      concurrent
    )
  })
  const hidden = ledger.totalWorkMs - ledger.busyMs
  if (hidden > 0) {
    lines.push(
      `[app-flow] time by phase — concurrency hid ${(hidden / 1000).toFixed(1)}s ` +
        `of work inside another phase`
    )
  }
  const unmeasured = wallMs - ledger.busyMs
  lines.push(
    `[app-flow] time by phase — unmeasured: ${(unmeasured / 1000).toFixed(1)}s` +
      `${share(Math.max(0, unmeasured))}`
  )
  lines.push(`[app-flow] sweep wall clock — ${(wallMs / 1000).toFixed(1)}s`)
  return lines
}
