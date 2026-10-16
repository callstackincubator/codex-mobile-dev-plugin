import { EventEmitter } from 'node:events'
import { createHash, randomUUID } from 'node:crypto'
import { copyFile, readFile, unlink } from 'node:fs/promises'
import { basename, isAbsolute, join } from 'node:path'
import * as Sentry from '@sentry/node'
import type {
  AgentDeviceScreenEntry,
  AgentDeviceScreensMap,
  AppFlowCapture,
  AppFlowCaptureStatus,
  AppFlowBuildMode,
  AppFlowChrome,
  AppFlowDeepLinkRejection,
  AppFlowEdge,
  AppFlowManifest,
  AppFlowNavigation,
  AppFlowNode,
  AppFlowPressable,
  AppFlowProgressEvent,
  AppFlowPrompt,
  AppFlowPromptResolution,
  AppFlowResult,
  AppFlowStep,
  AppFlowTrigger,
  DeepLinkJudgeMode,
  ExplorationMode,
  TokenUsage
} from '../shared/app-flow.ts'
import { addTokenUsage, carriedSweepDurationMs } from '../shared/app-flow.ts'
import type { AppFlowDecisionProvider } from './decision-provider.ts'
import {
  parseSubAgentJson,
  type SubAgentCallOptions,
  type SubAgentOptions,
  type SubAgentResult,
  type SubAgentSessionOptions
} from './decision-provider.ts'
import { emptyTokenUsage, snapshotUsage } from '../server/app-flow-deps/pi/usage.ts'
import {
  APP_READY_SETTLE_SIMILARITY,
  bootDevice,
  buildAgentDevicePathToReach,
  capturePressables,
  captureScreenshot,
  closeDevice,
  executeNavigationActions,
  goHome,
  isOnDevClientLauncher,
  openDeepLink,
  replayPathToReach,
  reopenBoundApp,
  SUBSTANTIVE_FRAME_GRACE_MS,
  waitForAppReady,
  settleAfterRoute,
  type CaptureContext,
  type CaptureDevice
} from './capture.ts'
import { parseProject } from './parser.ts'
import { baselineLaunchCommands, walkCommands, walkStepCommand } from './walk-commands.ts'
import { contentMatchedSelectors, minimizeWalkCommands } from './path-minimize.ts'
import { isPathVerified } from './path-provenance.ts'
import { runPathToReach } from './path-run.ts'
import type { RenderTransport } from './reach/adapters.ts'
import { createReachPorts } from './reach/adapters.ts'
import { CdpConnection, createTargetResolver } from './cdp/connection.ts'
import { listMetroTargets, type MetroCdpTarget } from './cdp/discovery.ts'
import type { NavigateReply, ReadinessReply } from './cdp/agent-runtime.ts'
import { agentSource } from './cdp/runtime-source.ts'
import {
  AUTH_GATE_FRAME_WAIT_MS,
  settlesAuthGateForRun,
  type AuthGateResolution
} from './reach/auth-gate-policy.ts'
import { formatPhaseSummary, PhaseLedger } from './timing.ts'
import { hedge } from './hedge.ts'
import {
  chromeEdges,
  chromeVirtualNodes,
  navigatorChrome,
  rebuildChromeEdges,
  detectChromeInventory,
  findDrawerOpener,
  findMatchingChrome,
  inferChromeKind,
  mergeChromeInventory,
  type ChromeCandidate
} from './reach/chrome-inventory.ts'
import { buildChromePathToReach } from './reach/chrome-path.ts'
import {
  carryForwardDeepLinkRejection,
  initialDeepLinkBreakerState,
  registerDeepLinkFailure,
  registerDeepLinkSuccess,
  type DeepLinkBreakerState
} from './reach/deep-link-policy.ts'
import {
  chooseDeliverySources,
  decideDelivery,
  type DeliveryScreenshotOutcome
} from './reach/delivery.ts'
import { runReachLadder, strategiesFor, type ReachStrategy } from './reach/ladder.ts'
import {
  NAVIGATION_SYSTEM_PROMPT,
  RUNTIME_SCREEN_SYSTEM_PROMPT,
  STATE_TRIGGER_SYSTEM_PROMPT
} from './reach/prompts.ts'
import { ReachQueue } from './reach/queue.ts'
import { defaultScreenInfo, fallbackScreenKey, uniqueScreenKey } from './screen-keys.ts'
import {
  matchRuntimeNode,
  mintRuntimeNode,
  recordRuntimeSighting,
  sanitizeScreenKey
} from './reach/runtime-nodes.ts'
import {
  PROBE_FRAME_ELEMENT_FLOOR,
  PROBE_LAUNCH_READY_BUDGET_MS,
  isSubstantiveFrame,
  judgeProbeFrame,
  pickProbeRoute
} from './reach/probe-route.ts'
import { findSeedSource } from './reach/seed.ts'
import {
  createWalkCursor,
  mergeWalkEdge,
  noteWalkAction,
  noteWalkArrival,
  type WalkCursor
} from './reach/walk-edges.ts'
import { computeStructureKey } from './reach/structure-key.ts'
import { reconcileSweepProgress } from './reach/checkpoint.ts'
import { renderStrategy } from './reach/strategies/render.ts'
import { deepLinkStrategy } from './reach/strategies/deep-link.ts'
import { savedReplayStrategy } from './reach/strategies/saved-replay.ts'
import { isFallbackRoute, orderSweepNodes } from './reach/sweep-order.ts'
import { ExplorationControl, type ExplorationPauseReason } from './reach/exploration-control.ts'
import type {
  ArrivalVerdict,
  DiscoveredFact,
  ReachAttempt,
  ReachEffect,
  ReachEvidence
} from './reach/types.ts'
import { fingerprint, similarity, tokenize } from './screen-signals.ts'
import {
  ActiveTimeBudget,
  DeepLinkRejectionMemo,
  GuardGateMemo,
  EXPLORATION_MAX_DECISIONS,
  demoteFailedHarvest,
  describeJourney,
  expectedNodeTokens,
  findNavigationPath,
  isToolingFailure,
  shouldRetryFromEntry,
  parseNavigationDecision,
  pickOpportunisticCandidate,
  resolveNodeParams,
  summarizePressables,
  type ParamStoreLike,
  runInteractiveExploration,
  type ExplorationResult
} from './exploration.ts'
import {
  AUTH_CHECKPOINT_SLUG,
  clearSweepProgress,
  generateSlug,
  generateStateSlug,
  getFlowsDir,
  getProjectId,
  getScratchPath,
  getScreenshotPath,
  prepareScratchDir,
  pruneTransientScreens,
  registerProject,
  readAppFlow,
  readAgentDeviceScreens,
  readManifest,
  readParamStore,
  readSweepProgress,
  screenshotUrl,
  writeAgentDeviceScreens,
  writeAppFlow,
  writeCaptureStatus,
  writeManifest,
  writeParamStore,
  writeSweepProgress
} from './storage.ts'
import { ParamStore } from './param-store.ts'
import { readNavState, selectNavStateTarget, type NavStateDeps } from './nav-state.ts'
import { NAV_STATE_SPECULATIVE_READS, selectNavStateWaiters } from './nav-state-gate.ts'
import { resolveNavRouteTarget } from './nav-route-target.ts'
import { runShellCommand } from './shell.ts'
import {
  agentDeviceCdp,
  parseCdpTargetList,
  pickMetroCdpTarget,
  shellQuote
} from '../server/app-flow-deps/profiling/cdp.ts'

export type AppFlowPhase = 'parse' | 'boot' | 'capture' | 'classify' | 'states' | 'render'

/** Slug of the screenshot shown to the user when the build stops on a screen it cannot leave. */
const BLOCKED_SLUG = '--blocked'

// `computeStructureKey` moved to `reach/structure-key.ts` (plan Step 4b) — that module has no
// Electron import and is unit-testable under `node --test`, which `orchestrator.ts` itself is not.

/**
 * Above this fingerprint overlap, two failed destinations are treated as showing the same UI.
 * Only a near-identical screen advances the no-progress counter because shared app chrome alone
 * must not condemn a capture.
 */
const ARRIVAL_SIMILARITY = 0.9

/**
 * How many routes in a row must fail to arrive before the build stops and asks the user. One
 * failure is ordinary — a param that resolves to nothing. Three different routes rendering the
 * same screen is the app refusing to navigate at all.
 */
const BLOCKED_RUN_LIMIT = 3

async function computeFastSourceHash(
  projectPath: string,
  nodes: readonly AppFlowNode[]
): Promise<string> {
  const hash = createHash('sha256')
  const files = [...new Set(nodes.map((node) => node.file).filter((file): file is string => !!file))]
    .sort()
  for (const file of files) {
    const absolute = isAbsolute(file) ? file : join(projectPath, file)
    hash.update(file).update('\0')
    try {
      hash.update(await readFile(absolute))
    } catch {
      hash.update('unreadable')
    }
    hash.update('\0')
  }
  return hash.digest('hex').slice(0, 24)
}

// The deep-link circuit breaker's limit is `reach/deep-link-policy.ts`'s `DEEPLINK_BREAKER_LIMIT` —
// moved there in landing-order item 4 along with the breaker's state and decisions, so its own
// module can be unit-tested with no device and no sweep-scoped closure. See that module's doc
// comment on `DeepLinkBreakerState`.

/**
 * How many opportunistic arrival checks a single exploration walk toward one target may spend on
 * *other* pending screens it happens to pass through. Every one of them is a real vision call
 * charged against that walk's own five-minute budget, and shared hub screens (Settings, Profile,
 * Moderation) turn up on nearly every walk in a sweep like social-app's — an unbounded cap would
 * let confirming screens seen many times over eat the budget the walk needs for its actual target.
 * Two is enough to catch most of what a five-minute walk passes through without meaningfully
 * competing with the target's own decisions for that budget.
 */
const OPPORTUNISTIC_VERIFY_LIMIT = 2

/**
 * Below this much budget left, opportunistic verification is skipped outright rather than spent —
 * a check that itself times out mid-call would burn the walk's last reserves confirming a screen
 * it did not come here for, right as the real target most needs whatever time remains.
 */
const OPPORTUNISTIC_MIN_REMAINING_MS = 60_000

/**
 * How many nodes the sweep will mint for screens the parser never registered a route for at all
 * (plan Step 4a). Every mint costs a model call (`RUNTIME_SCREEN_SYSTEM_PROMPT`) on top of whatever
 * opportunistic budget it shares with known-node capture, but the real reason for a hard ceiling is
 * that a bad affirmative — a modal or a partially-loaded frame the judge misjudged as distinct — is
 * only ever caught by a human looking at the graph afterward. Ten is generous for a build the parser
 * genuinely missed a handful of screens in, without letting a systematically wrong judge answer
 * flood the graph with junk nodes for the rest of an 80-screen sweep.
 */
const RUNTIME_NODE_SWEEP_CAP = 10

/**
 * How long the adopt path re-confirms the pre-launched app before deciding it is not ready and
 * soft re-rooting it.
 *
 * Shorter than the 90s `APP_READY_TIMEOUT_MS` the fresh-boot branch takes because this is not a
 * cold start and must not be budgeted like one: `index.ts`'s Launch already ran `waitForAppReady`
 * to completion and only stored the device once it returned, so the bundle is built, Metro is
 * warm, and the app was on a settled screen before the Start button was even enabled. On the
 * 2026-10-09 social-app run that settle landed at t=43.9s and Start came at t=64.2s — twenty
 * seconds in which the only things that can go wrong are the user backgrounding the app, the
 * simulator sleeping, or the agent-device session dropping, and a warm app re-settles in about
 * two reads.
 *
 * Fifteen seconds therefore buys headroom for a slow accessibility read or a screen the user left
 * mid-transition, and nothing else. Spending the full 90s here would be strictly worse than the
 * bug being fixed in the dead-app case, since the recovery that follows is cheap and the wait
 * that precedes it is not: the floored wait only returns early on failed reads, so a backgrounded
 * app that answers slowly would otherwise hold the sweep for a minute and a half before anyone
 * tried the one thing that fixes it.
 */
const ADOPTED_APP_READY_BUDGET_MS = 15_000

export interface AppFlowBuildOptions {
  projectPath: string
  mode?: AppFlowBuildMode
  /** Maximum screens to process in this device sweep. Omitted means no limit. */
  screenLimit?: number
  /**
   * Maximum screen *attempts* — reached or not — this sweep may spend. Omitted derives it from
   * `screenLimit`; see `ExplorationControl`'s `DEFAULT_ATTEMPTS_PER_SCREEN` for why a sweep bounded
   * only by successful captures has no bound at all.
   */
  attemptLimit?: number
  /** Wall-clock (active time, excluding waits on the user) this sweep may spend. Omitted derives it
   *  from `screenLimit` — see `DEFAULT_MS_PER_SCREEN`. */
  sweepDeadlineMs?: number
  /** Cooperative pause request, observed only between durable per-screen checkpoints. */
  pauseRequested?: () => boolean
  /** Host-provided decisions. Required for screen sweeps; structure-only builds do not use it. */
  decisionProvider?: AppFlowDecisionProvider
  /**
   * Which reach mechanisms this sweep may use for a screen no URL can address. Omitted means
   * `auto`. See `ExplorationMode`, and `strategiesFor` for the ladder each one produces.
   */
  explorationMode?: ExplorationMode
  /**
   * Whether a deep link's arrival is confirmed by the vision judge. Omitted means `on` — the
   * behaviour every sweep had before this option existed. Consumed at exactly one place, the
   * deep-link rung's `arrivalJudge`. See `DeepLinkJudgeMode`, and `reach/not-found-signal.ts` for
   * what stands in for the judge's `status: 'not-found'` when it is `off`.
   */
  deepLinkJudgeMode?: DeepLinkJudgeMode
  /** An app the user already launched. The sweep adopts it instead of building and booting again. */
  launchedDevice?: CaptureDevice
  onEvent(event: AppFlowProgressEvent): void
  signal?: AbortSignal
  /**
   * Asks the user to unblock the build by acting on the device, and resolves when they answer.
   * The device is left running throughout. Omitted (or resolving to `stop`) ends the sweep while
   * preserving the structural graph and partial captures.
   */
  requestUserAction?(prompt: AppFlowPrompt): Promise<AppFlowPromptResolution>
}

export interface AppFlowBuildResult {
  ok: true
  projectId: string
  result: AppFlowResult
}

export interface AppFlowBuildError {
  ok: false
  error: string
}

function checkSignal(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error('Cancelled')
}

function emit(
  projectId: string,
  onEvent: (event: AppFlowProgressEvent) => void,
  event: AppFlowProgressEvent
): void {
  try {
    onEvent({ ...event, projectId })
  } catch (error) {
    console.error('App flow event listener error:', error)
  }
}

// `sanitizeScreenKey` moved to `reach/runtime-nodes.ts` (plan Step 4a) — a runtime node's id is
// derived from the judge's own `key` through this exact function, so it lives in one place rather
// than risking a second copy drifting from the one this file used to keep privately.

function buildAgentDeviceScreens(
  nodes: AppFlowNode[],
  edges: AppFlowEdge[],
  runtimeEdges: AppFlowEdge[],
  chrome: AppFlowChrome[],
  ctx: CaptureContext,
  device: CaptureDevice,
  openedByNode: Record<string, { app: string; url: string }>,
  inferred: Record<string, { key?: string; info?: string | null }>,
  captures: Record<string, AppFlowCapture>
): AgentDeviceScreensMap {
  const used = new Set<string>()
  const screens: AgentDeviceScreensMap = {}

  for (const node of nodes) {
    const params = pickSampleParams(node, edges)
    const guessed = inferred[node.id]
    const key = uniqueScreenKey((guessed?.key ?? '').trim() || fallbackScreenKey(node), used)
    const info = guessed?.info?.trim() || defaultScreenInfo(node)
    const capture = captures[node.id]
    // Four sources, first match wins, and the new first one is what replaced the sweep's `.ad`
    // scripts: `capture.pathCommands` is the walk's own `agent-device …` lines, already carrying
    // their baseline launch prefix (`walk-commands.ts`). It comes before `replayScript` because a
    // node can hold both — a manual recording from an earlier session plus a walk from this one —
    // and the command list is the one this sweep just proved.
    //
    // `replayScript` stays for exactly one producer: the manual recorder, which still publishes a
    // real `.ad` file. Nothing in the sweep writes one now.
    const pathToReach = capture?.pathCommands?.length
      ? [...capture.pathCommands]
      : capture?.replayScript
        ? replayPathToReach(device, capture.replayScript)
        : openedByNode[node.id]
          ? buildAgentDevicePathToReach(ctx, device, node, params, openedByNode[node.id])
          : (buildChromePathToReach(node, edges, runtimeEdges, chrome, device) ?? [])
    if (pathToReach.length === 0) continue
    // Whether anything ever ran this path, as opposed to inferring it — the same four tests in the
    // same order as the ladder just above, which is why they live in one pure, tested place rather
    // than being spelled out a second time here. See `path-provenance.ts` for why the question
    // needs asking at all, and `AppFlowCapture.pathVerified` for what the answer is used for.
    const pathVerified = isPathVerified({
      pathCommands: capture?.pathCommands,
      replayScript: capture?.replayScript,
      replayVerified: capture?.replayVerified,
      deepLinkOpened: Boolean(openedByNode[node.id])
    })
    const entry: AgentDeviceScreenEntry = {
      key,
      screenId: node.id,
      info,
      pressables: capture?.pressables ?? [],
      pathToReach,
      pathVerified,
      // Reported, not acted on — see `contentMatchedSelectors`. Computed from the finished path
      // rather than threaded out of the walk so it covers all four sources uniformly: the stored
      // `Profile-List` path leans on `label="Dummy"` (a list this account owns) and the stored
      // `TermsOfService` path on `label="Terms of Service"`, and both are facts about the path, not
      // about which producer wrote it.
      pathContentSelectors: contentMatchedSelectors(pathToReach),
      replayScript: capture?.replayScript ?? null,
      replayVerified: capture?.replayVerified ?? false,
      // A state variant carries its own full command list now — the base screen's path plus the
      // lines for the actions that opened the variant — so the filter is on that rather than on a
      // `.ad` path. `replayScript` is still passed through for a states entry carried forward from
      // a document written before the change.
      replayStates:
        capture?.states
          .filter((state) => state.pathCommands?.length || state.replayScript)
          .map((state) => ({
            name: state.name,
            pathToReach: [...(state.pathCommands ?? [])],
            replayScript: state.replayScript ?? null,
            replayVerified: true
          })) ?? []
    }
    screens[key] = entry
  }

  return screens
}

/**
 * Stamp each node's capture with whether `buildAgentDeviceScreens` gave it an entry.
 *
 * The Replay button needs to know whether a screen has a stored `pathToReach`, and the renderer
 * never reads `agent-device-screens.json` — see `AppFlowCapture.replayable` for the two ways
 * inferring it from `capture.status` went wrong. Taking the answer from the screens map means the
 * document and the map cannot disagree about it.
 *
 * Shared because the sweep writes the document twice from two separately assembled node arrays —
 * `persistCaptureUpdate` after every screen, and the final write at the end — and the second one
 * lands last. Stamping only the first is the same as not stamping at all: the first sweep after
 * this field was added still wrote `replayable: undefined` for all twenty screens, because the
 * end-of-sweep rebuild had its own copy of the node assembly and no knowledge of the field.
 */
function withReplayableCaptures<T extends AppFlowNode>(
  nodes: readonly T[],
  screens: AgentDeviceScreensMap
): T[] {
  const entries = new Map(
    Object.values(screens)
      .filter((entry): entry is AgentDeviceScreenEntry & { screenId: string } =>
        Boolean(entry.screenId)
      )
      .map((entry) => [entry.screenId, entry])
  )
  return nodes.map((node) => {
    if (!node.capture) return node
    const entry = entries.get(node.id)
    return {
      ...node,
      capture: {
        ...node.capture,
        replayable: Boolean(entry),
        // Carried across for the same reason `replayable` is: the renderer never reads
        // `agent-device-screens.json`, so anything the Replay button has to say about the path it
        // is about to run has to be on the capture. Stamped from the entry the map actually holds,
        // never re-derived, so the document and the map cannot disagree about whether a path was
        // walked.
        ...(entry ? { pathVerified: entry.pathVerified ?? false } : {}),
        ...(entry?.pathContentSelectors?.length
          ? { pathContentSelectors: [...entry.pathContentSelectors] }
          : {})
      }
    }
  })
}

/** Where exploration starts when a deep link can put it partway to the target. */
interface DeepLinkSeed {
  /** Node id of the ancestor route the app is opened at. */
  id: string
  /** Its route pattern, for the planner's benefit. */
  urlPath: string
  /** The URL the recorded launch uses. */
  url: string
}

/**
 * Where a bounded last-hop exploration starts when `reach/seed.ts` found a screen this sweep has
 * already reached and stored a journey for — plan Step 3e.
 *
 * `commands` replaces the `script` this used to carry. The walk begins by *running the parent's
 * stored `pathToReach`* line by line (`DevicePort.runPathCommands`) rather than by replaying a
 * `.ad` file, and the target's own path becomes those same lines plus whatever the last hop takes
 * — "replay the parent, then do the last hop" with nothing on disk and nothing to arm, repair or
 * publish. `trigger` is the named control the parent's outgoing edge pointed at the target with,
 * when `findSeedSource` found one — handed to the planner as a strong hint rather than a command,
 * since the recorded control can drift from what is on screen right now.
 */
interface CommandSeed {
  id: string
  /** The parent's stored `pathToReach`, baseline launch line included, so it stands alone. */
  commands: readonly string[]
  trigger: AppFlowTrigger | null
}

type ExplorationSeed = DeepLinkSeed | CommandSeed

/** What one role has cost the sweep so far. */
interface AgentTokenTally {
  calls: number
  tokens: TokenUsage
}

/**
 * What one model call was actually handed, logged before it runs.
 *
 * A token line says a call cost 324,000 tokens; it cannot say whether that was one enormous prompt,
 * a screenshot, or the agent quietly reading source files for forty seconds. Those need different
 * fixes, and telling them apart after the fact was impossible from the log alone. Images are named,
 * never dumped — a base64 screenshot would bury every other line in the file — and prompts are
 * reported by size with a short head, which is enough to recognise a prompt that has grown without
 * anyone intending it to.
 */
function logAgentInput(
  label: string,
  input: {
    systemPrompt?: string
    userPrompt: string
    imagePath?: string
    tools?: string[]
    /** Turns already in a session's history when this call was made. Absent for one-shot roles,
     *  which have none — its whole purpose is to show whether a walk's history stops growing. */
    historyMessages?: number
  }
): void {
  const parts = [`prompt ${input.userPrompt.length} chars`]
  if (input.systemPrompt) parts.push(`system ${input.systemPrompt.length} chars`)
  if (input.imagePath) parts.push(`image ${basename(input.imagePath)}`)
  if (input.historyMessages !== undefined) parts.push(`history ${input.historyMessages} msgs`)
  parts.push(`tools [${(input.tools ?? []).join(', ')}]`)
  const head = input.userPrompt.replace(/\s+/g, ' ').slice(0, 160)
  console.log(`[app-flow] agent-in ${label} — ${parts.join(', ')} :: ${head}`)
}

/**
 * The other half: what the call did once it had that input. `turns` and `toolCalls` are the two
 * numbers that explain a call whose cost bears no relation to the prompt it was given — a role
 * granted a file-reading tool can spend an entire budget on turns nobody asked for, and that is
 * invisible in a usage total.
 */
function logAgentOutput(label: string, result: SubAgentResult): void {
  const tools = result.toolCalls.length
    ? result.toolCalls.map((call) => call.name).join(', ')
    : 'none'
  console.log(
    `[app-flow] agent-out ${label} — turns ${result.diagnostics.length}, tool calls ${result.toolCalls.length} (${tools}), ` +
      `text ${result.text.length} chars${result.timedOut ? ', TIMED OUT' : ''}`
  )
}

/**
 * Every model call in a sweep is its own disposable session, so a per-call line is the only place the
 * cost is legible: a running total alone cannot say whether a long sweep was many cheap arrival
 * checks or one exploration that would not stop.
 */
function logAgentTokens(
  label: string,
  used: TokenUsage,
  elapsedMs: number,
  running: TokenUsage,
  /**
   * Recorded here rather than at the four call sites because this is the one function every model
   * call reaches on both the success and the failure path. A timed-out judge is the most expensive
   * call a sweep can make, and tallying only successes would hide exactly that.
   */
  ledger?: PhaseLedger
): void {
  ledger?.record('model', elapsedMs)
  const cache =
    used.cacheRead || used.cacheWrite ? ` cache r${used.cacheRead}/w${used.cacheWrite}` : ''
  const reasoning = used.reasoning ? ` reasoning ${used.reasoning}` : ''
  const cost = used.cost ? ` $${used.cost.toFixed(4)}` : ''
  console.log(
    `[app-flow] tokens ${label} — in ${used.input} out ${used.output}${cache}${reasoning} ` +
      `total ${used.total}${cost} in ${(elapsedMs / 1000).toFixed(1)}s ` +
      `(sweep ${running.total})`
  )
}

/**
 * How long a one-shot judge may go unanswered before a duplicate is raced against it.
 *
 * Sized from two instrumented sweeps rather than picked: the arrival judge's p50 is 2.1s and its
 * p90 is 8.7s, so this sits just above the p90 and leaves the ordinary call untouched. What it
 * catches is the shape that is not deliberation — 16.6s for 165 output tokens, 24.9s for 130, where
 * a p50 call returns ~140 — and in the measured run four such calls cost ~81s, 16% of the sweep.
 *
 * Lowering it would catch more stalls and would also start duplicating the calls that are slow
 * because they are genuinely reasoning: the same sweep has a 7.6s arrival that spent 858 of its 967
 * output tokens on reasoning, and a duplicate of that call has to do the same thinking, so it pays
 * twice for nothing. That is the trade this constant sets, and the next run's p-values are what
 * should move it.
 */
