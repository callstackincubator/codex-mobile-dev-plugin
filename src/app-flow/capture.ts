import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, isAbsolute, join } from 'node:path'
import type { AppFlowNode, AppFlowPressable, AppFlowStep } from '../shared/app-flow.ts'
import {
  acceptOpenInAppPrompt,
  isUrlSchemePreapproved,
  preapproveIosUrlScheme,
  shouldPreapproveUrlScheme
} from '../server/app-flow-deps/ios/scheme-approval.ts'
import { retryWhileRunnerBusy } from '../server/app-flow-deps/ios/runner-busy.ts'
import {
  bundlerCliArgs,
  findAvailablePort,
  isExpoProject,
  isMetroReady,
  isReactNativeCliScript,
  parseMetroPortFromOutput
} from '../server/app-flow-deps/metro/port.ts'
import { beginSessionMetroLog, endMetroLogFile, pipeChildToMetroLog } from '../server/app-flow-deps/metro/logs.ts'
import {
  devClientReconnectUrl,
  fingerprint,
  isDevClientLauncher,
  isFrameUnchangedSinceAction,
  isLoadingScreen,
  needsDevClientReconnect,
  similarity
} from './screen-signals.ts'
import { quoteCliArg } from './cli-args.ts'
import { agentDeviceOpenCommand } from './walk-commands.ts'
import { launcherDeferralMs, type LauncherDeferralOutcome } from './launcher-deferral.ts'
import {
  armRecording,
  needsRearm,
  noteOpenWhileArmed,
  suppressesSoftHome,
  type ArmedRecording
} from './armed-recording.ts'
import type { Phase, PhaseLedger } from './timing.ts'
import {
  indexDeepLinkPath,
  isAmbiguousSelectorMessage,
  describeSessionLoss,
  isSessionLostMessage,
  serializeLocator
} from './exploration.ts'
import { PROBE_FRAME_ELEMENT_FLOOR } from './reach/probe-route.ts'
import { describeReplayDivergence, parseStructuralOnlyMismatchStep } from './replay-divergence.ts'
import { unguardPressSteps } from './ad-script.ts'
import { getProjectDir } from './storage.ts'
import { computeNativeBuildFingerprint } from '../server/app-flow-deps/native-build.ts'
import { createAppFlowNativeBuildStore } from '../server/app-flow-deps/native-build-store.ts'
import type { NativeBuildStore } from '../server/app-flow-deps/native-build.ts'
import { parseInteractionTarget, toAgentDeviceTarget } from '../server/app-flow-deps/profiling/transition-target.ts'
import { appFlowAgentDeviceStateDir, appFlowDataDir, getAppFlowHost, resolveAgentDeviceCommand } from './host.ts'

export interface CaptureContext {
  projectPath: string
  projectId: string
  scheme: string | null
  appName: string | null
  bundleId: string | null
  slug: string | null
  platform: 'ios'
  sessionName: string
  signal?: AbortSignal
  /**
   * Where this sweep's wall clock is tallied, or absent to measure nothing.
   *
   * Optional, and carried on the context rather than held in a module-level singleton, because a
   * manual capture session runs alongside a sweep with its own device and its own clock — a global
   * would silently bill one run's reads to the other's summary. Every device primitive worth timing
   * already takes `ctx`, so this reaches all of them without threading a new parameter.
   */
  timing?: PhaseLedger
}

const LAUNCH_TIMEOUT_MS = 10 * 60 * 1000
/**
 * How long the frame from before a launch is disbelieved — and, only when there is no such frame to
 * compare against, a flat sleep before the first readiness poll.
 *
 * Deliberately shorter than the launch itself takes: it was never sized to cover a cold start, only
 * to stop the very first accessibility read landing on a process that has not drawn a single frame
 * yet. Everything beyond that is `waitForAppReady`'s stability poll, which has the full
 * `APP_READY_TIMEOUT_MS` to work with and catches a slow start by construction.
 *
 * It is no longer usually spent at all. A relaunch is nearly always preceded by a successful read,
 * so the poll can tell a frozen pre-launch frame from the app's first real one by comparing them,
 * and a warm relaunch — where the first read is already the new screen — pays nothing. This value
 * then bounds only how long an *unchanged* frame is held, which is the same window the sleep was
 * approximating. Measured on a warm simulator run: the first poll after this wait already read a
 * fully drawn screen, i.e. the whole thing was dead time on the common path.
 */
const APP_LOAD_WAIT_MS = 1_500
const APP_READY_TIMEOUT_MS = 90 * 1000
/**
 * How long a frame that has *settled below* `minInteractiveElements` is given to grow before the
 * wait gives up on the floor and returns.
 *
 * Separate from `timeoutMs` because the two bound different failures. `timeoutMs` is sized for a
 * cold 6130-module bundle that has not drawn anything yet; this is sized for an app that has drawn
 * something and the caller does not believe it. Collapsing them would mean a genuinely sparse
 * first screen — a login form is three controls — holding the sweep for the full 90s to learn
 * what the first settle already said.
 *
 * Twenty seconds, from two launches of the same app that disagreed: the first went substantive
 * 12.5s after the poll first settled on a splash, the second about 18s after. Fifteen was set from
 * the first alone and the second missed it by seconds — the wait gave up at 2 elements and the
 * auth gate's own wait, running straight afterwards, found 20 elements in 1.7s.
 *
 * That near-miss is also why this is sized generously rather than tightly. Expiring here is a
 * handoff, not a failure: `AUTH_GATE_FRAME_WAIT_MS` holds the identical floor immediately
 * downstream, so the cost of being slightly short is a re-paid settle handshake, while the cost of
 * being long is a genuinely sparse first screen — a login form is three controls — waiting this
 * out before anyone looks at it. Both are small; the second is the one that scales with nothing,
 * so the number sits above the measurements rather than between them.
 */
export const SUBSTANTIVE_FRAME_GRACE_MS = 20 * 1000
/** Quiet window `startReplayRecording`'s recorded `wait stable` requires before it calls the UI
 *  settled — agent-device's own default, which is tuned for exactly this open/relaunch case. */
const APP_STABLE_QUIET_MS = 500
/** Ceiling for that same wait. Far below `APP_READY_TIMEOUT_MS` because this one is best-effort:
 *  when it gives up, `waitForAppReady` is still ahead of it with the full budget, so spending the
 *  whole 90s here would only delay the wait that can actually rescue a slow start. */
const APP_STABLE_TIMEOUT_MS = 20 * 1000
/**
 * How long the recorded entry gate waits for the walk's first press target — see
 * `pendingEntryGate` on `CaptureDevice`.
 *
 * Two clocks share this one number, which is the point of it. Live it resolves on the first check,
 * because the gate is only ever issued against an element the planner just read off the screen, so
 * it costs the walk nothing. At *replay* time the same line becomes the budget for a cold app to
 * draw the screen that element is on, which is the entire reason the gate exists, so it cannot be
 * short. 15s matches the destination guard `saveAndReplayRecording` appends at the other end of the
 * script: the two are the same mechanism pointed at opposite ends of a journey, and there is no
 * reason for them to disagree about how long an app gets to render a screen.
 */
const ENTRY_GATE_TIMEOUT_MS = 15 * 1000
/**
 * How long a dev-client launcher recovery is left to take effect before `waitForAppReady`
 * escalates to the next move.
 *
 * Sized for the slow half of what the first move has to do: reconnecting tells the dev client to
 * fetch and evaluate a debug bundle from Metro, which on a cold Metro is a full transform of the
 * app, not a reload. Too short and the poll relaunches the app out from under a reconnect that was
 * working; the cost of too long is only that a hopeless launcher is declared hopeless later, and
 * `waitForAppReady`'s own deadline still bounds that.
 */
const LAUNCHER_RECOVERY_GRACE_MS = 30 * 1000
/**
 * Sleep *between* readiness polls — not the interval between them.
 *
 * The distinction is the whole reason this is as low as it is: a poll is a `capturePressables`,
 * which measured 0.9–1.7s against a simulator, so the real spacing between two consecutive reads
 * is this value plus that. At the old 1_500 the effective spacing was ~3.1s and the cheapest
 * possible settle — two matching reads — cost ~4.6s on every screen, of which only the two reads
 * were doing any work. The question a second read answers is "is this still the same screen", and
 * the read's own latency already provides most of the separation that question needs.
 */
const APP_READY_POLL_MS = 400
/**
 * How alike two consecutive polls must be for the screen to count as settled. Matches the
 * exploration loop's own "nothing changed" bar, so the two agree on what one screen looks like
 * over time.
 */
export const APP_READY_SETTLE_SIMILARITY = 0.98
/**
 * How alike a settled frame must be to the frame from *before* the action for the settle to be
 * disbelieved as stale. Deliberately far below `APP_READY_SETTLE_SIMILARITY`, because the two
 * comparisons ask different questions and 0.98 answers the wrong one.
 *
 * 0.98 asks "is this the identical render". The stale guard's question is "is this still the
 * screen we came from" — and a frame caught *mid-transition* is neither: it is a composite, the
 * outgoing screen with some of the incoming one drawn over it. Measured on
 * `session_2026-10-13_14-33-40.log`, ProfileFollowers: the pre-open frame was Profile's own
 * delivery read at t=235.945 (30 controls), the settle at t=241.663 agreed twice on **46**
 * controls, and the delivery read 0.9s later found **9** — the real Followers screen. A 46-control
 * composite sitting over a 30-control profile clears 0.98 trivially (it is 16 controls richer), so
 * the guard was live, compared, and waved the straddle through; the screenshot written to
 * `screens/profilefollowers.png` is the MyProfile screen, verified by eye.
 *
 * 0.88 is set between the two things that have to stay apart. Above it: a composite that still
 * carries the old screen's controls, which is what this must catch. Below it: two genuinely
 * different screens, which must not be held — the same run's ProfileFollowers pair (46 mid-flight
 * vs 9 settled) and PostLikedBy's (52 vs 8) share almost no vocabulary at all. Being wrong in the
 * "hold" direction costs at most `ROUTE_STALE_GRACE_MS` of polling on a screen that had in fact
 * arrived; being wrong the other way costs a whole wrong capture, which is what this run paid
 * eight times.
 */
export const APP_READY_STALE_SIMILARITY = 0.88
/** Consecutive failing accessibility reads after which `waitForAppReady` stops waiting. */
const APP_READY_MAX_READ_FAILURES = 3
/**
 * The router's own transition beat: how long the pre-open frame is disbelieved after a deep link.
 *
 * Was a flat sleep in front of the settle poll, and that is the only thing it ever covered. It used
 * to be sized as if it were the entire wait — 2.5s — which stopped being true once
 * `settleAfterRoute` put the stability poll behind it. Trimming it to 800ms left the last of the
 * problem in place: a deep link that has already landed by the time the poll starts still paid it,
 * which was 11 of these per sweep in an eight-screen run, ~9s of nothing.
 *
 * Now the window is measured instead. The poll compares what it reads against the frame from
 * before the open (`isFrameUnchangedSinceAction`), so an arrived screen settles on the first two
 * agreeing reads and only a screen that still looks like where it came from waits — after which
 * an unchanged frame is accepted, because a deep link to the screen the app is already on is a
 * legitimate no-op.
 *
 * What is left here is only the flat post-*tap* sleep `waitForRoute` pays (see that function). The
 * deep-link guard's ceiling moved to `ROUTE_STALE_GRACE_MS`, because 800ms turned out to be too
 * short for the guard and raising it here would have charged every tap in the sweep for it.
 */
const ROUTE_WAIT_MS = 800
/**
 * The ceiling on the *stale-frame* guard after a deep link — `ROUTE_WAIT_MS`'s other job, split
 * off from it because the two numbers are now sized by different measurements.
 *
 * `ROUTE_WAIT_MS` is still the flat sleep `waitForRoute` pays after a tap (~30 per sweep), where
 * raising it is a pure cost. This is the budget `settleAfterRoute` gives the guard to disbelieve a
 * frame that still looks like where we came from, where 800ms was demonstrably too short.
 * Measured on `session_2026-10-13_14-33-40.log`, PostLikedBy: `apps.open` at t=458.609,
 * `waitForAppReady` entered at t=459.188, and the first agreeing pair landed at t=460.369 — 1.18s
 * into the poll, past an 800ms grace that had therefore already expired before the guard had a
 * single pair to judge. The guard was not wrong there; it was never consulted. That settle agreed
 * on 52 controls, which is exactly PostThread's own count from its delivery read at t=454.565 —
 * the previous screen, photographed as `screens/postlikedby.png` while the real Liked By screen
 * (8 controls) arrived 0.8s later.
 *
 * 2000ms covers that case with room: every one of the eight straddles in that run had its real
 * screen in hand within ~1.0s of the first (wrong) agreeing pair. The cost is bounded and paid
 * only by a screen that genuinely has not moved, and only until it does — see
 * `ROUTE_STALE_MIN_REJECTED_PAIRS`, which is the half of this budget a fast machine cannot
 * silently opt out of.
 */
const ROUTE_STALE_GRACE_MS = 2_000
/**
 * Agreeing pairs the stale guard must reject before the wall-clock grace above is allowed to run
 * out on it.
 *
 * This exists because a millisecond budget alone is a guard that quietly disables itself on fast
 * hardware: the faster the accessibility read, the more likely the first agreeing pair lands after
 * the grace rather than inside it, which is precisely how PostLikedBy's guard came to be dead on
 * arrival at 1.18s against 800ms. Counting rejections instead states the intent directly — "do not
 * accept a frame that looks like where we came from until you have disbelieved it at least twice"
 * — and is invariant to how quick the device is.
 *
 * Two, not one: one rejection plus a poll interval is ~0.6s on the measured device, which is
 * inside the window the eight straddles landed in. Two takes the guard past it while costing a
 * genuinely-unchanged screen (a deep link to the screen the app is already on) two extra reads at
 * ~0.18s each before the grace clock even starts counting.
 */
const ROUTE_STALE_MIN_REJECTED_PAIRS = 2
/**
 * How recently a URL must have been opened for `settleAfterRoute` to measure the stale guard's
 * grace from it rather than from the wait itself. Generously longer than the ~0.5s gap it exists
 * to recover (see `staleClockStartedAt`) and far shorter than anything the sweep does between two
 * screens, so the stamp is either this settle's own open or ignored.
 */
const ROUTE_OPEN_CLOCK_MAX_AGE_MS = 5_000
/**
 * The quiet window agent-device must observe before it calls a post-action UI settled.
 *
 * Its default is 500ms and it is a flat cost on every tap and every text entry — ~30 of them per
 * sweep, which is where the `press` phase's 3.60s average largely comes from. 200ms is still
 * several frames of stillness at 60Hz, which is what the window is for: distinguishing "the screen
 * stopped changing" from "the screen is mid-transition". It is shortened rather than removed
 * because the thing it guards against, reading the pre-action frame as the result of the action,
 * is the failure that costs a whole wrong capture.
 */
const SETTLE_QUIET_MS = 200
/** Bound on the post-deep-link settle poll — see `settleAfterRoute`. Far below
 *  `APP_READY_TIMEOUT_MS` because a deep link that has not resolved within this long is a failed
 *  deep link, not a slow one, and the ladder has an exploration rung waiting behind it. */
const ROUTE_SETTLE_TIMEOUT_MS = 30 * 1000
/** Budget for `openDeepLink`'s one-read liveness probe — see its call site. Short because the only
 *  answer it is waiting for is "the process is drawing", and anything slower than this is the cold
 *  start the full `waitForAppReady` behind it exists to handle. */
const APP_ALIVE_PROBE_TIMEOUT_MS = 5 * 1000
/**
 * How old a read may be and still describe the frame the app was on *before* the caller's action.
 *
 * Deliberately far more generous than `APP_ALIVE_REUSE_MS`, which this was first written to share.
 * That one answers "is the process alive right now", where a ten-second-old yes is worthless. This
 * one answers "what was on screen before we acted", and nothing between the two reads touches the
 * device — the gap is almost always a model call — so age does not make the answer wrong.
 *
 * The asymmetry is what makes a loose bound safe. A before-frame that has gone stale can only
 * cause a *false hold*, it can never cause a false settle, and a false hold requires the stale
 * frame to still match what is on screen — which means it is the same screen after all. The bound
 * exists only to rule out a read from so long ago that the app may have been relaunched out from
 * under it.
 *
 * Sharing the 10s bar cost two launch sleeps per sweep in a measured run: every wait that followed
 * a model call found its read "too old" and fell back to sleeping, which is exactly the case the
 * comparison handles best.
 */
const FRAME_COMPARISON_MAX_AGE_MS = 60 * 1000

/**
 * How recently `capturePressables` must have succeeded for `openDeepLink` to take its word for it
 * instead of spending a snapshot on the liveness probe.
 *
 * The probe asks one question — "is this process alive and drawing" — and a read that came back
 * with interactive elements a moment ago has already answered it. On the sweep's hot path the
 * previous screen's delivery read is always that answer, so the probe was re-asking something the
 * harness had just been told, at ~0.9s of accessibility snapshot per screen.
 *
 * Bounded rather than unbounded because the thing it guards against is a *cold* process, and the
 * gap this covers is local bookkeeping — choosing delivery sources, copying a frame, writing the
 * checkpoint — not anything that can start the app over. Ten seconds is comfortably longer than
 * that gap and far shorter than a launch, so a reused answer is never one that had time to stop
 * being true; anything slower falls through and pays for the real read.
 */
const APP_ALIVE_REUSE_MS = 10 * 1000
// Match post-install CLI output only. xcodebuild prints "BUILD SUCCEEDED" before
// simctl install; treating that as done kills `expo run:ios` too early.
const NATIVE_INSTALL_SUCCESS_RE =
  /successfully launched the app|installed the app|opening on |opening .+ on /i
const EXPO_GO_APP_NAME = 'Expo Go'
const EXPO_GO_VERSION = '57.0.9'

function log(step: string, detail?: string): void {
  console.log(detail ? `[app-flow] ${step} — ${detail}` : `[app-flow] ${step}`)
}

/**
 * Times `work` against the sweep's ledger when one is attached, and otherwise just runs it.
 *
 * The `?? work()` fallback is what keeps `ctx.timing` optional at every call site instead of making
 * each primitive branch on it: a standalone or test context measures nothing and pays nothing, and
 * the primitive reads the same either way.
 */
export function measurePhase<T>(
  ctx: CaptureContext,
  phase: Phase,
  work: () => Promise<T>
): Promise<T> {
  return ctx.timing?.measure(phase, work) ?? work()
}

function agentDeviceBootCommand(): string {
  return 'agent-device boot --platform ios --target mobile'
}

function agentDeviceInstallCommand(app: string, appPath: string): string {
  return `agent-device install ${quoteCliArg(app)} ${quoteCliArg(appPath)} --platform ios`
}

// Moved to `walk-commands.ts`, the pure module the sweep's own `pathToReach` emission is built
// from — this line is one of the two command forms both producers write, and a second copy here is
// exactly how the two would drift. Re-exported so every existing `capture.ts` importer is
// unchanged.
export { agentDeviceOpenCommand } from './walk-commands.ts'

