/**
 * Detection for iOS/SwiftUI project roots.
 *
 * `parseProject` used to recognise exactly two shapes — Expo Router and React Navigation — and
 * return `null` for everything else, which made "a SwiftUI app" and "a folder that is not an app at
 * all" the same answer. This module supplies the third shape. It only *identifies* the project and
 * the places a future parser would read from; it deliberately does not open a `.swift` file, parse
 * `project.pbxproj`, or build a graph. See `parseProject` for the seam where the Swift parser plugs
 * in.
 *
 * Cost: one `readdir` of the root, one `readdir` per shared-scheme folder (at most two), and one
 * `readdir` per source-root candidate. No recursion, so pointing App Flow at a huge monorepo root
 * costs the same as pointing it at a small app.
 *
 * `readAppUrlScheme` is the one thing here that opens a file. It is deliberately not part of
 * detection and is called by the graph step instead, so identifying a project keeps the cost above
 * and reading the app's registered URL scheme is paid only when a graph is actually being built.
 */
import { execFile } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { AppFlowSwiftContainer, AppFlowSwiftProject } from '../shared/app-flow.ts'

/**
 * Folders that hold someone else's code or a build product. A `.swift` file under any of these says
 * nothing about where the app's own screens live, and `Pods` in particular is large enough that
 * scanning it would dominate detection.
 */
const NOT_SOURCE = new Set([
  'Pods',
  'Carthage',
  'DerivedData',
  '.build',
  'build',
  'node_modules',
  'vendor',
  'fastlane'
])

/**
 * Conventional source-root folder names, checked before falling back to a scan. `Sources` is
 * SwiftPM's own layout; `Shared`/`App` are the names Xcode's multiplatform templates use.
 */
const CONVENTIONAL_SOURCE_DIRS = ['Sources', 'Shared', 'App']

interface RootEntries {
  workspaces: string[]
  projects: string[]
  packageManifest: boolean
  directories: string[]
}

/**
 * One listing of the root, split into what detection needs. A root that cannot be read is reported
 * as empty rather than thrown, matching how the React Native path treats an unreadable folder.
 */
async function readRoot(projectRoot: string): Promise<RootEntries> {
  let entries
  try {
    entries = await readdir(projectRoot, { withFileTypes: true })
  } catch {
    return { workspaces: [], projects: [], packageManifest: false, directories: [] }
  }
  const workspaces: string[] = []
  const projects: string[] = []
  const directories: string[] = []
  let packageManifest = false
  for (const entry of entries) {
    // An Xcode bundle is a directory, but symlinked checkouts hand it over as a symlink; the name
    // is what identifies it either way, and a later read of its contents fails harmlessly.
    if (entry.name === 'Package.swift' && !entry.isDirectory()) packageManifest = true
    else if (entry.name.endsWith('.xcworkspace')) workspaces.push(entry.name)
    else if (entry.name.endsWith('.xcodeproj')) projects.push(entry.name)
    else if (entry.isDirectory() && !entry.name.startsWith('.')) directories.push(entry.name)
  }
  return {
    workspaces: workspaces.sort(),
    projects: projects.sort(),
    packageManifest,
    directories: directories.sort()
  }
}

/**
 * Which of several same-kind bundles is the app's. A root holding more than one is rare but real
 * (an example project next to the app), and the one named after its own folder is the app far more
 * often than the alphabetically-first one is.
 */
function preferred(names: readonly string[], projectRoot: string): string | null {
  if (names.length === 0) return null
  const expected = basename(projectRoot).normalize('NFC').toLowerCase()
  const matching = names.find((name) => name.replace(/\.[^.]+$/, '').normalize('NFC').toLowerCase() === expected)
  return matching ?? names[0] ?? null
}

/** Shared schemes of one bundle. Absent or unreadable `xcshareddata` simply contributes none. */
async function sharedSchemes(bundlePath: string | null): Promise<string[]> {
  if (!bundlePath) return []
  try {
    const entries = await readdir(join(bundlePath, 'xcshareddata', 'xcschemes'))
    return entries.filter((name) => name.endsWith('.xcscheme')).map((name) => name.slice(0, -'.xcscheme'.length))
  } catch {
    return []
  }
}

