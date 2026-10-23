/**
 * Running `swift-appflow-parse` from the plugin.
 *
 * The parser is a Swift binary that statically reads an app's sources and reports which views are
 * screens and how each one could be constructed. This module is the only thing that knows how to
 * reach it, and it deliberately knows nothing about what the report *means* — codegen and the
 * orchestrator read the JSON, not this file.
 *
 * ---- The contract, and why it is frozen ----
 *
 * `main.swift` states it in full. In one line: source root in, one JSON object on stdout, human
 * text on stderr, exit 0 / 2 / 3. That seam is what makes the parser's *distribution* a separate
 * question from the parser itself. Today it is built from source on this machine (option B);
 * shipping a prebuilt binary (option A) is the same code behind the same contract, and a later
 * SourceKit pass that verifies only the doubtful candidates plugs in behind it too. Holding the
 * contract still is what keeps that a packaging change rather than a rewrite of everything
 * downstream — so `resolveSwiftParser` tries a prebuilt binary first and falls back to building,
 * and nothing else in the plugin shells out to the parser.
 *
 * ---- What this costs ----
 *
 * A cold `swift build -c release` of the parser is ~130 s; an incremental one is under a second.
 * That cost lands on the user's machine exactly once per checkout, which is the known price of
 * option B and the reason option A exists. Both paths are measured
 * (`app_flow.swift_parse.{prepare,run}.duration`) so the difference is visible rather than
 * folklore, and neither measurement carries a path, a view name, or anything else from the app.
 */
