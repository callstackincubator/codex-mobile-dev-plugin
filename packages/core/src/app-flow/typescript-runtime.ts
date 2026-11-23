import { createRequire } from 'node:module'
import { join } from 'node:path'
import { ExpectedOperationError } from '@mobile-dev/shared/error-reporting.ts'

/**
 * The TypeScript compiler, resolved from the project being parsed rather than bundled.
 *
 * `typescript.js` is a single ~9.9 MB module, so bundling it put the server's largest chunk
 * over Claude's 5 MiB per-file plugin limit, and esbuild's `splitting` cannot break up one
 * module. Every project app-flow parses already carries its own copy, so the bundle asks for
 * that one instead. `tooling/server-bundle.mjs` aliases the bare `typescript` specifier to
 * this module, which leaves the five app-flow sources importing `typescript` untouched and
 * keeps `tsc` resolving the real declarations.
 *
 * Resolution is deferred to first property access because the project directory arrives with
 * each tool call, never at startup.
 */
type TypeScriptModule = typeof import('typescript')

let loaded: TypeScriptModule | undefined
let projectRoot: string | undefined

/**
 * Points later resolution at `root`. Called by every entry point that parses sources, before
 * it touches the compiler. A copy already resolved is kept: the parser API this uses is stable
 * across TypeScript 5.x, so a second project in the same process need not reload it.
 */
export function setTypeScriptProject(root: string): void {
  projectRoot = root
}

/** Forgets the resolved compiler and project. Tests use it to isolate resolution. */
export function resetTypeScriptRuntime(): void {
  loaded = undefined
  projectRoot = undefined
}

function resolveFrom(base: string): TypeScriptModule | undefined {
  try {
    const require = createRequire(base)
    return require(require.resolve('typescript')) as TypeScriptModule
  } catch {
    return undefined
  }
}

/**
 * Finds the compiler for `projectRoot`, falling back to whatever `fallbackFrom` can see.
 * Exported so the failure path stays testable: in this repository the fallback always
 * succeeds, so only an explicit base without a compiler can reach the error.
 */
export function resolveTypeScript(projectRoot: string | undefined, fallbackFrom: string): TypeScriptModule {
  // The project's own copy is the shipped path: the bundle no longer carries one.
  const fromProject = projectRoot ? resolveFrom(join(projectRoot, 'package.json')) : undefined
  // Running from source — tests and `npm run dev` — falls back to the repository's copy, which
  // is also what a project with a hoisted monorepo layout resolves to.
  const compiler = fromProject ?? resolveFrom(fallbackFrom)
  if (!compiler)
    throw new ExpectedOperationError(
      'invalid_input',
      projectRoot
        ? `App flow reads your screens with the TypeScript compiler, and ${projectRoot} has no copy installed. Run npm install --save-dev typescript there and try again.`
        : 'App flow reads your screens with the TypeScript compiler, but no project has been selected yet.'
    )
  return compiler
}

function load(): TypeScriptModule {
  if (loaded) return loaded
  loaded = resolveTypeScript(projectRoot, import.meta.url)
  return loaded
}

/**
 * Stands in for the compiler namespace. Each trap resolves on demand, so importing this module
 * costs nothing until a parse actually runs.
 */
const typescriptRuntime = new Proxy(Object.create(null) as TypeScriptModule, {
  get: (_target, property) => Reflect.get(load(), property),
  has: (_target, property) => Reflect.has(load(), property),
  ownKeys: () => Reflect.ownKeys(load()),
  getOwnPropertyDescriptor: (_target, property) => {
    const descriptor = Reflect.getOwnPropertyDescriptor(load(), property)
    // A Proxy may only report a property as configurable when its target agrees, and the
    // target here is empty.
    return descriptor ? { ...descriptor, configurable: true } : undefined
  }
})

export default typescriptRuntime
