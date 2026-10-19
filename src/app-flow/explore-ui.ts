/**
 * The explore-UI pass: open every UI state a screen's own source proves it can open, photograph
 * each one, and put the app back exactly as it was found.
 *
 * It is not a navigator. Nothing is navigated to, nothing is tapped, no model is asked anything,
 * and no graph node is minted. The pass asks the already-running app which of the statically
 * discovered presentations it can open *right now*, opens them one at a time by calling the app's
 * own setter or controller, photographs the result through the same capture path the sweep uses,
 * and rolls back.
 *
 * ## One per-screen primitive, two drivers
 *
 * `captureScreenUiStates` is the whole pass for ONE screen the device is standing on: collect the
 * live bindings, list what can open, open/settle/photograph/roll back each, and unwind to level 0.
 * Two callers share it so they cannot drift apart:
 *
 * - `exploreUiStates` — the standalone `mobile_appflow_explore_ui` run. The app is wherever the
 *   user left it, so the screen is *attributed* by asking the device which route is focused.
 * - `createSweepUiStateCapturer` — the screen sweep's own "Capture UI states" option. The sweep
 *   already knows which node it is on (it just delivered that node's capture), so the node is
 *   passed in and nothing is re-derived. The sweep calls it once per delivered screen, then moves
 *   on; the states are *returned* to the orchestrator, which attaches them to that node's capture
 *   through the ordinary delivery path rather than this module writing storage.
 *
 * What is per project (and so done once per sweep) is the static catalog and the connection; what
 * is per screen is the live-binding collection. `presentation-setup` binds the catalog to the
 * *mounted* React tree inside a bounded patch window and un-patches afterwards, so a screen the
 * sweep has only just navigated to has no bindings until the collect pass has run while it is
 * mounted. That is why the setup command is part of the per-screen primitive and not of any
 * once-per-sweep step.
 *
 * Everything that touches a device, Metro, the filesystem or the clock is a port, so the whole
 * sequence — the limit, the attribution, the failure accounting and above all the rollback
 * discipline — runs under `node --test` without a simulator. `explore-ui-run.ts` is the only file
 * that implements these ports against real things.
 *
 * ## Rollback is the safety-critical part
 *
 * A projected app is a *broken* app from the user's point of view: a sheet they did not open, a
 * modal they cannot dismiss, a screen replaced by a preview. Every exit from the per-screen
 * primitive — the happy path, a thrown port, an aborted signal, a limit reached, a timeout — goes
 * through the same `finally` that unwinds the runtime's undo stack to level 0, and a failed unwind
 * stops any further presentation from being opened and is reported on the outcome
 * (`rolledBack: false`). The in-app rollback carries its own deadlines (2000ms for a modal
 * dismissal, 4000ms for a controller-owned close) and can throw on an iOS detached owner; those
 * are honoured by giving the call its own timeout above them and by reporting a failed unwind
 * rather than swallowing it. For the sweep this is doubly important: the next screen is reached
 * and photographed from this very device, so a sheet left open would corrupt every later capture.
 */
import type {
  AppFlowCapture,
  AppFlowNode,
  AppFlowPresentations,
  AppFlowUiState
} from '../shared/app-flow.ts'
import { recordRuntimeAmount, recordRuntimeTiming } from './runtime-telemetry.ts'
import { routeAnswersTo } from './nav-route-target.ts'

/** One live binding the in-app pass could not name a site for, as the agent reports it. */
export interface ExploreUiUnboundBinding {
  id: string
  owner: string
  kind: 'state'
  stack: string
}