/** Whether a directory directly contains at least one `.swift` file. One level, never recursive. */
async function holdsSwift(directory: string): Promise<boolean> {
  try {
    return (await readdir(directory)).some((name) => name.endsWith('.swift'))
  } catch {
    return false
  }
}

/**
 * Where the app's Swift sources live, as far as a conventional layout reveals it.
 *
 * Xcode names a target's folder after the project (`Foo.xcodeproj` beside `Foo/`) and SwiftPM uses
 * `Sources/`, so those are checked first and cost one `readdir` each. Only when none of them exists
 * does this fall back to listing the root's own directories and keeping those with a `.swift` file
 * directly inside — still one level, so a project that follows no convention costs a bounded scan
 * rather than a recursive walk.
 */
async function sourceRoots(
  projectRoot: string,
  bundleNames: readonly string[],
  entries: RootEntries
): Promise<string[]> {
  const candidates: string[] = []
  for (const bundle of bundleNames) {
    const stem = bundle.replace(/\.[^.]+$/, '')
    if (stem && !candidates.includes(stem)) candidates.push(stem)
  }
  for (const name of CONVENTIONAL_SOURCE_DIRS) if (!candidates.includes(name)) candidates.push(name)

  const conventional: string[] = []
  for (const name of candidates) {
    if (NOT_SOURCE.has(name) || !entries.directories.includes(name)) continue
    conventional.push(join(projectRoot, name))
  }
  if (conventional.length > 0) return conventional

  const fallback: string[] = []
  for (const name of entries.directories) {
    if (NOT_SOURCE.has(name) || name.includes('.')) continue
    if (await holdsSwift(join(projectRoot, name))) fallback.push(join(projectRoot, name))
  }
  // A single-folder package (`Package.swift` beside loose `.swift` files) has no source directory at
  // all; the root itself is then the honest answer.
  if (fallback.length === 0 && (await holdsSwift(projectRoot))) return [projectRoot]
  return fallback
}

/**
 * Identifies an iOS/SwiftUI project at `projectRoot`, or returns null when the root holds no Xcode
 * or SwiftPM evidence.
 *
 * Only the root is examined. This is what keeps a React Native project — which ships
 * `ios/<App>.xcworkspace` — from being reported as a Swift project.
 */
export async function detectSwiftProject(projectRoot: string): Promise<AppFlowSwiftProject | null> {
  const entries = await readRoot(projectRoot)
  const hasXcode = entries.workspaces.length > 0 || entries.projects.length > 0
  if (!hasXcode && !entries.packageManifest) return null

  const workspaceName = preferred(entries.workspaces, projectRoot)
  const projectName = preferred(entries.projects, projectRoot)
  const container: AppFlowSwiftContainer = workspaceName
    ? 'xcworkspace'
    : projectName
      ? 'xcodeproj'
      : 'swiftpm'
  const workspacePath = workspaceName ? join(projectRoot, workspaceName) : null
  const projectPath = projectName ? join(projectRoot, projectName) : null

  // Both bundles are read: a workspace commonly shares no scheme of its own while the project it
  // wraps shares all of them, and CocoaPods-generated workspaces are the reverse.
  const schemes = [...new Set([...(await sharedSchemes(workspacePath)), ...(await sharedSchemes(projectPath))])].sort()
  const bundleNames = [workspaceName, projectName].filter((name): name is string => name !== null)

  return {
    container,
    workspacePath,
    projectPath,
    packageManifestPath: entries.packageManifest ? join(projectRoot, 'Package.swift') : null,
    sourceRoots: await sourceRoots(projectRoot, bundleNames, entries),
    schemes
  }
}

/**
 * Directory names that hold a bundle shipped *beside* the app rather than the app itself. Each one
 * has its own `Info.plist`, and an app extension routinely registers a URL scheme of its own — so
 * reading one of those as "the app's scheme" would hand the capture loop a scheme that opens a share
 * sheet rather than the app.
 */
