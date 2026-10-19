import { isAbsolute, relative } from 'node:path'
import { parseBaseUrl } from '../shared/protocol.ts'
import type { AppFlowPresentationAction, AppFlowPresentations, AppFlowStateSite } from '../shared/app-flow.ts'

/**
 * One hook or JSX binding reported by the in-app runtime. A binding knows only
 * where it was created — a captured `Error().stack` through the Metro bundle —
 * so nothing here can be matched to source until those frames are symbolicated.
 */
export interface AppFlowPresentationBinding {
  id: string
  owner: string
  /** `state` (the default) binds a hook call; the rest bind a creation site. */
  kind?: 'state' | 'entry' | 'portal' | 'ui-effect'
  stack?: string
  /** Already-resolved project location; skips symbolication for this binding. */
  source?: { file: string; line: number; column: number }
}

/** A project location, in the shape Metro's `/symbolicate` returns. */
interface AppFlowSymbolicatedFrame {
  file?: string
  lineNumber?: number
  column?: number
}

/** Proven attach/detach property names of a portal provider's value. */
export interface AppFlowUiPortalMethods {
  append: string
  remove: string
}

/** A mount effect proven to open one dependency's UI control. */
export interface AppFlowUiOpenEffect {
  dependency: number
  method: string
}

/**
 * Everything this module touches outside its own arguments. The caller supplies
 * Metro and the filesystem so the join stays pure and testable.
 */
export interface AppFlowBindingPorts {
  /** Loopback Metro origin, for example `http://localhost:8081`. */
  metroOrigin: string
  fetch?: typeof globalThis.fetch
  /** Milliseconds allowed per `/symbolicate` batch. */
  timeoutMs?: number
  signal?: AbortSignal
  /**
   * Reads one absolute project file for the deferred portal/ui-effect leg.
   * Returning `undefined` (the default) disables that leg entirely.
   */
  readSource?(file: string): Promise<string | undefined>
  /**
   * Source analysers for the deferred leg. They live in the unported portal and
   * mount-effect scan stages, so this module takes them as ports rather than
   * importing a second TypeScript AST walker it cannot otherwise justify.
   */
  sourceUiPortal?(source: string, line: number, column: number): AppFlowUiPortalMethods | false
  sourceUiOpenEffect?(source: string, line: number, column: number): AppFlowUiOpenEffect | undefined
}

/** One runtime binding resolved onto one statically discovered site. */
export interface AppFlowPresentationBindingMatch {
  binding: string
  site: string
}

/** Bindings considered per call; a runaway app cannot flood Metro. */
const bindingLimit = 3000
/** Stack frames read per binding. */
const frameLimit = 16
/** Frames sent per `/symbolicate` request. */
const batchSize = 120
/** Largest project file the deferred leg will parse. */
const sourceLimit = 512_000

const framePatterns = [
  /at\s+(.*?)\s+\((?:address at )?(https?:\/\/.*):(\d+):(\d+)\)/,
  /^(.*?)@(https?:\/\/.*):(\d+):(\d+)$/,
]

/** True when `file` is a project-relative path outside `node_modules`. */
function isProjectFile(file: string): boolean {
  return !isAbsolute(file) && !file.startsWith('..') && !file.split(/[\\/]/).includes('node_modules')
}

/** True when `line`/`column` falls inside `[start, end)` of a source range. */
function contains(
  range: { line: number; column: number; endLine: number; endColumn?: number } | undefined,
  line: number,
  column: number | undefined,
): boolean {
  if (!range || line < range.line || line > range.endLine) return false
  if (column === undefined) return false
  if (line === range.line && column < range.column) return false
  if (range.endColumn !== undefined && line === range.endLine && column >= range.endColumn) return false
  return true
}

/**
 * Resolve runtime presentation bindings onto statically discovered sites.
 *
 * There is no build-time instrumentation step, so a live hook is identified
 * only by its creation stack. Metro's source maps are the one route back to a
 * `useState` call or a JSX entry in the user's own source; without this join the
 * in-app runtime can force a state but cannot say which presentation it is.
 *
 * Returns `{binding, site}` pairs, the payload a `presentation-configure`
 * command hands back to the device. Wiring is a later stage.
 */