/** The four runtime commands this pass issues, behind one seam. */
export interface ExploreUiRuntimePort {
  /** `presentation-setup`: hand over the catalog and collect live bindings. */
  setup(catalog: Pick<AppFlowPresentations, 'states' | 'actions'>): Promise<{
    ok: boolean
    bindings: number
    matched: number
    unbound?: ExploreUiUnboundBinding[]
    error?: string
  }>
  /** `presentation-configure`: label bindings with the sites the host's join resolved. */
  configure(matches: readonly { binding: string; site: string }[]): Promise<{ configured: number }>
  /** `presentations`: what the device can actually open, as the tree stands now. */
  list(): Promise<{ available: { id: string; kind: 'state' | 'control' | 'mount' }[]; unavailable: number }>
  /** `presentation-open`. */
  open(id: string): Promise<
    | { ok: true; kind: 'state' | 'control' | 'mount'; checkpoint: number }
    | { ok: false; error: string; checkpoint: number }
  >
  /** `presentation-rollback` to `level`, confirming every native dismissal. */
  rollback(level: number): Promise<{ ok: boolean; error?: string; checkpoint: number }>
}

/** What `captureScreenUiStates` needs from the device and the host, for one screen. */
export interface ExploreUiScreenPorts {
  runtime: ExploreUiRuntimePort
  /**
   * The Metro symbolication join (`bindPresentationSites`). A failure here costs bindings, never
   * the pass: an unresolved binding simply means one fewer openable presentation.
   */
  bind(bindings: readonly ExploreUiUnboundBinding[]): Promise<{ binding: string; site: string }[]>
  /** The Fast path's own settle/readiness wait, after a presentation has been opened. */
  settle(): Promise<void>
  /** Take one screenshot into `screens/<slug>.png`; resolves to the stored relative path. */
  screenshot(slug: string): Promise<string>
  /** Progress for the panel. Messages are product prose; no paths, no ids. */
  emit(event: { type: 'phase' | 'step' | 'error' | 'complete'; message: string; completed?: number; total?: number }): void
  signal?: AbortSignal
  now?(): number
}

/** The standalone run additionally has to find out which screen it is on. */
export interface ExploreUiPorts extends ExploreUiScreenPorts {
  /** Which route the app is focused on right now — the last entry of the runtime's nav state. */
  focusedRoute(): Promise<string | null>
}

/** The screen a variant belongs to, as far as the per-screen primitive cares. */
export type ExploreUiTarget = Pick<AppFlowNode, 'id' | 'slug'>

export interface ExploreUiInput {
  /** The static catalog, already assembled by `buildPresentationCatalog`. */
  catalog: AppFlowPresentations
  /** The saved graph's nodes, for attributing variants to the focused screen. */
  nodes: readonly AppFlowNode[]
  /** Capture at most this many UI states this run. Counted on variants actually captured. */
  limit?: number
}

export interface ExploreUiOutcome {
  /** The node every captured variant was attributed to, or null when none could be. */
  nodeId: string | null
  /** The variants, successes and failures alike, in the order they were attempted. */
  uiStates: AppFlowUiState[]
  /** Presentations the device could not open, with the reason a panel can show. */
  discoveryFailures: { id: string; reason: string }[]
  /** Bindings still unresolved after the symbolication join. */
  unresolvedBindings: number
  /** Whether the app was returned to the state it was found in. */
  rolledBack: boolean
  cancelled: boolean
}

/** The in-app rollback's own deadlines (2000ms modal, 4000ms control) bound this. */
export const EXPLORE_UI_ROLLBACK_TIMEOUT_MS = 8_000

/**
 * How many UI states one screen sweep captures in total. The user-editable limit the separate
 * "Start UI Explore" run had is gone, but a large app (hundreds of sheets across dozens of
 * screens, each one a settle plus a screenshot) must still not be able to turn a sweep into an
 * hours-long run, so the old default survives as an internal ceiling applied across the whole run.
 */
export const EXPLORE_UI_SWEEP_LIMIT = 10

function aborted(signal?: AbortSignal): boolean {
  return signal?.aborted === true
}

/** `screens/<slug>.png` for one variant, deduped so two variants of one name cannot collide. */
export function uiStateSlug(nodeSlug: string, actionId: string, used: Set<string>): string {
  const base = `${nodeSlug}--state-${actionId}`.replace(/[^a-zA-Z0-9]+/g, '_').replace(/_+/g, '_').toLowerCase()
  let slug = base
  let index = 2
  while (used.has(slug)) slug = `${base}_${index++}`
  used.add(slug)
  return slug
}

