/**
 * The one file under `reach/` allowed to value-import `capture.ts` (device operations) — every
 * other module here stays plain data and pure functions specifically so it can run under
 * `node --test` with no Electron runtime, which is what `capture.ts` (via `storage.ts`) pulls in.
 * See `reach/types.ts`'s doc comment for the fuller rationale, and this directory's own
 * `value-imports.test.ts` for the rule enforced as a test rather than left to convention.
 *
 * `createReachPorts` wires the interfaces in `ports.ts` to the real device bound for this sweep.
 * Almost every port method is a direct rename of something `orchestrator.ts` already called
 * directly — `verifyCurrentTarget`'s retry loop becomes `JudgePort.verifyArrival` verbatim, and so
 * on. The two exceptions are `DevicePort.resetToLaunch` and `DevicePort.runPathCommands`, which
 * replaced `startReplayRecording` when the sweep stopped recording `.ad` scripts; each is noted at
 * its own definition.
 *
 * What this seam deliberately does NOT cover — because the plan keeps these permanently outside
 * it, not because they were missed: device boot (`bootDevice`/`waitForAppReady` at sweep start),
 * the auth gate's own body (it owns the user prompt and `manifest.sweepStatus`; `AuthPort` only
 * forwards to the `checkAuthGate` this factory is handed), the blocked-run detector
 * (`resolveBlocked`, which also owns a user prompt), and the state-variant pass. All four still
 * call `capture.ts` and `device.client` directly in `orchestrator.ts`, exactly as before.
 *
 * `path-run.ts` is imported here for the same reason `capture.ts` is: it is a device-executing
 * module, and this file is the one place under `reach/` allowed to pull one in. It is not covered
 * by `value-imports.test.ts`'s two named paths, so nothing else here may import it either —
 * nothing else does, and the rule it would break is the same one.
 */
import type { NavigateReply, ReadinessReply } from '../cdp/agent-runtime.ts'
import type { NavRoute } from '../nav-state.ts'
import type { AppFlowNode, AppFlowPressable } from '../../shared/app-flow.ts'
import {
  captureScreenshot,
  capturePressables,
  endLiveSession,
  executeNavigationActions,
  measurePhase,
  openDeepLink,
  openPathToReachApp,
  saveAndReplayRecording,
  verifyAndRepairReplay,
  settleAfterRoute,
  waitForAppReady,
  SUBSTANTIVE_FRAME_GRACE_MS,
  type AppFlowNavigationAction,
  type CaptureContext,
  type CaptureDevice
} from '../capture.ts'
import { runPathToReach } from '../path-run.ts'
import { PROBE_FRAME_ELEMENT_FLOOR } from './probe-route.ts'
import type { ActiveTimeBudget } from '../exploration.ts'
import { parseSubAgentJson, type SubAgentOptions, type SubAgentResult } from '../decision-provider.ts'
import { parseArrivalVerdict } from './arrival.ts'
import { ARRIVAL_SYSTEM_PROMPT } from './prompts.ts'
import type { ArrivalVerdict } from './types.ts'
import type {
  AuthPort,
  DevicePort,
  DeviceReplayOptions,
  DeviceReplayResult,
  JudgePort,
  ReachMetricsPort,
  ReachPorts,
  RecorderPort,
  RenderAvailability,
  RenderPort,
  RenderSettleResult,
  RouteSettleResult,
  SweepLogPort
} from './ports.ts'

export interface CreateReachPortsOptions {
  ctx: CaptureContext
  device: CaptureDevice
  /** Unused by any port today; kept so the factory's signature matches the plan's seam exactly for
   *  whichever future port method needs it (a scratch or screenshot path scoped to the project). */
  projectId: string
  /** `cwd` for the arrival judge's sub-agent calls — mirrors `verifyCurrentTarget`'s own `runAgent` call. */
  projectPath: string
  runAgent(agentOptions: SubAgentOptions, label: string): Promise<SubAgentResult>
  checkAuthGate(
    remaining: number,
    budget?: ActiveTimeBudget
  ): Promise<'clear' | 'stop' | 'exhausted'>
  signal?: AbortSignal
  /**
   * How the render transport reaches the app's JS context, or null when it cannot be built. The
   * orchestrator owns this because it already owns the CDP target handshake and the latch that
   * stops a sweep re-paying for a failed one; duplicating either here would mean two components
   * disagreeing about whether the runtime is reachable.
   */
  renderTransport?: RenderTransport | null
  /** The parser identified this project as Expo Router, whose runtime opens pathnames. */
  expoRouter?: boolean
  /**
   * How long the settle poll may wait, as an escalating list — see `SETTLE_DEADLINES_MS`. Fast
   * passes `[3_000, 8_000]`; every other mode omits it and keeps the single 8s bound it had, so
   * this change is invisible outside Fast.
   */
  settleDeadlinesMs?: readonly number[]
  /** Where each node's run through the ladder is written down — see `SweepLogPort`. Omitted
   *  outside Fast, and omitted when the log file could not be opened. */
  sweepLog?: SweepLogPort | null
  /** Where the reach path's three bounded aggregates go — see `ReachMetricsPort`. */
  metrics?: ReachMetricsPort | null
}