const HEDGE_AFTER_MS = 8_000

/**
 * `HEDGE_AFTER_MS` for a call that is safe to run twice, and `Infinity` — never hedge — for one
 * that is not.
 *
 * Tools are the whole test. A judge with `tools: []` can only read a screenshot and return text, so
 * a second copy of it costs tokens and nothing else; anything holding a tool could run that tool
 * twice, and a duplicated device action is a corrupted sweep rather than a slow one.
 */
function hedgeableAfterMs(agentOptions: SubAgentOptions): number {
  return (agentOptions.tools?.length ?? 0) === 0 ? HEDGE_AFTER_MS : Infinity
}

/** Companion to `logAgentTokenSummary`: the other half of the same bill. */
function logPhaseSummary(ledger: PhaseLedger): void {
  for (const line of formatPhaseSummary(ledger)) console.log(line)
}

function tokenUsageSince(before: TokenUsage, after: TokenUsage): TokenUsage {
  return {
    input: Math.max(0, after.input - before.input),
    output: Math.max(0, after.output - before.output),
    cacheRead: Math.max(0, after.cacheRead - before.cacheRead),
    cacheWrite: Math.max(0, after.cacheWrite - before.cacheWrite),
    reasoning: Math.max(0, after.reasoning - before.reasoning),
    total: Math.max(0, after.total - before.total),
    cost: Math.max(0, after.cost - before.cost)
  }
}

function logAgentFailure(label: string, error: unknown, elapsedMs: number): void {
  console.error(
    `[app-flow] agent-failed ${label} after ${(elapsedMs / 1000).toFixed(1)}s — ${error instanceof Error ? error.message : String(error)}`
  )
}

/** Closing breakdown by role, so a sweep's bill can be read without replaying the log. */
function logAgentTokenSummary(
  tallies: ReadonlyMap<string, AgentTokenTally>,
  total: TokenUsage,
  /**
   * Duplicates issued by `hedge`, reported because they are the one thing that stops the rows
   * below from summing to the total.
   *
   * A hedged call bills two requests and keeps one answer. Both land in `total` through `onUsage`,
   * which is correct — the sweep really did pay for both — but only the winner's usage is knowable
   * at the per-call boundary, so only the winner's reaches a role's row. The gap between the rows
   * and the total is exactly these duplicates, and naming the count here is what makes it legible
   * instead of looking like a tallying bug.
   */
  hedges: number
): void {
  const byCost = [...tallies.entries()].sort((a, b) => b[1].tokens.total - a[1].tokens.total)
  for (const [role, tally] of byCost) {
    const share = total.total ? Math.round((tally.tokens.total / total.total) * 100) : 0
    console.log(
      `[app-flow] tokens by role — ${role}: ${tally.calls} calls, ${tally.tokens.total} tokens (${share}%)` +
        `${tally.tokens.cost ? `, $${tally.tokens.cost.toFixed(4)}` : ''}`
    )
  }
  // `reasoning` is a slice of `output`, not an addition to it, so it is reported rather than summed.
  // It belongs on this line because it is usually the larger half: a sweep that matched every screen
  // on the first try still spent 70% of its output thinking, and that is the knob `thinkingLevel`
  // turns — unreadable from a total that only says how many tokens came back.
  const reasoning = total.reasoning ? ` reasoning ${total.reasoning}` : ''
  if (hedges)
    console.log(
      `[app-flow] tokens — ${hedges} hedged duplicate${hedges === 1 ? '' : 's'} billed to the total but not to any role above`
    )
  console.log(
    `[app-flow] tokens total — in ${total.input} out ${total.output}` +
      `${reasoning} cache r${total.cacheRead}/w${total.cacheWrite} total ${total.total}` +
      `${total.cost ? ` $${total.cost.toFixed(4)}` : ''}`
  )
}

function pickSampleParams(
  node: AppFlowNode,
  edges: AppFlowEdge[],
  store?: ParamStoreLike | null
): Record<string, string> {
  const resolved = resolveNodeParams(node, edges, store).values
  // Display only. The `1` stand-in exists because the descriptive path written into the
  // agent-device manifest reads better than a bare `:id`, and nothing opens that string. Every
  // caller that builds a URL to open resolves its own params and declines when they are unfilled —
  // `buildUrlPath` throws rather than substituting, so a new caller that forgets finds out.
  return Object.fromEntries(node.params.map((key) => [key, resolved[key] ?? '1']))
}

function captureContext(
  projectPath: string,
  projectId: string,
  parsed: {
    scheme: string | null
    appName: string | null
    bundleId: string | null
    slug: string | null
  },
  signal?: AbortSignal,
  timing?: PhaseLedger
): CaptureContext {
  return {
    projectPath,
    projectId,
    scheme: parsed.scheme,
    appName: parsed.appName,
    bundleId: parsed.bundleId,
    slug: parsed.slug,
    platform: 'ios',
    sessionName: projectId,
    signal,
    timing
  }
}

