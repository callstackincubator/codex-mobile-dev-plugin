/**
 * Reaching a screen by telling the app's own navigator to go there.
 *
 * This sits between the deep-link rung and the exploration rung, and it exists for the screens
 * that fall between them: routes a URL cannot address, or whose parameters have no value, but
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
 * - A wrong accept here would be silent. The settle check is a partial reimplementation of
 *   someone else's readiness heuristics over a transport that cannot see frames (see
 *   `runtime-render.ts`), and trusting it to confirm identity would buy a couple of seconds in
 *   exchange for captures that are confidently of the wrong screen.
 *
 * So `awaitSettled` answers "is it worth photographing yet", and the judge answers "is this the
 * screen we asked for".
 *
 * ## Why it runs after the deep link and before exploration
 *
 * A deep link exercises the app the way a user arriving from outside does, which is the more
 * faithful journey and the one whose `.ad` replay is reusable. Rendering bypasses that path, so
 * it should not pre-empt it. But it is far cheaper and far more predictable than asking a model
 * to find the screen, so it belongs ahead of exploration.
 *
 * It publishes **no replay script**. A dispatched navigation is not a journey a user could
 * repeat, and recording it as one would put a script in front of future sweeps that teaches them
 * nothing about how the screen is actually reached. Delivery falls back to its own read, exactly
 * as the exploration rung's does.
 */
import type { AppFlowNode } from '../../../shared/app-flow.ts'
import type { ActiveTimeBudget } from '../../exploration.ts'
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
}

/** The scratch suffix this strategy's diagnostic frame is written under. */
const SUFFIX = 'render-check'

export async function renderStrategy(input: RenderInput, ports: ReachPorts): Promise<ReachAttempt> {
  const { node, params, unresolvedParams, budget, scratchPath } = input
  const started = Date.now()
  const skip = (reason: string): ReachAttempt => ({
    strategy: 'render',
    ok: false,
    reason,
    touchedDevice: false,
    elapsedMs: Date.now() - started,
    effects: []
  })

  if (!ports.render) return skip('No runtime transport — the app’s JS context is not reachable.')
  // A route whose parameters have no value cannot be navigated to honestly. Dispatching with a
  // missing param lands on whatever the navigator makes of `undefined`, which is exactly the
  // confidently-wrong capture this whole path is built to avoid.
  if (unresolvedParams.length) {
    return skip(`Unresolved route parameters: ${unresolvedParams.join(', ')}.`)
  }
  if (budget.expired) return skip('Navigation budget exhausted before rendering.')
  if (!(await ports.render.available())) return skip('Runtime transport unavailable.')

  // Both phases are timed and logged here, in the rung, because nothing below them speaks: the
  // judge logs its own verdict and `settled.reason` was only ever surfaced on a *failed* arrival.
  // One baseline node had ~11.8s of dispatch-and-settle with no line in the log to say where it
  // went. Route names and counts only — `params` values are never printed, for the same reason
  // the param store refuses to log them.
  const dispatchStartedAt = Date.now()
  const dispatched = await ports.render.navigate(node, params)
  console.log(
    `[app-flow] ${node.id} render dispatch ${dispatched.ok ? 'ok' : 'refused'} (${Date.now() - dispatchStartedAt}ms) — ${dispatched.reason}`
  )
  if (!dispatched.ok) {
    // `touchedDevice` is true even though a refused dispatch leaves the screen exactly as it
    // found it. The field means what `reach/types.ts` says it means — whether the attempt made a
    // real device call, as opposed to short-circuiting on a breaker, an unresolved param or a
    // cached rejection — and a refusal is only ever reported *by the runtime*, after an eval has
    // already gone out and come back. One such refusal was measured at 986ms. Reporting it as a
    // free short-circuit is how a sweep log ends up claiming a rung never ran when it ran and
    // cost a second of device time.
    return {
      strategy: 'render',
      ok: false,
      reason: dispatched.reason,
      touchedDevice: true,
      elapsedMs: Date.now() - started,
      effects: []
    }
  }

  const settleStartedAt = Date.now()
  const settled = await ports.render.awaitSettled(node, params, budget)
  console.log(
    `[app-flow] ${node.id} render settle ${settled.settled ? 'ok' : 'gave up'} (${Date.now() - settleStartedAt}ms, ${settled.polls ?? '?'} polls, stop: ${settled.stop ?? 'unknown'}) — ${settled.reason}`
  )
  // A screen that never settled is still shown to the judge. The settle poll is a timing hint,
  // and a slow screen that did arrive should not be thrown away over it — the judge is looking at
  // the frame either way, and it is the thing qualified to say what is on it.
  const { arrival, pressables } = await verifyWithDiagnostic(
    ports,
    node,
    scratchPath,
    SUFFIX,
    budget,
    { withPressables: true }
  )
  if (arrival.verdict !== 'match') {
    return {
      strategy: 'render',
      ok: false,
      reason: settled.settled
        ? arrival.reason
        : `${arrival.reason} (screen had not settled: ${settled.reason})`,
      touchedDevice: true,
      arrival,
      elapsedMs: Date.now() - started,
      effects: []
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
