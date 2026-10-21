/**
 * Wiring for the explore-UI pass: the only file that implements `explore-ui.ts`'s ports against a
 * real device, a real Metro and the real store.
 *
 * It reuses, rather than re-implements, everything it can: the already-launched device, `capture.ts`'s
 * settle and screenshot calls (the same two the sweep's delivery uses), `cdp/connection.ts` for the
 * injected agent, `presentations-source.ts` / `views-source.ts` / `preview-plans.ts` for the
 * catalog, and `presentations-bindings.ts` for the Metro symbolication join.
 *
 * There are two entry points and one port builder. `runExploreUi` is the standalone
 * `mobile_appflow_explore_ui` run: it opens its own connection to the app the user left running
 * and writes what it finds to storage. `openSweepUiStateSession` is the screen sweep's: it is
 * handed the sweep's *own* CDP connection (a second one would be a second debugger on the same
 * Hermes target) and returns the ports for it, and the orchestrator attaches the result itself.
 * Both build their ports with `createExploreUiPorts`, so the commands, budgets and telemetry
 * cannot differ between them.
 */
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  AppFlowCapture,
  AppFlowPresentations,
  AppFlowResult,
  AppFlowUiState
} from '../shared/app-flow.ts'
import { ExpectedOperationError } from '../shared/error-reporting.ts'
import { bindPresentationSites } from './presentations-bindings.ts'
import {
  captureScreenshot,
  settleAfterRoute,
  type CaptureContext,
  type CaptureDevice
} from './capture.ts'
import { CdpConnection, createTargetResolver } from './cdp/connection.ts'
import type { AgentCommand, NavStateReply } from './cdp/agent-runtime.ts'
import { listMetroTargets } from './cdp/discovery.ts'
import { addSourcePreviewPlans } from './preview-plans.ts'
import { scanPresentations } from './presentations-source.ts'
import { createSourceUnits, createSymbolResolver } from './source-units.ts'
import { scanSourceViews } from './views-source.ts'
import {
  exploreUiStates,
  EXPLORE_UI_ROLLBACK_TIMEOUT_MS,
  type ExploreUiPorts,
  type SweepUiStateSession
} from './explore-ui.ts'
import { recordRuntimeTiming } from './runtime-telemetry.ts'
import { getScreenshotPath, readAppFlow, writeAppFlow } from './storage.ts'

/** The reference's own per-command budgets, kept so a port change is visible as a change. */
// Setup carries the whole catalog over the wire, reads every initialised module once and forces one
// render pass, so on the first screens of a cold app it is the one command that can run long. The
// first two screens of an otherwise healthy sweep ended `pass-failed` with nothing listed.
const SETUP_TIMEOUT_MS = 20_000
const LIST_TIMEOUT_MS = 2_000
const OPEN_TIMEOUT_MS = 5_000
const CONTENT_TIMEOUT_MS = 2_000
/**
 * Bound on the settle after a presentation opens.
 *
 * This used to pass `undefined` and inherit `ROUTE_SETTLE_TIMEOUT_MS` (30s). That bound is sized
 * for a *deep link* resolving a whole route; a presentation opens over a screen that has already
 * settled, so the only wait that matters is the sheet's own transition. The 30s was being paid in
 * full on every screen whose state drew nothing — about 30s x 8 of one 304s ten-screen sweep —
 * and the frame was then photographed anyway, because `waitForAppReady` captures on timeout.
 */
const UI_STATE_SETTLE_TIMEOUT_MS = 4_000

/** Directories a React Native project never keeps its own screens in. */
const SKIPPED_DIRECTORIES = new Set([
  'node_modules', '.git', 'ios', 'android', 'build', 'dist', '.expo', '.next', 'coverage', 'vendor'
])
const SOURCE_EXTENSIONS = /\.(tsx|ts|jsx|js)$/
/** Bounds on what one scan will parse, so a monorepo cannot stall the pass. */
const MAX_SOURCE_FILES = 4_000
const MAX_SOURCE_BYTES = 512_000