/**
 * The orchestrator-supplied half of deterministic Fast: one persistent runtime connection for the
 * sweep. Navigation and readiness are structured commands so replies are not truncated by a CLI.
 */
export interface RenderTransport {
  /**
   * Resolves once a CDP target is selected; `{ ok: false, reason }` when the runtime cannot be
   * reached at all. The reason is the transport's own words (see `RenderAvailability`) — this
   * layer only passes it on, to the rung's skip note and the per-run log.
   */
  ready(): Promise<RenderAvailability>
  navigate(
    route: string[],
    params: Record<string, string> | null,
    expoPath: string | null,
    /**
     * Ancestor navigator names this node may live under, for the in-app resolver to fall back on
     * when the navigator that registers the route is not mounted yet (an unvisited tab).
     */
    candidates: string[] | null
  ): Promise<NavigateReply>
  readiness(route: string, params: Record<string, string> | null): Promise<ReadinessReply>
  /**
   * The flattened navigator state, read over the live connection instead of the CLI subprocess
   * `nav-state.ts` shells out to.
   *
   * Same answer, same shape (`NavRoute[]`, null when no navigator is mounted) — the difference is
   * that the subprocess path has to select a CDP target first (`selectNavStateTarget`, a 30s
   * handshake) and then chunk the reply through a 200-character eval, both on the critical path of
   * the first screen that wants param values. This connection is already open and already holds
   * the target.
   */
  navState(): Promise<NavRoute[] | null>
  close(): Promise<void>
}

/**
 * How long to keep polling for a screen to stop changing, and how the poll decides it has.
 *
 * The persistent runtime measures React commits, requests and two painted frames in-app; the host
 * only bounds how long it will keep asking for that verdict.
 *
 * The bound is a *list* of deadlines, not one number, because the two cases it has to separate look
 * identical from the host: a screen still painting itself, and a screen that has arrived and will
 * simply never go quiet (a live feed, an animated placeholder, a polling timer). Waiting the full
 * 8s on the second is pure loss — it is as arrived at 3s as it will ever be. So the first deadline
 * is the normal bound, and only a poll that saw an actual loading affordance may extend to the
 * second. Non-fast modes are handed `[8_000]`, which is exactly the single deadline they had.
 */
const SETTLE_DEADLINES_MS: readonly number[] = [8_000]

/** How long the screen must have had to arrive before "unchanged" is allowed to mean "settled".
 *  Below this a stable signature is just as likely to be a frame that has not started rendering. */
const IDLE_AFTER_MS = 1_500

/** Consecutive polls with an identical signature before the idle short-circuit fires. */
const IDLE_STABLE_POLLS = 3

/**
 * The gap between two readiness polls, matching the in-app capture driver's own poll interval.
 *
 * The loop used to have none. Each poll walks the fiber tree twice (once for the screen, once for
 * its content count) on the app's own JS thread, and on a large tree that is tens of thousands of
 * fibers of work issued back-to-back against the very thread the screen needs in order to finish
 * rendering. The gap costs no latency — a poll already blocks on two painted frames, ~35ms — and
 * gives the app room to settle, so the screen is typically ready in *fewer* polls, not more.
 */