type AgentDeviceClient = Awaited<ReturnType<import('./host.ts').AppFlowAgentDeviceModule['createAgentDeviceClient']>>
type LaunchMode = 'native-run' | 'expo-go'

export interface CaptureDevice {
  client: AgentDeviceClient
  deviceId: string
  deviceName: string
  launchProcess: ChildProcess | null
  metroPort: number
  metroLogPath: string | null
  launchTarget: string
  launchUrl: string | null
  /**
   * The URL that tells an Expo dev client which Metro server to load, or `null` when this app is
   * not one (Expo Go, which carries its bundle URL in `launchUrl`, or a plain React Native build).
   *
   * Only ever used to recover from the dev client's launcher screen. It is deliberately *not*
   * `launchUrl`: `launchUrl` is the URL every ordinary launch and relaunch goes through, and
   * routing normal launches through the dev-client URL would reload the bundle on every session
   * recovery instead of just resuming the app that is already running.
   */
  devClientUrl: string | null
  useCustomScheme: boolean
  setupCommands: string[]
  schemePromptChecked: boolean
  /**
   * The most recent accessibility read that came back from this device, and when. Written by every
   * successful `capturePressables`; read only by `openDeepLink`'s liveness probe, which is a
   * question a recent enough read already answers — see `APP_ALIVE_REUSE_MS`.
   *
   * Deliberately not a cache of the *screen*: nothing may use this to decide what the app is
   * showing, only whether its process is up and drawing. The sweep moves the app constantly, so by
   * the time anything reads this the contents are usually a screen the app has already left.
   */
  lastRead: { at: number; pressables: AppFlowPressable[] } | null
  /**
   * When this device last had a deep-link URL handed to it (`apps.open` returning, in
   * `openDeepLink`), or null before the first one.
   *
   * Read by `settleAfterRoute` alone, as the moment the stale-frame guard's grace should be
   * measured from. It is on the device rather than passed as an argument because the open and the
   * settle are two separate calls made by two different modules — `openDeepLink` is a `DevicePort`
   * method and `waitForRoute` is another, with the deep-link strategy in between — so there is no
   * call frame that holds both. See `staleClockStartedAt` for the ~0.5s this recovers.
   */
  lastRouteOpenAt: number | null
  /**
   * Set by `startReplayRecording`, consumed by the next `pressWithLocator`: the recording has just
   * relaunched the app, so the press about to happen is the one that will run against a cold app
   * when this script is replayed, and it gets a recorded `wait` on its own target first.
   *
   * Carried on the device rather than passed down because the two functions are several frames
   * apart — recording starts in the orchestrator's exploration setup and the press happens inside
   * whatever `executeNavigationActions` call the planner's first decision produces — and there is
   * exactly one recording per device at a time, which is what makes a single flag sufficient.
   */
  pendingEntryGate: boolean
  /**
   * Whether a launcher deferral has already run its full length on this device without the
   * launcher clearing. Written by `waitForAppReady`, read by it on every later call to decide
   * whether deferring again is still worth the wait — see `launcher-deferral.ts`.
   */
  launcherDeferral?: LauncherDeferralOutcome
  /**
   * The `--saveScript` transaction currently open on this device, or null/absent while there is
   * none. Written by `startReplayRecording` and cleared by every site that finalises or discards
   * one; read by `goHome` and by `waitForAppReady`'s launcher recovery, which are the two places
   * in this module that can issue the "second successful open" agent-device refuses to publish
   * after — see `armed-recording.ts` for the measured sweep that made this necessary.
   */
  armedRecording?: ArmedRecording | null
}

/**
 * The action shape the navigation model exchanges during exploration. This is exactly `AppFlowStep`
 * (`shared/app-flow.ts`) — an alias, not a copy, so the persisted counterpart the reach pipeline writes
 * into `app-flow.json` (a recorded chrome's `reveal` steps, plan Step 4d) and the in-flight action
 * this module executes stay one type. Aliased here, rather than renamed at every call site, because
 * `AppFlowStep` had to move to `shared/app-flow.ts` (the renderer reads persisted steps too) while this
 * module's many call sites — `exploration.ts` imports `AppFlowNavigationAction` from here, not from
 * `shared/app-flow.ts` — did not need to change for that move.
 */
export type AppFlowNavigationAction = AppFlowStep

/**
 * A locator good enough to guard a saved recording with. Narrower than `AppFlowNavigationAction`'s
 * locator on purpose: it excludes `by: 'text'`, because agent-device only accepts a destination
 * guard whose *resolved node* carries an id or an accessibility label — see
 * `AppFlowNavigationDecision` below and `saveAndReplayRecording`.
 */
export interface AppFlowDestinationLocator {
  by: 'label' | 'id'
  value: string
}

export type AppFlowNavigationDecision =
  | { decision: 'act'; action: AppFlowNavigationAction; reason: string }
  /**
   * `destinationLocator` names a durable landmark on the screen the walk landed on, so the
   * recording of that walk can be published. agent-device refuses to write a script that has no
   * "portable destination guard" after its last mutating action: a `wait` on a selector whose
   * matched element has a recorded identity it can re-verify at replay time. Without one,
   * `sessions.saveScript` throws and the whole journey — already judged correct — is unpublishable,
   * which is exactly what happened to every exploration-based capture in the device run this field
   * was added for. It is optional because a missing or unusable locator must never cost us the
   * arrival itself; the caller falls back to a landmark read off the destination's own controls,
   * and failing that publishes nothing and keeps the arrival.
   */
  | { decision: 'arrived'; reason: string; destinationLocator?: AppFlowDestinationLocator }
  | { decision: 'blocked'; reason: string }

interface LoadAgentDeviceResult {
  createAgentDeviceClient: (config?: Record<string, unknown>) => AgentDeviceClient
}

interface PackageJson {
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

/**
 * Pins every agent-device daemon this app starts to one state directory.
 *
 * The sweep talks to agent-device two different ways: in-process through
 * `createAgentDeviceClient`, and by shelling out to the `agent-device` CLI for boot/install/open
 * (`spawnCommand` below). Each of those starts its own daemon, and a daemon holds the iOS runner
 * lease — `sessions.close()` deliberately does not release it ("close keeps a healthy iOS runner
 * warm by default"), so the lease outlives the session that took it.
 *
 * agent-device allows exactly two ways past a lease another daemon holds: a proxy logical-lease
 * takeover, which needs a `proxy` lease provider we do not use, and a same-state-dir takeover,
 * which compares `AGENT_DEVICE_STATE_DIR` against the owner's `ownerStateDir` (`runner-lease.js`).
 * With the variable unset that comparison reads an undefined current dir and can never match, so
 * *every* cross-daemon lease request is refused — the takeover path is not merely unlikely, it is
 * unreachable.
 *
 * That was the first of two things stopping replay scripts from being saved. On the sweep before
 * this fix every explored screen failed `saveAndReplayRecording`, HomeTab/Home naming the cause
 * outright — "iOS runner for <udid> is already owned by another agent-device daemon" — and the
 * rest surfacing it one level down as the replay's pre-action snapshot failing (`capture-failed`).
 * The sweep after it confirmed the lease is no longer the obstacle: HomeTab/Home published a
 * verified script, and the remaining failures had moved on to a different, later error inside a
 * replay that now actually ran (see `startReplayRecording`'s recorded stable wait for that one).
 *
 * Setting one dir for the whole app makes the in-process client and every spawned CLI daemon
 * same-state-dir peers, which is the takeover agent-device's own docs point at (its guidance for
 * the opposite fix — stop the owning daemon — assumes a CI shape where the two are meant to be
 * strangers; here they are the same app and should share). `spawnCommand` passes `process.env`
 * straight through, so assigning it here covers the CLI path too.
 */
function pinAgentDeviceStateDir(): void {
  if (process.env.AGENT_DEVICE_STATE_DIR?.trim()) return
  process.env.AGENT_DEVICE_STATE_DIR = appFlowAgentDeviceStateDir()
}

async function loadAgentDevice(): Promise<LoadAgentDeviceResult> {
  // Before the import, not after: the module reads AGENT_DEVICE_STATE_DIR when it initialises, and
  // a daemon started by an earlier CLI spawn must already agree with it.
  pinAgentDeviceStateDir()
  // agent-device is ESM-only; electron-vite emits CJS for the main process
  // with dynamicImportInCjs enabled so this import() is preserved at runtime.
  return getAppFlowHost().loadAgentDevice() as Promise<LoadAgentDeviceResult>
}

let nativeStore: { dataDir: string; store: NativeBuildStore } | null = null
function nativeBuildStore(): NativeBuildStore {
  const dataDir = appFlowDataDir()
  if (!nativeStore || nativeStore.dataDir !== dataDir) {
    nativeStore = { dataDir, store: createAppFlowNativeBuildStore(dataDir) }
  }
  return nativeStore.store
}

async function closeExistingSession(client: AgentDeviceClient): Promise<void> {
  try {
    await client.sessions.close()
  } catch {
    // No leftover session for this name.
  }
}

function detectPackageManager(projectPath: string): 'yarn' | 'pnpm' | 'bun' | 'npm' {
  if (existsSync(join(projectPath, 'yarn.lock'))) return 'yarn'
  if (existsSync(join(projectPath, 'pnpm-lock.yaml'))) return 'pnpm'
  if (existsSync(join(projectPath, 'bun.lockb')) || existsSync(join(projectPath, 'bun.lock'))) {
    return 'bun'
  }
  return 'npm'
}

function runScriptCommand(
  packageManager: string,
  script: string,
  extraArgs: string[] = []
): string {
  const extras = extraArgs.join(' ')
  if (packageManager === 'npm') {
    return extras ? `npm run ${script} -- ${extras}` : `npm run ${script}`
  }
  if (packageManager === 'bun') {
    return extras ? `bun run ${script} -- ${extras}` : `bun run ${script}`
  }
  return extras ? `${packageManager} ${script} ${extras}` : `${packageManager} ${script}`
}

async function readPackageJson(projectPath: string): Promise<PackageJson> {
  const pkgPath = join(projectPath, 'package.json')
  if (!existsSync(pkgPath)) {
    throw new Error(`No package.json found in ${projectPath}`)
  }
  return JSON.parse(await readFile(pkgPath, 'utf-8')) as PackageJson
}

async function readPlatformScript(
  projectPath: string,
  platform: 'ios' | 'android'
): Promise<string> {
  const pkg = await readPackageJson(projectPath)
  const script = pkg.scripts?.[platform]
  if (!script) {
    throw new Error(
      `package.json is missing an "${platform}" script. Add one (for example "ios": "expo run:ios") and retry.`
    )
  }
  return script
}

function classifyLaunchMode(script: string): LaunchMode {
  if (
    /\b(expo\s+run:|react-native\s+run-|run-ios|run:ios|run-android|run:android)\b/.test(script)
  ) {
    return 'native-run'
  }
  return 'expo-go'
}

function nativeDeviceArgs(script: string, deviceId?: string): string[] {
  const reactNativeCli = isReactNativeCliScript(script)
  if (!deviceId || /\s--(?:device|deviceId|udid)(?:\s|=|$)/.test(` ${script} `)) return []
  return [reactNativeCli ? '--udid' : '--device', deviceId]
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function attachAbort(child: ChildProcess, signal?: AbortSignal): () => void {
  const abort = (): void => {
    if (child.pid) child.kill('SIGTERM')
  }
  signal?.addEventListener('abort', abort, { once: true })
  return (): void => signal?.removeEventListener('abort', abort)
}

async function spawnCommand(
  command: string,
  cwd: string,
  signal?: AbortSignal
): Promise<{ child: ChildProcess; getOutput: () => string; getExitCode: () => number | null }> {
  // The CLI starts its own daemon, which must land in the same state dir as the in-process
  // client's — see `pinAgentDeviceStateDir`. `env: process.env` carries it through.
  pinAgentDeviceStateDir()
  const child = spawn('/bin/zsh', ['-lc', resolveAgentDeviceCommand(command)], {
    cwd,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe']
  })

  let output = ''
  const append = (chunk: Buffer): void => {
    output = (output + chunk.toString('utf-8')).slice(-12_000)
  }
  child.stdout?.on('data', append)
  child.stderr?.on('data', append)

  let exitCode: number | null = null
  child.on('exit', (code) => {
    exitCode = code
  })

  const detachAbort = attachAbort(child, signal)
  child.once('exit', detachAbort)

  return {
    child,
    getOutput: () => output,
    getExitCode: () => exitCode
  }
}

async function waitWhile(
  signal: AbortSignal | undefined,
  predicate: () => Promise<boolean> | boolean,
  timeoutMessage: () => string
): Promise<void> {
  const deadline = Date.now() + LAUNCH_TIMEOUT_MS
  log('waitWhile', `poll 1s, timeout ${LAUNCH_TIMEOUT_MS / 1000}s`)
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error('Cancelled')
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  throw new Error(timeoutMessage())
}

async function installNativeApp(
  ctx: CaptureContext,
  script: string,
  deviceId?: string
): Promise<{ child: ChildProcess | null; metroPort: number | null; metroLogPath: string }> {
  const reactNativeCli = isReactNativeCliScript(script)
  let metroPort: number | null = reactNativeCli ? await findAvailablePort() : null
  const extraArgs = [
    ...bundlerCliArgs({
      reactNativeCli,
      startBundler: true,
      port: reactNativeCli ? metroPort! : 0
    }),
    ...nativeDeviceArgs(script, deviceId)
  ]
  const command = runScriptCommand(detectPackageManager(ctx.projectPath), ctx.platform, extraArgs)
  log('install native app', `${command} (timeout ${LAUNCH_TIMEOUT_MS / 1000}s)`)
  const metroLogPath = await beginSessionMetroLog({
    userDataDir: appFlowDataDir(),
    projectId: ctx.projectId,
    sessionName: ctx.sessionName
  })
  const { child, getOutput, getExitCode } = await spawnCommand(command, ctx.projectPath, ctx.signal)
  pipeChildToMetroLog(metroLogPath, child)

  let launched = false
  const watch = (chunk: Buffer): void => {
    const text = chunk.toString('utf-8')
    if (NATIVE_INSTALL_SUCCESS_RE.test(text)) launched = true
    if (metroPort == null) {
      const parsed = parseMetroPortFromOutput(text)
      if (parsed) metroPort = parsed
    }
  }
  child.stdout?.on('data', watch)
  child.stderr?.on('data', watch)

  try {
    await waitWhile(
      ctx.signal,
      async () => {
        const exitCode = getExitCode()
        if (exitCode !== null && exitCode !== 0) {
          throw new Error(
            `"${command}" exited with code ${exitCode}.\n${getOutput().trim() || '(no output)'}`
          )
        }
        if (!(exitCode === 0 || launched)) return false
        if (metroPort == null) metroPort = parseMetroPortFromOutput(getOutput())
        return metroPort != null && (await isMetroReady(metroPort))
      },
      () =>
        `"${command}" timed out waiting for the native ${ctx.platform} install.\n${getOutput().trim() || '(no output)'}`
    )
  } catch (error) {
    if (child.pid) child.kill('SIGTERM')
    throw error
  }

  log('install native app', `app launched, Metro on ${metroPort} pid=${child.pid}`)
  return { child, metroPort, metroLogPath }
}

async function runUntilExit(command: string, cwd: string, signal?: AbortSignal): Promise<string> {
  const { child, getOutput, getExitCode } = await spawnCommand(command, cwd, signal)
  try {
    await waitWhile(
      signal,
      () => getExitCode() !== null,
      () => `"${command}" timed out.\n${getOutput().trim() || '(no output)'}`
    )
  } catch (error) {
    if (child.pid) child.kill('SIGTERM')
    throw error
  }

  const exitCode = getExitCode()
  if (exitCode !== 0) {
    throw new Error(
      `"${command}" exited with code ${exitCode}.\n${getOutput().trim() || '(no output)'}`
    )
  }
  return getOutput()
}

function stripAnsi(text: string): string {
  return text.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g'), '')
}

function resolveMaybeHomePath(filePath: string, cwd: string): string {
  if (filePath === '~') return homedir()
  if (filePath.startsWith('~/')) return join(homedir(), filePath.slice(2))
  if (!isAbsolute(filePath)) return join(cwd, filePath)
  return filePath
}

function parseExpoGoDownloadPath(output: string, cwd: string): string | null {
  const lines = stripAnsi(output)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const marker = 'Expo Go downloaded to'
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith(marker)) continue
    const rest = lines[i].slice(marker.length).trim()
    const candidate = rest || lines[i + 1]
    if (candidate) return resolveMaybeHomePath(candidate, cwd)
  }
  return null
}

async function findDownloadedExpoGo(
  cwd: string,
  platform: 'ios' | 'android'
): Promise<string | null> {
  const entries = await readdir(cwd).catch(() => [])
  const suffix = platform === 'android' ? '.apk' : '.app'
  const hit = entries.find((entry) => entry.toLowerCase().endsWith(suffix))
  return hit ? join(cwd, hit) : null
}

async function downloadExpoGo(ctx: CaptureContext): Promise<string> {
  const projectDir = getProjectDir(ctx.projectId)
  const existing = await findDownloadedExpoGo(projectDir, ctx.platform)
  if (existing && existsSync(existing)) return existing

  const command = `npx -y expo-go download ${ctx.platform} ${EXPO_GO_VERSION}`
  log('download Expo Go', `${command} (timeout ${LAUNCH_TIMEOUT_MS / 1000}s)`)
  const output = await runUntilExit(command, projectDir, ctx.signal)
  const fromLog = parseExpoGoDownloadPath(output, projectDir)
  if (fromLog && existsSync(fromLog)) return fromLog

  const fromDir = await findDownloadedExpoGo(projectDir, ctx.platform)
  if (fromDir) return fromDir

  throw new Error(
    `Could not determine the Expo Go download path after "${command}".\n${output.trim() || '(no output)'}`
  )
}