/** Every project-owned source file, as `{file, text}` pairs with absolute paths. */
export async function collectProjectSources(root: string): Promise<{ file: string; text: string }[]> {
  const sources: { file: string; text: string }[] = []
  const walk = async (dir: string): Promise<void> => {
    if (sources.length >= MAX_SOURCE_FILES) return
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (sources.length >= MAX_SOURCE_FILES) return
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.') || SKIPPED_DIRECTORIES.has(entry.name)) continue
        await walk(path)
        continue
      }
      if (!SOURCE_EXTENSIONS.test(entry.name) || /\.d\.ts$/.test(entry.name)) continue
      if (/\.(test|spec)\.[tj]sx?$/.test(entry.name)) continue
      const text = await readFile(path, 'utf8').catch(() => null)
      if (text === null || text.length > MAX_SOURCE_BYTES) continue
      sources.push({ file: path, text })
    }
  }
  await walk(root)
  return sources
}

/**
 * The static catalog for one project: presentations, the views they render, and the preview plans
 * compiled from both. Pure — nothing here touches a device.
 */
export async function buildPresentationCatalog(root: string): Promise<AppFlowPresentations> {
  const units = createSourceUnits(await collectProjectSources(root))
  const symbol = createSymbolResolver(units, { root })
  const found = scanPresentations(units, root, symbol)
  const views = scanSourceViews(units, root, symbol)
  return addSourcePreviewPlans({ ...found, views: views.views, viewStates: views.states })
}

/** The one thing the ports need from a CDP connection. `CdpConnection` satisfies it. */
export interface ExploreUiRuntime {
  invoke<T>(payload: AgentCommand, timeoutMs: number): Promise<T>
}

/** Everything the ports are bound to, whichever driver is asking. */
export interface ExploreUiPortOptions {
  projectPath: string
  projectId: string
  ctx: CaptureContext
  device: CaptureDevice
  runtime: ExploreUiRuntime
  catalog: AppFlowPresentations
  signal?: AbortSignal
  emit: ExploreUiPorts['emit']
}

export interface ExploreUiRunOptions {
  projectPath: string
  projectId: string
  ctx: CaptureContext
  device: CaptureDevice
  limit?: number
  signal?: AbortSignal
  emit: ExploreUiPorts['emit']
}

export interface ExploreUiRunResult {
  nodeId: string | null
  captured: number
  failed: number
  rolledBack: boolean
  cancelled: boolean
}

/**
 * Implement `explore-ui.ts`'s ports against a real device, for a connection somebody else owns.
 * Closing that connection is the caller's job — the sweep keeps using it after the pass.
 */