/**
 * The screen a variant belongs to, for the standalone run only.
 *
 * The app is wherever the user left it, so the only honest attribution is the route the navigator
 * reports as focused — matched to a saved node through the same name identity `nav-route-target.ts`
 * uses everywhere else (`id`, or the id's last segment). A focused route no saved node answers to
 * is *not* minted as a node: a presentation is evidence about a screen, and inventing the screen it
 * is evidence about would put a graph entry in front of the user that no sweep ever captured. The
 * pass stops instead, with a reason. The sweep never needs this: it passes the node it is on.
 */
export function attributeToNode(nodes: readonly AppFlowNode[], routeName: string | null): AppFlowNode | null {
  if (!routeName) return null
  const named = nodes.filter((node) => node.origin !== 'chrome' && routeAnswersTo(node, routeName))
  if (named.length !== 1) return null
  return named[0]!
}

export interface ScreenUiStatesInput {
  /** The static catalog, built once per project. */
  catalog: AppFlowPresentations
  /** The screen the device is standing on. */
  node: ExploreUiTarget
  /** Capture at most this many UI states on this screen. Counted on variants actually captured. */
  limit?: number
  /**
   * Screenshot slugs already taken this run. Shared across screens so two variants can never
   * collide on a file; a fresh set is used when omitted.
   */
  used?: Set<string>
}

export interface ScreenUiStatesOutcome {
  /** The variants, successes and failures alike, in the order they were attempted. */
  uiStates: AppFlowUiState[]
  /** Presentations the device could not open, with the reason a panel can show. */
  discoveryFailures: { id: string; reason: string }[]
  /** Bindings still unresolved after this screen's symbolication join. */
  unresolvedBindings: number
  /** Whether the app was returned to the state it was found in. False means a state may be stuck open. */
  rolledBack: boolean
  cancelled: boolean
  /**
   * Set when the pass for this screen stopped on a failure (setup refused, the transport died, ...)
   * rather than finishing. `uiStates` still holds whatever was captured before it. Never thrown:
   * the sweep must not lose a screen to this, and the standalone run decides for itself.
   */
  error?: string
}

/**
 * The pass for one screen: collect, list, then open each presentation, photograph it, roll it
 * back. Returns what was learned; writing it down is the caller's job.
 *
 * The only thing this function guarantees about the device is that it leaves the undo stack at
 * level 0 — or says it could not (`rolledBack: false`) — whatever happens. It does not throw on a
 * port failure: the failure is on the outcome, after the unwind has run.
 */
