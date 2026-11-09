import { createHash, randomUUID } from "node:crypto";
import { readFile, readdir, realpath } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { parse } from "@babel/parser";
import enhancedResolve from "enhanced-resolve";
import type { AppIntelSnapshot, IntelDiagnostic, IntelEdge, IntelPlatform, IntelRef } from "@mobile-dev/shared/app-intelligence.ts";
import { fileRef, packageRef, screenRef } from "@mobile-dev/shared/app-intelligence.ts";

const ignored = new Set(["node_modules", ".git", ".expo", ".next", ".yarn", "dist", "build", "out", "coverage", "Pods", ".gradle"]);
const sourcePattern = /\.(?:[cm]?[jt]sx?)$/;
const assetPattern = /\.(?:png|jpe?g|gif|webp|svg)$/i;
const extensions = (platform: IntelPlatform) => ["js", "jsx", "json", "ts", "tsx", "mjs", "cjs", "mts", "cts"].flatMap(ext => [`.${platform}.${ext}`, `.native.${ext}`, `.${ext}`]);
const fingerprint = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const portable = (root: string, path: string) => relative(root, path).split(sep).join("/");
const inside = (root: string, path: string) => { const rel = relative(root, path); return rel !== ".." && !rel.startsWith(`..${sep}`) && !rel.startsWith("/"); };
const packageName = (specifier: string) => specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0];

type Registration = { name: string; local?: string; specifier?: string };
type ParsedSource = { path: string; code: string; imports: Array<{ specifier: string; typeOnly: boolean; dynamic: boolean; local?: string }>; navigation: string[]; registrations: Registration[]; declared: Set<string> };

function walkAst(node: unknown, visit: (node: Record<string, any>) => void) {
  if (!node || typeof node !== "object") return;
  const record = node as Record<string, any>;
  if (typeof record.type === "string") visit(record);
  for (const [key, child] of Object.entries(record)) {
    if (key === "loc" || key === "start" || key === "end" || key === "extra") continue;
    if (Array.isArray(child)) for (const item of child) walkAst(item, visit);
    else if (child && typeof child === "object") walkAst(child, visit);
  }
}

const isModuleCall = (node: Record<string, any>) =>
  (node.type === "CallExpression" || node.type === "OptionalCallExpression") &&
  node.arguments?.[0]?.type === "StringLiteral" &&
  (node.callee?.type === "Import" || node.callee?.name === "require");

/**
 * The component a `<Stack.Screen>` renders, however it was written: `component={Screen}`,
 * `getComponent={() => Screen}`, `component={lazy(() => import('…'))}` and
 * `getComponent={() => require('…').Screen}` all name the same file. A specifier beats a local
 * name because `require('…').Screen` carries both and only the specifier names the module.
 */
function componentRef(expression: unknown): Pick<Registration, "local" | "specifier"> {
  let local: string | undefined, specifier: string | undefined;
  walkAst(expression, node => {
    if (specifier) return;
    if (isModuleCall(node)) specifier = node.arguments[0].value;
    else if (!local && node.type === "Identifier" && node.name !== "require") local = node.name;
  });
  return specifier ? { specifier } : { local };
}

function parseSource(path: string, code: string, diagnostics: IntelDiagnostic[]): ParsedSource {
  const found: ParsedSource = { path, code, imports: [], navigation: [], registrations: [], declared: new Set() };
  try {
    const ast = parse(code, { sourceType: "unambiguous", errorRecovery: true, plugins: ["jsx", "typescript", "decorators-legacy"] });
    walkAst(ast, node => {
      if (node.type === "ImportDeclaration" && typeof node.source?.value === "string") {
        for (const specifier of node.specifiers?.length ? node.specifiers : [undefined]) found.imports.push({ specifier: node.source.value, typeOnly: node.importKind === "type", dynamic: false, local: specifier?.local?.name });
      } else if ((node.type === "ExportNamedDeclaration" || node.type === "ExportAllDeclaration") && typeof node.source?.value === "string") {
        found.imports.push({ specifier: node.source.value, typeOnly: node.exportKind === "type", dynamic: false });
      } else if ((node.type === "CallExpression" || node.type === "OptionalCallExpression") && node.arguments?.[0]?.type === "StringLiteral") {
        // `require` counts: React Navigation registers plenty of screens through one.
        if (isModuleCall(node)) found.imports.push({ specifier: node.arguments[0].value, typeOnly: false, dynamic: true });
        const method = node.callee?.property?.name ?? node.callee?.name;
        if (["navigate", "push", "replace"].includes(method)) found.navigation.push(node.arguments[0].value);
      } else if (node.type === "FunctionDeclaration" || node.type === "ClassDeclaration") {
        if (typeof node.id?.name === "string") found.declared.add(node.id.name);
      } else if (node.type === "VariableDeclarator" && typeof node.id?.name === "string") {
        found.declared.add(node.id.name);
      } else if (node.type === "JSXOpeningElement") {
        const name = node.name?.type === "JSXMemberExpression" ? node.name.property?.name : node.name?.name;
        if (name !== "Screen") return;
        const attrs = new Map((node.attributes ?? []).filter((item: any) => item.type === "JSXAttribute").map((item: any) => [item.name?.name, item.value]));
        const screenName = (attrs.get("name") as any)?.value;
        const component = (attrs.get("component") ?? attrs.get("getComponent")) as any;
        if (typeof screenName === "string") found.registrations.push({ name: screenName, ...componentRef(component?.expression) });
      }
    });
  } catch (error) {
    diagnostics.push({ code: "parse-error", file: path, message: error instanceof Error ? error.message.split("\n")[0] : String(error) });
  }
  return found;
}

