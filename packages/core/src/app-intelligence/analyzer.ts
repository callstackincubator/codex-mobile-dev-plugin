import { createHash, randomUUID } from "node:crypto";
import { readFile, readdir, realpath } from "node:fs/promises";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
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

type ParsedSource = { path: string; code: string; imports: Array<{ specifier: string; typeOnly: boolean; dynamic: boolean; local?: string }>; navigation: string[]; registrations: Array<{ name: string; local?: string }> };

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

function parseSource(path: string, code: string, diagnostics: IntelDiagnostic[]): ParsedSource {
  const found: ParsedSource = { path, code, imports: [], navigation: [], registrations: [] };
  try {
    const ast = parse(code, { sourceType: "unambiguous", errorRecovery: true, plugins: ["jsx", "typescript", "decorators-legacy"] });
    walkAst(ast, node => {
      if (node.type === "ImportDeclaration" && typeof node.source?.value === "string") {
        for (const specifier of node.specifiers?.length ? node.specifiers : [undefined]) found.imports.push({ specifier: node.source.value, typeOnly: node.importKind === "type", dynamic: false, local: specifier?.local?.name });
      } else if ((node.type === "ExportNamedDeclaration" || node.type === "ExportAllDeclaration") && typeof node.source?.value === "string") {
        found.imports.push({ specifier: node.source.value, typeOnly: node.exportKind === "type", dynamic: false });
      } else if ((node.type === "CallExpression" || node.type === "OptionalCallExpression") && node.arguments?.[0]?.type === "StringLiteral") {
        const callee = node.callee;
        if (callee?.type === "Import") found.imports.push({ specifier: node.arguments[0].value, typeOnly: false, dynamic: true });
        const method = callee?.property?.name ?? callee?.name;
        if (["navigate", "push", "replace"].includes(method)) found.navigation.push(node.arguments[0].value);
      } else if (node.type === "JSXOpeningElement") {
        const name = node.name?.type === "JSXMemberExpression" ? node.name.property?.name : node.name?.name;
        if (name !== "Screen") return;
        const attrs = new Map((node.attributes ?? []).filter((item: any) => item.type === "JSXAttribute").map((item: any) => [item.name?.name, item.value]));
        const screenName = (attrs.get("name") as any)?.value;
        const component = (attrs.get("component") as any)?.expression?.name;
        if (typeof screenName === "string") found.registrations.push({ name: screenName, local: component });
      }
    });
  } catch (error) {
    diagnostics.push({ code: "parse-error", file: path, message: error instanceof Error ? error.message.split("\n")[0] : String(error) });
  }
  return found;
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
  const aliases: Array<{ prefix: string; suffix: string; targets: string[] }> = [];
  try {
    const tsconfig = JSON.parse((await readFile(join(root, "tsconfig.json"), "utf8")).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, ""));
    const base = resolve(root, tsconfig.compilerOptions?.baseUrl ?? ".");
    for (const [pattern, targets] of Object.entries(tsconfig.compilerOptions?.paths ?? {})) {
      if (!Array.isArray(targets)) continue;
      const star = pattern.indexOf("*");
      aliases.push({ prefix: star < 0 ? pattern : pattern.slice(0, star), suffix: star < 0 ? "" : pattern.slice(star + 1), targets: targets.filter((value): value is string => typeof value === "string").map(value => resolve(base, value)) });
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") diagnostics.push({ code: "tsconfig", file: "tsconfig.json", message: "Could not read tsconfig path aliases; normal module resolution was used." });
  }
  const requestsFor = (specifier: string) => {
    const requests = [specifier];
    for (const alias of aliases) if (specifier.startsWith(alias.prefix) && specifier.endsWith(alias.suffix)) {
      const middle = specifier.slice(alias.prefix.length, alias.suffix ? -alias.suffix.length : undefined);
      for (const target of alias.targets) requests.unshift(target.replace("*", middle));
    }
    return requests;
  };
  const resolveFor = new Map<IntelPlatform, (context: string, request: string) => string | false>();
  for (const platform of ["ios", "android"] as const) resolveFor.set(platform, enhancedResolve.create.sync({ extensions: extensions(platform), mainFields: ["react-native", "module", "main"], conditionNames: ["react-native", platform, "import", "require", "default"], symlinks: false }));
  const edges: IntelEdge[] = [];
  const packages: AppIntelSnapshot["packages"] = Object.create(null);
  const importTargets = new Map<string, Map<string, string>>();
  for (const source of parsed.values()) {
    const locals = new Map<string, string>();
    for (const item of source.imports) {
      check();
      const resolved = new Map<string, IntelPlatform[]>();
      for (const platform of ["ios", "android"] as const) {
        for (const request of requestsFor(item.specifier)) try {
          const result = resolveFor.get(platform)!(resolve(root, dirname(source.path)), request);
          if (!result || !inside(root, result)) continue;
          const target = portable(root, result);
          const key = fileRef(target);
          resolved.set(key, [...(resolved.get(key) ?? []), platform]);
          if (item.local) locals.set(item.local, target);
          break;
        } catch { /* try the next alias or represent it with a diagnostic below */ }
      }
      if (resolved.size === 0 && !item.specifier.startsWith(".") && !item.specifier.startsWith("/")) {
        const name = packageName(item.specifier); packages[name] ??= { name, reach: 0 };
        resolved.set(packageRef(name), ["ios", "android"]);
      }
      if (resolved.size === 0) diagnostics.push({ code: "unresolved-import", file: source.path, message: `Could not resolve ${item.specifier} for iOS or Android.` });
      for (const [to, platforms] of resolved) edges.push({ from: fileRef(source.path), to: to as any, kind: "import", specifier: item.specifier, platforms, dynamic: item.dynamic || undefined, typeOnly: item.typeOnly || undefined });
    }
    importTargets.set(source.path, locals);
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
      const target = registration.local ? importTargets.get(path)?.get(registration.local) ?? path : path;
      screens[id] = { title: registration.name, route: null, source: target, layouts: [] };
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
      else if (edge.to.startsWith("package:")) { const pkg = packages[edge.to.slice(8)]; if (pkg) pkg.reach++; }
      queue.push(edge.to);
    }
  }
  const sourceFingerprint = fingerprint(Object.entries(files).map(([path, file]) => `${path}:${file.fingerprint}`).join("\n"));
  return { formatVersion: 1, meta: { projectId, generation, analyzedAt: new Date().toISOString(), analyzerVersion: "mobile-dev-1", sourceFingerprint }, files, packages, screens, edges: unique, diagnostics, indexes };
}

