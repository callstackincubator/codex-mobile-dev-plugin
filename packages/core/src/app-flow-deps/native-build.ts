import { createHash } from 'node:crypto'
import type { Dirent } from 'node:fs'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
/**
 * The platforms a native build can target. Declared here rather than imported from any one
 * pipeline's device module: this file is shared by `app-flow` and `profiling`, and a type import
 * into either of them would make a leaf module depend on one of its own consumers.
 */
type DevicePlatform = 'ios' | 'android'

/**
 * One store for the whole app, not one per pipeline.
 *
 * What a record answers — "is the binary this project would build already on this device" — is a
 * property of the project and the device, not of whoever is asking. Keeping a copy under each
 * pipeline's own project folder meant `app-flow` and `profiling` each paid for the first build
 * separately, and meant a record was discarded whenever its pipeline's results were cleared, which
 * is exactly what happened on 2026-10-05: the flow folder was emptied between two runs and the
 * install recorded by the first was gone by the second.
 */
const NATIVE_BUILDS_FILE = 'native-builds.json'

/**
 * Directory names that hold build output rather than build input.
 *
 * `Pods/` and `.gradle/` are derived caches: what actually decides the shape of the binary is
 * `Podfile.lock` / the gradle files, which are fingerprinted. Walking the derived trees instead
 * would cost seconds and change on every build, which is exactly the false "dirty" this is meant
 * to avoid.
 */
const IGNORED_DIRS = new Set([
  'build',
  'Build',
  'Pods',
  'DerivedData',
  '.gradle',
  '.cxx',
  'xcuserdata',
  'node_modules'
])

/**
 * Root files that change what a native build produces. JS and asset sources are deliberately
 * absent: a debug dev-client build loads those from Metro at runtime, so editing them does not
 * invalidate the installed binary — that is the whole reason skipping the rebuild is safe.
 */
const ROOT_INPUTS = [
  'package.json',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lockb',
  'bun.lock',
  'app.json',
  'app.config.js',
  'app.config.ts',
  'app.config.json',
  'expo-env.d.ts'
]

interface BuildRecord {
  fingerprint: string
  launchTarget: string
  recordedAt: string
}

type BuildRecords = Record<string, BuildRecord>

/**
 * Keyed by the project's own path rather than by a caller-supplied id: `app-flow` and `profiling`
 * hash a project into ids of their own, so keying on either one would hand the same project two
 * records and defeat the point of sharing the store.
 */
function projectHash(projectPath: string): string {
  return createHash('sha256').update(projectPath).digest('hex').slice(0, 16)
}

function recordKey(projectPath: string, platform: DevicePlatform, deviceId: string): string {
  return `${projectHash(projectPath)}:${platform}:${deviceId}`
}

async function readRecords(file: string): Promise<BuildRecords> {
  try {
    return JSON.parse(await readFile(file, 'utf-8')) as BuildRecords
  } catch {
    return {}
  }
}

async function writeRecords(file: string, records: BuildRecords): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(records, null, 2), 'utf-8')
}

async function collectDir(root: string, dir: string, into: string[]): Promise<void> {
  let entries: Dirent[]
  try {
    entries = await readdir(dir, { withFileTypes: true, encoding: 'utf-8' })
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.xcode.env') continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue
      await collectDir(root, full, into)
      continue
    }
    if (!entry.isFile()) continue
    into.push(full.slice(root.length + 1))
  }
}

/**
 * Large files are folded in by size alone. Binaries that big in a native source tree are checked-in
 * assets and frameworks, which do not change silently, and reading them would turn a check worth
 * fractions of a second into one worth several.
 */
const MAX_HASHED_BYTES = 2 * 1024 * 1024

async function hashFile(path: string, hash: ReturnType<typeof createHash>): Promise<void> {
  try {
    const { size } = await stat(path)
    if (size > MAX_HASHED_BYTES) {
      hash.update(`size:${size}`)
      return
    }
    hash.update(await readFile(path))
  } catch {
    hash.update('<unreadable>')
  }
}

/**
 * A digest of everything that decides whether the installed debug binary is still the one this
 * project would build, or `null` when that question cannot be answered.
 *
 * `null` means "rebuild": it is returned for a project with no checked-in native directory, where
 * `expo run:<platform>` prebuilds the project from config on every invocation and there is no
 * stable input tree to compare against. Guessing "unchanged" there would hand back a stale binary
 * with no way for the caller to notice.
 */
