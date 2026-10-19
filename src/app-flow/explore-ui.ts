/**
 * The explore-UI pass: open every UI state a screen's own source proves it can open, photograph
 * each one, and put the app back exactly as it was found.
 *
 * It is not a sweep. Nothing is navigated to, nothing is tapped, no model is asked anything, and
 * no graph node is minted. The app is wherever the user left it; the pass asks the already-running
 * app which of the statically discovered presentations it can open *right now*, opens them one at
 * a time by calling the app's own setter or controller, photographs the result through the same
 * capture path the sweep uses, and rolls back.
 *
 * Everything that touches a device, Metro, the filesystem or the clock is a port, so the whole
 * sequence — the limit, the attribution, the failure accounting and above all the rollback
 * discipline — runs under `node --test` without a simulator. `explore-ui-run.ts` is the only file
 * that implements these ports against real things.
 *
 * ## Rollback is the safety-critical part
 *
 * A projected app is a *broken* app from the user's point of view: a sheet they did not open, a
 * modal they cannot dismiss, a screen replaced by a preview. Every exit from this module — the
 * happy path, a thrown port, an aborted signal, a limit reached, a timeout — goes through the same
 * `finally` that unwinds the runtime's undo stack to level 0. The in-app rollback carries its own
 * deadlines (2000ms for a modal dismissal, 4000ms for a controller-owned close) and can throw on
 * an iOS detached owner; those are honoured by giving the call its own timeout above them and by
 * reporting a failed unwind rather than swallowing it.
 */
import type {
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

export interface ExploreUiPorts {
  runtime: ExploreUiRuntimePort
  /**
   * The Metro symbolication join (`bindPresentationSites`). A failure here costs bindings, never
   * the pass: an unresolved binding simply means one fewer openable presentation.
   */
  bind(bindings: readonly ExploreUiUnboundBinding[]): Promise<{ binding: string; site: string }[]>
  /** Which route the app is focused on right now — the last entry of the runtime's nav state. */
  focusedRoute(): Promise<string | null>
  /** The Fast path's own settle/readiness wait, after a presentation has been opened. */
  settle(): Promise<void>
  /** Take one screenshot into `screens/<slug>.png`; resolves to the stored relative path. */
  screenshot(slug: string): Promise<string>
  /** Progress for the panel. Messages are product prose; no paths, no ids. */
  emit(event: { type: 'phase' | 'step' | 'error' | 'complete'; message: string; completed?: number; total?: number }): void
  signal?: AbortSignal
  now?(): number
}

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
 * The screen a variant belongs to.
 *
 * The app is wherever the user left it, so the only honest attribution is the route the navigator
 * reports as focused — matched to a saved node through the same name identity `nav-route-target.ts`
 * uses everywhere else (`id`, or the id's last segment). A focused route no saved node answers to
 * is *not* minted as a node: a presentation is evidence about a screen, and inventing the screen it
 * is evidence about would put a graph entry in front of the user that no sweep ever captured. The
 * pass stops instead, with a reason.
 */
export function attributeToNode(nodes: readonly AppFlowNode[], routeName: string | null): AppFlowNode | null {
  if (!routeName) return null
  const named = nodes.filter((node) => node.origin !== 'chrome' && routeAnswersTo(node, routeName))
  if (named.length !== 1) return null
  return named[0]!
}

/**
 * Open each listed presentation, photograph it, roll it back.
 *
 * Returns what was learned; writing it down is the caller's job. The only thing this function
 * guarantees about the device is that it leaves the undo stack at level 0, whatever happens.
 */
export async function exploreUiStates(input: ExploreUiInput, ports: ExploreUiPorts): Promise<ExploreUiOutcome> {
  const clock = ports.now ?? (() => Date.now())
  const passStartedAt = clock()
  const uiStates: AppFlowUiState[] = []
  const discoveryFailures: { id: string; reason: string }[] = []
  const used = new Set<string>()
  // Held as one mutable object rather than as locals, because the rollback verdict is decided in
  // the `finally` below — after any `return` expression would already have been evaluated.
  const result: ExploreUiOutcome = {
    nodeId: null,
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
        // A refused open still pushes nothing, but a *partial* one may have; unwind either way.
        await ports.runtime.rollback(0).catch(() => undefined)
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
    result.nodeId = node.id
  } catch (error) {
    outcome = aborted(ports.signal) ? 'cancelled' : 'failed'
    throw error
  } finally {
    // The one unconditional thing this module does. `opened` is not a guard on *whether* to
    // unwind — a throw mid-open leaves a checkpoint the reply never reported — only on whether a
    // failed unwind is worth reporting as a projected app.
    const unwound = await ports.runtime.rollback(0).catch(() => ({ ok: false, error: 'rollback failed' }))
    if (!unwound.ok && opened) result.rolledBack = false
    recordRuntimeTiming('app_flow.runtime.presentation_pass', clock() - passStartedAt, { outcome })
  }
  return result
}
