/**
 * How a node becomes an `agent-device-screens.json` entry's `key` and `info`.
 *
 * Extracted from `buildAgentDeviceScreens` (`orchestrator.ts`) so the manual recorder, which writes
 * a single entry into that same map outside any sweep, derives its key and info exactly the way the
 * sweep does. Two copies of this would drift into two different naming schemes for the one file
 * profiling and debugging both read.
 *
 * Pure — no device, no Electron, no storage — so it is testable under `node --test`.
 */
import type { AppFlowNode } from '../shared/app-flow.ts'
import { sanitizeScreenKey } from './reach/runtime-nodes.ts'

export function fallbackScreenKey(node: Pick<AppFlowNode, 'title' | 'id'>): string {
  return sanitizeScreenKey(node.title || node.id) || 'Screen'
}

/** `used` is mutated: the returned key is reserved in it before it is handed back. */
export function uniqueScreenKey(raw: string, used: Set<string>): string {
  const base = sanitizeScreenKey(raw) || 'Screen'
  if (!used.has(base)) {
    used.add(base)
    return base
  }
  let index = 2
  while (used.has(`${base}-${index}`)) index++
  const next = `${base}-${index}`
  used.add(next)
  return next
}

export function defaultScreenInfo(node: Pick<AppFlowNode, 'title' | 'id' | 'urlPath'>): string {
  return `${node.title || fallbackScreenKey(node)} screen${node.urlPath ? ` at ${node.urlPath}` : ''}.`
}