async function ensureMetro(
  ctx: CaptureContext
): Promise<{ child: ChildProcess; metroPort: number; metroLogPath: string }> {
  const pkg = await readPackageJson(ctx.projectPath)
  const packageManager = detectPackageManager(ctx.projectPath)
  const expo = isExpoProject(pkg)
  let metroPort = expo ? null : await findAvailablePort()
  const portArgs = ['--port', expo ? '0' : String(metroPort)]
  const command = pkg.scripts?.start
    ? runScriptCommand(packageManager, 'start', portArgs)
    : expo
      ? 'npx expo start --port 0'
      : `npx react-native start --port ${metroPort}`
  log('start Metro', `${command} (poll 1s, timeout ${LAUNCH_TIMEOUT_MS / 1000}s)`)

  const metroLogPath = await beginSessionMetroLog({
    userDataDir: appFlowDataDir(),
    projectId: ctx.projectId,
    sessionName: ctx.sessionName
  })
  const { child, getOutput, getExitCode } = await spawnCommand(command, ctx.projectPath, ctx.signal)
  pipeChildToMetroLog(metroLogPath, child)
  const watch = (chunk: Buffer): void => {
    if (metroPort != null) return
    const parsed = parseMetroPortFromOutput(chunk.toString('utf-8'))
    if (parsed) metroPort = parsed
  }
  child.stdout?.on('data', watch)
  child.stderr?.on('data', watch)

  try {
    await waitWhile(
      ctx.signal,
      async () => {
        const exitCode = getExitCode()
        if (exitCode !== null && exitCode !== 0) {
          throw new Error(
            `"${command}" exited with code ${exitCode}.\n${getOutput().trim() || '(no output)'}`
          )
        }
        if (metroPort == null) metroPort = parseMetroPortFromOutput(getOutput())
        return metroPort != null && (await isMetroReady(metroPort))
      },
      () => `"${command}" timed out waiting for Metro.\n${getOutput().trim() || '(no output)'}`
    )
    log('metro status', `running on ${metroPort}`)
    return { child, metroPort: metroPort!, metroLogPath }
  } catch (error) {
    if (child.pid) child.kill('SIGTERM')
    throw error
  }
}

function matchInstalledApp(apps: string[], candidates: Array<string | null>): string | null {
  const installed = apps.map((app) => app.trim()).filter(Boolean)
  for (const candidate of candidates) {
    if (!candidate) continue
    const hit = installed.find(
      (app) => app === candidate || app.toLowerCase() === candidate.toLowerCase()
    )
    if (hit) return installedAppLaunchTarget(hit)
  }
  for (const candidate of candidates) {
    if (!candidate) continue
    const needle = candidate.toLowerCase()
    const hit = installed.find((app) => app.toLowerCase().includes(needle))
    if (hit) return installedAppLaunchTarget(hit)
  }
  return null
}

function installedAppLaunchTarget(app: string): string {
  const formattedApp = app.match(/^.+\s+\(([A-Za-z0-9_.-]+\.[A-Za-z0-9_.-]+)\)$/)
  return formattedApp?.[1]?.trim() || app
}

async function listInstalledApps(
  client: AgentDeviceClient,
  platform: 'ios' | 'android'
): Promise<string[]> {
  return (await client.apps.list({ platform }).catch(() => [])) as string[]
}