export async function bindPresentationSites(
  root: string,
  bindings: AppFlowPresentationBinding[],
  presentations: Pick<AppFlowPresentations, 'states' | 'actions'>,
  ports: AppFlowBindingPorts,
): Promise<AppFlowPresentationBindingMatch[]> {
  const base = parseBaseUrl(ports.metroOrigin, 'Metro URL')
  const states = presentations.states ?? []
  const actions = presentations.actions ?? []

  const frames: { file: string; methodName: string; lineNumber: number; column: number }[] = []
  const frameIds = new Map<string, number>()
  const references: { owner: AppFlowPresentationBinding; index: number }[] = []
  const resolved: (AppFlowSymbolicatedFrame | undefined)[] = []

  const matches: AppFlowPresentationBindingMatch[] = []
  const resolvedEntries = new Set<string>()
  const resolvedStates = new Set<string>()
  const deferred: { binding: string; frame: AppFlowSymbolicatedFrame }[] = []

  const matchFrame = (binding: AppFlowPresentationBinding, frame: AppFlowSymbolicatedFrame) => {
    const line = frame.lineNumber
    if (!frame.file || line === undefined || !Number.isInteger(line)) return
    if (binding.kind === 'portal' || binding.kind === 'ui-effect') {
      deferred.push({ binding: binding.id, frame })
      return
    }
    const file = relative(root, frame.file.replace(/^file:\/\//, ''))
    if (!isProjectFile(file)) return
    const column = frame.column

    if (binding.kind === 'entry') {
      // Only the first project frame owns this JSX. An ancestor render frame
      // must not turn a nested or unrelated button into a presentation entry.
      if (resolvedEntries.has(binding.id)) return
      resolvedEntries.add(binding.id)

      for (const site of states) {
        for (const entry of site.ownerEntries ?? []) {
          if (entry.component !== binding.owner || entry.file !== file) continue
          if (!contains(entry.source, line, column)) continue
          matches.push({ binding: binding.id, site: `owner:${site.id}:${entry.component}` })
        }
      }

      for (const action of actions) {
        if (action.effect?.kind === 'mount') continue
        const sites = entrySites(action, binding.owner)
        for (const site of sites) {
          if (site.file !== file || !contains(site.source, line, column)) continue
          matches.push({ binding: binding.id, site: site.id })
        }
      }
      return
    }

    // Ambiguity means no binding: forcing the wrong hook is worse than forcing
    // none, so a frame covered by two state sites resolves to neither.
    const candidates = states.filter(site => site.file === file
      && line >= site.line && line <= site.endLine
      && (column === undefined || site.endColumn === undefined
        || !((line === site.line && column < site.column) || (line === site.endLine && column >= site.endColumn))))
    if (candidates.length !== 1 || resolvedStates.has(binding.id)) return
    resolvedStates.add(binding.id)
    matches.push({ binding: binding.id, site: candidates[0].id })
  }

  for (const binding of bindings.slice(0, bindingLimit)) {
    if (binding.source) {
      matchFrame(binding, { file: binding.source.file, lineNumber: binding.source.line, column: binding.source.column })
      continue
    }
    for (const line of (binding.stack ?? '').split('\n').slice(0, frameLimit)) {
      const match = framePatterns[0].exec(line) ?? framePatterns[1].exec(line)
      if (!match) continue
      let url: URL
      try { url = new URL(match[2]) } catch { continue }
      if (url.origin !== base.origin) continue
      const frame = { file: url.href, methodName: match[1], lineNumber: Number(match[3]), column: Math.max(0, Number(match[4]) - 1) }
      const key = JSON.stringify(frame)
      let index = frameIds.get(key)
      if (index === undefined) {
        index = frames.length
        frameIds.set(key, index)
        frames.push(frame)
      }
      references.push({ owner: binding, index })
    }
  }

  await symbolicate(base, frames, resolved, ports)

  // Shared creation stacks need one lookup per distinct frame. Replay each
  // owner's original frame order so an ancestor cannot claim a nested entry.
  for (const reference of references) {
    const frame = resolved[reference.index]
    if (frame) matchFrame(reference.owner, frame)
  }

  await resolveDeferred(root, bindings, deferred, matches, ports)
  return matches
}

/**
 * Candidate JSX ranges one action contributes, for the entry leg.
 *
 * A's handoff leg (`action.handoffs`) has no counterpart here: the static scan
 * deliberately dropped that field with the stages that produce it. Rather than
 * invent data, the leg is left out; restore it beside `consumer` when handoffs
 * land.
 */
function entrySites(action: AppFlowPresentationAction, owner: string) {
  const sites: { file: string; source: { line: number; column: number; endLine: number; endColumn: number } | undefined; id: string }[] = [
    { file: action.file, source: action.source, id: action.id },
  ]
  if (action.expected && action.expected.component === owner) {
    sites.push({ file: action.expected.file, source: action.expected.source, id: `${action.id}:expected` })
  }
  if (action.effect?.kind === 'control' && action.effect.target) {
    sites.push({ file: action.effect.target.file, source: action.effect.target.source, id: `${action.id}:target` })
  }
  for (const entry of action.consumer?.entries ?? []) {
    sites.push({ file: entry.file, source: entry.source, id: `${action.id}:consumer` })
  }
  return sites
}

/** Map bundle frames onto project locations, in bounded batches. */
async function symbolicate(
  base: URL,
  frames: { file: string; methodName: string; lineNumber: number; column: number }[],
  resolved: (AppFlowSymbolicatedFrame | undefined)[],
  ports: AppFlowBindingPorts,
): Promise<void> {
  if (!frames.length) return
  const request = ports.fetch ?? globalThis.fetch
  for (let offset = 0; offset < frames.length; offset += batchSize) {
    const batch = frames.slice(offset, offset + batchSize)
    try {
      const response = await request(new URL('/symbolicate', base), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stack: batch }),
        redirect: 'error',
        signal: AbortSignal.any([AbortSignal.timeout(ports.timeoutMs ?? 3000), ...(ports.signal ? [ports.signal] : [])]),
      })
      if (!response.ok) continue
      const result = await response.json() as { stack?: AppFlowSymbolicatedFrame[] }
      // A failed or partial lookup costs a binding, never the whole join.
      for (const [index, frame] of (result.stack ?? []).slice(0, batch.length).entries()) resolved[offset + index] = frame
    } catch { /* Metro is optional here; unresolved frames simply bind nothing. */ }
  }
}