export function createExploreUiPorts(options: ExploreUiPortOptions): ExploreUiPorts {
  const { catalog } = options
  const command = async <T>(payload: AgentCommand, timeoutMs: number, operation: string): Promise<T> => {
    const started = performance.now()
    try {
      return await options.runtime.invoke<T>(payload, timeoutMs)
    } finally {
      recordRuntimeTiming('app_flow.runtime.command', performance.now() - started, { operation })
    }
  }
  return {
    runtime: {
      setup: (catalogue) =>
        command(
          {
            type: 'presentation-setup',
            states: catalogue.states,
            actions: catalogue.actions,
            projectRoot: options.projectPath
          },
          SETUP_TIMEOUT_MS,
          'presentation-setup'
        ),
      configure: (matches, checked) =>
        command(
          {
            type: 'presentation-configure',
            matches: [...matches],
            ...(checked?.length ? { checked: [...checked] } : {})
          },
          LIST_TIMEOUT_MS,
          'presentation-configure'
        ),
      list: () => command({ type: 'presentations' }, LIST_TIMEOUT_MS, 'presentations'),
      open: (id) => command({ type: 'presentation-open', id }, OPEN_TIMEOUT_MS, 'presentation-open'),
      // Above the in-app deadlines it confirms against (2000ms modal dismissal, 4000ms control
      // close), so a slow but successful unwind is never cut off by the transport.
      content: (expected) =>
        command(
          { type: 'presentation-content', expected },
          CONTENT_TIMEOUT_MS,
          'presentation-content'
        ),
      rollback: (level) =>
        command(
          { type: 'presentation-rollback', level, wait: true },
          EXPLORE_UI_ROLLBACK_TIMEOUT_MS,
          'presentation-rollback'
        )
    },
    // The same merged state/action set `presentation-setup` was given, so a binding resolved here
    // names a site the device also knows about.
    bind: (bindings, report) =>
      bindPresentationSites(
        options.projectPath,
        [...bindings],
        {
          states: [...catalog.states, ...(catalog.previewStates ?? []), ...(catalog.viewStates ?? [])],
          actions: [...catalog.actions, ...(catalog.previews ?? [])]
        },
        {
          metroOrigin: `http://localhost:${options.device.metroPort}`,
          ...(options.signal ? { signal: options.signal } : {}),
          readSource: (file) => readFile(file, 'utf8').catch(() => undefined),
          ...(report ? { report } : {})
        }
      ),
    focusedRoute: async () => {
      const reply = await command<NavStateReply>({ type: 'nav-state' }, LIST_TIMEOUT_MS, 'nav-state')
      const routes = reply?.routes ?? null
      return routes?.length ? (routes[routes.length - 1]!.name ?? null) : null
    },
    // The same settle the Fast delivery path waits on — a frame the app has stopped changing,
    // with enough interactive elements to be the presentation rather than its transition.
    settle: async () => {
      await settleAfterRoute(options.ctx, options.device, options.signal, UI_STATE_SETTLE_TIMEOUT_MS, {
        minInteractiveElements: 1
      })
    },
    screenshot: async (slug) => {
      const path = getScreenshotPath(options.projectId, slug)
      const { relaunched } = await captureScreenshot(options.ctx, options.device, path)
      if (relaunched) {
        throw new Error('The app restarted while this UI state was being photographed.')
      }
      return `screens/${slug}.png`
    },
    emit: options.emit,
    ...(options.signal ? { signal: options.signal } : {})
  }
}

/**
 * The sweep's session: the project's catalog (scanned once, here) bound to the sweep's own
 * connection, device and ctx. Nothing here connects to anything — `runtime` is the connection the
 * sweep already holds — and nothing here reads the device's focused route, because the sweep
 * passes the node it is standing on. Throws a product sentence when there is nothing to capture.
 */
export async function openSweepUiStateSession(
  options: Omit<ExploreUiPortOptions, 'catalog'>
): Promise<SweepUiStateSession> {
  const catalog = await buildPresentationCatalog(options.projectPath)
  if (!catalog.actions.length && !(catalog.previews ?? []).length) {
    throw new ExpectedOperationError('invalid_input', 'No UI states were found in this project’s source.')
  }
  return { catalog, ports: createExploreUiPorts({ ...options, catalog }) }
}

/**
 * Attach a connection to the app the user already launched. Throws with a product sentence when
 * there is nothing to attach to — the panel shows it verbatim, so it says what to do next.
 */
