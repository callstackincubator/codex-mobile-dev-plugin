/**
 * The SwiftUI screen sweep: parsed graph in, one `AppFlowCapture` per node out.
 *
 * This is the orchestrator's SwiftUI branch, lifted out of it because the React Native sweep and
 * this one share almost nothing. React Native drives a live app through its own navigator over a
 * runtime transport; here the app hosts a control channel and is asked to present a screen by
 * name. Four hundred lines of ladder, judge and replay machinery have no counterpart.
 *
 * ---- What this does not do ----
 *
 * It does not build or install the app. The app must already be installed on the simulator with
 * the harness package linked in, which is what `native/swift-appflow-present/build.sh` produces.
 * Driving `xcodebuild` from here would mean choosing a scheme, a configuration and a destination
 * that nothing in the project detection observed — and a build run against a guessed scheme either
 * fails loudly or, worse, succeeds against the wrong target. So the sweep asks whether the app is
 * there and says plainly when it is not.
 *
 * ---- Outcomes ----
 *
 * Each of the capture loop's four outcomes maps onto a capture status, and none of them is thrown
 * away:
 *
 * | loop outcome              | status        | why |
 * |---------------------------|---------------|-----|
 * | `captured`                | `ok`          | presented, settled, rastered |
 * | `environment_unsatisfied` | `ok` + note   | the screenshot is evidence of what the user would see; the note names the keys |
 * | `crashed`                 | `unavailable` | the process died on this screen; the note carries the error |
 * | `refused`                 | `unavailable` | the parser would not construct it; the note names what was missing |
 *
 * `environment_unsatisfied` keeping `ok` is deliberate and is the one that deserves an argument. A
 * missing `@Environment` key does not trap — SwiftUI hands back `defaultValue`, and the screen
 * renders complete, plausible and wrong. Marking it `unavailable` would hide a screenshot that
 * exists; marking it `ok` silently would hide that it lies. It gets both: the image, and a note
 * saying which keys it was rendered without.
 */
import { copyFile, mkdir, readFile, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type {
  AppFlowCapture,
  AppFlowNode,
  AppFlowSwiftProject
} from '../shared/app-flow.ts'
import { getScratchDir, getScreensDir, getScreenshotPath } from './storage.ts'
import { recordRuntimeTiming } from './runtime-telemetry.ts'
import {
  SwiftCaptureError,
  captureSwiftScreens,
  type SwiftPresentationMode,
  type SwiftScreenCapture
} from './swift-capture.ts'

/** What the sweep needs that the orchestrator already has. */
export interface SwiftSweepOptions {
  projectId: string
  swift: AppFlowSwiftProject
  nodes: readonly AppFlowNode[]
  structureRevision: string
  /** Overrides the bundle id read from the project, for a build installed under another one. */
  bundleId?: string
  /** simctl device UDID, or `booted`. */
  deviceId?: string
  /**
   * Where the harness puts the screen. Defaults to `window`; see the call site for why.
   */
  mode?: SwiftPresentationMode
  abortSignal?: AbortSignal
  /** Called after each screen so a long sweep reports progress instead of going quiet. */
  onProgress?: (completed: number, total: number, node: AppFlowNode) => void
}

export interface SwiftSweepResult {
  /** Node id → capture, for every node the sweep was given. */
  captures: Record<string, AppFlowCapture>
}

/**
 * Build settings defined in the project's own `.xcconfig` files.
 *
 * `PRODUCT_BUNDLE_IDENTIFIER` is routinely written as `$(SOME_PREFIX).App`, with the prefix defined
 * in an `.xcconfig` beside the project so a fork can change it without touching the project file.
 * IceCubesApp does exactly that. Without expanding it there is no bundle id to read at all, so
 * these files are read as well.
 *
 * A release config is skipped by name. The harness the sweep drives is `#if DEBUG`, so a release
 * build cannot answer the control channel whatever its identifier says — reading one could only
 * ever produce a bundle id for an app that will not respond. Name matching is a convention, which
 * is why a project that breaks it is served by passing `bundleId` instead.
 *
 * A variable two files disagree about is dropped rather than picked between. Choosing one would be
 * choosing which app to drive on no evidence, and driving the wrong app is the failure the control
 * channel's own identity check exists to catch.
 */
async function xcconfigSettings(projectRoot: string): Promise<Map<string, string>> {
  let entries
  try {
    entries = await readdir(projectRoot, { withFileTypes: true })
  } catch {
    return new Map()
  }
  const settings = new Map<string, string>()
  const conflicted = new Set<string>()
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.xcconfig')) continue
    if (/release/i.test(entry.name)) continue
    let text: string
    try {
      text = await readFile(join(projectRoot, entry.name), 'utf8')
    } catch {
      continue
    }
    for (const line of text.split('\n')) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.+?)\s*$/.exec(line)
      const name = match?.[1]
      const value = match?.[2]
      if (name === undefined || value === undefined || value.includes('$')) continue
      const existing = settings.get(name)
      if (existing !== undefined && existing !== value) conflicted.add(name)
      else settings.set(name, value)
    }
  }
  for (const name of conflicted) settings.delete(name)
  return settings
}