async function ensureExpoGoInstalled(
  client: AgentDeviceClient,
  ctx: CaptureContext
): Promise<{ launchTarget: string; installPath: string | null }> {
  const apps = await listInstalledApps(client, ctx.platform)
  const existing = matchInstalledApp(apps, [EXPO_GO_APP_NAME, 'host.exp.Exponent'])
  if (existing) {
    log('Expo Go already installed', existing)
    return { launchTarget: existing, installPath: null }
  }

  const appPath = await downloadExpoGo(ctx)
  log('apps.install', appPath)
  const result = await client.apps.install({
    appPath,
    platform: ctx.platform
  })
  return {
    launchTarget: result.app || result.appId || EXPO_GO_APP_NAME,
    installPath: appPath
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * agent-device's client throws its `AppError` for every failed call, and that error's `.message`
 * is not the only place session-loss wording can land. `replay.run` in particular wraps a divergent
 * step in "Replay failed at step N (...): <cause>", and when the divergence handler's own
 * post-failure snapshot attempt is what actually hits the dead session, the cause it records is a
 * generic `Could not capture a fresh snapshot to verify the recorded target before acting
 * (capture-failed)` — the literal "no active session" wording `isSessionLostMessage` matches never
 * reaches `.message` at all, only `AppError`'s `details.hint` ("Post-failure snapshot capture
 * failed (<underlying error message>)"), one level down, where the real wording is interpolated.
 *
 * This is NOT, however, what was stopping replay scripts from being saved — an earlier version of
 * this comment claimed it was, and the 2026-09-23 sweep disproved it: not one replay recovered
 * here, because the underlying message was "iOS runner ... is already owned by another
 * agent-device daemon", a lease conflict rather than a dead session. That cause is addressed at
 * its source by `pinAgentDeviceStateDir`. The hint check stays because a genuinely lost session
 * still surfaces through this same wrapper and is worth one recovery attempt, but it is a
 * secondary path, not the fix for the lease problem.
 */
function agentDeviceErrorHint(error: unknown): string | undefined {
  const details = (error as { details?: unknown } | null | undefined)?.details
  const hint = (details as { hint?: unknown } | undefined)?.hint
  return typeof hint === 'string' ? hint : undefined
}

/**
 * What agent-device knows about a divergent replay step, flattened into one log line.
 *
 * `AppError.message` for a `REPLAY_DIVERGENCE` says which step failed and which of the two target
 * codes it was, and that is all it says. The reason sits one level down in `details.divergence`,
 * which agent-device's own error hint points at — "Read details.divergence (screen/suggestions)
 * for repair context" — and which this project has been throwing away at every catch site.
 *
 * That cost two rounds of inference on the same failure. `IDENTITY_MISMATCH` on
 * `press id="bottomBarProfileBtn"` was read as a readiness race, on the reasoning that the
 * recorded identity is positional (`"sibling":7,"viewportOrder":0`) and a half-rendered tree would
 * index differently; the fix was a recorded `wait stable` after the entry gate, and the 14-09-09
 * sweep recorded that wait, honoured it, and failed on the identical step with the identical code.
 * Timing is therefore ruled out and the recorded settle has been reverted. `targetBinding` is the
 * field that would have said so in one run rather than two: `mismatches` names the identity
 * components that differed and `candidates` lists what else in the tree carried the recorded
 * identity, so a positional drift and a genuinely duplicated control are no longer the same
 * observation.
 *
 * Returns undefined rather than throwing or logging on anything unexpected: this runs inside catch
 * blocks whose job is to report the original failure, and a diagnostic that can mask the error it
 * was added to explain is worse than no diagnostic.
 */
function isMissingSessionError(error: unknown): boolean {
  if (isSessionLostMessage(errorMessage(error))) return true
  const hint = agentDeviceErrorHint(error)
  return hint !== undefined && isSessionLostMessage(hint)
}

async function openAppSession(
  client: AgentDeviceClient,
  app: string,
  options?: {
    url?: string | null
    relaunch?: boolean
    udid?: string
    /** The sweep's ledger, when the caller has one. See `CaptureContext.timing`. */
    timing?: PhaseLedger
  }
): Promise<void> {
  const launchTarget = installedAppLaunchTarget(app)
  const url = options?.url?.trim() || null
  // The scheme preapproval is inside the measurement on purpose. It is a `simctl` call of its own,
  // it happens only on the open path, and billing it anywhere else would leave the sweep's single
  // most repeated device action under-reported by however long it takes.
  const open = async (): Promise<void> => {
    if (url && options?.udid && shouldPreapproveUrlScheme(url)) {
      log('preapprove url scheme', `${url} → ${launchTarget}`)
      await preapproveIosUrlScheme({ udid: options.udid, url, bundleId: launchTarget })
    }
    log(
      'apps.open',
      `${launchTarget}${url ? ` ${url}` : ''}${options?.relaunch ? ' --relaunch' : ''}`
    )
    await client.apps.open({
      app: launchTarget,
      platform: 'ios',
      ...(url ? { url } : {}),
      ...(options?.relaunch ? { relaunch: true } : {})
    })
  }
  await (options?.timing?.measure('open-url', open) ?? open())
}

/**
 * Clears the simulator's first-open "Open in <app>?" confirmation, when there is one to clear.
 *
 * Skipped outright once `preapproveIosUrlScheme` has written the scheme's launch-services approval
 * for this simulator: there is then no prompt to find, and looking for one is not free. The probe
 * runs an `alert` command, whose main-thread block enumerates SpringBoard while the app it just
 * launched is still cold — the runner abandons that block when the enumeration outlives its budget,
 * and then refuses every snapshot behind it with RUNNER_BUSY until it drains. On this sweep that
 * cost the first deep link its whole route-settle window and every one after it too, until the
 * runner passed its wedge threshold and was recycled. The pre-approval is what actually suppresses
 * the prompt; this is only the fallback for when writing it failed.
 */
async function dismissOpenInAppPrompt(device: CaptureDevice, url?: string | null): Promise<void> {
  if (device.schemePromptChecked) return
  if (!url || !shouldPreapproveUrlScheme(url)) return
  if (isUrlSchemePreapproved(device.deviceId, url)) {
    device.schemePromptChecked = true
    log('ios open-in prompt', 'skipped — scheme preapproved')
    return
  }
  const result = await acceptOpenInAppPrompt(device.client)
  if (result === 'accepted' || result === 'absent') {
    device.schemePromptChecked = true
  }
  log('ios open-in prompt', result)
}

/**
 * Runs one `agent-device open` line from a stored `pathToReach`, prompt handling included.
 *
 * Exported for the manual recorder's Replay button, which walks a path against a `CaptureDevice`
 * rather than the `ProfilingDevice` `reachStartScreen` expects. It exists so `openAppSession` and
 * `dismissOpenInAppPrompt` can both stay private: the two always go together at the call sites
 * inside this module, and a caller that took only the first would reintroduce the first-open
 * "Open in <app>?" sheet that the second is there to clear.
 */
export async function openPathToReachApp(
  device: CaptureDevice,
  app: string,
  url: string | null
): Promise<void> {
  await openAppSession(device.client, app, { url, udid: device.deviceId })
  await dismissOpenInAppPrompt(device, url)
}

/**
 * Brings the bound app back after a lost session, and does not return until it is usable again.
 *
 * The wait is the point. Closing an agent-device session tears down the XCUITest runner, and the
 * app under test goes with it, so this is a *cold* launch however cheap the `apps.open` looks: the
 * command returns in about two seconds while the JS bundle is still loading and no navigator is
 * mounted yet. Both callers hand the app something to do the moment this resolves — one re-opens
 * the deep link it was in the middle of, the other screenshots — and a URL delivered into that gap
 * is not slow, it is *lost*: React Navigation rejects it ("the 'navigation' object hasn't been
 * initialized yet"), the app finishes launching on its default screen, and the arrival judge
 * truthfully reports a mismatch for a route that works perfectly well. A device run shows all three
 * of its deep links failing exactly this way, each one 1.4s after this relaunch, which was enough
 * to trip the breaker and send all 84 routes into full exploration walks.
 *
 * `waitForAppReady` returns as soon as the app settles, so a warm relaunch pays almost nothing and
 * only a genuinely cold start spends the timeout it needs.
 */
export async function reopenBoundApp(
  ctx: CaptureContext,
  device: CaptureDevice,
  timeoutMs = APP_READY_TIMEOUT_MS
): Promise<void> {
  await launchBoundApp(device, ctx.timing)
  await waitForAppReady(ctx, device, ctx.signal, timeoutMs)
}

/**
 * The launch half of `reopenBoundApp`, without the wait that follows it.
 *
 * Split out for `waitForAppReady`, which needs to relaunch a stalled app from *inside* its own
 * poll loop: calling `reopenBoundApp` there would re-enter `waitForAppReady` and nest one poll
 * loop inside another for as long as the app kept stalling.
 */
/**
 * Reconnect a dev client that is sitting on its launcher, by opening the bundle URL for it.
 *
 * This exists because `launchBoundApp` cannot do it. That function opens `device.launchTarget`
 * with `relaunch: Boolean(device.launchUrl)`, and a native dev-client build has no `launchUrl` —
 * `openInstalledApp` returns `launchUrl: null` for every `native-run` app, since its deep links
 * are fired individually rather than at launch. So the recovery reduced to `apps.open` with no URL
 * and no relaunch, against a process that was already frontmost: it brought the launcher to the
 * front of itself. The 2026-09-23 sweep logged the result exactly — sixteen detections, sixteen
 * `dev-client launcher still on screen after a relaunch`, no recoveries.
 *
 * A plain relaunch would not have fixed it either. The launcher is not a transient state the app
 * recovers from on restart; it is what the dev client shows when it has no bundle to run, so
 * restarting it shows the launcher again. What clears it is being told where Metro is, which is
 * the one thing a person does by hand and the sweep never did.
 *
 * Returns whether a reconnect was attempted, so the caller can fall back to an ordinary relaunch
 * for an app that has no dev client.
 */
async function reconnectDevClient(device: CaptureDevice, timing?: PhaseLedger): Promise<boolean> {
  if (!device.devClientUrl) return false
  log('reconnect dev client', device.devClientUrl)
  await openAppSession(device.client, device.launchTarget, {
    timing,
    url: device.devClientUrl,
    // The dev client is already running and showing its launcher; the URL is what it needs, not a
    // restart. Relaunching first would only throw away the process it is about to load into.
    relaunch: false,
    udid: device.deviceId
  })
  await dismissOpenInAppPrompt(device, device.devClientUrl)
  return true
}

/**
 * Restarts the already-running bound app so it comes up in a fresh state, without touching the
 * installed build or Metro.
 *
 * No longer on the adopt path, and the reason is a warning for any future caller: this opens
 * `device.launchUrl`, which is `null` for every `native-run` dev-client build (see
 * `openInstalledApp`), so on those builds it is a bare `--relaunch` with no bundle URL — and a
 * dev client restarted with nothing to load comes up on its *launcher*. The 2026-10-09 social-app
 * sweep is the record: a warm, settled Bluesky build was relaunched here at t=65.1s and the sweep
 * did not have a real screen again until t=93.6s, having burned the entry-chrome pass, two
 * `arrival` model calls against the Expo launcher, and a cached auth verdict read off a dead app.
 * `AppFlowBuilder`'s adopt branch now probes readiness and soft-homes instead.
 *
 * Kept because a caller that genuinely needs the process thrown away still has nothing else, and
 * because it is correct for any build that does carry a launch URL (Expo Go).
 */
export async function relaunchBoundApp(ctx: CaptureContext, device: CaptureDevice): Promise<void> {
  log('relaunch bound app', device.launchTarget)
  await openAppSession(device.client, device.launchTarget, {
    url: device.launchUrl,
    relaunch: true,
    udid: device.deviceId
  })
  await dismissOpenInAppPrompt(device, device.launchUrl)
  await waitForAppReady(ctx, device, ctx.signal)
}

/**
 * Re-roots the already-running bound app at its launch URL *without* restarting the process — the
 * cheapest way back to a known starting screen that exists on an agent-device harness.
 *
 * Identical to `relaunchBoundApp` above with the one flag flipped, and the flag is the whole
 * point. `openAppSession` only passes `relaunch: true` when asked, so this is an `apps.open` that
 * hands the running app a URL to navigate to instead of throwing its process away: no bundle
 * reload, no splash, no `iOS Bundled 16079ms (6130 modules)` on a cold cache. The app ends up
 * where a fresh launch would have put it, which is all a caller that just wants to stop being on
 * some half-explored screen actually needs.
 *
 * Measured through the ledger like the other opens (`open-url`, supplied by `openAppSession`),
 * because a soft home that turns out *not* to be cheap is exactly the kind of thing a sweep should
 * be able to read off its own timings rather than argue about.
 *
 * It is not a substitute for `relaunchBoundApp` where state must genuinely be thrown away: an app
 * carrying modal stacks, a dirty Redux store or a logged-in-as-someone-else session comes back
 * from this with all of it intact. Callers that need a *clean* app still relaunch.
 *
 * @param options.reconnectDevClientWhenUnloaded
 * For a build with no `launchUrl` of its own — which is every `native-run` dev client — re-root
 * through `reconnectDevClient` instead. Without it this function is silently a no-op on exactly
 * those builds: `openAppSession` with a null URL and no `--relaunch`, against a process that is
 * already frontmost, brings the app to the front of itself (`reconnectDevClient` records sixteen
 * consecutive recoveries that did nothing at all for this reason).
 *
 * Opt-in rather than automatic, because the two situations want opposite things from the same
 * URL. Opening `devClientUrl` makes the dev client re-fetch and re-evaluate the bundle — that is
 * a reload, with the splash and the `6130 modules` build behind it, which on the 2026-10-09
 * social-app sweep killed a warm app and cost 28s to climb back from. Only a caller that has
 * already established the app is *not* loaded (the adopt path in `orchestrator.ts`, after a
 * floored `waitForAppReady` came back false) may ask for it. `discardRecordingCandidate`, the
 * other caller, is soft-homing a live app mid-sweep and must keep the no-op.
 */
export async function goHome(
  ctx: CaptureContext,
  device: CaptureDevice,
  options?: { reconnectDevClientWhenUnloaded?: boolean }
): Promise<void> {
  // Suppressed, not reordered or removed. A soft home is an `apps.open` like any other, so issuing
  // one inside an armed `--saveScript` window is the "second successful open" that makes the
  // recording unpublishable — and this function's only caller mid-sweep
  // (`discardRecordingCandidate`) wants a tidy starting screen, which is worth strictly less than
  // the script. Its own doc comment already records why skipping is free here: the next site to
  // need a transaction opens with `relaunch: true` of its own, so the app is going back to its
  // launch screen regardless, just later and at nobody's extra expense.
  //
  // Only while the transaction is still *alive* — see `suppressesSoftHome`. A recording something
  // has already aborted has no publication left to protect, and holding the home back for the rest
  // of that walk would cost the tidy screen for nothing.
  if (suppressesSoftHome(device.armedRecording)) {
    log(
      'go home',
      `deferred — a recording is armed (${device.armedRecording?.scriptPath}) and opening the app here would abort it`
    )
    return
  }
  if (options?.reconnectDevClientWhenUnloaded && needsDevClientReconnect(device)) {
    // Delegated rather than reimplemented with `url: device.devClientUrl`: that function also
    // preapproves the scheme and clears the iOS "Open in?" sheet for this exact URL, and a second
    // copy of that sequence is a second thing to keep in step with the dev client.
    await reconnectDevClient(device, ctx.timing)
    await waitForAppReady(ctx, device, ctx.signal)
    return
  }
  log('go home', `${device.launchTarget}${device.launchUrl ? ` ${device.launchUrl}` : ''}`)
  await openAppSession(device.client, device.launchTarget, {
    timing: ctx.timing,
    url: device.launchUrl,
    relaunch: false,
    udid: device.deviceId
  })
  await dismissOpenInAppPrompt(device, device.launchUrl)
  await waitForAppReady(ctx, device, ctx.signal)
}

/**
 * Ends whatever agent-device session is live, swallowing the "there wasn't one" case.
 *
 * Every `--save-script` call opens a transaction, and agent-device refuses to arm a second one
 * over a live first — `stripIdentityAndReplay` documents the refusal it had to work around
 * ("would refuse to be replaced"). Since `saveAndReplayRecording` stopped closing the session it
 * publishes from (see the `else` branch there), a recording transaction can still be live when the
 * next node arms its own, so every site that arms one now ends the previous one here first.
 *
 * It is free wherever it is called from, which is why it can be unconditional: each of those sites
 * continues with a `replay.run` or an `apps.open --relaunch`, and every recorded `.ad` opens with
 * `open --relaunch` of its own — so the app was going to be restarted by the very next call
 * regardless of whether this closed it.
 */
export async function endLiveSession(device: CaptureDevice): Promise<void> {
  await device.client.sessions.close().catch(() => undefined)
  // Whatever `--saveScript` transaction that session owned went with it, unfinalized. Clearing the
  // marker is what lets `goHome` open the app again — holding the suppression past the end of the
  // recording it was protecting would cost every later soft home for nothing.
  device.armedRecording = null
}

async function launchBoundApp(device: CaptureDevice, timing?: PhaseLedger): Promise<void> {
  log(
    'reopen bound app',
    `${device.launchTarget}${device.launchUrl ? ` ${device.launchUrl}` : ''} --relaunch=${Boolean(device.launchUrl)}`
  )
  await openAppSession(device.client, device.launchTarget, {
    timing,
    url: device.launchUrl,
    relaunch: Boolean(device.launchUrl),
    udid: device.deviceId
  })
  await dismissOpenInAppPrompt(device, device.launchUrl)
}

async function openInstalledApp(
  client: AgentDeviceClient,
  ctx: CaptureContext,
  mode: LaunchMode,
  options: {
    expoGoTarget?: string
    udid: string
    metroPort: number
    /**
     * The dev-client reconnect URL to launch the native app with, or null to launch it bare.
     *
     * Only set when the native build was *skipped*. A build that actually ran has already launched
     * the app against the Metro it started, so opening it again with a URL would only throw that
     * process away. A skipped build has not: the dev client would cold-launch having never been
     * told where Metro is this session, land on its own launcher, and pay the recovery round trip
     * (reconnect, then relaunch) that the skip was meant to save.
     */
    devClientUrl?: string | null
  }
): Promise<{ launchTarget: string; launchUrl: string | null; useCustomScheme: boolean }> {
  if (mode === 'expo-go') {
    const launchTarget = options.expoGoTarget ?? EXPO_GO_APP_NAME
    const launchUrl = `exp://127.0.0.1:${options.metroPort}`
    await openAppSession(client, launchTarget, {
      url: launchUrl,
      udid: options.udid,
      timing: ctx.timing
    })
    return { launchTarget, launchUrl, useCustomScheme: false }
  }

  const apps = await listInstalledApps(client, ctx.platform)
  const nativeTarget = matchInstalledApp(apps, [ctx.bundleId, ctx.appName, ctx.slug])
  if (!nativeTarget) {
    const lookedFor =
      [ctx.bundleId, ctx.appName, ctx.slug].filter(Boolean).join(', ') || 'an app name'
    const installed = apps.filter(Boolean).slice(0, 20).join(', ') || '(none)'
    throw new Error(
      `Native ${ctx.platform} app was not installed after running the ${ctx.platform} script. Looked for ${lookedFor}. Installed: ${installed}.`
    )
  }

  await openAppSession(client, nativeTarget, {
    url: options.devClientUrl ?? null,
    udid: options.udid,
    timing: ctx.timing
  })
  return { launchTarget: nativeTarget, launchUrl: null, useCustomScheme: Boolean(ctx.scheme) }
}

/**
 * The launch target of an installed native build that still matches the project's native sources,
 * or `null` when the build has to be run.
 *
 * `npm run ios` is a full native build, install and launch on every invocation with no
 * short-circuit of its own, and on a warm machine it was still the single most expensive step in
 * the whole sweep — a measured 25-30s to reinstall a binary that was already on the simulator and
 * byte-identical to the one it replaced. It is only genuinely required when the *native* inputs
 * changed: a debug dev client fetches its JS bundle from Metro at runtime, which is why editing a
 * screen does not invalidate the installed app. So when the fingerprint still matches, Metro is
 * started directly and the app is opened against it, which is the state the build would have
 * handed back anyway.
 *
 * Both halves have to hold. The fingerprint says the binary would come out the same; the device
 * listing says that binary is still there — a simulator can be erased, or the record can describe
 * an app the user deleted by hand, and a stale record is worse than a slow build because every
 * later step would fail against an app that is not installed.
 *
 * `AI_HARNESS_FORCE_NATIVE_BUILD=1` opts out, for the case where the fingerprint is right and the
 * binary still is not — a half-finished install, or a native input this does not know to look at.
 *
 * Ported from the profiling pipeline, which has run this exact check for a while; the shared
 * fingerprint/record module now lives in `../native-build` so neither pipeline owns it. The records
 * are shared too, in one `userData/native-builds.json` keyed by project path, platform and device —
 * so a build this sweep pays for is reused by profiling and debugging, and clearing one pipeline's
 * results no longer throws away the other's install. See `createNativeBuildStore`.
 */
async function resolveReusableNativeBuild(
  client: AgentDeviceClient,
  ctx: CaptureContext,
  deviceId: string
): Promise<string | null> {
  if (process.env.AI_HARNESS_FORCE_NATIVE_BUILD === '1') {
    log('checkInstalledBuild', 'AI_HARNESS_FORCE_NATIVE_BUILD=1 — rebuilding')
    return null
  }
  const fingerprint = await computeNativeBuildFingerprint(ctx.projectPath, ctx.platform)
  if (!fingerprint) {
    log('checkInstalledBuild', `no ${ctx.platform}/ sources to fingerprint — rebuilding`)
    return null
  }
  const known = await nativeBuildStore().has(ctx.projectPath, ctx.platform, deviceId)
  const recorded = await nativeBuildStore().read(ctx.projectPath, ctx.platform, deviceId, fingerprint)
  if (!recorded) {
    log(
      'checkInstalledBuild',
      known
        ? 'native sources changed since the last install — rebuilding'
        : 'no install recorded for this device yet — building once'
    )
    return null
  }
  const apps = await listInstalledApps(client, ctx.platform)
  const installed = matchInstalledApp(apps, [recorded])
  if (!installed) {
    log('checkInstalledBuild', `${recorded} is no longer installed — rebuilding`)
    return null
  }
  return installed
}

/**
 * Boots the simulator this project was last built on, falling back to the daemon's own choice.
 *
 * Asking for a specific device is what makes the build record worth keeping: the record is keyed by
 * device, so letting the daemon pick afresh each run means reuse holds only while that pick happens
 * to be stable. It is a preference and never a requirement — the remembered simulator can have been
 * deleted, renamed or be missing from a different Xcode, and none of that is a reason to fail a
 * sweep that an unpinned boot would have run fine.
 */
async function bootPreferredDevice(
  client: AgentDeviceClient,
  ctx: CaptureContext
): Promise<{ device: string; id: string }> {
  const preferred = await nativeBuildStore().preferredDevice(ctx.projectPath, ctx.platform)
  if (preferred) {
    log('devices.boot', `platform=ios target=mobile udid=${preferred} (last built here)`)
    try {
      return (await client.devices.boot({
        platform: 'ios',
        target: 'mobile',
        udid: preferred
      })) as { device: string; id: string }
    } catch (error) {
      log(
        'devices.boot',
        `${preferred} unavailable (${errorMessage(error)}) — letting the daemon pick`
      )
    }
  } else {
    log('devices.boot', 'platform=ios target=mobile')
  }
  return (await client.devices.boot({
    platform: 'ios',
    target: 'mobile'
  })) as { device: string; id: string }
}

export async function bootDevice(ctx: CaptureContext): Promise<CaptureDevice> {
  const script = await readPlatformScript(ctx.projectPath, ctx.platform)
  const mode = classifyLaunchMode(script)
  log('bootDevice', `mode=${mode} session=${ctx.sessionName}`)

  const { createAgentDeviceClient } = await loadAgentDevice()
  const client = createAgentDeviceClient({
    session: ctx.sessionName,
    cwd: ctx.projectPath,
    responseLevel: 'digest'
  })

  log('sessions.close', 'drop leftover session if any')
  await closeExistingSession(client)

  const bootResult = await bootPreferredDevice(client, ctx)
  log('devices.boot', `device=${bootResult.device} id=${bootResult.id}`)

  const setupCommands = [agentDeviceBootCommand()]
  let expoGoTarget: string | undefined
  let launchProcess: ChildProcess | null = null
  let metroPort: number
  let metroLogPath: string | null = null
  let reusedNativeBuild = false
  if (mode === 'native-run') {
    const reusable = await resolveReusableNativeBuild(client, ctx, bootResult.id)
    if (reusable) {
      log('installNativeApp', `skipped — ${reusable} already installed and unchanged`)
      reusedNativeBuild = true
      const metro = await ensureMetro(ctx)
      launchProcess = metro.child
      metroPort = metro.metroPort
      metroLogPath = metro.metroLogPath
    } else {
      const installed = await installNativeApp(ctx, script, bootResult.id)
      launchProcess = installed.child
      metroPort = installed.metroPort ?? 0
      metroLogPath = installed.metroLogPath
      if (!metroPort) {
        throw new Error('Native install finished but Metro did not report a port.')
      }
    }
  } else {
    const expoGo = await ensureExpoGoInstalled(client, ctx)
    expoGoTarget = expoGo.launchTarget
    if (expoGo.installPath) {
      setupCommands.push(agentDeviceInstallCommand(expoGo.launchTarget, expoGo.installPath))
    }
    const metro = await ensureMetro(ctx)
    launchProcess = metro.child
    metroPort = metro.metroPort
    metroLogPath = metro.metroLogPath
    log('ensureMetro', `started pid=${metro.child.pid} port=${metroPort}`)
  }
  const devClientUrl = devClientReconnectUrl(ctx.scheme, mode === 'native-run', metroPort)
  const { launchTarget, launchUrl, useCustomScheme } = await openInstalledApp(client, ctx, mode, {
    expoGoTarget,
    udid: bootResult.id,
    metroPort,
    devClientUrl: reusedNativeBuild ? devClientUrl : null
  })
  if (mode === 'native-run' && !reusedNativeBuild) {
    // Hash the sources *after* the build, not before it. `expo run:ios` runs `pod install` and can
    // rewrite `Podfile.lock` and the Xcode project as part of the build, so a fingerprint taken up
    // front never matches again and no later session would ever skip.
    //
    // `openInstalledApp` has just proved the app is installed — it throws otherwise — so this
    // records a launch target that is known to be on the device.
    await nativeBuildStore().record(
      ctx.projectPath,
      ctx.platform,
      bootResult.id,
      await computeNativeBuildFingerprint(ctx.projectPath, ctx.platform),
      launchTarget
    )
  }
  log(
    'bootDevice done',
    `launchTarget=${launchTarget} launchUrl=${launchUrl ?? 'none'} devClientUrl=${devClientUrl ?? 'none'} metroPort=${metroPort} metroLog=${metroLogPath ?? 'none'} useCustomScheme=${useCustomScheme} nativeBuild=${mode === 'native-run' ? (reusedNativeBuild ? 'reused' : 'built') : 'n/a'}`
  )

  const device: CaptureDevice = {
    client,
    deviceId: bootResult.id,
    deviceName: bootResult.device,
    launchProcess,
    metroPort,
    metroLogPath,
    launchTarget,
    launchUrl,
    devClientUrl,
    useCustomScheme,
    setupCommands,
    schemePromptChecked: false,
    lastRead: null,
    lastRouteOpenAt: null,
    pendingEntryGate: false
  }
  await dismissOpenInAppPrompt(device, launchUrl)
  return device
}

function buildUrlPath(node: AppFlowNode, params: Record<string, string>): string {
  if (!node.urlPath) throw new Error(`Screen ${node.id} has no deep link`)
  const pattern = node.urlPath
  /**
   * A stand-in here opens whatever record the app happens to have at that id, and the screen that
   * comes back is photographed and judged as if it were the one that was asked for — or the 'not
   * found' that follows is indistinguishable from a route this build withholds. That is the one
   * failure a URL can produce that looks exactly like a finding, and it is why the param store's
   * rule is that a value is observed or it does not exist.
   *
   * Callers already decline to deep-link a route whose params are unfilled (`unresolvedParams`), so
   * reaching this is a caller bug, and throwing is what makes it one. A thrown deep link is a
   * failed rung, which the ladder falls through exactly as it falls through a skipped one.
   */
  const fill = (key: string): string => {
    const value = params[key]
    if (value === undefined) {
      throw new Error(
        `Screen ${node.id} has no observed value for :${key} — ${pattern} cannot be opened by URL`
      )
    }
    return value
  }
  const urlPath = pattern
    .split('/')
    .map((seg) => {
      if (seg.startsWith(':')) return fill(seg.slice(1))
      if (seg.startsWith('[') && seg.endsWith(']')) {
        return fill(seg.slice(1, -1).replace(/^\.\.\./, ''))
      }
      return seg
    })
    .join('/')

  // "/" does not switch the current tab, so a root-path screen needs a stand-in route — and
  // `indexDeepLinkPath` only ever returns a grounded one (see its doc comment for the invented
  // `bluesky://src` this used to produce). Null means this screen has no URL to open, which is
  // `deepLinkStrategy`'s cue to skip; reaching here with null means a caller bypassed that check.
  if (urlPath === '/' || urlPath === '') {
    const indexPath = indexDeepLinkPath(node)
    if (!indexPath) {
      throw new Error(
        `Screen ${node.id} sits at "/" and this app declares no route group to open instead — it has to be reached through the UI`
      )
    }
    return indexPath
  }

  return urlPath
}

async function wait(signal: AbortSignal | undefined, ms: number, label: string): Promise<void> {
  log(label, `${ms / 1000}s`)
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error('Cancelled')
    await sleep(Math.min(500, deadline - Date.now()))
  }
}

export async function waitForAppLoaded(signal?: AbortSignal): Promise<void> {
  await wait(signal, APP_LOAD_WAIT_MS, 'wait for app to load')
}

/**
 * Waits until the first real screen has mounted, rather than sleeping for a fixed time.
 * `APP_LOAD_WAIT_MS` alone is far too short for a cold dev-client launch: the app is still
 * bundling, so the screenshot (and any screenshot we hand an agent) is a splash screen.
 *
 * Polls the accessibility tree and returns once it holds interactive elements that are not
 * loading chrome and that stopped changing between two polls. On timeout it returns instead
 * of throwing — a slow app should still be captured, just with a warning in the log.
 *
 * Returns whether the app actually settled. Most callers ignore it and capture regardless, which is
 * the right default. It matters to callers that are about to draw a *conclusion* from the frame:
 * "the app never settled" and "the app settled on the wrong screen" look identical in a screenshot,
 * and only the second is evidence about anything. See the deep-link probe in `orchestrator.ts`,
 * where conflating the two switched deep links off for an entire 84-route sweep.
 */
export async function waitForAppReady(
  ctx: CaptureContext,
  device: CaptureDevice,
  signal?: AbortSignal,
  timeoutMs = APP_READY_TIMEOUT_MS,
  options?: {
    /**
     * How long to sleep before the first poll *when there is no recent read to compare against*.
     * Defaults to `APP_LOAD_WAIT_MS`, which is right after a launch the caller just issued.
     *
     * No longer the usual path: a read from moments ago makes this sleep measurable instead of
     * assumed — see `staleGraceMs` below — and the sleep is then skipped entirely. It remains the
     * fallback for the one case nothing can be measured in, a first launch with no prior read, and
     * a caller that knows the app is already up (`settleAfterRoute`) still passes 0.
     */
    initialWaitMs?: number
    /**
     * How long an unchanged frame is disbelieved before being accepted, when a read from just
     * before the caller's action is available to compare against. Defaults to `APP_LOAD_WAIT_MS`,
     * the launch case; `settleAfterRoute` passes `ROUTE_WAIT_MS`, the router-transition case.
     *
     * This is the budget that replaced both flat sleeps. The sleeps were never waiting for the app
     * to load — the poll below does that, with a real deadline — they were waiting out the window
     * in which the poll could read the *previous* screen twice and call it the result of the
     * action. That window is now detected rather than slept through, so a screen that has already
     * arrived pays nothing and only a screen that genuinely has not moved pays anything at all.
     *
     * A floor, and a live one. Reaching the check at all costs two accessibility reads, and a read
     * is cheap: the phase ledger of `session_2026-10-09_17-22-18.log` measures 0.18s each (120
     * calls, 21.9s total). Two agreeing reads therefore take roughly 0.4–0.5s, which is well under
     * either grace, so the comparison is not dormant — an unchanged frame genuinely is disbelieved
     * for the full grace before it is accepted. That is the intent: it is the only thing standing
     * between a fast accessibility read and the bug the sleeps existed for, and it means a screen
     * that legitimately does not change, such as the four identical 404s this app's gated routes
     * render, pays the whole grace. An earlier version of this comment put a read at 0.9–1.7s and
     * concluded the check never fired; that figure predates removing `customActions` from the
     * snapshot (see the note in `waitForAppReady`) and was wrong by roughly 8x, as was the
     * conclusion drawn from it. Raising either grace raises that cost on every unchanged screen.
     */
    staleGraceMs?: number
    /**
     * The overlap at which a settled frame counts as "still the frame from before the action".
     * Defaults to `APP_READY_SETTLE_SIMILARITY`, which is what every caller but `settleAfterRoute`
     * wants: after a launch there is no mid-transition composite to catch, only a screen that has
     * or has not been replaced.
     *
     * `settleAfterRoute` passes `APP_READY_STALE_SIMILARITY` instead — see that constant for the
     * measured straddle 0.98 let through.
     */
    staleSimilarityFloor?: number
    /**
     * When the stale guard's grace clock starts. Defaults to this call's own start, which is wrong
     * by exactly the gap between the action and the wait for the one caller that has an action to
     * point at: `apps.open` returned at t=240.461 in `session_2026-10-13_14-33-40.log` and this
     * function was entered at t=240.932, so ~0.5s of an 800ms grace was spent before the first
     * read. `settleAfterRoute` passes the moment the URL was actually opened
     * (`device.lastRouteOpenAt`), so the grace covers the router's transition rather than
     * whatever the harness did between the open and the wait.
     */
    staleClockStartedAt?: number
    /**
     * Agreeing pairs the stale guard must reject before `staleGraceMs` is allowed to expire.
     * Defaults to 0 — the grace is a pure wall-clock budget, as it was for every caller before
     * this. `settleAfterRoute` passes `ROUTE_STALE_MIN_REJECTED_PAIRS`; see that constant for why
     * a wall clock alone is a guard that disables itself on fast hardware.
     */
    staleMinRejectedPairs?: number
    /**
     * Interactive-element count a settled frame must reach before it counts as ready. Absent for
     * every caller that only wants "two reads agree"; set by a caller that has already decided a
     * small frame is not an answer (the deep-link probe's `PROBE_FRAME_ELEMENT_FLOOR`).
     *
     * This exists because the alternative — calling this function in a loop and checking the count
     * between calls — is the wrong shape for a function built to return the moment two reads
     * agree. A dev client's loading screen is perfectly stable, so every call returned in about a
     * second with the same 2-element frame, and the caller immediately re-entered. Measured on the
     * social-app cold start: the same three log lines (`poll 400ms`, `frame is still the one from
     * before this action`, `settled with 2 interactive elements after 3 reads in 1.0s`) repeated
     * thirteen times between t=45.9s and t=59.6s, 13.7s in all. Each restart discarded the poll
     * state and re-paid the stale-frame handshake, and none of the thirteen could ever return
     * anything but the answer the caller had just rejected. One call that keeps polling past a
     * too-small settle has the same deadline, the same reads and none of that overhead.
     *
     * The frame still has to settle as well as be large enough: a count that is high only because
     * the screen is mid-render is not ready either. And it is a bound, not a promise — on timeout,
     * or when `minInteractiveElementsGraceMs` runs out, this returns false like any other unsettled
     * wait, and the caller decides what a frame that never grew means.
     */
    minInteractiveElements?: number
    /**
     * How long to keep polling once the frame has *settled* below `minInteractiveElements`,
     * measured from that first undersized settle rather than from the call.
     *
     * Defaults to no limit beyond `timeoutMs`, which is what every caller before this one wanted:
     * the deep-link probe would rather spend its whole 30s than judge the transport off a splash.
     * A caller that cannot distinguish "still loading" from "legitimately sparse" passes this
     * instead — see `SUBSTANTIVE_FRAME_GRACE_MS` and the launch-readiness call in
     * `orchestrator.ts`, where the alternative is a login screen holding the sweep for 90s.
     */
    minInteractiveElementsGraceMs?: number
    /**
     * How long to tolerate the dev-client launcher on screen before recovering from it.
     *
     * Recovery opens the app again, and agent-device aborts an armed recording's publication on
     * "a second successful open" — so for the one caller that has a recording armed, the recovery
     * below is not a repair, it is what guarantees the script can never be published. Measured on
     * social-app: `startReplayRecording` armed at t=67.2s, the relaunch landed on the launcher,
     * this wait reconnected at t=69.6s, and the publish 16s later failed with exactly that
     * message. Every sweep since has shipped an empty `flows/` directory for the same reason.
     *
     * Deferring rather than disabling, because the launcher genuinely does not clear itself in the
     * case this recovery was written for (a dev client pointed at no Metro, where nobody is going
     * to tap the server URL). Spending this long first costs a slow recording the delay and
     * nothing else: when the deferral expires the recovery runs exactly as it does today, so the
     * worst case is the publication failure we already have, reached later.
     */
    deferLauncherRecoveryMs?: number
  }
): Promise<boolean> {
  let deadline = Date.now() + timeoutMs
  const initialWaitMs = options?.initialWaitMs ?? APP_LOAD_WAIT_MS
  // Taken before the first poll, because the poll's own reads overwrite `device.lastRead`. Absent
  // only on a first launch, where there is nothing to compare against and the flat sleep below is
  // all that is left.
  const recentRead = device.lastRead
  const frameBeforeAction =
    recentRead && Date.now() - recentRead.at <= FRAME_COMPARISON_MAX_AGE_MS
      ? fingerprint(recentRead.pressables)
      : null
  const staleGraceMs = options?.staleGraceMs ?? APP_LOAD_WAIT_MS
  const staleSimilarityFloor = options?.staleSimilarityFloor ?? APP_READY_SETTLE_SIMILARITY
  const staleMinRejectedPairs = options?.staleMinRejectedPairs ?? 0
  const minInteractiveElements = options?.minInteractiveElements ?? 0
  const minInteractiveElementsGraceMs = options?.minInteractiveElementsGraceMs ?? Infinity
  const requestedLauncherDeferralMs = options?.deferLauncherRecoveryMs ?? 0
  const deferLauncherRecoveryMs = launcherDeferralMs(
    requestedLauncherDeferralMs,
    device.launcherDeferral ?? 'untested'
  )
  // Said once per call rather than once per poll: the launcher is read every 400ms and the fact
  // being reported ("we are choosing to wait this one out") does not change between reads.
  let loggedLauncherDeferral = false
  // Tracked apart from `loggedLauncherDeferral` so that a call which defers and *then* runs out
  // says both things. Sharing one flag would swallow the second line on exactly the path the
  // deferral was built for.
  let loggedLauncherRecoveryCause = false
  const startedAt = Date.now()
  // The stale guard's clock, which is the caller's action rather than this call — see
  // `staleClockStartedAt`. Clamped to `startedAt` so a stamp from the future (or from a previous
  // sweep, if a caller ever passed a stale one) can only shorten nothing and lengthen nothing.
  const staleClockStartedAt = Math.min(options?.staleClockStartedAt ?? startedAt, startedAt)
  let heldStaleFrame = false
  // Agreeing pairs the stale guard has rejected on this call. Counted separately from
  // `sleeps.staleFrame` even though the two move together today, because one is the guard's own
  // state and the other is a diagnostic tally, and a later sleep added to this branch would
  // silently change what the guard means.
  let staleRejectedPairs = 0
  // The element count last reported while holding a settled frame below the floor, so the log says
  // each distinct thing once (2, then 2 again, then 15) instead of once per poll.
  let lastUndersizedCount: number | null = null
  // When the frame first settled below the floor, so `minInteractiveElementsGraceMs` runs from the
  // moment there was something to disbelieve rather than from the call — a cold start that spends
  // 20s drawing nothing at all has not used any of the grace up.
  let undersizedSettledAt: number | null = null
  // Only on a first launch, where there is nothing to compare against and a flat sleep is all that
  // is left. With a frame in hand the app was alive moments ago, so the poll below starts reading
  // immediately and the stale-frame guard — not a sleep — is what keeps it off the pre-action frame.
  //
  // A one-poll-interval delay was tried here on the strength of the pre-`customActions` sweep, where
  // settles landed on exactly 3 reads and 5.7s, matching `1.56 x 3 + 0.4 x 2` to the tenth: the
  // signature of a first read that agreed with nothing. Skipping that read looked worth ~1.96s for
  // 0.4s. Removing `customActions` from the snapshot then took a read from 1.56s to 0.31s, and the
  // measured distribution did not move — 25 of 38 settles still took 3 reads — so the delay bought
  // no read at all, while its share of a settle grew from 7% of 5.7s to 20% of 2.0s. The premise was
  // specific to reads being expensive, and it is not worth re-deriving from a sweep older than that.
  if (!frameBeforeAction && initialWaitMs > 0) {
    await wait(signal, Math.min(initialWaitMs, timeoutMs), 'wait for app to load')
  }
  log('waitForAppReady', `poll ${APP_READY_POLL_MS}ms, timeout ${timeoutMs / 1000}s`)
  let previous: ReadonlySet<string> | null = null
  // A read that *errors* is not the same as a read that returns nothing: an empty tree means the
  // app has not drawn yet and waiting is exactly right, while a failing read means the device is
  // not answering us at all (a lost session most often), and no amount of further waiting will
  // change that — the caller's next device call is what will surface the real error. Polling on
  // regardless would spend this whole timeout per call, which is the difference between a deep
  // link costing a second and costing half a minute once a session has dropped.
  let consecutiveReadFailures = 0
  // Reads, not polls: the settle's cost is dominated by the accessibility snapshot, and "settled
  // with 9 elements" alone never said whether that took the cheapest possible two reads or twenty.
  // The two cases want opposite fixes — a faster read versus a screen that will not hold still —
  // and the line could not tell them apart.
  let reads = 0
  // What each inter-read sleep was waiting on. The `settle-poll` row of the phase table is exactly
  // these sleeps (one per read but the last), so a sweep whose row doubled — 51.6s to 160.6s, with
  // 245 calls — could say how long it waited and never what it waited *for*. Four causes, four
  // different remedies: a launcher still clearing, a pre-action frame still on screen, a screen
  // too small to be the app, or one that simply has not stopped changing.
  const sleeps = { launcher: 0, staleFrame: 0, undersized: 0, unsettled: 0 }
  const sleepSummary = (): string =>
    `sleeps: ${sleeps.staleFrame} stale-frame, ${sleeps.undersized} undersized, ${sleeps.launcher} launcher, ${sleeps.unsettled} unsettled`
  let launcherRecoveries = 0
  let lastLauncherRecoveryAt = 0
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error('Cancelled')
    const pressables = await capturePressables(
      ctx,
      device,
      Math.max(1_000, Math.min(30_000, deadline - Date.now())),
      // The poll already clamps each read to what is left; this makes the busy-retry backoff
      // respect the same deadline instead of sleeping 42s of waits inside a 30s window.
      { deadlineAt: deadline }
    ).catch(() => {
      consecutiveReadFailures += 1
      return null
    })
    reads += 1
    if (pressables !== null) consecutiveReadFailures = 0
    else if (consecutiveReadFailures >= APP_READY_MAX_READ_FAILURES) {
      log('waitForAppReady', `device stopped answering after ${consecutiveReadFailures} reads`)
      return false
    }
    // The dev client's launcher is a settled, interactive screen, so every check below would
    // happily call it the app and hand it to a judge. It is also the one screen that will never
    // resolve itself by waiting — nobody is going to tap the server URL — so the only useful
    // response is to put the app back on screen ourselves.
    //
    // Two different moves, in the order a person would try them. First tell the dev client where
    // Metro is, which is what actually clears this screen and what the human fix (tapping a
    // "Recently Opened" row) does. Only then fall back to relaunching the app, which is all that
    // is available for a launcher-*like* screen this detector caught in an app with no dev client
    // to address. A launcher still on screen after both is a genuine failure to report, not retry.
    //
    // Each move is given `LAUNCHER_RECOVERY_GRACE_MS` before the next one is considered, because
    // neither takes effect by the time the very next poll reads the screen: a reconnect has to
    // fetch and evaluate the bundle, and until it does the launcher is still what is drawn.
    // Escalating on that first read would relaunch the app out from under the reconnect that was
    // working, and then report a failure caused by the escalation itself.
    if (pressables?.length && isDevClientLauncher(pressables)) {
      const deferringRecovery = Date.now() - startedAt < deferLauncherRecoveryMs
      const waitingOnRecovery = Date.now() - lastLauncherRecoveryAt < LAUNCHER_RECOVERY_GRACE_MS
      if (deferringRecovery) {
        if (!loggedLauncherDeferral) {
          loggedLauncherDeferral = true
          log(
            'waitForAppReady',
            `dev-client launcher on screen with a recording armed — waiting up to ${(
              deferLauncherRecoveryMs / 1000
            ).toFixed(
              1
            )}s for it to clear, because opening the app again here would abort publication`
          )
        }
        // The caller's budget was not sized for a bundle build any more than it was for a
        // recovery, so the deferral extends the deadline the same way issuing one does.
        deadline = Math.max(deadline, startedAt + deferLauncherRecoveryMs)
      } else if (!waitingOnRecovery) {
        if (requestedLauncherDeferralMs > 0 && !loggedLauncherRecoveryCause) {
          loggedLauncherRecoveryCause = true
          // Two different facts, and the log has to tell them apart: a deferral that has just run
          // out on this call, versus one that was never spent because an earlier call already
          // proved this launcher does not clear itself.
          log(
            'waitForAppReady',
            deferLauncherRecoveryMs > 0
              ? `dev-client launcher did not clear in ${(deferLauncherRecoveryMs / 1000).toFixed(1)}s — recovering, which will abort the armed recording`
              : 'dev-client launcher on screen with a recording armed — recovering immediately, an earlier deferral on this device already ran out without it clearing'
          )
        }
        // Recorded whether or not this call spent the wait: the point is that this device's
        // launcher has been observed not to clear on its own, and nothing about the next call
        // makes that less true.
        if (requestedLauncherDeferralMs > 0) device.launcherDeferral = 'expired'
        // Marked before the open, not after: as far as agent-device is concerned the transaction
        // is dead the moment the open succeeds, and a recovery that throws on the way back has
        // still opened the app. `startReplayRecording` reads this flag the moment this wait
        // returns and re-arms on top of whatever the recovery loaded, so the walk that follows is
        // recorded into a transaction that can actually publish — see `armed-recording.ts`.
        if (noteOpenWhileArmed(device.armedRecording)) {
          log(
            'waitForAppReady',
            `the recovery below aborts the armed recording (${device.armedRecording?.scriptPath}); it will be re-armed once the app is back`
          )
        }
        if (launcherRecoveries >= 2) {
          log(
            'waitForAppReady',
            `dev-client launcher still on screen after ${launcherRecoveries} recovery attempts`
          )
          return false
        }
        const reconnected =
          launcherRecoveries === 0 && (await reconnectDevClient(device, ctx.timing))
        if (reconnected) {
          log('waitForAppReady', 'dev-client launcher on screen — reconnecting to Metro')
          launcherRecoveries = 1
        } else {
          log('waitForAppReady', 'dev-client launcher on screen — relaunching the bound app')
          await launchBoundApp(device, ctx.timing)
          // A relaunch is the last move available, whether it ran first (no dev-client URL to try)
          // or second: counting it out here stops the loop asking for a third.
          launcherRecoveries = 2
        }
        lastLauncherRecoveryAt = Date.now()
        // The caller's budget was sized for whatever it was originally waiting on — a router
        // transition is 30s, and `settleAfterRoute` passes exactly that. None of those budgets
        // were sized for a bundle build, so without this the call would issue the recovery and
        // then time out while it was still working, handing the caller a launcher frame to judge
        // and a walk to spend on the launcher's own controls. Extended only once a recovery has
        // actually been issued, and only far enough to see it through.
        deadline = Math.max(deadline, lastLauncherRecoveryAt + LAUNCHER_RECOVERY_GRACE_MS)
      }
      previous = null
      // Deliberately not `APP_READY_POLL_MS`. That interval is tuned for the settle case, where
      // the answer can arrive on the very next read and polling fast is what makes it cheap. Here
      // the answer cannot arrive for `LAUNCHER_RECOVERY_GRACE_MS` by construction — the recovery
      // above has just been issued and the loop is only waiting it out — so every read in that
      // window is known-useless, and the runner is documented as fragile under back-to-back
      // accessibility snapshot loops (see `openDeepLink`). Pinned to the cadence this branch had
      // before the settle poll was sped up.
      sleeps.launcher += 1
      await measurePhase(ctx, 'settle-poll', () => sleep(Math.max(APP_READY_POLL_MS, 1_500)))
      continue
    }
    if (pressables?.length && !isLoadingScreen(pressables)) {
      const current = fingerprint(pressables)
      // Compared by token overlap, not by exact equality of the control list. Exact equality asks
      // the screen to be byte-identical between two polls a second and a half apart, which a static
      // settings page manages and a *feed* never does: a post loads, a like count ticks, an avatar
      // resolves, and the list differs forever. Every content screen therefore ran the full 90s and
      // logged "still loading" while sitting fully rendered in front of the poll. Overlap answers
      // the question actually being asked — is this still the same screen — and the same 0.98 bar
      // the exploration loop already uses for "that action changed nothing" applies here.
      if (previous && similarity(previous, current) >= APP_READY_SETTLE_SIMILARITY) {
        // Two reads agreeing is necessary but not sufficient: the screen from *before* the action
        // is the most stable thing there is, precisely because nothing is happening on it. See
        // `isFrameUnchangedSinceAction`.
        if (
          frameBeforeAction &&
          isFrameUnchangedSinceAction({
            before: frameBeforeAction,
            settled: current,
            // The grace clock is not allowed to run at all until the guard has actually rejected
            // `staleMinRejectedPairs` agreeing pairs — see that option. Reporting 0 elapsed is how
            // that is said through a function whose contract is "elapsed versus grace", and it
            // keeps `isFrameUnchangedSinceAction` free of a second, device-shaped concept.
            elapsedMs:
              staleRejectedPairs >= staleMinRejectedPairs ? Date.now() - staleClockStartedAt : 0,
            graceMs: staleGraceMs,
            similarityFloor: staleSimilarityFloor
          })
        ) {
          if (!heldStaleFrame) {
            heldStaleFrame = true
            log(
              'waitForAppReady',
              `frame is still the one from before this action — waiting up to ${staleGraceMs / 1000}s for it to change`
            )
          }
          staleRejectedPairs += 1
          previous = current
          sleeps.staleFrame += 1
          await measurePhase(ctx, 'settle-poll', () => sleep(APP_READY_POLL_MS))
          continue
        }
        // Stable but too small to be the app — see `minInteractiveElements`. Checked after the
        // stale-frame guard so the two holds compose: a frame must be both new and substantial.
        // `previous` is kept, so the moment the count clears the floor the very next read settles
        // without a fresh agreeing pair.
        if (pressables.length < minInteractiveElements) {
          undersizedSettledAt ??= Date.now()
          const heldForMs = Date.now() - undersizedSettledAt
          if (heldForMs >= minInteractiveElementsGraceMs) {
            // Out of grace with a settled frame in hand. Returning false rather than true keeps
            // the floor honest: the caller asked whether it got a substantive frame, and it did
            // not. Callers that capture regardless are unaffected — they ignore the return.
            log(
              'waitForAppReady',
              `stable at ${pressables.length} interactive elements for ${(heldForMs / 1000).toFixed(1)}s without reaching ${minInteractiveElements} — treating this as the app's own screen`
            )
            return false
          }
          if (lastUndersizedCount !== pressables.length) {
            lastUndersizedCount = pressables.length
            log(
              'waitForAppReady',
              `stable at ${pressables.length} interactive elements, below the ${minInteractiveElements} required — still waiting for the app to finish loading`
            )
          }
          previous = current
          sleeps.undersized += 1
          await measurePhase(ctx, 'settle-poll', () => sleep(APP_READY_POLL_MS))
          continue
        }
        log(
          'waitForAppReady',
          `settled with ${pressables.length} interactive elements after ${reads} reads in ${((Date.now() - startedAt) / 1000).toFixed(1)}s (${sleepSummary()})`
        )
        return true
      }
      previous = current
    } else {
      previous = null
    }
    sleeps.unsettled += 1
    await measurePhase(ctx, 'settle-poll', () => sleep(APP_READY_POLL_MS))
  }
  log(
    'waitForAppReady',
    `still loading after ${timeoutMs / 1000}s and ${reads} reads, capturing anyway (${sleepSummary()})`
  )
  return false
}

