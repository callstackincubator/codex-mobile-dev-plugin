/**
 * The third `pathToReach` source (plan Step 5) — a screen reached only through a recorded chrome
 * inventory, never through a verified replay of its own or an `openedByNode` deep link.
 * `buildAgentDeviceScreens` (`orchestrator.ts`) falls back to this only when both of those are
 * absent; without it, a runtime-discovered or chrome-reached screen has no `pathToReach` at all,
 * falls to `[]`, and is silently dropped from `agent-device-screens.json` — invisible to the
 * debugging and profiling pipelines even though the sweep found it.
 *
 * Pure and device-agnostic on purpose: this module never imports `capture.ts`/`storage.ts` values
 * (see `reach/value-imports.test.ts`), which is what keeps it testable under `node --test` without
 * Electron, matching every other file in this directory.
 *
 * The press/fill/open lines themselves now come from `walk-commands.ts` instead of being spelled
 * out here a second time. That module is pure too, so the seam this file guards is untouched, and
 * the duplication it used to carry had stopped being harmless: the private copies emitted
 * `agent-device press <selector>` with **no `--settle`**, while every other producer emitted it
 * with one. That did not matter while a `.ad` replay executed a chrome path, because the recorded
 * script settled between its own steps; it matters now that both kinds of path are read line by
 * line by the same `path-run.ts`, which turns a missing `--settle` into a press fired into a screen
 * still animating out of the previous one. On session_2026-10-13_13-18-49 eight of the 48 stored
 * paths came from this function — `TermsOfService`, `Feeds-2`, `StarterPack`, `VideoFeed`,
 * `Bookmarks`, `Home-Tab`, `Start`, `ModerationInbox` — and every press in all eight was missing
 * the flag, while the six walk-emitted paths beside them (`Profile-Followers` et al.) had it. Two
 * spellings of `agent-device press` was exactly how they drifted, so there is now one.
 */
import { quoteCliArg } from '../cli-args.ts'
import { agentDeviceOpenCommand, fillCommand, pressCommand } from '../walk-commands.ts'
import type {
  AppFlowChrome,
  AppFlowEdge,
  AppFlowNode,
  AppFlowStep,
  AppFlowTrigger
} from '../../shared/app-flow.ts'

/** The subset of `CaptureDevice` this module needs — declared locally rather than imported so this
 *  file never takes even a type-only dependency on `capture.ts`'s device shape evolving underneath
 *  it; any object with these two fields (a real `CaptureDevice` included) satisfies it structurally. */
export interface ChromePathDevice {
  setupCommands: readonly string[]
  launchTarget: string
}

/** The `agent-device press <selector>`/`fill <selector> <value>` form of one recorded chrome step,
 *  matching the `id="…"`/`label="…"`/`text="…"` selector syntax `resolve-target.ts` already uses on
 *  the profiling side for the same purpose. Only `tap`/`input` steps carry a locator to press
 *  through; a `swipe`/`wait` step (or a locator-less one) has no CLI equivalent here and is dropped
 *  rather than guessed at — a shorter, honest path beats a fabricated gesture that taps the wrong
 *  thing.
 *
 *  Deliberately *not* `walkStepCommand`, which renders a `swipe` as a scroll: a chrome `reveal` is
 *  an unordered set of things that were on screen, not a gesture sequence, so inventing a scroll
 *  from one would be the fabrication the paragraph above refuses. The press/fill lines themselves
 *  are that module's, `--settle` and all. */
function stepToPathCommand(step: AppFlowStep): string | null {
  if (!step.locator) return null
  const selector = `${step.locator.by}="${step.locator.value.replace(/"/g, '\\"')}"`
  if (step.type === 'input') return fillCommand(selector, step.value ?? '')
  if (step.type === 'tap') return pressCommand(selector)
  return null
}

/** Same selector form as `stepToPathCommand`, for a chrome edge's own `trigger` rather than a
 *  persisted `AppFlowStep` — `AppFlowTrigger` has no `type`, so pressing is the only sensible
 *  action for it. */
