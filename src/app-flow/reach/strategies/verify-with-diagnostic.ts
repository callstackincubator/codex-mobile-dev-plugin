/**
 * `verifyWithDiagnostic`, moved out of `orchestrator.ts` verbatim. Every reach strategy that takes
 * its own confirmation screenshot (saved replay, deep link, and — once it moves out in landing-order
 * item 5 — the exploration strategy's replay-confirmation check) shares this exact sequence: take a
 * screenshot to a scratch path scoped by `suffix` so the three call sites never clobber each other's
 * diagnostic frame, treat a relaunched frame as an automatic mismatch (Step 1b's fix in
 * `capture.ts` means a missing-session recovery mid-strategy relaunches at the launch URL — asking
 * the vision judge about that frame would only ever produce a coincidental verdict), and otherwise
 * ask the judge port whether the node is on screen now, logging the verdict the same way every
 * caller already relied on for the console trail a device run is diagnosed from.
 *
 * It has since grown one thing that is not a move: the straddle check (`frameStability`). This is
 * the only place in the sweep that holds the screenshot and the control read together, which makes
 * it the only place that can notice they describe different screens — see
 * `reach/frame-stability.ts` for the eight captures that proved they sometimes do, and for why
 * the repair is a single re-settle and re-shoot rather than a fall-through to the next rung.
 */
import type { AppFlowNode, AppFlowPressable } from '../../../shared/app-flow.ts'
import type { ActiveTimeBudget } from '../../exploration.ts'
import { classifyFrameTransition, type FrameTransition } from '../frame-stability.ts'
import type { ReachPorts } from '../ports.ts'
import type { ArrivalVerdict } from '../types.ts'

/**
 * Where `verifyWithDiagnostic` writes the frame it shows the judge, for a caller that wants to
 * deliver that exact frame rather than take a second one of the same screen. Shared with the
 * function below so the scratch key is written once; a caller reconstructing the string itself
 * would silently stop matching the moment the key changed.
 */
export function diagnosticFramePath(scratchPath: (key: string) => string, suffix: string): string {
  return scratchPath(`verify-${suffix}`)
}

/**
 * The judge's verdict, plus the controls read alongside it when the caller asked for them.
 *
 * `pressables` is null whenever the read was not requested, or could not be taken — delivery falls
 * back to its own read in both cases, so a failure here costs a device call rather than a screen.
 */
export interface DiagnosticVerification {
  arrival: ArrivalVerdict
  pressables: AppFlowPressable[] | null
  /** What the straddle check made of the frame, when the caller asked for one — see
   *  `FrameStabilityCheck` and `reach/frame-stability.ts`. Absent when it was not run. */
  frameTransition?: FrameTransitionReport
}

/** The straddle check's own account of this verification, for the caller's log and capture note. */
export interface FrameStabilityReport {
  transition: FrameTransition
  reason: string
  /** Whether this verification re-settled and re-shot the screen because of it. */
  retried: boolean
}

type FrameTransitionReport = FrameStabilityReport

/**
 * What the caller must supply for the straddle check to run at all — three reads and one way to
 * wait again.
 *
 * Only the deep-link strategy passes this, and only because it is the one caller holding all
 * three frames: the open's own pre-open read, the settle poll's last read, and (through this
 * function) the read taken right after the screenshot. A replay or an exploration step has no
 * "the URL routed" moment to straddle, and nothing to re-settle against if it did.
 */
export interface FrameStabilityCheck {
  /** The frame before the URL was opened — `DevicePort.openDeepLink`'s `preOpenPressables`. */
  preOpen: readonly AppFlowPressable[] | null
  /** The settle poll's last read — `RouteSettleResult.pressables`. */
  settled: readonly AppFlowPressable[] | null
  /**
   * How much of the target node's own vocabulary a frame carries, for the `never-left` lookalike
   * exemption. Free to compute (`expectedCoverage` over `expectedNodeTokens`) and worth nothing
   * on any other branch, so it is a function the check calls at most once rather than a number
   * every caller has to produce up front.
   */
  targetCoverage?: (observed: readonly AppFlowPressable[] | null) => number | null
  /**
   * Wait once more for the screen to settle, and report its last read. Called only on `moved`, at
   * most once per verification.
   *
   * It is deliberately *not* a re-open: the URL already routed — that is what `moved` means — and
   * the screen simply arrived after the camera. Re-opening would restart a transition that had
   * already finished, and falling through to the next rung instead would send a working deep link
   * into an exploration walk, which cost 163s on ProfileList in the reference run and still
   * recorded the screen missing.
   */
  resettle: () => Promise<readonly AppFlowPressable[] | null>
}