const NOT_APP_BUNDLE = /(?:Extension|Widgets?|Tests?|UITests|AppClip|Clip|Watch(?:Kit)?(?:App|Extension)?)$/

/** How deep `Info.plist` is looked for. `isowords` keeps the app's at `App/iOS/Info.plist`. */
const PLIST_SEARCH_DEPTH = 3

/**
 * Every `Info.plist` that could be the app's own, nearest first.
 *
 * A bounded walk rather than a recursion: detection promises one `readdir` per level and nothing
 * deeper, and three levels is what the real layouts need — the app target's folder beside the
 * `.xcodeproj`, SwiftPM's `Sources/`, and `App/<platform>/` as `isowords` writes it. Folders holding
 * someone else's code, build products or a sibling bundle are skipped on the way down.
 */
async function infoPlistCandidates(projectRoot: string): Promise<string[]> {
  const found: string[] = []
  let frontier = [projectRoot]
  for (let depth = 0; depth <= PLIST_SEARCH_DEPTH && frontier.length > 0; depth += 1) {
    const next: string[] = []
    for (const directory of frontier) {
      let entries
      try {
        entries = await readdir(directory, { withFileTypes: true })
      } catch {
        continue
      }
      for (const entry of entries) {
        if (entry.name === 'Info.plist' && !entry.isDirectory()) found.push(join(directory, 'Info.plist'))
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue
        if (NOT_SOURCE.has(entry.name) || entry.name.includes('.')) continue
        if (NOT_APP_BUNDLE.test(entry.name)) continue
        next.push(join(directory, entry.name))
      }
    }
    frontier = next
  }
  return found
}

/**
 * The URL scheme the app registers, or null when it registers none.
 *
 * This is the one piece of a SwiftUI graph's deep-link story that is written down somewhere
 * readable: `CFBundleURLTypes` → `CFBundleURLSchemes`. It says the app *can* be opened by URL; it
 * says nothing about which screen any particular URL reaches, so a graph that reads it still leaves
 * every node's `urlPath` null and its reach `navigation-only`. Reporting the scheme and inventing
 * paths from it would be the same mistake the whole parser refuses to make.
 *
 * Read with `plutil`, which handles the XML and binary forms alike; iOS development implies macOS,
 * so there is no second implementation to keep in step. A plist that cannot be read contributes
 * nothing rather than failing the parse.
 */
export async function readAppUrlScheme(projectRoot: string): Promise<string | null> {
  const candidates = await infoPlistCandidates(projectRoot)
  if (candidates.length === 0) return null
  // The app's own target folder is conventionally named after the project, so prefer that plist
  // when several carry a scheme; otherwise the nearest one to the root wins.
  const expected = basename(projectRoot).normalize('NFC').toLowerCase()
  const ordered = [...candidates].sort((a, b) => {
    const score = (path: string): number =>
      basename(join(path, '..')).normalize('NFC').toLowerCase() === expected ? 0 : 1
    return score(a) - score(b)
  })
  for (const path of ordered) {
    const schemes = await urlSchemesIn(path)
    if (schemes.length > 0) return schemes[0] ?? null
  }
  return null
}

async function urlSchemesIn(plistPath: string): Promise<string[]> {
  let raw: string
  try {
    raw = await plutilJson(plistPath, 'CFBundleURLTypes')
  } catch {
    return []
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const schemes: string[] = []
  for (const entry of parsed) {
    if (typeof entry !== 'object' || entry === null) continue
    const value = (entry as Record<string, unknown>)['CFBundleURLSchemes']
    if (!Array.isArray(value)) continue
    for (const scheme of value) if (typeof scheme === 'string' && scheme.length > 0) schemes.push(scheme)
  }
  return schemes
}

function plutilJson(plistPath: string, key: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // `-extract <key> json` exits non-zero when the key is absent, which is the common case for an
    // app that registers no scheme at all — the caller reads that as "none", not as a failure.
    execFile('plutil', ['-extract', key, 'json', '-o', '-', plistPath], (error, stdout) => {
      if (error) reject(error)
      else resolve(stdout)
    })
  })
}
