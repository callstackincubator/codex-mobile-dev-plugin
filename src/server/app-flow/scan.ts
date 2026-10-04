import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { createHash } from "node:crypto";
import ts from "typescript";
import type { FlowGraph, FlowNode, FlowParams } from "../../shared/app-flow.ts";
import { missingFlowParams } from "../../shared/app-flow.ts";
import { sourceLinkMatches, sourceLinkReader } from "./source-links.ts";
import { scanPresentations } from './presentations-source.ts';
import { scanSourceViews } from './views-source.ts';

const ignored = new Set(["node_modules", ".git", ".expo", ".next", "dist", "build", "ios", "android", "vendor", "coverage", "__tests__", "__mocks__"]);
const extensions = [".tsx", ".ts", ".jsx", ".js"];
const id = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 20);
type Screen = { name: string; component?: string; params?: FlowParams; file: string; line: number };
type Group = { key: string; name: string; file: string; screens: Screen[]; helpers: string[]; initial?: string; tabs?: boolean };
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
      else if (/\.[jt]sx?$/.test(entry.name) && !/\.(test|spec|e2e|stories|d)\.[jt]sx?$/.test(entry.name)
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
          if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings)) unit.imports.set(clause.namedBindings.name.text, { module, name: "*" });
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
  function moduleFile(unit: Unit, module: string): string | undefined {
    const bases = module.startsWith(".") ? [resolve(dirname(unit.file), module)] : Object.entries(paths).flatMap(([key, values]) => {
      const prefix = key.replace(/\*$/, "");
      return module.startsWith(prefix) && Array.isArray(values) ? values.map(value => resolve(root, value.replace("*", module.slice(prefix.length)))) : [];
    });
    if (/^[#@~]\//.test(module)) bases.push(resolve(root, "src", module.slice(2)), resolve(root, module.slice(2)));
    for (const base of bases) {
      if (units.has(base)) return base;
      for (const stem of [base, join(base, 'index')]) for (const suffix of [`.${platform}`, '.native', '']) for (const ext of extensions) {
        if (units.has(`${stem}${suffix}${ext}`)) return `${stem}${suffix}${ext}`;
      }
    }
  }
  const symbolCache = new Map<string, string>();
  function symbol(unit: Unit, name: string, seen = new Set<string>()): string {
    const key = `${unit.file}#${name}`;
    if (seen.has(key)) return key;
    if (symbolCache.has(key)) return symbolCache.get(key)!;
    seen = new Set(seen).add(key);
    const [head, member] = name.split('.'), imp = unit.imports.get(head);
    const follow = (module: string, exported: string) => {
      const file = moduleFile(unit, module);
      return file ? symbol(units.get(file)!, exported, seen) : `${module}#${exported}`;
    };
    let result = key;
    if (imp) result = follow(imp.module, imp.name === '*' && member ? member : imp.name);
    else {
      const declaration = unit.constants.get(name);
      if (declaration && ts.isCallExpression(declaration) && /(?:^|\.)lazy$/.test(declaration.expression.getText())) {
        const callback = declaration.arguments[0];
        if (callback && ts.isArrowFunction(callback) && ts.isCallExpression(callback.body) && callback.body.expression.kind === ts.SyntaxKind.ImportKeyword && callback.body.arguments[0] && ts.isStringLiteral(callback.body.arguments[0])) result = follow(callback.body.arguments[0].text, 'default');
      }
      for (const statement of unit.ast.statements) {
        if (!ts.isExportDeclaration(statement)) continue;
        if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
          const exported = statement.exportClause.elements.find(item => item.name.text === name);
          if (exported) { const local = exported.propertyName?.text ?? name; result = statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier) ? follow(statement.moduleSpecifier.text, local) : symbol(unit, local, seen); break; }
        }
      }
    }
    symbolCache.set(key, result); return result;
  }
  const readLinks = sourceLinkReader(units, (unit, name) => symbol(units.get(unit.file)!, name));
  const types = new Map<string, ts.TypeNode>(), requirements = new Map<string, string[]>();
  const variants = new Map<string, NonNullable<FlowNode["paramVariants"]>>();
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
  function alternatives(type: ts.TypeNode, seen = new Set<string>()): NonNullable<FlowNode["paramVariants"]> {
    if (ts.isParenthesizedTypeNode(type)) return alternatives(type.type, seen);
    if (ts.isTypeReferenceNode(type) && types.has(type.typeName.getText()) && !seen.has(type.typeName.getText())) {
      return alternatives(types.get(type.typeName.getText())!, new Set(seen).add(type.typeName.getText()));
    }
    if (ts.isUnionTypeNode(type)) return type.types.flatMap(item => alternatives(item, new Set(seen))).slice(0, 32);
    if (ts.isIntersectionTypeNode(type)) return type.types.reduce((rows, item) => rows.flatMap(a => alternatives(item, new Set(seen)).map(b => ({ required: [...new Set([...a.required, ...b.required])], literals: { ...a.literals, ...b.literals } }))).slice(0, 32), [{ required: [] as string[], literals: {} as FlowParams }]);
    const literals: FlowParams = {};
    if (ts.isTypeLiteralNode(type)) for (const member of type.members) {
      if (ts.isPropertySignature(member) && !member.questionToken && member.type && ts.isLiteralTypeNode(member.type) && propName(member.name)) {
        const value = literal(member.type.literal, new Map());
        if (value !== undefined) literals[propName(member.name)!] = value;
      }
    }
    return [{ required: required(type), literals }];
  }
  // Read param lists, not every object property in the project.
  for (const [name, type] of types) if (/Param(List|s)|NavigatorParams/.test(name)) {
    const visit = (node: ts.Node) => {
      if (ts.isPropertySignature(node) && node.type && propName(node.name)) {
        requirements.set(propName(node.name)!, required(node.type));
        const options = alternatives(node.type);
        if (options.length > 1) variants.set(propName(node.name)!, options);
      }
      else ts.forEachChild(node, visit);
    }; visit(type);
  }
  const groups = new Map<string, Group>();
  const dependencies = new Map<string, Set<string>>();
  const links: { owner: string; target: string; params?: FlowParams; via: "link" | "call"; guarded: boolean; file: string; line: number }[] = [];
  const urls = new Map<string, string[]>();
  for (const unit of units.values()) {
    signal?.throwIfAborted();
    const branchTarget = (node: ts.Node | undefined): string | undefined => {
      if (!node) return;
      if (ts.isBlock(node)) return node.statements.length === 1 ? branchTarget(node.statements[0]) : undefined;
      if (ts.isExpressionStatement(node)) return branchTarget(node.expression);
      if (!ts.isCallExpression(node)) return;
      const method = ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : '';
      if (!['navigate', 'push', 'replace'].includes(method)) return;
      const target = literal(node.arguments[0], unit.constants);
      return typeof target === 'string' ? target : undefined;
    };
    function visit(node: ts.Node, owner = `${unit.file}#default`, inFunction = false, guarded = false) {
      if (!inFunction && ts.isFunctionDeclaration(node) && node.name) owner = `${unit.file}#${node.modifiers?.some(mod => mod.kind === ts.SyntaxKind.DefaultKeyword) ? "default" : node.name.text}`;
      if (!inFunction && ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer) || ts.isCallExpression(node.initializer) && node.initializer.arguments.some(arg => ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)))) owner = `${unit.file}#${node.name.text}`;
      const group = () => { let value = groups.get(owner); if (!value) { value = { key: owner, name: owner.split("#").at(-1)!, file: unit.file, screens: [], helpers: [] }; groups.set(owner, value); } return value; };
      const depend = (name: string) => {
        const list = dependencies.get(owner) ?? new Set<string>(); list.add(symbol(unit, name)); dependencies.set(owner, list);
      };
      const link = (target: unknown, params: unknown, via: "link" | "call") => {
        if (target && typeof target === "object") {
          const value = target as FlowParams; params = value.params; target = value.screen ?? value.name ?? value.pathname;
        }
        if (typeof target === "string" && !/^[a-z]+:/i.test(target)) links.push({ owner, target, via, guarded, file: relative(root, unit.file), line: unit.ast.getLineAndCharacterOfPosition(node.getStart()).line + 1,
          ...(params && typeof params === "object" && !Array.isArray(params) ? { params: params as FlowParams } : {}) });
      };
      if (ts.isPropertyAssignment(node) && propName(node.name)) {
        let value = literal(node.initializer, unit.constants);
        if (value && typeof value === "object" && !Array.isArray(value)) value = (value as FlowParams).path;
        const paths = (Array.isArray(value) ? value : [value]).filter((path): path is string => typeof path === "string" && !/^[a-z]+:/i.test(path));
        if (paths.length) urls.set(propName(node.name)!, paths.map(path => `/${path.replace(/^\//, "")}`));
      }
      if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
        const tag = node.tagName.getText();
        if (!/\.(Screen|Navigator|Group)$/.test(tag)) depend(tag);
        if (/\.Navigator$/.test(tag)) {
          const value = literal(attr(node, "initialRouteName"), unit.constants);
          if (typeof value === "string") group().initial = value;
          const creator = unit.constants.get(tag.split(".")[0])?.getText() ?? tag;
          group().tabs = /create\w*(Tab|Drawer)\w*Navigator/.test(creator.split("<")[0].split("(")[0]);
        }
        for (const name of ["href", "to"]) {
          const expression = attr(node, name);
          const value = literal(expression, unit.constants);
          const params = value && typeof value === 'object' && !Array.isArray(value) ? (value as FlowParams).params : undefined;
          for (const target of expression ? readLinks(unit, expression) : []) link(target, params, "link");
        }
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
        if (ts.isIdentifier(node.expression)) { group().helpers.push(symbol(unit, node.expression.text)); depend(node.expression.text); }
        const method = ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : ts.isIdentifier(node.expression) ? node.expression.text : "";
        if (["navigate", "push", "replace"].includes(method)) {
          const target = literal(node.arguments[0], unit.constants), params = literal(node.arguments[1], unit.constants);
          link(target, params, "call");
        }
      }
      ts.forEachChild(node, child => visit(child, owner, inFunction || ts.isFunctionLike(node), guarded ||
        ts.isConditionalExpression(node) && child !== node.condition ||
        ts.isIfStatement(node) && child !== node.expression && !(branchTarget(node.thenStatement) && branchTarget(node.thenStatement) === branchTarget(node.elseStatement)) ||
        ts.isBinaryExpression(node) && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken].includes(node.operatorToken.kind) && child === node.right));
    }
    visit(unit.ast);
    const staticConfig = (node: ts.Node) => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isCallExpression(node.initializer)) {
        const call = node.initializer;
        const creator = ts.isIdentifier(call.expression) ? unit.imports.get(call.expression.text)?.name ?? call.expression.text : call.expression.getText();
        if (/create.*Navigator$/.test(creator) && call.arguments[0] && ts.isObjectLiteralExpression(call.arguments[0])) {
          const key = `${unit.file}#${node.name.text}`;
          const group: Group = { key, name: node.name.text, file: unit.file, screens: [], helpers: [], tabs: /Tab|Drawer/.test(creator) };
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
          const initial = literal(property(call.arguments[0], "initialRouteName")?.initializer, unit.constants); if (typeof initial === "string") group.initial = initial;
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
  // Cache only complete expansions. Recursive calls share `seen`, so caching a
  // partial expansion would change the result for cyclic or shared helpers.
  const screenCache = new Map<string, Screen[]>();
  const groupScreens = (key: string) => {
    let value = screenCache.get(key);
    if (!value) { value = screens(key); screenCache.set(key, value); }
    return value;
  };
  const templates = new Map([...groups].filter(([, group]) => group.screens.length));
  const helperKeys = new Set([...groups.values()].flatMap(group => group.helpers.filter(key => templates.has(key))));
  const componentKeys = new Set([...templates.values()].flatMap(group => group.screens.flatMap(screen => screen.component ? [screen.component] : [])));
  const graph: FlowGraph = { nodes: [], edges: [], warnings, files: units.size, scanMs: 0 };
  function expand(key: string, path: string[], parent: string | undefined, seen: Set<string>, entry = true) {
    if (seen.has(key) || path.length > 12 || graph.nodes.length >= 1500) return;
    seen = new Set(seen).add(key);
    const names = new Set<string>();
    for (const screen of groupScreens(key)) {
      if (names.has(screen.name)) continue; names.add(screen.name);
      const next = [...path, screen.name], nodeId = id(`${key}:${next.join("/")}`);
      const nested = screen.component && groupScreens(screen.component).length > 0;
      const candidate = links.find(link => link.target === screen.name && link.params)?.params;
      const node: FlowNode = { id: nodeId, name: screen.name, kind: nested ? "navigator" : "screen", component: screen.component?.split("#").at(-1), definition: screen.component ? relative(root, screen.component) : undefined, file: screen.file, line: screen.line,
        path: next, entry: entry && (!!groups.get(key)?.tabs || screen.name === (groups.get(key)?.initial ?? groupScreens(key)[0]?.name)), urls: urls.get(screen.name), required: requirements.get(screen.name) ?? [], params: screen.params, status: "pending" };
      node.paramVariants = variants.get(screen.name);
      // A required URL segment can distinguish edit/detail routes even when the
      // component's shared TypeScript params declare that value optional.
      const urlKeys = (node.urls ?? []).map(url => [...url.matchAll(/:([^/?]+)(?=\/|$)/g)].map(match => match[1]));
      if (urlKeys.length) {
        const common = urlKeys[0].filter(key => urlKeys.every(keys => keys.includes(key)));
        node.required = [...new Set([...node.required, ...common])];
        if (node.paramVariants) node.paramVariants = node.paramVariants.map(variant => ({ ...variant, required: [...new Set([...variant.required, ...common])] }));
      }
      if (!screen.params && candidate) node.params = Object.fromEntries(node.required.filter(name => candidate[name] !== undefined).map(name => [name, candidate[name]]));
      if (missingFlowParams(node).length) node.status = "needs-data";
      graph.nodes.push(node);
      if (parent) graph.edges.push({ from: parent, to: nodeId, kind: "contains" });
      if (nested) expand(screen.component!, next, nodeId, seen, !!node.entry);
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
      graph.nodes.push({ id: nodeId, name: route, component: "expo-router", definition: relative(root, file) + "#default", urls: [route], entry: /(^|\/)index$/.test(name), file: relative(root, file), line: 1, path: [route], required, status: required.length ? "needs-data" : "pending" });
      graph.edges.push({ from: ensureLayout(directory), to: nodeId, kind: "contains" });
    }
  }
  const definitions = new Set(graph.nodes.flatMap(node => node.definition ? [resolve(root, node.definition)] : []));
  const closure = (key: string, seen = new Set<string>()): Set<string> => {
    if (seen.has(key)) return seen;
    seen.add(key);
    for (const child of dependencies.get(key) ?? []) if (!definitions.has(child)) closure(child, seen);
    return seen;
  };
  const owned = new Set<string>();
  const edges = new Set<string>();
  const ownerCache = new Map<string, Set<string>>();
  const targetCache = new Map<string, FlowNode[]>();
  const targets = (name: string) => {
    const cached = targetCache.get(name);
    if (cached) return cached;
    let best = -1, matches: FlowNode[] = [];
    for (const target of graph.nodes) {
      let rank = -1;
      if (target.name === name) rank = 10000;
      else for (const url of target.urls ?? []) {
        if (sourceLinkMatches(url, name)) rank = Math.max(rank, url.split('/').filter(part => part && !/^[:[(]/.test(part)).length);
      }
      if (rank < 0 || rank < best) continue;
      if (rank > best) { best = rank; matches = []; }
      matches.push(target);
    }
    targetCache.set(name, matches);
    return matches;
  };
  for (const node of graph.nodes) {
    if (!node.definition) continue;
    const definition = resolve(root, node.definition);
    let owners = ownerCache.get(definition);
    if (!owners) { owners = closure(definition); ownerCache.set(definition, owners); }
    for (const owner of owners) owned.add(owner);
    for (const link of links) {
      if (!owners.has(link.owner)) continue;
      for (const target of targets(link.target)) {
        if (node.id === target.id) continue;
        const key = `${node.id}:${target.id}:${link.owner}:${link.via}:${link.guarded}`;
        if (edges.has(key)) continue; edges.add(key);
        graph.edges.push({ from: node.id, to: target.id, kind: "navigation", owner: link.owner.split("#").at(-1), via: link.via, guarded: link.guarded, file: link.file, line: link.line });
      }
    }
  }
  graph.links = links.filter(link => link.via === "call" && !owned.has(link.owner)).map(({ owner, target, params, guarded }) => ({ owner: owner.split("#").at(-1)!, target, params, guarded }));
  graph.presentations = scanPresentations(units, root, (unit, name) => symbol(units.get(unit.file)!, name));
  const catalogStarted = performance.now();
  const catalog = scanSourceViews(units, root, (unit, name) => symbol(units.get(unit.file)!, name));
  graph.catalogMs = performance.now() - catalogStarted;
  // Source-only views keep their data dependencies. Do not expose them as
  // executable transitions or infer that a container covers every inner form.
  graph.presentations.views = catalog.views;
  graph.presentations.viewStates = catalog.states;
  if (!graph.nodes.length) warnings.push("No supported route declarations found. Runtime discovery may still find mounted navigators.");
  if (graph.nodes.length >= 1500) warnings.push("Discovery reached the 1,500-node limit.");
  graph.warnings = [...new Set(warnings)].slice(0, 40);
  graph.scanMs = performance.now() - started;
  return graph;
}
