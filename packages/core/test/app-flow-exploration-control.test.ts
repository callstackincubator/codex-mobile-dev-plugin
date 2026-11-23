import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_ATTEMPTS_PER_SCREEN,
  DEFAULT_MS_PER_SCREEN,
  ExplorationControl
} from '../src/app-flow/reach/exploration-control.ts'

test('zero screen limit explores without an implicit screen, attempt, or time cap', () => {
  let now = 100
  const control = new ExplorationControl(0, () => false, { now: () => now })

  assert.equal(control.beforeNextScreen(), null)
  for (let index = 0; index < 20; index += 1) {
    now += DEFAULT_MS_PER_SCREEN
    assert.equal(control.screenFinished(index % 2 === 0), null)
  }
  assert.equal(control.screensAttempted, 20)
  assert.equal(control.screensExplored, 10)
})

test('positive screen limits retain their derived capture, attempt, and deadline bounds', () => {
  let now = 0
  const captures = new ExplorationControl(2, () => false, { now: () => now })
  assert.equal(captures.screenFinished(true), null)
  assert.equal(captures.screenFinished(true), 'limit')

  const attempts = new ExplorationControl(2, () => false, { now: () => now })
  for (let index = 1; index < 2 * DEFAULT_ATTEMPTS_PER_SCREEN; index += 1)
    assert.equal(attempts.screenFinished(false), null)
  assert.equal(attempts.screenFinished(false), 'attempts')

  const deadline = new ExplorationControl(2, () => false, { now: () => now })
  now = 2 * DEFAULT_MS_PER_SCREEN
  assert.equal(deadline.beforeNextScreen(), 'deadline')
})

test('zero keeps explicit safety bounds and omitted remains unbounded', () => {
  const explicit = new ExplorationControl(0, () => false, { attemptLimit: 1 })
  assert.equal(explicit.screenFinished(false), 'attempts')

  const omitted = new ExplorationControl(undefined)
  for (let index = 0; index < 20; index += 1) assert.equal(omitted.screenFinished(true), null)
})
