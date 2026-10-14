/**
 * Validation and defaulting for an App Flow start request.
 *
 * Lives beside the service rather than inline in `ipc.ts` for the same reason
 * `manual/validate.ts` does: the handler needs Electron, but the rules ("which literals are
 * legal, what an absent option means") are the part worth unit-testing, and they are pure.
 * The directory-allowlist check stays in the handler because it needs the workspace store.
 */
import type {
  AppFlowBuildMode,
  DeepLinkJudgeMode,
  ExplorationMode,
  RenderTransportMode,
  StartAppFlowInput
} from '../shared/app-flow.ts'

/**
 * What an absent option means. One table so the service and its test cannot drift apart.
 * `renderTransportMode` defaults to `cli` — the CLI stays the default until the socket transport
 * wins a measured sweep on the same app. `deepLinkJudgeMode` defaults to `on` for the same kind of
 * reason: skipping the judge changes what a sweep can tell about an open, so an existing run must
 * keep behaving exactly as it did until someone asks for the cheaper one.
 */
export const APP_FLOW_START_DEFAULTS = {
  mode: 'structure-only',
  explorationMode: 'auto',
  renderTransportMode: 'cli',
  deepLinkJudgeMode: 'on'
} as const satisfies {
  mode: AppFlowBuildMode
  explorationMode: ExplorationMode
  renderTransportMode: RenderTransportMode
  deepLinkJudgeMode: DeepLinkJudgeMode
}

/** A start request with every defaultable option filled in. */
export type ResolvedAppFlowStart = Omit<Required<StartAppFlowInput>, 'screenLimit'> & {
  screenLimit?: number
}

/** Fills absent options with `APP_FLOW_START_DEFAULTS`. `screenLimit` has no default: absent means no cap. */
export function resolveAppFlowStart(input: StartAppFlowInput): ResolvedAppFlowStart {
  return {
    projectPath: input.projectPath,
    mode: input.mode ?? APP_FLOW_START_DEFAULTS.mode,
    screenLimit: input.screenLimit,
    explorationMode: input.explorationMode ?? APP_FLOW_START_DEFAULTS.explorationMode,
    renderTransportMode: input.renderTransportMode ?? APP_FLOW_START_DEFAULTS.renderTransportMode,
    deepLinkJudgeMode: input.deepLinkJudgeMode ?? APP_FLOW_START_DEFAULTS.deepLinkJudgeMode
  }
}

export type ParsedAppFlowStart =
  { ok: true; input: StartAppFlowInput } | { ok: false; error: string }

/**
 * Narrows the untyped IPC payload. Nothing crossing the process boundary is trusted to be the
 * type the renderer claims, so every field is checked at runtime; a bad literal is rejected rather
 * than silently coerced to the default, so a stale or hand-rolled caller finds out.
 */
export function parseAppFlowStartRequest(raw: unknown): ParsedAppFlowStart {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'Invalid project path.' }
  const {
    projectPath,
    mode,
    screenLimit,
    explorationMode,
    renderTransportMode,
    deepLinkJudgeMode
  } = raw as Record<string, unknown>
  if (typeof projectPath !== 'string' || projectPath.length > 4096)
    return { ok: false, error: 'Invalid project path.' }
  if (mode !== undefined && mode !== 'structure-only' && mode !== 'screen-ui-and-structure')
    return { ok: false, error: 'Invalid App Flow mode.' }
  if (screenLimit !== undefined && (!Number.isInteger(screenLimit) || (screenLimit as number) < 1))
    return { ok: false, error: 'Screen limit must be a positive integer.' }
  if (
    explorationMode !== undefined &&
    explorationMode !== 'auto' &&
    explorationMode !== 'fast' &&
    explorationMode !== 'thorough'
  )
    return { ok: false, error: 'Invalid exploration mode.' }
  if (
    renderTransportMode !== undefined &&
    renderTransportMode !== 'cli' &&
    renderTransportMode !== 'socket'
  )
    return { ok: false, error: 'Invalid render transport mode.' }
  if (deepLinkJudgeMode !== undefined && deepLinkJudgeMode !== 'on' && deepLinkJudgeMode !== 'off')
    return { ok: false, error: 'Invalid deep-link judge mode.' }
  return {
    ok: true,
    input: {
      projectPath,
      mode,
      screenLimit: screenLimit as number | undefined,
      explorationMode,
      renderTransportMode,
      deepLinkJudgeMode
    }
  }
}
