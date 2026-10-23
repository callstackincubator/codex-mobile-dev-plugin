/**
 * The capture loop: one app process, every screen.
 *
 * Launch once, wait for the control channel, then for each screen dismiss whatever is up, present
 * the next one, wait for it to settle, and raster it. The process is relaunched only to recover
 * from a death, never between two healthy screens.
 *
 * ---- Why one process ----
 *
 * This replaces a relaunch-per-screen loop, and the swap was a deliberate alignment with React
 * Native Fast mode, which drives a live app and does not restart it per screen. Two capture paths
 * in one feature that disagree about something this basic is a cost paid on every later change,
 * and a user watching the simulator sees a different thing happen depending on which language
 * their app is written in.
 *
 * ---- What a relaunch bought, and what is done instead ----
 *
 * **State.** A root-owned store outlives a capture: dismissing the presentation resets view
 * identity, not the store, so whatever one screen wrote is visible to the next. Measured --
 * present `TwoStageOrderView`, which drives its own store to stage 3, then present an unrelated
 * screen, and the store is still at stage 3. A fresh process could not leak; this loop can, and
 * does. Nothing here fixes it, because the in-process fix needs every store in the app to conform
 * to a protocol of ours, which is the per-screen source change this design exists to avoid. The
 * honest statement is that a capture shows the screen as it looks after the screens before it,
 * which is also what Fast mode shows for React Native.
 *
 * **Pending work.** `/reset` clears the harness's own work ledger before each presentation, so a
 * readiness signal is not satisfied by the previous screen's accounting. Work the *app* scheduled
 * is still in flight and still lands in the next capture. Same trade, same reason.
 *
 * **Crashes.** This is the one that is actually replaced rather than accepted. A dead channel ends
 * the screen, not the run: the screen is recorded as `crashed`, the app is relaunched once, and
 * the loop continues. Only a relaunch that itself fails ends the run. So crash isolation survives
 * at the cost of one relaunch per crash instead of one per screen.
 *
 * ---- What this does not do ----
 *
 * It does not decide whether a capture is *correct*. It reports what the app said -- which signal
 * fired, when, and which declared environment requirements were unsatisfied at the presentation
 * site -- and leaves the judgement to the caller. An environment-unsatisfied screen is still
 * captured, because the screenshot is evidence; it is just not reported as clean.
 */
import { execFile } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { recordRuntimeTiming, recordRuntimeCount } from './runtime-telemetry.ts'

const run = promisify(execFile)

/** The app's own loopback control channel. See `ControlServer.swift` for why it is not a URL scheme. */
const DEFAULT_CONTROL_URL = 'http://127.0.0.1:8765'

/**
 * How long to wait for a relaunched app to answer. A relaunch measures ~610 ms, so this is roughly
 * 25× the expected value: it is a liveness bound for an app that will never answer, not a timing
 * assertion.
 */
const LAUNCH_TIMEOUT_MS = 15_000
const LAUNCH_POLL_MS = 50

/**
 * Per-screen readiness budget. The backstop fires at this and the capture is taken anyway.
 *
 * The backstop is the common path, not the exception: on IceCubesApp 18 of 39 screens never
 * reach `idle`, blocked by decoration indistinguishable from a loading spinner. It is still
 * 5000 ms, and that is now a measured figure rather than an assumed one -- a lower budget was
 * tried and rejected, because the demo's `FeedView` answers honestly at 2851 ms and a 2000 ms
 * budget truncates it. See `Tuning.budgetMs` in Harness.swift for both measurements and why
 * the slowest real readiness governs instead of the slowest pixel.
 */
const DEFAULT_BUDGET_MS = 5_000

/**
 * Which signal the loop waits on before capturing.
 *
 * `idle` is the default because it is the only cheap signal measured correct on every screen of the
 * harness corpus (13/13) without the app declaring anything. `timeout` is a flat settle and always
 * "correct" at 4 s a screen; `frame` and `stable` are kept because the comparison that chose `idle`
 * is only honest if the losers can still be run.
 */
export type SwiftReadinessSignal = 'idle' | 'timeout' | 'frame' | 'stable'