export async function captureScreenUiStates(
  input: ScreenUiStatesInput,
  ports: ExploreUiScreenPorts
): Promise<ScreenUiStatesOutcome> {
  const clock = ports.now ?? (() => Date.now())
  const passStartedAt = clock()
  const { node } = input
  const uiStates: AppFlowUiState[] = []
  const discoveryFailures: { id: string; reason: string }[] = []
  const used = input.used ?? new Set<string>()
  // Held as one mutable object rather than as locals, because the rollback verdict is decided in
  // the `finally` below — after any `return` expression would already have been evaluated.
  const result: ScreenUiStatesOutcome = {
    uiStates,
    discoveryFailures,
    unresolvedBindings: 0,
    rolledBack: true,
    cancelled: false
  }
  let opened = false
  let outcome: 'completed' | 'failed' | 'cancelled' = 'completed'

  const actions = new Map(input.catalog.actions.map((action) => [action.id, action]))
  const previews = new Map((input.catalog.previews ?? []).map((action) => [action.id, action]))
  const recipe = (id: string) => actions.get(id) ?? previews.get(id)

  try {
    ports.emit({ type: 'phase', message: 'Reading the app’s UI states…' })
    // Bindings are collected from the *mounted* tree, so this runs on every screen: a screen the
    // device has only just arrived on has none until a collect pass has seen it mounted. Bindings
    // that already have a site (from an earlier screen that is still mounted) are not re-listed
    // as unbound, so the Metro join below only pays for what is new.
    const setup = await ports.runtime.setup({
      states: [...input.catalog.states, ...(input.catalog.previewStates ?? []), ...(input.catalog.viewStates ?? [])],
      actions: [...input.catalog.actions, ...(input.catalog.previews ?? [])]
    })
    if (!setup.ok) throw new Error(setup.error ?? 'The app could not be prepared for UI exploration.')

    // The in-app pass can only attribute a binding whose owner is a candidate for exactly one
    // site. Everything else needs Metro's source maps, which only the host can read.
    const unbound = setup.unbound ?? []
    if (unbound.length) {
      const matches = await ports.bind(unbound).catch(() => [])
      if (matches.length) await ports.runtime.configure(matches)
      const resolved = new Set(matches.map((match) => match.binding))
      result.unresolvedBindings = unbound.filter((binding) => !resolved.has(binding.id)).length
    }
    recordRuntimeAmount('app_flow.runtime.presentation_unbound', result.unresolvedBindings, {
      stage: 'configure'
    })

    const listed = await ports.runtime.list()
    const limit = input.limit ?? listed.available.length
    ports.emit({
      type: 'phase',
      message: `Capturing ${Math.min(limit, listed.available.length)} UI state(s) on this screen…`,
      completed: 0,
      total: Math.min(limit, listed.available.length)
    })

    for (const entry of listed.available) {
      if (uiStates.filter((state) => state.screenshot).length >= limit) break
      if (aborted(ports.signal)) {
        result.cancelled = true
        outcome = 'cancelled'
        break
      }
      // A presentation that could not be closed leaves the app projected. Opening a second one on
      // top of it would stack projections the user would have to find, and (in a sweep) corrupt
      // every later capture, so the first failed unwind ends this screen's pass.
      if (!result.rolledBack) break
      const action = recipe(entry.id)
      if (!action) {
        discoveryFailures.push({ id: entry.id, reason: 'The device offered a presentation this catalog does not describe.' })
        continue
      }
      const openStartedAt = clock()
      const openedState = await ports.runtime.open(entry.id)
      if (!openedState.ok) {
        recordRuntimeTiming('app_flow.runtime.presentation', clock() - openStartedAt, {
          outcome: 'failed',
          kind: entry.kind
        })
        discoveryFailures.push({ id: entry.id, reason: openedState.error })
        uiStates.push({
          id: action.id,
          name: action.name,
          screenshot: null,
          file: action.file,
          line: action.line,
          ...(action.views?.length ? { sourceViews: action.views } : {}),
          error: openedState.error
        })
        // A refused open still pushes nothing, but a *partial* one may have; unwind either way,
        // and count a failed unwind exactly as the captured path does.
        const unwound = await ports.runtime.rollback(0).catch(() => ({ ok: false }))
        if (!unwound.ok) result.rolledBack = false
        continue
      }
      opened = true
      try {
        await ports.settle()
        const slug = uiStateSlug(node.slug, action.id, used)
        const screenshot = await ports.screenshot(slug)
        uiStates.push({
          id: action.id,
          name: action.name,
          screenshot,
          file: action.file,
          line: action.line,
          ...(action.views?.length ? { sourceViews: action.views } : {}),
          openedBy: openedState.kind
        })
        recordRuntimeTiming('app_flow.runtime.presentation', clock() - openStartedAt, {
          outcome: 'captured',
          kind: entry.kind
        })
        ports.emit({
          type: 'step',
          message: `Captured ${action.name}.`,
          completed: uiStates.filter((state) => state.screenshot).length,
          total: Math.min(limit, listed.available.length)
        })
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        recordRuntimeTiming('app_flow.runtime.presentation', clock() - openStartedAt, {
          outcome: 'failed',
          kind: entry.kind
        })
        discoveryFailures.push({ id: entry.id, reason })
        uiStates.push({
          id: action.id,
          name: action.name,
          screenshot: null,
          file: action.file,
          line: action.line,
          ...(action.views?.length ? { sourceViews: action.views } : {}),
          error: reason
        })
      } finally {
        // Every opened presentation is closed before the next one is opened, so a failure can
        // never leave a stack of projections on screen for the user to find.
        const unwound = await ports.runtime.rollback(0).catch(() => ({ ok: false }))
        if (!unwound.ok) result.rolledBack = false
      }
    }

    if (listed.unavailable) {
      discoveryFailures.push({
        id: '',
        reason: `${listed.unavailable} discovered UI state(s) could not be bound to anything live on this screen.`
      })
    }
  } catch (error) {
    outcome = aborted(ports.signal) ? 'cancelled' : 'failed'
    if (outcome === 'cancelled') result.cancelled = true
    result.error = error instanceof Error ? error.message : String(error)
  } finally {
    // The one unconditional thing this module does. `opened` is not a guard on *whether* to
    // unwind — a throw mid-open leaves a checkpoint the reply never reported — only on whether a
    // failed unwind is worth reporting as a projected app. A pass that stopped on a failure counts
    // as opened too: the throw may have landed between the app opening something and the reply
    // saying so.
    const unwound = await ports.runtime.rollback(0).catch(() => ({ ok: false, error: 'rollback failed' }))
    if (!unwound.ok && (opened || result.error !== undefined)) result.rolledBack = false
    recordRuntimeTiming('app_flow.runtime.presentation_pass', clock() - passStartedAt, { outcome })
  }
  return result
}

