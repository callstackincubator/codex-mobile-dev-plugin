/**
 * Reaching a screen by telling the app's own navigator to go there.
 *
 * This is the deterministic Fast rung, and it exists for screens a URL cannot address but
 * which the running navigator will happily navigate to by name. On the measured reference app
 * those screens cost 22-33s each as an agentic walk; a dispatch plus a settle poll is a few
 * seconds.
 *
 * ## It is a navigation shortcut, not an arrival verdict
 *
 * The strategy dispatches, waits for the screen to stop changing, and then asks **the same
 * arrival judge every other rung asks**. It never decides for itself that it arrived. That split
 * is the whole safety argument:
 *
 * - The saving is in the dispatch. Replacing a multi-step model-driven walk with one navigation
 *   call is where the 20-plus seconds go; the judge call at the end costs ~2.5s either way.
 * - A wrong accept here would be silent. The persistent in-app runtime measures commits, network
 *   activity and painted frames, but the arrival judge still owns screen identity.
 *
 * So `awaitSettled` answers "is it worth photographing yet", and the judge answers "is this the
 * screen we asked for".
 *
 * ## Where it runs
 *
 * Fast invokes it directly after the verified shortcuts. Auto first tries the more faithful deep
 * link and falls back here. Thorough never invokes it; that mode follows a failed deep link with
 * model-driven exploration instead.
 *
 * It publishes **no replay script**. A dispatched navigation is not a journey a user could
 * repeat, and recording it as one would put a script in front of future sweeps that teaches them
 * nothing about how the screen is actually reached. Delivery falls back to its own read, exactly
 * as the exploration rung's does.
 */
import type { AppFlowNode } from '../../../shared/app-flow.ts'
import { explainGuardGate, type ActiveTimeBudget } from '../../exploration.ts'
import type { ReachPorts } from '../ports.ts'
import type { ReachAttempt } from '../types.ts'
import { diagnosticFramePath, verifyWithDiagnostic } from './verify-with-diagnostic.ts'

export interface RenderInput {
  node: AppFlowNode
  /** Resolved route parameters, or null when the route takes none. */
  params: Record<string, string> | null
  /** Parameters the store could not fill. A non-empty list makes this rung skip. */
  unresolvedParams: readonly string[]
  budget: ActiveTimeBudget
  scratchPath: (key: string) => string
  /** Whether another route behind this exact source guard already proved the gate closed. */
  guardGateClosed: (condition: string) => boolean
  /**
   * Whether every arrival here is the vision judge's to decide (`'always'`, the default and what
   * auto and thorough get), or whether an unambiguous runtime readiness snapshot may stand in for
   * it (`'fallback'`, Fast only).
   *
   * `'fallback'` is not "trust the dispatch". The judge is skipped only when the runtime answers
   * every part of the question the judge is being asked: the screen is *found* (its fiber exists
   * and is focused), its parameters match the ones that were requested, it is showing content, it
   * settled, and the navigator path the app reported dispatching is a suffix of the path it now
   * reports as focused. Anything short of that — an unsettled screen, a target that was never
   * found, a param mismatch, an empty screen, a focused path that is not the one dispatched —
   * falls through to the judge exactly as before.
   *
   * That is a stricter test than it first looks, and notably stricter than route identity alone:
   * the param check is what separates "the right route" from "the right record", which is the
   * confidently-wrong capture this whole rung is built to avoid.
   */
  arrivalJudge?: 'always' | 'fallback'
}

/**
 * Dispatch reasons that mean the navigator declined the request without carrying it out — the app
 * is exactly as it was found. `threw` is deliberately absent: a dispatch that threw *ran*, and may
 * have moved the app partway before it failed.
 */
const REFUSALS: ReadonlySet<string> = new Set([
  'unregistered',
  'no-navigator',
  'no-dispatch',
  'no-expo-router',
  'invalid-route'
])

/** Whether `path` is the tail of `active` — the live focused path confirming what was dispatched. */
function isFocusedPath(path: readonly string[], active: readonly string[]): boolean {
  if (!path.length || path.length > active.length) return false
  return path.every((name, index) => active[active.length - path.length + index] === name)
}

