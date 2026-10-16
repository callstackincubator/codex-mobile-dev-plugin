/**
 * The interfaces through which reach logic touches the outside world — the device, the vision
 * judge, the auth gate, and the recording/publishing side effects a reach attempt produces.
 *
 * These exist so the reach-attempt closures in `orchestrator.ts` (the deep-link probe, the
 * saved-replay and deep-link attempts, and the exploration walk) can be read, and eventually moved
 * into `ladder.ts`/`strategies/*.ts`, without dragging `capture.ts`/`storage.ts` — and the Electron
 * runtime they load — along with them. `adapters.ts` is the only file allowed to implement these
 * against real device/storage values; everything else, including this file, stays plain data and
 * function signatures so it keeps running under `node --test`. See `reach/types.ts`'s doc comment
 * for the fuller rationale.
 *
 * Each method here is a direct match for one thing the current closures already do — nothing here
 * is a capability the reach logic does not already use today. Notably absent: a raw "close session"
 * or "replay for a fixed action list" method, because neither call site that wanted one survives —
 * candidate recordings are gone with the sweep's `.ad` scripts, and the state-variant pass is
 * explicitly out of scope. See `adapters.ts`'s doc comment for which orchestrator code this seam
 * does, and does not, cover.
 */
import type { AppFlowNode, AppFlowPressable } from '../../shared/app-flow.ts'
import type { AppFlowNavigationAction } from '../capture.ts'
import type { ActiveTimeBudget } from '../exploration.ts'
import type { ArrivalVerdict } from './types.ts'

/**
 * What one `replay.run` call needs. `platform`/`udid`/`keepSession` are omitted on purpose: every
 * reach-path call site sets them identically (the bound device's own platform and id, and
 * `keepSession: true` so the walk or the next step can keep acting in the same session), so they
 * are constants the adapter supplies rather than degrees of freedom any caller actually varies.
 */
export interface DeviceReplayOptions {
  /** The `.ad` script to replay. */
  path: string
  timeoutMs: number
}

/**
 * What one `waitForRoute` call learned: whether the app reached a stable frame, and the last
 * control read the settle poll took to decide that.
 *
 * `settled` was always here (as a bare boolean) and was always worth honouring — see
 * `judgeProbeFrame`, which treats an unsettled frame as uninterpretable rather than as a verdict.
 * The deep-link strategy discarded it for the whole life of that call, which was harmless in the
 * measured sweep (it came back true for all eight straddled nodes) and is still wrong: a frame the
 * app never settled on is not evidence about the route.
 *
 * `pressables` is the settle's own last read, handed back rather than re-taken. It is the second
 * half of `reach/frame-stability.ts`'s comparison — what the harness believed the destination was
 * at the moment it decided to photograph it — and, like the pre-open frame, nothing downstream can
 * recover it afterwards. Null when the poll ended on a failed read or never read anything.
 */
export interface RouteSettleResult {
  settled: boolean
  pressables: AppFlowPressable[] | null
}

export interface DeviceReplayResult {
  /** False means the replay ended with no active session — a base the caller cannot build on. */
  sessionActive: boolean
}

/**
 * Device operations a reach attempt performs directly. Every method already exists as a
 * `capture.ts` export or an inline `device.client.*` call in `orchestrator.ts` today —
 * `adapters.ts` is where each one is wired to the real thing.
 */
