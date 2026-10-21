import type { TokenUsage } from '../shared/app-flow.ts'

export type SubAgentThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
export interface ModelCallDiagnostic { [key: string]: unknown }

export interface SubAgentOptions {
  cwd: string
  systemPrompt: string
  userPrompt: string
  tools?: string[]
  thinkingLevel?: SubAgentThinkingLevel
  providerId?: string
  modelId?: string
  imagePath?: string
  timeoutMs?: number
  onProgress?: (message: string, level?: 'info' | 'warn') => void
  onUsage?: (usage: TokenUsage) => void
  onDiagnostic?: (diagnostic: ModelCallDiagnostic) => void
  diagnosticContext?: { agent: string; fixerExecutionAttempt?: number }
  returnPartialOnTimeout?: boolean
}

export interface SubAgentResult {
  text: string
  toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>
  timedOut: boolean
  filesChanged: string[]
  tokens: TokenUsage
  diagnostics: ModelCallDiagnostic[]
}

export interface CompactHistoryOptions {
  keepRecentUserTurns?: number
  placeholder?: string
}
export interface SubAgentSessionOptions {
  cwd: string
  systemPrompt: string
  tools?: string[]
  thinkingLevel?: SubAgentThinkingLevel
  providerId?: string
  modelId?: string
  compactHistory?: CompactHistoryOptions
}
export type SubAgentCallOptions = Omit<
  SubAgentOptions,
  'cwd' | 'systemPrompt' | 'tools' | 'thinkingLevel' | 'providerId' | 'modelId'
>

export function parseSubAgentJson<T>(text: string, validate?: (value: unknown) => value is T): T | null {
  const candidates: string[] = []
  let start = -1, depth = 0, inString = false, escaped = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === '{') { if (depth === 0) start = index; depth += 1 }
    else if (char === '}' && depth > 0) { depth -= 1; if (depth === 0 && start >= 0) candidates.push(text.slice(start, index + 1)) }
  }
  for (const candidate of candidates.reverse()) {
    try {
      const value = JSON.parse(candidate) as unknown
      if (!validate || validate(value)) return value as T
    } catch { /* Try the preceding complete JSON object. */ }
  }
  return null
}

export interface AppFlowDecisionSession {
  prompt(options: SubAgentCallOptions, label: string): Promise<SubAgentResult>
  historyLength(): number
  dispose(): void
}
export interface AppFlowDecisionProvider {
  run(options: SubAgentOptions, label: string): Promise<SubAgentResult>
  createSession(options: SubAgentSessionOptions): Promise<AppFlowDecisionSession>
  activeNow?(): number
  /** Single-pending-request host providers set this false so the engine never hedges. */
  supportsConcurrentRequests?: boolean
}