/** The scratch suffix this strategy's diagnostic frame is written under. */
const SUFFIX = 'render-check'

export async function renderStrategy(input: RenderInput, ports: ReachPorts): Promise<ReachAttempt> {
  const { node, params, unresolvedParams, budget, scratchPath, guardGateClosed } = input
  const started = Date.now()
  const skip = (reason: string): ReachAttempt => ({
    strategy: 'render',
    ok: false,
    reason,
    touchedDevice: false,
    elapsedMs: Date.now() - started,
    effects: []
  })

  // Fast reaches screens through the runtime rather than a deep link, but a guarded route renders
  // the same build-owned not-found screen either way. Once one sibling measured that gate closed,
  // do not dispatch every other sibling only to rediscover the identical fallback.
  if (node.guard && guardGateClosed(node.guard.condition)) {
    return {
      ...skip(explainGuardGate(node.guard)),
      failure: 'unavailable'
    }
  }
  if (!ports.render) return skip('No runtime transport — the app’s JS context is not reachable.')
  // A route whose parameters have no value cannot be navigated to honestly. Dispatching with a
  // missing param lands on whatever the navigator makes of `undefined`, which is exactly the
  // confidently-wrong capture this whole path is built to avoid.
  if (unresolvedParams.length) {
    return skip(`Unresolved route parameters: ${unresolvedParams.join(', ')}.`)
  }
  if (budget.expired) return skip('Navigation budget exhausted before rendering.')
  // An unavailable transport skips every node in the sweep, so the one thing the note must carry
  // is *why* — "no unambiguous Metro runtime" and "the agent would not install" are the same
  // sentence to a reader otherwise, and only the first is fixed by starting a dev server. The log
  // record is run-level: the sink keeps the first reason and drops the repeats (`SweepLogPort`).
  const availability = await ports.render.available()
  if (!availability.ok) {
    ports.sweepLog?.transportUnavailable(availability.reason)
    return skip(`Runtime transport unavailable — ${availability.reason}`)
  }

  // Both phases are timed and logged here, in the rung, because nothing below them speaks: the
  // judge logs its own verdict and `settled.reason` was only ever surfaced on a *failed* arrival.
  // One baseline node had ~11.8s of dispatch-and-settle with no line in the log to say where it
  // went. Route names and counts only — `params` values are never printed, for the same reason
  // the param store refuses to log them.
  // The per-run log reuses these stamps rather than measuring anything of its own — see
  // `SweepLogPort`. It is optional on every line: a sink that is absent, or that has disabled
  // itself after a failed write, must never change what this rung does.
  const log = ports.sweepLog?.node(node.id)
  const dispatchStartedAt = Date.now()
  const dispatched = await ports.render.navigate(node, params)
  const dispatchMs = Date.now() - dispatchStartedAt
  console.log(
    `[app-flow] ${node.id} render dispatch ${dispatched.ok ? 'ok' : 'refused'} (${dispatchMs}ms) — ${dispatched.reason}`
  )
  log?.route(node.id, dispatched.path ?? null)
  log?.dispatch({
    ok: dispatched.ok,
    action: dispatched.action ?? null,
    reason: dispatched.reason,
    ms: dispatchMs
  })
  if (!dispatched.ok) {
    // `touchedDevice` is true even though a refused dispatch leaves the screen exactly as it
    // found it. The field means what `reach/types.ts` says it means — whether the attempt made a
    // real device call, as opposed to short-circuiting on a breaker, an unresolved param or a
    // cached rejection — and a refusal is only ever reported *by the runtime*, after an eval has
    // already gone out and come back. One such refusal was measured at 986ms. Reporting it as a
    // free short-circuit is how a sweep log ends up claiming a rung never ran when it ran and
    // cost a second of device time.
    //
    // `refused` is the other half of that distinction, and it is the one the blocked-run detector
    // needs: the eval cost a second, and the screen did not move a pixel. See `ReachAttempt.refused`.
    return {
      strategy: 'render',
      ok: false,
      reason: dispatched.reason,
      touchedDevice: true,
      ...(dispatched.refusal && REFUSALS.has(dispatched.refusal) ? { refused: true } : {}),
      elapsedMs: Date.now() - started,
      effects: []
    }
  }

  const settleStartedAt = Date.now()
  const settled = await ports.render.awaitSettled(node, params, budget)
  const settleMs = Date.now() - settleStartedAt
  console.log(
    `[app-flow] ${node.id} render settle ${settled.settled ? 'ok' : 'gave up'} (${settleMs}ms, ${settled.polls ?? '?'} polls, stop: ${settled.stop ?? 'unknown'}) — ${settled.reason}`
  )
  log?.settle({
    polls: settled.polls ?? 0,
    stop: settled.stop ?? null,
    ms: settleMs,
    content: settled.content
  })
  // Can the runtime's own snapshot answer the judge's question outright? See `arrivalJudge`. The
  // dispatched path is taken from the *reply*, never from the node's id segments: the id is what
  // was asked for, and only the reply says what the app resolved it to.
  const dispatchedPath = dispatched.path ?? null
  const runtimeArrival =
    input.arrivalJudge === 'fallback' &&
    settled.settled &&
    settled.found &&
    !settled.paramMismatch?.length &&
    settled.content > 0 &&
    dispatchedPath !== null &&
    isFocusedPath(dispatchedPath, settled.active ?? [])
      ? `${dispatchedPath.join(' > ')} is focused and settled with ${settled.content} content nodes.`
      : null

  // A screen that never settled is still shown to the judge. The settle poll is a timing hint,
  // and a slow screen that did arrive should not be thrown away over it — the judge is looking at
  // the frame either way, and it is the thing qualified to say what is on it.
  const verifyStartedAt = Date.now()
  const { arrival, pressables } = await verifyWithDiagnostic(
    ports,
    node,
    scratchPath,
    SUFFIX,
    budget,
    {
      withPressables: true,
      // The scratch frame is still taken, and a relaunched session is still an automatic mismatch,
      // whichever way the verdict is reached — see `verifyWithDiagnostic`.
      ...(runtimeArrival
        ? {
            verdictWithoutJudge: () => ({
              verdict: 'match' as const,
              status: 'ok' as const,
              reason: `Runtime navigation confirmed: ${runtimeArrival}`
            })
          }
        : {})
    }
  )
  // Which of the two answered, and how long it took. `runtimeArrival` is the whole measurement
  // Step 4 exists for: the share of nodes on the `runtime` path is the saving, and the share that
  // still falls through to `judge` is the fallback rate. The duration is the verification as the
  // rung pays for it — the diagnostic frame included, since that is taken either way.
  const verifyPath = runtimeArrival ? ('runtime' as const) : ('judge' as const)
  const verifyMs = Date.now() - verifyStartedAt
  ports.metrics?.verify(verifyMs, verifyPath, arrival.verdict)
  log?.verify({ path: verifyPath, verdict: arrival.verdict, ms: verifyMs })
  if (arrival.verdict !== 'match') {
    const guardedNotFound = arrival.status === 'not-found' && node.guard
    return {
      strategy: 'render',
      ok: false,
      ...(guardedNotFound ? { failure: 'unavailable' as const } : {}),
      reason: guardedNotFound
        ? explainGuardGate(node.guard!)
        : settled.settled
          ? arrival.reason
          : `${arrival.reason} (screen had not settled: ${settled.reason})`,
      touchedDevice: true,
      arrival,
      elapsedMs: Date.now() - started,
      effects: guardedNotFound
        ? [{ kind: 'guard-gate-closed' as const, condition: node.guard!.condition }]
        : []
    }
  }
  return {
    strategy: 'render',
    ok: true,
    reason: arrival.reason,
    touchedDevice: true,
    arrival,
    evidence: {
      arrival,
      frame: diagnosticFramePath(scratchPath, SUFFIX),
      pressables,
      // No journey a user could repeat; see the doc comment.
      replayScript: null,
      replayVerified: false
    },
    elapsedMs: Date.now() - started,
    effects: []
  }
}