export interface DevicePort {
  replayRun(options: DeviceReplayOptions): Promise<DeviceReplayResult>
  /**
   * Opens the node's URL and reports where it was sent — plus, when the adapter had one, the frame
   * that was on screen immediately *before* it went (`preOpenPressables`). That frame costs
   * nothing: it is the liveness probe's own read, which `openDeepLink` already takes and used to
   * discard. It is here because it is half of `reach/frame-stability.ts`'s question, and nothing
   * downstream can reconstruct it — by the time the strategy sees anything, the app has moved.
   */
  openDeepLink(
    node: AppFlowNode,
    params: Record<string, string>
  ): Promise<{ app: string; url: string; preOpenPressables?: AppFlowPressable[] | null }>
  /** Settles after a route change; resolves to whether the app actually reached a stable frame.
   *  Callers that merely capture can ignore it — see `capture.ts`'s `waitForAppReady`.
   *
   *  `minInteractiveElements` raises the bar from "stable" to "stable and substantial", for the
   *  caller that cannot act on a frame it does not believe is the app yet. Without it such a
   *  caller has to re-enter this in a loop, and each re-entry throws away the poll state and
   *  re-pays the settle handshake — see `timeoutMs`'s partner option in `waitForAppReady`. */
  waitForRoute(options?: {
    minInteractiveElements?: number
    timeoutMs?: number
  }): Promise<RouteSettleResult>
  captureScreenshot(path: string): Promise<{ relaunched: boolean }>
  capturePressables(timeoutMs?: number): Promise<AppFlowPressable[]>
  executeNavigationActions(
    actions: readonly AppFlowNavigationAction[],
    timeoutMs?: number
  ): Promise<void>
  /**
   * Put the app back on its launch screen so a walk can start from a known place, optionally at
   * `url` (a deep-link seed's own URL).
   *
   * Replaces `startReplayRecording`, which did this *and* armed a `--saveScript` transaction. Only
   * the first half was ever about the walk. The second half is what forced `relaunch: true` — the
   * recorded script's first line had to be `open --relaunch` — and with it the cold start, the
   * bundle reload and the 20s dev-client launcher deferral the recording needed to survive. None
   * of that bought the walk anything, and the sweep no longer records, so this is a soft re-root:
   * an `apps.open` that hands the running app a URL instead of throwing its process away.
   *
   * The stored path's own baseline line (`baselineLaunchCommands`, `walk-commands.ts`) is the same
   * plain `open`, so what a consumer replays is what the sweep actually did.
   */
  resetToLaunch(url: string | null, timeoutMs: number): Promise<void>
  /**
   * Run a stored `pathToReach` line by line and leave the app where it ends — how a seeded walk
   * now reaches the screen it starts one hop from. See `path-run.ts`; it rejects on the first line
   * it cannot parse or execute, naming it, rather than silently landing somewhere else.
   */
  runPathCommands(commands: readonly string[]): Promise<void>
}

/**
 * The recording/publishing side of a reach attempt — saving a walk's candidate script as a
 * verified replay, or discarding one that did not pan out. Kept separate from `DevicePort` because
 * each bundles more than one device call plus a filesystem effect (`saveAndReplayRecording` waits
 * on the destination guard, saves and — unless the caller defers it — closes and replays).
 *
 * Only `.ad` scripts the *manual recorder* produced still reach these methods. The sweep stopped
 * recording its own (see `DevicePort.resetToLaunch`), so `savedReplayStrategy` replaying a
 * hand-recorded journey, and the Replay button, are what keeps this port alive.
 */
export interface RecorderPort {
  /**
   * `repairArmed` must be true exactly when the walk being published started from a seed's
   * verified replay rather than a fresh recording — those two openings leave the session in
   * states agent-device publishes through different, mutually exclusive calls. See
   * `saveAndReplayRecording` in `capture.ts` for which call each one needs and what the
   * mismatch costs.
   *
   * `verifyByReplay: false` saves and publishes without replaying, leaving the script unverified
   * until something seeds off it. See the same function for what that defers and why the sweep
   * takes it.
   */
  saveAndReplayRecording(
    scriptPath: string,
    destinationSelector: string,
    timeoutMs?: number,
    options?: { repairArmed?: boolean; verifyByReplay?: boolean }
  ): Promise<void>
  /**
   * Replay an already-published script and repair it in place if it diverges — the verification
   * `saveAndReplayRecording` defers, run by whoever first needs the script to work. Resolves when
   * the app is on the destination with an active session; rejects when the recovery tier could not
   * make the script replayable.
   *
   * `error` is a divergence the caller already holds from its own failed replay of this same
   * script. Passing it skips the opening replay, which would otherwise re-derive that same
   * divergence at a measured ~6.2s for no new information. A caller that has *not* replayed the
   * script omits it — for those this call is the replay, and resolving means the app is on the
   * destination with a live session.
   */
  verifyAndRepairReplay(
    scriptPath: string,
    destinationSelector: string,
    timeoutMs: number,
    error?: unknown
  ): Promise<void>
}

/**
 * The vision judge's arrival check — `verifyCurrentTarget`'s two-attempt retry loop today, moved
 * here so a strategy can ask "did I arrive" without importing `runAgent` or the arrival prompt
 * itself.
 */
export interface JudgePort {
  verifyArrival(
    node: AppFlowNode,
    screenshotPath: string,
    budget: ActiveTimeBudget
  ): Promise<ArrivalVerdict>
}

/**
 * The auth gate, as the reach logic is allowed to see it: a yes/no/exhausted check to run before
 * trusting whatever the device shows next. The gate's own implementation — the user prompt, the
 * checkpoint screenshot, `manifest.sweepStatus` — stays in `orchestrator.ts` permanently (see
 * `reach/adapters.ts`'s doc comment); this is only the seam a reach attempt calls it through.
 */
export interface AuthPort {
  checkGate(remaining: number, budget?: ActiveTimeBudget): Promise<'clear' | 'stop' | 'exhausted'>
}

// `ArtifactPort` is gone. Its one method, `publishScript`, renamed a walk's `.candidate.ad` into
// the node's published `.ad` — and nothing in the sweep records a candidate any more, so there was
// nothing left to publish. A walk's journey is now a command list on the capture
// (`AppFlowCapture.pathCommands`), which needs no file and no promotion step.

