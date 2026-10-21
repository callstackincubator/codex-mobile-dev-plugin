/**
 * The manual-recording service — the IPC-facing wrapper around `ManualSession`, built the same way
 * `createAppFlowService` wraps `AppFlowBuilder`: a map keyed by project id, events broadcast to the
 * renderer, and work started without awaiting so the IPC call returns immediately.
 */
import type { ManualRecordingAction, ManualRecordingEvent } from '../../shared/app-flow.ts'
import { bootDevice, closeDevice, type CaptureContext, type CaptureDevice } from '../capture.ts'
import { isMetroReady } from '../../server/app-flow-deps/metro/port.ts'
import { getAppFlowBuilders, getLaunchedApps } from '../index.ts'
import { getProjectId, readAgentDeviceScreens } from '../storage.ts'
import { manualCaptureContext } from './context.ts'
import { runPathToReach } from '../path-run.ts'
import { runtimeReplay } from '../runtime-replay.ts'
import { ManualSession, type PreparedManualDevice } from './session.ts'
import { configureAppFlowHost, type AppFlowHostPorts } from '../host.ts'

const sessions = new Map<string, ManualSession>()

/**
 * Devices this module opened and is keeping warm, keyed by project id.
 *
 * Two kinds of caller park one here, for the same reason. Replay exists to put the app on a screen
 * and leave it there, so it cannot close its own device — `closeDevice` shuts the agent-device
 * session down, and the app under test goes with the runner. A finished recording is the same
 * situation seen from the other end: the user has just saved a path and, far more often than not,
 * the next thing they do is record a path to another screen, and closing the device between the
 * two meant paying a simulator boot and a Metro cold start again for a device that was healthy.
 *
 * So a device is parked rather than closed, reused by whatever starts next on this project, and
 * closed when it goes stale, when its idle window expires, or when a sweep needs the runner.
 */
const warmDevices = new Map<string, { device: CaptureDevice; ctx: CaptureContext; timer: NodeJS.Timeout }>()

/**
 * How long a parked device waits for the next recording before closing itself.
 *
 * It holds a booted simulator, an agent-device session and a Metro process, and nothing else can
 * reap them: the panel can be closed, the project switched, or the user can simply walk away, and
 * none of those reach this module. Ten minutes is long enough to cover "record the next screen"
 * — the case the parking exists for — and short enough that a forgotten session is not still
 * holding the iOS runner an hour later.
 */
const WARM_DEVICE_IDLE_MS = 10 * 60 * 1000

async function closeWarmDevice(projectId: string): Promise<void> {
  const parked = warmDevices.get(projectId)
  if (!parked) return
  warmDevices.delete(projectId)
  clearTimeout(parked.timer)
  await closeDevice(parked.device).catch((error: unknown) => {
    console.error('[app-flow:manual] could not close the parked device:', error)
  })
}

function parkWarmDevice(projectId: string, device: CaptureDevice, ctx: CaptureContext): void {
  const timer = setTimeout(() => {
    console.log('[app-flow:manual] parked device idle — closing it')
    void closeWarmDevice(projectId)
  }, WARM_DEVICE_IDLE_MS)
  // Never hold the process open for a device nobody is waiting on.
  timer.unref?.()
  warmDevices.set(projectId, { device, ctx, timer })
}

/** Whether the dev server a device was opened against is still answering on its port. */
async function metroAlive(device: CaptureDevice): Promise<boolean> {
  if (device.launchProcess && device.launchProcess.exitCode !== null) return false
  return device.metroPort > 0 ? isMetroReady(device.metroPort) : false
}

/**
 * The device the next recording should run on, cheapest first.
 *
 * 1. The app the user launched from the App Flow screen. This is the case the panel's "Record
 *    path" button hits most often — the user has the app up, they can see the screen they want a
 *    path to — and reusing it skips the native build, the boot and Metro entirely. It is owned by
 *    `launchApp`, so it is borrowed and never closed here.
 * 2. A device a previous recording or replay on this project parked, which is what makes the
 *    second "Record path" of a sitting cheap after the first one paid for the boot.
 * 3. Nothing, meaning the session boots its own.
 *
 * Every reuse is probed first. A stale device is strictly worse than a slow one: the app would
 * relaunch against a dev server that is gone and every step of the recording would fail minutes
 * later, where a fresh boot just works.
 */
