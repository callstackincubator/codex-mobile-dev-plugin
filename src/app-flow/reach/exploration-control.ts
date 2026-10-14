/** Why a device exploration should stop before starting another screen. */
export type ExplorationPauseReason = 'requested' | 'limit' | 'attempts' | 'deadline'

/**
 * Default attempts allowed per screen of `screenLimit`, when a caller does not set `attemptLimit`.
 *
 * A screen the sweep fails to reach costs the same wall-clock as one it captures — the same auth
 * gate, the same screenshots, the same multi-step planner walk — but `screenFinished(false)`
 * deliberately does not spend the screen limit on it (see `screensExplored`). That asymmetry is
 * correct as a *success* accounting rule and catastrophic as the sweep's only bound: a device log
 * against social-app ran 12 queue entries to reach its 8-screen limit, four of them
 * moderator-inbox routes with no path in from a normal account, each paying a full planner walk to
 * conclude the same thing. The run looked like "8 screens" and cost twelve.
 *
 * Two attempts per screen is the slack a healthy sweep actually uses — a route this build withholds
 * or a planner that needs a second pass — while still putting a ceiling on the pathological case.
 */
export const DEFAULT_ATTEMPTS_PER_SCREEN = 2

/**
 * Default wall-clock allowance per screen of `screenLimit`, when a caller does not set
 * `sweepDeadlineMs`.
 *
 * Neither the screen limit nor the attempt limit bounds *time*: the per-node budgets in
 * `orchestrator.ts` are five minutes each, so a single stubborn node can legally outlast an entire
 * healthy sweep. On the reference run a captured screen cost ~20-30s end to end, so 45s per screen
 * leaves roughly double the healthy cost before the deadline bites — slack for a slow screen,
 * without letting one stuck node consume the whole run.
 */
export const DEFAULT_MS_PER_SCREEN = 45_000

// `REPLAY_VERIFICATION_*` and `replayVerificationBudgetMs` lived here: the time-box for the
// verification replay `saveAndReplayRecording` ran after a walk. Exploration records no script to
// verify, so there is no replay to box.

export interface ExplorationControlOptions {
  /**
   * Total screen attempts — captured or not — allowed in this run. Defaults to
   * `screenLimit * DEFAULT_ATTEMPTS_PER_SCREEN`, and is unbounded when there is no `screenLimit`
   * (a sweep asked to capture everything has no basis for an attempt ceiling).
   */
  attemptLimit?: number
  /**
   * Wall-clock the run may spend, measured from construction. Defaults to
   * `screenLimit * DEFAULT_MS_PER_SCREEN`, and is unbounded without a `screenLimit`.
   */
  sweepDeadlineMs?: number
  /** Injectable clock, for tests. */
  now?: () => number
}

/**
 * Counts what this run has spent — screens captured, screens attempted, and wall-clock elapsed —
 * and samples a cooperative pause request, all only at screen boundaries. Keeping this policy
 * separate from the device loop makes the important invariant explicit: a request made mid-screen
 * cannot interrupt that screen before its checkpoint is saved.
 *
 * The three limits answer three different questions and none substitutes for another.
 * `screenLimit` is the user's goal ("give me 8 screens") and only successful captures spend it.
 * `attemptLimit` bounds the work done toward that goal, so unreachable routes cannot be explored
 * for free. `sweepDeadlineMs` bounds the clock, so neither of the other two can be satisfied
 * arbitrarily slowly. A sweep stops at whichever it reaches first, and `beforeNextScreen` reports
 * which one so the caller can log it.
 */
export class ExplorationControl {
  private explored = 0
  private attempted = 0
  private readonly screenLimit: number | undefined
  private readonly attemptLimit: number | undefined
  private readonly deadlineAt: number | undefined
  private readonly now: () => number
  private readonly pauseRequested: () => boolean

  constructor(
    screenLimit?: number,
    pauseRequested: () => boolean = () => false,
    options: ExplorationControlOptions = {}
  ) {
    this.screenLimit = screenLimit
    this.pauseRequested = pauseRequested
    this.now = options.now ?? Date.now
    // Both derived ceilings are deliberately gated on `screenLimit`: a caller that asked for every
    // screen in the app has told us nothing about how much work or time that is worth, and
    // inventing a bound for it would silently truncate a full sweep.
    this.attemptLimit =
      options.attemptLimit ??
      (screenLimit === undefined ? undefined : screenLimit * DEFAULT_ATTEMPTS_PER_SCREEN)
    const deadlineMs =
      options.sweepDeadlineMs ??
      (screenLimit === undefined ? undefined : screenLimit * DEFAULT_MS_PER_SCREEN)
    this.deadlineAt = deadlineMs === undefined ? undefined : this.now() + deadlineMs
  }

  /** Screens successfully captured so far — what `screenLimit` is measured against. */
  get screensExplored(): number {
    return this.explored
  }

  /** Screens finished so far, captured or not — what `attemptLimit` is measured against. */
  get screensAttempted(): number {
    return this.attempted
  }

  beforeNextScreen(): ExplorationPauseReason | null {
    if (this.pauseRequested()) return 'requested'
    if (this.screenLimit !== undefined && this.explored >= this.screenLimit) return 'limit'
    if (this.attemptLimit !== undefined && this.attempted >= this.attemptLimit) return 'attempts'
    // Checked last of the three so a run that satisfied its goal on the final screen reports
    // 'limit' rather than blaming the clock for a sweep that actually finished.
    if (this.deadlineAt !== undefined && this.now() >= this.deadlineAt) return 'deadline'
    return null
  }

  screenFinished(captured: boolean): ExplorationPauseReason | null {
    if (captured) this.explored += 1
    this.attempted += 1
    return this.beforeNextScreen()
  }
}
