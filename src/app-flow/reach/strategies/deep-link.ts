/**
 * The deep-link strategy — plan landing-order item 4. Moved out of the `tryDeepLink` closure in
 * `orchestrator.ts`, minus one deliberately-kept entanglement: when a param-free prefix lands on a
 * real screen rather than the build's own not-found route (Step 3f), the original closure called
 * `exploreFrom` directly for a bounded last hop. `exploreFrom` has not moved out of `orchestrator.ts`
 * yet (that is landing-order item 5), so this strategy cannot call it without reaching back into
 * orchestrator-local state — and even once item 5 lands, a strategy calling directly into another
 * strategy would defeat the ladder's whole point of an explicit, injectable order. Instead this
 * strategy reports the landing as a `deep-link-partial-landed` effect and returns `ok: false` with
 * no `failure`, so the ladder falls through to the next strategy; the exploration strategy is what
 * reads that effect off `priorAttempts` and tries the bounded hop first, before its own normal seed
 * selection — see that strategy's doc comment once it lands. This is exactly why `effects` exists
 * as data rather than a callback: it lets two strategies cooperate on one plan step without either
 * one calling the other directly.
 *
 * The circuit breaker itself is `deep-link-policy.ts`'s pure `DeepLinkBreakerState` — this module
 * only decides *when* to register a failure or a success against it, mirroring exactly which of
 * `tryDeepLink`'s branches used to call `registerDeepLinkFailure`/reset the counter. Re-probing the
 * known-good route when the breaker's decision says `reprobe` is not something this strategy can do
 * itself without knowing which node is the probe route and how the caller wants it re-checked, so
 * that one device call stays an injected callback (`reprobe`) rather than something this module
 * invents its own device sequence for.
 *
 * No device or Electron import here — see `reach/types.ts`'s doc comment. Only `adapters.ts` may
 * import `capture.ts`/`storage.ts` values.
 */
import type { AppFlowCaptureStatus, AppFlowNode } from '../../../shared/app-flow.ts'
import type { ActiveTimeBudget } from '../../exploration.ts'
import {
  expectedCoverage,
  expectedNodeTokens,
  explainGuardGate,
  explainUnavailable,
  findRouteAncestor,
  isUndeeplinkableRoot,
  paramFreeDeepLink
} from '../../exploration.ts'
import { fingerprint } from '../../screen-signals.ts'
import {
  applyDeepLinkReprobeResult,
  evaluateDeepLinkAttempt,
  recordDeepLinkRejection,
  registerDeepLinkFailure,
  type DeepLinkBreakerState
} from '../deep-link-policy.ts'
import { detectNotFoundScreen, type NotFoundEvidence } from '../not-found-signal.ts'
import type { ReachPorts } from '../ports.ts'
import type { ArrivalVerdict, ReachAttempt, ReachEffect } from '../types.ts'
import { diagnosticFramePath, verifyWithDiagnostic } from './verify-with-diagnostic.ts'

/**
 * The subset of the sweep's nodes the ancestor lookup needs — same shape `findRouteAncestor` takes,
 * plus the ancestor's own settled capture status (recomputed by the caller from its live
 * `captureMap` on every call, since that map changes across the sweep) so `explainUnavailable` can
 * tell "this branch already resolved, so a 404 under it is a real gate" from "nothing here is
 * proven yet" without this strategy reaching into orchestrator-owned sweep state itself.
 */
export interface DeepLinkAncestorNode {
  id: string
  urlPath: string | null
  capturedStatus: AppFlowCaptureStatus | null
}