const POLL_INTERVAL_MS = 40

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function createRenderPort(
  transport: RenderTransport,
  nodeRouteName: (node: AppFlowNode) => string[],
  expoRouter: boolean,
  deadlinesMs: readonly number[],
  /** Times one readiness poll against the sweep's ledger — the `settle-poll` phase. Supplied by
   *  the factory so this function keeps taking no `CaptureContext` of its own. */
  measurePoll: <T>(work: () => Promise<T>) => Promise<T>,
  metrics: ReachMetricsPort | null
): RenderPort {
  const firstDeadline = deadlinesMs[0] ?? 8_000
  const lastDeadline = deadlinesMs[deadlinesMs.length - 1] ?? firstDeadline
  return {
    async available(): Promise<RenderAvailability> {
      return await transport.ready()
    },
    async navigate(node, params) {
      const segments = nodeRouteName(node)
      if (!segments.length) return { ok: false, reason: 'No navigator route name for this node.' }
      const outcome = await transport.navigate(
        segments,
        params,
        expoRouter ? node.urlPath : null,
        navigatorCandidates(node, segments)
      )
      if (outcome.ok) {
        const resolved = outcome.path?.length ? outcome.path : segments
        const description =
          outcome.action === 'expo-replace'
            ? `Replaced Expo pathname ${node.urlPath}.`
            : outcome.action === 'replace'
              ? `Replaced focused stack leaf with ${resolved[resolved.length - 1]}.`
              : outcome.action === 'noop'
                ? `${resolved.join(' > ')} was already focused.`
                : `Dispatched ${resolved.join(' > ')}.`
        // `outcome.path` rather than `resolved`: the fallback to the requested segments is for the
        // *message*, while a caller checking arrival against the live focused path must only ever
        // compare what the app said it dispatched. See `RenderPort.navigate`.
        metrics?.navigate(outcome.via ?? 'exact')
        return {
          ok: true,
          reason: description,
          action: outcome.action,
          ...(outcome.path?.length ? { path: outcome.path } : {})
        }
      }
      metrics?.navigate('refused')
      let why: string
      if (outcome.reason === 'unregistered') {
        // The guard tests the whole path against the live tree, so naming only its leaf (which is
        // what this said before) sent readers looking for a screen that may well be registered.
        const searched = outcome.detail ? ` (${outcome.detail})` : ''
        why = `Route ${segments.join(' > ')} is not registered in the running navigator${searched}.`
      } else if (outcome.reason === 'no-navigator') {
        why = 'No mounted navigator found.'
      } else if (outcome.reason === 'no-dispatch') {
        why = 'The mounted navigator cannot be dispatched to.'
      } else if (outcome.reason === 'no-expo-router') {
        why = 'Expo Router is not exposed by the running development runtime.'
      } else if (outcome.reason === 'invalid-route') {
        why = 'The route has no runtime navigator path.'
      } else {
        why = `Navigation dispatch threw: ${outcome.detail ?? 'no detail'}`
      }
      return { ok: false, reason: why, refusal: outcome.reason }
    },
    async awaitSettled(node, params, budget) {
      const segments = nodeRouteName(node)
      const target = segments[segments.length - 1] ?? node.id
      // Whether the deadline below is the settle's own cap or the caller's remaining budget, for
      // the log line only — the wait is the shorter of the two either way.
      const remainingMs = Math.max(0, budget.remainingMs)
      const budgetCapped = budget.remainingMs < lastDeadline
      const startedAt = Date.now()
      // Sticky: once any poll has seen a loading affordance, this screen has shown it is still
      // painting and has earned the longer wait for the rest of the settle. Letting the window
      // shrink back the moment the skeleton disappears would cut off the screen that just finished
      // loading at 2.9s, which is the one case the extension exists for.
      let sawLoading = false
      let polls = 0
      let last = 'never sampled'
      let lastSnapshot: ReadinessReply | null = null
      let stableSignature: string | null = null
      let stablePolls = 0
      /** Every exit carries the last snapshot's own fields — see `RenderSettleResult`. */
      const finish = (
        result: Omit<RenderSettleResult, 'active' | 'found' | 'content' | 'paramMismatch' | 'signature'>
      ): RenderSettleResult => {
        // One measurement per settle, taken on every exit — not one per poll, which at a 40ms
        // interval is exactly the frequent-sample case telemetry excludes. The `stop` attribute is
        // a closed set, so this stays low cardinality.
        metrics?.settle(Date.now() - startedAt, result.stop ?? 'unknown')
        return {
          ...result,
          active: lastSnapshot?.active ?? [],
          found: lastSnapshot?.found ?? false,
          content: lastSnapshot?.content ?? 0,
          paramMismatch: lastSnapshot?.paramMismatch ?? [],
          signature: lastSnapshot?.signature ?? ''
        }
      }
      while (Date.now() - startedAt < Math.min(sawLoading ? lastDeadline : firstDeadline, remainingMs)) {
        polls += 1
        const snapshot = await measurePoll(() => transport.readiness(target, params))
        if (!snapshot) {
          return finish({
            settled: false,
            reason: 'Runtime stopped answering readiness polls.',
            polls,
            stop: 'no-answer'
          })
        }
        lastSnapshot = snapshot
        if (snapshot.loading) sawLoading = true
        last = snapshot.found
          ? `loading=${snapshot.loading ?? 'no'} content=${snapshot.content}`
          : snapshot.paramMismatch.length
            ? `on ${target} with different ${snapshot.paramMismatch.join(', ')}`
            : `target screen not focused (on ${snapshot.active.join('/') || 'unknown'})`
        // A loading affordance resets the count outright: a skeleton holds its shape between
        // polls, so stability alone would call a half-rendered screen settled.
        if (!snapshot.found || snapshot.loading || !snapshot.content) {
          stableSignature = null
          stablePolls = 0
          await delay(POLL_INTERVAL_MS)
          continue
        }
        if (snapshot.settled) {
          return finish({
            settled: true,
            reason: `Settled with ${snapshot.content} content nodes (${snapshot.confident ? 'full signals' : `missing ${snapshot.missing.join(', ')}`}).`,
            polls,
            stop: 'settled'
          })
        }
        if (snapshot.signature && snapshot.signature === stableSignature) stablePolls += 1
        else {
          stableSignature = snapshot.signature
          stablePolls = 1
        }
        // The idle short-circuit. The runtime's `settled` is the stronger statement — it also wants
        // commits and network to have gone quiet — and a screen whose feed never stops polling can
        // never make it. Found, substantial, not loading and structurally identical across three
        // polls past `IDLE_AFTER_MS` is as arrived as that screen is going to get, and waiting out
        // the deadline only delays a photograph of the same pixels.
        if (Date.now() - startedAt >= IDLE_AFTER_MS && stablePolls >= IDLE_STABLE_POLLS) {
          return finish({
            settled: true,
            reason: `Stable but never quiet — ${snapshot.content} content nodes unchanged across ${stablePolls} polls.`,
            polls,
            stop: 'stable-not-quiet'
          })
        }
        await delay(POLL_INTERVAL_MS)
      }
      return finish({
        settled: false,
        reason: `Did not settle in time — ${last}.`,
        polls,
        stop: budgetCapped ? 'budget' : 'timeout'
      })
    }
  }
}

