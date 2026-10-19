import assert from 'node:assert/strict'
import test from 'node:test'
import {
  runHintedNodes,
  statesPhaseRunsAfterStop,
  type StateNodeResult,
  type SweepStopReason
} from '../src/app-flow/states-phase.ts'
import { ExplorationControl } from '../src/app-flow/reach/exploration-control.ts'

// --- which stops still run the phase ------------------------------------------------------------
// The bug this covers: every early exit set the same `sweepStopped` flag, and the sweep's stopped
// exit returned before the state-variant phase. A bounded sweep reaching its `screenLimit` — the
// ordinary, successful outcome of asking for N screens — therefore captured no state variants at
// all with `stateCaptureMode: 'on'`, while a user pause took the same exit and must keep skipping
// the phase.

test('a sweep stopped by its own ceilings still runs the state phase; a user stop does not', () => {
  for (const reason of ['limit', 'attempts', 'deadline'] as const) {
    assert.equal(
      statesPhaseRunsAfterStop(reason),
      true,
      `A ${reason} ceiling is the bounded sweep succeeding, not the user stopping it.`
    )
  }
  for (const reason of ['requested', 'auth', 'blocked'] as const) {
    assert.equal(
      statesPhaseRunsAfterStop(reason),
      false,
      `A ${reason} stop is the user asking the run to end; no extra model-driven phase follows it.`
    )
  }
  // A sweep that was never stopped runs the phase exactly as it always did.
  assert.equal(statesPhaseRunsAfterStop(null), true)
})

test("the screen limit's own verdict is a reason the state phase runs on", () => {
  // The verdict the orchestrator carries onto the stop, taken from the real control rather than a
  // hand-written string, so the two sets cannot drift apart.
  const control = new ExplorationControl(2)
  assert.equal(control.screenFinished(true), null)
  const verdict = control.screenFinished(true)
  assert.equal(verdict, 'limit')
  assert.equal(statesPhaseRunsAfterStop(verdict as SweepStopReason), true)
})

// --- the per-route loop -------------------------------------------------------------------------

interface FakeNode {
  id: string
}

const nodes = (...ids: string[]): FakeNode[] => ids.map((id) => ({ id }))

const harness = (
  run: (node: FakeNode, index: number) => Promise<StateNodeResult>,
  overrides: Partial<Parameters<typeof runHintedNodes<FakeNode>>[0]> = {}
) => {
  const checkpoints: string[][] = []
  const done = new Set<string>()
  const started: string[] = []
  return {
    done,
    started,
    checkpoints,
    input: {
      nodes: nodes('Feed', 'Profile', 'Settings'),
      idOf: (node: FakeNode) => node.id,
      done,
      checkSignal: () => undefined,
      checkpoint: async () => {
        checkpoints.push([...done])
      },
      onNodeStart: (node: FakeNode) => {
        started.push(node.id)
      },
      run,
      ...overrides
    }
  }
}

test('a limit-paused sweep captures state variants into the map the stopped exit then writes', async () => {
  // The map the stopped exit publishes. The phase must land its variants in it *before* those
  // writes, which is what moving the phase ahead of them buys.
  const captureMap: Record<string, { states: string[] }> = {
    Feed: { states: [] },
    Profile: { states: [] },
    Settings: { states: [] }
  }
  const fake = harness(async (node) => {
    if (node.id === 'Settings') return { outcome: 'skip' }
    captureMap[node.id].states.push(`${node.id}-empty`)
    return { outcome: 'captured' }
  })
  const summary = await runHintedNodes(fake.input)

  assert.deepEqual(summary, { stopped: false, paused: false, measured: 2 })
  assert.deepEqual(captureMap.Feed.states, ['Feed-empty'])
  assert.deepEqual(captureMap.Profile.states, ['Profile-empty'])
  assert.deepEqual(captureMap.Settings.states, [], 'A route with no base capture does no work.')
  // Checkpointed as it goes, so a resume of the paused run does not repeat a finished route.
  assert.deepEqual(fake.done, new Set(['Feed', 'Profile']))
  assert.deepEqual(fake.checkpoints, [['Feed'], ['Feed', 'Profile']])
})

test('a pause requested during the phase stops it between routes, not inside one', async () => {
  let paused = false
  const worked: string[] = []
  const fake = harness(
    async (node) => {
      worked.push(node.id)
      paused = true
      return { outcome: 'captured' }
    },
    { pauseRequested: () => paused }
  )
  const summary = await runHintedNodes(fake.input)

  assert.deepEqual(summary, { stopped: true, paused: true, measured: 1 })
  assert.deepEqual(worked, ['Feed'], 'The pause is observed before the next route, not inside one.')
  // The route that did run is still finished and checkpointed — a pause never cuts one in half.
  assert.deepEqual(fake.done, new Set(['Feed']))
  assert.deepEqual(fake.checkpoints, [['Feed']])
})

test('a cancellation during the phase unwinds and leaves the finished routes checkpointed', async () => {
  const fake = harness(async () => ({ outcome: 'captured' }), {
    checkSignal: () => {
      if (fake.done.size >= 1) throw new Error('Cancelled')
    }
  })
  await assert.rejects(runHintedNodes(fake.input), /Cancelled/)
  assert.deepEqual(fake.done, new Set(['Feed']))
  assert.deepEqual(fake.checkpoints, [['Feed']])
})

test('a route that stops the sweep ends the phase without marking itself done', async () => {
  const fake = harness(async (node) =>
    node.id === 'Profile' ? { outcome: 'skip', stop: true } : { outcome: 'captured' }
  )
  const summary = await runHintedNodes(fake.input)
  assert.deepEqual(summary, { stopped: true, paused: false, measured: 1 })
  assert.deepEqual(fake.done, new Set(['Feed']))
  assert.deepEqual(fake.started, ['Feed', 'Profile'])
})

test('only a route with an answer is checkpointed; a failed reach is left for a resume', async () => {
  const outcomes: Record<string, StateNodeResult> = {
    Feed: { outcome: 'base-failed' },
    Profile: { outcome: 'failed' },
    Settings: { outcome: 'no-trigger' }
  }
  const fake = harness(async (node) => outcomes[node.id])
  const summary = await runHintedNodes(fake.input)
  assert.equal(summary.measured, 3, 'Every route that did work is metered, whatever came of it.')
  assert.deepEqual(
    fake.done,
    new Set(['Settings']),
    'Only `no-trigger` (and `captured`) are final; a reach or action failure is worth retrying.'
  )
})

test('a resumed run skips the routes a previous run already finished', async () => {
  const worked: string[] = []
  const fake = harness(async (node) => {
    worked.push(node.id)
    return { outcome: 'captured' }
  })
  fake.done.add('Feed')
  const summary = await runHintedNodes(fake.input)
  assert.deepEqual(worked, ['Profile', 'Settings'])
  assert.equal(summary.measured, 2, 'A route finished by an earlier run is counted nowhere.')
})