/**
 * The app's bundle identifier, read from the Xcode project.
 *
 * `PRODUCT_BUNDLE_IDENTIFIER` is written into `project.pbxproj` as a build setting, once per build
 * configuration and once per target — so a project with an app, a widget and a test bundle holds
 * several. The shortest wins, because an extension's identifier is conventionally the app's with a
 * suffix (`com.example.App.Widget`), and the tests' is the app's with `Tests` on the end. That is
 * a convention, not a guarantee; a project that breaks it needs `bundleId` passed in, which is why
 * the option exists.
 *
 * `$(VAR)` references are expanded from the project's `.xcconfig` files (see `xcconfigSettings`).
 * One that still holds a reference afterwards resolves to something only `xcodebuild` knows, and
 * is dropped rather than half-expanded into a plausible wrong identifier.
 *
 * Returns null rather than throwing. A bundle id that cannot be read is a reason to say the sweep
 * cannot run, not a crash in parsing.
 */
export async function readBundleId(swift: AppFlowSwiftProject): Promise<string | null> {
  if (swift.projectPath === null) return null
  let pbxproj: string
  try {
    pbxproj = await readFile(join(swift.projectPath, 'project.pbxproj'), 'utf8')
  } catch {
    return null
  }
  const settings = await xcconfigSettings(dirname(swift.projectPath))
  const found = new Set<string>()
  for (const match of pbxproj.matchAll(/PRODUCT_BUNDLE_IDENTIFIER = "?([^";\n]+)"?;/g)) {
    const raw = match[1]?.trim()
    if (raw === undefined || raw.length === 0) continue
    const expanded = raw.replace(/\$[({]([A-Z0-9_]+)[)}]/g, (whole, name: string) =>
      settings.get(name) ?? whole
    )
    if (!expanded.includes('$')) found.add(expanded)
  }
  if (found.size === 0) return null
  return [...found].sort((a, b) => a.length - b.length || a.localeCompare(b))[0] ?? null
}

function unavailable(note: string, structureRevision: string): AppFlowCapture {
  return {
    status: 'unavailable',
    needsNavigation: false,
    note,
    screenshot: null,
    pressables: [],
    captureMethod: 'unreached',
    structureRevision
  }
}

/**
 * Turns one capture-loop outcome into the record the renderer reads.
 *
 * `pressables` is always empty. The React Native sweep reads the live view hierarchy for tappable
 * elements; nothing here does, and an empty list is the honest answer rather than a reason to fail.
 */
function toCapture(
  capture: SwiftScreenCapture,
  relativePath: string,
  structureRevision: string
): AppFlowCapture {
  switch (capture.outcome) {
    case 'captured':
      return {
        status: 'ok',
        needsNavigation: false,
        note: null,
        screenshot: relativePath,
        pressables: [],
        captureMethod: 'rendered',
        structureRevision
      }
    case 'environment_unsatisfied':
      return {
        status: 'ok',
        needsNavigation: false,
        note:
          `Rendered without ${capture.environmentMissing.join(', ')}. SwiftUI substituted each ` +
          `key's default value, so this screenshot is complete but may not be what the app shows.`,
        screenshot: relativePath,
        pressables: [],
        captureMethod: 'rendered',
        structureRevision
      }
    case 'crashed':
      return unavailable(
        `The app died while presenting this screen${capture.error === undefined ? '' : `: ${capture.error}`}`,
        structureRevision
      )
    case 'refused':
      return unavailable(
        capture.missing.length > 0
          ? `The parser could not construct this screen: no observed value for ${capture.missing.join(', ')}.`
          : 'The parser could not construct this screen.',
        structureRevision
      )
  }
}

