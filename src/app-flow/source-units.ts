import { dirname, join, resolve } from 'node:path'
import ts from 'typescript'

/**
 * One parsed source file, plus the two indexes the presentation scan needs to
 * follow a name out of it: its imports and its top-level `const` initializers.
 *
 * `parser.ts` models a project as route/layout records built mostly from regex
 * over file text — it has no per-file AST unit and no import-following symbol
 * resolver — so the static presentation scan carries its own, deliberately
 * minimal one here rather than widening the route parser.
 */
export interface AppFlowSourceUnit {
  file: string
  ast: ts.SourceFile
  imports: Map<string, { module: string; name: string }>
  constants: Map<string, ts.Expression>
}

const extensions = ['.tsx', '.ts', '.jsx', '.js']

/** Parse one file into a unit. `file` must be an absolute path. */
export function createSourceUnit(file: string, text: string): AppFlowSourceUnit {
  const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, /x$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const unit: AppFlowSourceUnit = { file, ast, imports: new Map(), constants: new Map() }
  const collect = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const module = node.moduleSpecifier.text, clause = node.importClause
      if (clause?.name) unit.imports.set(clause.name.text, { module, name: 'default' })
      if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) for (const entry of clause.namedBindings.elements) unit.imports.set(entry.name.text, { module, name: entry.propertyName?.text ?? entry.name.text })
      if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings)) unit.imports.set(clause.namedBindings.name.text, { module, name: '*' })
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) unit.constants.set(node.name.text, node.initializer)
    ts.forEachChild(node, collect)
  }
  collect(ast)
  return unit
}

/** Parse a set of `{file, text}` entries, keyed by absolute path. */
export function createSourceUnits(sources: { file: string; text: string }[]): Map<string, AppFlowSourceUnit> {
  const units = new Map<string, AppFlowSourceUnit>()
  for (const source of sources) units.set(source.file, createSourceUnit(source.file, source.text))
  return units
}

/** Resolves a name used in a unit to a stable `<file>#<export>` key. */
export type AppFlowSymbolResolver = (unit: AppFlowSourceUnit, name: string) => string

/**
 * Build the `symbol(unit, name)` resolver the presentation scan keys everything
 * off. A name that leaves the project keeps its bare module key — which is what
 * lets the scan match React's own hooks as `react#useState`.
 */
export function createSymbolResolver(
  units: Map<string, AppFlowSourceUnit>,
  options: { root: string; paths?: Record<string, string[]>; platform?: string } = { root: '' }
): AppFlowSymbolResolver {
  const { root, paths = {}, platform = 'ios' } = options
  function moduleFile(unit: AppFlowSourceUnit, module: string): string | undefined {
    const bases = module.startsWith('.') ? [resolve(dirname(unit.file), module)] : Object.entries(paths).flatMap(([key, values]) => {
      const prefix = key.replace(/\*$/, '')
      return module.startsWith(prefix) && Array.isArray(values) ? values.map(value => resolve(root, value.replace('*', module.slice(prefix.length)))) : []
    })
    if (/^[#@~]\//.test(module)) bases.push(resolve(root, 'src', module.slice(2)), resolve(root, module.slice(2)))
    for (const base of bases) {
      if (units.has(base)) return base
      for (const stem of [base, join(base, 'index')]) for (const suffix of [`.${platform}`, '.native', '']) for (const ext of extensions) {
        if (units.has(`${stem}${suffix}${ext}`)) return `${stem}${suffix}${ext}`
      }
    }
  }
  const cache = new Map<string, string>()
  function symbol(unit: AppFlowSourceUnit, name: string, seen = new Set<string>()): string {
    const key = `${unit.file}#${name}`
    if (seen.has(key)) return key
    if (cache.has(key)) return cache.get(key)!
    seen = new Set(seen).add(key)
    const [head, ...members] = name.split('.'), member = members.join('.'), imported = unit.imports.get(head)
    const follow = (module: string, exported: string) => {
      const file = moduleFile(unit, module)
      return file ? symbol(units.get(file)!, exported, seen) : `${module}#${exported}`
    }
    let result = key
    if (imported) result = follow(imported.module, imported.name === '*' && member ? member : [imported.name, member].filter(Boolean).join('.'))
    else for (const statement of unit.ast.statements) {
      if (!ts.isExportDeclaration(statement)) continue
      if (statement.exportClause && ts.isNamespaceExport(statement.exportClause) && statement.exportClause.name.text === head && member && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) { result = follow(statement.moduleSpecifier.text, member); break }
      if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
        const exported = statement.exportClause.elements.find(item => item.name.text === head)
        if (exported) {
          const local = [exported.propertyName?.text ?? head, member].filter(Boolean).join('.')
          result = statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier) ? follow(statement.moduleSpecifier.text, local) : symbol(unit, local, seen)
          break
        }
      }
    }
    cache.set(key, result)
    return result
  }
  return (unit, name) => symbol(units.get(unit.file) ?? unit, name)
}