function triggerToPathCommand(trigger: AppFlowTrigger): string {
  return pressCommand(`${trigger.by}="${trigger.value.replace(/"/g, '\\"')}"`)
}

/**
 * Builds `pathToReach` for `node` from whatever a recorded chrome proves about it, or returns null
 * when no `runtime-chrome` edge reaches it at all (a `runtime-walk` edge is deliberately not
 * consulted here — that origin records an actual interactive hop, not a reveal/trigger pair, so
 * there is nothing here to reconstruct a path from).
 *
 * Two forms, preferring whichever the chrome actually proves:
 * - `edge.evidence.replayScript` set: the route was walked and a script recorded for it, so replay
 *   is played back verbatim — the same form `capture.ts`'s `replayPathToReach` already produces for
 *   a node's own verified capture. No producer sets this field yet (`chromeEdges` in
 *   `reach/chrome-inventory.ts` only ever writes `verified: false` with no `replayScript`), so this
 *   branch is dormant until a later round teaches the chrome path a way to record one; it is
 *   implemented now so this function does not have to change shape when that lands.
 * - Otherwise: the chrome's own `reveal` steps followed by the edge's `trigger`, each rendered as an
 *   `agent-device press`/`fill` line — the form the plan calls "only observed". This is the only
 *   form any current sweep can actually produce.
 *
 * Either way a URL-less `agent-device open <app>` line goes first: `findPathToReachOpen`
 * (`profiling/device.ts`) scans for the first `open` to learn the app id for log collection, and a
 * chrome route (unlike a deep link) never has one otherwise. It is also the honest description of
 * how this path starts — a chrome is reached from the plain launch screen, not a URL.
 *
 * Returns null when the chrome has neither a replay nor any pressable step to offer.
 */
export function buildChromePathToReach(
  node: AppFlowNode,
  edges: readonly AppFlowEdge[],
  runtimeEdges: readonly AppFlowEdge[],
  chrome: readonly AppFlowChrome[],
  device: ChromePathDevice
): string[] | null {
  const chromeEdge = [...edges, ...runtimeEdges].find(
    // `kind: 'reveal'` is excluded on purpose: a reveal edge's `to` is the chrome's own virtual node
    // (`chromeVirtualNodes`, `reach/chrome-inventory.ts`), never a screen, so it can never be the
    // edge that reaches `node` — but saying so here keeps this honest if a reveal edge's shape ever
    // changes, rather than relying on the id namespaces staying disjoint.
    (edge) => edge.to === node.id && edge.origin === 'runtime-chrome' && edge.kind !== 'reveal'
  )
  if (!chromeEdge) return null

  const openLine = [...device.setupCommands, agentDeviceOpenCommand(device.launchTarget)]

  if (chromeEdge.evidence?.replayScript) {
    return [
      ...openLine,
      `agent-device replay ${quoteCliArg(chromeEdge.evidence.replayScript)} --keep-session`
    ]
  }

  // Resolved through `evidence.chromeId` rather than by matching `entryNodeId`. A chrome item's
  // edge now starts at the chrome's own id, not at whichever screen happened to reveal it first —
  // that re-attribution is exactly what made a device run publish 40 screens as reachable from
  // `HomeTab/Home` — so `chromeEdge.from` is the chrome id itself, and `chromeId` is the direct
  // link the evidence has carried all along. The `from` comparison stays as a fallback for edges
  // written before `chromeId` was populated.
  const record =
    chrome.find((candidate) => candidate.id === chromeEdge.evidence?.chromeId) ??
    chrome.find((candidate) => candidate.id === chromeEdge.from) ??
    chrome.find((candidate) => candidate.entryNodeId === chromeEdge.from)
  const steps = [
    ...(record?.reveal.map(stepToPathCommand) ?? []),
    chromeEdge.trigger ? triggerToPathCommand(chromeEdge.trigger) : null
  ].filter((line): line is string => Boolean(line))
  if (!steps.length) return null

  return [...openLine, ...steps]
}
