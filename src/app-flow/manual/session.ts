/**
 * A manual, agent-device-assisted recording session — the third way an App Flow screen can acquire
 * a `pathToReach`, alongside the parser-only mode (which produces none) and the LLM sweep.
 *
 * The user drives their own app through a live wireframe of the device while this module issues
 * every tap as a real agent-device interaction inside an *active recording*. That is the whole
 * trick: the session is opened with `apps.open({ saveScript })`, so the app launch is the first
 * recorded step and each interaction appends itself, and on stop the recording publishes to
 * `<flows>/<slug>.ad` — exactly the path `savedReplayStrategy` probes first. A screen recorded here
 * is therefore replayed ahead of any deep link or exploration by a later sweep, with no change to
 * the sweep or the reach ladder.
 *
 * No model is consulted anywhere in this file.
 */
import { EventEmitter } from 'node:events'
import { rename, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  AppFlowNode,
  AppFlowPressable,
  ManualRecordingAction,
  ManualRecordingEvent,
  ManualRecordingStatus,
  ManualSnapshotNode,
  ManualSnapshotRect
} from '../../shared/app-flow.ts'
import { captureSnapshotFrame } from '../../server/app-flow-deps/profiling/snapshot.ts'
import {
  agentDeviceOpenCommand,
  bootDevice,
  capturePressables,
  captureScreenshot,
  closeDevice,
  endLiveSession,
  pressWithLocator,
  replayPathToReach,
  saveAndReplayRecording,
  startReplayRecording,
  waitForRoute,
  type CaptureContext,
  type CaptureDevice
} from '../capture.ts'
import { serializeLocator } from '../exploration.ts'
import { manualCaptureContext } from './context.ts'
import { defaultScreenInfo, uniqueScreenKey } from '../screen-keys.ts'
import {
  getFlowsDir,
  getScreenshotPath,
  readAgentDeviceScreens,
  readAppFlow,
  registerProject,
  writeAgentDeviceScreens,
  writeAppFlow
} from '../storage.ts'
import { fillCommand, isPortable, pressCommand, pressPointCommand, scrollCommand } from './commands.ts'
import { recordRuntimeCount, recordRuntimeTiming } from '../runtime-telemetry.ts'
import { contentMatchedSelectors } from '../path-minimize.ts'
import { destinationLocator, locatorFor, rectCenter } from './locators.ts'

/**
 * How long the wireframe rests between refreshes while the user is deciding what to tap.
 *
 * Measured from the *end* of one snapshot to the start of the next, not on a fixed interval. A
 * read of the accessibility tree is itself most of a second on a dense screen, and a fixed 1s
 * interval would fire the next tick while the previous one still held the agent-device session:
 * every one of those is dropped by the `busy` guard, so the panel would refresh no faster while
 * the user's next tap waited behind an in-flight read (`waitForIdle`). Resting a second between
 * reads keeps the wireframe about as fresh as the device can report it and still leaves a window
 * for the tap, which is the interaction that actually matters.
 */
const SNAPSHOT_REST_MS = 1_000

