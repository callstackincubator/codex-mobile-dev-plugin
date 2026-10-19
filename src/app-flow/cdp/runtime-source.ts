/**
 * Assembles the in-app agent's source text from the real functions in `agent-runtime.ts`, checking
 * each one on the way out.
 *
 * ## Why there is no transform here any more
 *
 * This module briefly ran each function through an esbuild `target: 'es2015'` transform at
 * assembly time, mirroring the reference implementation's `scripts/build-flow-runtime.mjs`. That
 * could not ship: the server is bundled into a single `dist/server.mjs`, and esbuild's JavaScript
 * API refuses to run once it has been bundled into another file, so the packaged plugin threw
 * `The esbuild JavaScript API cannot be bundled` on first connect. The reference does not hit this
 * because it transforms at *build* time into a `runtime.json` artefact and its server only reads
 * that file back.
 *
 * Rather than ship esbuild as a runtime dependency (a platform-specific native binary) or grow a
 * second build artefact that can go stale, the transform is gone. It was buying nothing: every
 * function in `AGENT_FUNCTIONS` is already ES2015-or-below, so the pass was a no-op on everything
 * except comments, which it stripped. The agent is correspondingly ~10KB larger on the wire and
 * still well inside the size tripwire below. If modern syntax is ever genuinely wanted in an agent
 * function, the move is to add a build step like the reference's, not to bring esbuild back here.
 *
 * ## Why per function rather than over the whole concatenation
 *
 * Keeping the unit of checking equal to the unit of the registry is what keeps the
 * `fn.name`-vs-registry-key check meaningful: each chunk must still be one top-level
 * `function agentX` declaration, verified below, so a renamed or vanished declaration is caught at
 * assembly rather than on first call against a device.
 *
 * ## What the integrity check can and cannot promise
 *
 * The check runs over the text that is actually injected. With no transform in front of it, the
 * syntax scan is now exactly what it reads as: a style rule the author must keep, not an assertion
 * that a lowering pass did its job. A hit means someone wrote a banned construct.
 *
 * It catches the failures that would otherwise show up only against a live device:
 *
 * - **A renamed function.** A bundler may rename a top-level declaration to avoid a collision. The
 *   functions call each other by their declared names, so injecting one under a new name would
 *   compile and then fail on first call. `fn.name` is compared with its registry key and a mismatch
 *   throws; the lowered text is separately checked to still declare that same name.
 * - **A missing or extra function**, which means the registry and the check disagree about what the
 *   agent is.
 * - **A runaway size.** The source rides in a single `Runtime.evaluate` frame that Hermes has to
 *   compile on every connect; a limit turns an accidental import of something large into a loud
 *   failure instead of a slow handshake.
 * - **`async`, `await` or `??` in a function body.** Nothing lowers them any more, so these are a
 *   hard ban rather than an expectation. Optional chaining, spread, `for...of`, `class` and
 *   template literals stay allowed: the reference's own packaged artefact
 *   (`dist/app-flow/runtime.json`) ships all five to the same Hermes debugger evaluator, through
 *   the same `Runtime.evaluate` call with the same parameters, and its packaged validity check
 *   performs no syntax scan at all.
 *
 * It cannot prove the source is *correct*, and being textual it cannot tell a comment from code, so
 * an in-body comment spelling out a banned token is a false positive (and the fix is to reword the
 * comment — note that comments now survive into the injected text, where before the transform
 * stripped them). For free references to module-scope names, the test suite compiles and evaluates
 * the assembled source in an empty `node:vm` context and calls every agent function there, so
 * a reference to something that only exists in this module surfaces as a `ReferenceError` in the
 * test run rather than against a device.
 */
import { AGENT_FUNCTIONS } from './agent-runtime.ts'

/** The number of functions the agent is made of. Changing the registry means changing this. */
export const EXPECTED_AGENT_FUNCTION_COUNT = 50
/**
 * Upper bound on the assembled source. This is a tripwire for an accidental large import, not a
 * byte budget: the agent is meant to grow. Measured after the presentation runtime landed and the
 * esbuild pass was removed: the agent is ~85KB, about 33% of this limit, leaving ~170KB of
 * headroom. (It was 75,352 bytes while esbuild still stripped comments on the way out, and 34,026
 * before the presentation runtime landed.) The reference's own packaged validity check uses
 * 500,000 characters per function for the same "catch an accident" purpose.
 */
export const MAX_AGENT_SOURCE_BYTES = 256 * 1024

/**
 * Each pattern names a construct that must not appear in an agent function. These are exactly the
 * ones the reference lowers for the debugger evaluator; here nothing lowers them, so a match means
 * the author wrote something the Hermes debugger evaluator should not be asked to take.
 */
const BANNED_SYNTAX: ReadonlyArray<readonly [string, RegExp]> = [
  ['async function', /\basync\b/],
  ['await', /\bawait\b/],
  ['nullish coalescing', /\?\?/]
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
        `agent source contains ${label}, near "${source.slice(Math.max(0, hit.index - 20), hit.index + 30).replace(/\s+/g, ' ')}"; the Hermes debugger evaluator runs this text as written, so write the ES2015-or-below form instead`
      )
    }
  }
}

/**
 * Takes one agent function's own source and asserts it is still a top-level
 * `function agentX(...)` declaration, which is what lets it survive hoisting into the shared
 * closure and keeps the name check meaningful. A bundler that rewrote the declaration into an
 * assignment would otherwise only fail against a live device, on first call.
 */
function checkDeclaration(name: string, text: string): string {
  const code = text.trim()
  if (!new RegExp(`(^|[^\\w$])function\\s+${name}\\s*\\(`).test(code)) {
    throw new AgentSourceError(
      `agent function "${name}" is not a top-level declaration; injected functions call each other by name`
    )
  }
  return code
}

/**
 * The source of an expression that evaluates to the install function. Calling the result with
 * `(key, leaseMs, limits)` installs the agent; every helper lives in the closure that expression
 * creates, so nothing is added to the app's global scope but the one key.
 *
 * Each function is emitted as a declaration (`fn.toString()` already is one, and `checkDeclaration`
 * asserts it stayed one), so they are hoisted and may be listed in any order.
 */
export function buildAgentSource(functions: AgentFunctionMap = AGENT_FUNCTIONS): string {
  const declarations = Object.entries(functions)
    .map(([name, fn]) => checkDeclaration(name, fn.toString()))
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
