/**
 * Reading a `pathToReach` back: the inverse of `commands.ts`, plus the two lines a sweep writes.
 *
 * `reachStartScreen` ([profiling/device.ts](../../profiling/device.ts)) already does this for
 * profiling, but it reaches for a shell for anything that is not `replay` or `open`, and it needs a
 * `ProfilingContext` to do it. The Replay button has neither, so it dispatches in process against
 * the `CaptureDevice` the recorder already uses — which means the literal `press`/`fill`/`scroll`
 * lines a fallback recording produces have to be understood here rather than handed to `/bin/zsh`.
 *
 * Pure, and free of Electron and device imports, so every form `commands.ts` can emit is round
 * tripped in a unit test. Anything unrecognised comes back `null` rather than being guessed at: the
 * caller reports the line it could not run, which is far better than silently skipping a step and
 * leaving the user on the wrong screen wondering why.
 */
import { tokenizeAgentDeviceCommand } from '../../server/app-flow-deps/profiling/agent-device-command.ts'

export type PathStep =
  /** `boot` and `install` — the device is already up by the time a path runs. */
  | { kind: 'skip' }
  | { kind: 'replay'; path: string }
  | { kind: 'open'; app: string; url: string | null }
  | { kind: 'press'; selector: string }
  | { kind: 'pressPoint'; x: number; y: number }
  | { kind: 'fill'; selector: string; value: string }
  | { kind: 'scroll'; direction: 'up' | 'down' | 'left' | 'right' }

const SCROLL_DIRECTIONS = new Set(['up', 'down', 'left', 'right'])

/**
 * The positional arguments of a command, with flags and their values removed.
 *
 * `--settle` takes no value while `--timeout 5000` does, and nothing in the token stream says
 * which is which. The rule matches `parseAgentDeviceOpen`'s: a flag swallows the next token unless
 * that token is itself a flag, which is right for every flag these commands carry.
 */
function positionals(tokens: readonly string[], from: number): string[] {
  const values: string[] = []
  for (let i = from; i < tokens.length; i++) {
    const token = tokens[i]
    if (!token.startsWith('--')) {
      values.push(token)
      continue
    }
    if (!token.includes('=') && tokens[i + 1] && !tokens[i + 1].startsWith('--')) i++
  }
  return values
}

export function parsePathStep(command: string): PathStep | null {
  const tokens = tokenizeAgentDeviceCommand(command.trim())
  if (tokens[0] !== 'agent-device') return null
  const verb = tokens[1]
  const args = positionals(tokens, 2)

  if (verb === 'boot' || verb === 'install') return { kind: 'skip' }

  if (verb === 'replay') {
    // `replay run <path>` is the long form of `replay <path>`.
    const path = args[0] === 'run' ? args[1] : args[0]
    return path ? { kind: 'replay', path } : null
  }

  if (verb === 'open') {
    return args[0] ? { kind: 'open', app: args[0], url: args[1] ?? null } : null
  }

  if (verb === 'press') {
    // `press <x> <y>` — two numbers, as `pressPointCommand` writes it.
    if (args.length >= 2 && args.every((arg) => /^-?\d+(\.\d+)?$/.test(arg))) {
      return { kind: 'pressPoint', x: Number(args[0]), y: Number(args[1]) }
    }
    return args[0] ? { kind: 'press', selector: args[0] } : null
  }

  if (verb === 'fill') {
    // An empty string is a legitimate value — clearing a field — so only a missing one is a parse
    // failure, which is why this tests the count rather than the truthiness of `args[1]`.
    return args.length >= 2 && args[0] ? { kind: 'fill', selector: args[0], value: args[1] } : null
  }

  if (verb === 'scroll') {
    return args[0] && SCROLL_DIRECTIONS.has(args[0])
      ? { kind: 'scroll', direction: args[0] as 'up' | 'down' | 'left' | 'right' }
      : null
  }

  return null
}
