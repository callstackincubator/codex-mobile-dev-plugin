/**
 * The manual-recording service — the IPC-facing wrapper around `ManualSession`, built the same way
 * `createAppFlowService` wraps `AppFlowBuilder`: a map keyed by project id, events broadcast to the
 * renderer, and work started without awaiting so the IPC call returns immediately.
 */
import type { ManualRecordingAction, ManualRecordingEvent } from '../../shared/app-flow.ts'
import { bootDevice, closeDevice, type CaptureDevice } from '../capture.ts'
import { getAppFlowBuilders } from '../index.ts'
import { getProjectId, readAgentDeviceScreens } from '../storage.ts'
import { manualCaptureContext } from './context.ts'
import { runPathToReach } from '../path-run.ts'
import { ManualSession } from './session.ts'
import { configureAppFlowHost, type AppFlowHostPorts } from '../host.ts'

const sessions = new Map<string, ManualSession>()

/**
 * Devices left running by the Replay button, keyed by project id.
 *
 * Replay exists to put the app on a screen and leave it there, so it cannot close its own device —
 * `closeDevice` shuts the agent-device session down, and the app under test goes with the runner.
 * What that leaks is the Metro child process and its log file, which only `closeDevice` reaps, so
 * the device is parked here and closed by whatever starts next on this project. The agent-device
 * session itself needs no such care: `bootDevice` opens with a `sessions.close` that drops any
 * leftover one.
 */
const lingering = new Map<string, CaptureDevice>()

async function closeLingeringDevice(projectId: string): Promise<void> {
  const device = lingering.get(projectId)
  if (!device) return
  lingering.delete(projectId)
  await closeDevice(device).catch((error: unknown) => {
    console.error('[app-flow:manual] could not close the parked replay device:', error)
  })
}

export function createManualRecordingService(host: AppFlowHostPorts): {
  isActive: (projectPath: string) => boolean
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
} {
  configureAppFlowHost(host)
  return {
    isActive: (projectPath: string) => sessions.has(getProjectId(projectPath)),
    start: async (projectPath: string, nodeId: string) => {
      const projectId = getProjectId(projectPath)
      // A sweep and a manual session would fight over the same simulator and the same `.ad` files.
      if (getAppFlowBuilders().get(projectId)?.isRunning()) {
        return { ok: false, error: 'An App Flow build is already running for this project.' }
      }
      if (sessions.has(projectId)) {
        return { ok: false, error: 'A recording is already in progress for this project.' }
      }
      await closeLingeringDevice(projectId)

      const session = new ManualSession(projectPath, projectId, nodeId)
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

      await closeLingeringDevice(projectId)
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
      const ctx = await manualCaptureContext(projectPath, projectId)
      const device = await bootDevice(ctx)
      // Parked before the walk, not after: if a step throws, the device is still up and still owns
      // a Metro process, and the next start is the only thing that will ever clean it up.
      lingering.set(projectId, device)
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
    }
  }
}