export async function verifyWithDiagnostic(
  ports: ReachPorts,
  node: AppFlowNode,
  scratchPath: (key: string) => string,
  suffix: string,
  budget: ActiveTimeBudget,
  options?: {
    /**
     * Read this screen's controls while the judge is thinking, and return them with the verdict.
     *
     * The judge call is the longest stretch in the per-screen cycle that asks nothing of the device
     * — a few seconds of model latency with the runner sitting idle — while delivery then spends a
     * ~0.9s accessibility read on the same screen the moment the verdict lands. Issuing that read
     * against the idle window costs nothing in wall time and removes it from the serial path.
     *
     * Both are awaited together before this returns, so no device call is ever still in flight when
     * a caller moves on. That matters more than the saving: the iOS runner is documented as fragile
     * under overlapping accessibility work (see `openDeepLink` in `capture.ts`), and the only reason
     * this is safe is that the judge is a network call, leaving exactly one device command in
     * flight. Off by default so the callers that only want a verdict do not quietly start making an
     * extra device call each.
     */
    withPressables?: boolean
    /**
     * Decide arrival from the controls on screen instead of asking the model judge.
     *
     * Set only by the deep-link strategy, and only when the sweep turned the arrival judge off for
     * deep links (`DeepLinkInput.arrivalJudge`). Everything up to the judge is unchanged — the
     * scratch frame is still taken, and a relaunched frame is still an automatic mismatch without
     * consulting anything — so the evidence a successful reach hands to delivery is the same
     * whichever way the verdict was reached. The controls read is no longer optional here: it is
     * what the verdict is made of, so `withPressables` is implied.
     *
     * Exploration never passes this. Its judge calls are the sweep's way of knowing it arrived
     * anywhere at all, and nothing in a walk corresponds to "the URL resolved".
     */
    verdictWithoutJudge?: (pressables: readonly AppFlowPressable[] | null) => ArrivalVerdict
    /**
     * Check whether the screenshot and the control read describe the same screen, and re-shoot
     * once if they do not. See `FrameStabilityCheck` and `reach/frame-stability.ts`.
     *
     * Supplying this changes the order of the two calls below: the control read moves *in front*
     * of the judge instead of running inside its latency, because the whole point is that the
     * judge should be shown the frame that is actually on screen. That costs the ~0.15s the read
     * takes (measured at 0.14s on the reference run, t=242.432 → t=242.574) and buys a judge
     * verdict about the right screen; the alternative is to judge a frame already known to be
     * stale and then have to decide what the verdict was about.
     */
    frameStability?: FrameStabilityCheck
  }
): Promise<DiagnosticVerification> {
  if (budget.expired) {
    return {
      arrival: {
        verdict: 'uncertain',
        status: null,
        reason: 'Navigation budget exhausted before arrival verification.'
      },
      pressables: null
    }
  }
  // One scratch file per suffix rather than a screenshot per attempt under `screens/`: the three
  // call sites must not clobber each other's frame, but within a suffix each attempt supersedes the
  // last. A strategy whose reach succeeds may hand this path on as `ReachEvidence.frame` for
  // delivery to publish — see `diagnosticFramePath` — which is the only way one leaves scratch.
  const diagnostic = diagnosticFramePath(scratchPath, suffix)
  const shoot = async (): Promise<boolean> => {
    try {
      return (await ports.device.captureScreenshot(diagnostic)).relaunched
    } catch (error) {
      // Prefixed so `isToolingFailure` recognises it — a screenshot failure here says nothing about
      // whether the app is on the right screen, only that the harness could not look.
      throw new Error(
        `screenshot failed: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }
  const lostSession = (): DiagnosticVerification => ({
    arrival: {
      verdict: 'mismatch',
      status: null,
      reason: 'session was lost; the app was relaunched at its launch URL'
    },
    pressables: null
  })
  if (await shoot()) return lostSession()

  // THE STRADDLE CHECK — see `reach/frame-stability.ts` for the eight captures that motivated it.
  //
  // Everything in this block happens between the screenshot above and the verdict below, because
  // that is exactly where the bug lives: the frame on disk and the controls the verdict is made of
  // were read ~0.8s apart, and on a late-arriving screen they are two different screens.
  let stability: FrameStabilityReport | undefined
  let stabilityPressables: AppFlowPressable[] | null = null
  if (options?.frameStability) {
    const check = options.frameStability
    stabilityPressables = await ports.device.capturePressables().catch(() => null)
    const first = classifyFrameTransition({
      preOpen: check.preOpen,
      settled: check.settled,
      afterShot: stabilityPressables,
      targetCoverage: check.targetCoverage?.(stabilityPressables) ?? null
    })
    if (first.transition === 'moved') {
      console.log(
        `[app-flow] verify ${node.id} via ${suffix}: re-settling and re-shooting once — ${first.reason}`
      )
      // One retry, unconditionally accepted. A second round would be answering a question this
      // one already answered — the screen that arrived late has arrived — and the only thing left
      // to disagree about is a screen that genuinely never holds still, which no number of
      // re-shots fixes and which the settle poll's own timeout already bounds.
      const resettled = await check.resettle().catch(() => null)
      if (await shoot()) return lostSession()
      stabilityPressables = await ports.device.capturePressables().catch(() => null)
      const second = classifyFrameTransition({
        preOpen: check.preOpen,
        settled: resettled ?? check.settled,
        afterShot: stabilityPressables,
        targetCoverage: check.targetCoverage?.(stabilityPressables) ?? null
      })
      stability = {
        transition: second.transition,
        reason: `${first.reason}; re-shot after re-settling, and ${second.reason}`,
        retried: true
      }
    } else {
      stability = { transition: first.transition, reason: first.reason, retried: false }
    }
    if (stability.transition === 'never-left') {
      // Not a mismatch and not a match: the app is still on the screen it was on, so this frame is
      // evidence about nothing. Reported as `uncertain` so the ladder falls through to the next
      // rung without any of the things a mismatch triggers — no durable rejection, no vote against
      // the deep-link breaker, no guard-gate inference — and without spending a model call on a
      // frame already known to be the wrong screen. There is deliberately no re-open path here:
      // this case did not occur once in the reference sweep, so a recovery for it would be
      // untested code guessing at a failure nobody has measured.
      const arrival: ArrivalVerdict = {
        verdict: 'uncertain',
        status: null,
        reason: `the deep link did not move the app — ${stability.reason}`
      }
      console.log(`[app-flow] verify ${node.id} via ${suffix}: uncertain — ${arrival.reason}`)
      return { arrival, pressables: stabilityPressables, frameTransition: stability }
    }
  }

  // A note on the stored capture whenever the frame had to be taken twice, so a screen whose
  // screenshot was re-shot says so rather than looking like every other clean capture. It rides
  // the arrival's `reason` because that is what `decideDelivery` writes into `AppFlowCapture.note`.
  const noteRetry = (arrival: ArrivalVerdict): ArrivalVerdict =>
    stability?.retried
      ? { ...arrival, reason: `${arrival.reason} [frame: ${stability.reason}]` }
      : arrival

  if (options?.verdictWithoutJudge) {
    const pressables = stability
      ? stabilityPressables
      : await ports.device.capturePressables().catch(() => null)
    const arrival = noteRetry(options.verdictWithoutJudge(pressables))
    console.log(
      `[app-flow] verify ${node.id} via ${suffix} (no judge): ${arrival.verdict} — ${arrival.reason}`
    )
    return { arrival, pressables, frameTransition: stability }
  }
  // The read is already in hand when the straddle check ran, so the judge is asked on its own; with
  // no check it still runs inside the judge's latency, exactly as before. See `frameStability`.
  const [judged, pressables] = await Promise.all([
    ports.judge.verifyArrival(node, diagnostic, budget),
    stability || !options?.withPressables
      ? Promise.resolve(stabilityPressables)
      : ports.device.capturePressables().catch(() => null)
  ])
  const arrival = noteRetry(judged)
  console.log(`[app-flow] verify ${node.id} via ${suffix}: ${arrival.verdict} — ${arrival.reason}`)
  return { arrival, pressables, frameTransition: stability }
}
