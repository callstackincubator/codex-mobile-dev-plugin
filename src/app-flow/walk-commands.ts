/**
 * The `agent-device …` command lines a sweep stores as a screen's `pathToReach`, built from the
 * steps the explorer actually walked.
 *
 * Why this exists. Until this round the sweep's own answer to "how do I get back to this screen"
 * was a recorded `.ad` script: `startReplayRecording` armed `apps.open({ relaunch: true,
 * saveScript })` before the first planner step, every tap was recorded into a candidate file, and
 * `pathToReach` collapsed to a single `agent-device replay <script> --keep-session`. The relaunch
 * was not there to put the walk on a known screen — `goHome` does that without throwing the
 * process away — it was there so the recorded script's *first line* would be `open --relaunch`.
 * That is a cold start, a bundle reload and (on a dev client) a 20s launcher deferral, paid once
 * per walk for the artefact rather than for the walk. On the 2026-10-13 sweep that machinery cost
 * ~173s of 683s and produced one usable script out of seven explorations.
 *
 * The material for the alternative was already in hand and already being thrown away: the explorer
 * executes a list of `AppFlowStep`s and knows exactly what each one was. `reach/chrome-path.ts`
 * has been reconstructing `agent-device press`/`fill` lines from recorded steps all along, and
 * `manual/commands.ts` does the same for the manual recorder's fallback path. This module is the
 * third consumer of that idea and the one that lets the recording go away entirely: a walk emits
 * its own commands, they are stored verbatim, and a launch line goes in front of them so the
 * stored path stands alone.
 *
 * Pure, and deliberately free of any Electron or device import, so every line it can emit is round
 * tripped against `manual/path-commands.ts` (the parser that reads these back) under `node --test`.
 * A stored path nothing can execute is worth nothing — that is the same bar `manual/commands.ts`
 * holds itself to, and the reason the two share their primitives rather than keeping two spellings
 * of `agent-device press`.
 */
import { quoteCliArg } from './cli-args.ts'
import type { AppFlowStep } from '../shared/app-flow.ts'

/**
 * `--settle` on every interaction line, mirroring the `settle: true` every in-process call passes:
 * without it a replayed path fires the next command into a screen still animating out of the
 * previous one. Accepted on exactly press/fill/longpress/hover/scroll/back, which covers every
 * command built here.
 */
const SETTLE = '--settle'

/** The subset of `CaptureDevice` a baseline launch line needs. Declared structurally rather than
 *  imported so this module never takes even a type-only dependency on `capture.ts` — any object
 *  with these three fields (a real `CaptureDevice` included) satisfies it. */
export interface LaunchBaselineDevice {
  setupCommands: readonly string[]
  launchTarget: string
  launchUrl: string | null
}

/**
 * `agent-device open <app> [url] --platform ios`.
 *
 * Moved here from `capture.ts` rather than copied: `buildAgentDevicePathToReach`,
 * `manual/session.ts`'s fallback path and `baselineLaunchCommands` below all emit this exact line,
 * and `capture.ts` re-exports it so its existing callers are unchanged. It lives in the pure module
 * because this is the one of the two that can be unit tested.
 */
export function agentDeviceOpenCommand(app: string, url?: string | null): string {
  if (url) {
    return `agent-device open ${quoteCliArg(app)} ${quoteCliArg(url)} --platform ios`
  }
  return `agent-device open ${quoteCliArg(app)} --platform ios`
}

export function pressCommand(selector: string): string {
  return `agent-device press ${quoteCliArg(selector)} ${SETTLE}`
}

/** `press <x> <y>` — coordinates are positional, as the CLI's `press <x y|@ref|selector>` shows. */
export function pressPointCommand(x: number, y: number): string {
  return `agent-device press ${x} ${y} ${SETTLE}`
}

export function fillCommand(selector: string, value: string): string {
  return `agent-device fill ${quoteCliArg(selector)} ${quoteCliArg(value)} ${SETTLE}`
}

/** `scroll <direction>` — the direction is positional, not a `--direction` flag. */
export function scrollCommand(direction: 'up' | 'down' | 'left' | 'right'): string {
  return `agent-device scroll ${direction} ${SETTLE}`
}

