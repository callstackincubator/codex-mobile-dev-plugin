import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type {
  AgentDeviceScreensMap,
  AppFlowCapture,
  AppFlowCaptureStatus,
  AppFlowChrome,
  AppFlowEdge,
  AppFlowManifest,
  AppFlowNode,
  AppFlowProjectEntry,
  AppFlowResult,
  ExplorationMode
} from '../shared/app-flow.ts'
import { normalizeAppFlow } from './app-flow-normalize.ts'
import type { ParamStoreJson } from './param-store.ts'
import { appFlowDataDir, getAppFlowHost } from './host.ts'

const APP_FLOWS_DIR_NAME = 'app-flows'
const PROJECTS_REGISTRY_FILE = 'projects.json'
const APP_FLOW_FILE = 'app-flow.json'
const MANIFEST_FILE = 'manifest.json'
const CAPTURE_STATUS_FILE = 'capture-status.json'
const AGENT_DEVICE_SCREENS_FILE = 'agent-device-screens.json'
const SWEEP_PROGRESS_FILE = 'sweep-progress.json'
const PARAM_STORE_FILE = 'param-store.json'
const SCRATCH_DIR_NAME = 'scratch'

/** The single stored auth screenshot. Overwritten whenever a launch turns out to be gated. */
export const AUTH_CHECKPOINT_SLUG = '--auth-checkpoint'

/**
 * Screenshots the sweep needs to look at but must never keep: exploration frames and arrival
 * diagnostics. They live outside `screens/` so the delivered folder holds exactly one capture per
 * screen (plus the two prompt screenshots the renderer displays).
 */
export function getScratchDir(projectId: string): string {
  return join(getProjectDir(projectId), SCRATCH_DIR_NAME)
}

export function getScratchPath(projectId: string, name: string): string {
  return join(getScratchDir(projectId), `${name}.png`)
}

export async function prepareScratchDir(projectId: string): Promise<void> {
  await rm(getScratchDir(projectId), { recursive: true, force: true })
  await ensureDir(getScratchDir(projectId))
}

/**
 * Earlier builds wrote per-step exploration frames, per-attempt arrival diagnostics and a
 * UUID-named auth screenshot into `screens/`. Those files are not referenced by any capture, so
 * they would otherwise accumulate in the delivered folder forever.
 */
export async function pruneTransientScreens(projectId: string): Promise<void> {
  const dir = getScreensDir(projectId)
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return
  }
  const transient =
    /(^--auth-checkpoint-[0-9a-f-]{8,}\.png$)|(--navigation-step-\d+\.png$)|(--saved-replay-check\.png$)|(--deep-link-check\.png$)|(--navigation-replay-check\.png$)|(--state-start\.png$)|(--state-replay-base-check\.png$)/
  await Promise.all(
    entries
      .filter((entry) => transient.test(entry))
      .map((entry) => unlink(join(dir, entry)).catch(() => undefined))
  )
}

function getAppFlowsDir(): string {
  return join(appFlowDataDir(), APP_FLOWS_DIR_NAME)
}

function getRegistryPath(): string {
  return join(getAppFlowsDir(), PROJECTS_REGISTRY_FILE)
}

export function getProjectId(projectPath: string): string {
  return createHash('sha256').update(projectPath).digest('hex').slice(0, 16)
}

export function getProjectDir(projectId: string): string {
  return join(getAppFlowsDir(), projectId)
}

export function getScreensDir(projectId: string): string {
  return join(getProjectDir(projectId), 'screens')
}

export function getFlowsDir(projectId: string): string {
  return join(getProjectDir(projectId), 'flows')
}

async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true })
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    const raw = await readFile(path, 'utf-8')
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

async function writeJson<T>(path: string, data: T): Promise<void> {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(temporary, JSON.stringify(data, null, 2), 'utf-8')
  await rename(temporary, path)
}

async function readRegistry(): Promise<AppFlowProjectEntry[]> {
  return (await readJson<AppFlowProjectEntry[]>(getRegistryPath())) ?? []
}

async function writeRegistry(entries: AppFlowProjectEntry[]): Promise<void> {
  await ensureDir(getAppFlowsDir())
  await writeJson(getRegistryPath(), entries)
}

export async function registerProject(
  projectPath: string
): Promise<{ projectId: string; name: string }> {
  const projectId = getProjectId(projectPath)
  const name = basename(projectPath)
  const entries = await readRegistry()
  const existingIndex = entries.findIndex((entry) => entry.id === projectId)
  const entry: AppFlowProjectEntry = {
    id: projectId,
    name,
    path: projectPath,
    lastOpenedAt: new Date().toISOString()
  }
  if (existingIndex >= 0) {
    entries[existingIndex] = entry
  } else {
    entries.push(entry)
  }
  await writeRegistry(entries)
  await ensureDir(getProjectDir(projectId))
  await ensureDir(getScreensDir(projectId))
  await ensureDir(getFlowsDir(projectId))
  return { projectId, name }
}