export async function buildAppFlow(
  options: AppFlowBuildOptions
): Promise<AppFlowBuildResult | AppFlowBuildError> {
  const { projectPath, signal } = options
  const mode = options.mode ?? 'structure-only'
  const activeNow = (): number => options.decisionProvider?.activeNow?.() ?? Date.now()
  const projectId = getProjectId(projectPath)
  let activeManifest: AppFlowManifest | null = null
  const startedAt = Date.now()
  /**
   * Where this sweep's wall clock goes. Started on `startedAt` so its total is the same number the
   * manifest records as `durationMs` — a summary whose shares are taken against a different clock
   * than the one the UI reports would be unreconcilable with it.
   */
  const timing = new PhaseLedger(startedAt)

  /**
   * The `cumulativeDurationMs` total every earlier run of *this same* resume chain already spent,
   * in ms. Zero until we know a prior sweep's checkpoint is being reused (see `carriedDurationMs`
   * below, set once the resume's structure fingerprint matches), so a structure-only build and the
   * first sweep of a fresh chain each report only their own clock.
   */
  let carriedDurationMs = 0

  /**
   * Writes the manifest that ends this build, stamping how long it ran — both this run alone
   * (`durationMs`) and the whole resume chain's total (`cumulativeDurationMs`).
   *
   * Only the terminal writes go through here. The manifest is rewritten several times mid-build to
   * move `sweepStatus` between `running` and `awaiting-user`, and stamping those would record the
   * time up to an arbitrary checkpoint — the number would keep changing while a sweep sat waiting
   * on the user, which is the opposite of a duration.
   */
  const finishManifest = async (final: AppFlowManifest): Promise<void> => {
    final.durationMs = timing.wallMs
    final.cumulativeDurationMs = carriedDurationMs + timing.wallMs
    await writeManifest(projectId, final)
  }

  // LLM usage of every sub-agent call in this build. Each emitted event carries a copy, so the
  // renderer can show token usage while the build is still running.
  let tokens: TokenUsage = emptyTokenUsage()
  const onEvent = (event: AppFlowProgressEvent): void =>
    options.onEvent({ ...event, tokens: snapshotUsage(tokens) })

  // Keyed by role — the label's first word — so the closing summary says where a sweep's tokens went.
  const tallies = new Map<string, AgentTokenTally>()
  /** Duplicates `hedge` issued this sweep. See `logAgentTokenSummary`'s `hedges` parameter. */
  let hedges = 0

  const runAgent = async (
    agentOptions: SubAgentOptions,
    label: string
  ): Promise<SubAgentResult> => {
    logAgentInput(label, agentOptions)
    const startedAt = Date.now()
    const tokensBefore = snapshotUsage(tokens)
    const callOnce = (): Promise<SubAgentResult> => {
      if (!options.decisionProvider) throw new Error('A decision provider is required for a screen sweep.')
      return options.decisionProvider.run(agentOptions, label)
    }
    let result: SubAgentResult
    try {
      const outcome = await hedge({
        attempt: callOnce,
        // The guard `hedge` cannot make for itself. A call that can run twice harmlessly is one
        // with no tools to invoke and no session history to append to, which is every judge that
        // arrives here: one system prompt, one screenshot, a JSON verdict. A call carrying tools
        // could act on the device twice, so it waits however long it waits.
        afterMs: options.decisionProvider?.supportsConcurrentRequests === false
          ? Infinity
          : hedgeableAfterMs(agentOptions),
        onHedge: () =>
          console.log(
            `[app-flow] hedge ${label} — no answer in ${(HEDGE_AFTER_MS / 1000).toFixed(1)}s, racing a duplicate`
          )
      })
      result = outcome.result
      hedges += outcome.attempts - 1
      if (outcome.attempts > 1)
        console.log(
          `[app-flow] hedge ${label} — ${outcome.winner === 0 ? 'the original' : 'the duplicate'} answered first after ${((Date.now() - startedAt) / 1000).toFixed(1)}s`
        )
    } catch (error) {
      const used = tokenUsageSince(tokensBefore, tokens)
      const role = label.split(' ')[0]
      const tally = tallies.get(role) ?? { calls: 0, tokens: emptyTokenUsage() }
      tallies.set(role, { calls: tally.calls + 1, tokens: addTokenUsage(tally.tokens, used) })
      logAgentTokens(label, used, Date.now() - startedAt, tokens, timing)
      logAgentFailure(label, error, Date.now() - startedAt)
      throw error
    }
    tokens = addTokenUsage(tokens, result.tokens)
    const role = label.split(' ')[0]
    const tally = tallies.get(role) ?? { calls: 0, tokens: emptyTokenUsage() }
    tallies.set(role, {
      calls: tally.calls + 1,
      tokens: addTokenUsage(tally.tokens, result.tokens)
    })
    logAgentTokens(label, result.tokens, Date.now() - startedAt, tokens, timing)
    logAgentOutput(label, result)
    return result
  }

  // Step 0's fix for exploration's token cost: one sub-agent session per exploration attempt
  // instead of a fresh `runSubAgent` call — and its cold session, resent history, and no
  // prompt-cache reuse — per navigation step. `prompt` mirrors `runAgent`'s tallying (same role
  // bucket, same running total, same log line) so `logAgentTokenSummary` reads identically whether
  // a role's calls came from one-shot `runAgent` roles or a long-lived session.
  const runAgentSession = async (
    sessionOptions: SubAgentSessionOptions
  ): Promise<{
    prompt: (callOptions: SubAgentCallOptions, label: string) => Promise<SubAgentResult>
    dispose: () => void
  }> => {
    if (!options.decisionProvider) throw new Error('A decision provider is required for a screen sweep.')
    const hostSession = await options.decisionProvider.createSession(sessionOptions)
    const historyLength = (): number => hostSession.historyLength()
    return {
      prompt: async (callOptions, label) => {
        logAgentInput(label, {
          ...callOptions,
          systemPrompt: sessionOptions.systemPrompt,
          tools: sessionOptions.tools,
          historyMessages: historyLength()
        })
        const startedAt = Date.now()
        const tokensBefore = snapshotUsage(tokens)
        let result: SubAgentResult
        try {
          result = await hostSession.prompt(callOptions, label)
        } catch (error) {
          const used = tokenUsageSince(tokensBefore, tokens)
          const role = label.split(' ')[0]
          const tally = tallies.get(role) ?? { calls: 0, tokens: emptyTokenUsage() }
          tallies.set(role, { calls: tally.calls + 1, tokens: addTokenUsage(tally.tokens, used) })
          logAgentTokens(label, used, Date.now() - startedAt, tokens, timing)
          logAgentFailure(label, error, Date.now() - startedAt)
          throw error
        }
        tokens = addTokenUsage(tokens, result.tokens)
        const role = label.split(' ')[0]
        const tally = tallies.get(role) ?? { calls: 0, tokens: emptyTokenUsage() }
        tallies.set(role, {
          calls: tally.calls + 1,
          tokens: addTokenUsage(tally.tokens, result.tokens)
        })
        logAgentTokens(label, result.tokens, Date.now() - startedAt, tokens, timing)
        logAgentOutput(label, result)
        return result
      },
      dispose: () => hostSession.dispose()
    }
  }

  try {
    checkSignal(signal)
    emit(projectId, onEvent, { type: 'phase', phase: 'parse', message: 'Parsing routes...' })
    console.log('[app-flow] parse routes')

    const { name } = await registerProject(projectPath)
    console.log(`[app-flow] registered project "${name}" (${projectId}) at ${projectPath}`)
    /**
     * The chain total the *previous* build recorded, read before this build's own manifest
     * overwrites it below. Only folded into `cumulativeDurationMs` when this build turns out to
     * resume that build's checkpoint; see `carriedDurationMs`.
     */
    const previousManifest = await readManifest(projectId)
    const parseStartedAt = Date.now()
    const parsed = await parseProject(projectPath)
    if (!parsed) {
      // Thrown (not returned) so the catch below emits an `error` event — a bare return would
      // leave the renderer stuck on "Parsing routes..." forever.
      throw new Error(
        `No supported Expo Router or React Navigation routes found in ${projectPath}.`
      )
    }
    console.log(
      `[app-flow] parse done in ${Date.now() - parseStartedAt}ms — ${parsed.nodes.length} routes, ` +
        `${parsed.edges.length} edges, mode=${parsed.mode}, appDir=${parsed.appDir}`
    )

    const structureRevision = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`
    const structureKey = computeStructureKey(parsed.nodes, parsed.edges)
    const fastSourceHash = await computeFastSourceHash(projectPath, parsed.nodes)
    const fastFingerprint = createHash('sha256').update(agentSource()).digest('hex').slice(0, 24)
    // Persisted verbatim as `AppFlowResult.navigation` (plan Step 4d) so a reader of `app-flow.json`
    // can say where a journey starts without re-parsing the project. Built once here, alongside
    // `structureKey`, from the exact same parse the sweep runs against.
    const navigation: AppFlowNavigation = {
      layouts: parsed.layouts,
      rootNavigator: parsed.rootNavigator,
      entryLayouts: parsed.entryLayouts,
      entryScreenIds: parsed.entryScreenIds
    }
    const manifest: AppFlowManifest = {
      // Bumped for Step 4's new persisted shape (`node.origin`, `edge.origin`/`evidence`,
      // `runtimeEdges`, `chrome`, `navigation`). Nothing branches on this number today; it exists so
      // a future reader can refuse a document it cannot represent.
      formatVersion: 4,
      generator: 'ai-harness/app-flow',
      generatedAt: new Date().toISOString(),
      project: {
        name,
        path: projectPath,
        scheme: parsed.scheme,
        platform: 'ios',
        mode: parsed.mode
      },
      buildMode: mode,
      structureRevision,
      sweepStatus: mode === 'structure-only' ? 'not-requested' : 'running'
    }
    activeManifest = manifest
    await writeManifest(projectId, manifest)

    const previous = await readAppFlow(projectId)
    const previousById = new Map(previous?.nodes.map((node) => [node.id, node]) ?? [])
    const usedSlugs = new Set<string>()
    const nodesWithSlug = parsed.nodes.map((node) => {
      const baseSlug = generateSlug(node.id)
      const slug = usedSlugs.has(baseSlug)
        ? `${baseSlug}_${createHash('sha256').update(node.id).digest('hex').slice(0, 8)}`
        : baseSlug
      usedSlugs.add(slug)
      return {
        ...node,
        slug,
        capture:
          previousById.get(node.id)?.file === node.file && previousById.get(node.id)?.capture
            ? {
                ...previousById.get(node.id)!.capture!,
                structureRevision: previous?.manifest.structureRevision,
                stale: true
              }
            : null,
        // Carried forward alongside `capture`, but independently validated: a rejection survives a
        // rebuild only when this node's own structure (id/file/urlPath/params) still matches what it
        // was recorded against, not when its capture happens to survive too.
        deepLinkRejection: carryForwardDeepLinkRejection(
          previousById.get(node.id)?.deepLinkRejection,
          node
        )
      }
    })

    // Rehydrated so a value observed in a previous sweep lets a re-run deep-link straight to a
    // parameterised route instead of re-walking to it. `fromJSON` marks every carried record as
    // coming from a prior run, so anything seen live this sweep outranks it — the record it names
    // may have been deleted since, and a stale handle should only ever be the fallback.
    const paramStore = ParamStore.fromJSON(await readParamStore(projectId))

    const partialResult: AppFlowResult = {
      manifest,
      nodes: nodesWithSlug,
      edges: parsed.edges,
      // This is the structure-only write, before the device sweep that discovers any of this even
      // starts — written as empty rather than left absent so a fresh v4 document never looks like a
      // mid-migration v3 one. The sweep below fills these in as it runs (plan Steps 3d/4a).
      runtimeEdges: [],
      chrome: [],
      navigation
    }
    await writeAppFlow(projectId, partialResult)
    const activeNodeIds = new Set(nodesWithSlug.map((node) => node.id))
    const previousScreens = await readAgentDeviceScreens(projectId)
    await writeAgentDeviceScreens(
      projectId,
      Object.fromEntries(
        Object.entries(previousScreens).filter(
          ([, entry]) => entry.screenId && activeNodeIds.has(entry.screenId)
        )
      )
    )
    emit(projectId, onEvent, {
      type: 'structure-ready',
      phase: 'render',
      message: `Structure ready: ${nodesWithSlug.length} screens, ${parsed.edges.length} edges.`
    })

    if (mode === 'structure-only') {
      // A structure rebuild is a new chain only when it lost the previous build's work: the
      // captures it carried forward (rendered as "Previous capture") are what the saved time
      // paid for, so keeping them keeps the chain — and the header's total keeps describing the
      // map the user is looking at rather than this parse's few seconds.
      if (nodesWithSlug.some((node) => node.capture)) {
        carriedDurationMs = carriedSweepDurationMs(previousManifest, true)
      }
      await finishManifest(manifest)
      emit(projectId, onEvent, {
        type: 'complete',
        phase: 'render',
        message: 'Structure complete.'
      })
      return { ok: true, projectId, result: partialResult }
    }
    if (!options.decisionProvider) {
      throw new Error('A decision provider is required for a screen sweep.')
    }

    checkSignal(signal)
    const bootStartedAt = Date.now()
    // Boot is excluded from every time measurement, so its device work is deliberately not
    // recorded in the ledger (the boot context carries no `timing`).
    const bootCtx = captureContext(projectPath, projectId, parsed, signal)
    const reusedDevice = options.launchedDevice
    let device: CaptureDevice
    let fastRuntime: CdpConnection | null = null
    if (reusedDevice) {
      emit(projectId, onEvent, {
        type: 'phase',
        phase: 'boot',
        message: 'Checking the app you launched...'
      })
      device = reusedDevice
    } else {
      emit(projectId, onEvent, {
        type: 'phase',
        phase: 'boot',
        message: 'Booting the simulator, installing the app, and starting Metro...'
      })
      console.log('[app-flow] bootDevice start')
      device = await bootDevice(bootCtx)
      console.log('[app-flow] bootDevice done')
    }

    try {
      const ctx = captureContext(projectPath, projectId, parsed, signal, timing)
      checkSignal(signal)
      if (reusedDevice) {
        // The adopt path's whole purpose is that the app is *already* up: the user pressed Launch,
        // `index.ts` ran `waitForAppReady` to completion, and the app has been sitting on a
        // settled screen ever since. This branch used to throw that away with
        // `relaunchBoundApp(bootCtx, device)` regardless, and on a dev-client build — which has no
        // `launchUrl` — a bare `--relaunch` lands on the Expo launcher. The 2026-10-09 social-app
        // sweep paid the whole bill for it: warm and settled at t=43.9s, relaunched at t=65.1s,
        // and not back on a real screen until t=93.6s. In between it lost the entry-chrome pass
        // outright ("app 'xyz.blueskyweb.app' is not running"), spent two ~3.4s `arrival Lists`
        // model calls judging the Expo launcher, and cached an auth verdict taken off a dead app.
        // Twenty-eight seconds and three wrong answers, to undo the one thing pre-launching is for.
        //
        // So: ask first, act only if the answer is no. The probe is the same floored wait the
        // fresh-boot branch runs below — see item 3's note there — which is what makes "ready"
        // mean a frame that both settled *and* cleared `PROBE_FRAME_ELEMENT_FLOOR`. The floor is
        // load-bearing here and was the second half of the bug: the Expo launcher settles at 3
        // interactive elements, and an unfloored wait called that ready twice in the log above.
        //
        // What this deliberately does not check is *which* screen the app is on. A pre-launched
        // app the user poked at for twenty seconds (43.9s → 64.2s in that run) can be several
        // screens deep, and nothing cheap can tell that from the entry screen. Three reasons that
        // is the right trade: the entry-chrome pass reads *chrome*, which in a tabs or drawer app
        // is present on every screen and is already wrapped in a `try/catch` that treats a miss as
        // "continue without it"; the deep-link probe and every reach strategy open a URL or walk
        // from wherever they are rather than assuming home; and the alternative — re-rooting
        // unconditionally — is precisely the 28s mistake above. A drifted-but-live app costs at
        // worst a slightly poorer chrome inventory. A relaunched one costs the sweep's first
        // half-minute every time.
        const adoptedAppReady = await waitForAppReady(
          bootCtx,
          device,
          signal,
          ADOPTED_APP_READY_BUDGET_MS,
          {
            minInteractiveElements: PROBE_FRAME_ELEMENT_FLOOR,
            minInteractiveElementsGraceMs: SUBSTANTIVE_FRAME_GRACE_MS
          }
        )
        if (adoptedAppReady) {
          console.log(
            '[app-flow] adopted the launched app as-is — it is already settled on a substantive frame, so no relaunch'
          )
        } else {
          // Genuinely not ready: backgrounded, wedged, sitting on the dev-client launcher, or the
          // session died while the user was reading the App Flow screen. Re-root with the *soft*
          // `goHome` rather than `relaunchBoundApp`, so a dev client that is merely on the wrong
          // screen keeps the bundle it has already evaluated; and allow the dev-client fallback,
          // because for a `native-run` build the URL that re-roots is `devClientUrl` and
          // `launchUrl` is null — opening the null one is the no-op `reconnectDevClient`'s comment
          // records sixteen failures of. Safe to ask for it only here, after the wait above has
          // established the app is not loaded.
          console.log(
            '[app-flow] adopted app is not on a substantive frame — soft re-rooting it instead of relaunching'
          )
          await goHome(bootCtx, device, { reconnectDevClientWhenUnloaded: true })
          // `goHome`'s own wait only asks "did something settle", which the 3-element launcher
          // frame answers yes to. Re-assert the floor so the auth gate below is never handed one.
          await waitForAppReady(bootCtx, device, signal, undefined, {
            minInteractiveElements: PROBE_FRAME_ELEMENT_FLOOR,
            minInteractiveElementsGraceMs: SUBSTANTIVE_FRAME_GRACE_MS
          })
        }
      } else {
        emit(projectId, onEvent, {
          type: 'phase',
          phase: 'boot',
          message: 'Waiting for the app to finish loading...'
        })
        console.log('[app-flow] waitForAppReady start')
        // See the history of this floor: the wait the sweep always pays must outlast a dev-client
        // loading frame, or the auth gate re-waits for the same event. Graced rather than held to
        // `timeoutMs` because this wait cannot tell a splash from a login screen.
        await waitForAppReady(bootCtx, device, signal, undefined, {
          minInteractiveElements: PROBE_FRAME_ELEMENT_FLOOR,
          minInteractiveElementsGraceMs: SUBSTANTIVE_FRAME_GRACE_MS
        })
        console.log('[app-flow] waitForAppReady done')
      }
      timing.excludeWall(Date.now() - bootStartedAt)

      await pruneTransientScreens(projectId)
      await prepareScratchDir(projectId)

      // The gate runs only after a launch or relaunch, so a launch that is already past auth is
      // classified once. `stored` keeps the first launch's screenshot; later launches overwrite it
      // only when they turn out to be gated, and the version counter busts the renderer's cache
      // for the single reused URL.
      let authCheckpointStored = false
      let authCheckpointVersion = 0
      /** Consecutive gate checks whose every attempt came back empty — see `runAuthGate`. */
      let consecutiveSilentAuthChecks = 0
      /** Who cleared the gate for this sweep, or null while it still has to be asked — see
       *  `reach/auth-gate-policy.ts` and the `checkAuthGate` wrapper below. */
      let authSettledBy: 'classifier' | 'user' | null = null

      /** One full run of the gate. Reports *how* it concluded, not just what it returned, because
       *  that is what decides whether the sweep may stop asking — see `settlesAuthGateForRun`. */
      const runAuthGate = async (
        remaining: number,
        budget?: ActiveTimeBudget
      ): Promise<AuthGateResolution> => {
        /** Sticky across the loop below: a Continue sends it round again for a fresh screenshot,
         *  and the clear that follows is still the user's doing. */
        let userResolved = false
        for (;;) {
          checkSignal(signal)
          if (budget?.expired)
            return { outcome: 'exhausted', verdict: null, substantiveFrame: false, userResolved }
          // Don't hand the classifier a splash. `waitForAppReady` has already run by now and
          // reports a *stable* frame, which a dev-client loading screen is — see
          // `AUTH_GATE_FRAME_WAIT_MS` for the run where that cost three calls and a user prompt.
          // Bounded, and never a precondition: a real login screen is legitimately sparse, so on
          // expiry the gate classifies whatever is on screen exactly as it always did.
          const launchElements = await capturePressables(ctx, device)
            .then((pressables) => pressables.length)
            .catch(() => null)
          /**
           * Whether the frame about to be classified ever cleared `PROBE_FRAME_ELEMENT_FLOOR`.
           * Carried into the resolution because it, and not the classifier, is what decides
           * whether the answer may be cached for the sweep — see `substantiveFrame` in
           * `reach/auth-gate-policy.ts`.
           */
          let substantiveFrame = isSubstantiveFrame(launchElements)
          if (!substantiveFrame) {
            console.log(
              `[app-flow] auth-gate — app shows ${launchElements ?? 'an unreadable frame'} interactive element(s), below the ${PROBE_FRAME_ELEMENT_FLOOR} a settled screen reads; waiting up to ${AUTH_GATE_FRAME_WAIT_MS / 1000}s before classifying`
            )
            const waitStartedAt = Date.now()
            // One continuous wait rather than a poll loop, and the floor pushed into the wait
            // itself — the lesson `probeDeepLinkRoute` records just below, where asking a settled
            // loading screen thirteen separate times cost 13.7s to learn nothing.
            //
            // The return value is kept, which it was not before. `waitForAppReady` reports false
            // for three very different endings — the window expired, a launcher would not clear,
            // or the device stopped answering three reads in a row — and the last of those is the
            // only one that can end a fifteen-second window in 1.9s, which is exactly what the
            // 2026-10-09 social-app sweep logged before the classifier was handed a screenshot of
            // a dead app and said `clear` about it.
            substantiveFrame = await waitForAppReady(ctx, device, signal, AUTH_GATE_FRAME_WAIT_MS, {
              minInteractiveElements: PROBE_FRAME_ELEMENT_FLOOR
            })
            checkSignal(signal)
            console.log(
              `[app-flow] auth-gate — classifying after ${((Date.now() - waitStartedAt) / 1000).toFixed(1)}s${substantiveFrame ? '' : ' on a frame that never became readable; this verdict will not be cached for the sweep'}`
            )
          }
          const probe = getScratchPath(projectId, 'auth-probe')
          await captureScreenshot(ctx, device, probe)
          let verdict: { verdict: 'auth' | 'clear' | 'uncertain'; reason: string } | null = null
          // Distinguishes "the classifier looked and was unsure" from "the classifier never
          // answered". Both leave `verdict` null, and treating them the same produced an
          // unbreakable loop on device: a provider change made every call return an empty body, the
          // gate read the missing verdict as "cannot rule out a login wall", prompted the user, and
          // then re-ran the identical failing call when they pressed Continue — forever, with a
          // message blaming their launch screen for what was actually a model outage.
          let emptyResponses = 0
          let attempts = 0
          for (
            let attempt = 0;
            attempt < 2 && (!verdict || verdict.verdict === 'uncertain');
            attempt++
          ) {
            attempts++
            const response = await runAgent(
              {
                cwd: projectPath,
                systemPrompt:
                  'Classify the mobile screenshot. Return strict JSON: {"verdict":"auth"|"clear"|"uncertain","reason":"short reason"}. Auth includes login/signup landing screens even with guest access. An incidental sign-in link on a normal content screen is clear. Do not infer credentials or suggest actions.',
                userPrompt: 'Is the current app UI an authentication gate?',
                tools: [],
                // The cheapest question the sweep asks: one screenshot, two outcomes, no context to
                // weigh. It was nonetheless spending 472 output tokens per call, 91% of them
                // reasoning, across 14 calls in one run.
                //
                // `off`, not `minimal`. This is the call that asked for `minimal` — a level this
                // backend answers with `400 Unexpected reasoning effort minimal`, which is what
                // produced the empty auth-gate verdicts blamed on the endpoint in `provider.ts`'s
                // old comment. `off` maps to `reasoning_effort: "none"`, measured at 0 reasoning
                // tokens with the JSON verdict still returned.
                thinkingLevel: 'off',
                imagePath: probe,
                timeoutMs: Math.max(1_000, Math.min(60_000, budget?.remainingMs ?? 60_000))
              },
              'auth-gate'
            )
            if (!response.text.trim()) emptyResponses++
            verdict = parseSubAgentJson(response.text)
          }
          const classifierSilent = attempts > 0 && emptyResponses === attempts
          const stored = getScreenshotPath(projectId, AUTH_CHECKPOINT_SLUG)
          if (!authCheckpointStored || verdict?.verdict !== 'clear') {
            await copyFile(probe, stored)
            authCheckpointStored = true
            authCheckpointVersion += 1
          }
          await unlink(probe).catch(() => undefined)
          if (verdict?.verdict === 'clear')
            return { outcome: 'clear', verdict: 'clear', substantiveFrame, userResolved }
          // Nothing the user can do at the device fixes a classifier that is not responding, and
          // `Continue` only buys another identical failure — so say so plainly and give up rather
          // than prompt. One retry round first, because a single empty response can be a blip.
          if (classifierSilent) {
            consecutiveSilentAuthChecks++
            console.log(
              `[app-flow] auth-gate — classifier returned an empty response ${emptyResponses}/${attempts} times (round ${consecutiveSilentAuthChecks}); this is a model or endpoint failure, not the app's launch screen`
            )
            if (consecutiveSilentAuthChecks >= 2) {
              throw new Error(
                'The screen classifier returned no response. App Flow cannot tell whether the app is showing a login screen, so the build has stopped. This is a model or endpoint problem rather than something to fix in the app.'
              )
            }
          } else {
            consecutiveSilentAuthChecks = 0
          }
          if (!options.requestUserAction)
            return {
              outcome: 'stop',
              verdict: verdict?.verdict ?? null,
              substantiveFrame,
              userResolved
            }
          manifest.sweepStatus = 'awaiting-user'
          await writeManifest(projectId, manifest)
          const prompt: AppFlowPrompt = {
            id: randomUUID(),
            kind: verdict?.verdict === 'auth' ? 'auth' : 'review',
            detail:
              verdict?.verdict === 'auth'
                ? 'Complete auth in the simulator. Once logged in, click Continue.'
                : `Could not confidently classify this launch screen${verdict?.reason ? `: ${verdict.reason}` : '.'}`,
            screenshot: screenshotUrl(
              projectId,
              `screens/${AUTH_CHECKPOINT_SLUG}.png?v=${authCheckpointVersion}`
            ),
            remaining
          }
          emit(projectId, onEvent, {
            type: 'prompt',
            phase: 'capture',
            message:
              verdict?.verdict === 'auth'
                ? 'Authentication required.'
                : 'Launch screen needs review.',
            prompt
          })
          const waitStartedAt = Date.now()
          const resolution = await options.requestUserAction(prompt)
          budget?.exclude(Date.now() - waitStartedAt)
          if (resolution === 'stop')
            return {
              outcome: 'stop',
              verdict: verdict?.verdict ?? null,
              substantiveFrame,
              userResolved
            }
          userResolved = true
          manifest.sweepStatus = 'running'
          await writeManifest(projectId, manifest)
          if (resolution === 'override' && verdict?.verdict !== 'auth')
            return {
              outcome: 'clear',
              verdict: verdict?.verdict ?? null,
              substantiveFrame,
              userResolved
            }
          // Continue intentionally rechecks a fresh screenshot without relaunching.
        }
      }

      /**
       * The gate as the sweep calls it: asked until something decisive comes back, then answered
       * from memory for the rest of the run.
       *
       * The short-circuit is why this wrapper exists rather than the caching living inside
       * `runAuthGate`: every caller — sweep start, `establishBase`, the state-variant replay pass,
       * and the `AuthPort` the reach strategies go through — gets the skip for free, and none of
       * them has to know the rule. A skipped call costs no screenshot and no classifier call, which
       * is the whole saving; `settlesAuthGateForRun` decides what counts as decisive.
       */
      const checkAuthGate = async (
        remaining: number,
        budget?: ActiveTimeBudget
      ): Promise<'clear' | 'stop' | 'exhausted'> => {
        if (authSettledBy) return 'clear'
        const resolution = await runAuthGate(remaining, budget)
        authSettledBy = settlesAuthGateForRun(resolution)
        if (authSettledBy) {
          console.log(
            `[app-flow] auth-gate — cleared by the ${authSettledBy}; settled for this sweep, later launches will not re-check`
          )
        } else if (resolution.outcome === 'clear' && !resolution.substantiveFrame) {
          // Worth a line of its own: the sweep is continuing on a `clear` it is deliberately
          // refusing to remember, and without saying so the next launch's extra gate call looks
          // like the duplicate-call bug this memo was added to fix.
          console.log(
            '[app-flow] auth-gate — cleared, but the classified frame never became readable; not cached, the next launch will ask again'
          )
        }
        return resolution.outcome
      }

      // The seam the reach-attempt closures below call through instead of `capture.ts`/
      // `device.client` directly — see `reach/ports.ts` and `reach/adapters.ts`. Deliberately NOT
      // used by `checkAuthGate` above, `resolveBlocked` below, device boot, or the state-variant
      // pass further down: those own a user prompt, `manifest.sweepStatus`, or are one-shot setup,
      // and the plan keeps them outside this seam permanently rather than routing them through a
      // ladder of reach strategies.
      /**
       * DEEP-LINK ARRIVAL JUDGE — the single place `options.deepLinkJudgeMode` is consumed.
       *
       * Passed straight through to the deep-link rung's `arrivalJudge` and nowhere else: the
       * exploration walk's own arrival checks are deliberately out of this switch's reach (see
       * `DeepLinkJudgeMode`). False means the strategy decides a 404 from the controls on screen
       * instead of a model call — `reach/not-found-signal.ts`.
       *
       * "Off" is narrower than it was, and the log line says so rather than overstating it: the
       * strategy keeps the judge for any route that declares params, because seven of the eight
       * wrong captures in `session_2026-10-13_14-33-40.log` were param routes. The decision lives
       * in `routeDeclaresParams` (`reach/strategies/deep-link.ts`), next to the node whose params
       * it is about, rather than here where only the sweep-wide setting is known.
       */
      const deepLinkArrivalJudge = (options.deepLinkJudgeMode ?? 'on') === 'on'
      console.log(
        `[app-flow] deep-link arrival judge: ${
          deepLinkArrivalJudge
            ? 'on'
            : 'off for routes with no params (not-found detected from the screen); routes with params keep the judge'
        }`
      )

      /** One persistent Metro/CDP runtime for deterministic Fast navigation and readiness. */
      let fastTarget: MetroCdpTarget | null = null
      let fastUnavailable = false
      const runtimeMetric = (
        name: string,
        started: number,
        attributes: Record<string, string> = {}
      ): void => {
        if (process.env.MOBILE_DEV_TELEMETRY === 'off') return
        Sentry.metrics.distribution(name, performance.now() - started, {
          unit: 'millisecond',
          attributes: { surface: 'app-flow', device_platform: 'ios', ...attributes }
        })
      }
      const renderTransport: RenderTransport = {
        async ready(): Promise<boolean> {
          if (fastRuntime?.state === 'ready') return true
          if (fastUnavailable) return false
          const started = performance.now()
          try {
            const targets = await listMetroTargets(device.metroPort, { signal })
            const normalize = (value: string | null | undefined): string =>
              (value ?? '').toLowerCase().replace(/[^a-z\d]/g, '')
            const app = normalize(parsed.appName)
            const candidates = targets.filter((target) => target.supportsMultipleDebuggers)
            const deviceCandidates = candidates.filter(
              (target) =>
                target.deviceId === device.deviceId ||
                (!!target.deviceName && normalize(target.deviceName) === normalize(device.deviceName))
            )
            fastTarget =
              deviceCandidates.find(
                (target) =>
                  (!app || normalize(target.title) === app || normalize(target.appId) === app)
              ) ??
              (deviceCandidates.length === 1 ? deviceCandidates[0]! : null)
            if (!fastTarget) throw new Error('No unambiguous Metro runtime supports Fast capture.')
            fastRuntime = new CdpConnection({
              resolveTarget: createTargetResolver(device.metroPort, fastTarget),
              sessionId: `fast-${projectId}`,
              log: (message) => console.log(`[app-flow] fast runtime — ${message}`),
              onStateChange: (state) => {
                if (process.env.MOBILE_DEV_TELEMETRY !== 'off')
                  Sentry.metrics.count('app_flow.runtime.state', 1, {
                    attributes: { surface: 'app-flow', device_platform: 'ios', state }
                  })
              }
            })
            await fastRuntime.connect()
            paramStore.navState = 'ready'
            return true
          } catch (error) {
            fastUnavailable = true
            paramStore.navState = 'unavailable'
            console.log(
              `[app-flow] fast runtime unavailable — ${error instanceof Error ? error.message : String(error)}`
            )
            return false
          } finally {
            runtimeMetric('app_flow.runtime.connect', started, {
              outcome: fastRuntime?.state === 'ready' ? 'ready' : 'unavailable'
            })
          }
        },
        async navigate(route, params, expoPath): Promise<NavigateReply> {
          const started = performance.now()
          try {
            const result = await fastRuntime!.invoke<NavigateReply>(
              { type: 'navigate', route, params, expoPath },
              5_000
            )
            return result
          } finally {
            runtimeMetric('app_flow.runtime.command', started, { operation: 'navigate' })
          }
        },
        async readiness(route, params): Promise<ReadinessReply> {
          const started = performance.now()
          try {
            return await fastRuntime!.invoke<ReadinessReply>(
              { type: 'readiness', route, expectedParams: params },
              5_000
            )
          } finally {
            runtimeMetric('app_flow.runtime.command', started, { operation: 'readiness' })
          }
        },
        async close(): Promise<void> {
          await fastRuntime?.close()
          fastRuntime = null
        }
      }

      const ports = createReachPorts({
        ctx,
        device,
        projectId,
        projectPath,
        runAgent,
        checkAuthGate,
        signal,
        renderTransport,
        expoRouter: parsed.mode === 'expo-router'
      })

      if ((await checkAuthGate(nodesWithSlug.length)) === 'stop') {
        const paused = options.pauseRequested?.() ?? false
        manifest.sweepStatus = paused ? 'paused' : 'stopped'
        await finishManifest(manifest)
        await writeAppFlow(projectId, { ...partialResult, manifest })
        emit(projectId, onEvent, {
          type: 'complete',
          phase: 'render',
          message: paused ? 'Screen sweep paused.' : 'Screen sweep stopped.'
        })
        return { ok: true, projectId, result: partialResult }
      }

      checkSignal(signal)
      emit(projectId, onEvent, {
        type: 'phase',
        phase: 'capture',
        message: 'Capturing screenshots...'
      })

      // A sweep that was stopped, cancelled or crashed leaves a per-screen checkpoint behind. It
      // is only reused when the parsed structure still fingerprints the same, so routes that moved
      // force a full sweep rather than resuming onto screens that no longer exist.
      const resumed = await readSweepProgress(projectId)
      const explorationMode = options.explorationMode ?? 'auto'
      const reconciled = reconcileSweepProgress(resumed, {
        structureKey,
        explorationMode,
        sourceHash: fastSourceHash,
        fastFingerprint
      })
      const { resuming, checkpoint } = reconciled
      if (resumed?.structureKey === structureKey && !resuming) {
        console.log(
          `[app-flow] checkpoint pipeline changed — kept ${reconciled.retained} successful capture(s), re-queued unfinished screens`
        )
      }
      // The one condition under which this build inherits the previous one's elapsed time: it is
      // continuing the same sweep the checkpoint describes — the same test, in the same place, the
      // captures themselves are reused under. A completed sweep deletes that checkpoint, so the
      // next build is a fresh chain no matter what the manifest still shows; a re-parse of a moved
      // structure fails this test for the same reason. Both should (and now do) reset the total.
      if (resuming) {
        carriedDurationMs = carriedSweepDurationMs(previousManifest, true)
      }

      const captureMap: Record<string, AppFlowCapture> = { ...checkpoint.captures }
      const openedByNode: Record<string, { app: string; url: string }> = { ...checkpoint.opened }
      const inferredScreens: Record<string, { key?: string; info?: string | null }> = {
        ...checkpoint.inferred
      }
      const statesDone = new Set(checkpoint.statesDone)

      // Runtime state accumulated across the WHOLE sweep (plan Steps 3d, 4a) — never per-node, since
      // a chrome or a runtime screen discovered while exploring toward one node is exactly as
      // reusable for every other node behind it. Seeded from the checkpoint so a resumed sweep
      // reuses the same ids/edges rather than re-minting/re-detecting them under new ones — see
      // `AppFlowSweepProgress.runtimeNodes`'s doc comment in `storage.ts`.
      const runtimeNodes: AppFlowNode[] = [...(checkpoint.runtimeNodes ?? [])]
      const runtimeEdgesList: AppFlowEdge[] = [...(checkpoint.runtimeEdges ?? [])]
      const chromeInventory: AppFlowChrome[] = [...(checkpoint.chrome ?? [])]
      /**
       * Where the walk currently in progress is standing, and what it has tapped since — the state
       * `noteWalkArrival` (`reach/walk-edges.ts`) turns into `origin: 'runtime-walk'` edges. Held at
       * sweep scope rather than inside `exploreFrom` because the confirmations that feed it arrive
       * through `applyDiscoveredFact` below, which is deliberately ignorant of any one walk; null
       * whenever no exploration is in flight, so a confirmation that reaches it from anywhere else
       * (a deep-link arrival, an opportunistic sighting during delivery) records nothing rather than
       * inventing a hop out of whichever screen a previous walk happened to end on.
       *
       * Not checkpointed: a resumed sweep relaunches the app, so the position a cursor held before
       * the interruption says nothing about where the next walk starts.
       */
      let walkCursor: WalkCursor | null = null
      /** Folds a confirmed arrival into `runtimeEdgesList` when the hop that produced it was a
       *  single tap from a screen this sweep had already confirmed — see `noteWalkArrival`. */
      const noteArrival = (nodeId: string): void => {
        if (!walkCursor) return
        const edge = noteWalkArrival(walkCursor, nodeId, {
          structureRevision,
          observedAt: new Date().toISOString()
        })
        if (!edge) return
        mergeWalkEdge(runtimeEdgesList, edge)
        console.log(`[app-flow] walked edge — ${edge.from} -> ${edge.to} (${edge.raw})`)
      }

      // Deliberately seeded from `nodesWithSlug` (the carry-forward already validated against each
      // node's current structure signature), never from `checkpoint` — `sweep-progress.json` is
      // wiped by `clearSweepProgress` on every completed sweep, exactly when this suppression most
      // needs to outlive it. Updated in place as the sweep runs and flushed to `app-flow.json`
      // through `persistCaptureUpdate`, the same durable path `capture` already rides.
      const deepLinkRejections: Record<string, AppFlowDeepLinkRejection | null> = {}
      for (const node of nodesWithSlug) {
        if (node.deepLinkRejection) deepLinkRejections[node.id] = node.deepLinkRejection
      }

      // What the app opens on DIRECTLY — each entry layout's own `initialRouteName` (see
      // `entryScreenIds` on `ParsedAppGraph`). This intentionally does NOT filter by `group`
      // membership: `group` is attribution (which navigator registers a screen — a screen behind a
      // shared helper called from five tabs belongs to all five of them), not reachability. Filtering
      // by group previously put 78 of social-app's 83 screens "one tap from launch" — most of them
      // behind that shared helper — which both fabricated a one-hop journey for screens actually many
      // pushes deep and suppressed the "explore from the entry chrome" instruction for genuine
      // orphans. `entryScreenIds` is already resolved to real node ids, so it is used as-is.
      const entryNodeIds = parsed.entryScreenIds
      const appEntryBrief = parsed.rootNavigator
        ? `App entry: a ${parsed.rootNavigator} navigator. Its entries are ${parsed.entryLayouts.join(', ')}. Every journey starts there, so when you have no better lead, go back to that chrome and open the entry the target belongs to.`
        : 'App entry: unknown; treat the launch screen as the start of every journey.'
      const orphans = nodesWithSlug.filter(
        (candidate) => !findNavigationPath(parsed.edges, candidate.id, entryNodeIds)
      ).length
      // How each screen can be reached by URL is the number that predicts what a sweep costs: the
      // reach ladder tries the deep-link rung on every node regardless, so a screen with a plain
      // path is one cheap `openUrl`, while one whose path has a `[param]` segment cannot be opened
      // until something supplies a value, and one with no path (or only the root `/`, which every
      // launch already lands on and so proves nothing) has no deep link to try at all. The orphan
      // count is a different animal: it is a BFS over the *parsed* edge graph, which only sees
      // `router.push` call sites the static parser could resolve, so it counts screens the parser
      // failed to connect and says nothing about whether they are reachable. It gates nothing and
      // was once reported as "need live exploration" while all 76 of Bluesky's real screens were in
      // the linking config; it is kept only as a statistic about the parsed graph.
      const hasUrlPath = (node: (typeof nodesWithSlug)[number]): boolean =>
        Boolean(node.urlPath) && node.urlPath !== '/'
      const deepLinkable = nodesWithSlug.filter(
        (node) => hasUrlPath(node) && node.params.length === 0
      ).length
      const paramBlocked = nodesWithSlug.filter(
        (node) => hasUrlPath(node) && node.params.length > 0
      ).length
      const noUrl = nodesWithSlug.length - deepLinkable - paramBlocked
      console.log(
        `[app-flow] entry — root=${parsed.rootNavigator ?? 'unknown'} layouts=[${parsed.entryLayouts.join(', ')}] ` +
          `entryScreens=${entryNodeIds.length} — ${deepLinkable}/${nodesWithSlug.length} reachable by deep link, ` +
          `${paramBlocked} param-blocked until a value is observed, ${noUrl} with no URL; ` +
          `${orphans} have no static path from an entry in the parsed edge graph`
      )
      const total = nodesWithSlug.length
      const alreadyCaptured = nodesWithSlug.filter((node) => captureMap[node.id]).length
      if (alreadyCaptured > 0) {
        console.log(
          `[app-flow] resuming sweep — ${alreadyCaptured}/${total} screens already checkpointed`
        )
        emit(projectId, onEvent, {
          type: 'phase',
          phase: 'capture',
          message: `Resuming: ${alreadyCaptured} of ${total} screens already captured.`
        })
      }

      const navStateDeps: NavStateDeps = {
        run: (command, timeoutMs) => runShellCommand(command, projectPath, timeoutMs, signal),
        cdpCommand: (args) => agentDeviceCdp(ctx.sessionName, args),
        quote: shellQuote,
        log: (message) => console.log(`[app-flow] nav-state — ${message}`)
      }

      /**
       * Ask the running app's navigator for the param values nothing else can see — but only when
       * this screen is plausibly the one holding them.
       *
       * The read sees the *mounted* navigator state and its stack history, not the app's whole
       * database, so it is worth making right after capturing a screen that is an ancestor of some
       * route still blocked on a param, and worth nothing at all otherwise. That matters because
       * it is a CLI round trip: run eagerly it would be a tax on all 76 screens for values that
       * are not there; run on this schedule it is a handful of calls a sweep. Ten of Bluesky's
       * routes carry an `:rkey` that appears in no testID anywhere in the app, so this is the only
       * thing that reaches them by URL at all.
       *
       * "Sits above" is judged by `selectNavStateWaiters`: urlPath ancestry, plus a small fixed
       * budget of speculative reads for screens ancestry cannot speak for.
       *
       * Strictly additive and strictly read-only: every failure path ends in `unavailable`,
       * latched for the rest of the sweep, and the sweep carries on exploring exactly as it does
       * today. A thrown error here must never cost a capture, hence the outer catch.
       */
      let speculativeNavReads = 0
      const harvestNavState = async (from: AppFlowNode): Promise<void> => {
        if (paramStore.navState === 'unavailable') return
        try {
          const blocked = nodesWithSlug.filter(
            (other) =>
              other.id !== from.id &&
              !captureMap[other.id] &&
              other.params.length > 0 &&
              other.urlPath &&
              resolveNodeParams(other, parsed.edges, paramStore).unresolved.length > 0
          )
          const { waiting, speculative } = selectNavStateWaiters(
            from,
            blocked,
            nodesWithSlug,
            NAV_STATE_SPECULATIVE_READS - speculativeNavReads
          )
          if (!waiting.length) return
          if (speculative) speculativeNavReads += 1

          if (paramStore.navState === 'unknown') {
            const ready = await selectNavStateTarget(
              device.metroPort,
              parsed.appName,
              navStateDeps,
              (output, preferred) =>
                pickMetroCdpTarget(parseCdpTargetList(output), preferred)?.id ?? null
            )
            paramStore.navState = ready ? 'ready' : 'unavailable'
            if (!ready) return
          }

          const routes = await readNavState(navStateDeps)
          if (!routes) {
            paramStore.navState = 'unavailable'
            return
          }
          let usable = 0
          for (const route of routes) {
            if (route.path && paramStore.ingestUrl(route.path, from.id, nodesWithSlug)) usable += 1
            if (!route.params) continue
            // A navigator names a screen the way the navigator registered it, which may be the
            // tail of a route id the parser spells out in full (`Profile` vs `HomeTab/Profile`),
            // or a sibling node backed by the same component file. Only an unambiguous match is
            // used: two routes answering to one name says nothing about which record these
            // params belong to.
            const target = resolveNavRouteTarget(nodesWithSlug, route.name)
            if (!target) continue
            if (paramStore.ingestNavRoute(target, route.params, from.id)) usable += 1
          }
          if (usable) {
            console.log(
              `[app-flow] nav-state — ${routes.length} route(s) read on ${from.urlPath ?? from.id}, ${usable} usable`
            )
          } else {
            // A read that returns routes and yields nothing is the silent failure that made a
            // whole sweep unexplainable: the values were on screen, the store stayed empty, and
            // the log said nothing at all. The route names are what discriminates the cause — a
            // navigator that registered a screen under a name no node answers to is, in the
            // store, indistinguishable from one that exposed no params in the first place. The
            // first dozen names are enough to recognise a stack without flooding the log.
            const seen = routes
              .slice(0, 12)
              .map(
                (route) =>
                  `${route.name}${route.path ? ' +path' : ''}${route.params ? ' +params' : ''}`
              )
              .join(', ')
            console.log(
              `[app-flow] nav-state — ${routes.length} route(s) read on ${from.urlPath ?? from.id}, none usable, ${waiting.length} node(s) still blocked — saw: ${seen}${routes.length > 12 ? ', …' : ''}`
            )
          }
        } catch (error) {
          paramStore.navState = 'unavailable'
          console.log(
            `[app-flow] nav-state — read failed, not retrying — ${error instanceof Error ? error.message : String(error)}`
          )
        }
      }

      const persistCheckpoint = async (): Promise<void> => {
        await writeSweepProgress(projectId, {
          structureKey,
          explorationMode,
          sourceHash: fastSourceHash,
          fastFingerprint,
          updatedAt: new Date().toISOString(),
          captures: captureMap,
          opened: openedByNode,
          inferred: inferredScreens,
          statesDone: [...statesDone],
          runtimeNodes,
          runtimeEdges: runtimeEdgesList,
          chrome: chromeInventory
        })
      }

      /**
       * The screens manifest as it stands right now — pure, so every writer may call it.
       *
       * One definition rather than the three identical nine-argument calls this file had, because
       * the document's nodes are stamped from this map (`withReplayableCaptures`) and a writer
       * working from a differently-built map would write a different answer.
       */
      const currentAgentDeviceScreens = (): AgentDeviceScreensMap =>
        buildAgentDeviceScreens(
          [...nodesWithSlug, ...runtimeNodes],
          parsed.edges,
          runtimeEdgesList,
          chromeInventory,
          ctx,
          device,
          openedByNode,
          inferredScreens,
          captureMap
        )

      /**
       * The `app-flow.json` as it stands right now, assembled from the same live maps the finish
       * and stopped paths use.
       *
       * One definition for all three writers because the renderer cannot tell which of them
       * produced the document it just read, and a mid-sweep document that disagreed with the final
       * one on anything beyond freshness (node set, replayable stamps, chrome filtering) would make
       * the graph flicker on completion. `screens` is a parameter rather than a call to
       * `currentAgentDeviceScreens` so the finish paths can hand in the same map they persist —
       * `withReplayableCaptures` reads `pathVerified` off that map, and a separately-built copy
       * could only ever re-derive it.
       */
      const currentFlowDocument = (screens: AgentDeviceScreensMap): AppFlowResult => {
        // Provisional timing so the header's clock keeps ticking while the sweep runs: the terminal
        // writes stamp both fields again with their final values, and a reader that has to tell the
        // two apart has `sweepStatus: 'running'` on exactly these documents.
        manifest.durationMs = timing.wallMs
        manifest.cumulativeDurationMs = carriedDurationMs + timing.wallMs
        const screenNodes = withReplayableCaptures(
          [
            ...nodesWithSlug.map((node) => ({
              ...node,
              capture: captureMap[node.id] ?? node.capture,
              deepLinkRejection: deepLinkRejections[node.id] ?? null
            })),
            ...runtimeNodes
          ],
          screens
        )
        const navigators = navigatorChrome(chromeInventory, screenNodes)
        const nodes = [...screenNodes, ...chromeVirtualNodes(navigators)]
        return {
          manifest,
          nodes,
          edges: parsed.edges,
          runtimeEdges: rebuildChromeEdges(runtimeEdgesList, navigators, nodes),
          chrome: chromeInventory,
          navigation
        }
      }

      /**
       * Publishes the graph document mid-sweep so the panel can draw screens as they finish.
       *
       * Throttled, deliberately, rather than one write per screen. The old per-screen document
       * write was removed for being O(n²) bytes on the critical path between screens, and that
       * reasoning still holds for a 200-screen app; what it missed is that a *bounded* write —
       * at most one per interval, whatever the screen rate — gives the user a live graph at a cost
       * that stops scaling with n. The per-screen checkpoint remains the only thing a resumed
       * sweep reads; this document is a read model, its staleness window is one interval, and the
       * terminal writes remain authoritative.
       *
       * Failures are swallowed with a log: a read model that could not be refreshed must never
       * fail the sweep that was writing it.
       */
      const LIVE_PUBLISH_INTERVAL_MS = 4_000
      let lastLivePublishAt = 0
      let livePublishInFlight: Promise<void> = Promise.resolve()
      const publishLiveDocument = (): Promise<void> => {
        const now = activeNow()
        if (now - lastLivePublishAt < LIVE_PUBLISH_INTERVAL_MS) return livePublishInFlight
        lastLivePublishAt = now
        const began = now
        livePublishInFlight = (async () => {
          try {
            await writeAppFlow(projectId, currentFlowDocument(currentAgentDeviceScreens()))
            console.log(`[app-flow] live graph published in ${activeNow() - began}ms`)
          } catch (error) {
            console.warn(
              `[app-flow] live graph publish failed — ${error instanceof Error ? error.message : String(error)}`
            )
          }
        })()
        return livePublishInFlight
      }

      /**
       * The crash-resume checkpoint a captured (or settled-as-unreached) node leaves behind, plus
       * the throttled live publication of the graph document.
       *
       * A checkpoint, not a publication: `persistCheckpoint` is what makes a crashed or stopped
       * sweep resume at the right screen, and it is the only thing a resumed sweep reads. The
       * flat capture-status map and the screens manifest are still rebuilt wholesale at finish
       * and on the stopped path — rewriting those after every screen was O(n²) bytes for an
       * intermediate nobody reads. The app-flow document is the one intermediate the renderer
       * does read, so it now rides this call through `publishLiveDocument`, interval-bounded
       * rather than per-screen.
       *
       * `deepLinkRejections` is the reason the finish and stopped node builds stamp
       * `deepLinkRejection` themselves: the document write used to be its only durable path, and
       * without that move every rejection learned this sweep would be lost and the next sweep
       * would pay again for deep links already proven to 404.
       */
      const persistCaptureUpdate = async (): Promise<void> => {
        await persistCheckpoint()
        await publishLiveDocument()
      }

      const recordUnreached = async (
        node: AppFlowNode,
        status: AppFlowCaptureStatus,
        note: string | null
      ): Promise<void> => {
        console.log(`[app-flow] ${node.id} recorded ${status} — ${note ?? 'no reason given'}`)
        captureMap[node.id] = {
          status,
          // `unavailable` is a settled answer about this build, not a screen still to be reached,
          // so it must not come back as outstanding navigation work on the next run.
          needsNavigation: status !== 'unavailable',
          note,
          screenshot: null,
          pressables: [],
          states: [],
          captureMethod: 'unreached',
          replayScript: null,
          replayVerified: false
        }
        await persistCaptureUpdate()
      }

      // The static vocabulary a chrome item's pressable text is matched against — every still-known
      // node's own title/id/url tokens (`expectedNodeTokens`, `exploration.ts`), plus each entry
      // layout's own name for the case where no single node stands for the whole layout. Rebuilt on
      // demand rather than cached once: it is cheap pure token math, and it must reflect nodes
      // learned about since the sweep started — a runtime node minted earlier this same sweep is
      // itself a legitimate destination for a later chrome item.
      const chromeCandidates = (): ChromeCandidate[] => [
        ...nodesWithSlug.map((candidate) => ({
          label: candidate.id,
          toNodeId: candidate.id,
          tokens: expectedNodeTokens(candidate)
        })),
        ...runtimeNodes.map((candidate) => ({
          label: candidate.id,
          toNodeId: candidate.id,
          tokens: new Set(candidate.runtimeSignature ?? [])
        })),
        ...parsed.entryLayouts.map((name) => ({
          label: `layout:${name}`,
          toNodeId: null,
          tokens: new Set(tokenize(name.replace(/([a-z0-9])([A-Z])/g, '$1 $2')))
        }))
      ]

      // Landing-order item 5's real payoff without item 5 itself (`exploreFrom` stays inline this
      // round — see the CHECKPOINT): `observed` reports what it noticed as a `DiscoveredFact`
      // (`reach/types.ts`) instead of writing `captureMap`/`runtimeNodes`/`chromeInventory` directly,
      // and this is the one place, right next to the state it owns, that folds a fact into the
      // sweep. Three call sites feed it — the known-node opportunistic capture that used to write
      // `captureMap` inline, the chrome detector, and the runtime-node matcher/minter — kept in one
      // place so all three write through the same `persistCaptureUpdate` checkpoint.
      const applyDiscoveredFact = async (fact: DiscoveredFact): Promise<void> => {
        switch (fact.kind) {
          case 'opportunistic-capture': {
            const match = nodesWithSlug.find((candidate) => candidate.id === fact.nodeId)
            if (!match) return
            await copyFile(fact.screenshotPath, getScreenshotPath(projectId, match.slug))
            captureMap[match.id] = {
              status: fact.arrival.status ?? 'ok',
              // There is no saved journey here, only an accidental sighting — a resumed sweep
              // still needs to actually navigate to this screen to redo anything with it.
              needsNavigation: true,
              note: fact.arrival.reason,
              screenshot: `screens/${match.slug}.png`,
              pressables: [...fact.pressables],
              states: [],
              captureMethod: 'opportunistic',
              replayScript: null,
              replayVerified: false,
              structureRevision,
              stale: false
            }
            inferredScreens[match.id] = { key: fact.arrival.key, info: fact.arrival.info }
            // The judge just confirmed which screen the walk is standing on, which is exactly the
            // fact a walked edge needs — and the only reason this sighting is worth more than the
            // capture it already wrote. Recorded before the persist below so the edge rides the same
            // checkpoint write as the capture that proved it.
            noteArrival(match.id)
            await persistCaptureUpdate()
            console.log(
              `[app-flow] opportunistic capture — reached ${match.id} while exploring toward another screen`
            )
            emit(projectId, onEvent, {
              type: 'step',
              phase: 'capture',
              message: `Captured ${match.urlPath ?? match.title} opportunistically`,
              completed: nodesWithSlug.filter((candidate) => captureMap[candidate.id]).length,
              total
            })
            return
          }
          case 'chrome-observed': {
            const kind = inferChromeKind(fact.reveal)
            const detected: AppFlowChrome = {
              id: `chrome:${kind}:${fact.entryNodeId}`,
              kind,
              entryNodeId: fact.entryNodeId,
              reveal: fact.reveal,
              items: fact.items,
              observedAt: new Date().toISOString(),
              structureRevision
            }
            // `findMatchingChrome` runs the same kind-plus-item-overlap identity
            // `mergeChromeInventory` uses internally, called separately here only so the edges below
            // can be built from the record this sighting actually landed on — the chrome's one
            // canonical `id`/`entryNodeId`, carried forward from whichever sighting was folded in
            // first, not this sighting's own (possibly different) entry screen. Without this, a
            // repeat sighting from a new screen would still mint its own parallel `entry -> item`
            // edges instead of reinforcing the one edge set the canonical entry already has.
            const canonical = findMatchingChrome(chromeInventory, detected) ?? detected
            const merged = mergeChromeInventory(chromeInventory, detected)
            chromeInventory.splice(0, chromeInventory.length, ...merged)
            for (const edge of chromeEdges({
              ...detected,
              id: canonical.id,
              entryNodeId: canonical.entryNodeId
            })) {
              const at = runtimeEdgesList.findIndex(
                (existing) => existing.from === edge.from && existing.to === edge.to
              )
              if (at === -1) runtimeEdgesList.push(edge)
              else runtimeEdgesList[at] = edge
            }
            await persistCaptureUpdate()
            console.log(
              `[app-flow] chrome inventory recorded from ${fact.entryNodeId} — ${fact.items.length} items (${kind})`
            )
            return
          }
          case 'runtime-screen-sighted': {
            if (fact.match) {
              const at = runtimeNodes.findIndex((candidate) => candidate.id === fact.match!.id)
              if (at !== -1) {
                runtimeNodes[at] = recordRuntimeSighting(
                  runtimeNodes[at],
                  new Set(fact.observedTokens)
                )
                noteArrival(runtimeNodes[at].id)
                await persistCaptureUpdate()
                console.log(`[app-flow] runtime screen re-sighted — ${fact.match.id}`)
              }
              return
            }
            if (runtimeNodes.length >= RUNTIME_NODE_SWEEP_CAP) {
              console.log(
                `[app-flow] runtime screen discovery capped at ${RUNTIME_NODE_SWEEP_CAP} for this sweep — not minting "${fact.key}"`
              )
              return
            }
            const minted = mintRuntimeNode({
              key: fact.key,
              title: fact.info || fact.key,
              observedTokens: new Set(fact.observedTokens),
              existingIds: new Set([
                ...nodesWithSlug.map((candidate) => candidate.id),
                ...runtimeNodes.map((candidate) => candidate.id)
              ]),
              usedSlugs
            })
            await copyFile(fact.screenshotPath, getScreenshotPath(projectId, minted.slug))
            runtimeNodes.push({
              ...minted,
              capture: {
                status: 'ok',
                needsNavigation: true,
                note: fact.info,
                screenshot: `screens/${minted.slug}.png`,
                pressables: [...fact.pressables],
                states: [],
                captureMethod: 'opportunistic',
                replayScript: null,
                replayVerified: false,
                structureRevision,
                stale: false
              }
            })
            // A screen the parser never knew about is the case a walked edge matters most for: it
            // has no static edges at all, so without this the only thing the graph would ever say
            // about it is that it exists.
            noteArrival(minted.id)
            await persistCaptureUpdate()
            console.log(`[app-flow] runtime screen discovered — ${minted.id} ("${fact.key}")`)
            return
          }
        }
      }

      // Failed destinations still participate in no-progress detection, including empty plans.
      // This compares observed UI directly and never launches a made-up unmatched URL.
      let failedReference: Set<string> | null = null
      let blockedRun = 0
      let sweepStopped = false

      /**
       * The escalate-to-the-user half of getting the app unblocked: take a `BLOCKED_SLUG`
       * screenshot, emit an `AppFlowPrompt` with `kind: 'blocked'`, and await
       * `options.requestUserAction`. Pulled out of `resolveBlocked` below so the states loop's
       * stuck-launcher case (see the hinted-nodes loop further down) can reach the same prompt
       * without also carrying `resolveBlocked`'s other half — the `failedReference` fingerprint
       * comparison and the silent one-shot relaunch retry are specific to the capture loop's
       * no-progress detection, and the states loop has neither a `failedReference` nor a reason to
       * relaunch before asking, since a launcher is a launcher on first sight.
       *
       * `detail` is the only thing that varies between callers — each describes what it actually
       * saw — everything else (the screenshot, the manifest `sweepStatus` flips, the emit, the
       * resume wait) is exactly what `resolveBlocked` always did, unchanged.
       *
       * `kind: 'blocked'`'s doc comment in shared/app-flow.ts notes it is "named for what was
       * observed, not for what the screen is", which is why a stuck dev-client launcher reuses it
       * rather than needing a prompt kind of its own.
       */
      const promptToUnblock = async (
        detail: string,
        remaining: number
      ): Promise<AppFlowPromptResolution> => {
        const stop = (): 'stop' => 'stop'
        if (!options.requestUserAction) return stop()

        const shot = getScreenshotPath(projectId, BLOCKED_SLUG)
        await captureScreenshot(ctx, device, shot).catch(() => undefined)
        const prompt: AppFlowPrompt = {
          id: randomUUID(),
          kind: 'blocked',
          detail,
          screenshot: screenshotUrl(projectId, `screens/${BLOCKED_SLUG}.png`),
          remaining
        }
        manifest.sweepStatus = 'awaiting-user'
        await writeManifest(projectId, manifest)
        emit(projectId, onEvent, {
          type: 'prompt',
          phase: 'capture',
          message: 'Waiting for you to get the app past this screen...',
          prompt
        })
        console.log(`[app-flow] blocked — waiting for the user (${remaining} screens left)`)
        const resolution = await options.requestUserAction(prompt)
        console.log(`[app-flow] blocked — user chose "${resolution}"`)
        if (resolution === 'stop') return stop()

        manifest.sweepStatus = 'running'
        await writeManifest(projectId, manifest)

        emit(projectId, onEvent, {
          type: 'phase',
          phase: 'capture',
          message: 'Checking the app again...'
        })
        await waitForAppReady(ctx, device, signal)
        return 'continue'
      }

      const resolveBlocked = async (remaining: number): Promise<AppFlowPromptResolution> => {
        // A React Native error boundary, once tripped, keeps rendering its fallback across every
        // navigation after it — the app looks permanently blocked even though nothing but its JS
        // state is actually broken. A relaunch clears that in-memory state for free and often
        // resolves the block without ever bothering the user, so it is worth trying exactly once
        // before escalating. `blockedRun` is deliberately NOT reset here: if the relaunch does not
        // clear the block, the next iteration should escalate rather than loop back through another
        // three failures before trying to relaunch again.
        console.log(
          `[app-flow] blocked — relaunching the app before asking the user (${remaining} screens left)`
        )
        try {
          // `reopenBoundApp` now waits for the relaunched app to settle itself, so the separate
          // wait this call site used to need is part of it.
          await reopenBoundApp(ctx, device)
          const recovered = fingerprint(await capturePressables(ctx, device).catch(() => []))
          const stillBlocked =
            failedReference !== null && similarity(recovered, failedReference) >= ARRIVAL_SIMILARITY
          if (!stillBlocked) {
            console.log(
              '[app-flow] blocked — relaunch cleared it, resuming without asking the user'
            )
            failedReference = null
            blockedRun = 0
            return 'continue'
          }
          console.log('[app-flow] blocked — relaunch did not clear it, escalating to the user')
        } catch (error) {
          console.log(
            `[app-flow] blocked — relaunch attempt failed, escalating to the user — ${error instanceof Error ? error.message : String(error)}`
          )
        }

        const resolution = await promptToUnblock(
          'The app keeps rendering this one screen whatever route is opened, so nothing behind ' +
            'it can be captured. Resolve the visible blocker in the simulator; it stays running, ' +
            'then continue.',
          remaining
        )
        if (resolution === 'continue') {
          failedReference = null
          blockedRun = 0
        }
        return resolution
      }

      // `ArrivalResult` used to be declared inline here; it is now `reach/types.ts`'s
      // `ArrivalVerdict`, aliased so every existing use site in this function keeps compiling
      // unchanged.
      type ArrivalResult = ArrivalVerdict

      // The two-attempt retry loop this used to run inline now lives in `JudgePort.verifyArrival`
      // (`reach/adapters.ts`), moved verbatim — this is a pass-through so every call site below
      // keeps its existing name and shape.
      const verifyCurrentTarget = (
        node: AppFlowNode,
        screenshotPath: string,
        budget: ActiveTimeBudget
      ): Promise<ArrivalResult> => ports.judge.verifyArrival(node, screenshotPath, budget)

      // Whether `tryDeepLink` is allowed to touch the device at all this sweep. Per-node deep-link
      // overhead is a URL open, a `waitForRoute`, a screenshot and a vision call — for a build whose
      // scheme does not route at all, paying that on every one of up to 81 routes only to fall
      // through to `explore()` anyway (with its own fresh five-minute budget) is the single most
      // wasteful thing the sweep can do. A one-time probe up front, plus a running breaker below,
      // catch that early instead of rediscovering it node by node.
      // The breaker's decisions (`registerDeepLinkFailure`/`applyDeepLinkReprobeResult`/
      // `registerDeepLinkSuccess`) are pure, moved to `reach/deep-link-policy.ts` in landing-order
      // item 4; this is only the running state they fold into, replacing the old `deepLinkEnabled`/
      // `consecutiveDeepLinkFailures` locals.
      // Deliberate entry-chrome inventory pass, run once before the per-node sweep below. Every
      // other chrome detection in this file is opportunistic — `observed`'s chrome-observed case
      // (further down) only fires when a walk toward some *other* target happens to wander through
      // the chrome, so a real app's drawer can go completely unrecorded for an entire sweep if no
      // walk ever happens to open it. Bluesky is exactly that case: it has a working drawer (the
      // model tapped `label="Open drawer menu"` and then a named item while reaching a screen behind
      // it, mid-sweep, proving the control exists and works) but no sweep ever recorded it, because
      // recording only ever rode on some unrelated walk's own steps. Reading the tab bar and opening
      // the drawer once here means `findNavigationPath` has a locator-bearing hop to every screen
      // behind either chrome from the very first node the sweep visits, rather than only from
      // whichever node's walk happened to stumble onto it — which is the whole point: a deep link
      // that fails now has a recorded, tappable alternative to fall back to immediately, not a maybe.
      //
      // Placement is load-bearing: this runs *before* the deep-link probe below, not after. The
      // probe opens a URL and leaves the app wherever that URL landed, with no navigation back — so
      // running afterwards inventoried whatever screen the probe had just produced. In the device
      // run that caught this, the probe's own URL was invalid (`bluesky://src`), the app was still
      // mid-transition, and the pass read 5 controls and concluded there was no drawer opener; the
      // very same screen read 8 controls including `label="Open drawer menu"` moments later. Here
      // the app is freshly launched and already settled — `bootDevice`'s `waitForAppReady` and the
      // auth gate have both run and seen a stable frame — which is the one moment in the whole
      // sweep the app is guaranteed to be sitting on its real entry screen.
      //
      // Detection reuses `detectChromeInventory` (`reach/chrome-inventory.ts`) — the exact same pure,
      // token-only match the opportunistic path already runs — so this costs device round trips only
      // and NOT ONE model call: reading a control list and matching its text against known node
      // vocabulary is not a vision judgment. Bounded to at most two pressable reads, one tap to open
      // the drawer and one best-effort tap to close it again, and wrapped in a `try/catch` a total
      // failure never escapes: no drawer control found, a device hiccup, anything at all still leaves
      // the sweep exactly where it would have started if this pass did not exist.
      if (options.explorationMode !== 'fast') {
        try {
          const launchEntryNodeId = entryNodeIds[0] ?? 'app-launch'
        const tabBarPressables = await ports.device.capturePressables(15_000)
        const tabBarChrome = detectChromeInventory(tabBarPressables, chromeCandidates())
        if (tabBarChrome) {
          await applyDiscoveredFact({
            kind: 'chrome-observed',
            entryNodeId: launchEntryNodeId,
            reveal: [],
            items: tabBarChrome.items
          })
        }

        const drawerOpener = findDrawerOpener(tabBarPressables)
        if (drawerOpener) {
          const revealStep: AppFlowStep = { type: 'tap', locator: drawerOpener }
          // Hoisted out of the try below because the close fallback needs it: the drawer's own
          // items are the only controls the sweep has *proved* are reachable while the drawer is
          // open, which is exactly the property the fallback turned out to need.
          let drawerChrome: ReturnType<typeof detectChromeInventory> = null
          // Its own try: the tab-bar inventory above has already been recorded by this point, and a
          // drawer that refuses to open must not read in the log as the whole pass having failed —
          // which is exactly how an ambiguous-selector throw presented before, sending the last
          // investigation looking for a broken pass rather than a broken locator.
          try {
            await ports.device.executeNavigationActions([revealStep], 15_000)
            const drawerPressables = await ports.device.capturePressables(15_000)
            drawerChrome = detectChromeInventory(drawerPressables, chromeCandidates())
            if (drawerChrome) {
              await applyDiscoveredFact({
                kind: 'chrome-observed',
                entryNodeId: launchEntryNodeId,
                reveal: [revealStep],
                items: drawerChrome.items
              })
            }
            console.log(
              `[app-flow] entry-chrome pass — drawer opened via ${drawerOpener.by}="${drawerOpener.value}", ${drawerChrome?.items.length ?? 0} items recorded from ${drawerPressables.length} controls`
            )
          } catch (error) {
            console.log(
              `[app-flow] entry-chrome pass — drawer opener ${drawerOpener.by}="${drawerOpener.value}" could not be used, keeping the tab inventory — ${error instanceof Error ? error.message : String(error)}`
            )
          }
          // Closing it again is not best-effort, and the comment that used to say so was wrong.
          // The claim was that a drawer left open leaves the app "no worse off than a normal walk
          // that opened it and moved on". It does not: the very next thing the sweep does is the
          // deep-link probe, whose single verdict decides the transport for every route. On the
          // social-app run that caught this, the close tap threw in 287ms against a control the
          // open drawer was covering, `.catch(() => undefined)` swallowed it without a line in the
          // log, and the probe fired its URL into a modal and read the drawer's own 17 controls
          // back. One silent toggle failure cost 79 routes their deep links.
          //
          // So the toggle is now checked rather than assumed, and the check is the opener's own
          // visibility: an open drawer covers the control that opened it, so finding that control
          // again is the app telling us the drawer is gone. That is the same reading of the same
          // control list the pass already does, and it costs one accessibility read.
          let closed = false
          try {
            await ports.device.executeNavigationActions([revealStep], 15_000)
            closed = Boolean(findDrawerOpener(await ports.device.capturePressables(15_000)))
          } catch (error) {
            console.log(
              `[app-flow] entry-chrome pass — close tap on ${drawerOpener.by}="${drawerOpener.value}" failed: ${error instanceof Error ? error.message : String(error)}`
            )
          }
          if (!closed) {
            // The fallback has to tap a control that is *present while the drawer is open*, and
            // the tab bar is not one. An earlier version reached for a tab entry on the reasoning
            // that it "does not have to be" under the drawer; the device disagreed. An open
            // drawer replaces the accessibility tree rather than overlaying it — the read taken
            // one line above returns the drawer's own 17 controls and nothing behind them — so a
            // tab locator misses for the same reason the opener did, in the same ~165ms, and the
            // run that proved it went straight from the failed opener tap to the warning in 178ms
            // without the tap ever reaching the device.
            //
            // The drawer's own items are the one set of controls the pass has just *observed*, so
            // they are what the fallback presses. They navigate rather than toggle, which closes
            // the drawer as a side effect of going somewhere — and somewhere is fine here: the
            // probe below needs a settled real screen, not specifically the entry screen.
            // Preferring the item that leads back to the launch entry node keeps it on the screen
            // the pass started from when the drawer offers that route, which on a tabbed app it
            // usually does.
            const drawerItems = (drawerChrome?.items ?? []).filter(
              (item) => item.trigger.value !== drawerOpener.value
            )
            const exitTarget = (
              drawerItems.find((item) => item.toNodeId === launchEntryNodeId) ??
              drawerItems.find((item) => item.toNodeId !== null) ??
              drawerItems[0]
            )?.trigger
            if (exitTarget) {
              try {
                await ports.device.executeNavigationActions(
                  [{ type: 'tap', locator: exitTarget }],
                  15_000
                )
                closed = Boolean(findDrawerOpener(await ports.device.capturePressables(15_000)))
              } catch (error) {
                console.log(
                  `[app-flow] entry-chrome pass — exit tap on ${exitTarget.by}="${exitTarget.value}" failed: ${error instanceof Error ? error.message : String(error)}`
                )
              }
            }
            console.log(
              closed
                ? `[app-flow] entry-chrome pass — drawer would not toggle shut; left it via ${exitTarget?.by}="${exitTarget?.value}"`
                : // Loud on purpose. Everything downstream now starts from a screen the sweep did
                  // not intend, and the probe's `frameChangedAfterOpen` guard is the only thing
                  // standing between that and the transport being switched off for every route.
                  `[app-flow] entry-chrome pass — WARNING: the drawer is still open and could not be dismissed; the next screens are being read through it`
            )
          }
        } else {
          console.log(
            `[app-flow] entry-chrome pass — no drawer opener among ${tabBarPressables.length} entry controls`
          )
        }
        } catch (error) {
          console.log(
            `[app-flow] entry-chrome pass failed, continuing without it — ${error instanceof Error ? error.message : String(error)}`
          )
        }
      }

      let deepLinkBreaker: DeepLinkBreakerState = initialDeepLinkBreakerState()
      // The exact URL a deep-link attempt opened, once the arrival judge has rejected it this
      // sweep. This matters most for a param-free prefix (`paramFreeDeepLink` truncating
      // `/profile/:name` to `/profile`, say): every sibling route sharing that ancestor computes
      // the identical `target`, and a node that gets requeued after the blocked-run breaker fires
      // recomputes the same `target` for itself too. Without this, a build whose `/profile` 404s
      // paid a URL open, a `waitForRoute`, a screenshot and a judge call *per node* to relearn
      // exactly the same fact — five times in the device run that motivated this fix. This is
      // deliberately in-memory and sweep-scoped, not persisted on the node: that is the later,
      // schema-backed version of this idea (plan step 3a), and this is only the cheap subset that
      // stops the immediate, self-contained waste.
      const rejectedDeepLinkUrls = new DeepLinkRejectionMemo()
      const closedGuardGates = new GuardGateMemo()
      // Fast is runtime-only. A deep-link probe used to add an open, settle, screenshot and vision
      // verdict before the first runtime dispatch — often most of a short six-screen run — and
      // could then be claimed as a deep-link capture despite the user selecting Fast.
      const probeRoute =
        options.explorationMode === 'fast' ? null : pickProbeRoute(nodesWithSlug)

      /**
       * The reach the one-time deep-link probe below already performed and verified, held for the
       * sweep to claim instead of performing it a second time.
       *
       * The probe does the full thing — opens the URL, settles, screenshots, asks the judge — and
       * then the sweep walked up to the same node and did all four again, identically. A device
       * run shows the duplicate costing ~14s: `openDeepLink (tabs)/explore` and a `match` verdict,
       * immediately followed by `openDeepLink (tabs)/explore` and the same `match` verdict.
       *
       * Only ever valid for the *first* node the sweep reaches, and `claimProbeCredit` enforces
       * exactly that by clearing it on any other node. The app is left sitting on the probe route
       * with nothing between the probe and the loop that touches the device, so if the sweep opens
       * with that node the screen in front of it is still the verified one; if it opens with any
       * other node, that node's own reach moves the app and the credit is worthless. Nothing here
       * tries to be cleverer than that — a credit that survived one unrelated navigation would be
       * a claim about a screen nobody has looked at.
       */
      let probeCredit: {
        nodeId: string
        arrival: ArrivalResult
        /** The frame the probe's judge accepted, for delivery to reuse — see `ReachEvidence.frame`. */
        frame: string
        /** The controls read during that same judge call — see `ReachEvidence.pressables`. */
        pressables?: readonly AppFlowPressable[] | null
        opened?: { app: string; url: string }
      } | null = null
      const claimProbeCredit = (nodeId: string): typeof probeCredit => {
        if (!probeCredit) return null
        const credit = probeCredit
        probeCredit = null
        return credit.nodeId === nodeId ? credit : null
      }

      /**
       * Interactive elements the device currently reports, or null when the read failed.
       *
       * Only the probe uses this, and only to decide whether a frame is substantive enough to draw
       * a sweep-wide conclusion from (`isSubstantiveFrame`). A failed read deliberately returns null
       * rather than 0: "I could not look" and "there is nothing there" are different claims, and
       * `judgeProbeFrame` treats only the second as something to act on. The extra accessibility
       * read costs a second or two, once per probe, against the multi-minute cost of the mistake it
       * prevents — every route in the sweep losing its deep link to a splash screen.
       *
       * The counts are comparable with the `settled with N interactive elements` line
       * `waitForAppReady` logs: on the reference run the same screens read 9 and 9, 38 and 48.
       */
      const countInteractiveElements = async (): Promise<number | null> => {
        try {
          return (await ports.device.capturePressables()).length
        } catch {
          return null
        }
      }

      /** One open-and-judge pass. `probeDeepLinkRoute` is what callers use; this is the single
       *  pass it may run twice. `pass` only ever appears in logs, so a device log shows whether a
       *  mismatch was confirmed or merely first observed. */
      const probeOpenPass = async (
        route: (typeof nodesWithSlug)[number],
        pass: 1 | 2
      ): Promise<{
        outcome: 'match' | 'mismatch' | 'inconclusive'
        arrival: ArrivalResult | null
        opened?: { app: string; url: string }
        frame?: string
        pressables?: readonly AppFlowPressable[] | null
      }> => {
        const probeBudget = new ActiveTimeBudget(60_000, activeNow(), activeNow)
        // The budget bounds the *judgement*, not the device work ahead of it, so getting the app
        // onto the screen is excluded the same way a wait on the user is (see the auth gate's
        // `budget.exclude`). Without this the two are charged to one clock, and a device that needs
        // recovering spends the judge's entire allowance before it is asked anything: a device log
        // shows `openDeepLink` taking ~72s against this 60s budget while the runner was wedged,
        // after which `verifyArrival`'s `!budget.expired` guard skipped both attempts, made no model
        // call at all, and the probe reported "inconclusive" having never actually looked. Slow is
        // not the same as wrong, and only the second is something this probe is entitled to conclude.
        const deviceStartedAt = Date.now()
        // Settle *before* opening the URL, not only after, and keep settling until the app is
        // actually there. `waitForAppReady` reports a stable frame and a dev-client loading screen
        // is perfectly stable, so "settled" alone does not mean "ready to route". On the cold-cache
        // social-app run the first read returned 2 interactive elements, the URL was fired into
        // that, Metro logged `iOS Bundled 16079ms index.ts (6130 modules)` 13 seconds later, and
        // the swallowed link left the app on its default screen — judged a mismatch, which took
        // deep links away from all 79 routes and tripled the sweep's token cost. That is why the
        // wait below has an element floor at all, and why it is a wait rather than the single
        // retry it replaced.
        let launchElements = await countInteractiveElements()
        if (!isSubstantiveFrame(launchElements)) {
          console.log(
            `[app-flow] deep-link probe — app shows ${launchElements ?? 'an unreadable frame'} interactive element(s), below the ${PROBE_FRAME_ELEMENT_FLOOR} needed to trust a probe verdict; waiting up to ${PROBE_LAUNCH_READY_BUDGET_MS / 1000}s for it to finish loading before opening the URL`
          )
          const waitStartedAt = Date.now()
          // One continuous wait, not a loop around a wait. `waitForRoute` returns the moment two
          // reads agree, and a dev-client loading screen agrees with itself immediately, so asking
          // it repeatedly re-paid the whole settle handshake for a frame that had not changed: on
          // the measured social-app run this printed the same poll/stale/settled triplet thirteen
          // times between t=45.9s and t=59.6s, ~1.1s each, and spent 13.7s discovering what one
          // poll would have noticed as it happened. Pushing the element floor *into* the wait lets
          // a single poll hold until the frame is both stable and substantial.
          await ports.device.waitForRoute({
            minInteractiveElements: PROBE_FRAME_ELEMENT_FLOOR,
            timeoutMs: PROBE_LAUNCH_READY_BUDGET_MS
          })
          checkSignal(signal)
          launchElements = await countInteractiveElements()
          const waitedSeconds = ((Date.now() - waitStartedAt) / 1000).toFixed(1)
          console.log(
            isSubstantiveFrame(launchElements)
              ? `[app-flow] deep-link probe — app rendered ${launchElements} interactive element(s) after ${waitedSeconds}s, opening the URL now`
              : `[app-flow] deep-link probe — app still shows ${launchElements ?? 'an unreadable frame'} interactive element(s) after ${waitedSeconds}s; opening the URL anyway, but a mismatch cannot be trusted from here`
          )
        }
        // Whether the app could have received the URL at all. Carried into `judgeProbeFrame`
        // because no post-open measurement can recover it — see that function's mismatch branch.
        const preOpenSubstantive = isSubstantiveFrame(launchElements)
        // The frame as it stood immediately before the open, so the judge can be told whether the
        // URL moved the app at all. Read here rather than reused from the settle wait above
        // because that wait may have returned seconds ago; this is the last frame before the open
        // and nothing else is. Best-effort: a failed read makes the question unanswerable, which
        // `judgeProbeFrame` treats as a reason to defer rather than a reason to act.
        const preOpenFrame = await ports.device
          .capturePressables()
          .then((pressables) => fingerprint(pressables))
          .catch(() => null)
        const opened = await ports.device.openDeepLink(route, {})
        checkSignal(signal)
        // Whether the app reached a stable frame at all. A frame captured while the device was
        // still refusing accessibility reads ("runner busy", "still loading … capturing anyway")
        // shows a splash or the previous screen no matter where the URL actually routed, so a
        // mismatch judged off it is a statement about the device, not about the URL scheme.
        const { settled } = await ports.device.waitForRoute()
        probeBudget.exclude(Date.now() - deviceStartedAt)
        const probeShot = getScratchPath(projectId, 'deep-link-probe')
        await ports.device.captureScreenshot(probeShot)
        // The controls are read inside the judge's own latency, so a probe that goes on to be
        // claimed by `probeCreditRung` can hand delivery a read it did not have to spend — see
        // `probeCredit`. Dropped on any outcome but a match, which costs nothing: the read ran
        // concurrently with a call that had to happen either way.
        const [arrival, probePressables] = await Promise.all([
          verifyCurrentTarget(route, probeShot, probeBudget),
          ports.device.capturePressables().catch(() => null)
        ])
        // Read the frame the judge actually looked at, so "was this worth judging" is answered
        // about that frame rather than about whatever the device shows by the time we ask. The
        // concurrent read above is the best available answer to that: it was taken *during* the
        // judge call rather than after it, so it is nearer the judged frame than a fresh read
        // would be — on the reference run the judge took up to 24.9s to reply, which is a long
        // time to let the app drift before asking what it was looking at. `judgeProbeFrame` only
        // consults this on a mismatch; the match branch returns before reading it.
        const frameElements =
          arrival.verdict === 'match'
            ? launchElements
            : (probePressables?.length ?? (await countInteractiveElements()))
        // Compared with the same overlap bar `waitForAppReady` settles on rather than exact
        // equality, for the same reason it uses one: a feed mutates under a stationary app, so
        // byte-identical frames are the exception even when nothing navigated.
        const frameChangedAfterOpen =
          preOpenFrame && probePressables
            ? similarity(preOpenFrame, fingerprint(probePressables)) < APP_READY_SETTLE_SIMILARITY
            : null
        const outcome = judgeProbeFrame({
          verdict: arrival.verdict,
          settled,
          elementCount: frameElements,
          preOpenSubstantive,
          frameChangedAfterOpen
        })
        if (outcome === 'match')
          return { outcome, arrival, opened, frame: probeShot, pressables: probePressables }
        if (outcome === 'inconclusive' && arrival.verdict === 'mismatch') {
          const why = !preOpenSubstantive
            ? `was opened into an app showing only ${launchElements ?? 'an unreadable number of'} interactive element(s), which could not have routed it`
            : frameChangedAfterOpen === false
              ? 'left the screen exactly as it was, so the URL was swallowed rather than routed — something already on screen took it'
              : frameChangedAfterOpen === null
                ? 'could not be checked against the frame before the open, so there is no evidence the URL reached the app'
                : !settled
                  ? 'mismatched on a frame the app never settled on'
                  : `mismatched on a frame carrying only ${frameElements ?? 'an unreadable number of'} interactive element(s) — too thin to be evidence about the scheme`
          console.log(
            `[app-flow] deep-link probe ${route.id} (pass ${pass}) ${why} — inconclusive, not evidence about the scheme`
          )
        }
        return { outcome, arrival: null }
      }

      // The one check both the initial probe and the breaker's re-confirmation need: does opening
      // `route` by URL actually land the app on it. Kept in one place so the two call sites can't
      // drift into subtly different definitions of "the transport works".
      //
      // A mismatch is confirmed by a second pass before it is believed. Everything the first pass
      // can measure about app readiness it measures *before* opening, but a URL can still be
      // swallowed by a dev client that answers accessibility reads while its bundle is not yet
      // wired to a navigator — the cold-boot failure `judgeProbeFrame` documents. The second pass
      // runs against an app that has demonstrably just rendered a real screen, so it is the one
      // observation that cannot be confounded that way. It costs one URL open and one judge call,
      // around six seconds, set against the measured cost of a wrong disable: every route in the
      // sweep walked by hand, 3.5x the tokens. Given that asymmetry a confirmation is close to
      // free, and it is skipped entirely on the overwhelmingly common path where the first pass
      // matches.
      const probeDeepLinkRoute = async (
        route: (typeof nodesWithSlug)[number]
      ): Promise<{
        outcome: 'match' | 'mismatch' | 'inconclusive'
        /** The judge's own verdict, so a caller can reuse the reach this probe already proved
         *  rather than paying for an identical one — see `probeCredit` below. Null whenever the
         *  probe concluded without a usable verdict. */
        arrival: ArrivalResult | null
        /** What `openDeepLink` recorded, so a caller reusing this reach reports the same
         *  `deep-link-opened` effect the deep-link strategy would have. */
        opened?: { app: string; url: string }
        /** The frame the judge accepted, so a caller reusing this reach can deliver it rather
         *  than screenshot the same screen again. */
        frame?: string
        /** The controls read at that same moment, for the same reason — null when the read failed,
         *  which only costs the claimant a read of its own. */
        pressables?: readonly AppFlowPressable[] | null
      }> => {
        const first = await probeOpenPass(route, 1)
        if (first.outcome !== 'mismatch') return first
        console.log(
          `[app-flow] deep-link probe ${route.id} looks like the wrong screen — re-opening the URL once against the now-loaded app before disabling deep links for the sweep`
        )
        const second = await probeOpenPass(route, 2)
        if (second.outcome !== 'mismatch') {
          console.log(
            `[app-flow] deep-link probe ${route.id} did not reproduce the mismatch on the second open (${second.outcome}) — the first was the app not being ready, deep links stay enabled`
          )
        }
        return second
      }

      if (probeRoute?.urlPath) {
        // The probe may only ever *confirm* that deep links work. It must never be what turns them
        // off, unless it actually saw the app settle somewhere other than the target.
        //
        // The asymmetry is brutal and was measured twice on device. Wrongly disabling costs every
        // one of up to 84 routes its transport, sending each into a fresh five-minute exploration
        // walk — the single most expensive mistake this sweep can make. Wrongly *enabling* costs a
        // few per-node attempts before `registerDeepLinkFailure`'s breaker trips on real evidence
        // from real nodes, which is a strictly better-informed judge than one screenshot. So
        // anything short of a settled, confident mismatch leaves deep links on and defers to it.
        //
        // What that rules out, both seen in one device log: a sub-agent timeout (an infrastructure
        // failure that says nothing about the URL) and a verdict read off a frame captured while
        // the runner was busy and `waitForAppReady` had already given up. Neither is evidence, and
        // between them they disabled deep links for an entire 84-route sweep.
        let outcome: 'match' | 'mismatch' | 'inconclusive' = 'inconclusive'
        let lastError: unknown = null
        for (let attempt = 1; attempt <= 2 && outcome !== 'match'; attempt++) {
          try {
            const probed = await probeDeepLinkRoute(probeRoute)
            outcome = probed.outcome
            if (probed.arrival && probed.frame)
              probeCredit = {
                nodeId: probeRoute.id,
                arrival: probed.arrival,
                frame: probed.frame,
                pressables: probed.pressables,
                opened: probed.opened
              }
            lastError = null
            if (outcome === 'mismatch') break
          } catch (error) {
            lastError = error
            outcome = 'inconclusive'
            if (attempt === 1) {
              console.log(
                `[app-flow] deep-link probe errored, retrying once — ${error instanceof Error ? error.message : String(error)}`
              )
            }
          }
        }
        deepLinkBreaker = initialDeepLinkBreakerState(outcome !== 'mismatch')
        if (lastError) {
          console.log(
            `[app-flow] deep-link probe errored twice — inconclusive, leaving deep links enabled for the per-node breaker to judge — ${lastError instanceof Error ? lastError.message : String(lastError)}`
          )
        } else if (outcome === 'match') {
          console.log(
            `[app-flow] deep-link probe ${probeRoute.id} (${probeRoute.urlPath}) matched — deep links enabled for this sweep`
          )
        } else if (outcome === 'mismatch') {
          console.log(
            `[app-flow] deep-link probe ${probeRoute.id} (${probeRoute.urlPath}) settled on the wrong screen — deep links disabled for this sweep`
          )
        } else {
          console.log(
            `[app-flow] deep-link probe ${probeRoute.id} (${probeRoute.urlPath}) inconclusive — leaving deep links enabled for the per-node breaker to judge`
          )
        }
      } else {
        console.log(
          '[app-flow] deep-link probe — no eligible probe route (need a urlPath with no params), leaving deep links enabled'
        )
      }

      // The breaker's re-probe device call, handed to `deepLinkStrategy` as its `reprobe` callback
      // (`reach/strategies/deep-link.ts`) — that module owns *when* to reprobe (a pure decision,
      // `reach/deep-link-policy.ts`'s `registerDeepLinkFailure`), this owns *how*, reusing the exact
      // same check the initial one-time probe above already runs. Absent when there is no eligible
      // probe route, matching the original immediate-disable fallback in that case.
      const reprobeDeepLinkRoute = probeRoute
        ? async (): Promise<boolean> =>
            (await probeDeepLinkRoute(probeRoute)).outcome !== 'mismatch'
        : undefined

      // Entry screens are the cheapest to reach (a deep link or a one-hop walk) and are what produce
      // the chrome inventory and the parent replays every later screen behind that chrome reuses —
      // see `sweep-order.ts`'s doc comment for the full tier breakdown. `nodesWithSlug` itself stays
      // in parser order: everything above and below the loop that looks a node up by id, counts
      // orphans, or writes the final result reads it as-is, and reordering it in place would only
      // make those call sites' order accidentally depend on the sweep's own order too.
      // `deepLinkBreaker.enabled` is read here, after the one-time probe above has folded its
      // result in, because it decides whether tier 5 may demote a node at all — see
      // `OrderSweepNodesOptions.deepLinksEnabled`. With the transport live a param-free URL is a
      // way in that owes nothing to the control graph; with it off, the graph is all there is.
      const sweptNodes = orderSweepNodes(
        nodesWithSlug,
        parsed.edges,
        parsed.entryScreenIds,
        parsed.entryLayouts,
        {
          deepLinksEnabled: deepLinkBreaker.enabled,
          // Only when a credit is actually in hand. `probeCredit` is set by a probe the judge
          // accepted and cleared by the first `claimProbeCredit` call, so this is precisely "there
          // is verified work on this node waiting to be claimed" — not merely "a route was probed".
          probeRouteId: probeCredit?.nodeId ?? null
        }
      )

      // `ReachQueue` replaces the old `for (let i = 0; i < nodesWithSlug.length; i++)` — see its doc
      // comment for why the raw index could not survive `sweptNodes` reordering `nodesWithSlug`.
      // `queue.completed` reads exactly like the old `i` did at the top of the loop body (nodes
      // strictly before the current one, not yet counting the one in flight), and `queue.remaining`
      // exactly like the old `total - i` — both used at every call site below that used to spell out
      // that arithmetic by hand.
      const sweepQueue = new ReachQueue(sweptNodes)
      let sweepPaused = false
      /** Nodes the blocked-run breaker has already re-served once. See the `requeueCurrent` call
       *  site for why a second retry is always wasted work rather than a second chance. */
      const requeuedIds = new Set<string>()
      // `activeNow` rather than `Date.now` for the deadline, for the same reason every
      // `ActiveTimeBudget` above uses it: a sweep sitting on a blocked prompt is waiting on the
      // user, and charging that to the run's clock would time out a sweep that was never slow.
      const explorationControl = new ExplorationControl(
        options.screenLimit,
        options.pauseRequested,
        {
          attemptLimit: options.attemptLimit,
          sweepDeadlineMs: options.sweepDeadlineMs,
          now: activeNow
        }
      )
      /** The one place the four pause reasons turn into a line a reader can act on. The three
       *  ceilings are not interchangeable and must not all print "screen limit reached": that
       *  message on a run that captured three of eight screens and ran out of attempts sends the
       *  reader looking for five missing captures instead of at the unreachable routes that ate
       *  the budget. */
      const pauseMessage = (reason: ExplorationPauseReason): string => {
        if (reason === 'requested') return '[app-flow] pausing at the latest screen checkpoint'
        if (reason === 'limit')
          return `[app-flow] screen limit reached (${options.screenLimit}) — pausing`
        if (reason === 'attempts')
          return `[app-flow] attempt limit reached (${explorationControl.screensAttempted} attempts for ${explorationControl.screensExplored}/${options.screenLimit} screens) — pausing; the remaining routes are costing more to reach than they are returning`
        return `[app-flow] time limit reached (${explorationControl.screensExplored}/${options.screenLimit} screens in ${explorationControl.screensAttempted} attempts) — pausing`
      }
      const pauseBeforeNextScreen = (): boolean => {
        const reason = explorationControl.beforeNextScreen()
        if (!reason) return false
        sweepPaused = true
        sweepStopped = true
        console.log(pauseMessage(reason))
        return true
      }
      const finishExploredScreen = (captured: boolean): boolean => {
        const reason = explorationControl.screenFinished(captured)
        if (!reason) return false
        sweepPaused = true
        sweepStopped = true
        console.log(pauseMessage(reason))
        return true
      }
      for (let node = sweepQueue.next(); node !== null; node = sweepQueue.next()) {
        checkSignal(signal)
        // Pause before touching the next screen. A request made while a screen is in flight reaches
        // the matching check after that screen's durable checkpoint has been written below.
        if (pauseBeforeNextScreen()) break
        // Two distinct reasons to skip, and only these two. The checkpoint is a snapshot taken
        // before this loop started, so it cannot see a node captured opportunistically while
        // exploring toward an earlier one this same run — that write only ever lands in the live
        // `captureMap`, and checking the checkpoint alone re-explored every opportunistic hit from
        // scratch with a fresh five-minute budget, the very waste that feature exists to avoid.
        //
        // What must NOT skip is a node this run already failed: `recordUnreached` writes a
        // `missing` entry into the same live `captureMap`, so a bare `captureMap[node.id]` test
        // also swallows the `queue.requeueCurrent()` retry the blocked prompt schedules once the
        // user (or the relaunch) clears the blocker — the node would be marked missing and never
        // reattempted.
        const settled = checkpoint.captures[node.id] ?? null
        const opportunistic = captureMap[node.id]?.captureMethod === 'opportunistic'
        if (settled || opportunistic) {
          console.log(
            opportunistic
              ? `[app-flow] skip ${node.id} — captured opportunistically while exploring another screen`
              : `[app-flow] skip ${node.id} — already captured in a previous run`
          )
          emit(projectId, onEvent, {
            type: 'step',
            phase: 'capture',
            message: opportunistic
              ? `Captured ${node.urlPath ?? node.title} opportunistically`
              : `Already captured ${node.urlPath ?? node.title}`,
            completed: sweepQueue.completed + 1,
            total,
            captured: explorationControl.screensExplored,
            captureLimit: options.screenLimit
          })
          continue
        }
        const budget = new ActiveTimeBudget(5 * 60_000, activeNow(), activeNow)
        const label = node.urlPath ?? node.title
        emit(projectId, onEvent, {
          type: 'step',
          phase: 'capture',
          message: `Reaching ${label}`,
          completed: sweepQueue.completed,
          total,
          captured: explorationControl.screensExplored,
          captureLimit: options.screenLimit
        })

        // One resolution feeds both the values and the unresolved list, so the two cannot drift: the
        // static call sites are consulted first and anything the app itself showed us earlier in the
        // sweep (or in a previous one) fills in what they could not.
        const resolution = resolveNodeParams(node, parsed.edges, paramStore)
        // Only the params that actually have an observed value. These go to rungs that open a URL
        // or dispatch a navigation, and a stand-in would make either of those land cleanly on some
        // other record — see `buildUrlPath`, which now refuses a hole outright rather than filling
        // it. `unresolvedParams` below is what stops a rung from getting that far.
        const params = Object.fromEntries(
          node.params
            .filter((key) => resolution.values[key] !== undefined)
            .map((key) => [key, resolution.values[key]])
        )
        // Params neither the route graph nor anything harvested could supply. A deep link built on a
        // guessed id opens a record the app does not have, and the error screen that follows is
        // indistinguishable from a route this build withholds — so the in-app path is the only
        // honest way in.
        const unresolvedParams = resolution.unresolved
        if (unresolvedParams.length === 0 && resolution.source && resolution.source !== 'static') {
          console.log(
            `[app-flow] params — ${node.urlPath} resolved from ${resolution.source} seen on ${resolution.seenOn}: ${JSON.stringify(resolution.values)}`
          )
        }
        let captureMethod: AppFlowCapture['captureMethod'] = 'unreached'
        let replayScript: string | null = null
        // True whenever `replayScript` was itself re-confirmed by a fresh screenshot rather than
        // merely recorded. Only `savedReplayStrategy` can set it now, replaying a script the
        // *manual* recorder published; exploration records no script to verify.
        let replayScriptVerified = false
        /**
         * The journey a walk actually took, as `agent-device …` lines — this node's stored
         * `pathToReach` and the seed for anything that explores from here. Set by `exploreFrom` on
         * arrival, null when no walk arrived or when the walk contained a step with no faithful
         * CLI form (see `walkCommands`, which refuses to store a truncated path).
         */
        let pathCommands: readonly string[] | null = null
        let reachError: string | null = null
        let acceptedArrival: ArrivalResult | null = null
        // What was in hand at the instant the vision judge accepted this node's screen, kept because
        // that instant is the only one in the whole reach that is *proven* to be looking at the
        // target. Everything after it — publishing the recording, replaying it to check it, the
        // auth-gate probe — can and does move the device somewhere else, and a replay that fails
        // mid-walk leaves it stranded with no session at all. Delivery falls back to these two when
        // the live device has moved on; see `chooseDeliverySources` (reach/delivery.ts).
        //
        // The frame lives in its own scratch slot rather than being read from `scratch/explore.png`
        // later: that file is overwritten by the very next observation, and by the time delivery
        // runs it is whatever the exploration of some *other* node last looked at.
        let arrivalFrame: string | null = null
        let arrivalPressables: AppFlowPressable[] = []
        /**
         * The frame the winning strategy's judge accepted, when that strategy left the app standing
         * on it with nothing further touching the device — `ReachEvidence.frame`. Distinct from
         * `arrivalFrame` above, which is a *fallback* for a delivery capture that came back
         * compromised; this one says the delivery capture need not be taken at all, because the
         * screen has not changed since the frame that proved it.
         */
        let verifiedFrame: string | null = null
        /** The controls read at that same verified moment — `ReachEvidence.pressables`. */
        let verifiedPressables: readonly AppFlowPressable[] | null = null
        let authStopped = false
        // Set once a deep link proves the route resolves but this build withholds the screen.
        // Exploration cannot get past that, so it is skipped rather than left to time out.
        let unavailableReason: string | null = null
        // The deep link resolved onto the app's 404 without proving the screen is gated — usually a
        // sample param. The explorer is told, so it treats a missing entry point as confirmation
        // rather than a reason to keep hunting.
        let deepLinkNotFound = false
        // `deepLinkAttempted` (whether the deep-link rung actually opened a URL for this node, as
        // opposed to short-circuiting on the breaker, an unresolved param, or a missing urlPath) is
        // now derived from the ladder's own `outcome.attempts` after it runs — see the `const
        // deepLinkAttempted = outcome.attempts.some(...)` below — since that is exactly the
        // `touchedDevice` field `deepLinkStrategy` (`reach/strategies/deep-link.ts`) already reports.
        // Set only when a `CommandSeed`'s own stored path fails to run — a fact about the parent's
        // journey, not about whether the target is reachable at all. The `explore` step below uses
        // this to decide whether a bounded last hop that could not even start is worth retrying as
        // a full, unseeded exploration (yes) versus one that started fine and simply ran out of its
        // three decisions (no — see plan Step 3e).
        let seedBaseFailed = false
        // Set when the most recent `exploreFrom` reached its decision loop and ended without
        // arriving, as opposed to failing before it (launch, base replay, auth gate) — reset at
        // the top of every call. `shouldRetryFromEntry` reads it to tell a walk that ran out of
        // ideas from one that never got to have any.
        let seededWalkRan = false
        // The *manual* recorder's published path, and the only `.ad` file the sweep still touches:
        // `savedReplayStrategy` replays it when one exists. Exploration no longer writes a
        // candidate or publishes anything here.
        const savedScript = join(getFlowsDir(projectId), `${node.slug}.ad`)
        // Bounded mode — plan Step 3e/3f's "last hop": the seed already proved everything up to one
        // tap away, so a walk that has not arrived within three decisions is not a promising walk
        // approached badly, it is a target that was never reachable this way at all. Tighter than
        // `EXPLORATION_MAX_DECISIONS`'s general-purpose seven on purpose — see that constant's own
        // doc comment for why a higher cap only buys longer flailing on a hopeless target, which is
        // exactly what a proven seed should never need.
        const exploreFrom = async (
          seed: ExplorationSeed | null,
          exploreOptions: { bounded?: boolean } = {}
        ): Promise<boolean> => {
          checkSignal(signal)
          seededWalkRan = false
          if (authStopped || budget.expired || isFallbackRoute(node) || unavailableReason) {
            if (isFallbackRoute(node)) {
              reachError = 'Fallback route has no in-app entry point.'
            }
            return false
          }
          const commandSeed = seed && 'commands' in seed ? seed : null
          // The lines this walk's own stored path will open with, so the path it eventually stores
          // is literally what the walk did. A command seed contributes the parent's whole journey;
          // anything else contributes one baseline launch line carrying the URL the reset below
          // actually opened. Built before the device is touched so the two cannot disagree.
          const seedUrl = seed && 'url' in seed ? seed.url : null
          const prefix = commandSeed
            ? [...commandSeed.commands]
            : baselineLaunchCommands(device, seedUrl)
          // Collected as the walk goes, by `act` below. Null the moment a step turns out to have no
          // faithful CLI form — see `walkCommands` for why a truncated path is worse than none.
          let walkLines: string[] | null = []
          try {
            try {
              if (commandSeed) {
                // Running the parent's stored `pathToReach` rather than replaying its `.ad`: the
                // lines open with their own launch and then press their way to the parent's screen,
                // which is the same journey the script encoded and the same one `path-run.ts` runs
                // for the Replay button. What it no longer involves is a candidate file, an armed
                // `--save-script` transaction, a divergence report or an in-place repair — the four
                // things `replaySeedBase` existed to manage, all of which were consequences of the
                // seed being a recording rather than a list.
                //
                // Repair has no analogue here and needs none. A recorded `.ad` carried per-step
                // element *identities* that a fresh accessibility tree could contradict
                // (`IDENTITY_MISMATCH`, the failure the strip existed to rescue); these lines carry
                // only selectors, which are re-resolved against the live tree on every run.
                await ports.device.runPathCommands(commandSeed.commands)
                checkSignal(signal)
              } else {
                // A soft re-root, not a relaunch. The cold start this used to pay was the price of
                // the recorded script's `open --relaunch` first line, not of the walk — see
                // `startReplayRecording`'s own doc comment, which says so — and the walk only needs
                // to start somewhere known. `seedUrl` carries a deep-link seed's URL so the walk
                // starts where the stored baseline line says it does.
                await ports.device.resetToLaunch(
                  seedUrl,
                  Math.max(1_000, Math.min(90_000, budget.remainingMs))
                )
                checkSignal(signal)
              }
            } catch (error) {
              // Only a `commandSeed` failing here means the *parent's own proof* did not hold up —
              // the caller (`runVerifiedReach`'s `explore` step) uses this to decide whether it is
              // still worth paying for a full, unseeded exploration afterwards. A plain launch
              // failing here is the pre-existing case and always did fall to the outer catch before
              // this branch existed; recorded the same way now, just sooner and with a clearer note.
              if (commandSeed) seedBaseFailed = true
              reachError = `${commandSeed ? "Seed's stored path" : 'Launch'} failed: ${error instanceof Error ? error.message : String(error)}`
              console.log(`[app-flow] ${node.id} ${reachError}`)
              return false
            }
            const launchAuth = await ports.auth.checkGate(sweepQueue.remaining, budget)
            if (launchAuth === 'stop') {
              authStopped = true
              return false
            }
            if (launchAuth === 'exhausted') {
              reachError = 'Navigation budget exhausted after five minutes.'
              return false
            }
            const graphPath = findNavigationPath(parsed.edges, node.id, entryNodeIds)
            // Which control opens this screen, and from where — the parser reads it off the call
            // site, so the planner is told what to tap instead of hunting for it screen by screen.
            const incoming = parsed.edges
              .filter((edge) => edge.to === node.id)
              .map((edge) =>
                edge.trigger
                  ? `from ${edge.from}: tap ${edge.trigger.by}=${JSON.stringify(edge.trigger.value)}`
                  : `from ${edge.from}: control unknown (${edge.raw})`
              )
            // `node.group` names only the first navigator a shared registration helper happened to
            // be called from — true for id/display purposes, but stating it alone as WHERE the
            // screen lives is actively misleading when it is really registered in several tabs (see
            // `groups` on `AppFlowNode`). Naming all of them here is what stops the planner reading
            // e.g. "registered in layout: HomeTab" for a screen that is just as reachable from
            // Search, Notifications, MyProfile or Messages.
            const layoutLine =
              node.groups.length > 1
                ? `Target is registered via a shared helper in every one of: ${node.groups.join(', ')} — it is reachable from any of them, not only the first.`
                : `Target is registered in layout: ${node.group || 'unknown'}`
            // Bounds this one exploration attempt's opportunistic spend — see
            // `OPPORTUNISTIC_VERIFY_LIMIT`. A fresh budget per `exploreFrom` call (seeded attempt,
            // then a from-entry retry) rather than per node, since each is its own walk through the
            // app and each can pass its own hub screens.
            let opportunisticAttempts = 0
            // The action that produced whatever the next `observed` call sees, if any — set at the
            // end of a successful `act` below. A chrome revealed by a tap (a hamburger button
            // opening a drawer) needs this to record a non-empty `reveal`; a chrome that needed no
            // reveal at all (an always-visible tab bar) simply never has one, and that is correct
            // too — see the `chrome-observed` fact this feeds in `observed` below.
            let lastAction: AppFlowStep | null = null
            // A seeded walk starts on a screen this sweep already proved it can reach, so the first
            // hop out of it is recordable. An unseeded walk starts from a fresh relaunch, where the
            // landing screen is whatever the app restores — so it starts at null and the first
            // `observed` confirmation sets the position without claiming an edge into it.
            const cursor = createWalkCursor(seed?.id ?? null)
            walkCursor = cursor
            // One session for this whole exploration attempt (Step 0): the model keeps its own
            // turn-by-turn history, so only the first step needs the full target briefing —
            // every step after that sends just the fresh screenshot, the fresh control list, and
            // anything that went wrong since the last step (`history`, which by this point only
            // ever holds failures — see the doc comment on `decide` in exploration.ts).
            // No tools. Every one of this role's decisions is made from the screenshot and the
            // control list it is handed — the prompt never asks it to consult a file, and the
            // source path in the briefing is context for naming, not an invitation to open it.
            // Granting `read` let a walk that could not find its target start reading the repo
            // instead: one ProfileKnownFollowers step ran 42s and 324k tokens, and that single
            // unreachable screen accounted for 73% of an entire sweep's bill. `maxDecisions`
            // cannot bound this, because it counts decisions and the reading happens inside one.
            //
            // History compaction: the session keeps its turns so a step does not resend what came
            // before, but the provider still re-reads all of them every step. Measured on device:
            // within one walk a step-1 planner call cost ~1,900 input tokens and step 3 cost
            // ~3,900, and the sweep logged 137,600 cache-read tokens across 20 planner calls —
            // more than four times its entire reasoning spend and the largest single line in the
            // run. Older turns keep the model's own decision and lose their screenshot and control
            // list; the briefing and the two most recent observations stay whole. See
            // `pi/history-compaction.ts` for the exact rules.
            const navigationSession = await runAgentSession({
              cwd: projectPath,
              systemPrompt: NAVIGATION_SYSTEM_PROMPT,
              tools: [],
              // `low`, and deliberately not `off` like the judges. This is the one app-flow role
              // that makes a genuine multi-step decision — where am I, what did my last tap do,
              // which control moves me toward a screen I have not seen yet — so it is the role most
              // likely to pay for zero reasoning in failed walks, and a failed walk costs far more
              // than the reasoning it saved. `low` is still a large cut from what this role was
              // actually getting: nothing was reaching the wire before, so every call ran at the
              // backend's xhigh default (see `pi/provider.ts`). Worth retrying at `off` once a
              // sweep has shown what `low` does to the arrival rate.
              thinkingLevel: 'low',
              compactHistory: { keepRecentUserTurns: 2 }
            })
            let stepsSent = 0
            let exploration: ExplorationResult
            try {
              exploration = await runInteractiveExploration({
                budget,
                // The five-minute budget alone is not a bound on how much a hopeless target costs:
                // it bounds wall clock, not model calls, and a fast app burns decisions far quicker
                // than it burns minutes. This is the bound on calls — see the constant's comment for
                // why seven, and why an unreachable screen is exactly the case that used to run long.
                // A bounded attempt gets a much tighter version of the same reasoning: the seed
                // already proved everything up to one tap away, so three unproductive decisions (or
                // even one that makes no visible difference, or one failed planner call) says the
                // target is not one more tap from here after all.
                maxDecisions: exploreOptions.bounded ? 3 : EXPLORATION_MAX_DECISIONS,
                maxNoProgress: exploreOptions.bounded ? 1 : undefined,
                maxPlannerFailures: exploreOptions.bounded ? 1 : undefined,
                observe: async () => {
                  // No auth gate here: the app was relaunched and classified immediately before
                  // this loop started, and mid-exploration taps cannot reach a launch gate. The
                  // frame is the decider's vision input only, so every step overwrites one scratch
                  // file and `screens/` keeps just the delivered capture.
                  const screenshotPath = getScratchPath(projectId, 'explore')
                  await ports.device.captureScreenshot(screenshotPath)
                  return {
                    screenshotPath,
                    pressables: await ports.device
                      .capturePressables(Math.max(1_000, Math.min(30_000, budget.remainingMs)))
                      .catch(() => [])
                  }
                },
                check: () => checkSignal(signal),
                decide: async (observation, history) => {
                  const visible = summarizePressables(observation.pressables)
                  const recentFailures = history.length
                    ? `\nSince the last step: ${JSON.stringify(history)}`
                    : ''
                  const controlsLine = `Visible controls now: ${JSON.stringify(visible.shown)}${visible.omitted ? ` (+${visible.omitted} more controls on this screen, not listed)` : ''}${recentFailures}\nChoose one next decision from this fresh observation.`
                  // A bounded attempt is seeded one hop from the target by construction — the
                  // planner is told so directly instead of being handed the same "find your way
                  // from an entry screen" briefing a full exploration gets, and the parent's own
                  // outgoing edge is handed over as a strong hint (never a command: a recorded
                  // control can drift from what the live screen shows).
                  const seedLine = commandSeed
                    ? `\nYou replayed a proven journey to ${commandSeed.id} and are one tap away from the target.${commandSeed.trigger ? ` The last known control for this hop: tap ${commandSeed.trigger.by}=${JSON.stringify(commandSeed.trigger.value)} — use it if it is still on screen, otherwise find the equivalent control.` : ''}`
                    : seed && 'url' in seed
                      ? `\nThe app was opened directly at ${seed.urlPath} (${seed.id}), so you start there rather than at the entry screen.`
                      : ''
                  const boundedLine = exploreOptions.bounded
                    ? '\nYou have very few actions left to find this screen from here — act only on a control you are confident leads to the target, and return blocked as soon as none does.'
                    : ''
                  const userPrompt =
                    stepsSent === 0
                      ? `${appEntryBrief}${seedLine}${boundedLine}\nTarget screen: ${node.id} (${node.title})${deepLinkNotFound ? "\nOpening this route by URL landed on the app's not-found screen, so this build may not offer it at all. Confirm quickly via the named entry control and return blocked if it is absent." : ''}${unresolvedParams.length ? `\nThis route needs ${unresolvedParams.map((key) => `:${key}`).join(', ')}, so it shows one concrete item. If the entry chrome has a tab or menu item named after this screen, tap that first; it goes straight there. Only when no such entry exists, open any one item from a list that already leads here — which one does not matter.` : ''}\n${layoutLine}\nSource: ${node.file ?? 'unknown'}\nJourney from an entry screen: ${graphPath ? describeJourney(parsed.edges, graphPath) : 'none in the route graph — find it by exploring from the entry chrome'}\nWays into this screen: ${incoming.length ? incoming.join(' | ') : 'none found statically'}\n${controlsLine}`
                      : controlsLine
                  stepsSent += 1
                  const response = await navigationSession.prompt(
                    {
                      userPrompt,
                      imagePath: observation.screenshotPath,
                      // One planning step is a look at a screenshot and a control list, so a call
                      // still running after a minute is stuck. Capping it here leaves the
                      // five-minute budget for the steps that follow instead of spending it all
                      // on one of them.
                      timeoutMs: Math.max(1_000, Math.min(60_000, budget.remainingMs))
                    },
                    `navigate ${node.id} step ${stepsSent}`
                  )
                  return parseNavigationDecision(parseSubAgentJson<unknown>(response.text))
                },
                act: async (action) => {
                  console.log(`[app-flow] explore ${node.id} action ${JSON.stringify(action)}`)
                  try {
                    await ports.device.executeNavigationActions(
                      [action],
                      Math.max(1_000, budget.remainingMs)
                    )
                    lastAction = action
                    noteWalkAction(cursor, action)
                    // Recorded here, after the action succeeded, so the stored path contains
                    // exactly the steps the device actually performed — the same point the old
                    // recording transaction captured them at. A step with no faithful CLI form
                    // poisons the whole list rather than being skipped; see `walkCommands`.
                    if (walkLines) {
                      const line = walkStepCommand(action)
                      if (line) walkLines.push(line)
                      else if (action.type !== 'wait') walkLines = null
                    }
                  } catch (error) {
                    // The loop turns this into a history note for the planner. Without a log line the
                    // run reads as an action that silently did nothing to the screen.
                    console.log(
                      `[app-flow] explore ${node.id} action failed — ${error instanceof Error ? error.message : String(error)}`
                    )
                    throw error
                  }
                },
                verifyArrival: async (observation) => {
                  const arrival = await verifyCurrentTarget(
                    node,
                    observation.screenshotPath,
                    budget
                  )
                  if (arrival.verdict !== 'match') return false
                  acceptedArrival = arrival
                  // Only when a single tap separates us from the last confirmed screen — the same
                  // conservatism `noteWalkArrival` applies before minting an edge, and for the same
                  // reason: with two or more actions in between, which one produced the arrival is a
                  // guess. Read before `noteArrival`, which resets the cursor's pending actions.
                  if (
                    cursor.actionsSinceConfirmation.length <= 1 &&
                    lastAction?.locator?.by === 'id'
                  ) {
                    paramStore.learnFromArrival(lastAction.locator.value, node, node.id)
                  }
                  // The walk's own target, confirmed — the strongest hop the sweep ever observes,
                  // since this is the judge the whole ladder exists to satisfy.
                  noteArrival(node.id)
                  // Kept for the destination-guard fallback below and for delivery: these are the
                  // controls of the screen the judge just accepted, and the only place they are
                  // still in hand once the recording has been published. Every later observation
                  // overwrites the scratch frame, and the loop returns no observation of its own.
                  arrivalPressables = observation.pressables
                  try {
                    const frame = getScratchPath(projectId, 'arrival-frame')
                    await copyFile(observation.screenshotPath, frame)
                    arrivalFrame = frame
                  } catch (error) {
                    // Copying the frame aside is a delivery convenience, never a condition of the
                    // arrival — the judge has already spoken on this screenshot. A failed copy costs
                    // the fallback frame and leaves the arrival exactly as accepted.
                    console.log(
                      `[app-flow] ${node.id} could not keep the verified arrival frame — ${error instanceof Error ? error.message : String(error)}`
                    )
                  }
                  return true
                },
                // Side observations: a tap made while walking to `node` can land on, or reveal,
                // something worth remembering that has nothing to do with this walk's own target —
                // another still-pending screen (the original opportunistic-capture case), a
                // navigator chrome (plan Step 3d), or a screen the parser never registered a node
                // for at all (plan Step 4a). This purely observes: it never influences what `decide`
                // returns, never injects a step, and never lets `node` itself resolve via this path —
                // `verifyArrival` above is the only way this walk's own target is accepted. Each
                // check below reports what it found as a `DiscoveredFact` rather than writing
                // `captureMap`/`runtimeNodes`/`chromeInventory` directly, so this hook stays ignorant
                // of the graph it feeds — see `DiscoveredFact`'s doc comment (`reach/types.ts`) and
                // `applyDiscoveredFact` above, which is what actually folds one in.
                observed: async (observation) => {
                  if (budget.remainingMs < OPPORTUNISTIC_MIN_REMAINING_MS) return
                  const observedTokens = fingerprint(observation.pressables)

                  // 1. A tap made while walking to `node` landed on some other screen the sweep
                  //    already has a parsed node for. Never the node this walk is already trying to
                  //    reach, never a node the sweep has already settled (anything with a
                  //    `captureMap` entry), and never a route with no in-app entry point at all.
                  //
                  //    Only when the observation matches no known runtime node: a match there is a
                  //    better answer than a title-overlap guess, and the later `matchRuntimeNode`
                  //    call in this block will use it, so spending a model call on a sibling-prone
                  //    guess first would only pay for an answer the sweep already has.
                  if (
                    opportunisticAttempts < OPPORTUNISTIC_VERIFY_LIMIT &&
                    !matchRuntimeNode(runtimeNodes, observedTokens)
                  ) {
                    const pending = nodesWithSlug.filter(
                      (other) =>
                        other.id !== node.id && !captureMap[other.id] && !isFallbackRoute(other)
                    )
                    const known = pending.length
                      ? pickOpportunisticCandidate(observedTokens, pending)
                      : null
                    if (known) {
                      opportunisticAttempts += 1
                      const arrival = await verifyCurrentTarget(
                        known,
                        observation.screenshotPath,
                        budget
                      )
                      if (arrival.verdict === 'match') {
                        await applyDiscoveredFact({
                          kind: 'opportunistic-capture',
                          nodeId: known.id,
                          arrival,
                          screenshotPath: observation.screenshotPath,
                          pressables: observation.pressables
                        })
                        return
                      }
                      console.log(
                        `[app-flow] opportunistic ${known.id} rejected while exploring ${node.id} — ${arrival.reason}`
                      )
                    }
                  }

                  // 2. A navigator chrome — pure token matching, no vision call, so it never
                  //    competes with the two model-backed checks above/below for the walk's own
                  //    opportunistic budget.
                  const chromeDetected = detectChromeInventory(
                    observation.pressables,
                    chromeCandidates()
                  )
                  if (chromeDetected) {
                    // `node` is where this walk is *going*, not where it is standing — it has not
                    // been reached yet, or the walk would be over. Attributing the reveal to it said
                    // the drawer was opened from a screen the explorer had never seen, which is how a
                    // device run ended up recording the Settings screen's rows as a chrome revealed
                    // from `HomeTab/Home`. The cursor holds the last position an arrival judge
                    // actually confirmed; the target is only the fallback when nothing has been
                    // confirmed yet.
                    const revealedFrom = walkCursor?.confirmedNodeId ?? node.id
                    // Only a tap that reads as a drawer opener is a reveal. `lastAction` is just
                    // whatever the walk happened to tap before this frame, so passing it through
                    // unconditionally recorded an always-visible tab bar as needing a reveal — and
                    // `buildChromePathToReach` then published that tap as the first step of the
                    // journey to every screen behind it. On device that produced paths beginning
                    // `press 'id="feedItem-by-gregpak.net"'` — tapping a post in the feed — as the
                    // documented way to reach 40 different screens.
                    const reveal =
                      lastAction && inferChromeKind([lastAction]) === 'drawer' ? [lastAction] : []
                    await applyDiscoveredFact({
                      kind: 'chrome-observed',
                      entryNodeId: revealedFrom,
                      reveal,
                      items: chromeDetected.items
                    })
                    return
                  }

                  // 3. A screen the parser never registered a node for at all. Only worth spending a
                  //    model call on once neither cheap check above accounted for this frame, and
                  //    only within the walk's own opportunistic budget and the sweep-wide mint cap.
                  if (opportunisticAttempts >= OPPORTUNISTIC_VERIFY_LIMIT) return
                  if (runtimeNodes.length >= RUNTIME_NODE_SWEEP_CAP) return
                  // Similarity-only pass first, with no id yet: a repeat sighting of an
                  // already-minted runtime node is recognised for free, without spending the model
                  // call the judge check below costs.
                  const knownRuntime = matchRuntimeNode(runtimeNodes, observedTokens)
                  if (knownRuntime) {
                    await applyDiscoveredFact({
                      kind: 'runtime-screen-sighted',
                      match: knownRuntime,
                      key: knownRuntime.id,
                      info: '',
                      observedTokens: [...observedTokens],
                      screenshotPath: observation.screenshotPath,
                      pressables: observation.pressables
                    })
                    return
                  }
                  opportunisticAttempts += 1
                  const distinctResponse = await runAgent(
                    {
                      cwd: projectPath,
                      systemPrompt: RUNTIME_SCREEN_SYSTEM_PROMPT,
                      userPrompt: 'Is this a distinct app screen not already accounted for?',
                      tools: [],
                      // A classification of the frame in front of it, like the arrival judge — real
                      // screen or transient overlay — so `off` for the same reason. This one is also
                      // purely opportunistic: it runs on frames a walk happened to pass through, and
                      // declining to mint a node is always a safe answer.
                      thinkingLevel: 'off',
                      imagePath: observation.screenshotPath,
                      timeoutMs: Math.max(1_000, Math.min(30_000, budget.remainingMs))
                    },
                    'runtime-screen'
                  ).catch((error) => {
                    console.log(
                      `[app-flow] runtime-screen check failed while exploring ${node.id} — ${error instanceof Error ? error.message : String(error)}`
                    )
                    return null
                  })
                  const verdict = distinctResponse
                    ? parseSubAgentJson<{ distinct: boolean; key?: string; info?: string }>(
                        distinctResponse.text
                      )
                    : null
                  if (!verdict?.distinct || !verdict.key) return
                  const candidateId = `runtime:${sanitizeScreenKey(verdict.key) || 'screen'}`
                  const exactMatch = matchRuntimeNode(runtimeNodes, observedTokens, candidateId)
                  await applyDiscoveredFact({
                    kind: 'runtime-screen-sighted',
                    match: exactMatch,
                    key: verdict.key,
                    info: verdict.info ?? '',
                    observedTokens: [...observedTokens],
                    screenshotPath: observation.screenshotPath,
                    pressables: observation.pressables
                  })
                }
              })
            } finally {
              navigationSession.dispose()
              // The walk is over, however it ended. Leaving the cursor in place would let the next
              // confirmation from anywhere else in the sweep read the screen this walk stopped on as
              // its own starting point and mint an edge across a relaunch that never happened.
              walkCursor = null
            }
            if (!exploration.arrived) {
              seededWalkRan = true
              reachError = exploration.reason
              console.log(`[app-flow] ${node.id} exploration stopped — ${exploration.reason}`)
              return false
            }

            // The whole publish-and-verify tail used to live here: pick a portable destination
            // guard, `saveAndReplayRecording` the candidate, survive its failure, rename the
            // candidate over the published `.ad`. Every line of it was in service of the recording,
            // and on the measured sweep every single exploration-based capture failed somewhere in
            // it — four walks, two distinct causes — so the arrival was kept and the script was
            // lost anyway. What is stored instead is the walk itself.
            //
            // Nothing here can fail in a way that costs the arrival: `walkLines` was assembled as
            // the walk went, and a walk whose steps had no faithful CLI form simply stores no path
            // (`walkCommands`'s all-or-nothing rule) while keeping the screen reached, exactly as
            // the missing-landmark case used to.
            if (!walkLines) {
              console.log(
                `[app-flow] ${node.id} arrival preserved without a stored path — a walked step had no faithful agent-device form`
              )
              return true
            }
            // Minimized before it is stored, never while it is being walked: `act` records what
            // the device did, and the walk's own history is what the planner reasons over. The
            // trim applies to this walk's lines only — `prefix` is either a baseline launch or a
            // parent's already-stored journey, neither of which this walk is entitled to rewrite
            // (see `minimizeWalkCommands`).
            const minimized = minimizeWalkCommands(walkLines)
            pathCommands = [...prefix, ...minimized.commands]
            const contentSelectors = contentMatchedSelectors(pathCommands)
            console.log(
              `[app-flow] ${node.id} stored a ${pathCommands.length}-command path${
                commandSeed ? ` seeded from ${commandSeed.id}` : ''
              }${
                minimized.removed.length
                  ? ` (minimized: dropped ${minimized.removed.length} — ${minimized.removed
                      .map((entry) => `${entry.rule}: ${entry.command}`)
                      .join('; ')})`
                  : ''
              }${
                contentSelectors.length
                  ? ` — matches on rendered content, may not replay elsewhere: ${contentSelectors.join(', ')}`
                  : ''
              }`
            )
            return true
          } catch (error) {
            checkSignal(signal)
            reachError = `Interactive exploration failed: ${error instanceof Error ? error.message : String(error)}`
            // Every other exit from `exploreFrom` logs a line naming the node and the reason
            // (the `!exploration.arrived` branch above, the explicit `reachError` assignments),
            // so a candidate discarded here for an uncaught error was the one silent path — the
            // device run this fix responds to jumped straight from the arrival judge's verdict to
            // the next node with nothing in between to explain why the screen was lost.
            console.log(`[app-flow] ${node.id} exploration failed — ${reachError}`)
            return false
          }
        }

        // Effect folding — plan landing-order item 4. Reach strategies
        // (`reach/strategies/`) are pure: they read `ports` and return a `ReachAttempt`, never
        // reaching into this closure's state themselves. This is the one place their `effects`
        // turn into the sweep-level state `trySavedReplay`/`tryDeepLink` used to mutate directly —
        // see `reach/types.ts`'s doc comment on `ReachEffect` for why each kind exists.
        const scratchPath = (key: string): string => getScratchPath(projectId, key)
        const applyReachEffects = (effects: ReachAttempt['effects']): void => {
          for (const effect of effects) {
            switch (effect.kind) {
              case 'deep-link-opened':
                openedByNode[effect.nodeId] = effect.opened
                // Every URL the app really opened is a complete, co-occurring param set for
                // whichever route it matches — the cleanest record there is, and it may belong to a
                // different route than the one being reached.
                paramStore.ingestUrl(effect.opened.url, effect.nodeId, nodesWithSlug)
                break
              case 'deep-link-rejection-recorded':
                deepLinkRejections[effect.nodeId] = effect.rejection
                console.log(
                  `[app-flow] ${effect.nodeId} recording deep-link rejection so later sweeps skip ${effect.rejection.url}`
                )
                break
              case 'deep-link-rejection-cleared':
                deepLinkRejections[effect.nodeId] = null
                console.log(
                  `[app-flow] ${effect.nodeId} deep link succeeded — clearing stored rejection`
                )
                break
              case 'deep-link-memo-rejected':
                rejectedDeepLinkUrls.reject(effect.url)
                break
              case 'guard-gate-closed':
                closedGuardGates.close(effect.condition)
                break
              case 'deep-link-not-found':
                deepLinkNotFound = true
                break
              case 'deep-link-breaker-success':
                deepLinkBreaker = registerDeepLinkSuccess(deepLinkBreaker)
                break
              case 'deep-link-breaker-failure':
                deepLinkBreaker = registerDeepLinkFailure(
                  deepLinkBreaker,
                  Boolean(probeRoute)
                ).state
                break
              case 'deep-link-breaker-disabled':
                deepLinkBreaker = { ...deepLinkBreaker, enabled: false }
                break
              case 'deep-link-partial-landed':
                // Consumed synchronously by the deep-link rung below, in the same call that
                // produced it — see that rung's own comment for why this cannot wait for a later
                // strategy to read it back out of `effects`.
                break
            }
          }
        }

        /**
         * Claims the reach the one-time deep-link probe already performed and verified, instead of
         * performing the identical one again — see `probeCredit`.
         *
         * Reports itself as `'deep-link'` rather than inventing a strategy name, because that is
         * honestly how the app got here: the probe opened this node's URL and a judge confirmed
         * the frame. Every downstream consumer (`captureMethod`, `node.reach`, `decideDelivery`)
         * is then looking at the same evidence it would have had, from the same transport, and
         * none of them needs to learn a new case. The effects match the deep-link strategy's own
         * success path for the same reason.
         *
         * `touchedDevice: false` is the one place it differs, and it is accurate: this rung makes
         * no device call at all. That is the entire point — the device is already on the screen.
         */
        const probeCreditRung: ReachStrategy<null> = async () => {
          const credit = claimProbeCredit(node.id)
          if (!credit) {
            return {
              strategy: 'deep-link',
              ok: false,
              reason: 'No verified probe reach is available for this node.',
              touchedDevice: false,
              elapsedMs: 0,
              effects: []
            }
          }
          const effects: ReachEffect[] = [{ kind: 'deep-link-breaker-success' }]
          if (credit.opened) {
            effects.push({ kind: 'deep-link-opened', nodeId: node.id, opened: credit.opened })
          }
          applyReachEffects(effects)
          console.log(
            `[app-flow] reach ${node.id} — reusing the deep-link probe's verified arrival, no second navigation`
          )
          return {
            strategy: 'deep-link',
            ok: true,
            reason: credit.arrival.reason,
            touchedDevice: false,
            arrival: credit.arrival,
            evidence: {
              arrival: credit.arrival,
              frame: credit.frame,
              pressables: credit.pressables,
              replayScript: null,
              replayVerified: false
            },
            elapsedMs: 0,
            effects
          }
        }

        const savedReplayRung: ReachStrategy<null> = (_input, p) =>
          savedReplayStrategy(
            {
              node,
              scriptPath: savedScript,
              budget,
              remaining: sweepQueue.remaining,
              scratchPath,
              signal
            },
            p
          )

        // `tryDeepLink`'s pure open-verify-record-rejection sequence, moved to
        // `reach/strategies/deep-link.ts`. One entanglement stays here rather than in that module:
        // a param-free prefix landing on a real screen (Step 3f) used to call `exploreFrom` for a
        // bounded last hop *from inside* `tryDeepLink`, and a successful hop was recorded as method
        // `'deep-link'` (so `node.reach` becomes `'deep-link'`, not `'navigation-only'`) — not as an
        // exploration success. `exploreFrom` has not moved out of this file yet (landing-order item
        // 5), so the pure strategy cannot call it without reaching back into this closure; instead
        // it reports the landing as a `deep-link-partial-landed` effect and this wrapper — still
        // "exploreFrom, wrapped as a strategy" per the plan — performs the same bounded hop the
        // closure used to, preserving the exact method/reach classification.
        /** The controls last read off this build's own not-found route, when anything captured it. */
        const capturedFallbackPressables = (): AppFlowPressable[] | null => {
          for (const candidate of nodesWithSlug) {
            if (!isFallbackRoute(candidate)) continue
            const captured = captureMap[candidate.id]?.pressables
            if (captured?.length) return captured
          }
          return null
        }

        const deepLinkRung: ReachStrategy<null> = async (_input, p) => {
          const attempt = await deepLinkStrategy(
            {
              node,
              unresolvedParams,
              params,
              budget,
              scratchPath,
              signal,
              breaker: deepLinkBreaker,
              storedRejection: deepLinkRejections[node.id],
              memoRejected: (url) => rejectedDeepLinkUrls.wasRejected(url),
              guardGateClosed: (condition) => closedGuardGates.wasClosed(condition),
              nodesForAncestry: nodesWithSlug.map((candidate) => ({
                id: candidate.id,
                urlPath: candidate.urlPath,
                capturedStatus: captureMap[candidate.id]?.status ?? null
              })),
              reprobe: reprobeDeepLinkRoute,
              arrivalJudge: deepLinkArrivalJudge,
              // Only assembled when it will be read. The build's own fallback route is the one
              // build-specific signature the judge-free check has; `isFallbackRoute` is the same
              // predicate the sweep order and this loop's own fallback handling use, so the three
              // cannot disagree about which route that is. Usually null on a first sweep (fallback
              // routes sort last) and populated on a resumed one, where the capture is read back
              // off the document — see `detectNotFoundScreen`'s rule 1.
              notFoundEvidence: deepLinkArrivalJudge
                ? undefined
                : { fallbackPressables: capturedFallbackPressables() }
            },
            p
          )
          applyReachEffects(attempt.effects)
          if (attempt.ok || attempt.failure) return attempt

          const partial = attempt.effects.find(
            (effect) => effect.kind === 'deep-link-partial-landed'
          )
          if (!partial || partial.kind !== 'deep-link-partial-landed') return attempt
          console.log(
            `[app-flow] ${node.id} prefix ${partial.seed.urlPath} landed on a real screen — attempting a bounded last hop for the remaining segment`
          )
          if (
            await exploreFrom(
              { id: partial.seed.id, urlPath: partial.seed.urlPath, url: partial.seed.url },
              { bounded: true }
            )
          ) {
            openedByNode[node.id] = { app: partial.seed.app, url: partial.seed.url }
            paramStore.ingestUrl(partial.seed.url, node.id, nodesWithSlug)
            deepLinkBreaker = registerDeepLinkSuccess(deepLinkBreaker)
            if (deepLinkRejections[node.id]) {
              deepLinkRejections[node.id] = null
              console.log(
                `[app-flow] ${node.id} bounded last hop succeeded — clearing stored rejection`
              )
            }
            return {
              ...attempt,
              ok: true,
              reason: 'Bounded last hop from the partial prefix reached the target.',
              arrival: acceptedArrival,
              evidence: {
                arrival: acceptedArrival,
                pathCommands,
                replayScript,
                replayVerified: replayScriptVerified
              }
            }
          }
          if (authStopped) return { ...attempt, failure: 'auth-stopped' }
          if (!budget.expired) {
            console.log(
              `[app-flow] ${node.id} bounded last hop from ${partial.seed.urlPath} did not reach — falling back to full exploration — ${reachError}`
            )
          }
          return attempt
        }

        // `runVerifiedReach`'s old `explore` step, unchanged: `findSeedSource` (plan Step 3e) picks
        // the best proof this sweep has that some other screen leads here, and `exploreFrom` itself
        // has not moved out of this file yet (landing-order item 5) — this is exactly "exploreFrom,
        // wrapped as a strategy" per the plan for this step.
        const exploreRung: ReachStrategy<null> = async () => {
          const runExplore = async (): Promise<boolean> => {
            const seed = findSeedSource({
              urlPath: node.urlPath,
              targetId: node.id,
              nodes: nodesWithSlug,
              edges: parsed.edges,
              // Any journey this sweep has stored, not only one a *previous* sweep re-verified.
              // The old test was `capture.replayScript`, and before that `replayVerified` — which
              // could only ever be set by a previous sweep's saved replay, so seeding never fired
              // within one run and every walk re-walked the hops its own parent had just walked.
              //
              // `pathCommands` is the honest test now, and strictly better than the script ever
              // was: it is set by exactly the walks that arrived, it stands alone (its first line
              // is its own launch), and running it needs no file on disk. A capture carried
              // forward from a previous sweep brings its own along, so a resumed run seeds from it
              // too.
              storedPath: (id) => captureMap[id]?.pathCommands ?? null,
              deepLinkedThisRun: (id) => openedByNode[id]?.url ?? null
            })

            if (seed?.kind === 'path') {
              console.log(
                `[app-flow] ${node.id} bounded last hop from ${seed.id}'s stored path${seed.trigger ? ` — tap ${seed.trigger.by}=${JSON.stringify(seed.trigger.value)}` : ''}`
              )
              if (
                await exploreFrom(
                  { id: seed.id, commands: seed.commands, trigger: seed.trigger },
                  { bounded: true }
                )
              ) {
                return true
              }
              if (authStopped || budget.expired) return false
              if (!seedBaseFailed) {
                // The parent's own proof held — its script really did keep an active session — and
                // the bounded loop still ran out its three decisions without arriving. That is not
                // "approached badly", it is the seed's own evidence that this target is not one tap
                // from there, so a full unseeded walk is not worth its five-minute price here; the
                // node records unreached with the bounded loop's own reason instead.
                return false
              }
              console.log(
                `[app-flow] ${node.id} seed's stored path failed — falling back to full exploration — ${reachError}`
              )
            } else if (seed?.kind === 'deep-link') {
              console.log(`[app-flow] ${node.id} explore seeded at ${seed.urlPath} — ${seed.url}`)
              if (await exploreFrom({ id: seed.id, urlPath: seed.urlPath, url: seed.url }))
                return true
              if (authStopped || budget.expired || unavailableReason) return false
              if (!shouldRetryFromEntry({ walkRan: seededWalkRan, reason: reachError })) {
                console.log(
                  `[app-flow] ${node.id} seeded exploration ran its decisions without arriving — not retrying from the app entry, it would have nothing new to try — ${reachError}`
                )
                return false
              }
              console.log(
                `[app-flow] ${node.id} seeded exploration failed, retrying from the app entry — ${reachError}`
              )
            }
            return exploreFrom(null)
          }

          const exploreStartedAt = Date.now()
          const ok = await runExplore()
          return {
            strategy: 'entry-exploration',
            ok,
            failure: !ok && authStopped ? 'auth-stopped' : undefined,
            reason: ok
              ? (acceptedArrival?.reason ?? 'Exploration arrived.')
              : (reachError ?? 'Exploration failed.'),
            touchedDevice: true,
            arrival: acceptedArrival,
            evidence: ok
              ? {
                  arrival: acceptedArrival,
                  // Always null since verification moved to first use: nothing on the exploration
                  // path takes a post-replay frame any more, so delivery takes its own frame and
                  // read — the fallback this field always had.
                  frame: null,
                  pressables: null,
                  pathCommands,
                  replayScript,
                  replayVerified: replayScriptVerified
                }
              : undefined,
            // Measured rather than the 0 this used to report: the `reach <strategy> <verdict>
            // (<ms>)` line reads this field, and the most expensive rung in the ladder logged as
            // free.
            elapsedMs: Date.now() - exploreStartedAt,
            effects: []
          }
        }

        /**
         * Navigate through the app's own navigator, for screens a URL cannot address.
         *
         * It reuses `params`/`unresolvedParams` exactly as the deep-link rung does, so a route
         * whose values the store could not fill is skipped here too rather than dispatched with a
         * hole in it. Arrival stays the judge's call; see `reach/strategies/render.ts`.
         */
        const renderRung: ReachStrategy<null> = async (_input, p) => {
          const attempt = await renderStrategy(
            {
              node,
              params,
              unresolvedParams,
              budget,
              scratchPath,
              guardGateClosed: (condition) => closedGuardGates.wasClosed(condition)
            },
            p
          )
          applyReachEffects(attempt.effects)
          return attempt
        }

        const outcome = await runReachLadder({
          input: null,
          ports,
          budget,
          signal,
          // `probeCreditRung` first: it is the only rung that can succeed without touching the
          // device at all, and when it has nothing to claim it falls through for free. Ahead of
          // the saved replay because a replay would move the app off the very screen the credit
          // is a statement about.
          // `renderRung` between the deep link and exploration: a deep link is the more faithful
          // journey and produces a reusable replay, so it keeps priority, but a navigator
          // dispatch is far cheaper and far more predictable than asking a model to find the
          // screen. See `reach/strategies/render.ts`.
          //
          // Which of the last two rungs are present is the user's choice — see `strategiesFor`.
          strategies: strategiesFor(options.explorationMode, {
            probeCredit: probeCreditRung,
            savedReplay: savedReplayRung,
            deepLink: deepLinkRung,
            render: renderRung,
            explore: exploreRung
          })
        })

        // Every rung the ladder tried, in order — the decline reasons that used to be dropped on
        // the floor here. `touchedDevice` is the distinction that matters when reading a sweep
        // back: `declined` short-circuited before any device call (an unresolved param, a tripped
        // breaker, a cached rejection) and cost nothing, while `failed` actually ran and did not
        // land. A rung that never fires and a rung that fires and misses need opposite fixes, and
        // without this line the two are indistinguishable in the log — which is how a sweep came
        // back showing 2 renders out of 42 screens with no record of why the other 40 skipped it.
        //
        // The winner is logged too, in the same `reach <strategy> <verdict> (<ms>)` shape, because a
        // ladder that only narrates its misses leaves the rung that *worked* to be inferred from a
        // separate `verify … via <suffix>` line — and the suffix names a diagnostic frame, not a
        // rung. Its reason is left off: for a winner that is the arrival judge's description of the
        // frame, which can quote whatever the screen shows (a handle, a record name), and the
        // `verify` line already carries it.
        for (const attempt of outcome.attempts) {
          if (attempt.ok) {
            console.log(
              `[app-flow] ${node.id} reach ${attempt.strategy} succeeded (${attempt.elapsedMs}ms)`
            )
            continue
          }
          const how = attempt.touchedDevice ? 'failed' : 'declined'
          console.log(
            `[app-flow] ${node.id} reach ${attempt.strategy} ${how} (${attempt.elapsedMs}ms) — ${attempt.reason}`
          )
        }

        // What the ten mutable variables (`openedByNode`, `consecutiveDeepLinkFailures`,
        // `deepLinkEnabled`, `authStopped`, `deepLinkNotFound`, `unavailableReason`,
        // `deepLinkAttempted`, `reachError`, `acceptedArrival`, `replayScript`) used to be set to,
        // directly, by whichever closure happened to succeed — now derived in one place from the
        // ladder's own `outcome`.
        if (outcome.status === 'reached') {
          const winner = outcome.attempts[outcome.attempts.length - 1]
          captureMethod =
            winner.strategy === 'deep-link'
              ? 'deep-link'
              : winner.strategy === 'saved-replay'
                ? 'saved-replay'
                : winner.strategy === 'render'
                  ? 'rendered'
                  : 'agent-navigation'
          if (winner.evidence) {
            acceptedArrival = winner.evidence.arrival
            pathCommands = winner.evidence.pathCommands ?? pathCommands
            replayScript = winner.evidence.replayScript
            replayScriptVerified = winner.evidence.replayVerified
            verifiedFrame = winner.evidence.frame ?? null
            verifiedPressables = winner.evidence.pressables ?? null
          } else if (winner.arrival) {
            acceptedArrival = winner.arrival
          }
        } else if (outcome.status === 'unavailable') {
          unavailableReason = outcome.reason
        } else if (outcome.status === 'stopped') {
          if (outcome.reason === 'auth') authStopped = true
          // A 'cancelled' stop only happens when `signal` was already aborted between rungs; every
          // other cancellation path still throws directly (`checkSignal` inside a strategy). Doing
          // the same here — rather than treating this as an ordinary "give up on this node" outcome
          // — keeps a cancelled build behaving exactly as it did before this extraction: it unwinds
          // out of `buildAppFlow` entirely instead of moving on to record this node as unreached.
          else checkSignal(signal)
        } else {
          reachError = outcome.reason
        }
        const deepLinkAttempted = outcome.attempts.some(
          (attempt) => attempt.strategy === 'deep-link' && attempt.touchedDevice
        )

        if (authStopped) sweepStopped = true

        if (sweepStopped) break

        // A harvested value can name a record the app no longer has, or one that is valid for the
        // route that owns it and not for a sibling that borrowed it. This runs whatever the node
        // ended up as: exploration frequently rescues a node whose deep link or render just failed
        // on a bad value, and withdrawing the value only on an unreached verdict left every other
        // borrower to pay for the same failure.
        if (!unavailableReason)
          demoteFailedHarvest(paramStore, node.id, resolution, outcome.attempts)

        if (captureMethod === 'unreached') {
          if (unavailableReason) {
            await recordUnreached(node, 'unavailable', unavailableReason)
            emit(projectId, onEvent, {
              type: 'step',
              phase: 'capture',
              message: `${label} is not available in this build`,
              completed: sweepQueue.completed + 1,
              total,
              captured: explorationControl.screensExplored,
              captureLimit: options.screenLimit
            })
            if (finishExploredScreen(false)) break
            // A screen this build withholds is a verdict, not a stuck app, so it must not feed the
            // no-progress counter that decides the sweep is blocked and asks the user for help.
            continue
          }
          await recordUnreached(node, 'missing', reachError)
          if (finishExploredScreen(false)) break
          // A planner that ran out of time left the app wherever the last action put it, which says
          // nothing about the app being stuck — and sibling screens look so alike that counting
          // these would stop the sweep to ask the user to clear a blocker that is not there.
          if (isToolingFailure(reachError)) continue
          const current = fingerprint(await capturePressables(ctx, device).catch(() => []))
          const overlap = failedReference ? similarity(current, failedReference) : 0
          if (failedReference && overlap >= ARRIVAL_SIMILARITY) blockedRun += 1
          else {
            failedReference = current
            blockedRun = 1
          }
          if (blockedRun >= BLOCKED_RUN_LIMIT) {
            const resolution = await resolveBlocked(sweepQueue.remaining - 1)
            // The retry is for a *stuck app* — the blocker cleared, so the walk that failed against
            // it deserves another run. It is not for a node the planner reasoned its way out of:
            // `ModerationInboxReportDetails` concluded "no safe action reaches the target", the
            // relaunch cleared the unrelated blocked-run counter, and the node was walked a second
            // time to reach the same conclusion for a second full planner price. One retry per node
            // keeps the recovery the breaker exists for and drops the repeat.
            if (resolution === 'continue') {
              if (requeuedIds.has(node.id)) {
                console.log(
                  `[app-flow] ${node.id} — not retrying a second time; this run already reached the same verdict once`
                )
                continue
              }
              requeuedIds.add(node.id)
              sweepQueue.requeueCurrent()
              continue
            }
            sweepStopped = true
            break
          }
          continue
        }

        // The static parse only ever guesses `reach` — this is where the device settles it. A
        // deep link that actually matched proves the route routes; landing here instead via
        // exploration or a saved replay, after a deep link was attempted and failed, proves the
        // opposite. Anything not covered by either (no urlPath, deep link never attempted this
        // node) keeps the parser's guess rather than being overwritten on no evidence.
        if (captureMethod === 'deep-link') {
          node.reach = 'deep-link'
        } else if (
          (captureMethod === 'agent-navigation' || captureMethod === 'saved-replay') &&
          deepLinkAttempted
        ) {
          node.reach = 'navigation-only'
        }

        emit(projectId, onEvent, {
          type: 'step',
          phase: 'capture',
          message: `Capturing ${label}`,
          completed: sweepQueue.completed + 1,
          total,
          captured: explorationControl.screensExplored,
          captureLimit: options.screenLimit
        })

        // The screen is reached and verified by this point, so a failing device command here costs
        // this one screen's detail — never the sweep. Losing the remaining screens to a transient
        // runner fault (a watchdogged accessibility capture is the common one) would throw away
        // every capture still ahead of it. See `decideDelivery` (reach/delivery.ts): a verified
        // arrival or a published replay must survive a screenshot failure here, not be discarded.
        const screenshotPath = getScreenshotPath(projectId, node.slug)
        console.log(
          `[app-flow] capture ${sweepQueue.completed + 1}/${total} screenshot ${node.urlPath}`
        )
        // Captured to scratch first, never straight to the node's slug: on the missing-session
        // recovery branch the frame is the launch screen (`relaunched: true`), and writing that
        // under this node's filename would silently corrupt an existing good screenshot even
        // though the delivery record below correctly declines to treat it as reached evidence.
        const deliveryShot = getScratchPath(projectId, 'delivery')
        const relativePath = `screens/${node.slug}.png`
        // Either the frame the judge already accepted, or the one taken just below. Both are this
        // reach's own look at the screen, which is what `chooseDeliverySources` means by 'live';
        // the difference is only whether a second screenshot had to be spent to get one.
        const liveFrame = verifiedFrame ?? deliveryShot
        let liveScreenshot: DeliveryScreenshotOutcome
        if (verifiedFrame) {
          // A strategy that reports `evidence.frame` reached this screen and then stopped touching
          // the device, so the frame the judge accepted is still what the screen shows — only the
          // judge call itself sits between the two moments. Taking a second screenshot of it cost a
          // measured ~0.6s per screen to produce a near-identical image, and the one delivered was
          // the one *nothing* had verified. A `relaunched` frame cannot arrive here: it is turned
          // into an automatic mismatch inside `verifyWithDiagnostic`, so no reach that reports a
          // frame ever succeeded on one.
          console.log(`[app-flow] ${node.id} delivering the frame the arrival judge verified`)
          liveScreenshot = { ok: true, relativePath }
        } else {
          try {
            const { relaunched } = await ports.device.captureScreenshot(deliveryShot)
            liveScreenshot = relaunched
              ? { ok: false, reason: 'session was lost; the app was relaunched at its launch URL' }
              : { ok: true, relativePath }
          } catch (error) {
            checkSignal(signal)
            const detail = error instanceof Error ? error.message : String(error)
            console.log(`[app-flow] ${node.id} screenshot failed — ${detail}`)
            liveScreenshot = { ok: false, reason: `Screenshot failed: ${detail}` }
          }
        }

        console.log(
          `[app-flow] capture ${sweepQueue.completed + 1}/${total} pressables ${node.urlPath}`
        )
        let livePressables: AppFlowCapture['pressables'] = []
        let livePressablesError: string | null = null
        if (verifiedPressables) {
          // Read during the arrival judge's own latency rather than after it — see
          // `withPressables` in `verify-with-diagnostic.ts`. Still this reach's own read of this
          // screen, and taken at the same instant as the frame delivered above, so the two halves
          // of the record now describe one moment instead of two.
          livePressables = [...verifiedPressables]
        } else {
          try {
            livePressables = await ports.device.capturePressables()
          } catch (error) {
            checkSignal(signal)
            livePressablesError = error instanceof Error ? error.message : String(error)
            console.log(`[app-flow] ${node.id} pressables failed — ${livePressablesError}`)
          }
        }
        console.log(
          `[app-flow] capture ${sweepQueue.completed + 1}/${total} pressables found ${livePressables.length} ${node.urlPath}`
        )

        // Both halves of the record come from the same judgement about whether the live device is
        // still on this screen — see `chooseDeliverySources`. Note that the control read above runs
        // either way: it is the fresher source whenever it can be trusted, and finding that out
        // costs one device call that the screenshot has already established is safe to spend.
        const sources = chooseDeliverySources({
          liveScreenshot,
          livePressables,
          livePressablesError,
          arrivalFramePath: arrivalFrame,
          arrivalPressables
        })
        // This is where a captured screen's testIDs become openable URLs for *other* routes: a
        // `profileCard-alice.test-link` on this screen is the value `/profile/:name` could not get
        // from source text.
        paramStore.ingestPressables(node.id, sources.pressables.pressables, nodesWithSlug)
        await harvestNavState(node)
        let screenshotOutcome: DeliveryScreenshotOutcome
        if (sources.screenshot.source === 'none') {
          screenshotOutcome = { ok: false, reason: sources.screenshot.reason }
        } else {
          const frame =
            sources.screenshot.source === 'live' ? liveFrame : sources.screenshot.framePath
          try {
            await copyFile(frame, screenshotPath)
            screenshotOutcome = { ok: true, relativePath }
            if (sources.screenshot.source === 'arrival') {
              console.log(
                `[app-flow] ${node.id} delivered the verified arrival frame; the live device had moved on`
              )
            }
          } catch (error) {
            const detail = error instanceof Error ? error.message : String(error)
            console.log(`[app-flow] ${node.id} could not store the delivery frame — ${detail}`)
            screenshotOutcome = { ok: false, reason: `Screenshot unavailable: ${detail}` }
          }
        }
        if (sources.pressables.source === 'arrival') {
          console.log(
            `[app-flow] ${node.id} delivered the verified arrival's controls; the live read was taken after the device had moved on`
          )
        }

        const finalArrival = acceptedArrival as ArrivalResult | null
        if (finalArrival) {
          inferredScreens[node.id] = {
            key: finalArrival.key,
            info: finalArrival.info
          }
        }
        failedReference = null
        blockedRun = 0

        const evidence: ReachEvidence = {
          arrival: finalArrival,
          pathCommands,
          replayScript,
          replayVerified: replayScriptVerified
        }
        const delivery = decideDelivery({
          kind: 'attempt',
          evidence,
          screenshot: screenshotOutcome,
          pressables: sources.pressables.pressables,
          pressablesError: sources.pressables.error,
          pressablesSource: sources.pressables.source,
          captureMethod: captureMethod as NonNullable<AppFlowCapture['captureMethod']>,
          structureRevision
        })
        captureMap[node.id] = delivery.capture
        // A chrome edge is minted the moment the drawer or tab bar is *seen*, so it starts life
        // unverified and scriptless — `chromeEdges` has nothing better to record at that point.
        // Once this same destination is actually reached and a replay script published for it, the
        // edge's own claim has been proven by a walk, so upgrade it. This is what makes
        // `buildChromePathToReach`'s preferred `agent-device replay` form reachable at all: nothing
        // else in the sweep ever sets `evidence.replayScript`, and without this the chrome path
        // would forever fall back to replaying the reveal and item taps by selector.
        if (delivery.capture.replayVerified && delivery.capture.replayScript) {
          for (let at = 0; at < runtimeEdgesList.length; at++) {
            const edge = runtimeEdgesList[at]
            if (edge.to !== node.id || !edge.evidence) continue
            runtimeEdgesList[at] = {
              ...edge,
              evidence: {
                ...edge.evidence,
                verified: true,
                replayScript: delivery.capture.replayScript
              }
            }
          }
        }
        await persistCaptureUpdate()
        if (
          finishExploredScreen(delivery.kind === 'reached' && Boolean(delivery.capture.screenshot))
        )
          break
      }

      if (options.pauseRequested?.()) sweepPaused = true
      if (sweepStopped) {
        manifest.sweepStatus = sweepPaused ? 'paused' : 'stopped'
        // The capture map and the screens manifest are still published wholesale here — this path's
        // `persistCaptureUpdate` writes only the checkpoint and the throttled document, and the
        // flat maps are what a *later* tool read (not the renderer) consumes. The document itself
        // is built by `currentFlowDocument`, shared with the live publisher and the finish path so
        // the graph never changes shape between an intermediate publish and the terminal one.
        await writeCaptureStatus(projectId, captureMap)
        const stoppedScreens = currentAgentDeviceScreens()
        await writeAgentDeviceScreens(projectId, stoppedScreens)
        const stoppedResult = currentFlowDocument(stoppedScreens)
        await finishManifest(manifest)
        await writeAppFlow(projectId, stoppedResult)
        // Persisted once per sweep rather than per screen: the store only matters to the *next*
        // run, and `persistCheckpoint` already writes on every screen.
        await writeParamStore(projectId, paramStore.toJSON()).catch(() => undefined)
        emit(projectId, onEvent, {
          type: 'complete',
          phase: 'render',
          message: sweepPaused
            ? 'Screen sweep paused at a checkpoint; partial results were preserved.'
            : 'Screen sweep stopped; partial results were preserved.'
        })
        // A paused sweep is a *completed* run of a bounded sweep, not a degenerate one: hitting the
        // screen limit is the ordinary outcome of `screenLimit`, and this is the exit it takes. It
        // was nonetheless the one exit with no closing summary, so the runs whose cost you most
        // want to read — the ones that stopped because they ran out of budget — were the runs that
        // reported nothing, and a seven-minute sweep's breakdown had to be reconstructed by hand
        // from the per-call lines.
        logAgentTokenSummary(tallies, tokens, hedges)
        logPhaseSummary(timing)
        return { ok: true, projectId, result: stoppedResult }
      }

      await writeCaptureStatus(projectId, captureMap)

      const agentDeviceScreens = buildAgentDeviceScreens(
        [...nodesWithSlug, ...runtimeNodes],
        parsed.edges,
        runtimeEdgesList,
        chromeInventory,
        ctx,
        device,
        openedByNode,
        inferredScreens,
        captureMap
      )
      await writeAgentDeviceScreens(projectId, agentDeviceScreens)
      console.log(
        `[app-flow] wrote agent-device screens — ${Object.keys(agentDeviceScreens).length} entries`
      )

      checkSignal(signal)
      emit(projectId, onEvent, {
        type: 'phase',
        phase: 'states',
        message: 'Exploring state variants...'
      })

      const hintedNodes = nodesWithSlug.filter((n) => n.stateHints.length > 0)
      console.log(`[app-flow] states start — ${hintedNodes.length} hinted routes`)
      for (let i = 0; i < hintedNodes.length; i++) {
        checkSignal(signal)
        if (options.pauseRequested?.()) {
          sweepPaused = true
          sweepStopped = true
          break
        }
        const node = hintedNodes[i]
        emit(projectId, onEvent, {
          type: 'step',
          phase: 'states',
          message: `Exploring states for ${node.urlPath}`,
          completed: i + 1,
          total: hintedNodes.length
        })

        if (statesDone.has(node.id)) continue
        const baseCapture = captureMap[node.id]
        if (!baseCapture?.screenshot) continue
        const stateBudget = new ActiveTimeBudget(5 * 60_000, activeNow(), activeNow)
        const verifiedDeepLink = openedByNode[node.id]

        /**
         * Put the device back on `node` so a state variant can be triggered from it. Returns
         * whether the frame that follows is worth judging at all.
         */
        const establishBase = async (): Promise<boolean> => {
          // The base screen's own stored journey, run line by line, in place of the
          // `replay.run(baseCapture.replayScript)` this used to do. `runPathToReach` carries the
          // readiness wait that call site had to add by hand — a session stays "active" while
          // sitting on the dev-client launcher just as readily as while sitting on `node`, which
          // is exactly how this pass once ended up screenshotting the launcher and calling it
          // every hinted route — and it works for a screen reached by exploration, which a
          // `.ad`-only base never did.
          if (baseCapture.pathCommands?.length) {
            try {
              await runPathToReach(ctx, device, baseCapture.pathCommands)
              return true
            } catch (error) {
              console.warn(`[app-flow] state base path for ${node.id} failed:`, error)
              return false
            }
          }
          if (!verifiedDeepLink) return false
          // `pickSampleParams`' `1` stand-in is for the descriptive path in the agent-device
          // manifest and has no business building a URL that will be opened and photographed. The
          // node reached its base capture by deep link, so a value exists; bailing rather than
          // inventing one is what keeps that true if it ever stops being.
          const stateParams = resolveNodeParams(node, parsed.edges, paramStore)
          if (stateParams.unresolved.length) return false
          const reopened = await openDeepLink(ctx, device, node, stateParams.values)
          // `settleAfterRoute`, not the bare `waitForRoute` that used to be here. That was a flat
          // 2.5s sleep, which is only ever right when the app is already on screen and settled —
          // and by the time this phase starts, nothing guarantees it is. The main capture loop
          // switched to `settleAfterRoute` for exactly this reason; this pass was left behind, so
          // it fired every deep link into whatever the sweep happened to leave behind and judged
          // the frame 2.5 seconds later regardless.
          // `settleAfterRoute` returns `waitForAppReady`'s own verdict, not just a delay — false
          // when launcher recoveries are exhausted or the app never settled at all. The deep-link
          // probe above (`probeDeepLinkRoute`) already treats a mismatch on an unsettled frame as
          // "inconclusive, not evidence about the scheme" rather than a real mismatch; discarding
          // the verdict here made the same mistake in the opposite direction, calling the URL
          // delivered and the base established just because `reopened.url` matched, with nothing
          // checking that the app was actually there to receive it and land on that URL.
          const settled = await settleAfterRoute(ctx, device, signal)
          return settled && reopened.url === verifiedDeepLink.url
        }

        // Read by the arrival verifier and the trigger planner, then discarded: the delivered
        // artefact of this phase is the state variant capture written further down.
        const screenshotPath = getScratchPath(projectId, 'state-start')

        /**
         * Two attempts, with a relaunch between them, because "the deep link opened the wrong
         * screen" and "the app is not running" are indistinguishable from here and only the first
         * is a reason to give up on this route.
         *
         * A dev client that is not running shows its launcher — a settled, fully interactive
         * screen — so neither `settleAfterRoute` nor `isLoadingScreen` can tell it apart from a
         * real one, and a deep link into it does nothing. The old code read that as a plain
         * mismatch and skipped, which meant one stalled app silently cost *every* remaining
         * hinted route its deep link, its auth-gate call, its screenshot and its arrival call,
         * all to reach the same `continue`. Relaunching is the same recovery the capture loop
         * already performs on a lost session, and it is what a human does by hand when they open
         * the app from that launcher screen and watch the rest of the pass start working.
         */
        let baseReady = false
        let baseAuth: 'clear' | 'stop' | 'exhausted' = 'clear'

        // Pulled out of the retry loop below so the launcher-escalation branch that follows it can
        // ask for exactly one more attempt after the user clears a stuck launcher, instead of
        // re-running the whole two-attempt relaunch cycle (which would relaunch an app the user
        // just finished opening by hand).
        const attemptEstablishAndVerify = async (): Promise<boolean> => {
          if (!(await establishBase())) return false
          baseAuth = await checkAuthGate(hintedNodes.length - i, stateBudget)
          if (baseAuth !== 'clear') return false
          await captureScreenshot(ctx, device, screenshotPath)
          const baseArrival = await verifyCurrentTarget(node, screenshotPath, stateBudget)
          if (baseArrival.verdict === 'match') return true
          console.log(`[app-flow] states ${node.id} base mismatch — ${baseArrival.reason}`)
          return false
        }

        for (let attempt = 0; attempt < 2 && !stateBudget.expired; attempt++) {
          if (attempt > 0) {
            console.log(`[app-flow] states ${node.id} — base not reached, relaunching and retrying`)
            await reopenBoundApp(ctx, device)
          }
          if (await attemptEstablishAndVerify()) {
            baseReady = true
            break
          }
          if (baseAuth !== 'clear') break
        }

        // The two attempts above cover a lost session and a wrong-screen deep link, but neither
        // recovers a dev-client launcher: relaunching the bound app *while it is showing the
        // launcher* just puts the launcher back, and `establishBase`/`waitForAppReady` already
        // tried the reconnect-then-relaunch sequence internally before giving up. The main capture
        // loop survives exactly this condition because it has `explore()`'s LLM rung and
        // `resolveBlocked`'s user prompt; this pass had neither, which is why it silently walked
        // the launcher and reported `base mismatch` for every hinted route behind it instead of
        // telling anyone. `promptToUnblock` (the capture loop's own escalation, factored out above)
        // is reused rather than duplicated, since `kind: 'blocked'` is documented as being named for
        // what was observed rather than for what the screen is.
        if (
          !baseReady &&
          baseAuth === 'clear' &&
          !stateBudget.expired &&
          (await isOnDevClientLauncher(ctx, device))
        ) {
          const resolution = await promptToUnblock(
            "The app is showing the dev client's launcher instead of running, so nothing behind " +
              'it can be captured. Open the app from the launcher in the simulator, then continue.',
            hintedNodes.length - i
          )
          if (resolution === 'stop') {
            baseAuth = 'stop'
          } else if (resolution === 'continue') {
            console.log(
              `[app-flow] states ${node.id} — launcher cleared by the user, retrying base`
            )
            if (await attemptEstablishAndVerify()) baseReady = true
          }
        }

        if (baseAuth === 'stop') {
          sweepStopped = true
          break
        }
        if (!baseReady) continue
        const fileContent = node.file ? `\nSource file:\n${node.file}` : ''
        const { text } = await runAgent(
          {
            cwd: projectPath,
            systemPrompt: STATE_TRIGGER_SYSTEM_PROMPT,
            userPrompt: `Route: ${node.id}\nURL path: ${node.urlPath}\nState hints: ${JSON.stringify(node.stateHints)}${fileContent}\n\nSuggest how to reveal the state variant.`,
            // No tools, for the same reason as the navigator above: this decides from a screenshot
            // and the hints it is given, and the source path in the prompt is a label, not a task.
            tools: [],
            // `low` rather than the judges' `off`: this one plans an action sequence to reveal a
            // state variant instead of classifying what is already on screen, which is the kind of
            // question the navigator gets and is held to the same level.
            thinkingLevel: 'low',
            imagePath: screenshotPath,
            timeoutMs: 30_000
          },
          `state-trigger ${node.id}`
        )

        const plan = parseSubAgentJson<{
          actions: Array<{
            type: 'tap' | 'swipe' | 'input' | 'wait'
            locator?: { by: 'text' | 'label' | 'id'; value: string }
            value?: string
            direction?: 'up' | 'down' | 'left' | 'right'
            duration?: number
          }>
          stateName: string
          destinationLocator: { by: 'text' | 'label' | 'id'; value: string }
          note: string | null
        }>(text)

        if (plan?.actions.length) {
          const stateSlug = generateStateSlug(node.slug, plan.stateName)
          const stateScreenshot = getScreenshotPath(projectId, stateSlug)
          // The variant's journey is the base screen's, plus the lines for the actions that open
          // it — the same composition `exploreFrom` performs for a seeded walk, and the reason
          // this pass no longer needs `recordStateFromReplay`/`verifyAndSaveReplay` or the
          // `.ad` candidate those two wrote. Null when a planned action has no faithful CLI form,
          // in which case the variant is still captured, just without a stored path.
          //
          // Built before the actions run so the list describes what is about to be executed; it is
          // only stored once they all succeeded and the screenshot came back.
          //
          // Minimized on the same terms as a walk's own lines, and for the same reason: a state
          // plan that opens a menu and dismisses it again stores two commands whose only effect on
          // a replay is a race against the popover's animation. The base screen's path is left
          // alone — it was minimized when it was stored.
          const actionLines = walkCommands(plan.actions)
          const statePath =
            baseCapture.pathCommands?.length && actionLines?.length
              ? [...baseCapture.pathCommands, ...minimizeWalkCommands(actionLines).commands]
              : null
          try {
            await executeNavigationActions(ctx, device, plan.actions, stateBudget.remainingMs)
            await captureScreenshot(ctx, device, stateScreenshot)
          } catch (error) {
            console.warn(`[app-flow] state ${stateSlug} failed:`, error)
            if (sweepStopped) break
            continue
          }
          captureMap[node.id].states.push({
            name: plan.stateName,
            screenshot: `screens/${stateSlug}.png`,
            ...(statePath ? { pathCommands: statePath } : {})
          })
        }
        statesDone.add(node.id)
        await persistCheckpoint()
      }
      if (options.pauseRequested?.()) {
        sweepPaused = true
        sweepStopped = true
      }

      await writeCaptureStatus(projectId, captureMap)
      const finalScreens = currentAgentDeviceScreens()
      await writeAgentDeviceScreens(projectId, finalScreens)

      // Stamped from the same `currentFlowDocument` the live publisher used, so the terminal write
      // differs from the last intermediate only in freshness.
      const finalResult = currentFlowDocument(finalScreens)

      manifest.tokens = snapshotUsage(tokens)
      manifest.sweepStatus = sweepPaused ? 'paused' : sweepStopped ? 'stopped' : 'completed'
      await finishManifest(manifest)
      // A finished sweep has nothing left to resume: the next build starts clean. A stopped one
      // keeps its checkpoint so the user can pick up where they left off.
      if (!sweepStopped) await clearSweepProgress(projectId)

      await writeAppFlow(projectId, finalResult)
      await writeParamStore(projectId, paramStore.toJSON()).catch(() => undefined)
      const harvest = paramStore.summary()
      console.log(
        `[app-flow] params — harvested ${harvest.records} record(s) from ${harvest.templates} testID shape(s), ${harvest.learned} demonstrated`
      )

      checkSignal(signal)
      emit(projectId, onEvent, {
        type: 'complete',
        phase: 'render',
        message: sweepPaused
          ? 'Screen sweep paused at a checkpoint; partial results were preserved.'
          : sweepStopped
            ? 'Screen sweep stopped; partial results were preserved.'
            : 'Done.'
      })
      logAgentTokenSummary(tallies, tokens, hedges)
      logPhaseSummary(timing)
      console.log('[app-flow] done')

      return { ok: true, projectId, result: finalResult }
    } finally {
      await fastRuntime?.close().catch(() => undefined)
      // A device the user launched stays up so the next sweep can adopt it again.
      if (!reusedDevice) await closeDevice(device)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    let preserved: AppFlowResult | null = null
    if (activeManifest) {
      activeManifest.sweepStatus = message === 'Cancelled' ? 'stopped' : 'failed'
      // The tokens a cancelled sweep spent are just as real as a finished one's, and this is the
      // only place they are recorded: `manifest.tokens` is written on the success path alone, so a
      // cancel used to hand the renderer a manifest still carrying the *previous* run's total — or
      // none at all on a first build, which is why the usage chip vanished the moment you stopped a
      // sweep. The by-role breakdown is logged here for the same reason: a cancelled run is exactly
      // the one whose bill you want to read.
      activeManifest.tokens = snapshotUsage(tokens)
      logAgentTokenSummary(tallies, tokens, hedges)
      logPhaseSummary(timing)
      await finishManifest(activeManifest).catch(() => undefined)
      const existing = await readAppFlow(projectId).catch(() => null)
      if (existing) {
        preserved = { ...existing, manifest: activeManifest }
        await writeAppFlow(projectId, preserved).catch(() => undefined)
      }
    }
    if (message === 'Cancelled' && preserved) {
      emit(projectId, onEvent, {
        type: 'complete',
        phase: 'render',
        message: 'Screen sweep cancelled; partial results were preserved.'
      })
      return { ok: true, projectId, result: preserved }
    }
    console.error(`[app-flow] build failed: ${message}`)
    emit(projectId, onEvent, { type: 'error', phase: 'render', message })
    return { ok: false, error: message }
  }
}

