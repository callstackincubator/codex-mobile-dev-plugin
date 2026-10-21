/**
 * Runtime replay — putting the app on one named screen by dispatching through its own navigator.
 *
 * The second of a node's two replay variants. The first, `manual.replay`, re-executes the
 * `agent-device …` lines a user recorded with the Record-path button: faithful to the journey, and
 * only available for a screen somebody actually recorded. This one needs no recording at all. It
 * takes the route the parser already knows (`AppFlowNode.id`, plus `urlPath` for Expo Router), the
 * param values the sweep already observed (`param-store.json`), and asks the running app to show
 * that screen — the same dispatch the Fast sweep's render rung makes, reached from the panel
 * instead of from a ladder.
 *
 * Deliberately the *same* port and transport as the sweep (`createRenderPortForTransport`,
 * `createAppRuntimeTransport`) rather than a second implementation: a replay that derived route
 * names, navigator candidates or settle deadlines differently from the sweep that mapped the
 * screen would be answering a different question, and the drift would surface as "the sweep
 * reached it, the button cannot" with nothing to explain it.
 *
 * What it does *not* do, by design:
 * - No fallback to a deep link or to a recorded path. Runtime replay reports exactly why the
 *   runtime refused — no Metro target, agent not installed, route not registered — because the two
 *   variants are two honest answers about two different mechanisms, and a silent fallback would
 *   make "runtime replay works here" unfalsifiable.
 * - No guessed params. A route with a param the store has never seen a value for is refused with
 *   that param named, for `buildUrlPath`'s reason: a stand-in lands cleanly on some other record,
 *   and the screen that follows is indistinguishable from the one asked for.
 * - No capture. The point is to leave the app sitting on the screen for a person to look at.
 *
 * Telemetry: the connect, per-command, navigate and settle measurements all come from the shared
 * transport and render port, so a replay's runtime cost lands in the same `app_flow.runtime.*`
 * series as a sweep's and the two stay comparable (see `docs/telemetry.md`). This module adds one
 * bounded count of its own, `app_flow.runtime_replay`, whose `outcome` is a closed set — nothing
 * route-, param- or project-identifying is ever attached.
 */
import type { AppFlowResult } from '../shared/app-flow.ts'
import type { CaptureContext, CaptureDevice } from './capture.ts'
import { createAppRuntimeTransport } from './cdp/app-runtime-transport.ts'
import { ActiveTimeBudget, resolveNodeParams } from './exploration.ts'
import { ParamStore, type ParamStoreJson } from './param-store.ts'
import { waitForReplayableFrame } from './path-run.ts'
import { createRenderPortForTransport } from './reach/adapters.ts'
import type { ReachMetricsPort } from './reach/ports.ts'
import { recordRuntimeCount, recordRuntimeTiming } from './runtime-telemetry.ts'
import { readAppFlow, readParamStore } from './storage.ts'

/**
 * How long the screen has to settle after the dispatch.
 *
 * The render port escalates within its own deadlines (`SETTLE_DEADLINES_MS`); this is only the
 * outer bound it is never allowed to exceed. Generous next to a sweep's per-node budget because a
 * replay is a single screen a person is waiting on, and giving up at three seconds on a screen
 * that was going to paint at four is the one failure mode with no recourse.
 */
const SETTLE_BUDGET_MS = 15_000

export type RuntimeReplayResult =
  | { ok: true; detail: string }
  | { ok: false; error: string }

export interface RuntimeReplayDeps {
  /** The device to replay on, and the context it was opened under. Prepared by the caller, which
   *  owns the warm-device pool — see `manual/index.ts`. */
  prepare: () => Promise<{ ctx: CaptureContext; device: CaptureDevice }>
  /**
   * The stored map and parameter store, defaulting to this project's own.
   *
   * Overridable for one reason: `storage.ts` value-imports `electron`, so a test that wanted to
   * exercise the refusal paths — a stale node id, a route whose params were never observed —
   * would otherwise have to boot a runtime to reach code that never touches a device. Production
   * passes nothing and reads the real files.
   */
  read?: () => Promise<{ flow: AppFlowResult | null; paramStore: ParamStoreJson | null }>
}

/**
 * Why a replay ended, as the closed set the `app_flow.runtime_replay` count carries.
 *
 * `no-map`/`no-node` are a stale panel, `unresolved-params` is a route the store cannot fill,
 * `unavailable` is a runtime that could not be reached at all, `refused` is a runtime that was
 * reached and declined the route, and `failed` is anything that threw. They are distinguished
 * because they need opposite fixes, and a single `error` bucket hides which one a user hit.
 */
type ReplayOutcome =
  | 'ok'
  | 'no-map'
  | 'no-node'
  | 'unresolved-params'
  | 'unavailable'
  | 'refused'
  | 'failed'

function finish(outcome: ReplayOutcome, startedAt: number): void {
  recordRuntimeCount('app_flow.runtime_replay', { outcome })
  recordRuntimeTiming('app_flow.runtime_replay.duration', Date.now() - startedAt, { outcome })
}

