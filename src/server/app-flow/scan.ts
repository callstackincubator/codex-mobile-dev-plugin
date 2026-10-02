import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { createHash } from "node:crypto";
import ts from "typescript";
import type { FlowGraph, FlowNode, FlowParams } from "../../shared/app-flow.ts";
import { missingFlowParams } from "../../shared/app-flow.ts";

const ignored = new Set(["node_modules", ".git", ".expo", ".next", "dist", "build", "ios", "android", "vendor", "coverage", "__tests__", "__mocks__"]);
const extensions = [".tsx", ".ts", ".jsx", ".js"];
const id = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 20);
type Screen = { name: string; component?: string; params?: FlowParams; file: string; line: number };
type Group = { key: string; name: string; file: string; screens: Screen[]; helpers: string[] };
type Unit = { file: string; ast: ts.SourceFile; imports: Map<string, { module: string; name: string }>; constants: Map<string, ts.Expression> };

function unwrap(node: ts.Node): ts.Node {
  while (ts.isAsExpression(node) || ts.isParenthesizedExpression(node) || ts.isSatisfiesExpression(node) || ts.isTypeAssertionExpression(node)) node = node.expression;
  return node;
}
function literal(node: ts.Node | undefined, constants: Unit["constants"], depth = 0): unknown {
  if (!node || depth > 8) return undefined;
  node = unwrap(node);
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isIdentifier(node)) return literal(constants.get(node.text), constants, depth + 1);
  if (ts.isArrayLiteralExpression(node)) {
    const values = node.elements.map(item => literal(item, constants, depth + 1));
    return values.every(value => value !== undefined) ? values : undefined;
  }
  if (ts.isObjectLiteralExpression(node)) {
    const result: FlowParams = {};
    for (const prop of node.properties) {
      if (!ts.isPropertyAssignment(prop) || !prop.name || ts.isComputedPropertyName(prop.name)) continue;
      const key = prop.name.getText().replace(/^['"]|['"]$/g, "");
      if (/token|password|secret|authorization|cookie|^(__proto__|constructor|prototype)$/i.test(key)) continue;
      const value = literal(prop.initializer, constants, depth + 1);
      if (value !== undefined) result[key] = value;
    }
    return result;
  }
  if (ts.isPropertyAccessExpression(node)) {
    const value = literal(node.expression, constants, depth + 1);
    return value && typeof value === "object" ? (value as FlowParams)[node.name.text] : undefined;
  }
  return undefined;
}
const propName = (node: ts.PropertyName) => ts.isIdentifier(node) || ts.isStringLiteralLike(node) ? node.text : undefined;
const attr = (node: ts.JsxOpeningLikeElement, name: string) => {
  const attribute = node.attributes.properties.find(item => ts.isJsxAttribute(item) && item.name.getText() === name);
  if (!attribute || !ts.isJsxAttribute(attribute)) return undefined;
  return attribute.initializer && ts.isJsxExpression(attribute.initializer) ? attribute.initializer.expression : attribute.initializer;
};

/** Parse source only. Never import or evaluate a project's code or configuration. */
export async function scanAppFlow(projectRoot: string, platform: "ios" | "android", signal?: AbortSignal): Promise<FlowGraph> {
  const started = performance.now();
  const root = await realpath(projectRoot);
  if (!(await stat(root)).isDirectory()) throw new Error("Choose the app's project folder.");
  const files: string[] = [], warnings: string[] = [];
  async function walk(directory: string, depth = 0) {
    signal?.throwIfAborted();
    if (depth > 18 || files.length >= 4000) return;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (files.length >= 4000) break;
      if (entry.isSymbolicLink() || entry.name.startsWith(".") || ignored.has(entry.name)) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path, depth + 1);
      else if (/\.[jt]sx?$/.test(entry.name) && !/\.(test|spec|d)\.[jt]sx?$/.test(entry.name)
        && !entry.name.includes(".web.") && !entry.name.includes(platform === "ios" ? ".android." : ".ios.")) files.push(path);
    }
  }
  await walk(root);
  if (files.length >= 4000) warnings.push("Discovery reached the 4,000-file limit. Some routes may be missing.");
  const units = new Map<string, Unit>();
  let bytes = 0;
  for (let offset = 0; offset < files.length; offset += 16) {
    signal?.throwIfAborted();
    const batch = await Promise.all(files.slice(offset, offset + 16).map(async file => {
      if ((await stat(file)).size > 512_000) { warnings.push(`Skipped large source file: ${relative(root, file)}`); return; }
      return { file, text: await readFile(file, { encoding: "utf8", signal }) };
    }));
    for (const item of batch) {
      if (!item) continue;
      bytes += item.text.length;
      if (bytes > 40_000_000) { warnings.push("Discovery reached its source-size limit."); break; }
      const ast = ts.createSourceFile(item.file, item.text, ts.ScriptTarget.Latest, true, /x$/.test(item.file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
      const unit: Unit = { file: item.file, ast, imports: new Map(), constants: new Map() };
      const collect = (node: ts.Node) => {
        if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
          const module = node.moduleSpecifier.text, clause = node.importClause;
          if (clause?.name) unit.imports.set(clause.name.text, { module, name: "default" });
          if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) for (const imp of clause.namedBindings.elements) unit.imports.set(imp.name.text, { module, name: imp.propertyName?.text ?? imp.name.text });
        }
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) unit.constants.set(node.name.text, node.initializer);
        ts.forEachChild(node, collect);
      };
      collect(ast); units.set(item.file, unit);
    }
    if (bytes > 40_000_000) break;
    await new Promise<void>(done => setImmediate(done));
  }
  const paths: Record<string, string[]> = {};
  try {
    const config = ts.parseConfigFileTextToJson("tsconfig.json", await readFile(join(root, "tsconfig.json"), "utf8"));
    Object.assign(paths, config.config?.compilerOptions?.paths ?? {});
  } catch { /* Alias inference also covers common src aliases. */ }
  function symbol(unit: Unit, name: string): string {
    const imp = unit.imports.get(name);
    if (!imp) return `${unit.file}#${name}`;
    const bases = imp.module.startsWith(".") ? [resolve(dirname(unit.file), imp.module)] : Object.entries(paths).flatMap(([key, values]) => {
      const prefix = key.replace(/\*$/, "");
      return imp.module.startsWith(prefix) && Array.isArray(values) ? values.map(value => resolve(root, value.replace("*", imp.module.slice(prefix.length)))) : [];
    });
    if (/^[#@~]\//.test(imp.module)) bases.push(resolve(root, "src", imp.module.slice(2)), resolve(root, imp.module.slice(2)));
    for (const base of bases) for (const ext of extensions) for (const file of [`${base}.${platform}${ext}`, `${base}.native${ext}`, `${base}${ext}`, join(base, `index${ext}`)]) {
      if (units.has(file)) return `${file}#${imp.name}`;
    }
    return `${imp.module}#${imp.name}`;
  }
  const types = new Map<string, ts.TypeNode>(), requirements = new Map<string, string[]>();
  for (const unit of units.values()) {
    const visit = (node: ts.Node) => { if (ts.isTypeAliasDeclaration(node)) types.set(node.name.text, node.type); if (ts.isInterfaceDeclaration(node)) types.set(node.name.text, ts.factory.createTypeLiteralNode(node.members)); ts.forEachChild(node, visit); };
    visit(unit.ast);
  }
  function required(type: ts.TypeNode, seen = new Set<string>()): string[] {
    if (type.kind === ts.SyntaxKind.UndefinedKeyword) return [];
    if (ts.isUnionTypeNode(type)) {
      if (type.types.some(item => item.kind === ts.SyntaxKind.UndefinedKeyword)) return [];
      return [...new Set(type.types.flatMap(item => required(item, new Set(seen))))];
    }
    if (ts.isIntersectionTypeNode(type)) return [...new Set(type.types.flatMap(item => required(item, new Set(seen))))];
    if (ts.isTypeLiteralNode(type)) return type.members.flatMap(member => ts.isPropertySignature(member) && !member.questionToken && propName(member.name) ? [propName(member.name)!] : []);
    if (ts.isTypeReferenceNode(type)) {
      const name = type.typeName.getText();
      if (!seen.has(name) && types.has(name)) { seen.add(name); return required(types.get(name)!, seen); }
      return ["$context"];
    }
    return [];
  }
  // Read param lists, not every object property in the project.
  for (const [name, type] of types) if (/Param(List|s)|NavigatorParams/.test(name)) {
    const visit = (node: ts.Node) => {
      if (ts.isPropertySignature(node) && node.type && propName(node.name)) requirements.set(propName(node.name)!, required(node.type));
      else ts.forEachChild(node, visit);
    }; visit(type);
  }
  const groups = new Map<string, Group>();
  const links: { owner: string; target: string; params?: FlowParams }[] = [];
  for (const unit of units.values()) {
    signal?.throwIfAborted();
    function visit(node: ts.Node, owner = `${unit.file}#default`) {
      if (ts.isFunctionDeclaration(node) && node.name) owner = `${unit.file}#${node.modifiers?.some(mod => mod.kind === ts.SyntaxKind.DefaultKeyword) ? "default" : node.name.text}`;
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) owner = `${unit.file}#${node.name.text}`;
      const group = () => { let value = groups.get(owner); if (!value) { value = { key: owner, name: owner.split("#").at(-1)!, file: unit.file, screens: [], helpers: [] }; groups.set(owner, value); } return value; };
      if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
        if (/\.Screen$/.test(node.tagName.getText())) {
          const name = literal(attr(node, "name"), unit.constants);
          if (typeof name === "string") {
            let component = attr(node, "component") ?? attr(node, "getComponent");
            if (component) component = unwrap(component) as ts.Expression;
            if (component && ts.isArrowFunction(component)) component = component.body as ts.Expression;
            const ref = component && ts.isIdentifier(component) ? symbol(unit, component.text) : undefined;
            const params = literal(attr(node, "initialParams"), unit.constants);
            group().screens.push({ name, component: ref, file: relative(root, unit.file), line: unit.ast.getLineAndCharacterOfPosition(node.getStart()).line + 1,
              ...(params && typeof params === "object" && !Array.isArray(params) ? { params: params as FlowParams } : {}) });
          } else if (attr(node, "name")) warnings.push(`Unresolved screen name in ${relative(root, unit.file)}.`);
        }
      }
      if (ts.isCallExpression(node)) {
        if (ts.isIdentifier(node.expression)) group().helpers.push(symbol(unit, node.expression.text));
        const method = ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : ts.isIdentifier(node.expression) ? node.expression.text : "";
        if (["navigate", "push", "replace"].includes(method)) {
          const target = literal(node.arguments[0], unit.constants), params = literal(node.arguments[1], unit.constants);
          if (typeof target === "string") links.push({ owner, target, ...(params && typeof params === "object" && !Array.isArray(params) ? { params: params as FlowParams } : {}) });
        }
      }
      ts.forEachChild(node, child => visit(child, owner));
    }
    visit(unit.ast);
    const staticConfig = (node: ts.Node) => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isCallExpression(node.initializer)) {
        const call = node.initializer;
        const creator = ts.isIdentifier(call.expression) ? unit.imports.get(call.expression.text)?.name ?? call.expression.text : call.expression.getText();
        if (/create.*Navigator$/.test(creator) && call.arguments[0] && ts.isObjectLiteralExpression(call.arguments[0])) {
          const key = `${unit.file}#${node.name.text}`;
          const group: Group = { key, name: node.name.text, file: unit.file, screens: [], helpers: [] };
          const property = (object: ts.ObjectLiteralExpression, name: string) => object.properties.find(item => ts.isPropertyAssignment(item) && propName(item.name) === name) as ts.PropertyAssignment | undefined;
          const collect = (config: ts.ObjectLiteralExpression) => {
            const declarations = property(config, "screens")?.initializer;
            if (declarations && ts.isObjectLiteralExpression(declarations)) for (const declaration of declarations.properties) {
              if (!ts.isPropertyAssignment(declaration) && !ts.isShorthandPropertyAssignment(declaration)) continue;
              const name = propName(declaration.name); if (!name) continue;
              let value = ts.isShorthandPropertyAssignment(declaration) ? declaration.name : declaration.initializer;
              const options = ts.isObjectLiteralExpression(value) ? value : undefined;
              if (options) value = property(options, "screen")?.initializer ?? value;
              const params = options ? literal(property(options, "initialParams")?.initializer, unit.constants) : undefined;
              group.screens.push({ name, component: ts.isIdentifier(value) ? symbol(unit, value.text) : undefined, file: relative(root, unit.file), line: unit.ast.getLineAndCharacterOfPosition(declaration.getStart()).line + 1,
                ...(params && typeof params === "object" && !Array.isArray(params) ? { params: params as FlowParams } : {}) });
            }
            const nested = property(config, "groups")?.initializer;
            if (nested && ts.isObjectLiteralExpression(nested)) for (const prop of nested.properties) if (ts.isPropertyAssignment(prop) && ts.isObjectLiteralExpression(prop.initializer)) collect(prop.initializer);
          };
          collect(call.arguments[0]); if (group.screens.length) groups.set(key, group);
        }
      }
      ts.forEachChild(node, staticConfig);
    };
    staticConfig(unit.ast);
  }
  function screens(key: string, seen = new Set<string>()): Screen[] {
    if (seen.has(key)) return []; seen.add(key);
    const group = groups.get(key);
    if (!group) return [];
    return [...group.screens, ...group.helpers.flatMap(helper => screens(helper, seen))];
  }
  const templates = new Map([...groups].filter(([, group]) => group.screens.length));
  const helperKeys = new Set([...groups.values()].flatMap(group => group.helpers.filter(key => templates.has(key))));
  const componentKeys = new Set([...templates.values()].flatMap(group => group.screens.flatMap(screen => screen.component ? [screen.component] : [])));
  const graph: FlowGraph = { nodes: [], edges: [], warnings, files: units.size, scanMs: 0 };
  function expand(key: string, path: string[], parent: string | undefined, seen: Set<string>) {
    if (seen.has(key) || path.length > 12 || graph.nodes.length >= 1500) return;
    seen = new Set(seen).add(key);
    const names = new Set<string>();
    for (const screen of screens(key)) {
      if (names.has(screen.name)) continue; names.add(screen.name);
      const next = [...path, screen.name], nodeId = id(`${key}:${next.join("/")}`);
      const nested = screen.component && screens(screen.component).length > 0;
      const candidate = links.find(link => link.target === screen.name && link.params)?.params;
      const node: FlowNode = { id: nodeId, name: screen.name, kind: nested ? "navigator" : "screen", component: screen.component?.split("#").at(-1), definition: screen.component ? relative(root, screen.component) : undefined, file: screen.file, line: screen.line,
        path: next, required: requirements.get(screen.name) ?? [], params: screen.params ?? candidate, status: "pending" };
      if (missingFlowParams(node).length) node.status = "needs-data";
      graph.nodes.push(node);
      if (parent) graph.edges.push({ from: parent, to: nodeId, kind: "contains" });
      if (nested) expand(screen.component!, next, nodeId, seen);
    }
  }
  for (const [key, group] of templates) if (!helperKeys.has(key) && !componentKeys.has(key)) {
    const rootId = id(key);
    graph.nodes.push({ id: rootId, name: group.name === "default" ? relative(root, group.file).replace(/\.[^.]+$/, "") : group.name, kind: "navigator", file: relative(root, group.file), path: [], required: [], status: "pending" });
    expand(key, [], rootId, new Set());
  }
  // Expo Router files are routes even when no explicit Screen declaration exists.
  const routeRoot = [join(root, "src/app"), join(root, "app")].find(base => [...units.keys()].some(file => file.startsWith(`${base}/`) && /\/_layout\.[jt]sx?$/.test(file)));
  if (routeRoot) {
    const layouts = new Map<string, string>();
    const ensureLayout = (directory: string): string => {
      if (layouts.has(directory)) return layouts.get(directory)!;
      const nodeId = id(`expo:${directory}`); layouts.set(directory, nodeId);
      graph.nodes.push({ id: nodeId, name: directory || "App", kind: "navigator", path: [], required: [], status: "pending" });
      if (directory) { const parent = directory.includes("/") ? directory.slice(0, directory.lastIndexOf("/")) : ""; graph.edges.push({ from: ensureLayout(parent), to: nodeId, kind: "contains" }); }
      return nodeId;
    };
    for (const file of units.keys()) {
      if (!file.startsWith(`${routeRoot}/`)) continue;
      const name = relative(routeRoot, file).replace(/(?:\.(ios|android|native))?\.[jt]sx?$/, "");
      if (/(^|\/)(_|\+)|\+api$/.test(name)) continue;
      const directory = name.includes("/") ? name.slice(0, name.lastIndexOf("/")) : "";
      const route = `/${name.replace(/(^|\/)index$/, "").replace(/\/$/, "")}`;
      const nodeId = id(`expo:${name}`);
      if (graph.nodes.some(node => node.id === nodeId)) continue;
      const required = [...name.matchAll(/\[(?:\.\.\.)?([^\]]+)\]/g)].map(match => match[1]);
      graph.nodes.push({ id: nodeId, name: route, component: "expo-router", file: relative(root, file), line: 1, path: [route], required, status: required.length ? "needs-data" : "pending" });
      graph.edges.push({ from: ensureLayout(directory), to: nodeId, kind: "contains" });
    }
  }
  for (const link of links) {
    const sources = graph.nodes.filter(node => node.definition === relative(root, link.owner));
    const targets = graph.nodes.filter(node => node.name === link.target);
    for (const from of sources) for (const to of targets) if (from.id !== to.id && graph.edges.length < 5000) graph.edges.push({ from: from.id, to: to.id, kind: "navigation" });
  }
  if (!graph.nodes.length) warnings.push("No supported route declarations found. Runtime discovery may still find mounted navigators.");
  if (graph.nodes.length >= 1500) warnings.push("Discovery reached the 1,500-node limit.");
  graph.warnings = [...new Set(warnings)].slice(0, 40);
  graph.scanMs = performance.now() - started;
  return graph;
}