/**
 * Driving the app's own navigator, for the render reach path.
 *
 * Optional, and every caller must treat its absence as ordinary: it exists only when Metro is
 * reachable, the build exposes a DevTools hook, and a CDP target could be selected. A release
 * build, a stopped packager or a non-React-Native screen all mean "no render path today", which
 * is a reason to fall through to exploration, not an error.
 *
 * `navigate` dispatches and returns whether the dispatch was accepted — *not* whether the screen
 * arrived. `awaitSettled` then polls until the screen stops changing. They are separate because
 * the dispatch is one call and the settle is several, and a caller that only wants to know
 * whether a route is registered should not have to pay for the wait.
 */
export interface RenderSettleResult {
  settled: boolean
  reason: string
  /**
   * Readiness polls issued, for attributing the wait — each one is a full CLI eval, so this is the
   * unit the settle's wall-clock is made of. Diagnostic only; nothing branches on it.
   */
  polls?: number
  /**
   * Why the poll stopped: `settled`, `stable-not-quiet` (found, substantial and structurally
   * unchanged across several polls, but the runtime never declared quiet — a live feed, say),
   * `no-answer` (the runtime stopped replying), `budget` (the deadline was the caller's remaining
   * budget rather than the settle's own cap) or `timeout`.
   */
  stop?: 'settled' | 'stable-not-quiet' | 'no-answer' | 'budget' | 'timeout'
  /**
   * The last readiness snapshot's own fields, rather than only the prose `reason` they used to be
   * folded into.
   *
   * These are the decisive ones: together they say *which* screen the runtime believes is focused,
   * whether it is the one that was asked for, whether its parameters match, and how much it is
   * showing. That is enough for a caller to decide arrival without a model call — see
   * `RenderInput.arrivalJudge` in `strategies/render.ts`. Formatting them into a sentence and
   * throwing the values away is what forced every Fast screen through the vision judge.
   *
   * On a poll that never got an answer these carry their empty defaults (`found: false`,
   * `content: 0`, empty arrays and signature), which no caller may read as evidence of anything.
   */
  /** The focused route path the runtime last reported, outermost first. */
  active: string[]
  /** Whether the target screen's fiber was found and focused on the last poll. */
  found: boolean
  /** Host nodes under the screen carrying text, an image source or a label. */
  content: number
  /** Expected parameter keys whose live value differs — non-empty means the right route with the
   *  wrong record, which is precisely the confidently-wrong capture Fast must not take. */
  paramMismatch: string[]
  /** 32-bit structural hash of the screen, as of the last poll. */
  signature: string
}

/** Why the running navigator declined a dispatch — `NavigateReply`'s own `reason` codes, restated
 *  here so `reach/` keeps its distance from `cdp/agent-runtime.ts`. */
export type NavigateRefusal =
  | 'no-navigator'
  | 'no-dispatch'
  | 'no-expo-router'
  | 'unregistered'
  | 'invalid-route'
  | 'threw'

/**
 * Whether the render transport can be used at all right now, and when it cannot, why.
 *
 * The reason is a plain sentence, not a code: `reach/` must not know that the transport is a CDP
 * connection to a Metro inspector target, so the implementation (`orchestrator.ts`) phrases its own
 * failure and this layer only carries it. Two very different failures used to arrive here as the
 * same silent `false` — no Metro runtime to attach to, and an agent that would not install — and a
 * sweep that skipped every node said "Runtime transport unavailable." nine times without ever
 * saying which one it was.
 *
 * It is a product sentence, destined for a skip note and the local run log: no local paths, no
 * device identifiers, no credentials, and nothing here feeds telemetry — the existing
 * `app_flow.runtime.connect` series already carries the outcome.
 */
export type RenderAvailability = { ok: true } | { ok: false; reason: string }

export interface RenderPort {
  /**
   * Whether this transport can be used at all right now, with the reason when it cannot. Latched
   * by the implementation after its first answer, so a sweep never re-pays for a handshake that
   * already failed — and so every later node is told the same reason as the first.
   */
  available(): Promise<RenderAvailability>
  /**
   * Dispatches navigation to `node`, using `params` for its route parameters.
   *
   * `path` is the full root-to-leaf navigator path the app actually dispatched, once the in-app
   * resolver has located the route — the node's own id segments are only a request. Absent when
   * the runtime reported none (an Expo Router `replace`, which addresses a pathname rather than a
   * navigator path). `refusal` is the runtime's own reason code, so a caller can tell a navigator
   * that declined the route from a dispatch that threw mid-flight.
   */
  navigate(
    node: AppFlowNode,
    params: Record<string, string> | null
  ): Promise<{
    ok: boolean
    reason: string
    path?: string[]
    /** What the runtime actually did, for the per-run log. Absent on a refusal. */
    action?: 'expo-replace' | 'replace' | 'navigate' | 'noop'
    refusal?: NavigateRefusal
  }>
  /**
   * Polls until the screen stops changing, or the deadline passes. Resolves to whether the target
   * screen was found and settled; a false answer is a reason to stop waiting, never a verdict
   * about arrival, which stays with the judge.
   *
   * Takes the same `params` as `navigate` so a poll can tell the screen it asked for from another
   * instance of the same route — a dispatch in flight lands with the previous instance's params
   * for a poll or two, and settling on that would photograph the wrong screen.
   */
  awaitSettled(
    node: AppFlowNode,
    params: Record<string, string> | null,
    budget: ActiveTimeBudget
  ): Promise<RenderSettleResult>
}

