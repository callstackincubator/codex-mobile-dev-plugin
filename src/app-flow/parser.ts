import { readdir, readFile, stat } from 'node:fs/promises'
import { dirname, extname, join, posix, relative, resolve } from 'node:path'
import ts from 'typescript'
import type {
  AppFlowEdge,
  AppFlowGuard,
  AppFlowLayout,
  AppFlowNode,
  AppFlowProjectKind,
  AppFlowSwiftProject,
  AppFlowTrigger
} from '../shared/app-flow.ts'
import { recordRuntimeTiming } from './runtime-telemetry.ts'
import { detectSwiftProject, readAppUrlScheme } from './swift-project.ts'
import { buildSwiftScreenGraph } from './swift-graph.ts'
import { SwiftParseUnavailableError, parseSwiftSourceRoots } from './swift-parse.ts'

// Re-exported so existing imports of `AppFlowLayout` from this module keep compiling — the type
// itself moved to `shared/app-flow.ts` because `AppFlowResult.navigation` persists it verbatim into
// `app-flow.json`, which the renderer also reads, and `parser.ts` is main-process-only.
export type { AppFlowLayout }

function generateSlug(routeId: string): string {
  return routeId
    .replace(/[^a-zA-Z0-9]/g, '_')
    .replace(/_+/g, '_')
    .toLowerCase()
}

/**
 * How much to trust `scheme` for building a working deep link:
 * - `verified-prefix`: the linking config's own `prefixes` array names this scheme, so React
 *   Navigation will actually route a URL opened with it.
 * - `scheme-mismatch`: a `prefixes` array was found, but this scheme is not in it. iOS will still
 *   open the app (the scheme is registered in Info.plist independently of `prefixes`), but React
 *   Navigation ignores a URL whose prefix it does not recognise, so the app just sits on whatever
 *   it already had open — indistinguishable at runtime from landing on the wrong screen.
 * - `assumed`: no `prefixes` array was found at all (or it held only universal `https://` links),
 *   so there is nothing to check `expo.scheme` against; it is used on faith, as before this fix.
 */
export type DeepLinkConfidence = 'verified-prefix' | 'scheme-mismatch' | 'assumed'

export interface ParsedAppGraph {
  /**
   * Which toolchain this project is built with. `swiftui` was added alongside Swift detection; the
   * two React Native values are unchanged, and nothing that branches on them had to move.
   */
  mode: AppFlowProjectKind
  /**
   * What a cheap scan found about an iOS/SwiftUI project — its workspace/project/package, source
   * roots and shared schemes. Null for every React Native project, so `mode === 'swiftui'` and
   * `swift !== null` always agree.
   */
  swift: AppFlowSwiftProject | null
  /**
   * Why a detected SwiftUI project came back with no screens, when that is the reason.
   *
   * Absent on every React Native project and on a Swift project the parser read successfully —
   * including one that genuinely holds no SwiftUI, which is a true answer and not an error. Present
   * only when the parser could not be run or could not be read: no toolchain, a build failure, a
   * report from a contract this plugin does not know. The distinction matters because the two look
   * identical from the outside, and telling a user their app has no screens when the parser never
   * ran is the kind of plausible wrong answer this seam exists to prevent.
   */
  swiftParseError?: string
  appDir: string | null
  routesFile: string | null
  scheme: string | null
  /** Confidence that `scheme` is one React Navigation's `linking.prefixes` will actually route. */
  deepLinkConfidence: DeepLinkConfidence
  /** Raw `prefixes` entries read off the linking config, custom-scheme and universal alike. */
  linkingPrefixes: string[]
  appName: string | null
  bundleId: string | null
  slug: string | null
  nodes: AppFlowNode[]
  edges: AppFlowEdge[]
  /**
   * The navigator tree. Without it nothing in the graph says the app opens on a tab bar, so an
   * explorer has no idea where a journey starts and picks whichever screen an over-approximated
   * edge chain happens to dead-end at.
   */
  layouts: AppFlowLayout[]
  /** Kind of the root navigator, e.g. `Tabs`. */
  rootNavigator: string | null
  /** Layouts mounted directly on the root — the tabs a journey can start from. */
  entryLayouts: string[]
  /**
   * Node ids the app's entry chrome opens DIRECTLY — each entry layout's own declared
   * `initialRouteName` (or, absent that, its first registered screen, matching React Navigation's
   * own default). This is deliberately a different concept from `entryLayouts`/`group`: `group` is
   * ATTRIBUTION (which navigator registers a screen — a helper called from five tabs belongs to
   * all five), while this is REACHABILITY (which single screen in each of those tabs a person
   * lands on without navigating anywhere first). Conflating the two previously meant that every
   * screen sharing a `group` with an entry layout — 78 of 83 in social-app, most of them behind a
   * shared registration helper — was treated as one tap from launch, which both fabricated a
   * one-hop journey for screens nested many pushes deep and suppressed the "explore from the entry
   * chrome" instruction the planner needs for a genuine orphan.
   */
  entryScreenIds: string[]
}

/** Navigator kind for a `create*Navigator` factory, including project-specific wrappers. */
function classifyNavigatorFactory(factory: string): string {
  if (/MaterialTopTab|TopTab/.test(factory)) return 'TopTabs'
  if (/BottomTab|\bTabs?Navigator/.test(factory)) return 'Tabs'
  if (/Drawer/.test(factory)) return 'Drawer'
  return 'Stack'
}

interface RawRouteEntry {
  abs: string
  noExt: string
  base: string
  dir: string
}

interface LayoutEntry {
  file: string
  dir: string
  navigator: string | null
  src: string
}

interface PathAlias {
  prefix: string
  target: string
}

interface ScreenTitleHit {
  name: string | null
  href: string | null
  title: string
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Both parsers build their edge list by scanning every screen's source for call sites, which is
// inherently noisy in two ways this cleans up once at the end rather than guarding every producer
// above: (1) a screen that calls `navigate()` on its own route name — observed from a NotFound
// fallback resolving `navigate('HomeTab')` back to the tab it is already inside — draws a self-loop
// that says nothing; (2) the same call site can be matched by more than one heuristic (e.g. a
// `navigate()` call inside an anchor's `onPress`, also caught by the `href` scan), producing an
// exact duplicate edge. Both are noise, never signal, so they are dropped after building rather
// than reasoned about while building.
function finalizeEdges(edges: AppFlowEdge[]): AppFlowEdge[] {
  const seenKeys = new Set<string>()
  const out: AppFlowEdge[] = []
  for (const edge of edges) {
    if (edge.from === edge.to) continue
    const key = `${edge.from}\0${edge.to}\0${edge.kind ?? ''}`
    if (seenKeys.has(key)) continue
    seenKeys.add(key)
    out.push(edge)
  }
  return out
}

function routeMatcher(urlPath: string): RegExp {
  const re = urlPath
    .split('/')
    .map((seg) =>
      seg.startsWith('[...')
        ? '.*'
        : seg.startsWith('[') || seg.startsWith(':')
          ? '[^/]+'
          : escapeRe(seg)
    )
    .join('/')
  return new RegExp('^' + re + '/?$')
}

/**
 * Components a screen renders *instead of itself* when a gate is closed. Anything outside this list
 * is ordinary conditional content, not a whole-screen swap, so it must not read as a guard.
 */
const GUARD_FALLBACK_RE = /^(?:NotFound|Unavailable|Forbidden|NoAccess|AccessDenied)/

/** Reads a parenthesised span starting at `open`, honouring nesting. */
function readBalancedParens(src: string, open: number): { text: string; end: number } | null {
  let depth = 0
  for (let index = open; index < src.length; index++) {
    const char = src[index]
    if (char === '(') depth += 1
    else if (char === ')') {
      depth -= 1
      if (depth === 0) return { text: src.slice(open + 1, index), end: index }
    }
  }
  return null
}

/**
 * Finds a gate that replaces the whole screen with a not-found-style fallback.
 *
 * The route is registered either way, so a deep link to a gated screen resolves and then renders a
 * 404 — indistinguishable at runtime from a URL that was simply wrong. Reading the gate off the
 * component tells the sweep which of the two it is, and saves it exploring for an entry point that
 * this build does not render.
 */
/**
 * Inlines a condition that is just a local flag (`!isEnabled`) with the expression it was assigned,
 * so the recorded reason names the gate itself rather than the variable holding it.
 */
function resolveGuardCondition(src: string, condition: string): string {
  const bare = /^(!?)([A-Za-z_$][\w$]*)$/.exec(condition)
  if (!bare) return condition
  const assigned = new RegExp(
    `\\b(?:const|let|var)\\s+${escapeRe(bare[2])}\\s*(?::[^=\n]*)?=\\s*([^\n;]+)`
  ).exec(src)?.[1]
  return assigned ? `${bare[1]}${assigned.trim().replace(/\s+/g, ' ')}` : condition
}

export function extractGuard(src: string): AppFlowGuard | null {
  for (const match of src.matchAll(/\bif\s*\(/g)) {
    const open = match.index + match[0].length - 1
    const condition = readBalancedParens(src, open)
    if (!condition) continue
    // Only an immediate return counts: a fallback further down the block is reached by other paths
    // too, so it says nothing about how this screen renders when the gate is closed.
    const returned = /^\s*\{?\s*return\s*\(?\s*<\s*([A-Za-z_$][\w$.]*)/.exec(
      src.slice(condition.end + 1, condition.end + 200)
    )
    if (!returned || !GUARD_FALLBACK_RE.test(returned[1])) continue
    const text = condition.text.replace(/\s+/g, ' ').trim()
    if (text) return { condition: resolveGuardCondition(src, text), fallback: returned[1] }
  }
  return null
}

async function walk(dir: string): Promise<string[]> {
  const out: string[] = []
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...(await walk(p)))
    } else {
      out.push(p)
    }
  }
  return out
}

export interface AppConfigInfo {
  scheme: string | null
  name: string | null
  slug: string | null
  bundleId: string | null
}

function firstString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (Array.isArray(value) && typeof value[0] === 'string' && value[0].trim()) {
    return value[0].trim()
  }
  return null
}

