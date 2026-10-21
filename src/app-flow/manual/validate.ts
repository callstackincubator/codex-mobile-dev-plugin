/**
 * Narrowing for the one manual-recording payload that is not a bare string.
 *
 * Lives beside the feature rather than in `ipc.ts` for the same reason `isDebuggingUserResponse`
 * does: the shape belongs to the feature, and a guard this specific is worth unit-testing on its
 * own. Pure — no Electron, no device.
 */
import type { ManualRecordingAction, ManualSnapshotNode } from '../../shared/app-flow.ts'

const SCROLL_DIRECTIONS = new Set(['up', 'down', 'left', 'right'])
const MAX_TEXT = 4096

function optionalString(value: unknown, max = 1024): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string' || value.length > max) return undefined
  return value
}

function parseTarget(value: unknown): ManualSnapshotNode | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  if (typeof raw.ref !== 'string' || raw.ref.length > 256) return null

  let rect: ManualSnapshotNode['rect']
  if (raw.rect !== undefined && raw.rect !== null) {
    const candidate = raw.rect as Record<string, unknown>
    const numbers = ['x', 'y', 'width', 'height'].map((key) => candidate[key])
    if (!numbers.every((entry) => typeof entry === 'number' && Number.isFinite(entry))) return null
    rect = {
      x: candidate.x as number,
      y: candidate.y as number,
      width: candidate.width as number,
      height: candidate.height as number
    }
  }

  return {
    ref: raw.ref,
    ...(optionalString(raw.role, 128) ? { role: raw.role as string } : {}),
    ...(optionalString(raw.type, 128) ? { type: raw.type as string } : {}),
    ...(optionalString(raw.label) ? { label: raw.label as string } : {}),
    ...(optionalString(raw.value) ? { value: raw.value as string } : {}),
    ...(optionalString(raw.identifier) ? { identifier: raw.identifier as string } : {}),
    ...(rect ? { rect } : {})
  }
}

export function parseManualRecordingAction(value: unknown): ManualRecordingAction | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>

  if (raw.type === 'scroll') {
    if (typeof raw.direction !== 'string' || !SCROLL_DIRECTIONS.has(raw.direction)) return null
    return { type: 'scroll', direction: raw.direction as 'up' | 'down' | 'left' | 'right' }
  }

  const target = parseTarget(raw.target)
  if (!target) return null
  if (raw.type === 'tap') return { type: 'tap', target }
  if (raw.type === 'fill') {
    if (typeof raw.value !== 'string' || raw.value.length > MAX_TEXT) return null
    return { type: 'fill', target, value: raw.value }
  }
  return null
}
