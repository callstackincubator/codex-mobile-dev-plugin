import { type ChildProcess } from 'node:child_process'
import { createWriteStream, type WriteStream } from 'node:fs'
import { mkdir, open } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/** Same as `rg -v '^\[(UIKitCore|XCTAutomationSupport|libapp_launch)'`. */
const METRO_NOISE_LINE_RE = /^\[(UIKitCore|XCTAutomationSupport|libapp_launch)/
/** Same as `rg -A 30 '^( ERROR |\[React\])'`. */
const METRO_CRASH_LINE_RE = /^( ERROR |\[React\])/
const METRO_CRASH_CONTEXT_LINES = 30

const openLogs = new Map<string, WriteStream>()

function sanitizeSegment(value: string): string {
  const trimmed = value.trim() || 'session'
  return trimmed.replace(/[^A-Za-z0-9._-]+/g, '_')
}

export function metroLogFilePath(
  userDataDir: string,
  projectId: string,
  sessionName: string
): string {
  return join(
    userDataDir,
    'metro-logs',
    sanitizeSegment(projectId),
    `${sanitizeSegment(sessionName)}.log`
  )
}

export async function beginSessionMetroLog(options: {
  userDataDir: string
  projectId: string
  sessionName: string
}): Promise<string> {
  const path = metroLogFilePath(options.userDataDir, options.projectId, options.sessionName)
  await endMetroLogFile(path)
  await mkdir(dirname(path), { recursive: true })
  const stream = createWriteStream(path, { flags: 'w' })
  stream.on('error', () => undefined)
  openLogs.set(path, stream)
  return path
}

export function pipeChildToMetroLog(path: string, child: ChildProcess): void {
  const stream = openLogs.get(path)
  if (!stream) return
  const write = (chunk: Buffer): void => {
    if (!stream.destroyed && stream.writable) stream.write(chunk)
  }
  child.stdout?.on('data', write)
  child.stderr?.on('data', write)
}

export function endMetroLogFile(path: string | null | undefined): Promise<void> {
  if (!path) return Promise.resolve()
  const stream = openLogs.get(path)
  if (!stream) return Promise.resolve()
  openLogs.delete(path)
  if (stream.destroyed || stream.writableEnded) return Promise.resolve()
  return new Promise((resolve) => {
    stream.end(() => resolve())
  })
}

export function flushMetroLogFile(path: string | null | undefined): Promise<void> {
  if (!path) return Promise.resolve()
  const stream = openLogs.get(path)
  if (!stream || stream.destroyed || !stream.writable) return Promise.resolve()
  return new Promise((resolve) => {
    stream.write('', () => resolve())
  })
}

export async function metroLogByteLength(path: string | null | undefined): Promise<number> {
  if (!path) return 0
  await flushMetroLogFile(path)
  try {
    const handle = await open(path, 'r')
    try {
      return (await handle.stat()).size
    } finally {
      await handle.close()
    }
  } catch {
    return 0
  }
}

/**
 * Keep Metro ERROR / [React] lines (plus 30 lines of context) after dropping
 * UIKit / XCTest / libapp_launch noise. Mirrors:
 * `rg -v '^\[(UIKitCore|XCTAutomationSupport|libapp_launch)' | rg -A 30 '^( ERROR |\[React\])'`
 */
export function filterMetroCrashInfo(logText: string): string {
  const kept = logText.split(/\r?\n/).filter((line) => !METRO_NOISE_LINE_RE.test(line))
  const selected = new Set<number>()
  for (let i = 0; i < kept.length; i++) {
    if (!METRO_CRASH_LINE_RE.test(kept[i])) continue
    const end = Math.min(kept.length - 1, i + METRO_CRASH_CONTEXT_LINES)
    for (let j = i; j <= end; j++) selected.add(j)
  }
  return [...selected]
    .sort((a, b) => a - b)
    .map((index) => kept[index])
    .join('\n')
    .replace(/\n+$/, '')
}

export async function readMetroCrashInfo(path: string, fromByte = 0): Promise<string> {
  await flushMetroLogFile(path)
  const handle = await open(path, 'r')
  try {
    const size = (await handle.stat()).size
    if (fromByte >= size) return ''
    const length = size - fromByte
    const buffer = Buffer.alloc(length)
    await handle.read(buffer, 0, length, fromByte)
    return filterMetroCrashInfo(buffer.toString('utf-8'))
  } finally {
    await handle.close()
  }
}