/**
 * A flat post-action sleep. Deliberately still a sleep: no caller of this function is followed by
 * the before/after frame comparison that `settleAfterRoute` relies on to do without one.
 *
 * `ROUTE_WAIT_MS` is a *bound* only for `settleAfterRoute`, because that path alone goes through
 * `waitForAppReady`, which captures `device.lastRead` as the pre-action frame. Every caller of
 * this function skips that: `executeNavigationActions` sleeps after each tap, input and swipe and
 * then returns to the next action or the next screenshot with no readiness poll in between;
 * `probeUnmatchedRoute` follows it with a single `capturePressables`; and the manual-mode replay
 * and session recorders do the same. Removing the sleep there would not hand the decision to a
 * comparison, it would hand it to nothing, so the screenshot or read after a tap could land on the
 * frame from before the tap and the vision judge would report a wrong screen — the failure that
 * costs a full exploration, against 0.8s per tap saved.
 *
 * Even for `settleAfterRoute` the comparison is live (see `staleGraceMs`: a read costs 0.18s per
 * `session_2026-10-09_17-22-18.log`, so two reads finish well inside the grace), but it is
 * evidence that a *deep link* does not need the sleep, not that a tap does. The ~30 `wait for route — 0.8s` lines per sweep are all this
 * function, from `executeNavigationActions`. Replacing them safely needs a post-tap settle that
 * compares against the pre-tap frame, which is a behavioural change in the exploration loop and
 * not something this sleep can be shortened into.
 */