/** tsconfig.json is JSONC: comments and trailing commas are legal there and fatal to `JSON.parse`. */
export function parseJsonc(text: string): any {
  let out = "", inString = false, escaped = false, inLine = false, inBlock = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index], next = text[index + 1];
    if (inLine) { if (char === "\n") { inLine = false; out += char; } continue; }
    if (inBlock) { if (char === "*" && next === "/") { inBlock = false; index++; } continue; }
    if (inString) {
      out += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === "/" && next === "/") { inLine = true; continue; }
    if (char === "/" && next === "*") { inBlock = true; index++; continue; }
    if (char === '"') inString = true;
    out += char;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}

/** `extends` targets are a relative path or a package, with `.json` and `/tsconfig.json` implied. */
async function resolveExtends(from: string, target: string): Promise<string | null> {
  const candidates: string[] = [];
  const add = (base: string) => {
    candidates.push(base);
    if (!extname(base)) candidates.push(`${base}.json`, join(base, "tsconfig.json"));
  };
  if (target.startsWith(".") || isAbsolute(target)) add(resolve(from, target));
  else for (let directory = from; ; directory = dirname(directory)) {
    add(join(directory, "node_modules", target));
    if (dirname(directory) === directory) break;
  }
  for (const candidate of candidates) try { return await realpath(candidate); } catch { /* try the next shape */ }
  return null;
}

type Alias = { prefix: string; suffix: string; targets: string[] };

/**
 * Path aliases from the tsconfig chain. The nearest config that declares `paths` wins, and its
 * relative targets resolve against its own directory (or its `baseUrl`), as TypeScript does.
 */
