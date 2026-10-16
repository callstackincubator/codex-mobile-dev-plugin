/**
 * `runReachLadder` — plan landing-order item 4. Replaces `runVerifiedReach` (formerly
 * `exploration.ts`), which only ever ran a fixed three-step `trySavedReplay → tryDeepLink →
 * explore` sequence of booleans with no visibility into *why* each step failed. A strategy here
 * returns a full `ReachAttempt` (see `reach/types.ts`'s doc comment on why), so the ladder can fold
 * `effects` for the caller and short-circuit on more than a bare `ok`.
 *
 * The strategy list is an injectable parameter rather than a hard-coded sequence, which is what
 * makes ordering and short-circuiting testable in isolation (`ladder.test.ts`) with no device and
 * no real strategy implementations — a stub that always fails is enough to prove the ladder visits
 * every strategy once, in order, and stops where it should.
 *
 * No device or Electron import here — see `reach/types.ts`'s doc comment. Only `adapters.ts` may
 * import `capture.ts`/`storage.ts` values.
 */
import type { ExplorationMode } from '../../shared/app-flow.ts'
import type { ReachAttempt, ReachOutcome } from './types.ts'
import type { ReachPorts } from './ports.ts'

/** One rung of the ladder: reads `input` and calls through `ports`, returns without mutating either. */
export type ReachStrategy<TInput> = (input: TInput, ports: ReachPorts) => Promise<ReachAttempt>

export interface RunReachLadderOptions<TInput> {
  input: TInput
  ports: ReachPorts
  strategies: readonly ReachStrategy<TInput>[]
  /** Checked before every strategy — not just once — so a budget that expires partway through the
   *  ladder (a saved replay that itself burned the last of it) stops the *next* rung rather than
   *  starting a doomed one. */
  budget: { readonly expired: boolean }
  signal?: AbortSignal
}

/**
 * Runs `strategies` in order against `input`, stopping at the first `ok`, the first `failure` that
 * demands it (`unavailable`, `auth-stopped`, `cancelled`), an aborted `signal`, or an expired
 * `budget` — checked before a strategy runs, never after, so an already-exhausted budget never
 * touches a port at all. Every attempt made along the way, including the one that finally
 * succeeded, is returned in `attempts` in call order, so a caller can fold every strategy's
 * `effects` — not just the winning one's — into whatever durable state it owns.
 */
export async function runReachLadder<TInput>(
  options: RunReachLadderOptions<TInput>
): Promise<ReachOutcome> {
  const { input, ports, strategies, budget, signal } = options
  const attempts: ReachAttempt[] = []

  for (const strategy of strategies) {
    if (signal?.aborted) return { status: 'stopped', reason: 'cancelled', attempts }
    if (budget.expired) {
      return {
        status: 'unreached',
        reason: 'Navigation budget exhausted.',
        attempts
      }
    }

    const attempt = await strategy(input, ports)
    attempts.push(attempt)

    if (attempt.ok) return { status: 'reached', strategy: attempt.strategy, attempts }
    if (attempt.failure === 'unavailable') {
      return { status: 'unavailable', reason: attempt.reason, attempts }
    }
    if (attempt.failure === 'auth-stopped') return { status: 'stopped', reason: 'auth', attempts }
    if (attempt.failure === 'cancelled') return { status: 'stopped', reason: 'cancelled', attempts }
  }

  const last = attempts[attempts.length - 1]
  return {
    status: 'unreached',
    reason: last?.reason ?? 'No reach strategy was configured.',
    // Only when every rung that ran was refused. One rung that actually drove the app leaves the
    // screen somewhere unknown, and the caller's stuck-app detection has to run as it always did.
    // The budget-exhausted exit above never sets this: an empty `attempts` would vacuously satisfy
    // `every`, and "we never tried" is not "nothing moved".
    refused: attempts.length > 0 && attempts.every((attempt) => attempt.refused === true),
    attempts
  }
}

/** The rungs a sweep has available, by name, so `strategiesFor` can select among them. */
export interface ReachRungs<TInput> {
  probeCredit: ReachStrategy<TInput>
  savedReplay: ReachStrategy<TInput>
  deepLink: ReachStrategy<TInput>
  render: ReachStrategy<TInput>
  explore: ReachStrategy<TInput>
}

/**
 * The ladder an `ExplorationMode` asks for.
 *
 * Auto and Thorough reuse a verified probe or saved replay before their named pipelines. Fast is
 * deliberately stricter: it is deterministic runtime navigation only, so selecting it never opens
 * a deep link, replays an agent-device journey, or falls back to a model-driven walk.
 *
 * `fast` leaves a screen the navigator cannot reach *unreached* rather than falling back to the
 * walk. That is the point of asking for it: the fallback is the expensive thing, and a mode that
 * quietly paid for it anyway would not be fast.
 */
export function strategiesFor<TInput>(
  mode: ExplorationMode | undefined,
  rungs: ReachRungs<TInput>
): readonly ReachStrategy<TInput>[] {
  const shortcuts = [rungs.probeCredit, rungs.savedReplay]
  if (mode === 'fast') return [rungs.render]
  if (mode === 'thorough') return [...shortcuts, rungs.deepLink, rungs.explore]
  return [...shortcuts, rungs.deepLink, rungs.render]
}

/**
 * Whether a reach ever asked the app to go anywhere.
 *
 * A caller that reads the screen *after* a failure — to decide whether the app moved — only learns
 * something when at least one rung actually dispatched. Every rung can decline before it touches
 * the device: `renderStrategy` skips on unresolved route parameters, on an exhausted budget, on a
 * missing runtime transport and on a guard gate a sibling already measured as closed, and the
 * ladder's own budget exit returns with no attempts at all. In each of those cases the app is
 * exactly where the previous node left it, so a post-failure screen read is guaranteed to match
 * the previous one and says nothing whatsoever about the app being stuck.
 *
 * Deliberately broader than `ReachOutcome.refused`, which is specifically "the runtime answered,
 * and the answer was no". An empty `attempts` reads as device-free here, which is the honest
 * reading: nothing ran, so nothing moved.
 */
export function touchedDevice(outcome: ReachOutcome): boolean {
  return outcome.attempts.some((attempt) => attempt.touchedDevice)
}