export interface DeepLinkInput {
  node: AppFlowNode
  /** False once the node's own params all resolve to a real value — see `paramFreeDeepLink`. */
  unresolvedParams: readonly string[]
  /** Sample values for the node's declared params (`pickSampleParams` in `orchestrator.ts`), passed
   *  through to `DevicePort.openDeepLink` to substitute into the URL on a full (non-partial) open. */
  params: Record<string, string>
  budget: ActiveTimeBudget
  // No `remaining`/auth-gate field here: a deep link opens a URL in the already-running app and
  // never relaunches, so (matching the original `tryDeepLink` closure) it never calls
  // `AuthPort.checkGate` — only a launch (saved replay, or `exploreFrom`'s own launch) can trip the
  // launch gate.
  scratchPath: (key: string) => string
  signal?: AbortSignal
  /** Whether the breaker's own `enabled` flag currently allows a deep link at all this sweep — the
   *  one-time scheme probe at sweep start, folded through every prior node's attempts. */
  breaker: DeepLinkBreakerState
  /** This node's durable, cross-sweep rejection verdict, if any — see `evaluateDeepLinkAttempt`. */
  storedRejection: Parameters<typeof evaluateDeepLinkAttempt>[2]
  /** In-sweep memo of exact URLs already rejected this run — broader than `storedRejection` (also
   *  catches partial-prefix repeats) and sweep-scoped rather than durable; see
   *  `DeepLinkRejectionMemo`'s own doc comment in `exploration.ts`. */
  memoRejected(url: string): boolean
  /** Whether an in-component guard condition has already been observed closed in this build by an
   *  earlier node behind the same gate — see `GuardGateMemo` in `exploration.ts`. */
  guardGateClosed(condition: string): boolean
  /** All nodes with a `urlPath`, for `findRouteAncestor` on a not-found prefix. */
  nodesForAncestry: readonly DeepLinkAncestorNode[]
  /** Re-opens the sweep's known-good probe route and reports whether it still resolves — the device
   *  half of the breaker's `reprobe` decision (see this module's doc comment). Absent when the sweep
   *  found no eligible probe route at all, matching `tryDeepLink`'s original fallback to an immediate
   *  disable in that case. */
  reprobe?: () => Promise<boolean>
  /**
   * Whether this open's arrival is confirmed by the vision judge. Omitted means true — the
   * behaviour every sweep had before the switch existed.
   *
   * False does **not** mean "no judge for this open": it means "no judge for a route with no
   * params". A route that declares params keeps the judge regardless of this flag — see
   * `routeDeclaresParams` for the eight-capture measurement behind that. So this field is the
   * sweep's setting, and the strategy narrows it per node; nothing outside this module decides it.
   *
   * False is the sweep-wide "do not spend a model call on a deep link" setting
   * (`AppFlowBuildOptions.deepLinkArrivalJudge`): the model call is skipped entirely and the open
   * is taken at its word *unless* `not-found-signal.ts` recognises the build's own 404 screen in
   * the controls read off the frame. Everything downstream — the `deep-link-not-found` effect, the
   * ancestor-prefix fallback, the breaker exemption, the durable rejection — is driven by the
   * synthesised verdict's `status` exactly as it was by the judge's, so none of that control flow
   * has a second code path. The switch only applies here; exploration's own judge calls are
   * untouched, because a walk has no "the URL resolved" to fall back on.
   */
  arrivalJudge?: boolean
  /**
   * What the judge-free not-found check knows about this build's fallback screen. Only read when
   * `arrivalJudge` is false; see `NotFoundEvidence`.
   */
  notFoundEvidence?: NotFoundEvidence
}

function checkSignal(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new Error('Cancelled')
}

/** Builds a failed, device-untouched attempt — the shape shared by every short-circuit below. */
function skip(reason: string, effects: ReachEffect[] = []): ReachAttempt {
  return {
    strategy: 'deep-link',
    ok: false,
    reason,
    touchedDevice: false,
    elapsedMs: 0,
    effects
  }
}

/**
 * Whether a truncated deep-link prefix is itself a screen the app declares.
 *
 * Compared against the same node list the ancestor lookup already uses, so this costs nothing and
 * needs no new input. Trailing slashes are ignored because a route's `urlPath` and a prefix built
 * by cutting segments off one can disagree about them, and `node` itself is excluded so a route
 * can never be judged a known prefix of itself.
 */
/**
 * How long the straddle retry waits for the late screen before re-shooting it.
 *
 * Sized from the gap the reference sweep actually showed between the wrong frame and the right
 * one: ProfileFollowers settled (wrongly) at t=241.663 and the real 9-control screen was read at
 * t=242.574, PostLikedBy settled at t=460.369 and the real screen read at t=461.150 — both inside
 * a second. 1.5s covers those with margin and is a ceiling, not a cost: `waitForRoute` returns the
 * moment two reads agree, which on this device is ~0.4s.
 *
 * Short on purpose. This is a second wait on a screen the app has already routed to, and the thing
 * it is insuring against — a capture that photographs the previous screen — is already paid for by
 * the time we get here; spending a full settle timeout again would turn a ~1s repair into the kind
 * of per-node cost the whole deep-link rung exists to avoid.
 */