function log(step: string, detail?: string): void {
  console.log(detail ? `[app-flow:manual] ${step} — ${detail}` : `[app-flow:manual] ${step}`)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Where the device a session runs on came from, which is also who owns it afterwards.
 *
 * `launched` is the app the user started from the App Flow screen — the sweep already adopts it
 * (`AppFlowBuilder.start`'s `launchedDevice`), and the recorder now does too, so pressing "Record
 * path" on a running app costs a relaunch rather than a build, a boot and a Metro cold start.
 * `warm` is a device a previous recording on this project left parked. `booted` is this session's
 * own, and the only one `closeDevice` may ever be called on by default.
 */
export type ManualDeviceSource = 'launched' | 'warm' | 'booted'

/** A device acquired before the session was constructed, with the context it was opened under. */
export interface PreparedManualDevice {
  device: CaptureDevice
  ctx: CaptureContext
  source: Exclude<ManualDeviceSource, 'booted'>
}

/**
 * What a finished session does with its device instead of always closing it.
 *
 * `done` is a stop or a discard — the device is healthy and worth keeping for the next recording.
 * `failed` is a session that threw, where the device's state is unknown and closing is the only
 * safe answer.
 */
export type ReleaseManualDevice = (
  device: CaptureDevice,
  ctx: CaptureContext | null,
  outcome: { source: ManualDeviceSource; reason: 'done' | 'failed' }
) => Promise<void>

export class ManualSession extends EventEmitter {
  private readonly projectPath: string
  private readonly projectId: string
  private readonly nodeId: string
  private readonly prepared: PreparedManualDevice | null
  private readonly release: ReleaseManualDevice
  private deviceSource: ManualDeviceSource = 'booted'
  private device: CaptureDevice | null = null
  private ctx: CaptureContext | null = null
  private node: AppFlowNode | null = null
  private candidatePath = ''
  private publishedPath = ''
  /** The literal `agent-device …` lines, in order, used when the recording cannot be published. */
  private readonly literalCommands: string[] = []
  private latestSnapshot: ManualSnapshotNode[] = []
  private revision = 0
  private pollTimer: NodeJS.Timeout | null = null
  /**
   * Serializes the poll against user actions. A snapshot taken while a press is mid-flight reports
   * a half-transitioned screen, and two overlapping snapshots race the same agent-device session.
   */
  private busy = false
  private finished = false

  constructor(
    projectPath: string,
    projectId: string,
    nodeId: string,
    options: { prepared?: PreparedManualDevice | null; release?: ReleaseManualDevice } = {}
  ) {
    super()
    this.projectPath = projectPath
    this.projectId = projectId
    this.nodeId = nodeId
    this.prepared = options.prepared ?? null
    this.release = options.release ?? ((device) => closeDevice(device))
  }

  /** Which device this session is running on — read by the service for its own bookkeeping. */
  get source(): ManualDeviceSource {
    return this.deviceSource
  }

  private emitEvent(event: ManualRecordingEvent): void {
    try {
      this.emit('event', event)
    } catch (error) {
      console.error('Manual recording event listener error:', error)
    }
  }

  private status(status: ManualRecordingStatus, message?: string): void {
    this.emitEvent({
      type: 'status',
      projectId: this.projectId,
      nodeId: this.nodeId,
      status,
      ...(message ? { message } : {})
    })
  }

  async start(): Promise<void> {
    this.status('starting', 'Resolving screen')
    const result = await readAppFlow(this.projectId)
    const node = result?.nodes.find((candidate) => candidate.id === this.nodeId) ?? null
    if (!node) throw new Error('Screen is not in this project’s app flow. Generate the flow first.')
    if (node.origin === 'chrome') {
      throw new Error('A navigator surface is not a screen — there is nothing to record a path to.')
    }
    this.node = node

    const startedAt = Date.now()
    this.ctx = this.prepared?.ctx ?? (await manualCaptureContext(this.projectPath, this.projectId))

    // Creates `flows/` and `screens/` if a previous build left them missing, and refreshes the
    // registry's `lastOpenedAt` — the user is working on this project right now.
    await registerProject(this.projectPath)
    this.candidatePath = join(getFlowsDir(this.projectId), `.${node.slug}.manual.candidate.ad`)
    this.publishedPath = join(getFlowsDir(this.projectId), `${node.slug}.ad`)

    if (this.prepared) {
      // The expensive half of a start — the native build, the simulator boot and Metro's cold
      // start — has already been paid for by whoever opened this device. Skipping it is the whole
      // point of handing one in; the relaunch below is still taken, because the recorded script's
      // first line has to be `open --relaunch` for it to replay from any state.
      this.deviceSource = this.prepared.source
      this.device = this.prepared.device
      log('start', `reusing the ${this.prepared.source} device — no build, boot or Metro start`)
      this.status(
        'starting',
        this.prepared.source === 'launched' ? 'Reusing the app you launched' : 'Reusing the running app'
      )
    } else {
      this.deviceSource = 'booted'
      this.status('starting', 'Booting simulator')
      this.device = await bootDevice(this.ctx)
    }
    // Discard can land here: a cold start is a native build, a simulator boot and a Metro cold
    // start — minutes during which the panel's × is live, and `cancel` ran while `this.device`
    // was still null, so its `teardown` found nothing to release. Without this check the device
    // that finished booting afterwards belonged to nobody: the session was already out of
    // `sessions`, so `isActive` was false, and nothing was in `warmDevices`, so `releaseDevices`
    // closed nothing — while the agent-device session kept the iOS runner lease and the next
    // sweep failed with "iOS runner ... is already owned by another agent-device daemon".
    if (await this.abandonIfFinished()) return

    this.status('starting', 'Launching app')
    // Opens with `saveScript`, so the launch itself is the first line of the recording. This is
    // what makes "the app launch is always part of pathToReach" true for both output shapes: the
    // published script replays it, and the literal fallback reproduces it as `agent-device open`.
    await startReplayRecording(this.ctx, this.device, this.candidatePath, this.device.launchUrl)
    // The same check again, because the launch and the `--saveScript` arming are their own wait:
    // a transaction left armed on a handed-on device suppresses every later `goHome` and makes
    // agent-device refuse to arm the next recording over it. `abandonIfFinished` ends it.
    if (await this.abandonIfFinished()) return

    this.status('recording')
    // One measurement per started recording, with the device's provenance as a closed-set
    // attribute: this is the series that says whether reuse is actually happening and what it
    // saves. No screen, node, route or device identity rides on it.
    recordRuntimeTiming('app_flow.manual.start', Date.now() - startedAt, {
      device: this.deviceSource
    })
    await this.tick()
    this.schedulePoll()
  }

  /**
   * Releases a device `start` acquired after the session was already discarded, and says whether
   * it did.
   *
   * `cancel` and `failed` can both run while `start` is still booting, and `teardown` is a no-op
   * when `this.device` is null — which it is for the whole expensive half of a start. So the
   * checkpoints in `start` call this after every step that can leave something behind, and it
   * performs the half of the discard that was skipped: end the live `--saveScript` transaction,
   * drop the candidate script, hand the device to the service's `release`.
   *
   * It releases through the same `teardown('done')` an ordinary discard uses, so a device booted
   * for a recording nobody wants is parked for the next session rather than thrown away — the
   * boot has been paid for either way, and `releaseDevices` closes it before any sweep.
   */
  private async abandonIfFinished(): Promise<boolean> {
    if (!this.finished) return false
    log('start', 'discarded while starting — releasing the device it had already acquired')
    if (this.device) await endLiveSession(this.device).catch(() => undefined)
    await unlink(this.candidatePath).catch(() => undefined)
    await this.teardown('done')
    return true
  }

  /**
   * Waits out an in-flight snapshot poll before taking the session.
   *
   * Bounded rather than an open loop: a snapshot has its own 15s timeout, so anything past that is
   * a wedged call, and the user's tap is worth more than the stale tick blocking it.
   */
  private async waitForIdle(timeoutMs = 20_000): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (this.busy && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  }

  /** One wireframe refresh. Silently skipped while another device call holds the session. */
  private async tick(): Promise<void> {
    if (this.busy || this.finished || !this.device || !this.ctx) return
    this.busy = true
    try {
      const frame = await captureSnapshotFrame(this.device, {
        platform: this.ctx.platform,
        timeoutMs: 15_000
      })
      this.latestSnapshot = frame.nodes as ManualSnapshotNode[]
      this.revision += 1
      this.emitEvent({
        type: 'snapshot',
        projectId: this.projectId,
        nodeId: this.nodeId,
        revision: this.revision,
        nodes: this.latestSnapshot,
        bounds: frame.bounds as ManualSnapshotRect
      })
    } catch (error) {
      // A dropped poll is not a failed session: the next tick two seconds later usually succeeds,
      // and tearing the recording down over one busy runner would throw away the user's walk.
      log('snapshot tick failed', errorMessage(error))
    } finally {
      this.busy = false
    }
  }

  async act(action: ManualRecordingAction): Promise<void> {
    if (this.finished) throw new Error('This recording has already finished.')
    const device = this.device
    const ctx = this.ctx
    if (!device || !ctx) throw new Error('Recording is still starting up.')
    await this.waitForIdle()

    this.busy = true
    this.status('acting')
    const startedAt = Date.now()
    try {
      const step = await this.perform(ctx, device, action)
      this.literalCommands.push(step.command)
      this.emitEvent({
        type: 'step',
        projectId: this.projectId,
        nodeId: this.nodeId,
        command: step.command,
        portable: step.portable
      })
      await waitForRoute()
      this.status('recording')
      recordRuntimeTiming('app_flow.manual.act', Date.now() - startedAt, {
        action: action.type,
        outcome: 'ok'
      })
    } catch (error) {
      // A failed interaction is not a failed session, and the panel must say so: without this the
      // status stayed on `acting` forever and the header read "Sending the command…" over a
      // session that had already given up, with no way to tell it apart from a slow tap. The
      // session is still live and the user can try another element — which is exactly what
      // `recording` means.
      recordRuntimeTiming('app_flow.manual.act', Date.now() - startedAt, {
        action: action.type,
        outcome: 'failed'
      })
      this.status('recording')
      throw error
    } finally {
      this.busy = false
      // Both outcomes, and in a `finally` rather than after the try: a failed interaction rethrows
      // from the catch above, and re-arming the poll anywhere the throw can skip would freeze the
      // wireframe for the rest of the session — the self-rescheduling poll has no standing
      // interval to fall back on. A failed tap can still have moved the app, so the refresh is
      // worth taking on that path too.
      //
      // Refreshing now rather than waiting out the rest: agent-device `@ref`s expire after any
      // action, and the user is looking at a wireframe of the screen they just left. The poll's
      // rest restarts from here, so the queued tick cannot land on top of this one.
      await this.tick()
      this.schedulePoll()
    }
  }

  private async perform(
    ctx: CaptureContext,
    device: CaptureDevice,
    action: ManualRecordingAction
  ): Promise<{ command: string; portable: boolean }> {
    if (action.type === 'scroll') {
      await device.client.interactions.scroll({
        platform: ctx.platform,
        direction: action.direction
      })
      return { command: scrollCommand(action.direction), portable: true }
    }

    const locator = locatorFor(action.target)
    if (!locator) {
      const rect = action.target.rect
      if (!rect) throw new Error('That element has neither a selector nor a position to press.')
      const point = rectCenter(rect)
      if (action.type === 'fill') {
        throw new Error('That field has no id or label to type into reliably.')
      }
      await device.client.interactions.press({
        platform: ctx.platform,
        x: point.x,
        y: point.y,
        settle: true,
        timeoutMs: 10_000
      })
      // Coordinates are recorded faithfully but do not survive a layout or device-size change, so
      // the panel marks this step as the weak one it is.
      return { command: pressPointCommand(point.x, point.y), portable: false }
    }

    const selector = serializeLocator(locator)
    if (action.type === 'fill') {
      await device.client.interactions.fill({
        platform: ctx.platform,
        selector,
        text: action.value,
        settle: true,
        timeoutMs: 10_000
      })
      return {
        command: fillCommand(selector, action.value),
        portable: isPortable(locator)
      }
    }

    await pressWithLocator(ctx, device, locator)
    return { command: pressCommand(selector), portable: isPortable(locator) }
  }

  /**
   * Ends the walk and writes the artifacts.
   *
   * Tries hardest first: wait on a durable landmark, publish the recording, verify it by replaying
   * it, and hand back a `pathToReach` that is one `agent-device replay`. Everything that can go
   * wrong there falls back to the literal command list rather than failing the session — the user
   * has already done the work, and a weaker path is worth far more than none.
   */
  async stop(): Promise<void> {
    if (this.finished) return
    const device = this.device
    const ctx = this.ctx
    const node = this.node
    if (!device || !ctx || !node) throw new Error('Recording is still starting up.')
    await this.waitForIdle()
    this.finished = true
    this.stopPolling()
    this.status('saving')

    // The screen's own artifacts come first, while the app is still standing on the screen the user
    // walked it to. Everything below relaunches: `saveAndReplayRecording` closes the session and
    // re-runs the whole script to prove it replays, so by the time it returns the app has been
    // through a cold launch and whatever the verification left on screen is what a screenshot would
    // catch. Both calls are observation-only, which agent-device excludes from the recording by
    // default, so taking them inside the still-open session does not add a step to the script.
    const pressables = await this.collectPressables(ctx, device)
    const screenshot = await this.collectScreenshot(ctx, device, node)

    let pathToReach: string[] = []
    let replayScript: string | null = null
    let replayVerified = false
    let fallbackReason: string | undefined

    const destination = destinationLocator(this.latestSnapshot)
    if (!destination) {
      fallbackReason =
        'This screen has no element with an id or accessibility label, so agent-device cannot guard a saved recording here.'
    } else {
      try {
        await saveAndReplayRecording(ctx, device, this.candidatePath, serializeLocator(destination))
        await rename(this.candidatePath, this.publishedPath)
        replayScript = this.publishedPath
        replayVerified = true
        pathToReach = replayPathToReach(device, this.publishedPath)
      } catch (error) {
        fallbackReason = `The recording could not be published or verified: ${errorMessage(error)}`
        await unlink(this.candidatePath).catch(() => undefined)
      }
    }

    if (!replayVerified) {
      await unlink(this.candidatePath).catch(() => undefined)
      pathToReach = [
        ...device.setupCommands,
        // `device.launchTarget` verbatim, exactly as `resolveDeepLink` passes it — the launch
        // target is already the resolved bundle id by the time `bootDevice` returns.
        agentDeviceOpenCommand(device.launchTarget, device.launchUrl ?? null),
        ...this.literalCommands
      ]
    }

    await this.persist(node, { pathToReach, replayScript, replayVerified, pressables, screenshot })

    this.emitEvent({
      type: 'complete',
      projectId: this.projectId,
      nodeId: this.nodeId,
      pathToReach,
      replayVerified,
      ...(fallbackReason ? { fallbackReason } : {})
    })
    recordRuntimeCount('app_flow.manual.stop', {
      outcome: replayVerified ? 'verified' : 'fallback',
      device: this.deviceSource
    })
    await this.teardown('done')
  }

  private async collectPressables(
    ctx: CaptureContext,
    device: CaptureDevice
  ): Promise<AppFlowPressable[]> {
    try {
      return await capturePressables(ctx, device)
    } catch (error) {
      log('pressables failed', errorMessage(error))
      return []
    }
  }

  private async collectScreenshot(
    ctx: CaptureContext,
    device: CaptureDevice,
    node: AppFlowNode
  ): Promise<string | null> {
    const path = getScreenshotPath(this.projectId, node.slug)
    try {
      await captureScreenshot(ctx, device, path)
      return join('screens', `${node.slug}.png`)
    } catch (error) {
      log('screenshot failed', errorMessage(error))
      return null
    }
  }

  /**
   * Merges this one screen into both documents. Never rewrites either wholesale: every other
   * screen's entry and every other node's capture is read back and preserved, because a manual
   * recording is a single-screen edit to files a whole sweep also owns.
   */
  private async persist(
    node: AppFlowNode,
    outcome: {
      pathToReach: string[]
      replayScript: string | null
      replayVerified: boolean
      pressables: AppFlowPressable[]
      screenshot: string | null
    }
  ): Promise<void> {
    // Named here, once, for both documents. A manual path is the one kind nobody should be
    // surprised by — the user watched every step go in — but it can still lean on a rendered
    // string (a list, a post, a person's name), and a consumer deciding whether to re-record is
    // entitled to know that before a replay on another account fails.
    const contentSelectors = contentMatchedSelectors(outcome.pathToReach)
    const result = await readAppFlow(this.projectId)
    if (result) {
      const target = result.nodes.find((candidate) => candidate.id === node.id)
      if (target) {
        target.capture = {
          status: 'ok',
          needsNavigation: false,
          note: 'Recorded manually',
          screenshot: outcome.screenshot,
          pressables: outcome.pressables,
          captureMethod: 'manual',
          replayScript: outcome.replayScript,
          replayVerified: outcome.replayVerified,
          // True on both branches above, and the one case where it is *more* than `replayVerified`
          // claims: a recording that could not be published still produced a literal command list
          // of steps the user themselves performed on the device. `pathVerified` asks whether
          // anything travelled this path, not whether a script round-tripped, so the fallback
          // qualifies exactly as the published script does — and either way this is nothing like
          // the chrome-inferred guess the flag exists to mark (`AppFlowCapture.pathVerified`).
          pathVerified: outcome.pathToReach.length > 0,
          ...(contentSelectors.length ? { pathContentSelectors: contentSelectors } : {}),
          // Always true in practice — a manual recording's path opens with the app launch — but
          // written from the path itself rather than asserted, so the node and the screens entry
          // below cannot disagree about whether there is something to replay.
          replayable: outcome.pathToReach.length > 0,
          ...(result.manifest.structureRevision
            ? { structureRevision: result.manifest.structureRevision }
            : {})
        }
      }
      await writeAppFlow(this.projectId, result)
    }

    const screens = await readAgentDeviceScreens(this.projectId)
    const existingKey = Object.keys(screens).find((key) => screens[key].screenId === node.id)
    const used = new Set(Object.keys(screens).filter((key) => key !== existingKey))
    const key = existingKey ?? uniqueScreenKey(node.title || node.id, used)
    screens[key] = {
      key,
      screenId: node.id,
      info: screens[existingKey ?? '']?.info ?? defaultScreenInfo(node),
      pressables: outcome.pressables,
      pathToReach: outcome.pathToReach,
      pathVerified: outcome.pathToReach.length > 0,
      ...(contentSelectors.length ? { pathContentSelectors: contentSelectors } : {}),
      replayScript: outcome.replayScript,
      replayVerified: outcome.replayVerified
    }
    await writeAgentDeviceScreens(this.projectId, screens)
  }

  async cancel(): Promise<void> {
    if (this.finished) return
    // Waited out for the same reason `stop` waits: everything below releases the device, and since
    // a discarded recording now hands that device to the next session rather than closing it, a
    // snapshot still in flight would have its session closed underneath it and its read would land
    // on whatever opens next. `finished` is set after the wait so the in-flight tick's own
    // rescheduling is what `stopPolling` below cancels.
    await this.waitForIdle()
    this.finished = true
    this.stopPolling()
    // Ends the `--saveScript` transaction this session armed and clears the marker with it. It
    // used to be enough to let `closeDevice` take the whole session down, but a discarded
    // recording now hands its device on to the next one: a live transaction left armed on it
    // would suppress every later `goHome`, and agent-device would refuse to arm the next
    // recording over it. See `endLiveSession` and `armed-recording.ts`.
    if (this.device) await endLiveSession(this.device)
    await unlink(this.candidatePath).catch(() => undefined)
    this.status('stopped', 'Recording discarded')
    await this.teardown('done')
  }

  /**
   * Always runs, on every exit path. A leaked agent-device session keeps the iOS runner lease, and
   * the next sweep fails with "iOS runner is already owned by another agent-device daemon".
   *
   * What "release" means is the service's call, not this class's: a device the user launched is
   * handed back untouched, this session's own is parked for the next recording to reuse, and a
   * failed session's is closed. The default — used by tests and any caller that hands in nothing —
   * is still `closeDevice`, so nothing leaks by omission.
   */
  async teardown(reason: 'done' | 'failed' = 'done'): Promise<void> {
    this.stopPolling()
    const device = this.device
    const ctx = this.ctx
    this.device = null
    if (!device) return
    try {
      await this.release(device, ctx, { source: this.deviceSource, reason })
    } catch (error) {
      console.error('Failed to release manual recording device:', error)
    }
  }

  /** Queues the next wireframe refresh, a rest after whatever the last one cost. */
  private schedulePoll(): void {
    if (this.finished) return
    this.stopPolling()
    this.pollTimer = setTimeout(() => {
      void this.tick().finally(() => this.schedulePoll())
    }, SNAPSHOT_REST_MS)
  }

  private stopPolling(): void {
    if (!this.pollTimer) return
    clearTimeout(this.pollTimer)
    this.pollTimer = null
  }

  /** Reported to the renderer so a failed start still tears the device down. */
  async failed(error: unknown): Promise<void> {
    this.finished = true
    this.stopPolling()
    // Same reason as `cancel`'s, and it matters even here: a failed session on a device the user
    // launched releases that device back untouched rather than closing it.
    if (this.device) await endLiveSession(this.device).catch(() => undefined)
    await unlink(this.candidatePath).catch(() => undefined)
    this.emitEvent({
      type: 'error',
      projectId: this.projectId,
      nodeId: this.nodeId,
      message: errorMessage(error)
    })
    await this.teardown('failed')
  }
}