async function prepareDevice(projectId: string): Promise<PreparedManualDevice | null> {
  const launched = getLaunchedApps().get(projectId)
  if (launched) {
    if (await metroAlive(launched.device)) {
      // Our own parked device is redundant while a launched one is up, and holding both means two
      // simulators and two Metro processes for one project.
      await closeWarmDevice(projectId)
      return { device: launched.device, ctx: launched.ctx, source: 'launched' }
    }
    console.log('[app-flow:manual] the launched app’s dev server is gone — not adopting it')
  }

  const parked = warmDevices.get(projectId)
  if (!parked) return null
  warmDevices.delete(projectId)
  clearTimeout(parked.timer)
  if (!(await metroAlive(parked.device))) {
    console.log('[app-flow:manual] parked device’s dev server is gone — closing it and booting fresh')
    await closeDevice(parked.device).catch(() => undefined)
    return null
  }
  try {
    // Idempotent, and the cheapest proof that the simulator is still there and the agent-device
    // session can be re-established: the same call `bootDevice` makes on a cold start.
    await parked.device.client.devices.boot({
      platform: 'ios',
      target: 'mobile',
      udid: parked.device.deviceId
    })
  } catch (error) {
    console.log(`[app-flow:manual] parked device did not answer (${String(error)}) — booting fresh`)
    await closeDevice(parked.device).catch(() => undefined)
    return null
  }
  return { device: parked.device, ctx: parked.ctx, source: 'warm' }
}

