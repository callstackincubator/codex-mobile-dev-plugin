/**
 * Reaching a screen by telling the app's own navigator to go there.
 *
 * This is the deterministic Fast rung, and it exists for screens a URL cannot address but
 * which the running navigator will happily navigate to by name. On the measured reference app
 * those screens cost 22-33s each as an agentic walk; a dispatch plus a settle poll is a few
 * seconds.
 *
 * ## Two ways to reach a verdict, and what each one is for
 *
 * The strategy dispatches, waits for the screen to stop changing, and then either asks the same
 * arrival judge every other rung asks, or — under `arrivalJudge: 'fallback'`, which only Fast sets
 * — accepts the runtime's own readiness snapshot when that snapshot answers the judge's question
 * outright. The division of labour behind that:
 *
 * - The dispatch reply is the authority on *which* screen. The app's own resolver located the
 *   route, named the navigator path it dispatched, and the readiness poll reports the path that is
 *   now focused and whether its parameters match. Nothing a screenshot shows adds to that.
 * - `awaitSettled` is the authority on *timing only* — "is it worth photographing yet". It is a
 *   hint, not a verdict, and `stop: 'timeout'` is one of the ways a perfectly correct screen
 *   answers it (see below).
 * - A wrong accept would still be silent, which is why the evidence test is the strict one
 *   documented on `arrivalJudge` rather than "the dispatch was accepted".
 *
 * Most of the saving is in the dispatch — replacing a multi-step model-driven walk with one
 * navigation call is where the 20-plus seconds go — but the judge call is not free either: it cost
 * ~2.5s on a clean node and ~3.2s on each of the two live-feed nodes it was asked about in the
 * 2026-10 reference run, in a mode whose whole premise is that it makes no model calls.
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
   * it (`'fallback'`, Fast only), or whether no judge may be called and incomplete evidence must
   * remain unresolved (`'never'`, adaptive without the explicit judge option).
   *
   * `'fallback'` is not "trust the dispatch". The judge is skipped only when the runtime answers
   * every part of the question the judge is being asked: the screen is *found* (its fiber exists
   * and is focused), its parameters match the ones that were requested, it is showing content, and
   * the navigator path the app reported dispatching is a suffix of the path it now reports as
   * focused. Anything short of that — a target that was never found, a param mismatch, an empty
   * screen, a focused path that is not the one dispatched, or a poll that never got an answer at
   * all (which carries `found: false` by construction) — falls through to the judge exactly as
   * before.
   *
   * That is a stricter test than it first looks, and notably stricter than route identity alone:
   * the param check is what separates "the right route" from "the right record", which is the
   * confidently-wrong capture this whole rung is built to avoid.
   *
   * ## Why `settled` is deliberately not part of that test
   *
   * It was, and it was the wrong line to draw. A screen that never goes quiet is not a screen that
   * never arrived: HomeTab/Home and NotificationsTab/Notifications in the 2026-10 reference run are
   * live feeds whose poll ended on `stop: 'timeout'` while reporting `found`, no param mismatch,
   * 337 and 19 content nodes, and the dispatched path focused. Both were then sent to the judge,
   * which took ~3.2s each to answer `match` — the same answer the snapshot already contained, paid
   * for twice, in the mode that exists to make no model calls at all.
   *
   * The cost of dropping it is real and is not hidden here: the settle poll is the only thing that
   * was keeping this rung from photographing a screen mid-animation, so a `timeout` accept can now
   * deliver a frame with a transition still in flight — a half-slid header, a placeholder where an
   * image is still decoding. That is a worse screenshot of the right screen, which is the trade
   * Fast is for; it is not a screenshot of the wrong screen, which is what the evidence test above
   * is still there to prevent. `settled` keeps its other jobs: it bounds the wait, it is reported
   * in the log and the metric, and it still qualifies the failure note on a mismatch below.
   */
  arrivalJudge?: 'always' | 'fallback' | 'never'
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
  const runtimeEvidenceComplete =
    (input.arrivalJudge === 'fallback' || input.arrivalJudge === 'never') &&
    settled.found &&
    !settled.paramMismatch?.length &&
    settled.content > 0 &&
    dispatchedPath !== null &&
    isFocusedPath(dispatchedPath, settled.active ?? [])
  // The note says whether the screen had gone quiet when it was photographed, because that is the
  // one thing this verdict does not stand behind — a `timeout` accept is a real accept and a
  // possibly mid-animation frame, and a reader of the stored capture should not have to infer that
  // from a log file that is pruned after a few runs. See `arrivalJudge`.
  const runtimeArrival = runtimeEvidenceComplete
    ? `${dispatchedPath!.join(' > ')} is focused with ${settled.content} content nodes${
        settled.settled
          ? ' and settled'
          : `, though the readiness poll stopped on ${settled.stop ?? 'an unknown condition'}`
      }.`
    : null

  // A screen that never settled is still verified — by the judge when the runtime's evidence was
  // incomplete, and by that evidence itself when it was not. The settle poll is a timing hint, and
  // a slow screen that did arrive should not be thrown away over it.
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
        : input.arrivalJudge === 'never'
          ? {
              verdictWithoutJudge: () => ({
                verdict: 'uncertain' as const,
                status: null,
                reason: 'Runtime navigation completed, but its readiness evidence could not verify the target without AI.'
              })
            }
          : {})
    }
  )
  // Which of the two answered, and how long it took. `runtimeArrival` is the whole measurement
  // Step 4 exists for: the share of nodes on the `runtime` path is the saving, and the share that
  // still falls through to `judge` is the fallback rate. The duration is the verification as the
  // rung pays for it — the diagnostic frame included, since that is taken either way.
  //
  // `path: 'runtime'` is now a slightly wider bucket than it was: it covers screens whose
  // readiness poll gave up on a timeout but whose evidence was otherwise complete (live feeds,
  // mostly), which previously landed in `judge`. A release-over-release comparison of the two
  // shares crosses that change in meaning — see `docs/telemetry.md`.
  const verifyPath = runtimeArrival || input.arrivalJudge === 'never' ? ('runtime' as const) : ('judge' as const)
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