/**
 * Portal and mount-effect bindings cannot be decided from a location alone —
 * they need the surrounding source proved safe to drive. Both analysers are
 * supplied by the caller, so an unported stage leaves the leg inert.
 */
async function resolveDeferred(
  root: string,
  bindings: AppFlowPresentationBinding[],
  deferred: { binding: string; frame: AppFlowSymbolicatedFrame }[],
  matches: AppFlowPresentationBindingMatch[],
  ports: AppFlowBindingPorts,
): Promise<void> {
  if (!deferred.length || !ports.readSource) return
  const sources = new Map<string, string | undefined>()
  const matched = new Set<string>()
  for (const { binding, frame } of deferred) {
    if (matched.has(binding)) continue
    try {
      const file = frame.file!.replace(/^file:\/\//, '')
      if (!isProjectFile(relative(root, file))) continue
      if (!sources.has(file)) sources.set(file, await ports.readSource(file))
      const source = sources.get(file)
      if (source === undefined || source.length > sourceLimit) continue
      const kind = bindings.find(candidate => candidate.id === binding)?.kind
      const line = frame.lineNumber!, column = frame.column ?? 0
      const opening = kind === 'ui-effect' ? ports.sourceUiOpenEffect?.(source, line, column) : undefined
      const portal = !opening && kind === 'portal' ? ports.sourceUiPortal?.(source, line, column) : false
      const site = opening ? `ui-effect:${opening.dependency}:${opening.method}`
        : portal ? `portal:${portal.append}:${portal.remove}`
        : undefined
      if (!site) continue
      matches.push({ binding, site })
      matched.add(binding)
    } catch { /* Unknown or unavailable source never enables a portal preview. */ }
  }
}
