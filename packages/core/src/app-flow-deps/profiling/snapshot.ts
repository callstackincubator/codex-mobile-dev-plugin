export interface SlimRect { x: number; y: number; width: number; height: number }
export interface SlimSnapshotNode { ref: string; role?: string; type?: string; label?: string; value?: string; identifier?: string; rect?: SlimRect }
export interface SnapshotNodeLike extends Omit<SlimSnapshotNode, 'ref'> { ref?: string; enabled?: boolean; visibleToUser?: boolean }
const CONTAINERS = new Set(['application', 'window', 'scrollview', 'scroll-view'])
function semanticType(node: Pick<SlimSnapshotNode, 'role' | 'type'>): string { return `${node.role ?? node.type ?? ''}`.toLowerCase().replace(/^xcuielementtype/, '') }
export function slimSnapshotNodes(nodes: readonly SnapshotNodeLike[]): SlimSnapshotNode[] {
  return nodes.flatMap((node) => {
    if (node.visibleToUser === false || node.enabled === false || CONTAINERS.has(semanticType(node)) || !node.ref?.trim()) return []
    const ref = node.ref.trim()
    return [{ ref: ref.startsWith('@') ? ref : `@${ref}`, ...(node.role ? { role: node.role } : {}), ...(node.type ? { type: node.type } : {}), ...(node.label ? { label: node.label } : {}), ...(node.value ? { value: node.value } : {}), ...(node.identifier ? { identifier: node.identifier } : {}), ...(node.rect ? { rect: node.rect } : {}) }]
  })
}
export function snapshotBounds(nodes: readonly SnapshotNodeLike[]): SlimRect {
  let widest: SlimRect | null = null, union: SlimRect | null = null
  for (const node of nodes) {
    const rect = node.rect
    if (!rect || rect.width <= 0 || rect.height <= 0) continue
    if (CONTAINERS.has(semanticType(node)) && (!widest || rect.width * rect.height > widest.width * widest.height)) widest = rect
    if (!union) union = { ...rect }
    else {
      const right = Math.max(union.x + union.width, rect.x + rect.width), bottom = Math.max(union.y + union.height, rect.y + rect.height)
      union.x = Math.min(union.x, rect.x); union.y = Math.min(union.y, rect.y); union.width = right - union.x; union.height = bottom - union.y
    }
  }
  return widest ?? union ?? { x: 0, y: 0, width: 0, height: 0 }
}
export async function captureSnapshotFrame(
  device: { client: { capture: { snapshot(options: Record<string, unknown>): Promise<{ nodes?: unknown }> } } },
  options?: { platform?: 'ios' | 'android'; timeoutMs?: number; noRecord?: boolean }
): Promise<{ nodes: SlimSnapshotNode[]; bounds: SlimRect }> {
  const snapshot = await device.client.capture.snapshot({ platform: options?.platform ?? 'ios', responseLevel: 'default', interactiveOnly: true, customActions: true, forceFull: true, ...(options?.noRecord === false ? {} : { noRecord: true }), timeoutMs: options?.timeoutMs ?? 30_000 })
  if (!Array.isArray(snapshot.nodes)) throw new Error('agent-device snapshot did not return a nodes array')
  const raw = snapshot.nodes as SnapshotNodeLike[]
  return { nodes: slimSnapshotNodes(raw), bounds: snapshotBounds(raw) }
}