/**
 * How long a prompt waits for the user before the build gives up on them and carries on marking
 * what it could not reach. Long enough to sign in by hand; short enough that a build nobody is
 * watching does not hold a simulator overnight.
 */
const PROMPT_TIMEOUT_MS = 15 * 60_000

export class AppFlowBuilder extends EventEmitter {
  private controller = new AbortController()
  private running = false
  private pauseRequested = false
  private pendingPrompt: {
    id: string
    settle: (resolution: AppFlowPromptResolution) => void
  } | null = null

  /** Answers an open prompt. Returns false when nothing is waiting for one. */
  resolvePrompt(resolution: AppFlowPromptResolution, promptId?: string): boolean {
    const pending = this.pendingPrompt
    if (!pending || promptId !== pending.id) return false
    pending.settle(resolution)
    return true
  }

  private requestUserAction = (prompt: AppFlowPrompt): Promise<AppFlowPromptResolution> => {
    // Supersede an older prompt if the orchestrator reaches a newer checkpoint.
    this.pendingPrompt?.settle('stop')
    return new Promise<AppFlowPromptResolution>((resolve) => {
      const signal = this.controller.signal
      const settle = (resolution: AppFlowPromptResolution): void => {
        if (this.pendingPrompt?.settle !== settle) return
        this.pendingPrompt = null
        clearTimeout(timer)
        signal.removeEventListener('abort', onAbort)
        resolve(resolution)
      }
      // Cancelling or walking away must not leave the sweep waiting on a click forever.
      const onAbort = (): void => settle('stop')
      const timer = setTimeout(() => {
        console.log(`[app-flow] prompt (${prompt.kind}) timed out — stopping`)
        settle('stop')
      }, PROMPT_TIMEOUT_MS)
      this.pendingPrompt = { id: prompt.id, settle }
      if (signal.aborted) settle('stop')
      else signal.addEventListener('abort', onAbort, { once: true })
    })
  }

