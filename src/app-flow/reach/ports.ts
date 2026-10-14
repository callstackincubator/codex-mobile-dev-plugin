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
   * Why the poll stopped: `settled`, `no-answer` (the runtime stopped replying), `budget` (the
   * deadline was the caller's remaining budget rather than the settle's own cap) or `timeout`.
   */
  stop?: 'settled' | 'no-answer' | 'budget' | 'timeout'
}

export interface RenderPort {
  /**
   * Whether this transport can be used at all right now. Latched by the implementation after its
   * first answer, so a sweep never re-pays for a handshake that already failed.
   */
  available(): Promise<boolean>
  /** Dispatches navigation to `node`, using `params` for its route parameters. */
  navigate(
    node: AppFlowNode,
    params: Record<string, string> | null
  ): Promise<{ ok: boolean; reason: string }>
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

/** The full set of ports one `createReachPorts(...)` call produces — see `adapters.ts`. */
export interface ReachPorts {
  device: DevicePort
  recorder: RecorderPort
  judge: JudgePort
  auth: AuthPort
  /** Absent whenever the app's JS runtime cannot be reached; see `RenderPort`. */
  render?: RenderPort
}