/**
 * The standalone run: attribute the focused screen, then run the per-screen pass on it.
 *
 * Throws, as it always has, when the pass cannot start or stops on a failure — the panel shows the
 * message verbatim. A failed unwind is folded into that message, because a thrown error would
 * otherwise discard the one thing the user most needs to know.
 */
export async function exploreUiStates(input: ExploreUiInput, ports: ExploreUiPorts): Promise<ExploreUiOutcome> {
  const route = await ports.focusedRoute()
  const node = attributeToNode(input.nodes, route)
  if (!node) {
    throw new Error(
      route
        ? `The screen the app is on (${route}) is not one of this project’s captured screens, so its UI states have nowhere to attach. Build the flow first, then open a captured screen.`
        : 'The app did not report a focused screen, so its UI states have nowhere to attach.'
    )
  }
  if (!node.capture) {
    throw new Error('The screen the app is on has no capture yet. Build the flow first, then open a captured screen.')
  }
  const screen = await captureScreenUiStates(
    { catalog: input.catalog, node, ...(input.limit === undefined ? {} : { limit: input.limit }) },
    ports
  )
  if (screen.error !== undefined && !screen.cancelled) {
    throw new Error(
      screen.rolledBack
        ? screen.error
        : `${screen.error.replace(/[.\s]+$/, '')}. The app may still be showing a UI state this run opened.`
    )
  }
  return {
    nodeId: node.id,
    uiStates: screen.uiStates,
    discoveryFailures: screen.discoveryFailures,
    unresolvedBindings: screen.unresolvedBindings,
    rolledBack: screen.rolledBack,
    cancelled: screen.cancelled
  }
}

/** What a sweep needs to capture UI states: the catalog and the ports bound to its own device. */
export interface SweepUiStateSession {
  catalog: AppFlowPresentations
  ports: ExploreUiScreenPorts
}

export interface SweepUiStateCapturerDeps {
  /**
   * Builds the catalog and binds the ports to the sweep's own device, ctx and CDP connection.
   * Called once, lazily, on the first screen that asks. Throws a product sentence when UI states
   * cannot be captured at all (no runtime to attach to, no UI states in the source).
   */
  open(): Promise<SweepUiStateSession>
  /** Progress for the sweep's own stream. Product prose only — no paths, ids or counts of states. */
  note(message: string): void
  /** Total UI states to capture across the sweep. Defaults to `EXPLORE_UI_SWEEP_LIMIT`. */
  limit?: number
  signal?: AbortSignal
  /** Where a failure is reported, besides the sweep's own progress stream. */
  report?(error: unknown): void
}