const FRAME_RESETTLE_TIMEOUT_MS = 1_500

/**
 * Whether this route is one the arrival judge is kept for even when the sweep switched it off.
 *
 * **The decision this encodes.** `deepLinkJudgeMode: 'off'` means "do not spend a model call
 * confirming a deep link; the screen's own controls will tell us if the build rendered its 404".
 * That is a sound trade for `/settings` or `/lists` — a route with a fixed URL either resolves or
 * renders the fallback, and `not-found-signal.ts` reads which. It is a much worse trade for a
 * detail screen addressed by a param, and `session_2026-10-13_14-33-40.log` priced the difference:
 * seven of the eight captures that stored a screenshot of one screen with the control list of
 * another were param routes (ProfileFollowers, ProfileFollows, ProfileKnownFollowers, PostLikedBy,
 * PostRepostedBy, PostQuotes, Profile). Those are the network-backed screens — the frame arrives
 * when the request does — and they are also the ones whose neighbours look most alike, so a wrong
 * capture there is the least likely to be noticed by anything downstream.
 *
 * **"Has params" means the route *declares* them, not that this open substituted one.** Two
 * reasons, both evidential. First, the risk is a property of the route, not of this attempt: a
 * screen whose content is fetched for a param is late-rendering whether the sweep resolved a value
 * for it from nav-state or fell back to a param-free prefix — and the partial case is if anything
 * worse off, since the URL it opens belongs to some *other* screen and the judge is the only thing
 * that can say which one it landed on. Second, declared params are knowable before the device is
 * touched and are identical on every run, while "a value was substituted" depends on whether
 * nav-state happened to yield one this time; deciding judge mode on that would make two runs of
 * the same sweep on the same build spend different money and produce differently-trustworthy
 * captures, which is not a property anyone can reason about.
 *
 * Note what this does *not* cover. NotificationSettings has no params at all and straddled anyway
 * (16 controls at the settle, 33 at the verify) — the judge is not what saves it, the frame-timing
 * fix is. This narrows the judge-free mode to the routes the evidence says are safe for it; it is
 * not a second line of defence against the straddle.
 *
 * Both forms the parser can produce are accepted: `params` (the declared list) and the `:name` /
 * `[id]` segments in `urlPath`, since a runtime-minted or hand-edited node can carry one without
 * the other.
 */
export function routeDeclaresParams(node: {
  params?: readonly string[]
  urlPath: string | null
}): boolean {
  if (node.params?.length) return true
  const path = node.urlPath ?? ''
  return path
    .split('/')
    .some(
      (segment) => segment.startsWith(':') || (segment.startsWith('[') && segment.endsWith(']'))
    )
}

function isKnownRoutePrefix(
  prefix: string,
  nodes: readonly DeepLinkAncestorNode[],
  self: { id: string }
): boolean {
  const wanted = prefix.replace(/\/+$/, '')
  if (!wanted || wanted === '/') return false
  return nodes.some(
    (candidate) =>
      candidate.id !== self.id && (candidate.urlPath ?? '').replace(/\/+$/, '') === wanted
  )
}