function createDevicePort(
  ctx: CaptureContext,
  device: CaptureDevice,
  signal: AbortSignal | undefined
): DevicePort {
  return {
    async replayRun(options: DeviceReplayOptions): Promise<DeviceReplayResult> {
      // Closing first is free on every path through here: the script being replayed opens with
      // `open --relaunch` of its own, so the app restarts either way. It used to be load-bearing
      // as well — a seeded walk armed a `--save-script` transaction through this call and
      // agent-device refuses to arm a second over a live first — but the sweep records nothing
      // now, and the only scripts that still reach this method are the manual recorder's.
      await endLiveSession(device)
      const result = await measurePhase(ctx, 'replay', () =>
        device.client.replay.run({
          path: options.path,
          platform: ctx.platform,
          udid: device.deviceId,
          keepSession: true,
          timeoutMs: options.timeoutMs
        })
      ) as { sessionActive: boolean }
      return { sessionActive: result.sessionActive }
    },
    openDeepLink(node: AppFlowNode, params: Record<string, string>) {
      return openDeepLink(ctx, device, node, params)
    },
    // Deep-link arrival is judged off the frame taken right after this returns, so it waits for the
    // app to actually settle rather than sleeping a flat 2.5s — see `settleAfterRoute`.
    async waitForRoute(options?: {
      minInteractiveElements?: number
      timeoutMs?: number
    }): Promise<RouteSettleResult> {
      const settled = await settleAfterRoute(ctx, device, signal, options?.timeoutMs, {
        minInteractiveElements: options?.minInteractiveElements
      })
      // `device.lastRead` is written by every successful `capturePressables`, and the settle poll's
      // reads are the last ones to have run, so this is the poll's own final frame with no extra
      // device call. Read here rather than returned up through `waitForAppReady` because the poll
      // has four exits (settled, timed out, read failures, undersized grace) and all four leave the
      // same field holding the same thing — threading a return value through each would only
      // restate that. See `RouteSettleResult`.
      return { settled, pressables: device.lastRead?.pressables ?? null }
    },
    captureScreenshot(path: string) {
      return captureScreenshot(ctx, device, path)
    },
    capturePressables(timeoutMs?: number): Promise<AppFlowPressable[]> {
      return capturePressables(ctx, device, timeoutMs)
    },
    executeNavigationActions(actions: readonly AppFlowNavigationAction[], timeoutMs?: number) {
      return executeNavigationActions(ctx, device, actions, timeoutMs)
    },
    // `openPathToReachApp` rather than `goHome`: it is the same `apps.open` without the armed-
    // recording suppression `goHome` carries for a sweep that no longer arms anything, and it is
    // literally the call `path-run.ts` makes for an `open` line — so the live reset and the stored
    // baseline line are the same operation rather than two that have to be kept in step.
    //
    // The floored wait is the one `startReplayRecording` already paid for its first screenshot:
    // a stable frame and a loaded app are different things, and a dev client's splash is stable.
    // Graced rather than held to `timeoutMs` because a walk may legitimately begin on a sparse
    // screen. What is deliberately *not* here is the launcher-recovery deferral: that existed only
    // so the recovery's own `apps.open` could not abort an armed recording, and there is no
    // recording left to protect.
    async resetToLaunch(url: string | null, timeoutMs: number): Promise<void> {
      await openPathToReachApp(device, device.launchTarget, url ?? device.launchUrl)
      await waitForAppReady(ctx, device, signal, timeoutMs, {
        minInteractiveElements: PROBE_FRAME_ELEMENT_FLOOR,
        minInteractiveElementsGraceMs: SUBSTANTIVE_FRAME_GRACE_MS
      })
    },
    runPathCommands(commands: readonly string[]): Promise<void> {
      return runPathToReach(ctx, device, commands)
    }
  }
}