/**
 * Dispatches to `nodeId` and leaves the app there.
 *
 * `projectId` identifies the stored map and param store; `deps.prepare` yields a live device. The
 * device is never closed here, for `path-run.ts`'s reason: the button exists to put the app on a
 * screen and leave it to be looked at, and closing the session takes the app with it. The CDP
 * connection *is* closed — it is this call's own, a later replay re-handshakes in well under a
 * second, and holding a debugger session open on an app nobody is driving helps no one.
 */
export async function runtimeReplay(
  projectId: string,
  nodeId: string,
  deps: RuntimeReplayDeps
): Promise<RuntimeReplayResult> {
  const startedAt = Date.now()
  const read =
    deps.read ??
    (async () => ({
      flow: await readAppFlow(projectId),
      paramStore: await readParamStore(projectId)
    }))
  const { flow, paramStore: storedParams } = await read()
  if (!flow) {
    finish('no-map', startedAt)
    return { ok: false, error: 'This project has no App Flow map yet — run a sweep first.' }
  }
  const node = flow.nodes.find((candidate) => candidate.id === nodeId)
  if (!node) {
    finish('no-node', startedAt)
    return {
      ok: false,
      error: `${nodeId} is not in this project’s map any more — rebuild the map and try again.`
    }
  }

  // The same resolution the sweep's rungs use, against the same stored observations, so the
  // values a replay dispatches with are the ones the screen was mapped with. `fromPriorRun` is
  // left at its default: every record here is from a previous sweep by definition.
  const paramStore = ParamStore.fromJSON(storedParams)
  const resolution = resolveNodeParams(node, flow.edges, paramStore)
  if (resolution.unresolved.length) {
    finish('unresolved-params', startedAt)
    const named = resolution.unresolved.map((key) => `:${key}`).join(', ')
    return {
      ok: false,
      error:
        `This route needs ${named}, and no value for ${resolution.unresolved.length > 1 ? 'them has' : 'it has'} ` +
        'been observed yet. Reach the screen once — a sweep, or a recorded path — and the value is ' +
        'remembered for next time.'
    }
  }
  const values = Object.fromEntries(
    node.params
      .filter((key) => resolution.values[key] !== undefined)
      .map((key) => [key, resolution.values[key]!])
  )
  const params = Object.keys(values).length ? values : null

  const { ctx, device } = await deps.prepare()

  /** The render port's own bounded aggregates, same series and attributes as the sweep's. */
  const metrics: ReachMetricsPort = {
    navigate(outcome) {
      recordRuntimeCount('app_flow.runtime.navigate', { outcome })
    },
    settle(durationMs, stop) {
      recordRuntimeTiming('app_flow.runtime.settle', durationMs, { stop })
    },
    verify(durationMs, path, verdict) {
      recordRuntimeTiming('app_flow.runtime.verify', durationMs, { path, verdict })
    }
  }

  const runtime = createAppRuntimeTransport({
    metroPort: device.metroPort,
    deviceId: device.deviceId,
    deviceName: device.deviceName,
    appName: ctx.appName,
    // Distinct from the sweep's `fast-<projectId>` so a replay started while a sweep holds its own
    // connection is a separate debugger session rather than a collision on one name.
    sessionId: `runtime-replay-${projectId}`,
    signal: ctx.signal,
    logLabel: '[app-flow:runtime-replay]'
  })

  try {
    // Before the handshake, not after: a cold boot or an app the user backgrounded can still be on
    // a dev-client loading screen, and the agent cannot be installed into a runtime whose bundle
    // has not finished evaluating. Same wait a scripted replay clears before its first press.
    await waitForReplayableFrame(ctx, device)

    const render = createRenderPortForTransport({
      transport: runtime.transport,
      expoRouter: flow.manifest.project.mode === 'expo-router',
      metrics
    })

    const availability = await render.available()
    if (!availability.ok) {
      finish('unavailable', startedAt)
      return {
        ok: false,
        error: `The app’s runtime could not be reached — ${availability.reason}`
      }
    }

    const dispatch = await render.navigate(node, params)
    if (!dispatch.ok) {
      finish('refused', startedAt)
      return { ok: false, error: dispatch.reason }
    }

    // Best-effort, exactly as in the render rung: a screen that never goes quiet is still the
    // screen that was asked for, and the dispatch is what decides arrival. The wait is here so the
    // user is not handed a half-painted frame.
    await render.awaitSettled(node, params, new ActiveTimeBudget(SETTLE_BUDGET_MS))
    console.log(`[app-flow:runtime-replay] ${node.id} — ${dispatch.reason}`)
    finish('ok', startedAt)
    return { ok: true, detail: dispatch.reason }
  } catch (error) {
    finish('failed', startedAt)
    console.error('[app-flow:runtime-replay] failed:', error)
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Could not replay this screen at runtime.'
    }
  } finally {
    await runtime.close().catch(() => undefined)
  }
}