/**
 * The launch line (and the boot/install lines in front of it) every stored path now opens with.
 *
 * This is the "baseline prefix" the sweep no longer pays a recording relaunch to obtain. Three
 * things depend on it being here and being first:
 *
 * - `findPathToReachOpen` (`profiling/device.ts`) scans a `pathToReach` for its first `open` line
 *   to learn which app id to collect logs from. A path that began with a bare `press` would leave
 *   profiling with no app to attribute anything to.
 * - `runPathToReach` (`path-run.ts`) and `reachStartScreen` both treat an `open` as "launch and
 *   wait for a usable frame". Without one they would press into whatever the device happened to be
 *   showing.
 * - It is the honest description of where the walk started. `url` is set for a walk seeded by a
 *   deep link, so the stored path reproduces the same starting screen the walk actually had; for
 *   an unseeded walk it falls back to `device.launchUrl`, which is what the live reset opens.
 *
 * Deliberately *not* `open --relaunch`. The sweep's own reset is a soft re-root (`goHome`), and a
 * stored path that demanded a cold relaunch would describe a journey the sweep never took.
 */
export function baselineLaunchCommands(
  device: LaunchBaselineDevice,
  url?: string | null
): string[] {
  return [
    ...device.setupCommands,
    agentDeviceOpenCommand(device.launchTarget, url ?? device.launchUrl)
  ]
}

/**
 * One walked step as a command line, or null when the step has no faithful CLI equivalent.
 *
 * The selector syntax (`id="…"`, `label="…"`, `text="…"`) is the one `serializeLocator`
 * (`manual/locators.ts`) and `resolve-target.ts` already use, so a stored line parses back through
 * `parsePathStep` and executes through the same `interactions.press`/`fill` calls the live walk
 * made.
 *
 * A `swipe` becomes `agent-device scroll <direction>`, which is not an approximation: the live
 * executor (`executeNavigationActions`, `capture.ts`) dispatches a `swipe` step through
 * `interactions.scroll({ direction })` and nothing else, so the CLI's `scroll` is the same call by
 * its own name. `direction` defaults to `up` here for the same reason it does there.
 *
 * Null for two cases, both of which the caller must treat as "this walk cannot be stored", not as
 * "skip a line":
 * - a `tap`/`input` with no locator — the live press went through coordinates or a `@ref`, neither
 *   of which survives into another session;
 * - a `wait` — harmless to drop on its own, but see `walkCommands`, which refuses to guess which
 *   omissions are harmless.
 *
 * A `wait` is the one exception the caller is allowed to drop, and it does so explicitly rather
 * than by this function lying about it: `--settle` on every surrounding line already waits for the
 * screen to stop moving, which is what the planner's `wait` was asking for.
 */
export function walkStepCommand(step: AppFlowStep): string | null {
  if (step.type === 'wait') return null
  if (step.type === 'swipe') return scrollCommand(step.direction ?? 'up')
  if (!step.locator) return null
  const selector = `${step.locator.by}="${step.locator.value.replace(/"/g, '\\"')}"`
  if (step.type === 'input') return fillCommand(selector, step.value ?? '')
  if (step.type === 'tap') return pressCommand(selector)
  return null
}

/**
 * Every step of a walk as command lines, or null when any step could not be rendered faithfully.
 *
 * All-or-nothing on purpose, and this is the one judgement call in the module. `chrome-path.ts`
 * drops unrenderable steps because its input is a *reveal* — an unordered set of things that were
 * on screen — so a shorter list is still true. A walk is a sequence: dropping its third tap leaves
 * a path that opens the app, presses the first two controls and claims to have arrived somewhere it
 * has not. That is worse than storing nothing, because `buildAgentDeviceScreens` drops an empty
 * path from the screens map (visibly, as a missing screen) while a truncated one is silently wrong
 * for every consumer downstream.
 *
 * `wait` steps are skipped rather than failing the walk — see `walkStepCommand`.
 */
export function walkCommands(steps: readonly AppFlowStep[]): string[] | null {
  const lines: string[] = []
  for (const step of steps) {
    if (step.type === 'wait') continue
    const line = walkStepCommand(step)
    if (!line) return null
    lines.push(line)
  }
  return lines
}