export async function waitForRoute(signal?: AbortSignal, timeoutMs = ROUTE_WAIT_MS): Promise<void> {
  await wait(signal, Math.min(ROUTE_WAIT_MS, timeoutMs), 'wait for route')
}

/**
 * What to wait for after opening a deep link, before judging where it landed.
 *
 * A flat sleep is only ever right when the app was already on screen and settled — then the router
 * has one transition to run and a couple of seconds covers it. It is wrong in the case this sweep
 * hits constantly: a reach that lost its session leaves the next node's deep link firing into an
 * app the recovery path has just relaunched, so when the sleep ends the frame is the splash screen
 * or the home feed the cold start landed on, the judge honestly reports a mismatch, and a route
 * that works perfectly from a terminal gets recorded as broken. So this is the stability poll
 * `waitForAppReady` owns, with no launch sleep in front of it.
 *
 * The router beat is still accounted for, but as a bound rather than a cost: the settled *previous*
 * screen is exactly what the poll would otherwise lock onto, and `waitForAppReady` now recognises
 * it by comparison instead of being slept past it.
 *
 * Returns `waitForAppReady`'s own verdict — whether the app settled — for callers about to judge
 * the frame that follows. See that function's doc comment.
 */
export async function settleAfterRoute(
  ctx: CaptureContext,
  device: CaptureDevice,
  signal?: AbortSignal,
  timeoutMs = ROUTE_SETTLE_TIMEOUT_MS,
  options?: { minInteractiveElements?: number }
): Promise<boolean> {
  // Only an open from moments ago can be what this settle is waiting on. Not every caller of this
  // function follows an `openDeepLink` — the deep-link probe's launch-readiness wait runs *before*
  // its open — and anchoring the guard's clock to a URL opened a minute ago would start the grace
  // already expired, which is the exact failure this change exists to remove.
  const openedAt = device.lastRouteOpenAt
  const staleClockStartedAt =
    openedAt !== null && Date.now() - openedAt <= ROUTE_OPEN_CLOCK_MAX_AGE_MS ? openedAt : undefined
  return waitForAppReady(ctx, device, signal, timeoutMs, {
    minInteractiveElements: options?.minInteractiveElements,
    // No sleep in front of the poll, and none needed: the pre-open frame is what the sleep was
    // guarding against being mistaken for the destination, and `waitForAppReady` now compares
    // against it directly. `ROUTE_WAIT_MS` survives as the ceiling on that comparison — the
    // router beat it was always sized for — rather than as a cost every route pays.
    initialWaitMs: 0,
    staleGraceMs: ROUTE_STALE_GRACE_MS,
    // The three things `session_2026-10-13_14-33-40.log` showed the guard needed and did not have:
    // a floor that recognises a mid-transition composite (0.98 did not — see
    // `APP_READY_STALE_SIMILARITY`), a clock that starts at the open rather than at this wait
    // (~0.5s of the old 800ms went to the gap between them), and a minimum number of rejections so
    // a fast read cannot settle before the guard has judged anything at all (PostLikedBy's first
    // agreeing pair landed at 1.18s, past the whole grace).
    staleSimilarityFloor: APP_READY_STALE_SIMILARITY,
    staleClockStartedAt,
    staleMinRejectedPairs: ROUTE_STALE_MIN_REJECTED_PAIRS
  })
}

async function openUrlInSession(
  ctx: CaptureContext,
  device: CaptureDevice,
  app: string,
  url: string | null,
  options?: { relaunch?: boolean }
): Promise<void> {
  try {
    await openAppSession(device.client, app, {
      url,
      relaunch: options?.relaunch,
      udid: device.deviceId,
      timing: ctx.timing
    })
  } catch (error) {
    if (!isMissingSessionError(error)) throw error
    log(
      'openApp',
      `no active session, recovering — while opening ${app}${url ? ' with a URL' : ''} — ${describeSessionLoss(errorMessage(error), agentDeviceErrorHint(error))}`
    )
    // `reopenBoundApp` waits for the app to be ready before returning, which is what makes the
    // retry below a delivery rather than a URL thrown at a launching process — see its comment.
    await reopenBoundApp(ctx, device)
    await openAppSession(device.client, app, {
      url,
      relaunch: options?.relaunch,
      udid: device.deviceId,
      timing: ctx.timing
    })
  }
  await dismissOpenInAppPrompt(device, url)
}

export function resolveDeepLink(
  ctx: CaptureContext,
  device: CaptureDevice,
  node: AppFlowNode,
  params: Record<string, string>
): { app: string; url: string } {
  const urlPath = buildUrlPath(node, params)
  if (device.useCustomScheme && ctx.scheme) {
    return {
      app: device.launchTarget,
      url: `${ctx.scheme}://${urlPath.replace(/^\//, '')}`
    }
  }
  if (!device.launchUrl) {
    throw new Error(`Screen ${node.id} has no usable native URL scheme`)
  }
  return {
    app: device.launchTarget,
    url: `exp://127.0.0.1:${device.metroPort}/--${urlPath}`
  }
}

export function buildAgentDevicePathToReach(
  ctx: CaptureContext,
  device: CaptureDevice,
  node: AppFlowNode,
  params: Record<string, string>,
  opened?: { app: string; url: string }
): string[] {
  const target = opened ?? resolveDeepLink(ctx, device, node, params)
  return [...device.setupCommands, agentDeviceOpenCommand(target.app, target.url)]
}

/**
 * What one deep-link open produced: where it was sent, and what was on screen just before it went.
 *
 * `preOpenPressables` is not new work — it is the liveness probe's own read (or the recent read
 * that stood in for it), which this function already had in hand and threw away. Returning it is
 * what lets the caller ask the question nothing in the sweep could previously answer: whether the
 * frame it is about to photograph is the destination or the screen the app was already on. See
 * `reach/frame-stability.ts`. Null when the probe read failed, which is not evidence either way.
 */
export interface DeepLinkOpenResult {
  app: string
  url: string
  preOpenPressables?: AppFlowPressable[] | null
}

export async function openDeepLink(
  ctx: CaptureContext,
  device: CaptureDevice,
  node: AppFlowNode,
  params: Record<string, string>
): Promise<DeepLinkOpenResult> {
  const urlPath = buildUrlPath(node, params)
  log('openDeepLink', `${node.id} → ${urlPath}`)

  // Make sure the app is actually up before handing it a URL. A deep link delivered to a process
  // that is still cold-starting is the one the app drops: it finishes its own launch and lands on
  // whatever it opens by default, which is why these routes open correctly from a terminal (where
  // the app is already running) and mismatch here. The sweep reaches this state routinely — a lost
  // session makes the delivery capture relaunch the app, and the very next node's deep link is
  // then the first thing to touch it.
  //
  // One read, not a settle loop. The question here is only "is this process alive and drawing",
  // and a single snapshot that comes back with interactive elements answers it — settling is the
  // job of the `settleAfterRoute` poll that runs *after* the URL is opened, which is the one whose
  // answer anything depends on. Running a full `waitForAppReady` here as well made this the most
  // expensive thing in the sweep that nothing reads: two back-to-back polling loops around every
  // deep link, each firing accessibility snapshots every 1.5s. That is precisely the load that
  // blows the iOS runner's execution watchdog, so the harness was reliably wedging the runner just
  // before the read it actually cares about — on device, every single deep link logged
  // `runner busy` retries on the second poll and then gave up with "still loading after 30s".
  //
  // The cold-start case this exists for is still covered: an empty or failed read falls through to
  // the full wait, which is the only situation that ever needed it.
  //
  // `retries: 0` is load-bearing, and its absence undid everything the paragraph above describes.
  // A read inherits the busy-retry schedule by default, so this 5s probe was quietly sleeping
  // 5 + 12 + 25 = 42s whenever the runner was busy — which, on the path this exists for, is
  // *always*: the previous screen's activity is what wedged the runner in the first place. The
  // probe then fell through to the 30s wait anyway, so the cheap pre-check cost 72s. A device log
  // shows it eating a 60s probe budget whole before the URL was even opened, leaving the arrival
  // judge no time to run and the deep-link probe permanently "inconclusive".
  //
  // Zero retries is the right number rather than a smaller schedule: a busy runner already means
  // "not ready", which is exactly the fallback branch below, and that branch's own poll retries
  // against a real deadline.
  // The dev client's launcher is fully rendered and interactive — "Development Servers",
  // "Recently Opened", "Enter URL manually" are all real pressables — so a bare "did we get
  // anything back" check calls it alive and hands it the deep link below. The launcher has no
  // router behind it to receive that link, so the app then "opens" straight into whatever the
  // launcher itself does with an arbitrary URL tap, which is not the route this call asked for.
  // `alive` is already in hand from the probe above, so this costs no extra device call, and
  // falling through to `waitForAppReady` is correct because that is the function that owns
  // launcher recovery (reconnect to Metro, then relaunch — see its comment above).
  //
  // The read itself is skipped when one from moments ago is already in hand — see
  // `APP_ALIVE_REUSE_MS`. The checks below then run against that read instead, unchanged: a reused
  // answer is held to exactly the same bar as a fresh one, so a stale launcher or loading screen
  // still falls through to the full `waitForAppReady`.
  const recent = device.lastRead
  const reusable = recent && Date.now() - recent.at <= APP_ALIVE_REUSE_MS ? recent.pressables : null
  if (reusable) log('openDeepLink', 'app was alive moments ago, skipping the liveness probe')
  const alive =
    reusable ??
    (await capturePressables(ctx, device, APP_ALIVE_PROBE_TIMEOUT_MS, {
      retries: 0
    }).catch(() => null))
  if (!alive?.length || isLoadingScreen(alive) || isDevClientLauncher(alive)) {
    await waitForAppReady(ctx, device, ctx.signal, ROUTE_SETTLE_TIMEOUT_MS, { initialWaitMs: 0 })
  }
  // The last thing read before the URL goes out, which is the probe's own frame on the hot path
  // and `waitForAppReady`'s final poll on the cold one. Taken here rather than reconstructed by
  // the caller, because by the time the caller sees anything the app has already moved.
  const preOpenPressables = device.lastRead?.pressables ?? alive ?? null
  // Stamped on the way out of each `apps.open` below rather than once up here: the grace this
  // feeds is the *router's* transition beat, and the probe and launcher recovery above can spend
  // seconds before the URL is ever handed over. See `CaptureDevice.lastRouteOpenAt`.

  if (device.useCustomScheme && ctx.scheme) {
    const deepPath = urlPath.replace(/^\//, '')
    const url = `${ctx.scheme}://${deepPath}`
    try {
      await openUrlInSession(ctx, device, device.launchTarget, url)
      device.lastRouteOpenAt = Date.now()
      return { app: device.launchTarget, url, preOpenPressables }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!/failed to open/i.test(message)) throw error
    }
  }

  if (!device.launchUrl) {
    throw new Error(`Screen ${node.id} has no usable native URL scheme`)
  }

  const metroUrl = `exp://127.0.0.1:${device.metroPort}/--${urlPath}`
  const app = device.launchTarget
  await openUrlInSession(ctx, device, app, metroUrl)
  device.lastRouteOpenAt = Date.now()
  return { app, url: metroUrl, preOpenPressables }
}

/**
 * One bounded read of the current screen, answering only "is this the dev-client launcher right
 * now" — nothing more. This exists because `waitForAppReady`'s boolean return conflates two
 * different failures: "the app never came up" and "the app came up on the wrong screen". A caller
 * outside `waitForAppReady` that gets `false` back cannot tell which one happened, and the states
 * loop in orchestrator.ts needs exactly that distinction to decide whether to escalate to the user
 * (a stuck launcher, which a person can clear in seconds by tapping into the app) or to treat it as
 * an ordinary readiness timeout.
 *
 * A failed read is reported as "not the launcher", never as "is the launcher": a device that will
 * not answer at all is a different, unrelated problem (a lost session, most often), and the
 * caller's next device call is what should surface that error rather than this helper papering
 * over it with a launcher diagnosis it has no evidence for.
 */
export async function isOnDevClientLauncher(
  ctx: CaptureContext,
  device: CaptureDevice,
  timeoutMs = APP_ALIVE_PROBE_TIMEOUT_MS
): Promise<boolean> {
  const pressables = await capturePressables(ctx, device, timeoutMs, { retries: 0 }).catch(
    () => null
  )
  return !!pressables?.length && isDevClientLauncher(pressables)
}

/**
 * How long `startReplayRecording` waits for the dev-client launcher to clear on its own before
 * letting `waitForAppReady` recover from it the usual way.
 *
 * Sized off the bundle load the recovery exists to avoid racing: the cold-cache figure
 * `PROBE_LAUNCH_READY_BUDGET_MS` is built from is `iOS Bundled 16079ms (6130 modules)`, and a warm
 * relaunch on the measured run cleared in about 2.5s. Twenty seconds covers the cold case with
 * room over it, and is spent only when the launcher is actually on screen.
 */
const RECORDING_LAUNCHER_PATIENCE_MS = 20 * 1000

/**
 * Start a clean agent-device recording. Exactly one app open is recorded.
 *
 * **One caller now: the manual recorder** (`manual/session.ts`). The sweep used to open every
 * exploration walk with this, purely so the recorded script's first line would be
 * `open --relaunch` — a cold start, a bundle reload and the launcher deferral below, paid once per
 * walk for the artefact rather than for the walk, which on the 2026-10-13 sweep cost ~173s of 683s
 * and published one script out of seven explorations. Exploration now writes down the commands it
 * walked instead (`walk-commands.ts`) and resets with a soft re-root (`DevicePort.resetToLaunch`),
 * so nothing in the sweep arms a recording any more.
 *
 * Everything below — the relaunch, the recorded `wait stable`, `RECORDING_LAUNCHER_PATIENCE_MS`,
 * the re-arm, `armed-recording.ts` and `launcher-deferral.ts` — therefore survives for the manual
 * recorder alone, which still publishes a real `.ad` script and still needs every one of them.
 * None of it is reachable from a sweep.
 */
export async function startReplayRecording(
  ctx: CaptureContext,
  device: CaptureDevice,
  scriptPath: string,
  launchUrl: string | null = device.launchUrl,
  timeoutMs = APP_READY_TIMEOUT_MS
): Promise<void> {
  try {
    // Load-bearing, and more so now that the sweep leaves sessions open: a publish
    // (`saveAndReplayRecording`'s non-repair branch) and a discard (`discardRecordingCandidate`)
    // both hand this function a live, still-armed recording, and agent-device will not arm the
    // `saveScript` open below over an existing transaction. This close is what discards it —
    // unfinalized, so nothing is written — and it is also the only place the abandoned recordings
    // those two paths leave behind are reliably cleaned up.
    //
    // The `relaunch: true` that follows is equally load-bearing, and for a reason that has nothing
    // to do with getting back to a known state: it is the *recorded* first line of the candidate.
    // A script whose opening step is `open --relaunch` replays standalone from any device state,
    // which is the property every seed and every saved-replay rung depends on. Replacing it with a
    // soft `goHome` would record a script that only replays when the app happens to already be
    // running, so the cold start here is the price of the artefact, not of this walk.
    await device.client.sessions.close()
  } catch {
    // The first recording attempt may not have an active session yet.
  }
  // The relaunch restarts the app cold, so the first screen is a splash again: the navigation
  // actions that follow would tap into a loading screen and fail every attempt.
  //
  // Two waits, because they solve the same problem on two different clocks. `waitForAppReady`
  // below polls accessibility from this process and is what makes the *live* walk safe — but it
  // is our code, not a session command, so agent-device never sees it and it leaves no trace in
  // the recorded script. At replay time the script therefore went straight from `open --relaunch`
  // to the walk's first `press`, into an app that was still starting, and every explored journey
  // died with "the recorded target no longer matches any current element" on its first action.
  //
  // `command.wait({ stable: true })` is a session command, so it *is* recorded, emitting a
  // `wait stable <quietMs> <timeoutMs>` line right behind the open — which is precisely what
  // agent-device documents it for ("the fallback for open/relaunch/navigation"). It deliberately
  // does not replace the destination guard `saveAndReplayRecording` appends: a stable wait is not
  // a portable destination guard, and the guard has to be a selector wait on an identified
  // landmark. This one only has to keep the replay from acting on a splash screen.
  //
  // Best-effort on purpose. A UI that never goes quiet within the budget — an indefinite spinner,
  // a looping splash animation — throws `wait_stable_timeout` here, and letting that propagate
  // would abandon a recording that `waitForAppReady` may still be able to rescue. Swallowing it
  // costs nothing: the line is simply absent from the script, which is exactly where we were.
  async function recordStableWait(): Promise<void> {
    try {
      await measurePhase(ctx, 'device-wait', () =>
        device.client.command.wait({
          platform: ctx.platform,
          stable: true,
          quietMs: APP_STABLE_QUIET_MS,
          timeoutMs: Math.max(1_000, Math.min(timeoutMs, APP_STABLE_TIMEOUT_MS))
        })
      )
    } catch (error) {
      log('startReplayRecording', `stable wait not recorded — ${errorMessage(error)}`)
    }
  }
  /**
   * The open that arms the transaction, plus the recorded stable wait that has to sit behind it.
   *
   * A closure only so the re-arm below can reuse it without a second copy of the
   * `saveScript`/`force` call and the `wait stable` line every recorded script needs in front of
   * its first press. `relaunch` is the one thing that differs between the two uses, and the one
   * thing that matters — see the re-arm's own comment.
   */
  const arm = async (relaunch: boolean): Promise<void> => {
    await measurePhase(ctx, 'open-url', () =>
      device.client.apps.open({
        app: installedAppLaunchTarget(device.launchTarget),
        platform: ctx.platform,
        udid: device.deviceId,
        ...(relaunch ? { relaunch: true } : {}),
        saveScript: scriptPath,
        force: true,
        ...(launchUrl ? { url: launchUrl } : {})
      })
    )
    // Set the moment the open returns, so every `apps.open` this module issues from here on knows
    // it would be the second one — `goHome` suppresses itself and the launcher recovery marks the
    // transaction dead on its way past. See `armed-recording.ts`.
    device.armedRecording = armRecording(scriptPath)
    await dismissOpenInAppPrompt(device, launchUrl)
    await recordStableWait()
  }
  await arm(true)
  // The one caller that must not let this wait recover from the dev-client launcher: the open
  // above armed the recording, and the recovery's own `apps.open` is the "second successful open"
  // that aborts publication. See `deferLauncherRecoveryMs`.
  //
  // The substantive-frame floor is here for the reason it is everywhere else — stable is not
  // loaded — but this was the last open in the sweep still without it, and the cost was visible in
  // the 14-33-20 log: the arming open `settled with 3 interactive elements after 2 reads in 0.6s`,
  // the planner was handed that splash as its first screenshot, and it spent a model call
  // (1.5s, 1653 tokens) answering `{"type":"wait","duration":2000}` — buying with a round trip
  // exactly what this wait is supposed to provide for free. Every recorded walk paid it.
  //
  // Graced rather than held to `timeoutMs` for the same reason as `manual/replay.ts`: a walk may
  // legitimately begin on a sparse screen, and refusing to record one at all is worse than
  // recording one that starts thin.
  await waitForAppReady(ctx, device, ctx.signal, timeoutMs, {
    deferLauncherRecoveryMs: RECORDING_LAUNCHER_PATIENCE_MS,
    minInteractiveElements: PROBE_FRAME_ELEMENT_FLOOR,
    minInteractiveElementsGraceMs: SUBSTANTIVE_FRAME_GRACE_MS
  })
  // The deferral above buys time; it does not buy the outcome. On a dev client pointed at no Metro
  // the launcher never clears on its own, so the wait runs out and recovers with an `apps.open` of
  // the bundle URL — and from that moment the transaction armed a few lines up is dead, whatever
  // the walk that follows manages to prove. That is the whole of the 2026-10-13 sweep's failure:
  // six armed walks, six launcher recoveries, five verified arrivals thrown away at the publish
  // with `aborted by a second successful open` (t=406.1, 456.2, 623.8, 679.7, 743.1), and the one
  // node whose arming open happened to skip the launcher (`MyProfile`, t=153.4) the only one that
  // produced a script.
  //
  // So the dead transaction is replaced rather than walked into. The close discards it without
  // writing anything (the same discard this function opens with), and a second `saveScript` open
  // arms a fresh one on top of the app the recovery has just finished loading.
  //
  // `relaunch: false` for that second open, and it is the only honest choice available: a
  // relaunch is what put the dev client on its launcher in the first place, so re-arming with one
  // would land on the launcher again, recover again, and abort again — the loop this is here to
  // break. The cost is the property the opening comment of this function calls load-bearing: the
  // re-armed script starts `open <url>` rather than `open --relaunch <url>`, so it replays against
  // a running app rather than from any device state. That is a weaker artefact than the cold-start
  // script, and a strictly better one than the empty `flows/` directory this path has shipped on
  // every sweep so far. It is also confined to exactly the devices that cannot produce the strong
  // one: a launcher that clears within the deferral never reaches this branch at all.
  if (needsRearm(device.armedRecording)) {
    log(
      'startReplayRecording',
      `re-arming ${scriptPath} after the launcher recovery — its open aborted the first transaction; the replacement records "open" rather than "open --relaunch"`
    )
    try {
      await device.client.sessions.close()
    } catch {
      // Same tolerance as the opening close: an aborted transaction may have taken the session
      // with it, and there is nothing to discard if it did.
    }
    await arm(false)
    // Without a relaunch there is no cold start to wait out, so this is only the substantive-frame
    // floor the walk's first screenshot needs — and the launcher deferral is deliberately not
    // requested again: the app is already loaded, and a launcher appearing here would mean the
    // re-arm itself failed, which the walk's own first observation reports better than a second
    // 20s wait would.
    await waitForAppReady(ctx, device, ctx.signal, timeoutMs, {
      minInteractiveElements: PROBE_FRAME_ELEMENT_FLOOR,
      minInteractiveElementsGraceMs: SUBSTANTIVE_FRAME_GRACE_MS
    })
  }
  // The walk's first press is the one that has to survive a cold replay — see `pendingEntryGate`.
  device.pendingEntryGate = true
}

