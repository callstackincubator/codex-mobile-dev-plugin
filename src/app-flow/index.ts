import type {
  AppFlowProgressEvent,
  AppFlowPromptResolution,
  StartAppFlowInput
} from '../shared/app-flow.ts'
import { parseProject } from './parser.ts'
import { AppFlowBuilder } from './orchestrator.ts'
import { bootDevice, closeDevice, waitForAppReady, type CaptureDevice } from './capture.ts'
import { requiresDecisionProvider, resolveAppFlowStart } from './start-request.ts'
import { clearSavedAppFlow, getProjectId, readAppFlowForRenderer, readManifest } from './storage.ts'
import { configureAppFlowHost, type AppFlowHostPorts } from './host.ts'
import { runExploreUi } from './explore-ui-run.ts'

const builders = new Map<string, AppFlowBuilder>()
/**
 * In-flight explore-UI passes, keyed by project. One per project at a time, and cancellable
 * through the same `cancel` the panel already calls for a sweep.
 */
const exploring = new Map<string, AbortController>()
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
  clear: (projectPath: string) => Promise<{ cleared: true; projectId: string }>
  start: (options: StartAppFlowInput) => Promise<{ ok: true } | { ok: false; error: string }>
  /**
   * `expected: true` marks a refusal that is a normal state of the surface rather than a fault —
   * a second click while the first is still launching, or a project with no routes to open. The
   * host still raises it so the panel shows it, but it is not worth an exception report.
   */
  launchApp: (
    projectPath: string
  ) => Promise<{ ok: true } | { ok: false; error: string; expected?: boolean }>
  isAppLaunched: (projectPath: string) => Promise<boolean>
  /**
   * Open and photograph the UI states of the screen the already-launched app is on. Non-blocking:
   * it resolves as soon as the pass is under way, and reports through the same event stream.
   */
  exploreUi: (
    projectPath: string,
    options?: { limit?: number }
  ) => Promise<{ ok: true } | { ok: false; error: string; expected?: boolean }>
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
    clear: async (projectPath: string) => {
      const projectId = getProjectId(projectPath)
      if (builders.get(projectId)?.isRunning() || exploring.has(projectId) || launching.has(projectId)) {
        throw new Error('Stop the active App Flow operation before clearing its saved data.')
      }
      await clearSavedAppFlow(projectId)
      return { cleared: true, projectId }
    },
    launchApp: async (projectPath: string) => {
      const projectId = getProjectId(projectPath)
      if (builders.get(projectId)?.isRunning()) {
        return { ok: false, error: 'App flow build already in progress.', expected: true }
      }
      if (launching.has(projectId)) {
        return { ok: false, error: 'App is already launching.', expected: true }
      }
      launching.add(projectId)
      try {
        const parsed = await parseProject(projectPath)
        if (!parsed) {
          // No project path in the message: this reaches the panel and, through the tool's error
          // channel, the error reporter. The user already knows which project they picked.
          return {
            ok: false,
            error:
              'No supported Expo Router or React Navigation routes were found in the selected project.',
            expected: true
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
    exploreUi: async (projectPath: string, options?: { limit?: number }) => {
      const projectId = getProjectId(projectPath)
      if (builders.get(projectId)?.isRunning()) {
        return { ok: false, error: 'App flow build already in progress.', expected: true }
      }
      if (exploring.has(projectId)) {
        return { ok: false, error: 'UI explore is already running for this project.', expected: true }
      }
      // The app must already be up: this pass opens states on the screen the user left it on, and
      // relaunching would throw that screen away before anything could be captured.
      const device = launchedApps.get(projectId)
      if (!device) {
        return {
          ok: false,
          error: 'Launch the app from the App Flow screen first, then start UI explore.',
          expected: true
        }
      }
      const parsed = await parseProject(projectPath)
      if (!parsed) {
        return {
          ok: false,
          error:
            'No supported Expo Router or React Navigation routes were found in the selected project.',
          expected: true
        }
      }
      const controller = new AbortController()
      exploring.set(projectId, controller)
      const ctx = {
        projectPath,
        projectId,
        scheme: parsed.scheme,
        appName: parsed.appName,
        bundleId: parsed.bundleId,
        slug: parsed.slug,
        platform: 'ios' as const,
        sessionName: projectId,
        signal: controller.signal
      }
      const emit = (event: {
        type: 'phase' | 'step' | 'error' | 'complete'
        message: string
        completed?: number
        total?: number
      }) => {
        host.emit({ ...event, phase: 'capture', projectId })
      }
      void runExploreUi({
        projectPath,
        projectId,
        ctx,
        device,
        ...(options?.limit === undefined ? {} : { limit: options.limit }),
        signal: controller.signal,
        emit
      })
        .then((result) => {
          emit({
            type: 'complete',
            message: result.cancelled
              ? 'UI explore cancelled.'
              : `Captured ${result.captured} UI state(s)${result.failed ? `, ${result.failed} could not be opened` : ''}.`,
            completed: result.captured
          })
        })
        .catch((error: unknown) => {
          emit({
            type: 'error',
            message: error instanceof Error ? error.message : 'Unknown error'
          })
        })
        .finally(() => {
          exploring.delete(projectId)
        })
      return { ok: true }
    },
    start: async (input) => {
      // Defaults live in `start-request.ts` so they are testable without Electron.
      const {
        projectPath,
        mode,
        screenLimit,
        explorationMode,
        deepLinkJudgeMode,
        captureUiStates
      } = resolveAppFlowStart(input)
      // Same narrowing as `buildAppFlow`'s own check, and for the same reason: Fast asks no model
      // anything it cannot do without (see the throw there), so refusing to start it when the host
      // has no decision provider would be this surface inventing a requirement the sweep no longer
      // has. Every other mode is model-driven end to end and is still refused here, where the user
      // can be told before a simulator boots.
      if (requiresDecisionProvider(mode, explorationMode) && !host.decisions) {
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
          captureUiStates,
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
      const explore = exploring.get(projectId)
      if (explore) {
        explore.abort()
        console.log(`[app-flow] cancel requested for ${projectId} — UI explore aborting`)
        return { cancelled: true }
      }
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
