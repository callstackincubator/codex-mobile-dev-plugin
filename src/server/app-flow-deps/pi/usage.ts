import type { TokenUsage } from '../../../shared/app-flow.ts'
import { emptyTokenUsage } from '../../../shared/app-flow.ts'
export { emptyTokenUsage }

export interface ProviderUsage {
  input?: number
  output?: number
  cacheRead?: number
  cacheWrite?: number
  reasoning?: number
  totalTokens?: number
  cost?: { total?: number }
}

export function addUsage(totals: TokenUsage, usage: ProviderUsage | undefined): void {
  if (!usage) return
  const input = usage.input ?? 0, output = usage.output ?? 0
  const cacheRead = usage.cacheRead ?? 0, cacheWrite = usage.cacheWrite ?? 0
  totals.input += input; totals.output += output
  totals.cacheRead += cacheRead; totals.cacheWrite += cacheWrite
  totals.reasoning += usage.reasoning ?? 0
  totals.total += usage.totalTokens ?? input + output + cacheRead + cacheWrite
  totals.cost += usage.cost?.total ?? 0
}

export function toTokenUsage(usage: ProviderUsage | undefined): TokenUsage {
  const totals = emptyTokenUsage()
  addUsage(totals, usage)
  return totals
}
export function snapshotUsage(totals: TokenUsage): TokenUsage { return { ...totals } }