/**
 * Press one locator, narrowing and retrying once if agent-device reports it ambiguous.
 *
 * agent-device refuses an ambiguous selector rather than guessing, and a caller deriving locators
 * from `capturePressables` cannot see the ambiguity coming: that list deduplicates by the exact
 * `{text,label,identifier,role}` object it builds, so two controls identical in all four — which
 * Bluesky's two `label="Open drawer menu"` buttons are — collapse into one entry. Every locator
 * derived from it therefore looks unique to us and is ambiguous on device. `hittable=true` is the
 * narrowing that matches how the list was built in the first place (one of a rendered-but-off-canvas
 * pair is not tappable), and it is tried only after the plain locator has actually failed this way,
 * so the common single-match tap keeps its existing one-call cost and behaviour.
 *
 * Shared by `executeNavigationActions` (the sweep) and the manual recorder, which issues one press
 * per user click and hits the same ambiguity on the same screens.
 */
export async function pressWithLocator(
  ctx: CaptureContext,
  device: CaptureDevice,
  locator: { by: 'text' | 'label' | 'id'; value: string },
  timeoutMs = 10_000
): Promise<boolean> {
  if (device.pendingEntryGate) await recordEntryGate(ctx, device, locator)
  const pressWith = (qualifiers?: Readonly<Record<string, string | boolean>>): Promise<unknown> =>
    measurePhase(ctx, 'press', () =>
      device.client.interactions.press({
        platform: ctx.platform,
        ...toAgentDeviceTarget(parseInteractionTarget(serializeLocator(locator, qualifiers))),
        settle: true,
        settleQuietMs: SETTLE_QUIET_MS,
        timeoutMs: Math.max(1, Math.min(10_000, timeoutMs))
      })
    )
  try {
    return didSettle(await pressWith())
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!isAmbiguousSelectorMessage(message)) throw error
    log(
      'pressWithLocator',
      `${serializeLocator(locator)} matched several elements, retrying with hittable=true`
    )
    return didSettle(await pressWith({ hittable: true }))
  }
}

/**
 * Whether agent-device actually observed the UI go quiet after the action, rather than merely
 * having been asked to.
 *
 * `settle` is documented as best-effort and never fails the action, so a `settle: true` request is
 * a request and the result is the answer. The distinction is the whole basis for skipping the flat
 * post-action sleep in `executeNavigationActions`: a settle that happened has already waited for
 * exactly what the sleep was approximating, and a settle that did not leaves nothing behind it, so
 * the sleep is still the only thing standing between the next screenshot and the pre-tap frame.
 */
function didSettle(result: unknown): boolean {
  return (result as { settle?: { settled?: boolean } } | null)?.settle?.settled === true
}

/**
 * Writes a `wait` on this press's own target into the recording, immediately ahead of the press.
 *
 * `startReplayRecording` already explains why `waitForAppReady` leaves no trace in a recorded
 * script and why a `wait stable` line was put behind the relaunch to stand in for it. The measured
 * run says that stand-in is not enough: three of four explored journeys still died at their
 * script's *first* press with "the recorded target no longer matches any current element", and
 * `profile.ad` — a script that had just replayed successfully — failed the same way twenty seconds
 * later when the next screen tried to seed from it. An unchanged script failing intermittently
 * against an unchanged app is a readiness race, not locator drift.
 *
 * Stability is simply the wrong question, and `probe-route.ts` already paid to learn it: a splash
 * screen is perfectly stable, and this app's first readiness check settled on a dev-client loading
 * frame carrying 2 interactive elements. `wait stable` is satisfied by that frame, the recorded
 * press fires into it, and there is no tab bar there to press. A wait on the press's own target
 * cannot be satisfied early, because the element it names is not on a splash screen.
 *
 * Why the press's own target and not a landmark of the entry screen: a landmark has to be *chosen*,
 * and the obvious choice — the first identified control on the settled frame — is routinely a piece
 * of feed content whose id does not exist on the next launch. That gate would expire on every
 * replay and cost the full timeout before pressing anyway. The press target needs no choosing and
 * is exactly the element the replay is about to require.
 *
 * Only the first press of a recording is gated. It is the one that runs against a cold app, and
 * the measured failures are all on it; every later press happens on a screen the previous action
 * already brought up. Gating all of them would also put this timeout in front of every genuinely
 * stale locator during a flailing walk, which is a real cost for no measured benefit.
 *
 * Best-effort, like the stable wait it backs up: when the wait itself fails the press still runs,
 * because the press's own error is the more informative one and swallowing this leaves the script
 * exactly where it already was.
 */
async function recordEntryGate(
  ctx: CaptureContext,
  device: CaptureDevice,
  locator: { by: 'text' | 'label' | 'id'; value: string }
): Promise<void> {
  // Cleared before the attempt, not after it: this is the first press either way, and a failed
  // gate must not leave the flag set for the next press on a screen that never needed one.
  device.pendingEntryGate = false
  const selector = serializeLocator(locator)
  try {
    await measurePhase(ctx, 'device-wait', () =>
      device.client.command.wait({
        platform: ctx.platform,
        selector,
        timeoutMs: ENTRY_GATE_TIMEOUT_MS
      })
    )
    log('pressWithLocator', `entry gate ${selector}`)
  } catch (error) {
    log('pressWithLocator', `entry gate ${selector} not recorded — ${errorMessage(error)}`)
  }
}

export async function executeNavigationActions(
  ctx: CaptureContext,
  device: CaptureDevice,
  actions: readonly AppFlowNavigationAction[],
  timeoutMs?: number
): Promise<void> {
  const deadline = Date.now() + (timeoutMs ?? 12_500 * Math.max(1, actions.length))
  for (let index = 0; index < actions.length; index++) {
    if (ctx.signal?.aborted) throw new Error('Cancelled')
    if (Date.now() >= deadline) throw new Error('Navigation action budget exhausted')
    const action = actions[index]
    // Whether the action itself waited for the UI to go quiet. `press` and `fill` ask for a settle
    // and report back; `scroll` has no settle option at all, so a swipe always falls through to the
    // sleep below.
    let settled = false
    switch (action.type) {
      case 'tap': {
        if (!action.locator) throw new Error('Tap action requires a locator')
        settled = await pressWithLocator(
          ctx,
          device,
          action.locator,
          Math.max(1, Math.min(10_000, deadline - Date.now()))
        )
        break
      }
      case 'input':
        if (!action.locator || action.value == null)
          throw new Error('Input action requires locator and value')
        settled = didSettle(
          await device.client.interactions.fill({
            platform: ctx.platform,
            ...toAgentDeviceTarget(parseInteractionTarget(serializeLocator(action.locator))),
            text: action.value,
            settle: true,
            settleQuietMs: SETTLE_QUIET_MS,
            timeoutMs: Math.max(1, Math.min(10_000, deadline - Date.now()))
          })
        )
        break
      case 'swipe':
        await device.client.interactions.scroll({
          platform: ctx.platform,
          direction: action.direction ?? 'up'
        })
        break
      case 'wait':
        await measurePhase(ctx, 'device-wait', () =>
          device.client.command.wait({
            platform: ctx.platform,
            durationMs: Math.max(
              0,
              Math.min(action.duration ?? 1000, 10_000, deadline - Date.now())
            )
          })
        )
        break
    }
    // The sleep is what stops the next screenshot or accessibility read from landing on the frame
    // from *before* this action — a mistake that costs a wrong capture and a full exploration,
    // against 0.8s saved. So it is skipped only on the evidence that something equivalent already
    // happened: agent-device reporting that it watched the UI go quiet after the action
    // (`settleQuietMs` above). A settle that was requested but not observed, and a swipe, which
    // cannot request one, both still pay it.
    if (action.type !== 'wait' && !settled) {
      await waitForRoute(ctx.signal, Math.max(0, deadline - Date.now()))
    }
  }
}

// `verifyAndSaveReplay` lived here: save the live recording, close the session and replay the file
// to prove it. Its one caller was the state-variant pass in `orchestrator.ts`, which now composes
// a state's journey out of command lines (the base screen's `pathCommands` plus the lines for the
// actions that open the variant) instead of recording a second `.ad` for it.

/**
 * Drop the recorded identity of every press that hangs off the node a divergence proved unstable,
 * give each unguarded press a selector wait in its place, and replay the result once.
 *
 * The only recovery tier there is. It used to be the second of two, reached once agent-device's
 * record-and-heal had declined, and the heal is gone because every firing of it this repo recorded
 * was a failure — the 20-05-23 evidence below, and the same three-seed result on the 15-07-13
 * sweep (`replay-divergence.ts`). There was never a fallback chain to lose, either: the two tiers
 * were selected by complementary predicates, so at most one of them could ever run on a given
 * divergence. See `unguardPressSteps` for why re-recording provably cannot fix this class, what the
 * strip gives up and what the inserted wait puts back.
 *
 * One pass, where this used to loop a strip and a replay per diverging step. The loop was charging
 * a full replay for information the first report already carried: instability belongs to a *node*,
 * and `ProfileFollowers` recorded that same node in the ancestry of both its presses. Measured on
 * the 15-53-19 sweep it spent 269-286s on two rounds, published nothing, and left the screen that
 * depended on it to walk itself from a cold launch. `unguardPressSteps` now acts on every press
 * sharing the proven ancestry at once, so there is one replay to pay for and nothing to iterate.
 *
 * Still evidence-gated, never optimistic. `parseStructuralOnlyMismatchStep` returns a step only
 * for an `IDENTITY_MISMATCH` with `matchCount === 1`, no competing candidate and no mismatched
 * field outside `ancestry[...]` and `position:` — the two that describe where the node sits rather
 * than what it is, and the two a replay cannot influence. Anything else — a `SELECTOR_MISS`, an
 * ambiguous match, a label that moved — declines with the original failure intact, as does
 * `unguardPressSteps` finding nothing to do, which is what stops a script already stripped from
 * being processed twice.
 *
 * `position:` is why this tier sees the walks that used to die in the heal. On the 20-05-23 sweep
 * `MyProfile`, `Profile` and `ProfileFollowers` all failed their tab-bar press with a position
 * mismatch reported alongside the ancestry one, which left the divergence looking heal-shaped:
 * all three were healed, all three heals reproduced the failure, and all three candidates were
 * discarded — 117s, 39% of that sweep, that published nothing. Counting position as structural
 * routes them here instead, because dropping the annotation stops pre-action verification running
 * and takes the position check with it.
 *
 * Only a failure carrying no divergence at all is retried, and only once: a divergence is the app
 * disagreeing with the script and repeating it changes nothing, whereas a bare `Daemon request
 * timed out` is the plumbing, and discarding a candidate over it reports a failure the app never
 * had. Measured: `Profile` lost its seed to exactly that, after a strip nothing suggests was wrong.
 *
 * The original bytes are restored on failure. A preserved `.failed` candidate is read to find out
 * what the walk recorded, and leaving an edited script there would misreport that.
 */
async function stripIdentityAndReplay(
  ctx: CaptureContext,
  device: CaptureDevice,
  scriptPath: string,
  destinationSelector: string,
  error: unknown,
  deadline: number
): Promise<boolean> {
  const step = parseStructuralOnlyMismatchStep(error)
  if (step === undefined) return false

  const original = await readFile(scriptPath, 'utf8').catch(() => undefined)
  if (original === undefined) return false

  const unguarded = unguardPressSteps(original.split('\n'), step)
  if (!unguarded) return false

  // The failed replay above was armed with `saveScript`, so it is holding a repair transaction and
  // would refuse to be replaced. A bare close ends the transaction without writing anything, which
  // is exactly right here: the script on disk is the one being edited, not one to be published.
  await device.client.sessions.close().catch(() => undefined)

  const attempt = async (): Promise<void> => {
    await runRepairedReplay(ctx, device, scriptPath, deadline)
    await measurePhase(ctx, 'device-wait', () =>
      device.client.command.wait({
        platform: ctx.platform,
        selector: destinationSelector,
        timeoutMs: 15_000
      })
    )
  }

  log(
    'saveAndReplayRecording',
    `dropped recorded identity at step(s) ${unguarded.stripped.join(', ')} of ${scriptPath}` +
      (unguarded.guarded.length > 0
        ? `; inserted a selector wait before step(s) ${unguarded.guarded.join(', ')}`
        : '')
  )
  await writeFile(scriptPath, unguarded.lines.join('\n'), 'utf8')

  let transientRetry = true
  while (Date.now() < deadline) {
    try {
      await attempt()
      log(
        'saveAndReplayRecording',
        `verified ${scriptPath} with ${unguarded.stripped.length} recorded identity(ies) dropped`
      )
      return true
    } catch (replayError) {
      const divergence = describeReplayDivergence(replayError)
      log(
        'saveAndReplayRecording',
        `${scriptPath} still diverges after unguarding — ${errorMessage(replayError)}${
          divergence ? ` — divergence: ${divergence}` : ''
        }`
      )
      if (divergence !== undefined || !transientRetry) break
      transientRetry = false
      log('saveAndReplayRecording', `no divergence reported — retrying ${scriptPath} once`)
    }
  }

  await writeFile(scriptPath, original, 'utf8').catch(() => undefined)
  log('saveAndReplayRecording', `restored ${scriptPath}; stripping did not make it replayable`)
  return false
}

async function runRepairedReplay(
  ctx: CaptureContext,
  device: CaptureDevice,
  scriptPath: string,
  deadline: number
): Promise<void> {
  const replay = await measurePhase(ctx, 'replay', () =>
    device.client.replay.run({
      path: scriptPath,
      platform: ctx.platform,
      udid: device.deviceId,
      keepSession: true,
      timeoutMs: Math.max(1_000, deadline - Date.now())
    })
  ) as { sessionActive: boolean }
  if (!replay.sessionActive)
    throw new Error(`Repaired replay ${scriptPath} did not keep an active session`)
  await waitForAppReady(
    ctx,
    device,
    ctx.signal,
    Math.max(0, Math.min(APP_READY_TIMEOUT_MS, deadline - Date.now()))
  )
}

/**
 * Save a recorded journey and replay it, leaving the verified session available to inspect.
 *
 * `destinationSelector` is not optional and not a nicety: agent-device's `sessions.saveScript`
 * refuses to publish an active-session script unless, after the last action it classifies as
 * mutating (every tap, fill and gesture the walk made), there is a `wait` on a selector whose
 * matched element it captured a re-verifiable identity for. That is the "portable destination
 * guard" in its error message, and `force: true` does not bypass it — force only governs
 * overwriting an existing file, while the guard scan runs before anything is written. So the wait
 * below is the only reason a saved exploration script can exist at all; without it every call here
 * throws and an already-verified journey is lost.
 *
 * The selector must resolve to an element bearing an id or an accessibility label, because
 * agent-device declines to record landmark evidence for a node with neither and then rejects the
 * guard for having no evidence. `serializeLocator` on a `by: 'label' | 'id'` locator guarantees
 * that by construction; `by: 'text'` does not, which is why callers must not pass one.
 *
 * `repairArmed` selects which of agent-device's two mutually exclusive publication paths to use,
 * and getting it wrong does not degrade gracefully — it throws. A session opened by
 * `replay.run({ saveScript })` is *repair-armed* (ADR 0012 decision 6: that option "arms
 * agent-supervised re-record repair from this replay attempt onward"), and such a session refuses
 * `sessions.saveScript` outright with "This session has an active .ad repair transaction and
 * cannot use ordinary active-session publication." It publishes only through its own finalize,
 * which is `sessions.close({ saveScript })` — the case agent-device's own `SessionCloseResult`
 * doc calls "a repair-armed session's finalize".
 *
 * This mattered far more than one failed script. A sweep's seeded walks all start with
 * `replay.run({ saveScript })` on a parent's verified replay, so every one of them was repair-armed
 * and every one failed to publish. A screen with no saved replay cannot become a seed for the next
 * screen, so the seed pool froze at whatever had been captured before the first seeded walk: in the
 * measured run that was three screens at t=246s, and all twelve subsequent bounded hops seeded from
 * the same stale `Profile` script, each paying a ~10s replay plus a full multi-step walk for a hop
 * that should have been one tap from its real parent.
 */