/**
 * Where the harness puts the screen.
 *
 * `overlay` is the default: inside the live root view tree, so the screen inherits every
 * environment the app root installed, for free and with nothing to configure. It is also *under*
 * anything the app itself presents — and an app that presents a sheet at launch (IceCubesApp does,
 * while logged out) then has that sheet, not the screen, in every raster.
 *
 * `window` puts the screen in a window above everything and re-applies the app-root environment
 * from a closure the app itself supplies. `bare` is the hostile control: the same window with no
 * environment at all.
 */
export type SwiftPresentationMode = 'overlay' | 'window' | 'bare'

export type SwiftCaptureOutcome =
  /** Presented, settled, rastered. */
  | 'captured'
  /** Presented and rastered, but the screen declares environment it did not get. */
  | 'environment_unsatisfied'
  /** The process died. One capture lost; the app is relaunched and the run continues. */
  | 'crashed'
  /** The registry has no entry: the parser refused to construct it. Never launched. */
  | 'refused'

export interface SwiftScreenCapture {
  screen: string
  outcome: SwiftCaptureOutcome
  /** Absolute path of the PNG, or null when nothing was captured. */
  screenshotPath: string | null
  /** When the awaited signal fired, or null when the backstop fired instead. */
  waitedMs: number | null
  /** Declared environment keys that were not installed where the screen was presented. */
  environmentMissing: string[]
  /** What the parser said stood in the way, for a `refused` screen. */
  missing: string[]
  /**
   * Time spent relaunching the app before this screen, or null when none was needed.
   *
   * Null is the common case now: a relaunch happens for the first screen of a run and after a
   * crash, not between two healthy screens. A run where this is non-null often is a run whose app
   * is dying often, which is worth seeing.
   */
  relaunchMs: number | null
  /** One sentence, present only on `crashed`. */
  error?: string
}

export interface SwiftCaptureRun {
  captures: SwiftScreenCapture[]
  /** Every screen the parser refused, whether or not it was asked for. */
  refusedByParser: Record<string, string[]>
}

export interface SwiftCaptureOptions {
  /** simctl device UDID, or `booted`. */
  deviceId: string
  bundleId: string
  /** Where the PNGs go. Created if absent. */
  outputDir: string
  /** Defaults to every screen the registry holds. */
  screens?: readonly string[]
  signal?: SwiftReadinessSignal
  /** Defaults to `overlay`. */
  mode?: SwiftPresentationMode
  budgetMs?: number
  controlUrl?: string
  abortSignal?: AbortSignal
  /** Called after each screen, so a long run can report progress instead of going quiet. */
  onProgress?: (capture: SwiftScreenCapture, index: number, total: number) => void
}

interface PresentResponse {
  screen: string
  fired: boolean
  wait_ms: number | null
  env: { satisfied: string[]; missing: string[]; advisory?: string[] }
  /**
   * Set instead of everything else when the harness refused the request. It used to accept an
   * unknown mode or signal silently and substitute its default, which meant a run measured one
   * thing and reported another; a build that refuses says so here.
   */
  error?: string
  /**
   * What the request got wrong, when it was refused. `mode` and `signal` are about the run — every
   * remaining screen would be refused the same way — while `screen` is about this screen alone.
   * Absent on a harness predating the field, which is read as the per-screen kind: that was the
   * only refusal such a build had.
   */
  refusal?: 'screen' | 'mode' | 'signal'
}

/** An error we expect and report, as opposed to a bug in this module. */
export class SwiftCaptureError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SwiftCaptureError'
  }
}

/**
 * The harness refused the request itself, rather than failing to present a screen.
 *
 * Separate from a crash because it is not one: the app is healthy and the request is wrong, so
 * every remaining screen would be refused in exactly the same way. Retrying or relaunching would
 * only pay the cost again, so this leaves the loop at once — the same reason
 * `ControlChannelIdentityError` does.
 *
 * A `SwiftCaptureError`, because it is a fact about the run: `runSwiftSweep` gives every node the
 * same sentence and records the phase as an error, rather than letting an exception past the sweep
 * with no measurement and no explanation on the map.
 */
export class ControlRequestRefusedError extends SwiftCaptureError {
  constructor(message: string) {
    super(message)
    this.name = 'ControlRequestRefusedError'
  }
}

async function simctl(args: readonly string[], timeoutMs = 60_000): Promise<string> {
  const result = await run('xcrun', ['simctl', ...args], { timeout: timeoutMs })
  return result.stdout
}