  /**
   * An options object rather than positional parameters: the list had reached seven, two of its
   * callers passed `undefined` through the middle of it to reach the ones they cared about, and
   * adding `explorationMode` would have made an eighth.
   */
  async start(options: {
    projectPath: string
    mode: AppFlowBuildMode
    decisionProvider?: AppFlowDecisionProvider
    screenLimit?: number
    explorationMode?: ExplorationMode
    deepLinkJudgeMode?: DeepLinkJudgeMode
    launchedDevice?: CaptureDevice
  }): Promise<void> {
    if (this.running) throw new Error('Build already in progress')
    this.running = true
    this.controller = new AbortController()
    this.pauseRequested = false

    let result: AppFlowBuildResult | AppFlowBuildError
    try {
      result = await buildAppFlow({
        ...options,
        pauseRequested: () => this.pauseRequested,
        signal: this.controller.signal,
        onEvent: (event) => this.emit('event', event),
        requestUserAction: this.requestUserAction
      })
    } catch (error) {
      // buildAppFlow catches its own failures, but a listener throwing (or an unexpected bug)
      // must not leave `running` stuck true with no terminal event.
      result = { ok: false, error: error instanceof Error ? error.message : 'Unknown error' }
    } finally {
      this.running = false
      this.pendingPrompt = null
    }

    if (result.ok) {
      this.emit('done', result)
    } else {
      this.emit('error', result)
    }
  }

  cancel(): void {
    console.log('[app-flow] cancel requested')
    this.controller.abort()
  }

  pause(): void {
    console.log('[app-flow] pause requested; waiting for the next screen checkpoint')
    this.pauseRequested = true
    // A user-action prompt is itself a durable boundary, so it need not remain open before the
    // orchestrator can observe the cooperative pause request.
    this.pendingPrompt?.settle('stop')
  }

  isRunning(): boolean {
    return this.running
  }
}