export async function saveAndReplayRecording(
  ctx: CaptureContext,
  device: CaptureDevice,
  scriptPath: string,
  destinationSelector: string,
  timeoutMs = 120_000,
  {
    repairArmed = false,
    verifyByReplay = true
  }: { repairArmed?: boolean; verifyByReplay?: boolean } = {}
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  await measurePhase(ctx, 'device-wait', () =>
    device.client.command.wait({
      platform: ctx.platform,
      selector: destinationSelector,
      timeoutMs: Math.max(1_000, Math.min(15_000, deadline - Date.now()))
    })
  )
  // Publication is the end of the transaction either way — it writes the file on one path and
  // finalizes the session on the other — and a publication that *throws* has ended it just as
  // surely (an abort is what the throw usually says). So the marker comes down before the attempt
  // rather than after a successful one: from here on there is nothing left for `goHome` to
  // protect, and the discard the caller runs on failure wants its soft home back.
  device.armedRecording = null
  if (repairArmed) {
    // One call, not two: the close *is* the publication here, so there is no `saveScript` step to
    // precede it. `force` carries the same meaning on both paths — overwrite an existing target
    // rather than refuse — and the candidate path is passed again even though the arming
    // `replay.run` already named it, because close's own `saveScript` is what decides where the
    // healed script lands and leaving it to the documented `<stem>.healed.ad` default would put
    // the file somewhere `publishScript` is not looking for it.
    await device.client.sessions.close({ saveScript: scriptPath, force: true })
  } else {
    // `saveScript` writes the file; nothing after it is publication. The bare `sessions.close()`
    // that used to follow was pure teardown — and on this harness teardown is not free: closing an
    // agent-device session tears down the XCUITest runner and takes the app under test with it
    // (see `reopenBoundApp`), so every successful walk ended by killing the app it had just proven
    // a journey through. The next node then opened on a dead process: a deep-link rung paying a
    // full cold start (`iOS Bundled 16079ms (6130 modules)` on a cold cache, ~2.5s warm) for a
    // navigation the live app would have answered immediately.
    //
    // Leaving the session open costs nothing it did not already cost. The script is on disk, so
    // nothing further is owed to it; the recording stays armed and keeps absorbing whatever device
    // commands come next, and that buffer is never read — the next walk's `startReplayRecording`
    // opens with its own `sessions.close()` (which discards an unfinalized transaction without
    // writing), and every other site that arms a `--save-script` transaction now ends this one
    // first through `endLiveSession`, which is what keeps agent-device from refusing the new
    // arming over a live one.
    //
    // The close is only skipped on this path. `repairArmed` above still closes because there the
    // close *is* the publication, and the `verifyByReplay` path below still closes because
    // `verifyAndRepairReplay` arms a repair transaction of its own — it calls `endLiveSession`
    // itself, where a close is free because the replay it is about to run relaunches the app from
    // the script's leading `open --relaunch` anyway.
    await device.client.sessions.saveScript({ path: scriptPath, force: true })
  }

  // `verifyByReplay: false` stops here, with the script on disk, nothing replayed, and — since
  // the save above no longer closes — the app still running on the destination screen.
  //
  // The replay below re-runs the journey that has just been walked, and its script opens with
  // `open --relaunch`, so every verification is a cold app start plus the whole walk again. On the
  // 20-05-23 sweep that was 11 replays, 54.4s, 18% of the run — and not one of the scripts it
  // verified was ever used as a seed, because nothing downstream of those screens was reached
  // before the sweep ended.
  //
  // What the replay proves is real and is not reproduced anywhere else: the live walk dispatched
  // its presses against the tree it was reading, with no identity verification, so a replay is the
  // first time the recorded `target-v1` evidence is re-read against a fresh tree. That is the
  // entire IDENTITY_MISMATCH class, and on the same sweep it caught three genuinely broken
  // scripts. It is not redundant — it is early. The caller that skips it is not giving the check
  // up, it is moving it to the first replay that was going to happen anyway: a seeded walk opens
  // with `replay.run({ path: seed, saveScript })`, which replays the seed and arms the next
  // recording in one call, so the seed's verification is already paid for there. A script nothing
  // ever seeds off is published unverified and says so (`replayVerified: false`), which is a
  // better artefact than the verified one we were paying a cold relaunch to produce and then
  // never reading.
  //
  // The recovery tier goes with it, necessarily — `stripIdentityAndReplay` is driven by a
  // divergence report, and there is no report without a replay. It runs unchanged at the deferred
  // verification instead.
  if (!verifyByReplay) return

  await verifyAndRepairReplay(ctx, device, scriptPath, destinationSelector, deadline)
}

/**
 * Replay a script that is already on disk, and repair it in place if it diverges.
 *
 * The second half of what `saveAndReplayRecording` used to do inline, lifted out because it is no
 * longer only that function's business. Verification now happens at first use rather than at
 * publication, so the caller that discovers a divergence is usually the saved-replay rung, and it
 * needs the strip — otherwise deferring verification would quietly mean giving repair up, and the
 * one script the strip rescued on the 20-05-23 sweep (`SearchTab/Search`) would have stayed broken
 * for every sweep that followed.
 *
 * `destinationSelector` is where the strip waits after rewriting a step. A caller that recorded the
 * script has it in hand; one that did not reads it back off the script's trailing guard with
 * `destinationGuardSelector`.
 *
 * `replayError` is the divergence the caller is already holding, and passing it is what skips the
 * opening replay below. The callers genuinely differ here, so it is optional rather than required:
 * `saveAndReplayRecording`, `savedReplayStrategy` and the manual replay button have *not* replayed
 * the script — for them this call is the replay, and its success is what leaves the app on the
 * destination with a live session. Only `replaySeedBase` arrives after a failed armed replay of
 * this same script, and for it the opening replay re-derived, at a measured ~6.2s, a divergence it
 * already had in hand. Nothing downstream needs the session that replay opened: the strip's first
 * act is to close whatever session is live (it must, to release the caller's armed repair
 * transaction) and its `runRepairedReplay` relaunches from the script's leading `open --relaunch`,
 * carrying its own `waitForAppReady`.
 */
export async function verifyAndRepairReplay(
  ctx: CaptureContext,
  device: CaptureDevice,
  scriptPath: string,
  destinationSelector: string,
  deadline: number,
  replayError?: unknown
): Promise<void> {
  // Whatever session the caller was holding ends here, before the armed replay below asks for one
  // of its own. Two callers can arrive with a live session now: `saveAndReplayRecording`'s
  // non-repair path, which stopped closing after `saveScript` so the app survives into the next
  // node, and the saved-replay rung, which may be reached with the previous node's recording still
  // armed. Either way agent-device will not arm a second `--save-script` transaction over a live
  // one — `stripIdentityAndReplay` names the refusal — and the close is free here regardless,
  // because `runReplay` immediately replays a script whose first line is `open --relaunch`.
  await endLiveSession(device)
  // The script is on disk by this point, so recovery below only has to redo the replay, never the
  // walk that produced it: `runReplay` is what a retry re-runs after the app is relaunched.
  //
  // `saveScript` here is not a second publication — the script was already written above — it is
  // what arms the repair transaction, and arming is the whole reason a divergence is survivable:
  // an unarmed replay reports the divergence and is done with it, while an armed one holds the
  // session open at the failed step. On the clean path the arming costs nothing: nothing finalizes
  // the transaction with `sessions.close({ saveScript })`, and a transaction nobody finalizes
  // simply never writes.
  const runReplay = async (): Promise<void> => {
    const replayTimeoutMs = Math.max(1_000, deadline - Date.now())
    const replay = await measurePhase(ctx, 'replay', () =>
      device.client.replay.run({
        path: scriptPath,
        platform: ctx.platform,
        udid: device.deviceId,
        keepSession: true,
        saveScript: scriptPath,
        force: true,
        timeoutMs: replayTimeoutMs
      })
    ) as { sessionActive: boolean }
    if (!replay.sessionActive)
      throw new Error(`Replay ${scriptPath} did not keep an active session`)
    await waitForAppReady(
      ctx,
      device,
      ctx.signal,
      Math.max(0, Math.min(APP_READY_TIMEOUT_MS, deadline - Date.now()))
    )
  }

  let error = replayError
  if (error === undefined) {
    try {
      await runReplay()
      return
    } catch (firstFailure) {
      error = firstFailure
    }
  }

  if (await stripIdentityAndReplay(ctx, device, scriptPath, destinationSelector, error, deadline))
    return
  // See `isMissingSessionError`'s doc comment: a daemon replaced mid-walk kills whatever session
  // `replay.run` opens for itself, and that death can surface as this generic "could not capture
  // a fresh snapshot" wrapper instead of the literal "no active session" wording — the same
  // underlying cause `captureScreenshot` above recovers from. One retry only: if the replay still
  // cannot get a session back after `reopenBoundApp`, this is a real replay failure and must
  // propagate rather than loop.
  if (!isMissingSessionError(error)) throw error
  log(
    'saveAndReplayRecording',
    `no active session mid-replay, recovering — ${describeSessionLoss(errorMessage(error), agentDeviceErrorHint(error))}`
  )
  await reopenBoundApp(ctx, device)
  await runReplay()
}

// `recordStateFromReplay` lived here: replay a base screen's `.ad` armed with `saveScript`, run a
// fixed action list, and finalize the repair transaction into a state-variant script. Same caller,
// same reason it is gone — see the note on `verifyAndSaveReplay` above.

/** The one-line `pathToReach` form for a published `.ad`. Only the manual recorder produces one
 *  now; `buildAgentDeviceScreens` still reads it for a capture that carries a manual script. */
export function replayPathToReach(device: CaptureDevice, scriptPath: string): string[] {
  return [...device.setupCommands, `agent-device replay ${quoteCliArg(scriptPath)} --keep-session`]
}

/**
 * `relaunched: true` means the missing-session recovery branch fired: `reopenBoundApp` relaunches
 * the app at its launch URL before the screenshot is taken, so the frame this call returns is the
 * *launch screen*, not whatever the caller had navigated to. Callers must not record that frame as
 * the target's capture — see `decideDelivery` in `reach/delivery.ts`, which is what this flag exists
 * to feed. The other recovery call sites (`openUrlInSession`) re-open the original URL afterwards
 * and so never need this signal.
 */
export async function captureScreenshot(
  ctx: CaptureContext,
  device: CaptureDevice,
  path: string
): Promise<{ relaunched: boolean }> {
  log('screenshot', path)
  try {
    // A screenshot is a read: re-running it whole is safe, and a busy runner is the normal
    // aftermath of dozens of taps and accessibility snapshots on an animating screen — exactly
    // what exploration does right before the screenshot that confirms arrival, making this the
    // call in the sweep most likely to hit the watchdog and the one that least deserves to lose a
    // verified arrival over it. Mirrors `capturePressables` below.
    await measurePhase(ctx, 'screenshot', () =>
      retryWhileRunnerBusy(() => device.client.capture.screenshot({ path }), {
        signal: ctx.signal,
        onRetry: (attempt, waitMs) =>
          log('screenshot', `runner busy; retry ${attempt} in ${Math.round(waitMs / 1000)}s`)
      })
    )
    log('screenshot', 'saved')
    return { relaunched: false }
  } catch (error) {
    if (!isMissingSessionError(error)) throw error
    // `path` names the caller's frame (`verify-deep-link-check.png`, `explore.png`, a delivery
    // capture), which is the only record of what the sweep was in the middle of when the session
    // turned out to be gone.
    log(
      'screenshot',
      `no active session, recovering — while saving ${basename(path)} — ${describeSessionLoss(errorMessage(error), agentDeviceErrorHint(error))}`
    )
    // Waits for the relaunched app to settle. The frame itself is still reported as `relaunched`
    // and must not be recorded as the target's capture, but everything the sweep does *after* this
    // recovery — the next deep link, above all — now finds an app that can act on it.
    await reopenBoundApp(ctx, device)
    await measurePhase(ctx, 'screenshot', () => device.client.capture.screenshot({ path }))
    return { relaunched: true }
  }
}

// A path no router can match. Long and self-describing so it is recognisable in Metro logs.
const UNMATCHED_PROBE_PATH = '__app-flow-probe-no-such-route'

/**
 * Opens a deep link that cannot match any route and reports what the app renders for it.
 *
 * That screen is the reference for "this capture never arrived": a route whose capture looks the
 * same as an impossible route's either did not resolve, or never got the chance because something
 * intercepted the navigation. This is screenmap's bogus-param probe one level up — route instead
 * of param — and it needs to know nothing about what the intercepting screen *is*.
 *
 * Returns null when the app has no usable URL scheme, in which case arrival cannot be checked and
 * callers must treat captures as unverified rather than guess.
 */
export async function probeUnmatchedRoute(
  ctx: CaptureContext,
  device: CaptureDevice
): Promise<AppFlowPressable[] | null> {
  const url =
    device.useCustomScheme && ctx.scheme
      ? `${ctx.scheme}://${UNMATCHED_PROBE_PATH}`
      : device.launchUrl
        ? `exp://127.0.0.1:${device.metroPort}/--/${UNMATCHED_PROBE_PATH}`
        : null
  if (!url) return null
  log('probeUnmatchedRoute', url)
  try {
    await openUrlInSession(ctx, device, device.launchTarget, url)
    await waitForRoute(ctx.signal)
    return await capturePressables(ctx, device)
  } catch (error) {
    log('probeUnmatchedRoute', `failed: ${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}

export async function capturePressables(
  ctx: CaptureContext,
  device: CaptureDevice,
  timeoutMs = 30_000,
  options?: {
    /**
     * Absolute timestamp past which this read is of no use to the caller, so the busy-retry backoff
     * can stop short instead of sleeping into it — see `RunnerBusyRetryOptions.deadlineAt`. Callers
     * that are themselves on a clock (`waitForAppReady`) pass theirs; a one-off read has no deadline
     * beyond `timeoutMs` and omits it, keeping the full retry schedule.
     */
    deadlineAt?: number
    /**
     * How many times a busy runner is retried. Defaults to the full schedule. A caller whose read
     * is a *question about whether the device is answering at all* passes 0: for it, `RUNNER_BUSY`
     * is not an obstacle in front of the answer, it is the answer.
     */
    retries?: number
  }
): Promise<AppFlowPressable[]> {
  // A snapshot is a read: re-running it whole is safe, and a busy runner is the normal aftermath
  // of a watchdogged capture on a heavy or animating screen rather than a failure of this screen.
  const snapshot = await measurePhase(ctx, 'device-read', () =>
    retryWhileRunnerBusy(
      () =>
        device.client.capture.snapshot({
          platform: ctx.platform,
          // The client defaults to the compact digest response level for routine App
          // Flow commands. Snapshot extraction needs the typed node payload instead.
          responseLevel: 'default',
          interactiveOnly: true,
          // No `customActions`. It was requested on every read in this module and consumed by
          // none of them: the node loop below keeps `value`, `label`, `identifier` and `role`,
          // and nothing downstream of `AppFlowPressable` has ever had a field to put an
          // accessibility custom action in. On the iOS simulator the flag is not free — it
          // selects a capability the snapshot backend then has to be admitted for, and enumerates
          // the custom actions of every merged element — so this was per-element device work on
          // all 114 reads of the reference sweep in service of a field that was dropped on the
          // floor. How much of the measured 1.56s it was buying is exactly what the next sweep
          // will say; the case for removing it does not depend on the answer.
          forceFull: true,
          noRecord: true,
          timeoutMs
        }),
      {
        signal: ctx.signal,
        deadlineAt: options?.deadlineAt,
        retries: options?.retries,
        onRetry: (attempt, waitMs) =>
          log('capturePressables', `runner busy; retry ${attempt} in ${Math.round(waitMs / 1000)}s`)
      }
    )
  ) as { nodes?: unknown }

  if (!Array.isArray(snapshot.nodes)) {
    throw new Error('agent-device snapshot did not return a nodes array')
  }

  const seen = new Set<string>()
  const pressables: AppFlowPressable[] = []

  for (const nodeValue of snapshot.nodes) {
    if (!nodeValue || typeof nodeValue !== 'object') continue
    const node = nodeValue as {
      visibleToUser?: boolean
      enabled?: boolean
      role?: string
      type?: string
      value?: string
      label?: string
      identifier?: string
    }
    // The snapshot is already scoped to interactive elements. React Native Pressable
    // children are commonly exposed by iOS as StaticText without a button role or a
    // truthy hittable field, even though agent-device can press them by text/label.
    // Filtering those fields here would discard the exact selector candidates we need.
    if (node.visibleToUser === false || node.enabled === false) continue

    const semanticType = `${node.role ?? node.type ?? ''}`
      .toLowerCase()
      .replace(/^xcuielementtype/, '')
    if (['application', 'window', 'scrollview', 'scroll-view'].includes(semanticType)) continue

    const pressable: AppFlowPressable = {
      ...(node.value ? { text: node.value } : {}),
      ...(node.label ? { label: node.label } : {}),
      ...(node.identifier ? { identifier: node.identifier } : {}),
      ...(node.role || node.type ? { role: node.role ?? node.type } : {})
    }
    if (![pressable.text, pressable.label, pressable.identifier].some((value) => value?.trim())) {
      continue
    }

    const identity = JSON.stringify(pressable)
    if (seen.has(identity)) continue
    seen.add(identity)
    pressables.push(pressable)
  }

  // Every successful read, not just the ones a caller keeps. This is the only funnel for
  // accessibility reads in this module, so stamping it here is what lets `openDeepLink` answer
  // "is the process alive and drawing" without spending a snapshot of its own.
  device.lastRead = { at: Date.now(), pressables }
  return pressables
}

function stopLaunchProcess(child: ChildProcess | null): void {
  if (!child?.pid) return
  try {
    child.kill('SIGTERM')
  } catch {
    // Process already exited.
  }
}

export async function closeDevice(device: CaptureDevice): Promise<void> {
  log('closeDevice', 'stop Metro if we started it, sessions.close --shutdown')
  stopLaunchProcess(device.launchProcess)
  await endMetroLogFile(device.metroLogPath)
  try {
    await device.client.sessions.close({ shutdown: true })
    log('sessions.close', 'done')
  } catch (error) {
    console.error('Failed to close agent-device session:', error)
  }
}
