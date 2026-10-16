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
  StartAppFlowInput,
  StateCaptureMode
} from '../shared/app-flow.ts'

/**
 * What an absent option means. One table so the service and its test cannot drift apart.
 * `deepLinkJudgeMode` defaults to `on`: skipping the judge changes what a sweep can tell about an
 * open, so an existing run keeps behaving exactly as it did until someone asks for the cheaper one.
 * `stateCaptureMode` defaults to `off`, which is the opposite choice and deliberately so: the
 * state pass is the one phase whose cost a caller is unlikely to have asked for, and auto and
 * thorough used to run it on every hinted route without being asked. See `StateCaptureMode`.
 */
export const APP_FLOW_START_DEFAULTS = {
  mode: 'structure-only',
  explorationMode: 'auto',
  deepLinkJudgeMode: 'on',
  stateCaptureMode: 'off'
} as const satisfies {
  mode: AppFlowBuildMode
  explorationMode: ExplorationMode
  deepLinkJudgeMode: DeepLinkJudgeMode
  stateCaptureMode: StateCaptureMode
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
    deepLinkJudgeMode: input.deepLinkJudgeMode ?? APP_FLOW_START_DEFAULTS.deepLinkJudgeMode,
    stateCaptureMode: input.stateCaptureMode ?? APP_FLOW_START_DEFAULTS.stateCaptureMode
  }
}

/**
 * Whether this start request needs a decision provider to be worth starting at all.
 *
 * A structure-only build never asks a model anything. Neither does Fast, as long as nothing asks
 * it to: its ladder is the render rung alone and it skips the auth-gate classifier, so the only
 * role still reachable is the arrival judge on a node whose runtime evidence came back incomplete
 * — which the orchestrator degrades to an `uncertain` verdict rather than a failed sweep. Auto and
 * thorough are model-driven end to end and a provider is not optional for them.
 *
 * `stateCaptureMode: 'on'` is the one thing that puts a model back into a Fast sweep. The state
 * pass spends a `state-trigger` plan and an arrival judge per hinted route, and neither degrades
 * into anything useful without a provider: an `uncertain` arrival means no base, and a missing
 * plan means no variant, so the whole opt-in phase would silently do nothing. Refusing up front
 * is the honest answer, and it is why this takes the option rather than the mode alone.
 *
 * Here rather than inline at the two call sites (`buildAppFlow`'s throw and the service's start
 * refusal) because those two must agree — a sweep the service accepts and the orchestrator then
 * throws out is a spinner that never resolves — and because this file is the one place in the
 * start path that unit-tests without Electron.
 */
export function requiresDecisionProvider(
  mode: AppFlowBuildMode | undefined,
  explorationMode: ExplorationMode | undefined,
  stateCaptureMode?: StateCaptureMode
): boolean {
  if ((mode ?? APP_FLOW_START_DEFAULTS.mode) !== 'screen-ui-and-structure') return false
  if ((explorationMode ?? APP_FLOW_START_DEFAULTS.explorationMode) !== 'fast') return true
  return (stateCaptureMode ?? APP_FLOW_START_DEFAULTS.stateCaptureMode) === 'on'
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
    deepLinkJudgeMode,
    stateCaptureMode
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
  if (deepLinkJudgeMode !== undefined && deepLinkJudgeMode !== 'on' && deepLinkJudgeMode !== 'off')
    return { ok: false, error: 'Invalid deep-link judge mode.' }
  if (stateCaptureMode !== undefined && stateCaptureMode !== 'on' && stateCaptureMode !== 'off')
    return { ok: false, error: 'Invalid state capture mode.' }
  return {
    ok: true,
    input: {
      projectPath,
      mode,
      screenLimit: screenLimit as number | undefined,
      explorationMode,
      deepLinkJudgeMode,
      stateCaptureMode
    }
  }
}
