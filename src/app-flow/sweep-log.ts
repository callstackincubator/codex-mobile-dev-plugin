/**
 * The per-run Fast log: one JSONL file per sweep, under the project's own data directory.
 *
 * ## Why a file and not the console
 *
 * The console line a rung prints is for the person watching the run. This is for the person
 * reading *afterwards* — comparing a 13-node run against yesterday's, or answering "where did the
 * 9.6 seconds a screen go" without scraping a terminal transcript. One object per node, the fields
 * already measured, in a format `jq` can read:
 *
 * ```
 * {"nodeId":"HomeTab/Profile","routeRequested":"HomeTab/Profile","routeResolved":["HomeTab","Profile"],
 *  "dispatch":{"ok":true,"action":"navigate","reason":"Dispatched HomeTab > Profile.","ms":118},
 *  "settle":{"polls":6,"stop":"settled","ms":340,"content":48},
 *  "verify":{"path":"runtime","verdict":"match","ms":21},
 *  "delivery":{"screenshotMs":880,"pressables":31},"status":"ok","totalMs":1392}
 * ```
 *
 * The last line is the sweep's phase summary (`formatPhaseSummary`), so a file read on its own
 * says both where one node went and where the run as a whole went.
 *
 * ## It may never cost a capture
 *
 * Everything here is best-effort by construction. Records are buffered and appended on an interval
 * (and once at sweep end), so a node never waits on a disk write; the first write failure logs
 * once and disables the log for the rest of the run; and nothing in this module throws into the
 * sweep — `appendRecord` and `finish` swallow their own errors. A sweep whose log file could not
 * be created runs exactly as it would with no log at all, because `createSweepLog` returns null
 * and every call site treats the port as optional (see `SweepLogPort`).
 *
 * ## Privacy
 *
 * Local only, and nothing here feeds telemetry. Route names and counts, no parameter *values*
 * (the param store refuses to log those for the same reason), no screenshots, no pressable text,
 * no device identifiers, and no local paths beyond this file's own location.
 */
import { appendFile, mkdir, readdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { getProjectDir } from './storage.ts'
import type { SweepLogPort, SweepNodeLog } from './reach/ports.ts'

/** Run logs kept per project. Older files are removed at sweep start, newest first. */
export const SWEEP_LOG_KEEP_RUNS = 20

/** How often buffered records are appended. Short enough that a crashed sweep loses little,
 *  long enough that a 200-screen run is not 200 separate opens. */
const FLUSH_INTERVAL_MS = 2_000

export const RUNS_DIR_NAME = 'runs'

/** `fast-20261016T093012-0833de79.jsonl` — sortable, and the run id's first 8 characters are
 *  enough to tie the file to a run record without carrying the whole uuid. */
export function sweepLogFileName(startedAt: number | Date, runId: string): string {
  const stamp = new Date(startedAt).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
  return `fast-${stamp}-${(runId || 'unknown').replace(/[^\w-]/g, '').slice(0, 8)}.jsonl`
}

export function sweepLogDir(projectId: string): string {
  return join(getProjectDir(projectId), RUNS_DIR_NAME)
}

/**
 * Keep the newest `keep` run logs and delete the rest — in the style of `pruneTransientScreens`:
 * a best-effort sweep-start tidy that returns quietly when the directory does not exist yet, and
 * never reports a failed unlink as anything.
 *
 * Names sort chronologically (the timestamp is fixed-width and leads), so this needs no `stat`.
 */
export async function pruneSweepLogs(projectId: string, keep = SWEEP_LOG_KEEP_RUNS): Promise<void> {
  const dir = sweepLogDir(projectId)
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return
  }
  const logs = entries.filter((entry) => /^fast-.*\.jsonl$/.test(entry)).sort()
  const stale = logs.slice(0, Math.max(0, logs.length - keep))
  await Promise.all(stale.map((entry) => unlink(join(dir, entry)).catch(() => undefined)))
}

export interface SweepLog extends SweepLogPort {
  /** Where the records are going — logged once so a reader can find the file. */
  readonly path: string
  /** Append whatever is buffered. Never rejects. */
  flush(): Promise<void>
  /** Write the closing lines (the sweep's phase summary) and stop the interval. Never rejects. */
  close(summary?: readonly string[]): Promise<void>
}

