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
import { contentMatchedSelectors } from '../path-minimize.ts'
import { destinationLocator, locatorFor, rectCenter } from './locators.ts'

/** How often the panel's wireframe is refreshed while the user is deciding what to tap. */
const SNAPSHOT_INTERVAL_MS = 2_000

function log(step: string, detail?: string): void {
  console.log(detail ? `[app-flow:manual] ${step} — ${detail}` : `[app-flow:manual] ${step}`)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export class ManualSession extends EventEmitter {
  private readonly projectPath: string
  private readonly projectId: string
  private readonly nodeId: string
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
    nodeId: string
  ) {
    super()
    this.projectPath = projectPath
    this.projectId = projectId
    this.nodeId = nodeId
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

    this.ctx = await manualCaptureContext(this.projectPath, this.projectId)

    // Creates `flows/` and `screens/` if a previous build left them missing, and refreshes the
    // registry's `lastOpenedAt` — the user is working on this project right now.
    await registerProject(this.projectPath)
    this.candidatePath = join(getFlowsDir(this.projectId), `.${node.slug}.manual.candidate.ad`)
    this.publishedPath = join(getFlowsDir(this.projectId), `${node.slug}.ad`)

    this.status('starting', 'Booting simulator')
    this.device = await bootDevice(this.ctx)

    this.status('starting', 'Launching app')
    // Opens with `saveScript`, so the launch itself is the first line of the recording. This is
    // what makes "the app launch is always part of pathToReach" true for both output shapes: the
    // published script replays it, and the literal fallback reproduces it as `agent-device open`.
    await startReplayRecording(this.ctx, this.device, this.candidatePath, this.device.launchUrl)

    this.status('recording')
    await this.tick()
    this.pollTimer = setInterval(() => void this.tick(), SNAPSHOT_INTERVAL_MS)
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
    } finally {
      this.busy = false
    }
    // Refresh immediately rather than waiting out the interval: agent-device `@ref`s expire after
    // any action, and the user is looking at a wireframe of the screen they just left.
    await this.tick()
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
    await this.teardown()
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
          states: [],
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
      replayVerified: outcome.replayVerified,
      replayStates: []
    }
    await writeAgentDeviceScreens(this.projectId, screens)
  }

  async cancel(): Promise<void> {
    if (this.finished) return
    this.finished = true
    this.stopPolling()
    await unlink(this.candidatePath).catch(() => undefined)
    this.status('stopped', 'Recording discarded')
    await this.teardown()
  }

  /**
   * Always runs, on every exit path. A leaked agent-device session keeps the iOS runner lease, and
   * the next sweep fails with "iOS runner is already owned by another agent-device daemon".
   */
  async teardown(): Promise<void> {
    this.stopPolling()
    const device = this.device
    this.device = null
    if (!device) return
    try {
      await closeDevice(device)
    } catch (error) {
      console.error('Failed to close manual recording device:', error)
    }
  }

  private stopPolling(): void {
    if (!this.pollTimer) return
    clearInterval(this.pollTimer)
    this.pollTimer = null
  }

  /** Reported to the renderer so a failed start still tears the device down. */
  async failed(error: unknown): Promise<void> {
    this.finished = true
    this.stopPolling()
    await unlink(this.candidatePath).catch(() => undefined)
    this.emitEvent({
      type: 'error',
      projectId: this.projectId,
      nodeId: this.nodeId,
      message: errorMessage(error)
    })
    await this.teardown()
  }
}