/**
 * Where one node's run through the ladder is written down, for the per-run Fast log file.
 *
 * A pure sink, like every other interface here: `reach/` may not open a file, know a project
 * directory or import anything that loads the Electron runtime, so the strategies hand facts to
 * this and `orchestrator.ts` decides what becomes of them (`sweep-log.ts`). Absent is ordinary —
 * every call site must treat the whole port as optional and must never let it change what the
 * sweep does.
 *
 * The facts are the ones the rung already computed for its own `[app-flow]` console lines; nothing
 * here is measured twice. Deliberately absent: parameter *values* (the param store refuses to log
 * those for the same reason), screenshots, device identifiers and anything that feeds telemetry.
 * This file is local, and stays local.
 */
export interface SweepNodeLog {
  /** The route asked for (the node's own id, which is the parser's spelling of it) and what the
   *  in-app resolver turned it into — null when the navigator refused or reported no path. */
  route(requested: string, resolved: readonly string[] | null): void
  dispatch(entry: {
    ok: boolean
    action: 'expo-replace' | 'replace' | 'navigate' | 'noop' | null
    reason: string
    ms: number
  }): void
  settle(entry: { polls: number; stop: string | null; ms: number; content: number }): void
  verify(entry: { path: 'runtime' | 'judge'; verdict: string; ms: number }): void
  delivery(entry: { screenshotMs: number | null; pressables: number }): void
  /** Closes the record and appends it. Calling it twice appends once. */
  finish(entry: { status: string; totalMs: number }): void
}

export interface SweepLogPort {
  node(id: string): SweepNodeLog
  /**
   * The render transport could not be reached, and why — written once for the whole run, however
   * many nodes go on to skip for it. Per-node would be nine identical lines in a nine-node sweep,
   * which is how the failure stayed invisible in the first place; the implementation keeps the
   * first reason and ignores the rest (`sweep-log.ts`).
   *
   * Same privacy rules as every other record here: a reason phrased for a person, local only.
   */
  transportUnavailable(reason: string): void
}

/**
 * The three bounded aggregates the reach path contributes to Sentry, as a sink rather than as a
 * Sentry call — `reach/` stays free of the SDK, and `orchestrator.ts` supplies an implementation
 * built on its own `runtimeMetric` helper, so `MOBILE_DEV_TELEMETRY=off` is honoured in exactly
 * one place and the attribution (`surface: 'app-flow'`) is the one every other app-flow metric
 * already carries.
 *
 * Deliberately *not* a per-poll meter: the settle loop polls every 40ms, and a metric per poll is
 * precisely the frequent-sample case the telemetry guidance excludes. One measurement per settle,
 * per verification and per dispatch. Attributes are closed sets — no route names, no node ids.
 */
export interface ReachMetricsPort {
  /** One dispatch: whether the route was a root route, had to be located in a nested navigator,
   *  or was declined outright. */
  navigate(outcome: 'exact' | 'nested' | 'refused'): void
  /** One settle poll loop: how long it ran, and which exit it took. */
  settle(durationMs: number, stop: NonNullable<RenderSettleResult['stop']> | 'unknown'): void
  /** One arrival verification: how long it took, whether the runtime answered it or the vision
   *  judge had to, and the verdict that came back. */
  verify(durationMs: number, path: 'runtime' | 'judge', verdict: string): void
}

/** The full set of ports one `createReachPorts(...)` call produces — see `adapters.ts`. */
export interface ReachPorts {
  device: DevicePort
  recorder: RecorderPort
  judge: JudgePort
  auth: AuthPort
  /** Absent whenever the app's JS runtime cannot be reached; see `RenderPort`. */
  render?: RenderPort
  /** Absent outside Fast, and absent whenever the log could not be opened; see `SweepLogPort`. */
  sweepLog?: SweepLogPort
  /** Absent when nothing is collecting; see `ReachMetricsPort`. */
  metrics?: ReachMetricsPort
}
