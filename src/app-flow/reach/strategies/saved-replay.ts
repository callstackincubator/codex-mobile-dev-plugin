/**
 * The saved-replay strategy — plan landing-order item 4. Moved out of the `trySavedReplay` closure
 * in `orchestrator.ts`, which called this same sequence (replay the node's own published `.ad`
 * script, confirm the auth gate, verify arrival) but recorded what happened onto four outer locals
 * (`reachError`, `acceptedArrival`, `replayScript`, `replayScriptVerified`) instead of returning it.
 * Those four are now exactly `ReachAttempt.reason`/`arrival`/`evidence`.
 *
 * No device or Electron import here — see `reach/types.ts`'s doc comment. Only `adapters.ts` may
 * import `capture.ts`/`storage.ts` values.
 */
import { existsSync, readFileSync } from 'node:fs'
import type { AppFlowNode } from '../../../shared/app-flow.ts'
import type { ActiveTimeBudget } from '../../exploration.ts'
import { destinationGuardSelector } from '../../ad-script.ts'
import type { ReachPorts } from '../ports.ts'
import type { ReachAttempt } from '../types.ts'
import { diagnosticFramePath, verifyWithDiagnostic } from './verify-with-diagnostic.ts'
import { checkSignal } from '../../cancel.ts'

export interface SavedReplayInput {
  node: AppFlowNode
  /** The node's own published `.ad` path — tried only when it exists on disk. */
  scriptPath: string
  budget: ActiveTimeBudget
  /** `sweepQueue.remaining` at the moment this attempt starts — what `AuthPort.checkGate` reports
   *  to the user-facing prompt if the auth gate stops the sweep here. */
  remaining: number
  scratchPath: (key: string) => string
  signal?: AbortSignal
}

export async function savedReplayStrategy(
  input: SavedReplayInput,
  ports: ReachPorts
): Promise<ReachAttempt> {
  const startedAt = Date.now()
  const { node, scriptPath, budget, remaining, scratchPath, signal } = input
  const elapsedMs = (): number => Date.now() - startedAt

  if (!existsSync(scriptPath) || budget.expired) {
    return {
      strategy: 'saved-replay',
      ok: false,
      reason: 'No saved replay to try.',
      touchedDevice: false,
      elapsedMs: elapsedMs(),
      effects: []
    }
  }

  try {
    const timeoutMs = Math.max(1_000, Math.min(120_000, budget.remainingMs))
    // Repair, not just replay. Scripts are published unverified now — `saveAndReplayRecording`
    // defers the verification replay to whoever first needs the script — so this rung is usually
    // the first thing to re-read a recorded identity against a fresh tree, which makes it the
    // first thing to meet an `IDENTITY_MISMATCH`. Handing it the same two recovery tiers that ran
    // at publication before is what keeps deferral from meaning "give repair up": a script the
    // strip can rescue is rescued here, in place, and the next sweep replays the repaired bytes.
    //
    // A script with no trailing guard predates `saveAndReplayRecording` appending one, and the
    // tiers have nowhere to wait after rewriting a step — so it replays the old way and a
    // divergence stays fatal for this attempt, exactly as it was.
    const guard = destinationGuardSelector(readFileSync(scriptPath, 'utf8').split('\n'))
    if (guard === undefined) {
      const replay = await ports.device.replayRun({ path: scriptPath, timeoutMs })
      checkSignal(signal)
      if (!replay.sessionActive) throw new Error('Replay did not leave an active session')
    } else {
      await ports.recorder.verifyAndRepairReplay(scriptPath, guard, timeoutMs)
      checkSignal(signal)
    }

    const auth = await ports.auth.checkGate(remaining, budget)
    if (auth === 'stop') {
      return {
        strategy: 'saved-replay',
        ok: false,
        failure: 'auth-stopped',
        reason: 'Auth gate stopped the sweep.',
        touchedDevice: true,
        elapsedMs: elapsedMs(),
        effects: []
      }
    }
    if (auth === 'exhausted') {
      return {
        strategy: 'saved-replay',
        ok: false,
        reason: 'Navigation budget exhausted after five minutes.',
        touchedDevice: true,
        elapsedMs: elapsedMs(),
        effects: []
      }
    }

    // `withPressables`: the controls are read while the judge is thinking rather than after it
    // answers — see that option's doc comment. A mismatch drops them, which costs nothing, because
    // the read ran inside the judge's own latency either way.
    const { arrival, pressables } = await verifyWithDiagnostic(
      ports,
      node,
      scratchPath,
      'saved-replay-check',
      budget,
      { withPressables: true }
    )
    checkSignal(signal)
    if (arrival.verdict !== 'match') {
      return {
        strategy: 'saved-replay',
        ok: false,
        reason: `Saved replay did not reach target: ${arrival.reason}`,
        touchedDevice: true,
        arrival,
        elapsedMs: elapsedMs(),
        effects: []
      }
    }

    return {
      strategy: 'saved-replay',
      ok: true,
      reason: arrival.reason,
      touchedDevice: true,
      arrival,
      // The replay put the app on the screen, the judge accepted that frame, and this strategy
      // then stops touching the device — so the frame and the controls both still describe what is
      // on screen, and delivery takes them instead of shooting and reading the same screen again.
      evidence: {
        arrival,
        frame: diagnosticFramePath(scratchPath, 'saved-replay-check'),
        pressables,
        replayScript: scriptPath,
        replayVerified: true
      },
      elapsedMs: elapsedMs(),
      effects: []
    }
  } catch (error) {
    checkSignal(signal)
    return {
      strategy: 'saved-replay',
      ok: false,
      reason: `Saved replay diverged: ${error instanceof Error ? error.message : String(error)}`,
      touchedDevice: true,
      elapsedMs: elapsedMs(),
      effects: []
    }
  }
}
