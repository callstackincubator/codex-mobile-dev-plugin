export function tokenizeAgentDeviceCommand(command: string): string[] {
  const tokens: string[] = []
  let current = ''
  // Whether the token being built was quoted. Without it, `fill id=search ''` — clearing a field,
  // which a recorded path can legitimately contain — silently loses its second argument, because an
  // empty token is otherwise indistinguishable from the gap between two others.
  let quoted = false
  let quote: "'" | '"' | null = null
  // Whether the previous character outside a quote was an unquoted backslash. `quoteCliArg()`
  // escapes an embedded `'` as `'\''` — close quote, backslash-escaped quote, reopen quote — which
  // only round-trips if a backslash outside quotes is treated as escaping the character after it
  // rather than as literal text. Without this, `it's` (quoted as `'it'\''s'`) tokenizes with a
  // literal backslash in place of the apostrophe instead of recovering it.
  let escaped = false
  const push = (): void => {
    if (current || quoted) tokens.push(current)
    current = ''
    quoted = false
  }
  for (const char of command) {
    if (escaped) {
      current += char
      quoted = true
      escaped = false
    } else if (quote) {
      if (char === quote) quote = null
      else current += char
    } else if (char === '\\') {
      escaped = true
    } else if (char === "'" || char === '"') {
      quote = char
      quoted = true
    } else if (/\s/.test(char)) push()
    else current += char
  }
  // A trailing unquoted backslash with nothing after it escapes nothing; keep it literal rather
  // than silently dropping it.
  if (escaped) current += '\\'
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