export async function readAppConfig(projectRoot: string): Promise<AppConfigInfo> {
  const empty: AppConfigInfo = { scheme: null, name: null, slug: null, bundleId: null }
  try {
    const cfg = JSON.parse(await readFile(join(projectRoot, 'app.json'), 'utf-8')) as {
      expo?: {
        scheme?: string | string[]
        name?: string
        slug?: string
        ios?: { bundleIdentifier?: string }
      }
      scheme?: string | string[]
      name?: string
    }
    const expo = cfg.expo ?? {}
    return {
      scheme: firstString(expo.scheme ?? cfg.scheme),
      name: firstString(expo.name ?? cfg.name),
      slug: firstString(expo.slug),
      bundleId: firstString(expo.ios?.bundleIdentifier)
    }
  } catch {
    // fall through to app.config.*
  }
  for (const f of ['app.config.js', 'app.config.ts']) {
    try {
      const src = await readFile(join(projectRoot, f), 'utf-8')
      return {
        scheme: src.match(/\bscheme\s*:\s*["']([A-Za-z0-9._+-]+)["']/)?.[1] ?? null,
        name: src.match(/\bname\s*:\s*["']([^"']+)["']/)?.[1] ?? null,
        slug: src.match(/\bslug\s*:\s*["']([A-Za-z0-9._+-]+)["']/)?.[1] ?? null,
        bundleId: src.match(/\bbundleIdentifier\s*:\s*["']([A-Za-z0-9.]+)["']/)?.[1] ?? null
      }
    } catch {
      // ignore
    }
  }
  return empty
}

function toUrlPath(noExt: string): string {
  const segments = noExt.split('/')
  if (segments[segments.length - 1] === 'index') segments.pop()
  const urlSegments = segments.filter((s) => !(s.startsWith('(') && s.endsWith(')')))
  return '/' + urlSegments.join('/')
}

function extractParams(segments: string[]): string[] {
  return segments
    .filter((s) => s.startsWith('[') && s.endsWith(']'))
    .map((s) => s.slice(1, -1).replace(/^\.\.\./, ''))
}

function toSlug(noExt: string): string {
  let s = noExt === 'index' ? 'index' : noExt.replace(/\/index$/, '')
  s = s
    .replace(/[()[\]]/g, '')
    .replace(/\.\.\./g, '')
    .replace(/\//g, '_')
  return generateSlug(s || 'index')
}

function fallbackTitle(noExt: string): string {
  const last = posix.basename(noExt)
  if (last === 'index') return 'index'
  const cleaned = last
    .replace(/^\[(?:\.\.\.)?/, '')
    .replace(/\]$/, '')
    .replace(/[-_]+/g, ' ')
  return cleaned.replace(/\b[a-z]/g, (c) => c.toUpperCase()) || 'Screen'
}

function isUpwardHref(raw: string): boolean {
  return raw.split(/[?#]/)[0].split('/').includes('..')
}

const SOURCE_EXTS = [
  '.ios.tsx',
  '.native.tsx',
  '.ios.ts',
  '.native.ts',
  '.tsx',
  '.ts',
  '.ios.jsx',
  '.native.jsx',
  '.jsx',
  '.js'
]
const IMPORT_RE = /(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g

async function loadPathAliases(projectRoot: string): Promise<PathAlias[]> {
  const defaults: PathAlias[] = [
    { prefix: '@/', target: 'src/' },
    { prefix: '@/', target: '' }
  ]
  try {
    const configPath = ts.findConfigFile(projectRoot, ts.sys.fileExists, 'tsconfig.json')
    if (!configPath) return defaults
    const parsed = ts.getParsedCommandLineOfConfigFile(
      configPath,
      {},
      {
        ...ts.sys,
        onUnRecoverableConfigFileDiagnostic: () => undefined
      }
    )
    const paths = parsed?.options.paths
    if (!paths) return defaults
    const baseUrl = parsed.options.baseUrl ?? projectRoot
    const aliases = Object.entries(paths).map(([key, targets]) => ({
      prefix: key.replace(/\*$/, ''),
      target: resolve(baseUrl, (targets[0] ?? '').replace(/\*$/, ''))
    }))
    aliases.sort((a, b) => b.prefix.length - a.prefix.length)
    return aliases.length > 0 ? aliases : defaults
  } catch {
    return defaults
  }
}

async function resolveWithExt(base: string): Promise<string | null> {
  for (const ext of SOURCE_EXTS) {
    try {
      const candidate = base + ext
      if ((await stat(candidate)).isFile()) return candidate
    } catch {
      // keep looking
    }
  }
  for (const ext of SOURCE_EXTS) {
    try {
      const candidate = join(base, 'index' + ext)
      if ((await stat(candidate)).isFile()) return candidate
    } catch {
      // keep looking
    }
  }
  try {
    if ((await stat(base)).isFile()) return base
  } catch {
    // not a file
  }
  return null
}

async function resolveImport(
  fromFile: string,
  spec: string,
  aliases: PathAlias[]
): Promise<string | null> {
  if (spec.startsWith('.')) {
    return resolveWithExt(resolve(dirname(fromFile), spec))
  }
  for (const alias of aliases) {
    if (spec === alias.prefix.replace(/\/$/, '') || spec.startsWith(alias.prefix)) {
      const rest = spec.startsWith(alias.prefix) ? spec.slice(alias.prefix.length) : ''
      const resolved = await resolveWithExt(resolve(alias.target, rest))
      if (resolved) return resolved
    }
  }
  return null
}

async function loadLayoutSource(layoutFile: string, aliases: PathAlias[]): Promise<string> {
  const src = await readFile(layoutFile, 'utf-8')
  const chunks = [src]
  for (const match of src.matchAll(IMPORT_RE)) {
    const resolved = await resolveImport(layoutFile, match[1], aliases)
    if (!resolved) continue
    chunks.push(await readFile(resolved, 'utf-8'))
  }
  return chunks.join('\n')
}

function extractScreenTitles(src: string): ScreenTitleHit[] {
  const hits: ScreenTitleHit[] = []

  for (const match of src.matchAll(
    /<NativeTabs\.Trigger\b([^>]*)>([\s\S]*?)<\/NativeTabs\.Trigger>/g
  )) {
    const name = match[1].match(/\bname\s*=\s*["']([^"']+)["']/)?.[1] ?? null
    const href = match[1].match(/\bhref\s*=\s*["']([^"']+)["']/)?.[1] ?? null
    const title =
      match[2]
        .match(/<NativeTabs\.Trigger\.Label>([^<]+)<\/NativeTabs\.Trigger\.Label>/)?.[1]
        ?.trim() ??
      match[2].match(/<Label>([^<]+)<\/Label>/)?.[1]?.trim() ??
      null
    if (title) hits.push({ name, href, title })
  }

  for (const match of src.matchAll(/<(?:[\w.]*Screen)\b([^>]*?)(?:\/>|>)/g)) {
    const attrs = match[1]
    const name = attrs.match(/\bname\s*=\s*["']([^"']+)["']/)?.[1] ?? null
    const title =
      attrs.match(/\btitle\s*:\s*["']([^"']+)["']/)?.[1] ??
      attrs.match(/\btitle\s*=\s*["']([^"']+)["']/)?.[1] ??
      null
    if (name && title) hits.push({ name, href: null, title })
  }

  return hits
}

function titleForRoute(
  noExt: string,
  urlPath: string,
  layoutDir: string,
  titlesByDir: Record<string, ScreenTitleHit[]>
): string {
  let dir = layoutDir
  while (true) {
    const localName = dir
      ? noExt.startsWith(`${dir}/`)
        ? noExt.slice(dir.length + 1)
        : noExt
      : noExt
    const hit = (titlesByDir[dir] ?? []).find(
      (item) =>
        item.name === localName ||
        item.name === posix.basename(noExt) ||
        (item.href != null && item.href.split(/[?#]/)[0] === urlPath)
    )
    if (hit) return hit.title
    if (dir === '') break
    const parent = posix.dirname(dir)
    dir = parent === '.' ? '' : parent
  }
  return fallbackTitle(noExt)
}

export async function parseExpoRouter(
  projectRoot: string,
  appDir: string
): Promise<ParsedAppGraph> {
  const EXTS = new Set(['.tsx', '.jsx', '.ts', '.js'])
  const NON_ROUTE_BASES = new Set(['+html', '+native-intent', '+middleware'])
  const rel = (p: string): string => relative(projectRoot, p).split(/[/\\]/).join('/')
  const aliases = await loadPathAliases(projectRoot)

  const startedAt = Date.now()
  const allFiles = await walk(appDir)
  console.log(`[app-flow] parse: walked ${appDir} — ${allFiles.length} files`)
  const entries: RawRouteEntry[] = await Promise.all(
    allFiles
      .filter((f) => EXTS.has(extname(f)))
      .map(async (f) => {
        const relApp = relative(appDir, f).split(/[/\\]/).join('/')
        const noExt = relApp.slice(0, -extname(relApp).length)
        const base = posix.basename(noExt)
        const dir = posix.dirname(noExt)
        return { abs: f, noExt, base, dir: dir === '.' ? '' : dir }
      })
  )

  const routeEntries = entries.filter(
    (e) => !e.base.endsWith('+api') && !NON_ROUTE_BASES.has(e.base)
  )
  const layoutEntries = routeEntries.filter((e) => e.base === '_layout')
  const screenEntries = routeEntries.filter((e) => e.base !== '_layout')

  console.log(
    `[app-flow] parse: ${screenEntries.length} screen files, ${layoutEntries.length} layouts`
  )

  const layoutsByDir: Record<string, LayoutEntry> = {}
  const titlesByDir: Record<string, ScreenTitleHit[]> = {}
  for (const l of layoutEntries) {
    const src = await loadLayoutSource(l.abs, aliases)
    const nav = src.match(/<\s*(NativeTabs|Tabs|Stack|Drawer|Slot)\b/)
    layoutsByDir[l.dir] = {
      file: rel(l.abs),
      dir: l.dir,
      navigator: nav ? nav[1] : null,
      src
    }
    titlesByDir[l.dir] = extractScreenTitles(src)
  }

  function nearestLayout(dir: string): LayoutEntry | null {
    let d = dir
    while (true) {
      if (layoutsByDir[d]) return layoutsByDir[d]
      if (d === '') return null
      const parent = posix.dirname(d)
      d = parent === '.' ? '' : parent
    }
  }

  console.log(`[app-flow] parse: layouts loaded (${Date.now() - startedAt}ms)`)

  const presentations: Array<{ prefix: string; presentation: string }> = []
  for (const l of Object.values(layoutsByDir)) {
    for (const tag of l.src.match(/<[\w.]*Screen\b[^>]*>/g) ?? []) {
      const name = tag.match(/name\s*=\s*["']([^"']+)["']/)?.[1]
      const presentation = tag.match(/presentation\s*:\s*["']([a-zA-Z]+)["']/)?.[1]
      if (name && presentation) {
        presentations.push({ prefix: l.dir ? `${l.dir}/${name}` : name, presentation })
      }
    }
  }

  const nodes: AppFlowNode[] = await Promise.all(
    screenEntries.map(async (e) => {
      const segments = e.noExt.split('/')
      if (segments[segments.length - 1] === 'index') segments.pop()
      const urlPath = toUrlPath(e.noExt)
      const params = extractParams(segments)
      const layout = nearestLayout(e.dir)
      const title = titleForRoute(e.noExt, urlPath, layout?.dir ?? '', titlesByDir)
      const presentation =
        presentations.find((p) => e.noExt === p.prefix || e.noExt.startsWith(p.prefix + '/'))
          ?.presentation ?? null
      const src = await readFile(e.abs, 'utf-8')
      const guard = extractGuard(src)
      return {
        id: e.noExt,
        urlPath,
        reach: 'deep-link' as const,
        title,
        file: rel(e.abs),
        slug: toSlug(e.noExt),
        group: layout?.dir ?? '',
        // Expo Router has no shared-registration-helper concept — every screen file is registered
        // in exactly one directory — so there is never more than one owner to list here.
        groups: [layout?.dir ?? ''],
        navigator: layout?.navigator ?? null,
        params,
        presentation,
        guard,
        capture: null
      }
    })
  )

  console.log(`[app-flow] parse: ${nodes.length} nodes built (${Date.now() - startedAt}ms)`)

  const matchers = nodes.map((r) => ({ route: r, re: routeMatcher(r.urlPath!) }))
  const HREF_RE = /href=\{?\s*["'`]([^"'`]+)["'`]/g
  const PATHNAME_RE = /pathname\s*:\s*["'`]([^"'`]+)["'`]/g
  const ROUTER_RE = /(?:router|navigation)\.(?:push|replace|navigate)\(\s*["'`]([^"'`]+)["'`]/g

  const edges: AppFlowEdge[] = []
  for (const r of nodes) {
    const src = await readFile(resolve(projectRoot, r.file ?? ''), 'utf-8')
    const raws = new Set<string>()
    for (const re of [HREF_RE, PATHNAME_RE, ROUTER_RE]) {
      for (const m of src.matchAll(re)) {
        raws.add(m[1])
      }
    }
    for (const raw of raws) {
      let t = raw.split(/[?#]/)[0]
      if (/^(https?|mailto|tel):/.test(t)) continue
      if (isUpwardHref(t)) continue
      if (!t.startsWith('/')) {
        t = posix.normalize(posix.join(posix.dirname(r.urlPath!), t))
        if (!t.startsWith('/')) t = '/' + t
      }
      if (t === '') t = '/'
      const probe =
        t
          .split('/')
          .filter((s) => !(s.startsWith('(') && s.endsWith(')')))
          .join('/')
          .replace(/\$\{[^}]*\}/g, 'X') || '/'
      const hit = matchers.find((m) => m.re.test(probe))
      // Expo Router collapses `href`, `pathname:`, and `router.push/replace/navigate(...)` into one
      // `raws` set keyed only by destination path, so there is no call-site method left here to
      // read a `replace` off of the way the React Navigation branch does — `modal` from the target's
      // own `presentation` is the cheap, reliable signal available at this point, so that is all
      // this branch asserts; anything else stays the safe default, `push`.
      const kind: AppFlowEdge['kind'] =
        hit?.route.presentation && /modal/i.test(hit.route.presentation) ? 'modal' : 'push'
      edges.push({ from: r.id, to: hit?.route.id ?? null, raw, target: t, kind })
    }
  }

  console.log(`[app-flow] parse: ${edges.length} edges built (${Date.now() - startedAt}ms)`)

  const appConfig = await readAppConfig(projectRoot)

  const parentDir = (dir: string): string | null => {
    if (!dir) return null
    const segments = dir.split('/')
    segments.pop()
    return segments.join('/')
  }
  const layoutDirs = Object.keys(layoutsByDir)
  const layouts: AppFlowLayout[] = layoutDirs.map((dir) => {
    const parent = parentDir(dir)
    return {
      name: dir || '/',
      navigator: layoutsByDir[dir].navigator ?? 'Stack',
      parent: parent === null ? null : parent || '/'
    }
  })
  // The app's own chrome is where a journey starts, so the entry layouts are the segments mounted
  // directly inside the outermost tab *or drawer* navigator — the root layout itself when nothing
  // above it is either. Matching `Tabs` alone left a drawer-rooted Expo Router app with no entry
  // layouts at all and a single root entry screen, while the React Navigation branch below has
  // always matched both (see `rootKey`); the two sides describe the same idea and now agree.
  const chromeDir = layoutDirs
    .filter((dir) => /Tabs|Drawer/i.test(layoutsByDir[dir].navigator ?? ''))
    .sort((a, b) => a.split('/').length - b.split('/').length)[0]
  const entryLayouts =
    chromeDir === undefined
      ? []
      : layoutDirs.filter((dir) => dir !== chromeDir && parentDir(dir) === chromeDir)

  // The single screen each entry layout actually opens on: its `index` route when it has one
  // (Expo Router's own convention for a directory's default screen), else the first file the walk
  // turned up for it — the same "first declared wins" default React Navigation applies when no
  // route is singled out. Every other screen in that directory is a `group` sibling reachable only
  // by navigating there first, not a genuine entry.
  const entryScreenIds = (chromeDir === undefined ? [''] : entryLayouts)
    .map((dir) => {
      const inGroup = nodes.filter((node) => node.group === dir)
      return (inGroup.find((node) => posix.basename(node.id) === 'index') ?? inGroup[0])?.id ?? null
    })
    .filter((id): id is string => id !== null)

  return {
    mode: 'expo-router',
    swift: null,
    appDir: rel(appDir),
    routesFile: null,
    scheme: appConfig.scheme,
    // Expo Router generates its own linking config from the file tree and the scheme is wired in
    // by the same tool, so there is no separate `prefixes` array to cross-check it against the way
    // React Navigation apps need — it is always assumed to work, as every route here already was.
    deepLinkConfidence: 'assumed',
    linkingPrefixes: [],
    appName: appConfig.name,
    bundleId: appConfig.bundleId,
    slug: appConfig.slug,
    nodes,
    edges: finalizeEdges(edges),
    layouts,
    rootNavigator: layoutsByDir['']?.navigator ?? null,
    entryLayouts,
    entryScreenIds
  }
}

function readJsxTag(src: string, start: number): string {
  let braces = 0
  let quote: string | null = null
  for (let i = start; i < src.length; i++) {
    const char = src[i]
    if (quote) {
      if (char === '\\') i++
      else if (char === quote) quote = null
      continue
    }
    if (char === '"' || char === "'" || char === '`') quote = char
    else if (char === '{') braces++
    else if (char === '}') braces--
    else if (char === '>' && braces === 0) return src.slice(start, i + 1)
  }
  return src.slice(start)
}

function objectBlockAfter(
  src: string,
  key: string,
  from = 0
): { body: string; end: number } | null {
  const at = key ? src.indexOf(key, from) : from
  if (at < 0) return null
  const open = src.indexOf('{', at)
  if (open < 0) return null
  let depth = 0
  let quote: string | null = null
  for (let i = open; i < src.length; i++) {
    const char = src[i]
    if (quote) {
      if (char === '\\') i++
      else if (char === quote) quote = null
      continue
    }
    if (char === '"' || char === "'" || char === '`') quote = char
    else if (char === '{') depth++
    else if (char === '}' && --depth === 0) return { body: src.slice(open + 1, i), end: i }
  }
  return null
}

function propertyObjectBlock(src: string, key: string): { body: string; end: number } | null {
  const match = new RegExp(`\\b${key}\\s*:`).exec(src)
  return match ? objectBlockAfter(src, '', match.index + match[0].length) : null
}

/** Compares hrefs to route paths without tripping over a trailing slash or a param name. */
/**
 * A call to a function whose name ends in `Link`/`Path`/`Route`/`Url` — the naming every route
 * helper this parser has met uses (`makeProfileLink`, `makeCustomFeedLink`, `makeStarterPackLink`).
 * Matched anywhere in a screen's sources rather than only inside a `to=`/`href=` attribute, because
 * the result is routinely bound first (`const likesHref = makeProfileLink(...)`) and handed to the
 * attribute somewhere else entirely — the same reason the `navigate(...)` rule above scans whole
 * sources. Arguments are read non-greedily to the first `)`, so a call with a nested call in it is
 * skipped rather than mis-read; those carry no extra literal segments in practice.
 */
const ROUTE_HELPER_CALL_RE = /\b([A-Za-z_$][\w$]*(?:Link|Path|Route|Url|URL))\s*\(([^()]*)\)/g

/** The constant path segments of a route pattern, in order — `:param` placeholders dropped. */
function literalRouteSegments(path: string): string[] {
  return path
    .split('/')
    .filter((segment) => segment && !segment.startsWith(':') && !segment.startsWith('*'))
}

/**
 * The string literals in a helper call's argument list that could be route segments. Restricted to
 * lowercase kebab tokens, which is what a path segment looks like and what the noise in these calls
 * does not: a `did:plc:...`, a display string, a URL. Non-literal arguments (`profile`, `urip.rkey`)
 * contribute nothing by design — they are exactly the parts of the route this parser cannot know.
 */
function routeSegmentLiterals(args: string): string[] {
  return [...args.matchAll(/['"`]([a-z][a-z0-9-]*)['"`]/g)].map((match) => match[1])
}

/**
 * The single route whose constant segments end with `segments`, or null.
 *
 * Suffix rather than equality because a helper supplies only the part of the path below whatever it
 * is a helper *for*: `makeProfileLink(profile, 'followers')` omits the leading `profile` that every
 * route it can build already starts with. Suffix matching recovers that without the parser having
 * to model what each helper prefixes.
 *
 * Null on no match and — the case worth stating — null on more than one. `makeCustomFeedLink(did,
 * rkey, 'liked-by')` ends `liked-by` and so do three routes (`post/:rkey/liked-by`,
 * `feed/:rkey/liked-by`, `labeler/liked-by`); picking among them would need the helper's own
 * definition, which is a different parser. An edge this parser cannot name is one it should not
 * draw, and the screen stays where an unlinked screen belongs — reachable by deep link, with no
 * claimed in-app route.
 */
function resolveRouteHelperCall(
  segments: string[],
  candidates: readonly { node: AppFlowNode; segments: string[] }[]
): AppFlowNode | null {
  if (segments.length === 0) return null
  const matches = candidates.filter(
    (candidate) =>
      candidate.segments.length >= segments.length &&
      segments.every(
        (segment, index) =>
          candidate.segments[candidate.segments.length - segments.length + index] === segment
      )
  )
  return matches.length === 1 ? matches[0].node : null
}

function normalizeRoutePath(path: string): string {
  const withoutQuery = path.split(/[?#]/)[0]
  const normalized = withoutQuery
    .split('/')
    .map((segment) => (segment.startsWith(':') ? ':param' : segment))
    .join('/')
    .replace(/\/+$/, '')
  return normalized || '/'
}

function joinRoutePath(prefix: string, segment: string): string {
  const value = `${prefix.replace(/\/$/, '')}/${segment.replace(/^\//, '')}`.replace(/\/+/g, '/')
  return value.startsWith('/') ? value : `/${value}`
}

/** Reads a bracketed array span starting at the `[` after `key:`, honouring nesting like `objectBlockAfter`. */
function arrayBlockAfter(src: string, key: string): { body: string; end: number } | null {
  const match = new RegExp(`\\b${key}\\s*:\\s*\\[`).exec(src)
  if (!match) return null
  const open = match.index + match[0].length - 1
  let depth = 0
  for (let i = open; i < src.length; i++) {
    const char = src[i]
    if (char === '[') depth++
    else if (char === ']' && --depth === 0) return { body: src.slice(open + 1, i), end: i }
  }
  return null
}

/**
 * Reads the `prefixes` array off a React Navigation linking config, e.g.
 * `prefixes: ['bsky://', 'bluesky://', 'https://bsky.app']`. This is deliberately decoupled from
 * the `screens:` detection below it — an app that hands its own router a plain name-to-path map
 * (see `parseRouteMap`) still declares `prefixes` in the same `linking` object, with no `screens:`
 * key anywhere nearby, and a detector that required both missed `prefixes` entirely on that shape.
 */
function parsePrefixes(src: string): string[] {
  const block = arrayBlockAfter(src, 'prefixes')
  if (!block) return []
  return [...block.body.matchAll(/["'`]([^"'`]+)["'`]/g)].map((m) => m[1])
}

/**
 * Picks the scheme to build deep links with, and how much to trust it, from the linking config's
 * `prefixes` and `expo.scheme`. See `DeepLinkConfidence` for what each outcome means.
 */
function selectDeepLinkScheme(
  prefixes: string[],
  expoScheme: string | null
): { scheme: string | null; confidence: DeepLinkConfidence } {
  const customSchemes = prefixes
    .map((prefix) => prefix.match(/^([A-Za-z][\w+.-]*):\/\//)?.[1] ?? null)
    .filter((s): s is string => s !== null && !/^https?$/i.test(s))
  if (customSchemes.length === 0) {
    // Nothing usable to check `expo.scheme` against — either no `prefixes` array was found, or it
    // held only universal `https://` links, which the simulator cannot open the app with directly.
    return { scheme: expoScheme, confidence: 'assumed' }
  }
  if (expoScheme && customSchemes.includes(expoScheme)) {
    // `expo.scheme` is what Info.plist actually registers, so prefer it over `customSchemes[0]`
    // once we know it is one React Navigation will route — that is strictly more useful than an
    // alias prefix (bluesky also lists `bsky://`) that iOS may not open the app for at all.
    return { scheme: expoScheme, confidence: 'verified-prefix' }
  }
  if (!expoScheme) {
    return { scheme: customSchemes[0], confidence: 'assumed' }
  }
  return { scheme: customSchemes[0], confidence: 'scheme-mismatch' }
}

function parseLinkingScreens(body: string, prefix = ''): Record<string, string> {
  const paths: Record<string, string> = {}
  const entry = /([A-Za-z_$][\w$]*)\s*:\s*/g
  let match: RegExpExecArray | null
  while ((match = entry.exec(body))) {
    const name = match[1]
    const rest = body.slice(entry.lastIndex)
    const literal = rest.match(/^["'`]([^"'`]*)["'`]/)
    if (literal) {
      paths[name] = joinRoutePath(prefix, literal[1])
      continue
    }
    if (!rest.trimStart().startsWith('{')) continue
    const block = objectBlockAfter(body, '', entry.lastIndex - 1)
    if (!block) continue
    const path = block.body.match(/\bpath\s*:\s*["'`]([^"'`]*)["'`]/)?.[1]
    const here = path == null ? prefix : joinRoutePath(prefix, path)
    if (path != null) paths[name] = here || '/'
    const nested = propertyObjectBlock(block.body, 'screens')
    if (nested) Object.assign(paths, parseLinkingScreens(nested.body, here))
    entry.lastIndex = block.end + 1
  }
  return paths
}

/**
 * The JSX element that encloses a source offset, as its opening tag text.
 *
 * Both forms this parser cares about sit inside an opening tag — an `onPress` handler that calls
 * `navigate(...)`, and a `to="/path"` attribute on a link — so the nearest preceding `<Tag` is the
 * control the user taps.
 */
function enclosingJsxTag(src: string, at: number): string | null {
  const floor = Math.max(0, at - 1200)
  for (let i = at; i >= floor; i--) {
    if (src[i] !== '<') continue
    if (!/[A-Za-z_$]/.test(src[i + 1] ?? '')) continue
    const tag = readJsxTag(src, i)
    if (i + tag.length > at) return tag
    return null
  }
  return null
}

/** Strips i18n wrappers and JSX braces from an attribute value. */
function cleanTriggerText(value: string): string {
  return value
    .replace(/^\{+|\}+$/g, '')
    .replace(/^[A-Za-z_$][\w$]*`|`$/g, '')
    .replace(/^["'`]|["'`]$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * How to locate the control that fires a navigation: its test id, then its accessibility label,
 * then the text it renders. Ordered by how durable the locator is at runtime.
 */
function extractTrigger(src: string, at: number): AppFlowTrigger | null {
  const tag = enclosingJsxTag(src, at)
  if (!tag) return null
  const id = tag.match(/\btestID\s*=\s*(?:\{\s*)?["'`]([^"'`]+)["'`]/)?.[1]
  if (id) return { by: 'id', value: id }
  // `title` is React Native's own Button caption; `label`/`accessibilityLabel` cover the common UI
  // kits and the accessibility tree the device driver actually matches on.
  const label = tag.match(
    /\b(?:label|title|accessibilityLabel|aria-label)\s*=\s*(\{[^}]*\}|["'`][^"'`]*["'`])/
  )?.[1]
  const cleanedLabel = label ? cleanTriggerText(label) : ''
  // An interpolated label (`{`Go to ${name}`}`) has no fixed runtime text to match on.
  if (cleanedLabel && !/[${}]/.test(cleanedLabel)) return { by: 'label', value: cleanedLabel }
  const tagStart = src.indexOf(tag, Math.max(0, at - 1200))
  const body = src.slice(tagStart + tag.length, tagStart + tag.length + 400)
  // A pressable's caption is usually the first text it renders, bare or wrapped in <Text>/<Trans>.
  const text =
    body.match(/^\s*([A-Za-z][^<{]{2,60})/)?.[1] ??
    body.match(/<(?:Trans|Text)[^>]*>\s*([A-Za-z][^<{]{1,60})/)?.[1] ??
    null
  const cleanedText = text ? cleanTriggerText(text) : ''
  return cleanedText ? { by: 'text', value: cleanedText } : null
}

/**
 * A route table written as a plain name -> path map, e.g. `new Router({Moderation: '/moderation'})`.
 *
 * React Navigation's own `linking.config.screens` is only one way to declare deep links; apps that
 * need path params or shared web routing commonly hand a map to a small custom router and convert
 * it in `getStateFromPath`. Those apps are fully deep-linkable, but reading only `screens:` left
 * every route `navigation-only`, so the sweep drove the UI for screens it could have opened by URL.
 */
function parseRouteMap(body: string): Record<string, string> {
  const paths: Record<string, string> = {}
  for (const match of body.matchAll(/([A-Za-z_$][\w$]*)\s*:\s*(?:\[\s*)?["'`]([^"'`]*)["'`]/g)) {
    if (!match[2].startsWith('/')) continue
    paths[match[1]] ??= match[2]
  }
  return paths
}

async function projectDependencies(projectRoot: string): Promise<Record<string, string>> {
  try {
    const pkg = JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf-8')) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    return { ...pkg.devDependencies, ...pkg.dependencies }
  } catch {
    return {}
  }
}

async function reactNavigationSourceFiles(projectRoot: string): Promise<string[]> {
  for (const dir of ['src', 'app', 'screens', 'navigation']) {
    try {
      const root = join(projectRoot, dir)
      if (!(await stat(root)).isDirectory()) continue
      return (await walk(root)).filter((file) => SOURCE_EXTS.includes(extname(file)))
    } catch {
      // try the next conventional source root
    }
  }
  return []
}

type NavScreen = {
  name: string
  component: string | null
  navigatorKey: string
  navigatorType: string
  registrationFile: string
  presentation: string | null
  /** Every navigator key this screen is registered under, when registered via a shared helper
   *  called from more than one caller — null for a screen registered directly under a navigator,
   *  or via a helper with only one known caller (nothing more to list than `navigatorKey` itself). */
  helperCallers: string[] | null
}

function enclosingFunctionName(src: string, index: number): string | null {
  const before = src.slice(0, index)
  const declarations = [
    ...before.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g),
    ...before.matchAll(
      /\bconst\s+([A-Za-z_$][\w$]*)\s*(?::[^=]*)?=\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g
    )
  ].sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
  return declarations.at(-1)?.[1] ?? null
}

function resolveScreenName(
  raw: string,
  scalars: Record<string, string>,
  objects: Record<string, Record<string, string>>
): string | null {
  const literal = raw.match(/^["'`]([^"'`]+)["'`]$/)
  if (literal) return literal[1]
  // A screen name cast to satisfy a stricter prop type — social-app's
  // `name={'MyProfile' as 'Profile'}`, with a comment explaining the cast is needed only because
  // 'MyProfile' is not in that navigator's declared param list. The cast target is TypeScript-only
  // and never seen at runtime; only the literal before `as` is the string React Navigation actually
  // registers, so without this the whole tag failed to resolve a name and the screen went missing.
  const cast = raw.match(/^["'`]([^"'`]+)["'`]\s+as\s+/)
  if (cast) return cast[1]
  const member = raw.match(/^([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)$/)
  if (member) return objects[member[1]]?.[member[2]] ?? null
  return scalars[raw] ?? null
}

/**
 * Name of the nearest enclosing `function NAME(...)` declaration whose parameter list actually
 * declares `paramName` — e.g. finds `commonScreens` for a `<Stack.Screen>` inside
 * `function commonScreens(Stack, unreadCountLabel) { ... }`. `enclosingFunctionName` above (the
 * "nearest preceding function or arrow declaration, whatever it is") is not precise enough here:
 * `commonScreens` also declares a local `title` arrow before its `<Stack.Screen>` tags, which would
 * out-rank the real enclosing function purely by sitting closer to the match. Requiring the param
 * to actually be named `paramName` rules that out.
 */
function enclosingHelperFunction(src: string, index: number, paramName: string): string | null {
  const before = src.slice(0, index)
  let found: string | null = null
  for (const match of before.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/g)) {
    const params = match[2].split(',').map((p) => p.trim().split(/[:\s=]/)[0])
    if (params.includes(paramName)) found = match[1]
  }
  return found
}

/**
 * Navigator key(s) a shared registration helper is invoked with, ordered by first appearance in
 * the file and limited to identifiers that resolve to a real `create*Navigator()` var — an
 * unrelated parameter, or a cast target that never resolved, is skipped rather than fabricating an
 * attribution. A helper called from several navigators (bluesky's `commonScreens` is called from
 * five tab stacks) genuinely registers its screens in all of them, so every caller is returned —
 * `key` (the first, in source order) is what picks a single stable id/display group, while `all`
 * is what a caller needing the full truth (the `groups` field on the node) should read instead.
 * Reachability no longer depends on which caller is "first": that was only ever load-bearing when
 * `group` doubled as the entry-screen signal, which it no longer does (see `entryScreenIds`).
 */
function resolveHelperCaller(
  src: string,
  file: string,
  matchIndex: number,
  paramName: string,
  navigatorTypes: Record<string, string>,
  helperCallerCache: Map<string, string[]>
): { key: string | null; all: string[] } {
  const fnName = enclosingHelperFunction(src, matchIndex, paramName)
  if (!fnName) return { key: null, all: [] }
  const cacheKey = `${file}::${fnName}`
  let callerKeys = helperCallerCache.get(cacheKey)
  if (callerKeys === undefined) {
    callerKeys = []
    const seen = new Set<string>()
    const callRe = new RegExp(`\\b${escapeRe(fnName)}\\s*\\(\\s*([A-Za-z_$][\\w$]*)`, 'g')
    for (const call of src.matchAll(callRe)) {
      const before = src.slice(Math.max(0, call.index - 20), call.index)
      if (/\bfunction\s*$/.test(before)) continue // the helper's own declaration, not a call to it
      const key = `${file}::${call[1]}`
      if (navigatorTypes[key] === undefined || seen.has(key)) continue
      seen.add(key)
      callerKeys.push(key)
    }
    helperCallerCache.set(cacheKey, callerKeys)
  }
  return { key: callerKeys[0] ?? null, all: callerKeys }
}

export async function parseReactNavigation(projectRoot: string): Promise<ParsedAppGraph | null> {
  const files = await reactNavigationSourceFiles(projectRoot)
  if (!files.length) return null
  const sources = new Map<string, string>()
  await Promise.all(files.map(async (file) => sources.set(file, await readFile(file, 'utf-8'))))
  const scalars: Record<string, string> = {}
  const objects: Record<string, Record<string, string>> = {}
  for (const src of sources.values()) {
    for (const match of src.matchAll(
      /\bexport\s+const\s+([A-Za-z_$][\w$]*)\s*(?::[^=]*)?=\s*["'`]([^"'`]+)["'`]/g
    ))
      scalars[match[1]] ??= match[2]
    for (const match of src.matchAll(
      /\bexport\s+const\s+([A-Za-z_$][\w$]*)\s*(?::[^=]*)?=\s*\{([^}]*)\}/g
    )) {
      const members: Record<string, string> = {}
      for (const member of match[2].matchAll(/([A-Za-z_$][\w$]*)\s*:\s*["'`]([^"'`]+)["'`]/g))
        members[member[1]] = member[2]
      if (Object.keys(members).length) objects[match[1]] ??= members
    }
  }
  const navigatorTypes: Record<string, string> = {}
  const helperCallerCache = new Map<string, string[]>()
  const navigatorRenderers: Record<string, string | null> = {}
  // A navigator's `initialRouteName` — read here, resolved to a node id once every screen is known
  // (below) — is what the entry chrome actually opens directly. It is a different signal from which
  // navigator registers a screen (`group`/`navigatorTypes`): a helper called from five tabs makes a
  // screen belong to all five for attribution, but only one screen per tab is what a person actually
  // lands on without navigating anywhere first.
  const initialRouteNameByNavigatorKey: Record<string, string> = {}
  const screens: NavScreen[] = []
  // Matched on the factory name rather than by exact lookup: apps routinely wrap the React
  // Navigation factories (`createNativeStackNavigatorWithAuth`), and an exact-match table left
  // every screen of such an app typed `react-navigation` — which then became its id prefix and
  // erased which tab or stack the screen actually lives in.

  let linkingFile: string | null = null
  let linkingPaths: Record<string, string> = {}
  let linkingPrefixes: string[] = []
  let prefixesFile: string | null = null
  let routeMapFile: string | null = null
  const routeMapPaths: Record<string, string> = {}
  for (const [file, src] of sources) {
    for (const match of src.matchAll(
      /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*(create[A-Za-z]*Navigator[A-Za-z]*)\s*(?:<[^>]*>)?\s*\(/g
    )) {
      navigatorTypes[`${file}::${match[1]}`] = classifyNavigatorFactory(match[2])
    }
    for (const match of src.matchAll(/<([A-Za-z_$][\w$]*)\.Navigator\b/g)) {
      const navigatorKey = `${file}::${match[1]}`
      navigatorRenderers[navigatorKey] = enclosingFunctionName(src, match.index)
      const tag = readJsxTag(src, match.index)
      const rawInitial = (
        tag
          .match(/\binitialRouteName\s*=\s*(?:\{([^}]*)\}|("(?:[^"]*)"|'(?:[^']*)'))/)
          ?.slice(1)
          .find(Boolean) ?? ''
      ).trim()
      const initialName = rawInitial ? resolveScreenName(rawInitial, scalars, objects) : null
      if (initialName) initialRouteNameByNavigatorKey[navigatorKey] = initialName
    }
    if (!linkingFile && /\b(linking|prefixes)\b/.test(src) && /\bscreens\s*:/.test(src)) {
      const block = propertyObjectBlock(src, 'screens')
      if (block) {
        linkingFile = relative(projectRoot, file).split(/[/\\]/).join('/')
        linkingPaths = parseLinkingScreens(block.body)
      }
    }
    // Read independently of the `screens:` block above: an app whose linking config hands routing
    // to its own router (below) still declares `prefixes` right next to it, with no `screens:` key
    // anywhere in the file — the file this parser first hit for social-app.
    if (!prefixesFile) {
      const prefixes = parsePrefixes(src)
      if (prefixes.length) {
        prefixesFile = file
        linkingPrefixes = prefixes
      }
    }
    const routerMatch = /\bnew\s+\w*Router\s*(?:<[^>]*>)?\s*\(/.exec(src)
    if (routerMatch) {
      const block = objectBlockAfter(src, '', routerMatch.index + routerMatch[0].length - 1)
      const mapped = block ? parseRouteMap(block.body) : {}
      // Three mapped paths is the threshold that separates a route table from an options object
      // that happens to hold a path-shaped string.
      if (Object.keys(mapped).length >= 3) {
        routeMapFile ??= relative(projectRoot, file).split(/[/\\]/).join('/')
        for (const [name, path] of Object.entries(mapped)) routeMapPaths[name] ??= path
      }
    }
    for (const match of src.matchAll(/<([A-Za-z_$][\w$]*)\.Screen\b/g)) {
      const tag = readJsxTag(src, match.index)
      if (!/\b(?:component|getComponent)\s*=\s*\{/.test(tag)) continue
      const rawName = (
        tag
          .match(/\bname\s*=\s*(?:\{([^}]*)\}|("(?:[^"]*)"|'(?:[^']*)'))/)
          ?.slice(1)
          .find(Boolean) ?? ''
      ).trim()
      const name = resolveScreenName(rawName, scalars, objects)
      if (!name) continue
      const component =
        tag.match(/\bcomponent\s*=\s*\{\s*([A-Za-z_$][\w$]*)\s*\}/)?.[1] ??
        tag.match(/\bgetComponent\s*=\s*\{\s*\(\)\s*=>\s*([A-Za-z_$][\w$]*)\s*\}/)?.[1] ??
        null
      const tagOwner = match[1]
      let key = `${file}::${tagOwner}`
      let navigatorType = navigatorTypes[key]
      let helperCallers: string[] | null = null
      if (navigatorType === undefined) {
        // `tagOwner` is not itself a `create*Navigator()` result, so `<X.Screen>` is not rendered
        // directly under a navigator var — it is almost always a parameter of a shared helper (e.g.
        // bluesky's `commonScreens(Stack, unreadCountLabel)`) that several navigators call to
        // register the same screens. Left unresolved, every screen it registers falls back to the
        // generic 'react-navigation' group, which is where the bulk of social-app's 73 misattributed
        // nodes came from.
        const helper = resolveHelperCaller(
          src,
          file,
          match.index,
          tagOwner,
          navigatorTypes,
          helperCallerCache
        )
        if (helper.key) {
          key = helper.key
          navigatorType = navigatorTypes[helper.key]
          if (helper.all.length > 1) helperCallers = helper.all
        } else {
          navigatorType = 'react-navigation'
        }
      }
      screens.push({
        name,
        component,
        navigatorKey: key,
        navigatorType,
        helperCallers,
        registrationFile: file,
        presentation: tag.match(/\bpresentation\s*:\s*["'`]([A-Za-z]+)["'`]/)?.[1] ?? null
      })
    }
  }
  if (!screens.length) return null
  const appConfig = await readAppConfig(projectRoot)
  const { scheme: deepLinkScheme, confidence: deepLinkConfidence } = selectDeepLinkScheme(
    linkingPrefixes,
    appConfig.scheme
  )
  const mountedNavigator = new Map<string, string>()
  const mountName = new Map<string, string>()
  for (const screen of screens) {
    if (!screen.component) continue
    for (const [key, renderer] of Object.entries(navigatorRenderers)) {
      if (renderer !== screen.component) continue
      mountedNavigator.set(screen.name, key)
      mountName.set(key, screen.name)
    }
  }
  const containers = new Set(mountedNavigator.keys())
  // Container screens (tab-bar items, drawer items) that themselves mount a Tabs navigator — this
  // is the "belongs to a tab layout" half of the `tab-switch` edge-kind heuristic below. A screen's
  // `group`/`groups` entries are container names like `HomeTab`, not navigator keys, so resolving
  // "is this group a tab" means checking whether the container screen bearing that name renders a
  // Tabs navigator, not the navigator it happens to be registered under.
  const tabContainerNames = new Set(
    screens
      .filter(
        (screen) =>
          containers.has(screen.name) && /Tabs/.test(navigatorTypes[screen.navigatorKey] ?? '')
      )
      .map((screen) => screen.name)
  )
  // Node ids of the screens tab navigators land on — filled once nodes exist (see the `firstChild`
  // resolution loop below), read by `classifyEdgeKind`, which only ever runs after that.
  const tabRootNodeIds = new Set<string>()
  // `modal`/`replace` are read straight off the call site (presentation, method name); `tab-switch`
  // is not — nothing at a `navigate('X')` call site says whether X is a sibling screen or a
  // different branch of the app entirely, so it is inferred from the same `groups` this parser
  // already computes per node. Two nodes sharing no group are definitely not siblings in the same
  // stack, but that alone also fires for a plain cross-stack push (e.g. a modal stack pushing into
  // an unrelated flow), so it is narrowed further to only the case where a tab bar is actually
  // involved — otherwise it falls through to the safe default, `push`.
  function classifyEdgeKind(
    source: AppFlowNode,
    target: AppFlowNode,
    isReplace: boolean
  ): AppFlowEdge['kind'] {
    if (target.presentation && /modal/i.test(target.presentation)) return 'modal'
    if (isReplace) return 'replace'
    // Landing on a tab's root screen, from anywhere. This test exists because the `groups` one
    // below cannot see these: a screen registered on every tab — `Settings` is registered on all
    // five in the Bluesky app — carries all five container names in `groups` once its registrations
    // are merged into one node, so `sharesGroup` is true against every tab and each of the 18
    // `navigate('Home')`-style edges scored as an ordinary `push`. Whether such a call is strictly a
    // cross-tab jump or a pop back to the current tab's root does not change what a reader needs
    // from it: these are the edges that connect everything to everything, and the whole point of
    // `kind` is to let a graph draw them apart from the tree of pushes.
    if (tabRootNodeIds.has(target.id) && source.id !== target.id) return 'tab-switch'
    const sharesGroup = source.groups.some((layout) => target.groups.includes(layout))
    const touchesTab = [...source.groups, ...target.groups].some((layout) =>
      tabContainerNames.has(layout)
    )
    if (!sharesGroup && touchesTab) return 'tab-switch'
    return 'push'
  }
  // The screen a navigator lands on, per container screen that mounts one — this is what resolves a
  // `navigate('HomeTab')` call, whose argument names a NAVIGATOR and so matches no screen at all.
  //
  // Registration order is the wrong answer to "where does this navigator land". A device run against
  // the Bluesky app resolved every one of `HomeTab`, `SearchTab` and `NotificationsTab` to
  // `NotFound`, because that guard screen is registered on all five tab navigators and happens to be
  // registered first — publishing six edges into a 404 as if they were real navigation. So:
  // `initialRouteName` is authoritative when the navigator declares one, and the registration-order
  // fallback skips guard screens (`GUARD_FALLBACK_RE`), which are never where a navigator lands.
  const firstChild = new Map<string, string>()
  for (const [container, navigatorKey] of mountedNavigator) {
    const declared = initialRouteNameByNavigatorKey[navigatorKey]
    const registered = screens.filter((screen) => screen.navigatorKey === navigatorKey)
    const child =
      (declared ? registered.find((screen) => screen.name === declared) : undefined) ??
      registered.find((screen) => !GUARD_FALLBACK_RE.test(screen.name)) ??
      registered[0]
    if (child) firstChild.set(container, child.name)
  }
  const aliases = await loadPathAliases(projectRoot)
  const counts = new Map<string, number>()
  screens.forEach((screen) => counts.set(screen.name, (counts.get(screen.name) ?? 0) + 1))
  const seen = new Set<string>()
  const nodes: AppFlowNode[] = []
  const screenNames = new Map<string, AppFlowNode>()
  const componentFiles = new Map<string, string>()
  // Node id reachable from a given navigator + the screen name it registers there — keyed by every
  // navigator a helper-registered screen is called from, not just the first, so resolving any tab's
  // `initialRouteName` finds the right node regardless of which caller `group`/`id` happened to pick.
  const screenByNavigatorAndName = new Map<string, string>()
  // Bluesky (and apps shaped like it) registers the very same `<Screen name="Home"
  // component={Home}>` JSX both inside a tab's own stack AND again inside a flat top-level stack —
  // React Navigation resolves either route name to the identical screen at runtime, but two
  // separate `<Screen>` tags upstream meant two separate node pushes below, splitting every edge to
  // "Home" across `HomeTab/Home` and `Stack/Home` twins and leaving the emitted graph looking like
  // two half-connected screens instead of one. Component file + route path + screen name all
  // matching is the conservative signal that two registrations are genuinely one screen; two
  // DIFFERENT screens that merely share a component (rare, but real) still differ in name or path
  // and must stay split.
  const nodesByMergeKey = new Map<string, AppFlowNode>()
  for (const screen of screens) {
    if (containers.has(screen.name)) continue
    // Qualify a duplicated screen name with the navigator it is mounted as (`MyProfileTab/Profile`)
    // rather than the navigator kind (`Stack/Profile`): the mount name is the tab the explorer has
    // to open, and it also separates same-named screens that a kind prefix collapsed into
    // `Home`/`Home_`.
    const layoutName = mountName.get(screen.navigatorKey) ?? screen.navigatorType
    const src = sources.get(screen.registrationFile) ?? ''
    const spec = screen.component
      ? [
          ...src.matchAll(
            /import\s+(?:([A-Za-z_$][\w$]*)\s*,?\s*)?(?:\{([^}]*)\})?\s*from\s*["']([^"']+)["']/g
          )
        ].find(
          (match) =>
            match[1] === screen.component ||
            (match[2] ?? '').split(',').some(
              (part) =>
                part
                  .trim()
                  .split(/\s+as\s+/)
                  .pop() === screen.component
            )
        )?.[3]
      : null
    let componentFile = spec ? await resolveImport(screen.registrationFile, spec, aliases) : null
    if (
      !componentFile &&
      screen.component &&
      new RegExp(`(?:function|class|const|let|var)\\s+${escapeRe(screen.component)}\\b`).test(src)
    ) {
      componentFile = screen.registrationFile
    }
    const urlPath = linkingPaths[screen.name] ?? routeMapPaths[screen.name] ?? null
    // Every navigator this screen is registered under (plural), vs. `group` below (singular, the
    // first caller — kept only for a stable id/display). A helper called from five tabs registers
    // its screens in all five; naming only the first in a report or prompt is what made the planner
    // read `Target is registered in layout: HomeTab` for a screen that also lives in Search,
    // Notifications, MyProfile and Messages.
    const registeredUnderKeys = screen.helperCallers ?? [screen.navigatorKey]
    const groups = registeredUnderKeys.map(
      (navKey) => mountName.get(navKey) ?? navKey.split('::')[1] ?? navKey
    )
    // Null when the component could not be resolved — and then there is no evidence at all that two
    // registrations are the same screen, only that neither could be traced. Merging on that absence
    // would fold genuinely distinct screens together in exactly the projects where the parser
    // already understands the least, so an unresolved component never merges.
    const mergeKey = componentFile ? `${componentFile}\0${urlPath ?? ''}\0${screen.name}` : null
    const existingNode = mergeKey ? nodesByMergeKey.get(mergeKey) : undefined
    if (existingNode) {
      // Union rather than overwrite: the surviving node keeps its original id/group/slug (whichever
      // registration was seen first), it just learns about the extra navigator(s) this duplicate
      // registration adds.
      for (const layout of groups) {
        if (!existingNode.groups.includes(layout)) existingNode.groups.push(layout)
      }
      if (!screenNames.has(screen.name)) screenNames.set(screen.name, existingNode)
      for (const navKey of registeredUnderKeys) {
        screenByNavigatorAndName.set(`${navKey}::${screen.name}`, existingNode.id)
      }
      continue
    }
    // `counts` was tallied above from raw registrations, before the merge this loop performs — a
    // screen that ends up merged down to one node can still get a qualified id like `HomeTab/Home`,
    // which is fine: the id only needs to be unique and stable, not the shortest possible string.
    let id = counts.get(screen.name)! > 1 ? `${layoutName}/${screen.name}` : screen.name
    while (seen.has(id)) id += '_'
    seen.add(id)
    const componentSrc = componentFile ? await readFile(componentFile, 'utf-8') : ''
    const group = layoutName
    const node: AppFlowNode = {
      id,
      urlPath,
      // A route with no static path is navigation-only regardless of confidence. One that does have
      // a path is only truly `deep-link` when React Navigation will route it — a `scheme-mismatch`
      // means the URL opens the app and then goes nowhere, which is not a deep link in any useful
      // sense, so it must not be claimed as one.
      reach: urlPath && deepLinkConfidence !== 'scheme-mismatch' ? 'deep-link' : 'navigation-only',
      title: screen.name,
      file: componentFile ? relative(projectRoot, componentFile).split(/[/\\]/).join('/') : null,
      slug: generateSlug(id),
      group,
      groups,
      navigator: screen.navigatorType,
      params: urlPath
        ? urlPath
            .split('/')
            .filter((segment) => segment.startsWith(':'))
            .map((segment) => segment.slice(1))
        : [],
      presentation: screen.presentation,
      guard: extractGuard(componentSrc),
      capture: null
    }
    nodes.push(node)
    if (mergeKey) nodesByMergeKey.set(mergeKey, node)
    if (componentFile) componentFiles.set(id, componentFile)
    if (!screenNames.has(screen.name)) screenNames.set(screen.name, node)
    for (const navKey of registeredUnderKeys) {
      screenByNavigatorAndName.set(`${navKey}::${screen.name}`, id)
    }
  }
  for (const [container, child] of firstChild) {
    const target = screenNames.get(child)
    if (!target) continue
    if (!screenNames.has(container)) screenNames.set(container, target)
    // Landing screens of tab navigators, collected by node id for `classifyEdgeKind` — see the
    // `tab-switch` branch there for why this, rather than `groups`, is what identifies one.
    if (tabContainerNames.has(container)) tabRootNodeIds.add(target.id)
  }
  const edges: AppFlowEdge[] = []
  const nodesByUrlPath = new Map<string, AppFlowNode>()
  for (const candidate of nodes) {
    if (candidate.urlPath) nodesByUrlPath.set(normalizeRoutePath(candidate.urlPath), candidate)
  }
  const routeCandidates = nodes
    .filter((candidate) => candidate.urlPath)
    .map((candidate) => ({ node: candidate, segments: literalRouteSegments(candidate.urlPath!) }))
    .filter((candidate) => candidate.segments.length > 0)
  for (const node of nodes) {
    const abs = componentFiles.get(node.id) ?? null
    const source = abs ? (sources.get(abs) ?? (await readFile(abs, 'utf-8').catch(() => ''))) : ''
    const edgeSources = [source]
    if (abs) {
      for (const imported of source.matchAll(IMPORT_RE)) {
        const resolvedImport = await resolveImport(abs, imported[1], aliases)
        if (!resolvedImport) continue
        const importedSource =
          sources.get(resolvedImport) ?? (await readFile(resolvedImport, 'utf-8').catch(() => ''))
        if (importedSource) edgeSources.push(importedSource)
      }
    }
    const found = new Set<string>()
    for (const edgeSource of edgeSources) {
      // Capture the method name alongside the target so `replace(...)` can be told apart from
      // `navigate`/`push`/`jumpTo` below — a replace leaves no way back to `node`, which a reader
      // needs to know before assuming every edge is a stack push they can back out of.
      for (const match of edgeSource.matchAll(
        /\b(navigate|push|replace|jumpTo)\(\s*["'`]([^"'`]+)["'`]/g
      )) {
        const target = screenNames.get(match[2])
        if (!target || found.has(target.id)) continue
        found.add(target.id)
        edges.push({
          from: node.id,
          to: target.id,
          raw: `${match[1]}('${match[2]}')`,
          target: target.urlPath ?? target.id,
          trigger: extractTrigger(edgeSource, match.index),
          kind: classifyEdgeKind(node, target, match[1] === 'replace')
        })
      }
      // Link components navigate by href, never touching `navigate(...)`. A settings list built
      // from them produced no edges at all, which is most of how this app moves between screens.
      for (const match of edgeSource.matchAll(/\b(?:to|href)\s*=\s*["'`](\/[^"'`{}]*)["'`]/g)) {
        const target = nodesByUrlPath.get(normalizeRoutePath(match[1]))
        if (!target || target.id === node.id || found.has(target.id)) continue
        found.add(target.id)
        edges.push({
          from: node.id,
          to: target.id,
          raw: `to="${match[1]}"`,
          target: target.urlPath ?? target.id,
          trigger: extractTrigger(edgeSource, match.index),
          kind: classifyEdgeKind(node, target, false)
        })
      }
      // The same links again, for the apps that never write a route as a literal. A real sweep left
      // `ProfileFollowers`, `ProfileFollows`, `ProfileKnownFollowers`, `PostLikedBy`, `PostQuotes`
      // and `PostRepostedBy` with no inbound edge at all, reachable in the finished map only by
      // deep link — not because nothing links to them but because every link is built by a helper:
      //
      //   <Link to={makeProfileLink(profile, 'followers')} />
      //
      // The literal above never appears in the source, so the `to="..."` rule matches nothing.
      // What the call does carry is the route's own constant segments, in order, and that is enough
      // to name the route without evaluating anything: `('post', rkey, 'liked-by')` is the only
      // route ending `post/:rkey/liked-by`. See `resolveRouteHelperCall` for why an argument list
      // that matches more than one route resolves to no edge rather than to a guess.
      for (const match of edgeSource.matchAll(ROUTE_HELPER_CALL_RE)) {
        const segments = routeSegmentLiterals(match[2])
        const target = resolveRouteHelperCall(segments, routeCandidates)
        if (!target || target.id === node.id || found.has(target.id)) continue
        found.add(target.id)
        edges.push({
          from: node.id,
          to: target.id,
          raw: `${match[1]}(…'${segments.join("', '")}')`,
          target: target.urlPath ?? target.id,
          trigger: extractTrigger(edgeSource, match.index),
          kind: classifyEdgeKind(node, target, false)
        })
      }
    }
  }

  // `mountedNavigator` maps a container screen to the navigator it renders, so a navigator that
  // nothing mounts is the app root; the container screens registered on it are the entry layouts.
  const mountedKeys = new Set(mountedNavigator.values())
  const navigatorKeys = new Set(screens.map((screen) => screen.navigatorKey))
  const parentOfNavigator = new Map<string, string>()
  for (const [container, navigatorKey] of mountedNavigator) {
    const containerScreen = screens.find((screen) => screen.name === container)
    if (containerScreen) parentOfNavigator.set(navigatorKey, containerScreen.navigatorKey)
  }
  // Several navigators are mounted by nothing (helpers, web-only flat stacks), so "unmounted" alone
  // does not identify the root. The entry a person actually starts from is the outermost tab or
  // drawer navigator; only when an app has neither does the first unmounted navigator stand in.
  const unmounted = [...navigatorKeys].filter((key) => !mountedKeys.has(key))
  const rootKey =
    unmounted.find((key) => /Tabs|Drawer/.test(navigatorTypes[key] ?? '')) ?? unmounted[0] ?? null
  const layouts: AppFlowLayout[] = [...navigatorKeys].map((key) => {
    const parentKey = parentOfNavigator.get(key)
    return {
      name: mountName.get(key) ?? key.split('::')[1] ?? key,
      navigator: navigatorTypes[key] ?? 'react-navigation',
      parent: parentKey ? (mountName.get(parentKey) ?? parentKey.split('::')[1] ?? null) : null
    }
  })
  const entryLayouts = screens
    .filter((screen) => screen.navigatorKey === rootKey && containers.has(screen.name))
    .map((screen) => screen.name)

  // Navigators that constitute the app's entry chrome — the ones whose `initialRouteName` a person
  // reaches without navigating anywhere first: the root navigator itself, and (when the root is a
  // Tabs/Drawer) each tab's own stack navigator. A nested push-based stack's `initialRouteName` is
  // deliberately excluded even though it is a real prop on a real navigator — it is only reached
  // after already navigating INTO that stack, so counting it as "entry" would resurrect exactly the
  // bug this field exists to fix (a screen credited with a one-hop journey it does not have), just
  // one level further down the tree.
  const entryChromeNavigatorKeys = new Set<string>()
  if (rootKey) entryChromeNavigatorKeys.add(rootKey)
  for (const name of entryLayouts) {
    const childKey = mountedNavigator.get(name)
    if (childKey) entryChromeNavigatorKeys.add(childKey)
  }
  const entryScreenIds = [...entryChromeNavigatorKeys]
    .map((navigatorKey) => {
      const initialName = initialRouteNameByNavigatorKey[navigatorKey]
      if (initialName) {
        // A resolved name naming a nested navigator (container), rather than a leaf screen, is not
        // itself an entry screen — chasing further than one hop starts rebuilding the same
        // over-approximation this field exists to avoid.
        return containers.has(initialName)
          ? null
          : (screenByNavigatorAndName.get(`${navigatorKey}::${initialName}`) ?? null)
      }
      // No explicit `initialRouteName` on this navigator: React Navigation defaults to whichever
      // screen is registered first, so that is the honest entry rather than "none".
      const first = screens.find(
        (screen) => screen.navigatorKey === navigatorKey && !containers.has(screen.name)
      )
      return first ? (screenByNavigatorAndName.get(`${navigatorKey}::${first.name}`) ?? null) : null
    })
    .filter((id): id is string => id !== null)

  return {
    mode: 'react-navigation',
    swift: null,
    appDir: null,
    routesFile: linkingFile ?? routeMapFile,
    scheme: deepLinkScheme,
    deepLinkConfidence,
    linkingPrefixes,
    appName: appConfig.name,
    bundleId: appConfig.bundleId,
    slug: appConfig.slug,
    nodes,
    edges: finalizeEdges(edges),
    layouts,
    rootNavigator: rootKey ? (navigatorTypes[rootKey] ?? null) : null,
    entryLayouts,
    entryScreenIds
  }
}

/**
 * What a SwiftUI project's screen graph still does not carry.
 *
 * ---- SEAM: Swift screen parsing ----
 * `parseProject` identifies a Swift project, runs `swift-appflow-parse` over its source roots and
 * builds `nodes`/`edges` from the reports (`swift-graph.ts`). `layouts`, `rootNavigator`,
 * `entryLayouts` and `entryScreenIds` now come from the parser's `appEntries` and `navigators`, and
 * `scheme` from the app's `Info.plist` — see `swift-graph.ts` for the mapping and for why only an
 * entry view's navigator becomes a layout. What is still empty:
 *
 *  - `urlPath` / `reach`: a registered URL scheme says the app can be opened by URL and nothing
 *    about which screen any given URL reaches, so every Swift node stays `navigation-only` with a
 *    null `urlPath` whether a scheme was read or not.
 *  - `bundleId` / `appName`: from the build settings in `project.pbxproj`. The capture loop needs
 *    a bundle id and is handed one by its caller rather than read from here.
 *
 * When the parser cannot run at all — no Swift toolchain, a build failure, a contract the plugin
 * does not read — detection still succeeds and the graph comes back empty, the way it did before
 * the parser existed. That is the one case where an empty node list is not "an app with no
 * screens", so `swiftParseError` says which it is.
 */
export async function parseProject(projectRoot: string): Promise<ParsedAppGraph | null> {
  const startedAt = Date.now()
  const graph = await identifyProject(projectRoot)
  // One bounded measurement per detection, so a root whose shape is expensive to recognise is
  // visible without a span per file. `kind` is a closed set; nothing about the folder is sent.
  recordRuntimeTiming('app_flow.project_detect.duration', Date.now() - startedAt, {
    kind: graph?.mode ?? 'none'
  })
  return graph
}

async function identifyProject(projectRoot: string): Promise<ParsedAppGraph | null> {
  const dependencies = await projectDependencies(projectRoot)
  const candidates = ['app', 'src/app'].map((d) => join(projectRoot, d))
  if (dependencies['expo-router'])
    for (const appDir of candidates) {
      try {
        const s = await stat(appDir)
        if (s.isDirectory()) {
          console.log(`[app-flow] parse: using Expo Router app dir ${appDir}`)
          return await parseExpoRouter(projectRoot, appDir)
        }
        console.log(`[app-flow] parse: ${appDir} exists but is not a directory`)
      } catch {
        console.log(`[app-flow] parse: no ${appDir}`)
      }
    }
  const reactNavigation = await parseReactNavigation(projectRoot)
  if (reactNavigation) return reactNavigation
  // Swift is tried last and only on the root itself: a React Native project ships
  // `ios/<App>.xcworkspace`, so checking earlier (or deeper) would relabel every RN app whose
  // router parse came up empty.
  const swift = await detectSwiftProject(projectRoot)
  if (swift) {
    console.log(
      `[app-flow] parse: iOS project detected (${swift.container}), ` +
        `${swift.sourceRoots.length} source root(s), ${swift.schemes.length} shared scheme(s)`
    )
    return await swiftGraph(projectRoot, swift)
  }
  console.log(`[app-flow] parse: no supported router evidence under ${projectRoot}`)
  return null
}

/**
 * A `ParsedAppGraph` for a detected Swift project, with whatever screens the parser could read.
 *
 * Every graph field the parser does not report is empty here, never fabricated, so a consumer that
 * trusts the shape gets an obviously missing answer rather than a plausible wrong one.
 *
 * A parse failure is not a detection failure. The project is real and was identified; the screens
 * could not be read. Returning null instead would tell the caller "this is not a supported
 * project", which is false and sends them looking in the wrong place — so the graph comes back
 * with no nodes and `swiftParseError` holding the sentence that explains why.
 */
async function swiftGraph(
  projectRoot: string,
  swift: AppFlowSwiftProject
): Promise<ParsedAppGraph> {
  const base: ParsedAppGraph = {
    mode: 'swiftui',
    swift,
    appDir: swift.sourceRoots[0] ?? null,
    routesFile: null,
    // Filled below from `Info.plist` when the app registers one. `assumed` stays whatever the
    // scheme turns out to be: it says the app can be opened by URL, and nothing says which screen
    // any URL reaches, so no node claims a `urlPath` or `deep-link` reach on the strength of it.
    scheme: null,
    deepLinkConfidence: 'assumed',
    linkingPrefixes: [],
    appName: null,
    bundleId: null,
    slug: null,
    nodes: [],
    edges: [],
    layouts: [],
    rootNavigator: null,
    entryLayouts: [],
    entryScreenIds: []
  }

  let reports
  try {
    reports = await parseSwiftSourceRoots(swift.sourceRoots)
  } catch (error) {
    // Only the parser's own refusals are turned into an empty graph. Anything else is a bug here
    // rather than a fact about the project, and a bug that silently produced an empty map would
    // be indistinguishable from an app with no screens.
    if (!(error instanceof SwiftParseUnavailableError)) throw error
    console.log(`[app-flow] parse: SwiftUI screen parsing unavailable — ${error.message}`)
    return { ...base, swiftParseError: error.message }
  }

  const { nodes, edges, layouts, rootNavigator, entryLayouts, entryScreenIds } =
    buildSwiftScreenGraph(reports)
  // Read after the parse rather than during detection: identifying a project should stay as cheap
  // as a few `readdir`s, and this is only wanted once a graph is actually being built.
  const scheme = await readAppUrlScheme(projectRoot)
  console.log(
    `[app-flow] parse: SwiftUI — ${String(nodes.length)} screens, ${String(edges.length)} edges ` +
      `from ${String(reports.length)} source root(s)` +
      (rootNavigator ? `, root navigator ${rootNavigator}` : ', no root navigator observed') +
      (scheme ? `, scheme ${scheme}` : ', no URL scheme registered')
  )
  return { ...base, nodes, edges, layouts, rootNavigator, entryLayouts, entryScreenIds, scheme }
}