function createRecorderPort(device: CaptureDevice, ctx: CaptureContext): RecorderPort {
  return {
    saveAndReplayRecording(
      scriptPath: string,
      destinationSelector: string,
      timeoutMs?: number,
      options?: { repairArmed?: boolean; verifyByReplay?: boolean }
    ) {
      return saveAndReplayRecording(
        ctx,
        device,
        scriptPath,
        destinationSelector,
        timeoutMs,
        options
      )
    },
    verifyAndRepairReplay(
      scriptPath: string,
      destinationSelector: string,
      timeoutMs: number,
      error?: unknown
    ) {
      return verifyAndRepairReplay(
        ctx,
        device,
        scriptPath,
        destinationSelector,
        Date.now() + timeoutMs,
        error
      )
    }
  }
}

/**
 * `verifyCurrentTarget`, moved verbatim. Two attempts, because a single `uncertain` verdict is
 * common enough (a mid-transition frame, a partially loaded screen) to be worth one retry before
 * accepting it — see the loop's own exit condition, which stops early on anything else.
 */
function createJudgePort(
  runAgent: (agentOptions: SubAgentOptions, label: string) => Promise<SubAgentResult>,
  projectPath: string
): JudgePort {
  return {
    async verifyArrival(
      node: AppFlowNode,
      screenshotPath: string,
      budget: ActiveTimeBudget
    ): Promise<ArrivalVerdict> {
      let result: ArrivalVerdict | null = null
      for (let attempt = 0; attempt < 2 && !budget.expired; attempt++) {
        const response = await runAgent(
          {
            cwd: projectPath,
            systemPrompt: ARRIVAL_SYSTEM_PROMPT,
            userPrompt: `Target screen: ${node.id} (${node.title})\nURL path: ${node.urlPath ?? 'none'}\nSource: ${node.file ?? 'unknown'}\nDecide whether the current screenshot is this exact destination.`,
            // No tools: this is a yes/no judgement about one screenshot, and a judge that can read
            // the repo can talk itself into a verdict the frame does not support — the whole value
            // of this call is that it sees only what the device showed.
            tools: [],
            // `low`, not `off` like the other judges, and this is a deliberate walk-back of an
            // earlier change rather than an oversight.
            //
            // `off` looked right on the arithmetic: 22 calls, 29% of a sweep, 60-80% of each
            // reply's output spent on reasoning to answer "is this frame the screen I named?". It
            // measured well in isolation too — output per call fell from ~200 tokens to ~70. What
            // it missed is that this verdict is a *gate*. A wrong mismatch does not cost the
            // judge's own tokens, it costs another lap of the exploration loop: another planner
            // call, another observation, another judge call. On device, `SearchTab/Search` — an
            // intrinsically ambiguous screen, which the reasoning judge had previously spent 866
            // reasoning tokens getting right in one call — took three attempts at `off`, two of
            // them wrong, and the two extra laps cost roughly 12k tokens to save about 800.
            //
            // So this role buys deliberation for the same reason the navigator does: it is not the
            // size of the answer that matters, it is what an incorrect one sets in motion. The
            // binary, low-stakes judges (`auth-gate`, `runtime-screen`) stay at `off`, where a
            // thin answer costs nothing beyond itself.
            thinkingLevel: 'low',
            imagePath: screenshotPath,
            timeoutMs: Math.max(1_000, Math.min(120_000, budget.remainingMs))
          },
          `arrival ${node.id}`
        )
        const parsedResult = parseArrivalVerdict(parseSubAgentJson<unknown>(response.text))
        if (parsedResult) result = parsedResult
        // `result &&`, because an unparseable reply leaves `result` null, and `null?.verdict` is
        // `undefined` — which is not `'uncertain'`, so the loop used to break on exactly the case
        // the retry exists for. A malformed answer is not a verdict; it is a reply that has not
        // happened yet, and it costs the same lap of exploration that a wrong `uncertain` does.
        if (result && result.verdict !== 'uncertain') break
      }
      return (
        result ?? {
          verdict: 'uncertain',
          status: null,
          reason: 'Arrival verifier returned invalid JSON.'
        }
      )
    }
  }
}

