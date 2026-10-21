export function tokenizeAgentDeviceCommand(command: string): string[] {
  const tokens: string[] = []
  let current = ''
  // Whether the token being built was quoted. Without it, `fill id=search ''` — clearing a field,
  // which a recorded path can legitimately contain — silently loses its second argument, because an
  // empty token is otherwise indistinguishable from the gap between two others.
  let quoted = false
  let quote: "'" | '"' | null = null
  const push = (): void => {
    if (current || quoted) tokens.push(current)
    current = ''
    quoted = false
  }
  for (const char of command) {
    if (quote) {
      if (char === quote) quote = null
      else current += char
    } else if (char === "'" || char === '"') {
      quote = char
      quoted = true
    } else if (/\s/.test(char)) push()
    else current += char
  }
  push()
  return tokens
}

export function parseAgentDeviceReplay(
  command: string
): { path: string; keepSession: boolean } | null {
  const tokens = tokenizeAgentDeviceCommand(command.trim())
  if (tokens[0] !== 'agent-device' || tokens[1] !== 'replay' || !tokens[2] || tokens[2] === 'run')
    return null
  return { path: tokens[2], keepSession: tokens.includes('--keep-session') }
}