/**
 * One control-channel request.
 *
 * `fetch` reports a dead peer as the single word "fetch failed", which in a capture log is
 * indistinguishable from every other network problem and says nothing about which screen was up.
 * Since a dead peer is the *expected* failure here — it is what a crashing screen looks like from
 * outside — the message is rewritten to name the route.
 */
async function controlGet(url: string, abortSignal?: AbortSignal, timeoutMs = 60_000): Promise<Response> {
  const timeout = AbortSignal.timeout(timeoutMs)
  const composed = abortSignal ? AbortSignal.any([abortSignal, timeout]) : timeout
  const route = new URL(url).pathname
  let response: Response
  try {
    response = await fetch(url, { signal: composed })
  } catch (error) {
    abortSignal?.throwIfAborted()
    if (timeout.aborted) {
      throw new SwiftCaptureError(`${route} did not answer within ${String(timeoutMs)} ms.`)
    }
    throw new SwiftCaptureError(
      `${route} is unreachable — the app is no longer running (${
        error instanceof Error ? error.message : String(error)
      }).`
    )
  }
  if (!response.ok) throw new SwiftCaptureError(`${route} answered ${String(response.status)}.`)
  return response
}

/**
 * The control channel answered, but for a different app.
 *
 * Distinct from `SwiftCaptureError` because the launch loop retries every ordinary failure
 * until it times out -- the app is usually just not up yet -- and this one must not be
 * retried: it is not a timing problem and waiting cannot resolve it.
 */
class ControlChannelIdentityError extends SwiftCaptureError {}

/**
 * Terminates and relaunches the app, returning when its control channel answers.
 *
 * Readiness is the channel answering, not `simctl launch` returning: launch returns as soon as the
 * process exists, which is well before the app can be driven. Terminating a process that is not
 * running is not an error here — after a crash it is the normal case, and after a crash is now one
 * of only two times this is called at all.
 */
async function relaunch(options: SwiftCaptureOptions): Promise<number> {
  const controlUrl = options.controlUrl ?? DEFAULT_CONTROL_URL
  const startedAt = Date.now()
  try {
    await simctl(['terminate', options.deviceId, options.bundleId])
  } catch {
    // Already gone. Expected after a crash, and after the first launch of a run.
  }
  await simctl(['launch', options.deviceId, options.bundleId])
  for (;;) {
    options.abortSignal?.throwIfAborted()
    try {
      const answered = (await (
        await controlGet(`${controlUrl}/screens`, options.abortSignal, 2_000)
      ).json()) as { bundle_id?: string }
      // Whoever holds the port answers, not necessarily the app we just launched. The port is
      // a constant, so a demo build left running will serve its own registry while `simctl
      // launch` starts something else -- and every screenshot and timing after that belongs to
      // the wrong app while looking entirely reasonable. Refusing is the only safe answer; a
      // build with no `bundle_id` predates the field and cannot be checked, so it is allowed
      // through rather than failing every older build.
      if (answered.bundle_id !== undefined && answered.bundle_id !== options.bundleId) {
        // Counted, because this failure is otherwise invisible: before the check existed the
        // run simply produced a full set of plausible screenshots of the wrong app. A count
        // of how often a stale harness build is left holding the port is the only way to
        // know whether that is happening in the field. The bundle ids are deliberately not
        // attributes -- they are app identifiers.
        recordRuntimeCount('app_flow.swift_capture.control_channel_mismatch')
        throw new ControlChannelIdentityError(
          `The control channel at ${controlUrl} belongs to ${answered.bundle_id}, not ` +
            `${options.bundleId}. Another app with the harness built in is already holding the ` +
            `port; terminate it and run again.`
        )
      }
      return Date.now() - startedAt
    } catch (error) {
      // Every other failure here means "not up yet" and is retried until the timeout. A wrong
      // app is not a timing problem and never becomes one, so it is the single case that
      // leaves the loop immediately.
      if (error instanceof ControlChannelIdentityError) throw error
      if (Date.now() - startedAt > LAUNCH_TIMEOUT_MS) {
        throw new SwiftCaptureError(
          `${options.bundleId} did not answer its control channel within ${String(LAUNCH_TIMEOUT_MS)} ms of launching.`
        )
      }
      await new Promise((resolve) => setTimeout(resolve, LAUNCH_POLL_MS))
    }
  }
}