async function readAliases(root: string, diagnostics: IntelDiagnostic[]): Promise<Alias[]> {
  const aliases: Alias[] = [];
  const seen = new Set<string>();
  let file: string | null = join(root, "tsconfig.json");
  for (let depth = 0; file && depth < 10; depth++) {
    if (seen.has(file)) break;
    seen.add(file);
    let config: any;
    try {
      config = parseJsonc(await readFile(file, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") diagnostics.push({ code: "tsconfig", file: portable(root, file), message: "Could not read tsconfig path aliases; normal module resolution was used." });
      return aliases;
    }
    const paths = config.compilerOptions?.paths;
    if (paths && typeof paths === "object") {
      const base = resolve(dirname(file), config.compilerOptions?.baseUrl ?? ".");
      for (const [pattern, targets] of Object.entries(paths)) {
        if (!Array.isArray(targets)) continue;
        const star = pattern.indexOf("*");
        aliases.push({ prefix: star < 0 ? pattern : pattern.slice(0, star), suffix: star < 0 ? "" : pattern.slice(star + 1), targets: targets.filter((value): value is string => typeof value === "string").map(value => resolve(base, value)) });
      }
      return aliases;
    }
    const parent = Array.isArray(config.extends) ? config.extends.at(-1) : config.extends;
    file = typeof parent === "string" ? await resolveExtends(dirname(file), parent) : null;
  }
  return aliases;
}

/** The package a resolved path belongs to, from the last `node_modules` segment it sits under. */
function packageFrom(path: string, specifier: string): string {
  const segments = path.split(sep);
  const marker = segments.lastIndexOf("node_modules");
  if (marker < 0 || !segments[marker + 1]) return packageName(specifier);
  const first = segments[marker + 1];
  return first.startsWith("@") && segments[marker + 2] ? `${first}/${segments[marker + 2]}` : first;
}

function expoRoute(root: string, path: string): { id: string; title: string; route: string } | null {
  const rel = portable(root, path);
  const marker = rel.match(/(?:^|\/)(app)\/(.+)\.(?:[cm]?[jt]sx?)$/);
  if (!marker || /(?:^|\/)_(?:layout|sitemap)$/.test(marker[2]) || /(?:^|\/)\+/.test(marker[2])) return null;
  const segments = marker[2].split("/").filter(segment => !/^\(.*\)$/.test(segment));
  const last = segments.at(-1);
  if (last === "index") segments.pop();
  const route = `/${segments.join("/")}` || "/";
  return { id: `expo:${marker[2]}`, title: last === "index" ? segments.at(-1) ?? "Home" : last ?? "Home", route };
}

export async function analyzeApp(projectPath: string, options: { signal?: AbortSignal; onProgress?: (message: string) => void } = {}): Promise<AppIntelSnapshot> {
  const root = await realpath(projectPath);
  const projectId = fingerprint(root).slice(0, 24);
  const generation = randomUUID();
  const diagnostics: IntelDiagnostic[] = [];
  const paths: string[] = [];
  const check = () => options.signal?.throwIfAborted();
  async function walk(directory: string): Promise<void> {
    check();
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isSymbolicLink()) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory() && !ignored.has(entry.name)) await walk(path);
      else if (entry.isFile() && (sourcePattern.test(entry.name) || assetPattern.test(entry.name))) paths.push(path);
    }
  }
  options.onProgress?.("Discovering source files");
  await walk(root);
  const files: AppIntelSnapshot["files"] = Object.create(null);
  const parsed = new Map<string, ParsedSource>();
  for (const [index, path] of paths.entries()) {
    check();
    const content = await readFile(path);
    const rel = portable(root, path);
    files[rel] = { fingerprint: fingerprint(content), kind: sourcePattern.test(path) ? "source" : "asset", reach: 0 };
    if (sourcePattern.test(path)) parsed.set(rel, parseSource(rel, content.toString("utf8"), diagnostics));
    if (index > 0 && index % 100 === 0) options.onProgress?.(`Parsed ${index} of ${paths.length} files`);
  }
  const aliases = await readAliases(root, diagnostics);
  const requestsFor = (specifier: string) => {
    const requests = [specifier];
    for (const alias of aliases) if (specifier.startsWith(alias.prefix) && specifier.endsWith(alias.suffix)) {
      const middle = specifier.slice(alias.prefix.length, alias.suffix ? -alias.suffix.length : undefined);
      for (const target of alias.targets) requests.unshift(target.replaceAll("*", () => middle));
    }
    return requests;
  };
  const resolveFor = new Map<IntelPlatform, (context: string, request: string) => string | false>();
  for (const platform of ["ios", "android"] as const) resolveFor.set(platform, enhancedResolve.create.sync({ extensions: extensions(platform), mainFields: ["react-native", "module", "main"], conditionNames: ["react-native", platform, "import", "require", "default"], symlinks: false }));
  const realCache = new Map<string, string>();
  const realOf = async (path: string) => {
    const cached = realCache.get(path);
    if (cached) return cached;
    let real = path;
    try { real = await realpath(path); } catch { /* a virtual or missing target keeps its own path */ }
    realCache.set(path, real);
    return real;
  };
  const edges: IntelEdge[] = [];
  const packages: AppIntelSnapshot["packages"] = Object.create(null);
  const localTargets = new Map<string, Map<string, string>>();
  const specifierTargets = new Map<string, Map<string, string>>();
  for (const source of parsed.values()) {
    const locals = new Map<string, string>();
    const specifiers = new Map<string, string>();
    for (const item of source.imports) {
      check();
      const resolved = new Map<string, IntelPlatform[]>();
      for (const platform of ["ios", "android"] as const) {
        for (const request of requestsFor(item.specifier)) {
          let result: string | false;
          try { result = resolveFor.get(platform)!(resolve(root, dirname(source.path)), request); }
          catch { continue; /* try the next alias, or report it as a diagnostic below */ }
          if (!result) continue;
          // A workspace package is symlinked into node_modules but its real path is app code, so
          // the real path decides, and everything else collapses to one leaf for its package.
          const real = await realOf(result);
          const appCode = inside(root, real) && !relative(root, real).split(sep).includes("node_modules");
          if (!appCode) {
            const name = packageFrom(result, item.specifier);
            packages[name] ??= { name, reach: 0, entry: inside(root, result) ? portable(root, result) : null };
            const key = packageRef(name);
            resolved.set(key, [...(resolved.get(key) ?? []), platform]);
            break;
          }
          const target = portable(root, real);
          const key = fileRef(target);
          resolved.set(key, [...(resolved.get(key) ?? []), platform]);
          if (item.local) locals.set(item.local, target);
          specifiers.set(item.specifier, target);
          break;
        }
      }
      if (resolved.size === 0 && !item.specifier.startsWith(".") && !item.specifier.startsWith("/") && !item.specifier.startsWith("#")) {
        const name = packageName(item.specifier); packages[name] ??= { name, reach: 0, entry: null };
        resolved.set(packageRef(name), ["ios", "android"]);
      }
      if (resolved.size === 0) diagnostics.push({ code: "unresolved-import", file: source.path, message: `Could not resolve ${item.specifier} for iOS or Android.` });
      for (const [to, platforms] of resolved) edges.push({ from: fileRef(source.path), to: to as any, kind: "import", specifier: item.specifier, platforms, dynamic: item.dynamic || undefined, typeOnly: item.typeOnly || undefined });
    }
    localTargets.set(source.path, locals);
    specifierTargets.set(source.path, specifiers);
  }
  const screens: AppIntelSnapshot["screens"] = Object.create(null);
  const screenByName = new Map<string, string>();
  for (const [path, source] of parsed) {
    const expo = expoRoute(root, join(root, path));
    if (expo) {
      screens[expo.id] = { title: expo.title, route: expo.route, source: path, layouts: [] };
      screenByName.set(expo.title.toLowerCase(), expo.id); screenByName.set(expo.route.toLowerCase(), expo.id);
    }
    for (const registration of source.registrations) {
      const id = `navigation:${registration.name}`;
      const target = registration.specifier ? specifierTargets.get(path)?.get(registration.specifier)
        : registration.local ? localTargets.get(path)?.get(registration.local) : undefined;
      // Falling back to the registering file would give every screen that file's whole import
      // graph, so an unresolved component is reported rather than papered over.
      // A nested navigator declared in this very file really does live here; only a component
      // this file neither declares nor imports is a gap worth reporting.
      const own = registration.local ? source.declared.has(registration.local) : false;
      if (!target && !own) diagnostics.push({ code: "unresolved-screen", file: path, message: `Could not tell which file renders ${registration.name}; it is mapped to its navigator.` });
      screens[id] = { title: registration.name, route: null, source: target ?? path, layouts: [] };
      screenByName.set(registration.name.toLowerCase(), id);
    }
  }
  for (const [id, screen] of Object.entries(screens)) {
    if (!screen.source) continue;
    const parts = dirname(screen.source).split("/");
    while (parts.length) {
      const directory = parts.join("/");
      const layout = Object.keys(files).find(path => path.startsWith(`${directory}/_layout.`) && sourcePattern.test(path));
      if (layout) screen.layouts.push(layout);
      parts.pop();
    }
    edges.push({ from: screenRef(id), to: fileRef(screen.source), kind: "source", platforms: ["ios", "android"] });
    for (const layout of screen.layouts) edges.push({ from: screenRef(id), to: fileRef(layout), kind: "layout", platforms: ["ios", "android"] });
  }
  const owners = new Map<string, string[]>();
  for (const [id, screen] of Object.entries(screens)) if (screen.source) owners.set(screen.source, [...(owners.get(screen.source) ?? []), id]);
  for (const source of parsed.values()) for (const name of source.navigation) {
    const to = screenByName.get(name.toLowerCase());
    for (const from of owners.get(source.path) ?? []) edges.push({ from: screenRef(from), to: to ? screenRef(to) : null, kind: "navigation", specifier: name, platforms: ["ios", "android"] });
  }
  const unique = [...new Map(edges.map(edge => [JSON.stringify(edge), edge])).values()];
  const indexes: AppIntelSnapshot["indexes"] = { screens: Object.create(null), incoming: Object.create(null), outgoing: Object.create(null) };
  for (const [id, screen] of Object.entries(screens)) for (const key of new Set([id, screen.title, screen.route].filter(Boolean).map(value => String(value).toLowerCase()))) (indexes.screens[key] ??= []).push(id);
  unique.forEach((edge, index) => { (indexes.outgoing[edge.from] ??= []).push(index); if (edge.to) (indexes.incoming[edge.to] ??= []).push(index); });
  for (const id of Object.keys(screens)) {
    check();
    const queue: IntelRef[] = [screenRef(id)];
    const visited = new Set<IntelRef>(queue);
    for (let cursor = 0; cursor < queue.length; cursor++) for (const index of indexes.outgoing[queue[cursor]] ?? []) {
      const edge = unique[index];
      if (!edge.to || edge.kind === "navigation" || visited.has(edge.to)) continue;
      visited.add(edge.to);
      if (edge.to.startsWith("file:")) { const file = files[edge.to.slice(5)]; if (file) file.reach++; }
      // A package is a leaf: its own internals belong to its author, not to this app's hierarchy.
      else if (edge.to.startsWith("package:")) { const pkg = packages[edge.to.slice(8)]; if (pkg) pkg.reach++; continue; }
      queue.push(edge.to);
    }
  }
  const sourceFingerprint = fingerprint(Object.entries(files).map(([path, file]) => `${path}:${file.fingerprint}`).join("\n"));
  return { formatVersion: 1, meta: { projectId, generation, analyzedAt: new Date().toISOString(), analyzerVersion: "mobile-dev-1", sourceFingerprint }, files, packages, screens, edges: unique, diagnostics, indexes };
}