import { execFile } from 'node:child_process'
import { access, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import {
  SWIFT_PARSE_CONTRACT_VERSION,
  type AppFlowSwiftParseReport
} from '../shared/app-flow.ts'
import { recordRuntimeTiming } from './runtime-telemetry.ts'

const run = promisify(execFile)

/** Exit codes the parser promises. Anything else is a crash, and is reported as one. */
const EXIT_USAGE = 2
const EXIT_UNREADABLE_ROOT = 3

/**
 * A cold build of the parser takes ~130 s measured, so the ceiling has to clear that with room for
 * a slower machine and a cold swift-syntax checkout. A run of the built binary over a 400-file app
 * takes a few seconds, so it gets a far tighter one.
 */
const BUILD_TIMEOUT_MS = 10 * 60 * 1000
const PARSE_TIMEOUT_MS = 2 * 60 * 1000

/** stdout is one JSON report; a pathological tree should fail loudly rather than exhaust memory. */
const MAX_REPORT_BYTES = 64 * 1024 * 1024

/**
 * Something the user can act on — a missing toolchain, a failed build, a contract mismatch.
 *
 * Kept distinct from a crash so callers can show the sentence rather than a stack. Every message
 * says what was looked for and what to do, because the alternative ("Swift parse failed") sends
 * the reader to this file.
 */
export class SwiftParseUnavailableError extends Error {
  readonly reason:
    | 'unsupported_platform'
    | 'toolchain_missing'
    | 'parser_missing'
    | 'build_failed'
    | 'contract_mismatch'
    | 'parse_failed'

  constructor(reason: SwiftParseUnavailableError['reason'], message: string) {
    super(message)
    this.name = 'SwiftParseUnavailableError'
    this.reason = reason
  }
}

/** Where the parser's sources live, relative to this module in both source and `dist` layouts. */
function parserPackageDir(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  return resolve(here, '../../native/swift-appflow-parse')
}

/**
 * Where a prebuilt binary is, in both the layouts this module runs in.
 *
 * From the checkout, `import.meta.url` is `src/app-flow/swift-parse.ts` and the binary is two
 * levels up in `vendor/`. From the packaged plugin everything is bundled into `dist/server.mjs`,
 * so the same relative path leaves the plugin directory entirely and finds nothing — which is why
 * `build.mjs` copies the staged binary to `dist/swift-appflow-parse/` and that is checked first.
 * Both are tried, in that order, because a checkout has no `dist/` and a package has no `vendor/`.
 */
function prebuiltParserPaths(): string[] {
  const here = dirname(fileURLToPath(import.meta.url))
  return [
    resolve(here, 'swift-appflow-parse/swift-appflow-parse'),
    resolve(here, '../../vendor/swift-appflow-parse/swift-appflow-parse')
  ]
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Confirms a Swift toolchain exists before anything tries to use one.
 *
 * Checked separately from the build so "you have no Xcode" and "the parser does not compile" are
 * different sentences. `xcrun --find` is the question Xcode itself answers: a Mac with the
 * Command Line Tools but no selected developer directory fails here rather than three minutes into
 * a build.
 */
export async function requireSwiftToolchain(): Promise<{ path: string; version: string }> {
  if (process.platform !== 'darwin') {
    throw new SwiftParseUnavailableError(
      'unsupported_platform',
      'Mapping a SwiftUI app requires macOS with Xcode; this is not a Mac.'
    )
  }
  let path: string
  try {
    const found = await run('xcrun', ['--find', 'swift'], { timeout: 60_000 })
    path = found.stdout.trim()
  } catch {
    throw new SwiftParseUnavailableError(
      'toolchain_missing',
      'No Swift toolchain found. Install Xcode and run `xcode-select --switch /Applications/Xcode.app`, then try again.'
    )
  }
  if (!path) {
    throw new SwiftParseUnavailableError(
      'toolchain_missing',
      'No Swift toolchain found. Install Xcode and run `xcode-select --switch /Applications/Xcode.app`, then try again.'
    )
  }
  let version = 'unknown'
  try {
    const reported = await run(path, ['--version'], { timeout: 60_000 })
    version = reported.stdout.split('\n')[0]?.trim() || 'unknown'
  } catch {
    // A toolchain that resolves but will not report its version is still worth trying; the build
    // below is the real test, and it fails with the compiler's own words.
  }
  return { path, version }
}

/**
 * Whether the built binary is older than any source it was built from.
 *
 * SwiftPM would work this out itself, but asking it costs a process launch and several seconds on
 * a warm tree, on a path that runs every time a SwiftUI project is opened. Comparing mtimes is the
 * cheap version of the same question, and being wrong in the conservative direction only costs an
 * incremental build.
 */
async function isStale(binary: string, packageDir: string): Promise<boolean> {
  let builtAt: number
  try {
    builtAt = (await stat(binary)).mtimeMs
  } catch {
    return true
  }
  const watched = [
    join(packageDir, 'Package.swift'),
    join(packageDir, 'Package.resolved'),
    join(packageDir, 'Sources/swift-appflow-parse/main.swift'),
    join(packageDir, 'Sources/swift-appflow-parse/Model.swift'),
    join(packageDir, 'Sources/swift-appflow-parse/Collector.swift'),
    join(packageDir, 'Sources/swift-appflow-parse/RouteModel.swift')
  ]
  for (const file of watched) {
    try {
      if ((await stat(file)).mtimeMs > builtAt) return true
    } catch {
      // `Package.resolved` need not exist on a tree that has never resolved; absence is not staleness.
    }
  }
  return false
}

export interface ResolvedSwiftParser {
  /** Absolute path of the executable to run. */
  binary: string
  /** How it was obtained, for the log and for the measurement's `source` attribute. */
  source: 'prebuilt' | 'built' | 'cached'
}

/**
 * Produces a runnable parser, building it from source if that is the only way to get one.
 *
 * The order is the distribution story in code: an explicit override for development, then a
 * prebuilt binary if the package ever ships one, then a local release build. A caller gets the
 * same contract from all three.
 */
export async function resolveSwiftParser(
  options: { packageDir?: string; allowBuild?: boolean } = {}
): Promise<ResolvedSwiftParser> {
  const override = process.env.MOBILE_DEV_SWIFT_APPFLOW_PARSE
  if (override) {
    if (!(await isExecutable(override))) {
      throw new SwiftParseUnavailableError(
        'parser_missing',
        `MOBILE_DEV_SWIFT_APPFLOW_PARSE points at ${override}, which is not an executable file.`
      )
    }
    return { binary: override, source: 'prebuilt' }
  }

  for (const prebuilt of prebuiltParserPaths()) {
    if (await isExecutable(prebuilt)) return { binary: prebuilt, source: 'prebuilt' }
  }

  const packageDir = options.packageDir ?? parserPackageDir()
  const built = join(packageDir, '.build/release/swift-appflow-parse')
  if (!(await isStale(built, packageDir)) && (await isExecutable(built))) {
    return { binary: built, source: 'cached' }
  }

  if (options.allowBuild === false) {
    throw new SwiftParseUnavailableError(
      'parser_missing',
      `The SwiftUI screen parser is not built. Run \`swift build -c release\` in ${packageDir}.`
    )
  }

  await requireSwiftToolchain()
  const startedAt = Date.now()
  try {
    await run('swift', ['build', '-c', 'release'], {
      cwd: packageDir,
      timeout: BUILD_TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024
    })
  } catch (error) {
    recordRuntimeTiming('app_flow.swift_parse.prepare.duration', Date.now() - startedAt, {
      outcome: 'error'
    })
    // The compiler's own first lines say far more than any sentence here could — a swift-syntax
    // major that does not match the installed Swift is the expected failure, and it names itself.
    const detail = buildFailureDetail(error)
    throw new SwiftParseUnavailableError(
      'build_failed',
      `Could not build the SwiftUI screen parser in ${packageDir}.${detail}`
    )
  }
  recordRuntimeTiming('app_flow.swift_parse.prepare.duration', Date.now() - startedAt, {
    outcome: 'ok'
  })
  if (!(await isExecutable(built))) {
    throw new SwiftParseUnavailableError(
      'build_failed',
      `The SwiftUI screen parser built without error but produced no binary at ${built}.`
    )
  }
  return { binary: built, source: 'built' }
}

/** The first few lines of a failed build's stderr, trimmed to something a dialog can show. */
function buildFailureDetail(error: unknown): string {
  const stderr = typeof error === 'object' && error !== null && 'stderr' in error ? String(error.stderr) : ''
  const lines = stderr
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, 4)
  return lines.length > 0 ? `\n${lines.join('\n')}` : ''
}

/**
 * Runs the parser over one source root and returns its report.
 *
 * Every refusal the contract defines is turned into a sentence here, because the alternative is a
 * caller treating a usage error as "this app has no screens". The one case that is *not* an error
 * is a report with no views: a root holding no SwiftUI is a true answer about that root.
 */
export async function runSwiftParser(
  sourceRoot: string,
  parser?: ResolvedSwiftParser
): Promise<AppFlowSwiftParseReport> {
  const resolved = parser ?? (await resolveSwiftParser())
  const startedAt = Date.now()
  let stdout: string
  try {
    const result = await run(resolved.binary, [sourceRoot, '--quiet'], {
      timeout: PARSE_TIMEOUT_MS,
      maxBuffer: MAX_REPORT_BYTES
    })
    stdout = result.stdout
  } catch (error) {
    recordRuntimeTiming('app_flow.swift_parse.run.duration', Date.now() - startedAt, {
      outcome: 'error'
    })
    const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined
    const stderr =
      typeof error === 'object' && error !== null && 'stderr' in error ? String(error.stderr).trim() : ''
    if (code === EXIT_USAGE) {
      throw new SwiftParseUnavailableError(
        'parse_failed',
        `The SwiftUI screen parser rejected its arguments. ${stderr || 'No detail was reported.'}`
      )
    }
    if (code === EXIT_UNREADABLE_ROOT) {
      throw new SwiftParseUnavailableError(
        'parse_failed',
        `The SwiftUI screen parser could not read the source root. ${stderr || sourceRoot}`
      )
    }
    throw new SwiftParseUnavailableError(
      'parse_failed',
      `The SwiftUI screen parser failed (exit ${String(code ?? 'unknown')}). ${stderr || 'No detail was reported.'}`
    )
  }

  let report: AppFlowSwiftParseReport
  try {
    report = JSON.parse(stdout) as AppFlowSwiftParseReport
  } catch {
    throw new SwiftParseUnavailableError(
      'parse_failed',
      'The SwiftUI screen parser exited cleanly but did not print a JSON report.'
    )
  }
  if (report.contractVersion !== SWIFT_PARSE_CONTRACT_VERSION) {
    // Reading a shape we do not know is how a wrong map gets built quietly. Refusing is the whole
    // reason the version is stamped on the report in the first place.
    throw new SwiftParseUnavailableError(
      'contract_mismatch',
      `The SwiftUI screen parser reports contract ${String(report.contractVersion)}, but this plugin reads ` +
        `contract ${String(SWIFT_PARSE_CONTRACT_VERSION)}. Rebuild the parser, or update the plugin.`
    )
  }
  recordRuntimeTiming('app_flow.swift_parse.run.duration', Date.now() - startedAt, {
    outcome: 'ok',
    source: resolved.source
  })
  return report
}

/**
 * Parses every source root of a detected project and returns one report per root.
 *
 * Roots are parsed independently rather than merged here: a project with several of them (an app
 * folder beside a `Sources/` package) genuinely has several, and deciding how their views compose
 * is the codegen step's job, not this one's.
 */
export async function parseSwiftSourceRoots(
  sourceRoots: readonly string[]
): Promise<AppFlowSwiftParseReport[]> {
  if (sourceRoots.length === 0) return []
  const parser = await resolveSwiftParser()
  const reports: AppFlowSwiftParseReport[] = []
  for (const root of sourceRoots) reports.push(await runSwiftParser(root, parser))
  return reports
}