/** The screens the running build actually holds, and what the parser refused. */
export async function registryContents(
  options: Pick<SwiftCaptureOptions, 'controlUrl' | 'abortSignal'>
): Promise<{ screens: string[]; refusedByParser: Record<string, string[]> }> {
  const controlUrl = options.controlUrl ?? DEFAULT_CONTROL_URL
  const listed = (await (await controlGet(`${controlUrl}/screens`, options.abortSignal)).json()) as {
    screens: string[]
  }
  const refusedByParser: Record<string, string[]> = {}
  try {
    const refused = (await (await controlGet(`${controlUrl}/missing`, options.abortSignal)).json()) as {
      missing: { view: string; missing: string[] }[]
    }
    for (const row of refused.missing) refusedByParser[row.view] = row.missing
  } catch {
    // A build predating the `/missing` route still captures; it just cannot say what it skipped.
  }
  return { screens: listed.screens, refusedByParser }
}

/**
 * Captures one screen in the already-running app.
 *
 * Every failure from here to the written PNG is the same outcome — `crashed` — because from
 * outside they are indistinguishable and the response is identical: record it, let the caller
 * bring the app back, move on. Calling a dead channel "a network error" would be a more precise
 * lie.
 *
 * `relaunchMs` is whatever the caller spent getting the app up for *this* screen, which is zero
 * for every screen that followed a healthy one.
 */