// Back-compat normalization (every field Step 4 added, defaulted value-driven rather than gated on
// `manifest.formatVersion`) lives in `app-flow-normalize.ts`, not here, purely so it has a unit
// test — this module value-imports `electron`, which a test importing it would load too.
export async function readAppFlow(projectId: string): Promise<AppFlowResult | null> {
  const result = await readJson<AppFlowResult>(join(getProjectDir(projectId), APP_FLOW_FILE))
  if (!result) return null
  return normalizeAppFlow(result)
}

export function screenshotUrl(
  projectId: string,
  relativePath: string | null,
  version?: string
): string | null {
  if (!relativePath) return null
  // `version` is a cache-busting suffix for the renderer's per-URL image cache; callers that
  // already carry one (the auth checkpoint) are left alone.
  const path = relativePath.replace(/^\/+/, '')
  const cached = version && !path.includes('?') ? `${path}?v=${version}` : path
  return getAppFlowHost().screenshotUri?.(projectId, cached)
    ?? `appflow-image://${projectId}/${cached}`
}

function withScreenshotUrls(projectId: string, capture: AppFlowCapture, version: string): AppFlowCapture {
  return {
    ...capture,
    screenshot: screenshotUrl(projectId, capture.screenshot, version),
    // UI-state variants are per-screen files the next explore pass overwrites in place, exactly
    // like the screen's own capture, so they need the same cache-busting version.
    ...(capture.uiStates
      ? {
          uiStates: capture.uiStates.map((state) => ({
            ...state,
            screenshot: screenshotUrl(projectId, state.screenshot, version)
          }))
        }
      : {})
  }
}

export async function readAppFlowForRenderer(projectId: string): Promise<AppFlowResult | null> {
  const result = await readAppFlow(projectId)
  if (!result) return null
  // Screenshot slugs are per-screen files that a later build overwrites in place, and the
  // renderer caches the bytes it fetched per URL for the life of the panel. Versioning the URL
  // with this document's build (constant for its whole run, including the live mid-sweep
  // publishes) is what makes a regenerated capture show up without a reload while the images a
  // sweep never retook keep their cached fetch. Mirrors the `?v=` the auth checkpoint's own
  // prompt screenshot already carries.
  const version = (result.manifest.generatedAt ?? '').replace(/[^0-9a-zA-Z]/g, '')
  return {
    ...result,
    nodes: result.nodes.map((node) =>
      node.capture ? { ...node, capture: withScreenshotUrls(projectId, node.capture, version) } : node
    )
  }
}

export async function writeAppFlow(projectId: string, result: AppFlowResult): Promise<void> {
  await writeJson(join(getProjectDir(projectId), APP_FLOW_FILE), result)
}

export async function readManifest(projectId: string): Promise<AppFlowManifest | null> {
  return readJson<AppFlowManifest>(join(getProjectDir(projectId), MANIFEST_FILE))
}

export async function writeManifest(projectId: string, manifest: AppFlowManifest): Promise<void> {
  await writeJson(join(getProjectDir(projectId), MANIFEST_FILE), manifest)
}

export interface CaptureStatusEntry {
  status: AppFlowCaptureStatus
  needsNavigation: boolean
  note: string | null
}

export type CaptureStatusMap = Record<string, CaptureStatusEntry>

export async function readCaptureStatus(projectId: string): Promise<CaptureStatusMap> {
  return (
    (await readJson<CaptureStatusMap>(join(getProjectDir(projectId), CAPTURE_STATUS_FILE))) ?? {}
  )
}

export async function writeCaptureStatus(
  projectId: string,
  status: CaptureStatusMap
): Promise<void> {
  await writeJson(join(getProjectDir(projectId), CAPTURE_STATUS_FILE), status)
}

/**
 * Route-param values harvested from the running app — the handles and record keys that make
 * `/profile/:name` openable by URL instead of walkable only. See `param-store.ts`.
 *
 * Deliberately its own file rather than a field on `app-flow.json`. That document is the
 * *structure* the parser and the sweep agree on, and it is rewritten wholesale by `writeAppFlow`
 * from half a dozen places; these are *observations about data the app happened to be holding*,
 * which go stale on a schedule of their own — a handle is deleted and the record it named is gone
 * while the route that pointed at it is unchanged. A rebuilt structure document has no business
 * carrying that, and a document that carried it would acquire a second staleness rule nothing else
 * in it obeys.
 *
 * Keeping it separate also makes a corrupt or outdated store one `readJson` returning null rather
 * than a document that fails to normalize and takes the whole structure with it. Records read back
 * here are marked `fromPriorRun` by `ParamStore.fromJSON` and rank below anything observed live
 * this sweep, and a value that 404s is demoted out of the store rather than retried.
 */