export async function computeNativeBuildFingerprint(
  projectPath: string,
  platform: DevicePlatform
): Promise<string | null> {
  const nativeDir = join(projectPath, platform)
  if (!existsSync(nativeDir)) return null

  const relatives: string[] = []
  await collectDir(nativeDir, nativeDir, relatives)
  if (!relatives.length) return null
  relatives.sort()

  const hash = createHash('sha256')
  for (const relative of relatives) {
    hash.update(relative)
    hash.update('\0')
    await hashFile(join(nativeDir, relative), hash)
    hash.update('\0')
  }
  for (const name of ROOT_INPUTS) {
    const full = join(projectPath, name)
    if (!existsSync(full)) continue
    hash.update(name)
    hash.update('\0')
    await hashFile(full, hash)
    hash.update('\0')
  }
  return hash.digest('hex')
}

/**
 * The record half of this module, bound to the directory that holds the store.
 *
 * A factory rather than four free functions reading a path from `electron`: this file is imported
 * by a `node --test` suite, and a value import of `electron` anywhere in it would drag the runtime
 * into the test. `native-build-store.ts` binds the real directory for the app; the tests bind a
 * temporary one.
 */
export interface NativeBuildStore {
  /** Whether this device has any recorded install for this project, matching or not. Only shapes the log line. */
  has(projectPath: string, platform: DevicePlatform, deviceId: string): Promise<boolean>

  /** The launch target recorded for a matching build, or `null` when a rebuild is required. */
  read(
    projectPath: string,
    platform: DevicePlatform,
    deviceId: string,
    fingerprint: string | null
  ): Promise<string | null>

  record(
    projectPath: string,
    platform: DevicePlatform,
    deviceId: string,
    fingerprint: string | null,
    launchTarget: string
  ): Promise<void>

  /**
   * Re-points an existing record at whatever the sources hash to now, after a rebuild that
   * reinstalled the app outside the boot path and so never learned the launch target for itself.
   *
   * Without this a rebuild leaves the record describing the *previous* binary. That is usually
   * harmless — the sources moved, so the fingerprints no longer match and the next boot rebuilds —
   * but it is wrong the moment the sources move back, which would match a record for a binary that
   * is no longer installed.
   */
  refresh(
    projectPath: string,
    platform: DevicePlatform,
    deviceId: string,
    fingerprint: string | null
  ): Promise<void>

  /**
   * The device this project was most recently built on, for the caller to ask for by name when it
   * boots — or `null` when there is nothing recorded yet.
   *
   * Reuse is keyed by device, so booting "whatever simulator the daemon picks" quietly decides
   * whether a build can be reused at all: a second simulator appearing, or a new Xcode adding a
   * newer iPhone, changes the pick and costs a full rebuild with nothing in the log to explain it.
   *
   * Derived from the records rather than stored alongside them, because the question "where would
   * reuse hit" is already answered by which devices have records. That also makes the preference
   * self-correcting: a device whose record is dropped stops being preferred.
   */
  preferredDevice(projectPath: string, platform: DevicePlatform): Promise<string | null>
}

export function createNativeBuildStore(storeDir: string): NativeBuildStore {
  const file = join(storeDir, NATIVE_BUILDS_FILE)

  async function record(
    projectPath: string,
    platform: DevicePlatform,
    deviceId: string,
    fingerprint: string | null,
    launchTarget: string
  ): Promise<void> {
    if (!fingerprint) return
    const records = await readRecords(file)
    records[recordKey(projectPath, platform, deviceId)] = {
      fingerprint,
      launchTarget,
      recordedAt: new Date().toISOString()
    }
    await writeRecords(file, records)
  }

  return {
    async has(projectPath, platform, deviceId) {
      return recordKey(projectPath, platform, deviceId) in (await readRecords(file))
    },
    async read(projectPath, platform, deviceId, fingerprint) {
      if (!fingerprint) return null
      const existing = (await readRecords(file))[recordKey(projectPath, platform, deviceId)]
      if (!existing || existing.fingerprint !== fingerprint) return null
      return existing.launchTarget
    },
    record,
    async preferredDevice(projectPath, platform) {
      const prefix = `${projectHash(projectPath)}:${platform}:`
      let best: { deviceId: string; recordedAt: string } | null = null
      for (const [key, value] of Object.entries(await readRecords(file))) {
        if (!key.startsWith(prefix)) continue
        // Lexicographic rather than parsed: `recordedAt` is always `toISOString()` output, which is
        // fixed-width UTC and so orders correctly as text.
        if (best && value.recordedAt <= best.recordedAt) continue
        best = { deviceId: key.slice(prefix.length), recordedAt: value.recordedAt }
      }
      return best?.deviceId ?? null
    },
    async refresh(projectPath, platform, deviceId, fingerprint) {
      const existing = (await readRecords(file))[recordKey(projectPath, platform, deviceId)]
      if (!existing || !fingerprint) return
      await record(projectPath, platform, deviceId, fingerprint, existing.launchTarget)
    }
  }
}