async function captureOne(
  screen: string,
  options: SwiftCaptureOptions,
  refusedByParser: Record<string, string[]>,
  relaunchMs: number | null
): Promise<SwiftScreenCapture> {
  const base: SwiftScreenCapture = {
    screen,
    outcome: 'captured',
    screenshotPath: null,
    waitedMs: null,
    environmentMissing: [],
    missing: [],
    relaunchMs
  }
  if (screen in refusedByParser) {
    // Nothing to present: the parser could not construct it, which is a result, not a failure.
    return { ...base, outcome: 'refused', relaunchMs: null, missing: refusedByParser[screen] ?? [] }
  }

  const controlUrl = options.controlUrl ?? DEFAULT_CONTROL_URL
  const budgetMs = options.budgetMs ?? DEFAULT_BUDGET_MS
  const signal = options.signal ?? 'idle'
  try {
    // Whatever the last screen left on screen has to come down first. On the first screen of a
    // run there is nothing up and this is a no-op; it is unconditional because the alternative is
    // tracking presentation state on this side of the channel, which the app already tracks.
    await controlGet(`${controlUrl}/dismiss`, options.abortSignal, 5_000)
    // Clears the harness's work ledger, so `idle` is answering about this screen and not about
    // what the previous one was still accounting for. It cannot clear the app's own stores; see
    // the state note at the top of this file.
    await controlGet(`${controlUrl}/reset`, options.abortSignal, 5_000)
    // The HUD is for driving the harness by hand and ruinous when the screenshot is the artifact.
    await controlGet(`${controlUrl}/hud?on=0`, options.abortSignal, 5_000)

    const mode = options.mode ?? 'overlay'
    const query = `screen=${encodeURIComponent(screen)}&signal=${signal}&mode=${mode}&budget_ms=${String(budgetMs)}`
    const presented = (await (
      await controlGet(`${controlUrl}/present?${query}`, options.abortSignal, budgetMs + 30_000)
    ).json()) as PresentResponse
    if (presented.error !== undefined) {
      if (presented.refusal === 'mode' || presented.refusal === 'signal') {
        throw new ControlRequestRefusedError(
          `The harness at ${controlUrl} refused the request: ${presented.error}. This build has ` +
            `no ${presented.refusal} '${presented.refusal === 'mode' ? mode : signal}' — rebuild ` +
            `it from the current harness sources, or ask for one it has.`
        )
      }
      // A screen this build does not have is one screen's answer. `captureSwiftScreens` already
      // leaves such a screen unpresented, so reaching here means a registry that changed under a
      // running sweep; it is reported as this screen's error rather than the run's.
      throw new Error(`${screen}: ${presented.error}`)
    }
    recordRuntimeTiming('app_flow.swift_capture.settle.duration', presented.wait_ms ?? budgetMs, {
      signal,
      outcome: presented.fired ? 'fired' : 'backstop'
    })

    const rasterStartedAt = Date.now()
    const png = Buffer.from(
      await (await controlGet(`${controlUrl}/snapshot?kind=draw`, options.abortSignal, 60_000)).arrayBuffer()
    )
    recordRuntimeTiming('app_flow.swift_capture.raster.duration', Date.now() - rasterStartedAt)

    const screenshotPath = join(options.outputDir, `${screen}.png`)
    await writeFile(screenshotPath, png)

    const environmentMissing = presented.env.missing
    return {
      ...base,
      // A missing `@Environment` key does not trap — SwiftUI hands back `defaultValue` and the
      // screen renders a plausible lie that no screenshot comparison can catch. The capture is
      // kept because it is evidence; it is just not reported as clean.
      outcome: environmentMissing.length > 0 ? 'environment_unsatisfied' : 'captured',
      screenshotPath,
      waitedMs: presented.fired ? presented.wait_ms : null,
      environmentMissing
    }
  } catch (error) {
    options.abortSignal?.throwIfAborted()
    // A refused request is not a dead app, and calling it a crash would send the loop relaunching
    // to recover from something a relaunch cannot change.
    if (error instanceof ControlRequestRefusedError) throw error
    return {
      ...base,
      outcome: 'crashed',
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

/**
 * Captures every requested screen in one app process.
 *
 * The loop is sequential on purpose: there is one simulator, one app and one control port, and two
 * captures in flight would share all three. Parallelism here means more devices, not more requests.
 *
 * `pendingRelaunchMs` carries the cost of getting the app up across to the screen that cost was
 * paid for — the launch at the top of the run belongs to the first screen, and a recovery
 * relaunch belongs to the screen after the crash, not to the crash.
 */
export async function captureSwiftScreens(options: SwiftCaptureOptions): Promise<SwiftCaptureRun> {
  await mkdir(options.outputDir, { recursive: true })
  let pendingRelaunchMs: number | null = await relaunch(options)
  recordRuntimeTiming('app_flow.swift_capture.relaunch.duration', pendingRelaunchMs, {
    reason: 'start'
  })
  const { screens: registered, refusedByParser } = await registryContents(options)

  const available = new Set([...registered, ...Object.keys(refusedByParser)])
  // A caller's list is what the *parse* found; the registry is what the *running build* has. When
  // the build is older than the parse the two differ, and presenting a screen the build never
  // compiled in would report it as a crash — a dead app — when the app is healthy and simply does
  // not have it. Such a screen is left out of the run entirely, with no capture of any kind, which
  // is what lets `runSwiftSweep` report it as the stale build it is (`swift-sweep.ts`).
  const requested = (options.screens ?? [...available].sort()).filter((screen) =>
    available.has(screen)
  )
  const captures: SwiftScreenCapture[] = []
  try {
    await captureEach(requested, captures, options, refusedByParser, pendingRelaunchMs)
  } finally {
    // The run owns the device it was handed, and that holds however the loop ended: an abort or a
    // refused request would otherwise leave a process running that the caller never asked for.
    try {
      await simctl(['terminate', options.deviceId, options.bundleId])
    } catch {
      // Already gone.
    }
  }
  return { captures, refusedByParser }
}

/** The per-screen loop, so `captureSwiftScreens` can own the device's teardown in one place. */
async function captureEach(
  requested: readonly string[],
  captures: SwiftScreenCapture[],
  options: SwiftCaptureOptions,
  refusedByParser: Record<string, string[]>,
  firstRelaunchMs: number | null
): Promise<void> {
  let pendingRelaunchMs = firstRelaunchMs
  for (const [index, screen] of requested.entries()) {
    options.abortSignal?.throwIfAborted()
    const capture = await captureOne(screen, options, refusedByParser, pendingRelaunchMs)
    pendingRelaunchMs = null
    recordRuntimeCount('app_flow.swift_capture.screen', { outcome: capture.outcome })
    captures.push(capture)
    options.onProgress?.(capture, index, requested.length)
    if (capture.outcome === 'crashed' && index < requested.length - 1) {
      // The channel is gone, so every screen after this one would report the same error without
      // ever being presented. One relaunch buys the rest of the run back. Counted because a run
      // that relaunches often is a run whose app is dying often, and that is the number worth
      // having: the per-screen relaunch this loop replaced made it unobservable.
      recordRuntimeCount('app_flow.swift_capture.recovery')
      const recoveryStartedAt = Date.now()
      pendingRelaunchMs = await relaunch(options)
      recordRuntimeTiming(
        'app_flow.swift_capture.relaunch.duration',
        Date.now() - recoveryStartedAt,
        { reason: 'crash' }
      )
    }
  }
}