function createAuthPort(
  checkAuthGate: (
    remaining: number,
    budget?: ActiveTimeBudget
  ) => Promise<'clear' | 'stop' | 'exhausted'>
): AuthPort {
  return { checkGate: checkAuthGate }
}

export function createReachPorts(options: CreateReachPortsOptions): ReachPorts {
  const { ctx, device, runAgent, projectPath, checkAuthGate, signal, renderTransport } = options
  return {
    device: createDevicePort(ctx, device, signal),
    recorder: createRecorderPort(device, ctx),
    judge: createJudgePort(runAgent, projectPath),
    auth: createAuthPort(checkAuthGate),
    // Both are pure sinks the orchestrator owns (a JSONL file and the Sentry helper), passed
    // straight through: nothing under `reach/` may open either for itself.
    ...(options.sweepLog ? { sweepLog: options.sweepLog } : {}),
    ...(options.metrics ? { metrics: options.metrics } : {}),
    // Omitted rather than stubbed when there is no transport, so `renderStrategy` skips on the
    // port's absence instead of on a port that always answers no.
    ...(renderTransport
      ? {
          render: createRenderPort(
            renderTransport,
            navigatorSegments,
            options.expoRouter === true,
            options.settleDeadlinesMs?.length ? options.settleDeadlinesMs : SETTLE_DEADLINES_MS,
            // `ctx` is always present in the sweep; guarded so the port stays constructible from a
            // test that supplies only a transport.
            (work) => (ctx ? measurePhase(ctx, 'settle-poll', work) : work()),
            options.metrics ?? null
          )
        }
      : {})
  }
}

/**
 * The navigator route names for a node, outermost first.
 *
 * Node ids are the parser's own spelling of the route's position in the navigator tree, so
 * `HomeTab/Profile` is a `Profile` screen inside a `HomeTab` navigator and becomes the nested
 * payload React Navigation expects. A node id with no separator is a top-level route.
 */
function navigatorSegments(node: AppFlowNode): string[] {
  return node.id.split('/').filter(Boolean)
}

/**
 * Ancestor navigator names to try when the running tree has no match for a node's route.
 *
 * The parser records every navigator that registers a screen (`groups`, of which `group` is one)
 * plus the navigator it was declared in. A tab the run has never visited has no mounted state, so
 * the in-app breadth-first walk cannot see it; these parsed names are the only way to reach it.
 * Names already in the requested path are dropped, and the list is small and de-duplicated.
 */
function navigatorCandidates(node: AppFlowNode, segments: string[]): string[] {
  const out: string[] = []
  const seen = new Set(segments)
  for (const name of [...(node.groups ?? []), node.group, node.navigator]) {
    if (!name || typeof name !== 'string' || seen.has(name)) continue
    seen.add(name)
    out.push(name)
  }
  return out
}
