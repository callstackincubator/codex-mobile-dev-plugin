/**
 * Picking the sweep's deep-link transport probe.
 *
 * The probe exists to answer one question before the sweep pays for it per node — does opening a
 * URL for this build route at all (`orchestrator.ts`'s call site, right after this picks the route
 * to try). Because one mismatch can disable the transport for every route, reliability matters more
 * than making the probe double as the first entry-screen capture. Parser order supplies the app's
 * first explicit, param-free route and is stable for a given structure. On Bluesky that route is
 * `/lists`, a known working URL; preferring the `/search` entry route instead caused one target
 * mismatch to disable `/lists`, `/moderation`, and every other deterministic deep link for the
 * remainder of the sweep.
 *
 * The probe result is now reusable as the route's capture, so selecting `/lists` is no longer the
 * duplicate work that originally motivated entry-screen preference: a successful probe both proves
 * the transport and captures Lists without a second open.
 *
 * No device or Electron import here — see `reach/types.ts`'s doc comment. Only `adapters.ts` may
 * import `capture.ts`/`storage.ts` values.
 */
import { isFallbackRoute } from './sweep-order.ts'
import type { ArrivalVerdict } from './types.ts'

/** The subset of a node `pickProbeRoute` needs. */
export interface ProbeRouteNode {
  id: string
  title: string
  urlPath: string | null
  params: readonly string[]
}

/** A route is even eligible to be probed at all: it has a URL, needs no params to fill in (a probe
 *  is a one-shot open, not a full navigation), is not a `+not-found`/error-boundary route that no
 *  deep link should ever be judged against, and does not sit at the root path.
 *
 *  Root paths are excluded because `capture.ts`'s `buildUrlPath` cannot deep-link `/` directly —
 *  opening the bare scheme does not switch tabs — so it substitutes a *guess* from
 *  `indexDeepLinkPath` (the Expo Router route group, or failing that the first segment of the
 *  source file path). That guess is fine for a per-node capture attempt, where a wrong guess costs
 *  one node its deep link and the walk takes over. It is disqualifying for the probe, whose whole
 *  job is to decide whether the URL scheme works *for the entire sweep*: a failed open tells you
 *  nothing about the scheme when the URL itself was invented. Observed on Bluesky, a React
 *  Navigation app, where `HomeTab/Home` (`urlPath: '/'`, file `src/view/screens/Home.tsx`) probed
 *  as `bluesky://src` — a path the app has never heard of — and its inevitable mismatch disabled
 *  deep links for all 84 routes, forcing every one of them into a blind exploration walk. */
function isEligibleProbeRoute<T extends ProbeRouteNode>(node: T): boolean {
  return (
    Boolean(node.urlPath) &&
    node.urlPath !== '/' &&
    node.params.length === 0 &&
    !isFallbackRoute(node)
  )
}

/**
 * The route the sweep should open first to learn whether deep links work at all in this build, or
 * null when nothing in `nodes` is eligible. Parser order is deliberate — see this module's doc
 * comment for why the globally consequential probe does not prefer an entry screen.
 */
export function pickProbeRoute<T extends ProbeRouteNode>(nodes: readonly T[]): T | null {
  return nodes.find((node) => isEligibleProbeRoute(node)) ?? null
}

/**
 * The smallest interactive-element count a frame must carry before the probe is allowed to draw a
 * sweep-wide conclusion from it.
 *
 * `waitForRoute`/`waitForAppReady` report whether the app reached a *stable* frame, and a splash
 * screen is perfectly stable. On the social-app run that motivated this, the very first readiness
 * check settled with **2** interactive elements — a dev-client loading frame — the probe fired
 * `bluesky://lists` into it, and judged whatever rendered next. The judge said mismatch and deep
 * links went off for all 79 routes; the sweep then walked to `/lists` by hand and the same judge
 * called it a match, in 7 planner steps and 43.9s. The transport was never broken. The frame was.
 *
 * Five is set from what the same log shows a real screen looks like: the app's entry screen read 48
 * elements, `/lists` read 35, and the sparsest genuine screen in the sweep (`/moderation/modlists`,
 * an empty state) read 9. Nothing substantive came in under 9, and nothing non-substantive came in
 * over 2, so the floor sits between them and well clear of both.
 */
export const PROBE_FRAME_ELEMENT_FLOOR = 5

/**
 * Whether a frame carrying `elementCount` interactive elements is worth judging at all. A null
 * count means the read itself failed, which is not evidence either way and so is not substantive.
 */
export function isSubstantiveFrame(elementCount: number | null): boolean {
  return elementCount !== null && elementCount >= PROBE_FRAME_ELEMENT_FLOOR
}

