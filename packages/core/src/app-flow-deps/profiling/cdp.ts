export interface CdpTarget { id: string; kind: string; title: string }
function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}
function text(value: unknown): string | null { return typeof value === 'string' && value.trim() ? value : null }
function target(value: unknown): CdpTarget | null {
  const item = record(value), id = text(item?.id) ?? text(item?.targetId)
  return item && id ? { id, kind: text(item.kind) ?? text(item.type) ?? 'unknown', title: text(item.title) ?? text(item.label) ?? id } : null
}
export function parseCdpTargetList(output: string): CdpTarget[] {
  let payload: unknown = null
  try { payload = JSON.parse(output) } catch { /* Try tabular output below. */ }
  const object = record(payload)
  const items = Array.isArray(payload) ? payload : Array.isArray(object?.targets) ? object.targets : Array.isArray(object?.items) ? object.items : null
  if (items) {
    const parsed = items.map(target).filter((item): item is CdpTarget => item !== null)
    if (parsed.length) return parsed
  }
  const targets: CdpTarget[] = []
  for (const line of output.trim().split(/\r?\n/)) {
    if (/^no targets found$/i.test(line.trim())) continue
    const match = line.trim().match(/^(\S+)\s+(\S+)\s+(\S.*)$/)
    if (match) targets.push({ id: match[1], kind: match[2], title: match[3] })
  }
  return targets
}
export function shellQuote(value: string): string { return `'${value.replaceAll("'", "'\\''")}'` }
export function agentDeviceCdp(deviceSession: string, cdpArgs: string, verbose = false): string {
  return `agent-device --session ${shellQuote(deviceSession)} cdp ${verbose ? '--verbose ' : ''}${cdpArgs}`
}
export function pickMetroCdpTarget(targets: CdpTarget[], preferred: Array<string | null | undefined>): CdpTarget | null {
  for (const label of preferred.map((value) => value?.trim()).filter((value): value is string => Boolean(value))) {
    const match = targets.find((item) => item.title.toLowerCase().includes(label.toLowerCase()))
    if (match) return match
  }
  return targets.find((item) => /react native/i.test(item.title)) ?? targets[0] ?? null
}
