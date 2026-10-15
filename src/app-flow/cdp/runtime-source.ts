/**
 * Assembles the in-app agent's source text from the real functions in `agent-runtime.ts`.
 *
 * The reference implementation does the same (`fn.toString()` over its runtime functions) but runs
 * its agent through an esbuild `target: 'es2015'` build first, and keeps a JSON-packaged copy for
 * the shipped server with a hand-written validity check. We take neither: the agent is written in
 * conservative syntax by hand (see the doc comment in `agent-runtime.ts`), so there is no build
 * step to forget and no second artefact to go stale. What replaces the build step is the check in
 * this file, which is deliberately cheap and deliberately textual.
 *
 * ## What the integrity check can and cannot promise
 *
 * It catches the failures that would otherwise show up only against a live device:
 *
 * - **A renamed function.** A bundler may rename a top-level declaration to avoid a collision. The
 *   functions call each other by their declared names, so injecting one under a new name would
 *   compile and then fail on first call. `fn.name` is compared with its registry key and a mismatch
 *   throws.
 * - **A missing or extra function**, which means the registry and the check disagree about what the
 *   agent is.
 * - **A runaway size.** The source rides in a single `Runtime.evaluate` frame that Hermes has to
 *   compile on every connect; a limit turns an accidental import of something large into a loud
 *   failure instead of a slow handshake.
 * - **Syntax the Hermes debugger evaluator cannot compile**: `async`/`await`, optional chaining,
 *   nullish coalescing, spread/rest, `for...of`, `class`, and template literals.
 *
 * It cannot prove the source is *correct*, and being textual it cannot tell a comment from code, so
 * an in-body comment spelling out a banned token is a false positive (and the fix is to reword the
 * comment). Free references to module-scope names are not detected here at all; the test suite
 * evaluates the assembled source in an empty `node:vm` context to flush those out.
 */
import { AGENT_FUNCTIONS } from './agent-runtime.ts'

/** The number of functions the agent is made of. Changing the registry means changing this. */
export const EXPECTED_AGENT_FUNCTION_COUNT = 14
/**
 * Upper bound on the assembled source. The current agent is well under a third of this; the limit
 * exists to catch an accident, not to budget bytes, and the reference's own packaged check uses
 * 500,000 per function for the same reason.
 */
export const MAX_AGENT_SOURCE_BYTES = 64 * 1024

/** Each pattern names a construct the debugger evaluator is not trusted to compile. */
const BANNED_SYNTAX: ReadonlyArray<readonly [string, RegExp]> = [
  ['async function', /\basync\b/],
  ['await', /\bawait\b/],
  ['optional chaining', /\?\.(?![0-9])/],
  ['nullish coalescing', /\?\?/],
  ['spread or rest', /\.\.\./],
  ['for...of', /\bfor\s*\(\s*(?:var|let|const)\s+[^;)]*\bof\b/],
  ['class', /\bclass\s+[A-Za-z_$]/],
  ['template literal', /`/]
]

export class AgentSourceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AgentSourceError'
  }
}

type AgentFunctionMap = Readonly<Record<string, (...args: never[]) => unknown>>

/**
 * Checks the registry and the text built from it. Exported so the tests can feed it a deliberately
 * bad registry and confirm each rule fires, rather than trusting that the passing case passes for
 * the right reason.
 */
export function assertAgentSourceIntegrity(
  functions: AgentFunctionMap,
  source: string,
  expectedCount: number = EXPECTED_AGENT_FUNCTION_COUNT
): void {
  const names = Object.keys(functions)
  if (names.length !== expectedCount) {
    throw new AgentSourceError(
      `agent has ${names.length} functions, expected ${expectedCount}; update EXPECTED_AGENT_FUNCTION_COUNT with the registry`
    )
  }
  for (const name of names) {
    if (functions[name]!.name !== name) {
      throw new AgentSourceError(
        `agent function "${name}" was renamed to "${functions[name]!.name}" by the build; injected functions call each other by name`
      )
    }
  }
  if (Buffer.byteLength(source, 'utf8') > MAX_AGENT_SOURCE_BYTES) {
    throw new AgentSourceError(`agent source exceeds ${MAX_AGENT_SOURCE_BYTES} bytes`)
  }
  for (const [label, pattern] of BANNED_SYNTAX) {
    const hit = pattern.exec(source)
    if (hit) {
      throw new AgentSourceError(
        `agent source contains ${label} near "${source.slice(Math.max(0, hit.index - 20), hit.index + 30).replace(/\s+/g, ' ')}"; see the syntax constraint in agent-runtime.ts`
      )
    }
  }
}

/**
 * The source of an expression that evaluates to the install function. Calling the result with
 * `(key, leaseMs, limits)` installs the agent; every helper lives in the closure that expression
 * creates, so nothing is added to the app's global scope but the one key.
 *
 * Each function is emitted as a declaration (`fn.toString()` already is one), so they are hoisted
 * and may be listed in any order.
 */
export function buildAgentSource(functions: AgentFunctionMap = AGENT_FUNCTIONS): string {
  const declarations = Object.values(functions)
    .map((fn) => fn.toString())
    .join('\n')
  const source = `(function () {\n${declarations}\nreturn agentInstall;\n})()`
  assertAgentSourceIntegrity(functions, source, Object.keys(functions).length)
  return source
}

let cached: string | undefined

/**
 * The agent source for the real registry, built and checked once. Nothing about it varies per
 * connection (the key, lease and limits are arguments at the call site), so rebuilding it per
 * connect would only repeat the check. Also asserts the registry size against the constant, which
 * `buildAgentSource` cannot do for a registry passed in.
 */
export function agentSource(): string {
  if (cached === undefined) {
    const source = buildAgentSource()
    assertAgentSourceIntegrity(AGENT_FUNCTIONS, source)
    cached = source
  }
  return cached
}