/**
 * Captures every node's screen and files the results against node ids.
 *
 * Nodes the capture loop never reported on — the registry in the installed build is older than the
 * parse that produced these nodes, say — are `unavailable` with a note saying so, rather than
 * missing from the map. A node with no capture at all renders as "not captured yet", which is a
 * different and wrong claim.
 */
export async function runSwiftSweep(options: SwiftSweepOptions): Promise<SwiftSweepResult> {
  const { projectId, nodes, structureRevision } = options
  const captures: Record<string, AppFlowCapture> = {}
  const bundleId = options.bundleId ?? (await readBundleId(options.swift))
  if (bundleId === null) {
    const note =
      'No bundle identifier could be read from the Xcode project, so there is no app to drive.'
    for (const node of nodes) captures[node.id] = unavailable(note, structureRevision)
    return { captures }
  }

  // The PNGs land in the scratch directory first and are copied to each node's slug afterwards.
  // The capture loop names files by *screen*, the map files them by *slug*, and the two are only
  // the same string while nothing has had to disambiguate a slug.
  const scratch = join(getScratchDir(projectId), 'swift-screens')
  await mkdir(scratch, { recursive: true })
  // The React Native sweep gets its screens directory from the device port's own setup; nothing
  // on this path has created it, and a first sweep of a project would otherwise fail on the copy
  // of the first screenshot it took.
  await mkdir(getScreensDir(projectId), { recursive: true })

  const bySlug = new Map(nodes.map((node) => [node.id, node]))
  // The whole SwiftUI capture phase, as the user waits for it. The per-screen pieces are already
  // measured inside the capture loop (`settle`, `raster`, `relaunch`); this is the boundary those
  // cannot answer for — how long the phase took, and whether it ran at all.
  const sweepStartedAt = Date.now()
  let completed = 0
  let run
  try {
    run = await captureSwiftScreens({
      deviceId: options.deviceId ?? 'booted',
      bundleId,
      // `window` rather than the capture loop's own `overlay` default. A real app presents things
      // over its root -- IceCubesApp shows an account sheet at launch while logged out -- and in
      // `overlay` mode the screen goes *under* that, which on IceCubesApp is not merely a wrong
      // screenshot: 6 of 21 screens take the process down with them, against 1 in `window` mode.
      // `window` hosts the screen in its own UIWindow above everything and re-applies the app-root
      // environment, so it is the mode that holds for an app this sweep did not write.
      mode: options.mode ?? 'window',
      outputDir: scratch,
      screens: nodes.map((node) => node.id),
      ...(options.abortSignal === undefined ? {} : { abortSignal: options.abortSignal }),
      onProgress: (capture, _index, total) => {
        completed += 1
        const node = bySlug.get(capture.screen)
        if (node) options.onProgress?.(completed, total, node)
      }
    })
  } catch (error) {
    options.abortSignal?.throwIfAborted()
    // The loop only throws for a failure that is about the run rather than a screen: the app never
    // answered, the channel belongs to another app, or the harness refused the presentation mode
    // this sweep asks for. Every node gets the same sentence, because it is the same single reason
    // and repeating it per node is what makes the map readable.
    if (!(error instanceof SwiftCaptureError)) throw error
    recordRuntimeTiming('app_flow.swift_sweep.duration', Date.now() - sweepStartedAt, {
      outcome: 'error'
    })
    for (const node of nodes) captures[node.id] = unavailable(error.message, structureRevision)
    return { captures }
  }

  for (const capture of run.captures) {
    const node = bySlug.get(capture.screen)
    if (!node) continue
    const relativePath = `screens/${node.slug}.png`
    if (capture.screenshotPath !== null) {
      await copyFile(capture.screenshotPath, getScreenshotPath(projectId, node.slug))
    }
    captures[node.id] = toCapture(capture, relativePath, structureRevision)
  }
  for (const node of nodes) {
    captures[node.id] ??= unavailable(
      'The installed build has no registry entry for this screen. It is in the source the parser ' +
        'read, so the build is older than the parse — rebuild and install the app, then sweep again.',
      structureRevision
    )
  }
  recordRuntimeTiming('app_flow.swift_sweep.duration', Date.now() - sweepStartedAt, {
    outcome: 'ok'
  })
  return { captures }
}
