/**
 * Locator derivation for the manual recorder.
 *
 * Pure — no device, no Electron — so the two rules that decide whether a manual recording can be
 * published at all are testable under `node --test` without a simulator.
 */
import type { ManualSnapshotNode, ManualSnapshotRect } from '../../shared/app-flow.ts'
import type { AppFlowDestinationLocator } from '../capture.ts'

export type ManualLocator = { by: 'text' | 'label' | 'id'; value: string }

/**
 * How a clicked element becomes a selector, in descending order of durability.
 *
 * `identifier` (a `nativeID`/accessibility id) survives copy changes and localisation; `label` is
 * next; `value` (the rendered text) is the last resort and is the only one that cannot guard a
 * saved recording — see `destinationLocator`. Returns null for a node carrying none of the three,
 * which the caller presses by coordinate instead.
 */
export function locatorFor(node: ManualSnapshotNode): ManualLocator | null {
  const identifier = node.identifier?.trim()
  if (identifier) return { by: 'id', value: identifier }
  const label = node.label?.trim()
  if (label) return { by: 'label', value: label }
  const value = node.value?.trim()
  if (value) return { by: 'text', value }
  return null
}

/**
 * The landmark that guards the published recording, picked off the screen the session ended on.
 *
 * agent-device's `sessions.saveScript` refuses to publish an active-session script unless, after
 * the last mutating action, there is a `wait` on a selector whose matched element carries a
 * re-verifiable identity — the "portable destination guard". Only an id or an accessibility label
 * qualifies, which is why `by: 'text'` is excluded here exactly as it is from
 * `AppFlowDestinationLocator`. Null means the session has to fall back to literal commands.
 */
export function destinationLocator(
  nodes: readonly ManualSnapshotNode[]
): AppFlowDestinationLocator | null {
  for (const node of nodes) {
    const identifier = node.identifier?.trim()
    if (identifier) return { by: 'id', value: identifier }
  }
  for (const node of nodes) {
    const label = node.label?.trim()
    if (label) return { by: 'label', value: label }
  }
  return null
}

/** The point to press when a node carries no selector at all. */
export function rectCenter(rect: ManualSnapshotRect): { x: number; y: number } {
  return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) }
}