async function connectToLaunchedApp(
  options: ExploreUiRunOptions,
  appName: string | null
): Promise<CdpConnection> {
  const started = performance.now()
  let connection: CdpConnection | null = null
  try {
    const targets = await listMetroTargets(options.device.metroPort, { signal: options.signal })
    const normalize = (value: string | null | undefined): string =>
      (value ?? '').toLowerCase().replace(/[^a-z\d]/g, '')
    const app = normalize(appName)
    const candidates = targets
      .filter((target) => target.supportsMultipleDebuggers)
      .filter(
        (target) =>
          target.deviceId === options.device.deviceId ||
          (!!target.deviceName &&
            normalize(target.deviceName) === normalize(options.device.deviceName))
      )
    const target =
      candidates.find(
        (candidate) =>
          !app || normalize(candidate.title) === app || normalize(candidate.appId) === app
      ) ?? (candidates.length === 1 ? candidates[0]! : null)
    if (!target) {
      throw new Error(
        'No running app could be reached through Metro. Launch the app from the App Flow screen first, then start UI explore.'
      )
    }
    connection = new CdpConnection({
      resolveTarget: createTargetResolver(options.device.metroPort, target),
      sessionId: `explore-ui-${options.projectId}`,
      log: (message) => console.log(`[app-flow] explore-ui runtime — ${message}`)
    })
    await connection.connect()
    return connection
  } finally {
    recordRuntimeTiming('app_flow.runtime.connect', performance.now() - started, {
      outcome: connection?.state === 'ready' ? 'ready' : 'unavailable'
    })
  }
}

/**
 * Run the pass against a live app and persist what it found. This is the standalone entry: it
 * opens its own connection to whatever the user left running, and attributes the states to the
 * screen the app reports as focused. (A screen sweep captures states through
 * `openSweepUiStateSession` instead and persists them with the rest of the node's capture.)
 *
 * The variants are written onto the focused screen's existing capture (`AppFlowCapture.uiStates`);
 * no node is minted, no edge is drawn, and the sweep's own fields are untouched.
 */
export async function runExploreUi(options: ExploreUiRunOptions): Promise<ExploreUiRunResult> {
  const saved = await readAppFlow(options.projectId)
  if (!saved) {
    throw new Error(
      'This project has no saved App Flow yet. Build the flow first — UI states attach to screens the flow already captured.'
    )
  }
  options.emit({ type: 'phase', message: 'Reading UI states from the project’s source…' })
  const catalog = await buildPresentationCatalog(options.projectPath)
  if (!catalog.actions.length && !(catalog.previews ?? []).length) {
    throw new Error('No UI states were found in this project’s source.')
  }

  const connection = await connectToLaunchedApp(options, options.ctx.appName)
  const ports = createExploreUiPorts({ ...options, runtime: connection, catalog })

  try {
    const outcome = await exploreUiStates(
      { catalog, nodes: saved.nodes, ...(options.limit === undefined ? {} : { limit: options.limit }) },
      ports
    )
    if (outcome.nodeId) await persist(options.projectId, saved, outcome.nodeId, outcome.uiStates)
    if (!outcome.rolledBack) {
      options.emit({
        type: 'error',
        message:
          'The app may still be showing a UI state this run opened. Close it in the app, or relaunch it from the App Flow screen.'
      })
    }
    for (const failure of outcome.discoveryFailures) {
      options.emit({ type: 'step', message: `Could not open a UI state — ${failure.reason}` })
    }
    return {
      nodeId: outcome.nodeId,
      captured: outcome.uiStates.filter((state) => state.screenshot).length,
      failed: outcome.uiStates.filter((state) => !state.screenshot).length,
      rolledBack: outcome.rolledBack,
      cancelled: outcome.cancelled
    }
  } finally {
    await connection.close().catch(() => undefined)
  }
}

/**
 * Write the variants onto the node's existing capture.
 *
 * Replaces the node's `uiStates` wholesale rather than merging: a second run is a fresh statement
 * about what this screen can open, and a stale variant whose source recipe is gone should not
 * outlive the scan that stopped finding it. Nothing else on the capture is touched.
 */
async function persist(
  projectId: string,
  saved: AppFlowResult,
  nodeId: string,
  uiStates: AppFlowUiState[]
): Promise<void> {
  const nodes = saved.nodes.map((node) => {
    if (node.id !== nodeId || !node.capture) return node
    const capture: AppFlowCapture = { ...node.capture, uiStates }
    return { ...node, capture }
  })
  await writeAppFlow(projectId, { ...saved, nodes })
}
