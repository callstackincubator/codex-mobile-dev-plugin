/**
 * Validation and defaulting for an App Flow start request. Pure, so the rules are unit-testable;
 * the directory-allowlist check stays in the handler because it needs the workspace store.
 */
import type {
  AppFlowBuildMode,
  DeepLinkJudgeMode,
  ExplorationMode,
  StartAppFlowInput
} from '../shared/app-flow.ts'

/**
 * What an absent option means. One table so the service and its test cannot drift apart.
 * `explorationMode` defaults to `fast`, matching the App Flow panel's own default: an unstated
 * mode gets the deterministic runtime ladder and no decision loop, so a caller that never asked
 * for a model is not handed one.
 * `deepLinkJudgeMode` defaults to `on`: skipping the judge changes what a sweep can tell about an
 * open, so an existing run keeps behaving exactly as it did until someone asks for the cheaper one.
 * `captureUiStates` defaults to off for the same reason: it adds device work to every screen.
 * `judgeUnclearScreens` defaults to off because it is what makes a Fast sweep need the decision
 * loop at all: defaulting it on would quietly hand every Fast run back the chat round trip the
 * mode exists to avoid.
 */
export const APP_FLOW_START_DEFAULTS = {
  mode: 'structure-only',
  explorationMode: 'fast',
  deepLinkJudgeMode: 'on',
  captureUiStates: false,
  judgeUnclearScreens: false
} as const satisfies {
  mode: AppFlowBuildMode
  explorationMode: ExplorationMode
  deepLinkJudgeMode: DeepLinkJudgeMode
  captureUiStates: boolean
  judgeUnclearScreens: boolean
}

/**
 * Converts the UI/API sentinel for "all screens" to the engine's existing uncapped value.
 *
 * Keep this at the start boundary rather than teaching every consumer that both `0` and
 * `undefined` mean the same thing. Lower-level entry points call it defensively as well, because
 * `buildAppFlow` and `ExplorationControl` are also used directly by tests and integrations.
 */
export function normalizeAppFlowScreenLimit(screenLimit: number | undefined): number | undefined {
  return screenLimit === 0 ? undefined : screenLimit
}

/** A start request with every defaultable option filled in. */
export type ResolvedAppFlowStart = Omit<Required<StartAppFlowInput>, 'screenLimit'> & {
  screenLimit?: number
}

/**
 * Fills absent options with `APP_FLOW_START_DEFAULTS`. An absent or zero `screenLimit` means no
 * cap; the resolved engine contract represents both as `undefined`.
 */
export function resolveAppFlowStart(input: StartAppFlowInput): ResolvedAppFlowStart {
  return {
    projectPath: input.projectPath,
    mode: input.mode ?? APP_FLOW_START_DEFAULTS.mode,
    screenLimit: normalizeAppFlowScreenLimit(input.screenLimit),
    explorationMode: input.explorationMode ?? APP_FLOW_START_DEFAULTS.explorationMode,
    deepLinkJudgeMode: input.deepLinkJudgeMode ?? APP_FLOW_START_DEFAULTS.deepLinkJudgeMode,
    captureUiStates: input.captureUiStates ?? APP_FLOW_START_DEFAULTS.captureUiStates,
    judgeUnclearScreens: input.judgeUnclearScreens ?? APP_FLOW_START_DEFAULTS.judgeUnclearScreens
  }
}

/**
 * Whether this start request needs a decision provider to be worth starting at all.
 *
 * A structure-only build never asks a model anything. Neither does Fast, as long as nothing asks
 * it to: its ladder is the render rung alone and it skips the auth-gate classifier, so the only
 * role still reachable is the arrival judge on a node whose runtime evidence came back incomplete
 * — which the orchestrator degrades to an `uncertain` verdict rather than a failed sweep. Auto and
 * thorough are model-driven end to end and a provider is not optional for them. Fast being the
 * default, an unstated exploration mode needs no provider either.
 *
 * `judgeUnclearScreens` is the one thing that changes that answer for Fast, and it is why this
 * takes the whole request rather than the mode pair: asking for the judge *is* asking for the
 * decision loop, so a Fast run with it on needs a provider exactly as auto does. The caller that
 * offers the switch is responsible for not offering it where nobody can service the loop — a
 * queued decision with no agent listening is a sweep that waits forever, which is worse than the
 * `uncertain` verdict the switch was meant to improve on.
 *
 * Here rather than inline at the two call sites (`buildAppFlow`'s throw and the service's start
 * refusal) because those two must agree — a sweep the service accepts and the orchestrator then
 * throws out is a spinner that never resolves — and because this file is the one place in the
 * start path that unit-tests without Electron.
 */
export function requiresDecisionProvider(
  mode: AppFlowBuildMode | undefined,
  explorationMode: ExplorationMode | undefined,
  judgeUnclearScreens?: boolean
): boolean {
  if ((mode ?? APP_FLOW_START_DEFAULTS.mode) !== 'screen-ui-and-structure') return false
  if ((explorationMode ?? APP_FLOW_START_DEFAULTS.explorationMode) !== 'fast') return true
  return judgeUnclearScreens ?? APP_FLOW_START_DEFAULTS.judgeUnclearScreens
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
    captureUiStates,
    judgeUnclearScreens
  } = raw as Record<string, unknown>
  if (typeof projectPath !== 'string' || projectPath.length > 4096)
    return { ok: false, error: 'Invalid project path.' }
  if (mode !== undefined && mode !== 'structure-only' && mode !== 'screen-ui-and-structure')
    return { ok: false, error: 'Invalid App Flow mode.' }
  if (screenLimit !== undefined && (!Number.isInteger(screenLimit) || (screenLimit as number) < 0))
    return { ok: false, error: 'Screen limit must be a non-negative integer.' }
  if (
    explorationMode !== undefined &&
    explorationMode !== 'auto' &&
    explorationMode !== 'fast' &&
    explorationMode !== 'thorough'
  )
    return { ok: false, error: 'Invalid exploration mode.' }
  if (deepLinkJudgeMode !== undefined && deepLinkJudgeMode !== 'on' && deepLinkJudgeMode !== 'off')
    return { ok: false, error: 'Invalid deep-link judge mode.' }
  if (captureUiStates !== undefined && typeof captureUiStates !== 'boolean')
    return { ok: false, error: 'Capture UI states must be true or false.' }
  if (judgeUnclearScreens !== undefined && typeof judgeUnclearScreens !== 'boolean')
    return { ok: false, error: 'Judge unclear screens must be true or false.' }
  return {
    ok: true,
    input: {
      projectPath,
      mode,
      screenLimit: screenLimit as number | undefined,
      explorationMode,
      deepLinkJudgeMode,
      captureUiStates,
      judgeUnclearScreens: judgeUnclearScreens as boolean | undefined
    }
  }
}
