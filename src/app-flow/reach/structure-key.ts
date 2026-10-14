/**
 * Fingerprint of the parsed structure — plan Step 4b.
 *
 * Moved out of `orchestrator.ts` (which has no test file of its own, so this was previously
 * verifiable only by tracing the code by eye) so the guard below has a unit test. No device or
 * Electron import here, following every other module under `reach/` — see `reach/types.ts`'s doc
 * comment on why that seam matters.
 *
 * Stable across builds that parse the same routes: the per-screen resume checkpoint
 * (`sweep-progress.json`'s `structureKey`) is keyed on it, so routes that moved invalidate a stale
 * checkpoint while a re-run of an interrupted sweep matches and resumes.
 *
 * MUST be called with only the parser's own output (`parsed.nodes`/`parsed.edges` in
 * `orchestrator.ts`, before any runtime node or edge exists), and must never fold in a
 * runtime-discovered node or edge (plan Step 4a). If it did, the very act of the explorer
 * discovering a screen the parser missed would change this fingerprint, invalidate the checkpoint
 * that discovery is trying to build on, and restart the sweep from scratch on its own next capture.
 * The signature below accepts `readonly AppFlowNode[]`, which a future refactor could satisfy by
 * passing the merged parsed+runtime node array with no compile error — the guard exists so that
 * mistake fails loudly instead of silently invalidating every checkpoint from that point on.
 */
import { createHash } from 'node:crypto'
import type { AppFlowEdge, AppFlowNode } from '../../shared/app-flow.ts'

export function computeStructureKey(
  nodes: readonly AppFlowNode[],
  edges: readonly AppFlowEdge[]
): string {
  for (const node of nodes) {
    // `'chrome'` is guarded for the same reason as `'runtime'`, one step removed: a chrome virtual
    // node (`chromeVirtualNodes`, `reach/chrome-inventory.ts`) exists only because the explorer saw
    // a drawer or tab bar on device, so folding one in would let the act of *observing* a navigator
    // surface invalidate the checkpoint the observation is building on — the same self-defeating
    // loop, arriving through a different door.
    if (node.origin === 'runtime' || node.origin === 'chrome') {
      throw new Error(
        `computeStructureKey must only fingerprint parsed structure, but node "${node.id}" has ` +
          `origin: '${node.origin}'. Pass parsed.nodes/parsed.edges only — a runtime or chrome node ` +
          `folded into this hash would invalidate the resume checkpoint every time the explorer ` +
          `discovers a screen or a navigator chrome.`
      )
    }
  }
  const hash = createHash('sha256')
  for (const node of [...nodes].sort((a, b) => a.id.localeCompare(b.id))) {
    hash.update(`${node.id}\u0000${node.file ?? ''}\u0000${node.urlPath ?? ''}\u0000`)
  }
  for (const edge of [...edges].sort((a, b) =>
    `${a.from}>${a.to}`.localeCompare(`${b.from}>${b.to}`)
  )) {
    hash.update(`${edge.from}\u0000${edge.to ?? ''}\u0000`)
  }
  return hash.digest('hex').slice(0, 16)
}
