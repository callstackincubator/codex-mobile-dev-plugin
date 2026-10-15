import type { AppFlowCapture, ExplorationMode } from '../../shared/app-flow.ts'
import type { AppFlowSweepProgress } from '../storage.ts'

export interface SweepFingerprint {
  structureKey: string
  explorationMode: ExplorationMode
  sourceHash: string
  fastFingerprint: string
}

/**
 * Reconciles an interrupted sweep with the active pipeline. Exact fingerprints resume every
 * verdict; a mode/source/runtime change retains only successful screenshots and re-queues missing
 * or unreached screens. A structure change invalidates everything.
 */
export function reconcileSweepProgress(
  resumed: AppFlowSweepProgress | null,
  current: SweepFingerprint
): { resuming: boolean; checkpoint: AppFlowSweepProgress; retained: number } {
  const sameStructure = resumed?.structureKey === current.structureKey
  const resuming =
    sameStructure &&
    resumed?.explorationMode === current.explorationMode &&
    resumed?.sourceHash === current.sourceHash &&
    resumed?.fastFingerprint === current.fastFingerprint
  if (resuming) return { resuming: true, checkpoint: resumed, retained: 0 }

  const reusable = (capture: AppFlowCapture): boolean =>
    capture.captureMethod !== 'unreached' && capture.status !== 'missing'
  const captures = sameStructure
    ? Object.fromEntries(Object.entries(resumed?.captures ?? {}).filter(([, value]) => reusable(value)))
    : {}
  const ids = new Set(Object.keys(captures))
  return {
    resuming: false,
    retained: ids.size,
    checkpoint: {
      ...current,
      updatedAt: '',
      captures,
      opened: Object.fromEntries(
        Object.entries(resumed?.opened ?? {}).filter(([id]) => ids.has(id))
      ),
      inferred: Object.fromEntries(
        Object.entries(resumed?.inferred ?? {}).filter(([id]) => ids.has(id))
      ),
      statesDone: (resumed?.statesDone ?? []).filter((id) => ids.has(id)),
      runtimeNodes: sameStructure ? resumed?.runtimeNodes : [],
      runtimeEdges: sameStructure ? resumed?.runtimeEdges : [],
      chrome: sameStructure ? resumed?.chrome : []
    }
  }
}
