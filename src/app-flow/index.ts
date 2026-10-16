import type {
  AppFlowProgressEvent,
  AppFlowPromptResolution,
  StartAppFlowInput
} from '../shared/app-flow.ts'
import { parseProject } from './parser.ts'
import { AppFlowBuilder } from './orchestrator.ts'
import { bootDevice, closeDevice, waitForAppReady, type CaptureDevice } from './capture.ts'
import { requiresDecisionProvider, resolveAppFlowStart } from './start-request.ts'
import { getProjectId, readAppFlowForRenderer, readManifest } from './storage.ts'
import { configureAppFlowHost, type AppFlowHostPorts } from './host.ts'

const builders = new Map<string, AppFlowBuilder>()
/** Apps the user launched from the App Flow screen, kept running for a later sweep to adopt. */
const launchedApps = new Map<string, CaptureDevice>()
const launching = new Set<string>()

export function getAppFlowBuilders(): Map<string, AppFlowBuilder> {
  return builders
}

export function createAppFlowService(host: AppFlowHostPorts): {
  getStatus: (
    projectPath: string
  ) => Promise<{ exists: boolean; projectId: string; manifest?: unknown; error?: string }>
  getResult: (projectPath: string) => Promise<unknown | null>
  start: (options: StartAppFlowInput) => Promise<{ ok: true } | { ok: false; error: string }>
  launchApp: (projectPath: string) => Promise<{ ok: true } | { ok: false; error: string }>
  isAppLaunched: (projectPath: string) => Promise<boolean>
  pause: (projectPath: string) => Promise<{ paused: boolean }>
  cancel: (projectPath: string) => Promise<{ cancelled: boolean }>
  resolvePrompt: (
    projectPath: string,
    resolution: AppFlowPromptResolution,
    promptId?: string
  ) => Promise<{ resolved: boolean }>
} {
  configureAppFlowHost(host)
  return {
    getStatus: async (projectPath: string) => {
      const projectId = getProjectId(projectPath)
      const manifest = await readManifest(projectId)
      return { exists: manifest !== null, projectId, manifest: manifest ?? undefined }
    },
    getResult: async (projectPath: string) => {
      const projectId = getProjectId(projectPath)
      return readAppFlowForRenderer(projectId)
    },
    launchApp: async (projectPath: string) => {
      const projectId = getProjectId(projectPath)
      if (builders.get(projectId)?.isRunning()) {
        return { ok: false, error: 'App flow build already in progress.' }
      }
      if (launching.has(projectId)) return { ok: false, error: 'App is already launching.' }
      launching.add(projectId)
      try {
        const parsed = await parseProject(projectPath)
        if (!parsed) {
          return {
            ok: false,
            error: `No supported Expo Router or React Navigation routes found in ${projectPath}.`
          }
        }
        const previous = launchedApps.get(projectId)
        if (previous) {
          launchedApps.delete(projectId)
          await closeDevice(previous)
        }
        const ctx = {
          projectPath,
          projectId,
          scheme: parsed.scheme,
          appName: parsed.appName,
          bundleId: parsed.bundleId,
          slug: parsed.slug,
          platform: 'ios' as const,
          sessionName: projectId
        }
        const device = await bootDevice(ctx)
        try {
          await waitForAppReady(ctx, device)
        } catch (error) {
          await closeDevice(device)
          throw error
        }
        launchedApps.set(projectId, device)
        return { ok: true }
      } catch (error) {
        console.error('[app-flow] launch failed:', error)
        return { ok: false, error: error instanceof Error ? error.message : 'Unknown error' }
      } finally {
        launching.delete(projectId)
      }
    },
    isAppLaunched: async (projectPath: string) => launchedApps.has(getProjectId(projectPath)),
    start: async (input) => {
      // Defaults live in `start-request.ts` so they are testable without Electron.
      const {
        projectPath,
        mode,
        screenLimit,
        explorationMode,
        deepLinkJudgeMode,
        stateCaptureMode
      } = resolveAppFlowStart(input)
      // Same narrowing as `buildAppFlow`'s own check, and for the same reason: Fast asks no model
      // anything it cannot do without (see the throw there), so refusing to start it when the host
      // has no decision provider would be this surface inventing a requirement the sweep no longer
      // has. Every other mode is model-driven end to end and is still refused here, where the user
      // can be told before a simulator boots. `stateCaptureMode` is part of the question because
      // opting a Fast sweep into the state pass opts it back into model calls.
      if (requiresDecisionProvider(mode, explorationMode, stateCaptureMode) && !host.decisions) {
        return { ok: false, error: 'App Flow decision provider is not available.' }
      }

      const projectId = getProjectId(projectPath)
      let builder = builders.get(projectId)
      if (builder?.isRunning()) {
        return { ok: false, error: 'App flow build already in progress.' }
      }

      if (launching.has(projectId)) return { ok: false, error: 'App is still launching.' }
      const launchedDevice = launchedApps.get(projectId)

      builder = new AppFlowBuilder()
      builders.set(projectId, builder)

      builder.on('event', (event: AppFlowProgressEvent) => {
        host.emit(event)
      })

      builder.on('done', () => {
        console.log(`[app-flow] build done (${projectId})`)
        builders.delete(projectId)
      })

      builder.on('error', (result: { error: string }) => {
        console.error(`[app-flow] build error (${projectId}): ${result.error}`)
        // buildAppFlow already emits an `error` event for every failure it handles, but this is
        // the last line of defence: the renderer must never be left spinning on a dead build.
        host.emit({
          type: 'error',
          phase: 'render',
          message: result.error,
          projectId
        })
        builders.delete(projectId)
      })

      console.log(`[app-flow] start requested for ${projectPath} (${projectId})`)
      // Run without awaiting so the IPC call returns immediately.
      void builder
        .start({
          projectPath,
          mode,
          decisionProvider: host.decisions,
          screenLimit,
          explorationMode,
          deepLinkJudgeMode,
          stateCaptureMode,
          launchedDevice
        })
        .catch((error: unknown) => {
          console.error('[app-flow] builder.start rejected:', error)
          builders.delete(projectId)
          host.emit({
            type: 'error',
            phase: 'render',
            message: error instanceof Error ? error.message : 'Unknown error',
            projectId
          })
        })
      return { ok: true }
    },
    resolvePrompt: async (
      projectPath: string,
      resolution: AppFlowPromptResolution,
      promptId?: string
    ) => {
      const projectId = getProjectId(projectPath)
      const builder = builders.get(projectId)
      const resolved = builder?.resolvePrompt(resolution, promptId) ?? false
      console.log(
        `[app-flow] prompt resolution "${resolution}" for ${projectId} — ${resolved ? 'delivered' : 'nothing waiting'}`
      )
      return { resolved }
    },
    pause: async (projectPath: string) => {
      const projectId = getProjectId(projectPath)
      const builder = builders.get(projectId)
      console.log(
        `[app-flow] pause requested for ${projectId} — ${builder ? 'builder found' : 'no running builder'}`
      )
      if (!builder) return { paused: false }
      builder.pause()
      return { paused: true }
    },
    cancel: async (projectPath: string) => {
      const projectId = getProjectId(projectPath)
      const builder = builders.get(projectId)
      console.log(
        `[app-flow] cancel requested for ${projectId} — ${builder ? 'builder found' : 'no running builder'}`
      )
      if (!builder) return { cancelled: false }
      builder.cancel()
      return { cancelled: true }
    }
  }
}