/**
 * The sweep-side driver: one instance per sweep, called once per delivered screen.
 *
 * It owns the three things that must outlive a single screen — the lazily opened session, the
 * sweep-wide cap, and the shared screenshot-slug set — and nothing else. `capture` never throws
 * and never fails the sweep: the worst outcome of any problem here is that a node gets no UI
 * states (or states carrying their own `error`, which the graph already renders as a disabled
 * thumbnail with the reason).
 *
 * It *latches off* on the two failures that make further attempts pointless or unsafe: a session
 * that could not be opened, and an unwind that did not reach level 0. The second is the important
 * one — the sweep reaches the next screen from this same device, so an app still showing a sheet
 * would make every later capture wrong. The sweep carries on exploring; it simply stops presenting
 * things, and says so once.
 */
export function createSweepUiStateCapturer(deps: SweepUiStateCapturerDeps) {
  const limit = deps.limit ?? EXPLORE_UI_SWEEP_LIMIT
  const used = new Set<string>()
  let session: SweepUiStateSession | null = null
  let latched = false
  let captured = 0

  return {
    /** UI states captured so far across the sweep. */
    get captured(): number {
      return captured
    },
    /** True once nothing further will be attempted (cap reached, or latched off by a failure). */
    get done(): boolean {
      return latched || captured >= limit
    },
    async capture(node: ExploreUiTarget): Promise<AppFlowUiState[] | undefined> {
      if (latched || captured >= limit || aborted(deps.signal)) return undefined
      try {
        if (!session) {
          const openStartedAt = performance.now()
          try {
            session = await deps.open()
          } finally {
            recordRuntimeTiming('app_flow.runtime.presentation_open_session', performance.now() - openStartedAt, {
              outcome: session ? 'ready' : 'unavailable'
            })
          }
        }
        const screen = await captureScreenUiStates(
          { catalog: session.catalog, node, limit: limit - captured, used },
          session.ports
        )
        captured += screen.uiStates.filter((state) => state.screenshot).length
        if (!screen.rolledBack) {
          // Reported, not swallowed: it is on the progress stream, the server log and the error
          // reporter. Nothing further is opened, because the app may still be projected.
          latched = true
          deps.note(
            'UI states stopped: the app may still be showing one this sweep opened. Remaining screens will not capture UI states.'
          )
          deps.report?.(new Error(screen.error ?? 'UI state rollback did not reach level 0.'))
        } else if (screen.error !== undefined && !screen.cancelled) {
          deps.report?.(new Error(screen.error))
        }
        return screen.uiStates.length ? screen.uiStates : undefined
      } catch (error) {
        // `open` (or an unexpected bug) threw. Nothing was opened on the device by the session
        // that failed to start, and the sweep must carry on without UI states.
        latched = true
        if (!aborted(deps.signal)) {
          deps.note(
            `UI states unavailable — ${error instanceof Error ? error.message : String(error)}`
          )
          deps.report?.(error)
        }
        return undefined
      }
    }
  }
}

export type SweepUiStateCapturer = ReturnType<typeof createSweepUiStateCapturer>

/**
 * The sweep's delivery-point fold: the capture to record for a node, with its UI states attached
 * when (and only when) the device is verifiably still on that screen.
 *
 * Only a delivery that *reached* the screen and stored a screenshot qualifies — an unreached or
 * unavailable screen has nothing the device is standing on, and presenting things on whatever it
 * happens to show would attribute them to the wrong node. The capture is returned, not mutated,
 * and is the delivery's own object untouched when nothing was captured, so the sweep's other uses
 * of `delivery.capture` (replay evidence, status) are unaffected. Never throws: see
 * `createSweepUiStateCapturer`. Resolves only after the rollback to level 0, which is what lets the
 * sweep advance from a clean app.
 */
export async function attachSweepUiStates(
  capturer: SweepUiStateCapturer | null,
  node: ExploreUiTarget,
  delivery: { kind: string; capture: AppFlowCapture }
): Promise<AppFlowCapture> {
  if (!capturer || delivery.kind !== 'reached' || !delivery.capture.screenshot) return delivery.capture
  const uiStates = await capturer.capture(node)
  return uiStates ? { ...delivery.capture, uiStates } : delivery.capture
}