export async function readParamStore(projectId: string): Promise<ParamStoreJson | null> {
  return await readJson<ParamStoreJson>(join(getProjectDir(projectId), PARAM_STORE_FILE))
}

export async function writeParamStore(projectId: string, store: ParamStoreJson): Promise<void> {
  await writeJson(join(getProjectDir(projectId), PARAM_STORE_FILE), store)
}

export async function writeAgentDeviceScreens(
  projectId: string,
  screens: AgentDeviceScreensMap
): Promise<void> {
  await writeJson(join(getProjectDir(projectId), AGENT_DEVICE_SCREENS_FILE), screens)
}

export async function readAgentDeviceScreens(projectId: string): Promise<AgentDeviceScreensMap> {
  return (
    (await readJson<AgentDeviceScreensMap>(
      join(getProjectDir(projectId), AGENT_DEVICE_SCREENS_FILE)
    )) ?? {}
  )
}

/**
 * Per-screen checkpoint of an in-flight sweep. A sweep that is stopped, cancelled or crashes
 * leaves this behind so the next build resumes at the first screen it never finished instead of
 * re-driving the device through every screen that already succeeded.
 */
export interface AppFlowSweepProgress {
  /** Fingerprint of the parsed structure. A different structure invalidates the checkpoint. */
  structureKey: string
  /** Exploration pipeline that produced unfinished verdicts in this checkpoint. */
  explorationMode?: ExplorationMode
  /** Hash of route source text used by deterministic Fast. */
  sourceHash?: string
  /** Hash of the injected Fast runtime. */
  fastFingerprint?: string
  updatedAt: string
  /** Finished screens, successful and unreached alike, keyed by node id. */
  captures: Record<string, AppFlowCapture>
  /** Verified deep links, needed to rebuild agent-device screens after a resume. */
  opened: Record<string, { app: string; url: string }>
  /** Screen identities inferred by the arrival verifier. */
  inferred: Record<string, { key?: string; info?: string | null }>
  /**
   * Runtime-discovered nodes/edges and chrome inventories found so far this sweep (plan Steps 3d,
   * 4a), carried in the checkpoint so a resumed sweep reuses their ids instead of re-minting them
   * under different ones. Additive and optional, following the same `?? []` back-fill pattern as
   * `captures`/`opened`/`inferred` above — a checkpoint written before this round, or
   * by code that has not started producing any of these yet, simply has none. Deliberately NOT
   * where a deep-link rejection lives (see `AppFlowDeepLinkRejection`'s doc comment in
   * `shared/app-flow.ts`): `clearSweepProgress` deletes this whole file on every completed sweep,
   * exactly when a rejection most needs to survive, so it rides on the node in `app-flow.json`
   * instead.
   */
  runtimeNodes?: AppFlowNode[]
  runtimeEdges?: AppFlowEdge[]
  chrome?: AppFlowChrome[]
}

export async function readSweepProgress(projectId: string): Promise<AppFlowSweepProgress | null> {
  const progress = await readJson<AppFlowSweepProgress>(
    join(getProjectDir(projectId), SWEEP_PROGRESS_FILE)
  )
  if (!progress?.structureKey) return null
  return {
    ...progress,
    captures: progress.captures ?? {},
    opened: progress.opened ?? {},
    inferred: progress.inferred ?? {},
    runtimeNodes: progress.runtimeNodes ?? [],
    runtimeEdges: progress.runtimeEdges ?? [],
    chrome: progress.chrome ?? []
  }
}

export async function writeSweepProgress(
  projectId: string,
  progress: AppFlowSweepProgress
): Promise<void> {
  await writeJson(join(getProjectDir(projectId), SWEEP_PROGRESS_FILE), progress)
}

export async function clearSweepProgress(projectId: string): Promise<void> {
  await unlink(join(getProjectDir(projectId), SWEEP_PROGRESS_FILE)).catch(() => undefined)
}

export function generateSlug(routeId: string): string {
  return routeId
    .replace(/[^a-zA-Z0-9]/g, '_')
    .replace(/_+/g, '_')
    .toLowerCase()
}

export function getScreenshotPath(projectId: string, slug: string): string {
  return join(getScreensDir(projectId), `${slug}.png`)
}

export function newCaptureId(): string {
  return randomUUID()
}