export async function deepLinkStrategy(
  input: DeepLinkInput,
  ports: ReachPorts
): Promise<ReachAttempt> {
  const startedAt = Date.now()
  const {
    node,
    unresolvedParams,
    params,
    budget,
    scratchPath,
    signal,
    breaker,
    storedRejection,
    memoRejected,
    guardGateClosed,
    nodesForAncestry,
    reprobe,
    arrivalJudge = true,
    notFoundEvidence
  } = input
  const withTiming = (attempt: ReachAttempt): ReachAttempt => ({
    ...attempt,
    elapsedMs: Date.now() - startedAt
  })

  if (!breaker.enabled) return withTiming(skip('Deep links are disabled for this sweep.'))
  if (!node.urlPath || budget.expired) {
    return withTiming(skip('No urlPath to open, or budget already exhausted.'))
  }
  // A root-path screen with no route group to stand in for it has no URL that means anything, and
  // opening an invented one buys a guaranteed 404 at the full price of an open, a settle, a
  // screenshot and a judge call — then votes that 404 against the breaker, as if an app that never
  // declared `bluesky://src` had said something about its own URL scheme. The walk is the only
  // honest route to such a screen, so fall through to it without touching the device.
  if (isUndeeplinkableRoot(node)) {
    return withTiming(
      skip(`${node.id} sits at "/" and this app declares no route group to open instead.`)
    )
  }

  const target = paramFreeDeepLink(node.urlPath, unresolvedParams)
  const named = unresolvedParams.map((key) => `:${key}`).join(', ')
  if (!target) {
    return withTiming(skip(`Deep link needs a real ${named} and no call site supplies one.`))
  }
  const partial = target !== node.urlPath

  // A truncated prefix is worth opening only when it is a screen this app actually has.
  //
  // `paramFreeDeepLink` returns the longest prefix carrying no unresolved param, on the sound
  // reasoning that apps routinely resolve a parameterised route's own prefix — `/profile/:name`
  // opens the signed-in user's profile — and that the arrival verifier is what decides whether it
  // landed. What that reasoning leaves out is the case where the prefix names nothing at all. On
  // Bluesky there is no `/profile` route, only `/profile/:name`, so opening it buys a guaranteed
  // 'Page not found' at the full price of an open, a settle, a screenshot and a 3.5s judge call —
  // 7.5s in the reference sweep — before the ladder falls through to the walk that was always the
  // answer. `memoRejected` above means that is paid once per prefix per sweep rather than once per
  // route, which is why this is a modest saving and not a large one, but it is a cost with no
  // possible upside: a prefix that is not a route cannot resolve to one.
  //
  // When the prefix *is* a known node, the open keeps its real value: a landing there produces
  // `deep-link-partial-landed`, and the orchestrator walks the last hop from a screen it now has
  // the app standing on, which is much cheaper than walking from launch.
  if (partial && !isKnownRoutePrefix(target, nodesForAncestry, node)) {
    return withTiming(
      skip(
        `Deep link needs a real ${named}, and "${target}" is not a route this app declares — ` +
          'nothing to open short of it.'
      )
    )
  }

  const stored = evaluateDeepLinkAttempt(node, target, storedRejection)
  if (stored.action === 'skip') return withTiming(skip(stored.reason))
  if (memoRejected(target)) {
    return withTiming(skip(`Deep link ${target} already rejected earlier this sweep.`))
  }
  // A sibling behind the same gate already proved, on the device, that this build renders the
  // fallback instead of the screen. Re-opening this one buys the same 'Page not found' frame at
  // the full price of an open, a settle, a screenshot and a judge call — the cost
  // `isUndeeplinkableRoot` above declines for the same reason. `failure: 'unavailable'` rather
  // than a plain skip because this is the settled answer about the build, not a rung giving way
  // to the next one: exploration cannot walk past a flag either, and the ladder must stop here.
  // Only a *full* open testifies about the node's own route — a truncated prefix 404ing says
  // nothing about the gate — so partials fall through to pay their own way.
  if (!partial && node.guard && guardGateClosed(node.guard.condition)) {
    return withTiming({
      ...skip(explainGuardGate(node.guard)),
      failure: 'unavailable'
    })
  }

  try {
    const opened = await ports.device.openDeepLink(
      partial ? { ...node, urlPath: target, params: [] } : node,
      params
    )
    checkSignal(signal)
    // Both halves of this result were previously discarded. `settled` is the one
    // `judgeProbeFrame` has always treated as decisive — an app that never reached a stable frame
    // is not testifying about the route — and `pressables` is the settle's own last read, which is
    // what the screenshot below is about to be compared against. See `RouteSettleResult`.
    const route = await ports.device.waitForRoute()
    // A route that still needs the judge even with the sweep's switch off — see
    // `routeDeclaresParams` for why param routes are the exception.
    const judgeThisOpen = arrivalJudge || routeDeclaresParams(node)
    // `withPressables`: this screen's controls are read while the judge is thinking rather than
    // after it answers — see that option's doc comment. On a mismatch they are simply dropped,
    // which costs nothing, because the read ran inside the judge's own latency either way.
    const { arrival, pressables } = await verifyWithDiagnostic(
      ports,
      node,
      scratchPath,
      'deep-link-check',
      budget,
      {
        withPressables: true,
        // The straddle check. Every input is already in hand: the open's own pre-open read, the
        // settle's last read, and the node's static vocabulary. See `reach/frame-stability.ts`.
        frameStability: {
          preOpen: opened.preOpenPressables ?? null,
          settled: route.pressables,
          targetCoverage: (observed) =>
            observed?.length
              ? expectedCoverage(fingerprint(observed), expectedNodeTokens(node))
              : null,
          resettle: async () =>
            (await ports.device.waitForRoute({ timeoutMs: FRAME_RESETTLE_TIMEOUT_MS })).pressables
        },
        // With the judge off, the open is a match by default and the one thing still worth
        // deciding is whether this is the build's own 404 — the single bit the rest of this
        // function branches on. A `mismatch`/`not-found` verdict is synthesised rather than
        // threading a null arrival through, so every call site below (and `ReachEvidence.arrival`,
        // and `AppFlowCapture.status`) keeps reading the same field it always read.
        verdictWithoutJudge: judgeThisOpen
          ? undefined
          : (pressables): ArrivalVerdict => {
              // An unsettled frame is not evidence about the route — the same asymmetry
              // `judgeProbeFrame` is built on. With the judge on, this is the judge's problem and
              // it has a picture to reason from; with the judge off, the default answer is
              // "match", and defaulting to a match off a frame the app never settled on would
              // record a screen the sweep never actually saw. In the reference run `waitForRoute`
              // returned true for all eight straddles, so this changes nothing there; it is here
              // because the alternative is to call an unanswered question answered.
              if (!route.settled) {
                return {
                  verdict: 'uncertain',
                  status: null,
                  reason: `${target} opened but the app never reached a stable frame, so nothing here says where it landed`
                }
              }
              const signal = detectNotFoundScreen(pressables, notFoundEvidence)
              return signal.notFound
                ? {
                    verdict: 'mismatch',
                    status: 'not-found',
                    reason: `${signal.reason} (detected without the arrival judge, rule: ${signal.rule})`
                  }
                : {
                    // Only reachable now for a node whose `unresolvedParams` do not match a route
                    // that declares any — a truncating open on a param route keeps the judge (see
                    // `routeDeclaresParams`), and a route with no params has nothing to truncate.
                    // Kept because it is still the correct synthesis for that shape and because it
                    // is what the rule reverts to if the param carve-out is ever narrowed.
                    //
                    // A *partial* open put the app on a prefix URL, never on this node — with the
                    // judge on, the judge is what said so. With it off, nothing on the frame can
                    // say so either, so a partial that is not a 404 is reported exactly as the
                    // judge reported it: a mismatch that landed on a real screen, which is the
                    // `deep-link-partial-landed` case and the bounded last hop below. Calling it a
                    // match would claim the target was reached by opening something else.
                    verdict: partial ? 'mismatch' : 'match',
                    status: 'ok',
                    reason: partial
                      ? `${target} opened a real screen short of the target (arrival judge disabled for deep links)`
                      : `${target} opened and the app did not render its not-found screen (arrival judge disabled for deep links)`
                  }
            }
      }
    )
    checkSignal(signal)

    // `uncertain` is the one verdict that is not an answer: the straddle check found the app never
    // left the screen it was on, or the frame never settled. Nothing about it is evidence — not
    // about this route (so no durable rejection and no in-sweep memo, which would skip the URL for
    // the rest of the sweep and, for the stored kind, for later sweeps too) and not about the URL
    // scheme (so no vote to the breaker, which disables deep links sweep-wide after enough of
    // them). The ladder simply falls through to the next rung, which is what an unanswered
    // question deserves.
    if (arrival.verdict === 'uncertain') {
      return withTiming({
        strategy: 'deep-link',
        ok: false,
        reason: `Deep link ${target} proved nothing: ${arrival.reason}`,
        touchedDevice: true,
        arrival,
        elapsedMs: 0,
        effects: []
      })
    }

    if (arrival.verdict !== 'match') {
      const effects: ReachEffect[] = [{ kind: 'deep-link-memo-rejected', url: target }]

      if (arrival.status === 'not-found' && !partial) {
        // Only the route's own URL can testify about the build — a prefix 404ing is a statement
        // about the prefix, and exploration answers it. This is a settled answer, not evidence
        // about the transport, so it never reaches the breaker.
        const ancestor = node.urlPath ? findRouteAncestor(node.urlPath, nodesForAncestry) : null
        const unavailableReason = explainUnavailable(node, ancestor?.capturedStatus ?? null)
        // Only when the *gate* is what explained it. `explainUnavailable` also returns a reason
        // for an ungated route 404ing under a branch already proven to resolve, and that one is a
        // fact about this node alone — there is no condition for siblings to share.
        if (unavailableReason && node.guard) {
          effects.push({ kind: 'guard-gate-closed', condition: node.guard.condition })
        }
        effects.push({
          kind: 'deep-link-rejection-recorded',
          nodeId: node.id,
          rejection: recordDeepLinkRejection(node, target, arrival.reason, new Date().toISOString())
        })
        effects.push({ kind: 'deep-link-not-found' })
        return withTiming({
          strategy: 'deep-link',
          ok: false,
          failure: unavailableReason ? 'unavailable' : undefined,
          reason:
            unavailableReason ?? `Deep link ${target} did not reach target: ${arrival.reason}`,
          touchedDevice: true,
          arrival,
          elapsedMs: 0,
          effects
        })
      }

      if (partial) {
        // A partial attempt opens a URL this node never declares, so a mismatch here is expected on
        // a param route and is never counted against the breaker. `arrival.status !== 'not-found'`
        // means the prefix landed on a real screen — Step 3f's case — reported as an effect for the
        // exploration strategy to pick up rather than acted on here; see this module's doc comment.
        if (arrival.status !== 'not-found') {
          const ancestorId = node.urlPath
            ? (findRouteAncestor(node.urlPath, nodesForAncestry)?.id ?? node.id)
            : node.id
          effects.push({
            kind: 'deep-link-partial-landed',
            seed: { id: ancestorId, urlPath: target, url: opened.url, app: opened.app }
          })
        }
        return withTiming({
          strategy: 'deep-link',
          ok: false,
          reason: `Deep link ${target} did not reach target: ${arrival.reason}`,
          touchedDevice: true,
          arrival,
          elapsedMs: 0,
          effects
        })
      }

      // A real mismatch on the node's own full URL — evidence the scheme itself may not be
      // routing, so it feeds the breaker.
      const { decision } = registerDeepLinkFailure(breaker, Boolean(reprobe))
      if (decision.action === 'disabled-immediately') {
        effects.push({ kind: 'deep-link-breaker-disabled' })
      } else if (decision.action === 'reprobe' && reprobe) {
        let stillRoutes = false
        try {
          stillRoutes = await reprobe()
        } catch {
          stillRoutes = false
        }
        const reprobed = applyDeepLinkReprobeResult(breaker, stillRoutes)
        effects.push(
          reprobed.enabled
            ? { kind: 'deep-link-breaker-success' }
            : { kind: 'deep-link-breaker-disabled' }
        )
      } else {
        effects.push({ kind: 'deep-link-breaker-failure' })
      }

      return withTiming({
        strategy: 'deep-link',
        ok: false,
        reason: `Deep link ${target} did not reach target: ${arrival.reason}`,
        touchedDevice: true,
        arrival,
        elapsedMs: 0,
        effects
      })
    }

    const effects: ReachEffect[] = [
      { kind: 'deep-link-opened', nodeId: node.id, opened },
      { kind: 'deep-link-breaker-success' }
    ]
    if (storedRejection) effects.push({ kind: 'deep-link-rejection-cleared', nodeId: node.id })
    return withTiming({
      strategy: 'deep-link',
      ok: true,
      reason: arrival.reason,
      touchedDevice: true,
      arrival,
      // The app is standing on the screen the judge just accepted and this strategy is done with
      // the device, so that frame is still what the screen looks like. Delivery takes it instead of
      // shooting the same screen a second time.
      evidence: {
        arrival,
        frame: diagnosticFramePath(scratchPath, 'deep-link-check'),
        pressables,
        replayScript: null,
        replayVerified: false
      },
      elapsedMs: 0,
      effects
    })
  } catch (error) {
    checkSignal(signal)
    const effects: ReachEffect[] = []
    // A thrown partial attempt is the same "expected sometimes to fail" case as a partial mismatch
    // above — still not evidence about the transport itself.
    if (!partial) {
      const { decision } = registerDeepLinkFailure(breaker, Boolean(reprobe))
      effects.push(
        decision.action === 'disabled-immediately'
          ? { kind: 'deep-link-breaker-disabled' }
          : { kind: 'deep-link-breaker-failure' }
      )
    }
    return withTiming({
      strategy: 'deep-link',
      ok: false,
      reason: `Deep link failed verification: ${error instanceof Error ? error.message : String(error)}`,
      touchedDevice: true,
      elapsedMs: 0,
      effects
    })
  }
}
