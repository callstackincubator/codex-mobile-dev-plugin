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
import {
  navigateExpr,
  navigatePayload,
  parseNavigateOutcome,
  parseReadiness,
  readinessExpr
} from '../runtime-render.ts'
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
  ReachPorts,
  RecorderPort,
  RenderPort,
  RouteSettleResult
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
}

/**
 * The orchestrator-supplied half of the render path: a selected CDP target and a way to evaluate
 * one expression against it. Kept to these two operations so that swapping the CLI for a
 * persistent socket later changes this object's implementation and nothing else.
 */
export interface RenderTransport {
  /** Resolves once a CDP target is selected, false when the runtime cannot be reached at all. */
  ready(): Promise<boolean>
  /** Evaluates one expression and returns the CLI's raw output. */
  evaluate(expression: string, timeoutMs: number): Promise<string>
}

/**
 * How long to keep polling for a screen to stop changing, and how the poll decides it has.
 *
 * `SETTLE_STABLE_POLLS` is two because a CLI eval costs roughly half a second, so two identical
 * samples are already over 500ms apart — far longer than the 80ms quiet window the reference
 * implementation waits for, and long enough that frames have certainly been painted. The slow
 * transport is what makes a stateless check sound; see `runtime-render.ts`.
 */
const SETTLE_TIMEOUT_MS = 8_000
const SETTLE_EVAL_TIMEOUT_MS = 5_000
const SETTLE_STABLE_POLLS = 2

function createRenderPort(
  transport: RenderTransport,
  nodeRouteName: (node: AppFlowNode) => string[]
): RenderPort {
  return {
    async available(): Promise<boolean> {
      return await transport.ready()
    },
    async navigate(node, params) {
      const segments = nodeRouteName(node)
      const payload = navigatePayload(segments, params)
      if (!payload) return { ok: false, reason: 'No navigator route name for this node.' }
      const outcome = parseNavigateOutcome(
        await transport.evaluate(navigateExpr(payload), SETTLE_EVAL_TIMEOUT_MS)
      )
      if (!outcome) return { ok: false, reason: 'Runtime did not answer the navigation dispatch.' }
      if (outcome.ok) return { ok: true, reason: `Dispatched ${segments.join(' > ')}.` }
      const why =
        outcome.reason === 'unregistered'
          ? `Route ${payload.name} is not registered in the running navigator.`
          : outcome.reason === 'no-navigator'
            ? 'No mounted navigator found.'
            : outcome.reason === 'no-dispatch'
              ? 'The mounted navigator cannot be dispatched to.'
              : `Navigation dispatch threw: ${outcome.detail ?? 'no detail'}`
      return { ok: false, reason: why }
    },
    async awaitSettled(node, params, budget) {
      const segments = nodeRouteName(node)
      const target = segments[segments.length - 1] ?? node.id
      // Whether the deadline below is the settle's own cap or the caller's remaining budget, for
      // the log line only — the wait is the shorter of the two either way.
      const budgetCapped = budget.remainingMs < SETTLE_TIMEOUT_MS
      const deadline = Date.now() + Math.min(SETTLE_TIMEOUT_MS, Math.max(0, budget.remainingMs))
      let previous: string | null = null
      let stable = 0
      let polls = 0
      let last = 'never sampled'
      while (Date.now() < deadline) {
        polls += 1
        const snapshot = parseReadiness(
          await transport.evaluate(readinessExpr(target, params), SETTLE_EVAL_TIMEOUT_MS)
        )
        if (!snapshot) {
          return {
            settled: false,
            reason: 'Runtime stopped answering readiness polls.',
            polls,
            stop: 'no-answer'
          }
        }
        last = snapshot.found
          ? `loading=${snapshot.loading ?? 'no'} content=${snapshot.content}`
          : snapshot.paramMismatch.length
            ? `on ${target} with different ${snapshot.paramMismatch.join(', ')}`
            : `target screen not focused (on ${snapshot.active.join('/') || 'unknown'})`
        // A loading affordance resets the count outright: a skeleton holds its shape between
        // polls, so stability alone would call a half-rendered screen settled.
        if (!snapshot.found || snapshot.loading || !snapshot.content) {
          stable = 0
          previous = null
          continue
        }
        stable = snapshot.signature === previous ? stable + 1 : 1
        previous = snapshot.signature
        if (stable >= SETTLE_STABLE_POLLS) {
          return {
            settled: true,
            reason: `Settled with ${snapshot.content} content nodes.`,
            polls,
            stop: 'settled'
          }
        }
      }
      return {
        settled: false,
        reason: `Did not settle in time — ${last}.`,
        polls,
        stop: budgetCapped ? 'budget' : 'timeout'
      }
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
    // Omitted rather than stubbed when there is no transport, so `renderStrategy` skips on the
    // port's absence instead of on a port that always answers no.
    ...(renderTransport ? { render: createRenderPort(renderTransport, navigatorSegments) } : {})
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