export function createManualRecordingService(host: AppFlowHostPorts): {
  isActive: (projectPath: string) => boolean
  /**
   * Close any device this module is keeping warm for a project.
   *
   * Called before a sweep, a launch or a UI-state pass starts: a parked agent-device session holds
   * the iOS runner lease, and the next thing to want it fails with "iOS runner is already owned by
   * another agent-device daemon". Parking buys a cheaper second recording, never at the price of
   * the surface beside it.
   */
  releaseDevices: (projectPath: string) => Promise<void>
  start: (
    projectPath: string,
    nodeId: string
  ) => Promise<{ ok: true } | { ok: false; error: string }>
  act: (
    projectPath: string,
    action: ManualRecordingAction
  ) => Promise<{ ok: true } | { ok: false; error: string }>
  stop: (projectPath: string) => Promise<{ ok: true } | { ok: false; error: string }>
  cancel: (projectPath: string) => Promise<{ cancelled: boolean }>
  replay: (
    projectPath: string,
    nodeId: string
  ) => Promise<{ ok: true } | { ok: false; error: string }>
  /**
   * The other replay variant — see `runtime-replay.ts`. It lives on this service rather than on one
   * of its own because what a replay actually needs from here is the device ladder: the app the
   * user launched, then a device a previous recording or replay parked, then a boot. Giving runtime
   * replay a second pool would mean two simulators and two Metro processes for one project, which
   * is the thing `prepareDevice` exists to avoid.
   */
  replayRuntime: (
    projectPath: string,
    nodeId: string
  ) => Promise<{ ok: true; detail: string } | { ok: false; error: string }>
} {
  configureAppFlowHost(host)
  return {
    isActive: (projectPath: string) => sessions.has(getProjectId(projectPath)),
    releaseDevices: (projectPath: string) => closeWarmDevice(getProjectId(projectPath)),
    start: async (projectPath: string, nodeId: string) => {
      const projectId = getProjectId(projectPath)
      // A sweep and a manual session would fight over the same simulator and the same `.ad` files.
      if (getAppFlowBuilders().get(projectId)?.isRunning()) {
        return { ok: false, error: 'An App Flow build is already running for this project.' }
      }
      if (sessions.has(projectId)) {
        return { ok: false, error: 'A recording is already in progress for this project.' }
      }

      const prepared = await prepareDevice(projectId)
      const session = new ManualSession(projectPath, projectId, nodeId, {
        prepared,
        /**
         * A device the user launched goes back untouched — `launchApp` owns it, and closing it
         * here would pull the app out from under the panel's Launch state. One this module opened
         * is parked for the next recording unless the session failed, where its state is unknown
         * and closing is the only safe answer.
         */
        release: async (device, ctx, outcome) => {
          if (outcome.source === 'launched') return
          if (outcome.reason === 'failed' || !ctx) {
            await closeDevice(device)
            return
          }
          parkWarmDevice(projectId, device, ctx)
        }
      })
      sessions.set(projectId, session)
      session.on('event', (event: ManualRecordingEvent) => {
        host.emit(event)
        if (event.type === 'complete' || event.type === 'error') sessions.delete(projectId)
      })

      console.log(`[app-flow:manual] start ${nodeId} for ${projectPath} (${projectId})`)
      // Not awaited: booting a simulator and launching the app takes minutes, and the renderer
      // follows along on the event channel.
      void session.start().catch((error: unknown) => {
        console.error('[app-flow:manual] start rejected:', error)
        sessions.delete(projectId)
        void session.failed(error)
      })
      return { ok: true }
    },

    act: async (projectPath: string, action: ManualRecordingAction) => {
      const session = sessions.get(getProjectId(projectPath))
      if (!session) return { ok: false, error: 'No recording in progress for this project.' }
      try {
        await session.act(action)
        return { ok: true }
      } catch (error) {
        // An action that fails is not a failed session — a mistyped field or a stale element should
        // leave the user on the device, able to try again.
        return { ok: false, error: error instanceof Error ? error.message : 'Interaction failed.' }
      }
    },

    stop: async (projectPath: string) => {
      const projectId = getProjectId(projectPath)
      const session = sessions.get(projectId)
      if (!session) return { ok: false, error: 'No recording in progress for this project.' }
      try {
        await session.stop()
        return { ok: true }
      } catch (error) {
        console.error('[app-flow:manual] stop failed:', error)
        await session.failed(error)
        return {
          ok: false,
          error: error instanceof Error ? error.message : 'Could not save the recording.'
        }
      } finally {
        sessions.delete(projectId)
      }
    },

    cancel: async (projectPath: string) => {
      const projectId = getProjectId(projectPath)
      const session = sessions.get(projectId)
      if (!session) return { cancelled: false }
      sessions.delete(projectId)
      await session.cancel().catch((error: unknown) => {
        console.error('[app-flow:manual] cancel failed:', error)
      })
      return { cancelled: true }
    },

    /**
     * Walks a screen's stored `pathToReach` and leaves the app sitting on it.
     *
     * Awaited rather than fired like `start`: there is no panel to follow along on, the renderer
     * just wants to know whether it worked, and the one line of feedback it needs is the error when
     * it did not. The whole call is a couple of minutes on a cold device, which `ipcMain.handle`
     * carries fine.
     */
    replay: async (projectPath: string, nodeId: string) => {
      const projectId = getProjectId(projectPath)
      if (getAppFlowBuilders().get(projectId)?.isRunning()) {
        return { ok: false, error: 'An App Flow build is already running for this project.' }
      }
      if (sessions.has(projectId)) {
        return { ok: false, error: 'A recording is in progress for this project.' }
      }

      const screens = await readAgentDeviceScreens(projectId)
      const entry = Object.values(screens).find((screen) => screen.screenId === nodeId)
      if (!entry?.pathToReach.length) {
        return { ok: false, error: 'This screen has no recorded path to replay yet.' }
      }

      console.log(
        `[app-flow:manual] replay ${nodeId} for ${projectPath} (${projectId})` +
          // Said out loud before the device is booted, because this is the one place that knows
          // which path is about to run and a failure two minutes from now reads very differently
          // depending on the answer. `ModerationInbox`'s stored path was reconstructed from a
          // chrome reveal and was never travelled; `My-Profile`'s was walked. See
          // `AppFlowCapture.pathVerified`.
          (entry.pathVerified === false ? ' — inferred path, never travelled' : '') +
          (entry.pathContentSelectors?.length
            ? ` — matches on rendered content: ${entry.pathContentSelectors.join(', ')}`
            : '')
      )
      // Same ladder as a recording's: the app the user launched, then a device a previous
      // recording parked, then a boot of our own.
      const prepared = await prepareDevice(projectId)
      const ctx = prepared?.ctx ?? (await manualCaptureContext(projectPath, projectId))
      const device = prepared?.device ?? (await bootDevice(ctx))
      // Parked before the walk, not after: if a step throws, the device is still up and still owns
      // a Metro process, and the next start is the only thing that will ever clean it up. A device
      // the user launched is not ours to park — `launchApp` already holds it.
      if (prepared?.source !== 'launched') parkWarmDevice(projectId, device, ctx)
      try {
        await runPathToReach(ctx, device, entry.pathToReach)
        return { ok: true }
      } catch (error) {
        console.error('[app-flow:manual] replay failed:', error)
        return {
          ok: false,
          error: error instanceof Error ? error.message : 'Could not replay this screen.'
        }
      }
    },

    /**
     * Navigates to a screen through the app's own runtime, with no recording involved.
     *
     * Same guards and the same device ladder as `replay` above, for the same reasons — a sweep and
     * this would fight over one simulator, and a recording in progress owns the device outright.
     * Everything past the device is `runtime-replay.ts`; this is the part that has to live beside
     * the pool.
     */
    replayRuntime: async (projectPath: string, nodeId: string) => {
      const projectId = getProjectId(projectPath)
      if (getAppFlowBuilders().get(projectId)?.isRunning()) {
        return { ok: false as const, error: 'An App Flow build is already running for this project.' }
      }
      if (sessions.has(projectId)) {
        return { ok: false as const, error: 'A recording is in progress for this project.' }
      }

      console.log(`[app-flow:runtime-replay] ${nodeId} for ${projectPath} (${projectId})`)
      return await runtimeReplay(projectId, nodeId, {
        prepare: async () => {
          const prepared = await prepareDevice(projectId)
          const ctx = prepared?.ctx ?? (await manualCaptureContext(projectPath, projectId))
          const device = prepared?.device ?? (await bootDevice(ctx))
          // Parked before the dispatch, not after: if it throws, the device is still up and still
          // owns a Metro process, and the next start is the only thing that will ever clean it up.
          // A device the user launched is not ours to park — `launchApp` already holds it.
          if (prepared?.source !== 'launched') parkWarmDevice(projectId, device, ctx)
          return { ctx, device }
        }
      })
    }
  }
}
