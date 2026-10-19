/**
 * The runtime state-variant phase's policy and loop skeleton, kept out of `orchestrator.ts`'s
 * sweep closure so both are testable on their own.
 *
 * Two things live here. The first is the question of whether the phase runs at all once the sweep
 * has stopped early (`statesPhaseRunsAfterStop`) — a question the orchestrator used to answer by
 * accident: every early exit set the same `sweepStopped` flag, and the stopped exit returned ~45
 * lines before the phase, so a sweep that simply hit its `screenLimit` with state capture `on`
 * captured no state variants and said nothing about why. The second is the per-node loop around
 * the phase's work: its cancellation and pause sampling, its `statesDone` checkpointing, and the
 * bounded per-node meters.
 *
 * The device work itself — re-reaching the base screen, the auth gate, the planner call, the
 * action run — stays in the orchestrator, which owns the ports it needs. This module never touches
 * a device and never sees a route name: the meters below carry an outcome and nothing else, as
 * everywhere else in this feature's telemetry (`runtime-telemetry.ts`).
 */
import { recordRuntimeCount, recordRuntimeTiming } from './runtime-telemetry.ts'

/**
 * Why a sweep stopped before its queue was empty.
 *
 * The first four mirror `ExplorationPauseReason`; `auth` and `blocked` are the orchestrator's own
 * two stops (an auth gate that the user declined to clear, and a blocked-run prompt answered with
 * "stop").
 */
export type SweepStopReason = 'requested' | 'limit' | 'attempts' | 'deadline' | 'auth' | 'blocked'

/**
 * Whether a sweep that stopped for `reason` should still run the state-variant phase over what it
 * did capture.
 *
 * The three budget ceilings — `limit`, `attempts`, `deadline` — are the *ordinary, successful*
 * outcome of a bounded sweep. "Give me eight screens" ending at eight screens is the sweep doing
 * exactly what it was asked, and a run that then skips the phase it was explicitly told to perform
 * (`stateCaptureMode: 'on'`) is simply losing work it already paid the captures for. `attempts`
 * and `deadline` are included with `limit` on the same reasoning: they are ceilings the run was
 * given up front, not something anyone asked for mid-run.
 *
 * The other three are not. `requested` is the user pressing pause or cancel, and `auth` and
 * `blocked` are stops the user chose when asked; following any of those with an extra phase of
 * model calls and device driving is the opposite of what was asked for. `null` — not stopped at
 * all — runs the phase as it always did.
 */
export function statesPhaseRunsAfterStop(reason: SweepStopReason | null): boolean {
  if (reason === null) return true
  return reason === 'limit' || reason === 'attempts' || reason === 'deadline'
}

/** What one hinted route's state work came to. See `docs/telemetry.md`. */
export type StateNodeOutcome = 'captured' | 'base-failed' | 'no-trigger' | 'failed'

/**
 * Whether the phase ran, and if not, why — one count per sweep on `app_flow.states.phase`.
 *
 * Both per-node series are silent on a run that never entered the phase, which made "did state
 * capture do anything?" unanswerable: a run with no hinted route, a run with the option off, and
 * a run that reached its screen limit and returned early all looked identical from the outside
 * (they all emitted nothing at all). `skipped-stopped` is the one this exists to make visible.
 */
export type StatesPhaseOutcome = 'entered' | 'skipped-disabled' | 'skipped-stopped'

/** Records, exactly once per sweep, whether the state-variant phase was reached. */
export function recordStatesPhase(outcome: StatesPhaseOutcome): void {
  recordRuntimeCount('app_flow.states.phase', { outcome })
}

/** One hinted route's result: what it came to, and whether the sweep must stop after it. */
export interface StateNodeResult {
  /** `skip` for a route with nothing to do this run — already finished, or no base capture. */
  outcome: StateNodeOutcome | 'skip'
  /** Set when the work itself ended the sweep (a declined auth gate, a stop answer). */
  stop?: boolean
}

export interface HintedNodeRun<Node> {
  nodes: Node[]
  /** The key `done` is tracked by — the node id. */
  idOf(node: Node): string
  /** `statesDone`: routes a previous run of this resume chain already finished. Mutated here. */
  done: Set<string>
  /** Throws when the run was cancelled. Sampled before every route. */
  checkSignal(): void
  /** Cooperative pause, sampled between routes so a route's checkpoint is never cut in half. */
  pauseRequested?: () => boolean
  /** Announced per route, before its work starts. */
  onNodeStart?(node: Node, index: number, total: number): void
  run(node: Node, index: number): Promise<StateNodeResult>
  /** Written after each finished route, so a paused run resumes without repeating it. */
  checkpoint(): Promise<void>
  /** Injectable clock, for tests. */
  now?: () => number
}

export interface HintedNodeSummary {
  /** True when the phase ended early — a pause request, or a route that asked to stop. */
  stopped: boolean
  /** True specifically for a pause request observed during the phase. */
  paused: boolean
  /** Routes that did state work this run, skips excluded. */
  measured: number
}

/**
 * Drives the hinted routes, one at a time, with the phase's interruption rules.
 *
 * A paused sweep still runs this phase (see `statesPhaseRunsAfterStop`), so it has to stay just as
 * interruptible as the capture loop it follows: the signal is checked and the pause request
 * sampled before every route, never inside one, so whatever a route started is finished and
 * checkpointed before the phase lets go.
 *
 * Meters are per route and bounded: never one per planned action, and never one for a route that
 * did no work (`skip`) — a route already finished in a resumed checkpoint, or one with no base
 * capture, would only dilute the distribution with zeros.
 */
export async function runHintedNodes<Node>(input: HintedNodeRun<Node>): Promise<HintedNodeSummary> {
  const now = input.now ?? Date.now
  const total = input.nodes.length
  let measured = 0
  for (let index = 0; index < total; index++) {
    input.checkSignal()
    if (input.pauseRequested?.()) return { stopped: true, paused: true, measured }
    const node = input.nodes[index]
    input.onNodeStart?.(node, index, total)
    if (input.done.has(input.idOf(node))) continue
    const startedAt = now()
    const result = await input.run(node, index)
    if (result.outcome !== 'skip') {
      measured += 1
      recordRuntimeCount('app_flow.runtime.state_capture', { outcome: result.outcome })
      recordRuntimeTiming('app_flow.states.node', now() - startedAt, { outcome: result.outcome })
    }
    if (result.stop) return { stopped: true, paused: false, measured }
    // Only a route the phase has an answer for is marked done. A route whose base could not be
    // reached, or whose planned actions threw, is left for a resume to try again — unlike
    // `no-trigger`, where re-asking the same model the same question would buy the same answer.
    if (result.outcome === 'captured' || result.outcome === 'no-trigger') {
      input.done.add(input.idOf(node))
      await input.checkpoint()
    }
  }
  return { stopped: false, paused: false, measured }
}