/** One node's record as it is being filled in — see `SweepNodeLog` for who fills each part. */
interface NodeRecord {
  nodeId: string
  routeRequested?: string
  routeResolved?: readonly string[] | null
  dispatch?: unknown
  settle?: unknown
  verify?: unknown
  delivery?: unknown
  status?: string
  totalMs?: number
}

/**
 * Open a run log, or return null when it cannot be opened.
 *
 * Null is an ordinary outcome, not an error: the sweep runs without a log and every call site
 * already treats the port as optional.
 */
export async function createSweepLog(options: {
  projectId: string
  runId: string
  startedAt: number | Date
  keep?: number
  /** Injected so a test can watch the appends, and so the interval can be driven deterministically. */
  append?: (path: string, data: string) => Promise<void>
  log?: (message: string) => void
}): Promise<SweepLog | null> {
  const write = options.append ?? ((path, data) => appendFile(path, data, 'utf-8'))
  const say = options.log ?? ((message: string) => console.log(message))
  const dir = sweepLogDir(options.projectId)
  const path = join(dir, sweepLogFileName(options.startedAt, options.runId))
  try {
    await mkdir(dir, { recursive: true })
    await pruneSweepLogs(options.projectId, options.keep ?? SWEEP_LOG_KEEP_RUNS)
  } catch (error) {
    say(
      `[app-flow] run log unavailable — ${error instanceof Error ? error.message : String(error)}`
    )
    return null
  }

  let disabled = false
  let buffer: string[] = []

  const flush = async (): Promise<void> => {
    if (disabled || !buffer.length) return
    const pending = buffer.join('')
    buffer = []
    try {
      await write(path, pending)
    } catch (error) {
      // Once. A log that reported every failed append would turn one unwritable directory into a
      // line per node, which is the opposite of what a log is for.
      disabled = true
      say(
        `[app-flow] run log disabled after a failed write — ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  const timer = setInterval(() => {
    void flush()
  }, FLUSH_INTERVAL_MS)
  timer.unref?.()

  const push = (record: unknown): void => {
    if (disabled) return
    try {
      buffer.push(`${JSON.stringify(record)}\n`)
    } catch {
      // A record that will not serialise is this record's problem, not the log's.
    }
  }

  /**
   * One open record per node, shared by every writer.
   *
   * The rung fills in dispatch/settle/verify and the orchestrator fills in delivery and the final
   * status, so `node(id)` must hand both of them the *same* record or a node would log twice with
   * half the fields each. The entry is dropped on `finish`, so a requeued node starts a fresh
   * record and gets its own line.
   */
  const open = new Map<string, SweepNodeLog>()

  /** The transport reason is a run-level fact, written once however many nodes rediscover it. */
  let transportReported = false

  return {
    path,
    transportUnavailable(reason: string): void {
      if (transportReported) return
      transportReported = true
      push({ transport: 'unavailable', reason })
    },
    node(id: string): SweepNodeLog {
      const existing = open.get(id)
      if (existing) return existing
      const record: NodeRecord = { nodeId: id }
      let appended = false
      const entry: SweepNodeLog = {
        route(requested, resolved) {
          record.routeRequested = requested
          record.routeResolved = resolved ? [...resolved] : null
        },
        dispatch(entry) {
          record.dispatch = entry
        },
        settle(entry) {
          record.settle = entry
        },
        verify(entry) {
          record.verify = entry
        },
        delivery(entry) {
          record.delivery = entry
        },
        finish(closing) {
          // Guards only against one record being appended twice; a requeued node gets a new one.
          if (appended) return
          appended = true
          record.status = closing.status
          record.totalMs = closing.totalMs
          open.delete(id)
          push(record)
        }
      }
      open.set(id, entry)
      return entry
    },
    flush,
    async close(summary?: readonly string[]): Promise<void> {
      clearInterval(timer)
      // A node still open at sweep end was cut off mid-ladder (a cancel, a pause, a throw). Its
      // partial record is more useful than no record, so it is appended as `incomplete`.
      for (const entry of [...open.values()]) entry.finish({ status: 'incomplete', totalMs: 0 })
      if (summary?.length) push({ summary: [...summary] })
      await flush()
    }
  }
}