/**
 * How long the probe may keep waiting for the app to render something substantive *before* it opens
 * the URL.
 *
 * A URL opened into an app that has not finished booting is not a test of the URL scheme: the dev
 * client has no navigator to hand it to yet, so the link is swallowed and the app later renders its
 * *default* screen. That frame is substantive, stable, and the wrong screen, which is exactly the
 * shape of a genuine transport failure. Nothing measured after the open can separate the two, so
 * the only reliable fix is to not open until the app can receive it.
 *
 * Thirty seconds is sized off the cold-cache bundle that produced the failure: Metro logged
 * `iOS Bundled 16079ms index.ts (6130 modules)` while the probe fired at ~3s and the app rendered
 * at ~16s. Double the observed worst case leaves room for a slower machine, and costs nothing on a
 * warm run, where the first read is already substantive and the wait never starts.
 */
export const PROBE_LAUNCH_READY_BUDGET_MS = 30_000

/** What `judgeProbeFrame` lets the probe conclude. Mirrors `probeDeepLinkRoute`'s own return. */
export type ProbeFrameJudgement = 'match' | 'mismatch' | 'inconclusive'

export interface JudgeProbeFrameInput {
  /** The arrival judge's verdict on the post-open frame, or null when it never produced one. */
  verdict: ArrivalVerdict['verdict'] | null
  /** Whether `waitForRoute` reported the app reached a stable frame after the open. */
  settled: boolean
  /** Interactive elements on the frame the judge looked at; null when the read failed. */
  elementCount: number | null
  /**
   * Whether the app was already showing a substantive frame at the moment the URL was opened.
   *
   * Required rather than defaulted because it is the one input a caller cannot reconstruct after
   * the fact, and getting it wrong is the mistake this field exists to prevent — see the mismatch
   * branch of `judgeProbeFrame`.
   */
  preOpenSubstantive: boolean
  /**
   * Whether the frame actually changed between the moment before the URL was opened and the frame
   * the judge looked at, or null when either read failed and the question cannot be answered.
   *
   * Null is deliberately not the same as `true`. A probe that cannot tell whether its URL did
   * anything is in exactly the position this whole module exists to be careful about, and the one
   * thing it must not do is resolve that doubt in favour of switching the transport off.
   */
  frameChangedAfterOpen: boolean | null
}

/**
 * What the probe may conclude from one frame — the whole asymmetry of the decision in one place.
 *
 * A `match` is always trustworthy: the judge recognising the target cannot be a false positive
 * produced by a thin frame, because a splash does not look like the destination. Everything else
 * has to clear three bars before it is allowed to disable the transport for the entire sweep. The
 * app must have been *ready when the URL was opened*, it must have settled afterwards, and the
 * frame judged must be substantive. `inconclusive` is the verdict that leaves deep links on for
 * `registerDeepLinkFailure`'s per-node breaker to judge on real evidence from real nodes — a
 * strictly better-informed judge than one screenshot.
 *
 * `preOpenSubstantive` is the bar that post-open evidence cannot substitute for, and the one a
 * cold-boot device log caught missing. The frame after the open read 34 elements, the judge
 * correctly called it the wrong screen, and the transport was switched off for 79 routes — because
 * the URL had been fired into an app that was still 13 seconds inside a 6130-module bundle load,
 * so it was swallowed and the app rendered its default screen. A mismatch judged off an app that
 * could not have received the URL is uninterpretable no matter how good the resulting frame looks:
 * element count cannot distinguish "the app ignored my URL because it was not ready" from "the URL
 * scheme does not work".
 *
 * `frameChangedAfterOpen` is the same bar read from the other end, and the one a *warm* run caught
 * missing. The app can be fully loaded, settled and substantive and still not have received the
 * URL — because something already on screen swallowed it. Measured on social-app: the sweep's own
 * entry-chrome pass opened the navigation drawer, its best-effort close tap failed silently
 * against a control the open drawer was covering, and 287ms later the probe fired `bluesky://lists`
 * into a modal. The post-open frame read the drawer's own 17 controls — ready, settled, richly
 * substantive, and the wrong screen — so every existing bar passed and deep links went off for all
 * 79 routes. No count can separate "the URL was swallowed" from "the scheme is broken", but the
 * frame not moving at all can: a URL that routed somewhere changes the screen, and one that did
 * nothing leaves it exactly as it was.
 *
 * The match branch returning first is what keeps that rule from misfiring on a legitimate "we were
 * already there" open, which is the one case an unchanged frame is the correct answer.
 *
 * The cost of getting this wrong is lopsided and was measured three times on device: wrongly
 * disabling costs every route its transport and sends each into a full exploration walk — on the
 * cold-boot run, 85,521 sweep tokens against 24,315 for the same eight screens with the transport
 * live — while wrongly *enabling* costs a few per-node attempts before the breaker trips. So
 * anything short of a ready-app, settled, substantive, confident mismatch on a frame that actually
 * moved defers.
 */
export function judgeProbeFrame(input: JudgeProbeFrameInput): ProbeFrameJudgement {
  if (input.verdict === 'match') return 'match'
  if (input.verdict === null || input.verdict === 'uncertain') return 'inconclusive'
  if (!input.preOpenSubstantive) return 'inconclusive'
  if (input.frameChangedAfterOpen !== true) return 'inconclusive'
  if (!input.settled) return 'inconclusive'
  if (!isSubstantiveFrame(input.elementCount)) return 'inconclusive'
  return 'mismatch'
}
