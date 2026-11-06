export type ResolvedInteractionTarget =
  | { kind: 'point'; x: number; y: number }
  | { kind: 'ref'; ref: string }
  | { kind: 'selector'; selector: string }

export type AgentDeviceInteractionTarget =
  { x: number; y: number } | { ref: string } | { selector: string }

const PLACEHOLDER_COORDINATES = /^[xy]\s+[xy]$/i
const NUMERIC_COORDINATES = /^(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)$/

export function parseInteractionTarget(target: string): ResolvedInteractionTarget {
  const trimmed = target.trim()
  if (!trimmed) throw new Error('Interaction target cannot be empty')
  if (PLACEHOLDER_COORDINATES.test(trimmed)) {
    throw new Error(
      'Target "x y" is a schema placeholder, not a locator. Use text=, label=, id=, an @ref, or numeric coordinates such as "184 412".'
    )
  }

  const coords = NUMERIC_COORDINATES.exec(trimmed)
  if (coords) {
    return { kind: 'point', x: Number(coords[1]), y: Number(coords[2]) }
  }
  if (trimmed.startsWith('@')) {
    return { kind: 'ref', ref: trimmed }
  }
  return { kind: 'selector', selector: trimmed }
}

export function toAgentDeviceTarget(
  target: ResolvedInteractionTarget
): AgentDeviceInteractionTarget {
  if (target.kind === 'point') return { x: target.x, y: target.y }
  if (target.kind === 'ref') return { ref: target.ref }
  return { selector: target.selector }
}
