
!function(){try{var e="undefined"!=typeof window?window:"undefined"!=typeof global?global:"undefined"!=typeof globalThis?globalThis:"undefined"!=typeof self?self:{},n=(new e.Error).stack;n&&(e._sentryDebugIds=e._sentryDebugIds||{},e._sentryDebugIds[n]="90f83a24-cc37-5525-89e9-3cf679b8b863")}catch(e){}}();
import { createRequire as mobileDevBundleRequire } from 'node:module'; import { fileURLToPath as mobileDevFileURLToPath } from 'node:url'; import { dirname as mobileDevPathDirname } from 'node:path'; const require = mobileDevBundleRequire(import.meta.url); const __filename = mobileDevFileURLToPath(import.meta.url); const __dirname = mobileDevPathDirname(__filename);
import {
  captureServerError,
  errorMessage,
  import_websocket,
  normalizeAppFlowScreenLimit,
  parseBaseUrl,
  requiresDecisionProvider,
  resolveAppFlowStart
} from "./chunk-OPAYWTKC.mjs";
import {
  ExpectedOperationError,
  public_api_exports
} from "./chunk-WX3WADUR.mjs";

// packages/core/src/app-flow/parser.ts
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, extname, join as join2, posix, relative, resolve } from "node:path";

// packages/core/src/app-flow/typescript-runtime.ts
import { createRequire } from "node:module";
import { join } from "node:path";
var loaded;
var projectRoot;
function setTypeScriptProject(root) {
  projectRoot = root;
}
function resolveFrom(base) {
  try {
    const require2 = createRequire(base);
    return require2(require2.resolve("typescript"));
  } catch {
    return void 0;
  }
}
function resolveTypeScript(projectRoot2, fallbackFrom) {
  const fromProject = projectRoot2 ? resolveFrom(join(projectRoot2, "package.json")) : void 0;
  const compiler = fromProject ?? resolveFrom(fallbackFrom);
  if (!compiler)
    throw new ExpectedOperationError(
      "invalid_input",
      projectRoot2 ? `App flow reads your screens with the TypeScript compiler, and ${projectRoot2} has no copy installed. Run npm install --save-dev typescript there and try again.` : "App flow reads your screens with the TypeScript compiler, but no project has been selected yet."
    );
  return compiler;
}
function load() {
  if (loaded) return loaded;
  loaded = resolveTypeScript(projectRoot, import.meta.url);
  return loaded;
}
var typescriptRuntime = new Proxy(/* @__PURE__ */ Object.create(null), {
  get: (_target, property) => Reflect.get(load(), property),
  has: (_target, property) => Reflect.has(load(), property),
  ownKeys: () => Reflect.ownKeys(load()),
  getOwnPropertyDescriptor: (_target, property) => {
    const descriptor = Reflect.getOwnPropertyDescriptor(load(), property);
    return descriptor ? { ...descriptor, configurable: true } : void 0;
  }
});
var typescript_runtime_default = typescriptRuntime;

// packages/core/src/app-flow/parser.ts
function generateSlug(routeId) {
  return routeId.replace(/[^a-zA-Z0-9]/g, "_").replace(/_+/g, "_").toLowerCase();
}
function classifyNavigatorFactory(factory) {
  if (/MaterialTopTab|TopTab/.test(factory)) return "TopTabs";
  if (/BottomTab|\bTabs?Navigator/.test(factory)) return "Tabs";
  if (/Drawer/.test(factory)) return "Drawer";
  return "Stack";
}
function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function finalizeEdges(edges) {
  const seenKeys = /* @__PURE__ */ new Set();
  const out = [];
  for (const edge of edges) {
    if (edge.from === edge.to) continue;
    const key2 = `${edge.from}\0${edge.to}\0${edge.kind ?? ""}`;
    if (seenKeys.has(key2)) continue;
    seenKeys.add(key2);
    out.push(edge);
  }
  return out;
}
function routeMatcher(urlPath) {
  const re = urlPath.split("/").map(
    (seg) => seg.startsWith("[...") ? ".*" : seg.startsWith("[") || seg.startsWith(":") ? "[^/]+" : escapeRe(seg)
  ).join("/");
  return new RegExp("^" + re + "/?$");
}
var GUARD_FALLBACK_RE = /^(?:NotFound|Unavailable|Forbidden|NoAccess|AccessDenied)/;
function readBalancedParens(src, open2) {
  let depth = 0;
  for (let index = open2; index < src.length; index++) {
    const char = src[index];
    if (char === "(") depth += 1;
    else if (char === ")") {
      depth -= 1;
      if (depth === 0) return { text: src.slice(open2 + 1, index), end: index };
    }
  }
  return null;
}
function resolveGuardCondition(src, condition) {
  const bare = /^(!?)([A-Za-z_$][\w$]*)$/.exec(condition);
  if (!bare) return condition;
  const assigned = new RegExp(
    `\\b(?:const|let|var)\\s+${escapeRe(bare[2])}\\s*(?::[^=
]*)?=\\s*([^
;]+)`
  ).exec(src)?.[1];
  return assigned ? `${bare[1]}${assigned.trim().replace(/\s+/g, " ")}` : condition;
}
function extractGuard(src) {
  for (const match of src.matchAll(/\bif\s*\(/g)) {
    const open2 = match.index + match[0].length - 1;
    const condition = readBalancedParens(src, open2);
    if (!condition) continue;
    const returned = /^\s*\{?\s*return\s*\(?\s*<\s*([A-Za-z_$][\w$.]*)/.exec(
      src.slice(condition.end + 1, condition.end + 200)
    );
    if (!returned || !GUARD_FALLBACK_RE.test(returned[1])) continue;
    const text2 = condition.text.replace(/\s+/g, " ").trim();
    if (text2) return { condition: resolveGuardCondition(src, text2), fallback: returned[1] };
  }
  return null;
}
async function walk(dir) {
  const out = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const p = join2(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...await walk(p));
    } else {
      out.push(p);
    }
  }
  return out;
}
function firstString(value) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (Array.isArray(value) && typeof value[0] === "string" && value[0].trim()) {
    return value[0].trim();
  }
  return null;
}
async function readAppConfig(projectRoot2) {
  const empty = { scheme: null, name: null, slug: null, bundleId: null };
  try {
    const cfg = JSON.parse(await readFile(join2(projectRoot2, "app.json"), "utf-8"));
    const expo = cfg.expo ?? {};
    return {
      scheme: firstString(expo.scheme ?? cfg.scheme),
      name: firstString(expo.name ?? cfg.name),
      slug: firstString(expo.slug),
      bundleId: firstString(expo.ios?.bundleIdentifier)
    };
  } catch {
  }
  for (const f of ["app.config.js", "app.config.ts"]) {
    try {
      const src = await readFile(join2(projectRoot2, f), "utf-8");
      return {
        scheme: src.match(/\bscheme\s*:\s*["']([A-Za-z0-9._+-]+)["']/)?.[1] ?? null,
        name: src.match(/\bname\s*:\s*["']([^"']+)["']/)?.[1] ?? null,
        slug: src.match(/\bslug\s*:\s*["']([A-Za-z0-9._+-]+)["']/)?.[1] ?? null,
        bundleId: src.match(/\bbundleIdentifier\s*:\s*["']([A-Za-z0-9.]+)["']/)?.[1] ?? null
      };
    } catch {
    }
  }
  return empty;
}
function toUrlPath(noExt) {
  const segments = noExt.split("/");
  if (segments[segments.length - 1] === "index") segments.pop();
  const urlSegments = segments.filter((s) => !(s.startsWith("(") && s.endsWith(")")));
  return "/" + urlSegments.join("/");
}
function extractParams(segments) {
  return segments.filter((s) => s.startsWith("[") && s.endsWith("]")).map((s) => s.slice(1, -1).replace(/^\.\.\./, ""));
}
function toSlug(noExt) {
  let s = noExt === "index" ? "index" : noExt.replace(/\/index$/, "");
  s = s.replace(/[()[\]]/g, "").replace(/\.\.\./g, "").replace(/\//g, "_");
  return generateSlug(s || "index");
}
function fallbackTitle(noExt) {
  const last = posix.basename(noExt);
  if (last === "index") return "index";
  const cleaned = last.replace(/^\[(?:\.\.\.)?/, "").replace(/\]$/, "").replace(/[-_]+/g, " ");
  return cleaned.replace(/\b[a-z]/g, (c) => c.toUpperCase()) || "Screen";
}
function isUpwardHref(raw) {
  return raw.split(/[?#]/)[0].split("/").includes("..");
}
var SOURCE_EXTS = [
  ".ios.tsx",
  ".native.tsx",
  ".ios.ts",
  ".native.ts",
  ".tsx",
  ".ts",
  ".ios.jsx",
  ".native.jsx",
  ".jsx",
  ".js"
];
var IMPORT_RE = /(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g;
async function loadPathAliases(projectRoot2) {
  const defaults = [
    { prefix: "@/", target: "src/" },
    { prefix: "@/", target: "" }
  ];
  try {
    const configPath = typescript_runtime_default.findConfigFile(projectRoot2, typescript_runtime_default.sys.fileExists, "tsconfig.json");
    if (!configPath) return defaults;
    const parsed = typescript_runtime_default.getParsedCommandLineOfConfigFile(
      configPath,
      {},
      {
        ...typescript_runtime_default.sys,
        onUnRecoverableConfigFileDiagnostic: () => void 0
      }
    );
    const paths = parsed?.options.paths;
    if (!paths) return defaults;
    const baseUrl = parsed.options.baseUrl ?? projectRoot2;
    const aliases = Object.entries(paths).map(([key2, targets]) => ({
      prefix: key2.replace(/\*$/, ""),
      target: resolve(baseUrl, (targets[0] ?? "").replace(/\*$/, ""))
    }));
    aliases.sort((a, b) => b.prefix.length - a.prefix.length);
    return aliases.length > 0 ? aliases : defaults;
  } catch {
    return defaults;
  }
}
async function resolveWithExt(base) {
  for (const ext of SOURCE_EXTS) {
    try {
      const candidate = base + ext;
      if ((await stat(candidate)).isFile()) return candidate;
    } catch {
    }
  }
  for (const ext of SOURCE_EXTS) {
    try {
      const candidate = join2(base, "index" + ext);
      if ((await stat(candidate)).isFile()) return candidate;
    } catch {
    }
  }
  try {
    if ((await stat(base)).isFile()) return base;
  } catch {
  }
  return null;
}
async function resolveImport(fromFile, spec, aliases) {
  if (spec.startsWith(".")) {
    return resolveWithExt(resolve(dirname(fromFile), spec));
  }
  for (const alias of aliases) {
    if (spec === alias.prefix.replace(/\/$/, "") || spec.startsWith(alias.prefix)) {
      const rest = spec.startsWith(alias.prefix) ? spec.slice(alias.prefix.length) : "";
      const resolved = await resolveWithExt(resolve(alias.target, rest));
      if (resolved) return resolved;
    }
  }
  return null;
}
async function loadLayoutSource(layoutFile, aliases) {
  const src = await readFile(layoutFile, "utf-8");
  const chunks = [src];
  for (const match of src.matchAll(IMPORT_RE)) {
    const resolved = await resolveImport(layoutFile, match[1], aliases);
    if (!resolved) continue;
    chunks.push(await readFile(resolved, "utf-8"));
  }
  return chunks.join("\n");
}
function extractScreenTitles(src) {
  const hits = [];
  for (const match of src.matchAll(
    /<NativeTabs\.Trigger\b([^>]*)>([\s\S]*?)<\/NativeTabs\.Trigger>/g
  )) {
    const name2 = match[1].match(/\bname\s*=\s*["']([^"']+)["']/)?.[1] ?? null;
    const href = match[1].match(/\bhref\s*=\s*["']([^"']+)["']/)?.[1] ?? null;
    const title = match[2].match(/<NativeTabs\.Trigger\.Label>([^<]+)<\/NativeTabs\.Trigger\.Label>/)?.[1]?.trim() ?? match[2].match(/<Label>([^<]+)<\/Label>/)?.[1]?.trim() ?? null;
    if (title) hits.push({ name: name2, href, title });
  }
  for (const match of src.matchAll(/<(?:[\w.]*Screen)\b([^>]*?)(?:\/>|>)/g)) {
    const attrs2 = match[1];
    const name2 = attrs2.match(/\bname\s*=\s*["']([^"']+)["']/)?.[1] ?? null;
    const title = attrs2.match(/\btitle\s*:\s*["']([^"']+)["']/)?.[1] ?? attrs2.match(/\btitle\s*=\s*["']([^"']+)["']/)?.[1] ?? null;
    if (name2 && title) hits.push({ name: name2, href: null, title });
  }
  return hits;
}
function titleForRoute(noExt, urlPath, layoutDir, titlesByDir) {
  let dir = layoutDir;
  while (true) {
    const localName = dir ? noExt.startsWith(`${dir}/`) ? noExt.slice(dir.length + 1) : noExt : noExt;
    const hit = (titlesByDir[dir] ?? []).find(
      (item) => item.name === localName || item.name === posix.basename(noExt) || item.href != null && item.href.split(/[?#]/)[0] === urlPath
    );
    if (hit) return hit.title;
    if (dir === "") break;
    const parent = posix.dirname(dir);
    dir = parent === "." ? "" : parent;
  }
  return fallbackTitle(noExt);
}
async function parseExpoRouter(projectRoot2, appDir) {
  const EXTS = /* @__PURE__ */ new Set([".tsx", ".jsx", ".ts", ".js"]);
  const NON_ROUTE_BASES = /* @__PURE__ */ new Set(["+html", "+native-intent", "+middleware"]);
  const rel = (p) => relative(projectRoot2, p).split(/[/\\]/).join("/");
  const aliases = await loadPathAliases(projectRoot2);
  const startedAt = Date.now();
  const allFiles = await walk(appDir);
  console.log(`[app-flow] parse: walked ${appDir} \u2014 ${allFiles.length} files`);
  const entries = await Promise.all(
    allFiles.filter((f) => EXTS.has(extname(f))).map(async (f) => {
      const relApp = relative(appDir, f).split(/[/\\]/).join("/");
      const noExt = relApp.slice(0, -extname(relApp).length);
      const base = posix.basename(noExt);
      const dir = posix.dirname(noExt);
      return { abs: f, noExt, base, dir: dir === "." ? "" : dir };
    })
  );
  const routeEntries = entries.filter(
    (e) => !e.base.endsWith("+api") && !NON_ROUTE_BASES.has(e.base)
  );
  const layoutEntries = routeEntries.filter((e) => e.base === "_layout");
  const screenEntries = routeEntries.filter((e) => e.base !== "_layout");
  console.log(
    `[app-flow] parse: ${screenEntries.length} screen files, ${layoutEntries.length} layouts`
  );
  const layoutsByDir = {};
  const titlesByDir = {};
  for (const l of layoutEntries) {
    const src = await loadLayoutSource(l.abs, aliases);
    const nav = src.match(/<\s*(NativeTabs|Tabs|Stack|Drawer|Slot)\b/);
    layoutsByDir[l.dir] = {
      file: rel(l.abs),
      dir: l.dir,
      navigator: nav ? nav[1] : null,
      src
    };
    titlesByDir[l.dir] = extractScreenTitles(src);
  }
  function nearestLayout(dir) {
    let d = dir;
    while (true) {
      if (layoutsByDir[d]) return layoutsByDir[d];
      if (d === "") return null;
      const parent = posix.dirname(d);
      d = parent === "." ? "" : parent;
    }
  }
  console.log(`[app-flow] parse: layouts loaded (${Date.now() - startedAt}ms)`);
  const presentations = [];
  for (const l of Object.values(layoutsByDir)) {
    for (const tag of l.src.match(/<[\w.]*Screen\b[^>]*>/g) ?? []) {
      const name2 = tag.match(/name\s*=\s*["']([^"']+)["']/)?.[1];
      const presentation = tag.match(/presentation\s*:\s*["']([a-zA-Z]+)["']/)?.[1];
      if (name2 && presentation) {
        presentations.push({ prefix: l.dir ? `${l.dir}/${name2}` : name2, presentation });
      }
    }
  }
  const nodes = await Promise.all(
    screenEntries.map(async (e) => {
      const segments = e.noExt.split("/");
      if (segments[segments.length - 1] === "index") segments.pop();
      const urlPath = toUrlPath(e.noExt);
      const params = extractParams(segments);
      const layout = nearestLayout(e.dir);
      const title = titleForRoute(e.noExt, urlPath, layout?.dir ?? "", titlesByDir);
      const presentation = presentations.find((p) => e.noExt === p.prefix || e.noExt.startsWith(p.prefix + "/"))?.presentation ?? null;
      const src = await readFile(e.abs, "utf-8");
      const guard = extractGuard(src);
      return {
        id: e.noExt,
        urlPath,
        reach: "deep-link",
        title,
        file: rel(e.abs),
        slug: toSlug(e.noExt),
        group: layout?.dir ?? "",
        // Expo Router has no shared-registration-helper concept — every screen file is registered
        // in exactly one directory — so there is never more than one owner to list here.
        groups: [layout?.dir ?? ""],
        navigator: layout?.navigator ?? null,
        params,
        presentation,
        guard,
        capture: null
      };
    })
  );
  console.log(`[app-flow] parse: ${nodes.length} nodes built (${Date.now() - startedAt}ms)`);
  const matchers = nodes.map((r) => ({ route: r, re: routeMatcher(r.urlPath) }));
  const HREF_RE = /href=\{?\s*["'`]([^"'`]+)["'`]/g;
  const PATHNAME_RE = /pathname\s*:\s*["'`]([^"'`]+)["'`]/g;
  const ROUTER_RE = /(?:router|navigation)\.(?:push|replace|navigate)\(\s*["'`]([^"'`]+)["'`]/g;
  const edges = [];
  for (const r of nodes) {
    const src = await readFile(resolve(projectRoot2, r.file ?? ""), "utf-8");
    const raws = /* @__PURE__ */ new Set();
    for (const re of [HREF_RE, PATHNAME_RE, ROUTER_RE]) {
      for (const m of src.matchAll(re)) {
        raws.add(m[1]);
      }
    }
    for (const raw of raws) {
      let t = raw.split(/[?#]/)[0];
      if (/^(https?|mailto|tel):/.test(t)) continue;
      if (isUpwardHref(t)) continue;
      if (!t.startsWith("/")) {
        t = posix.normalize(posix.join(posix.dirname(r.urlPath), t));
        if (!t.startsWith("/")) t = "/" + t;
      }
      if (t === "") t = "/";
      const probe = t.split("/").filter((s) => !(s.startsWith("(") && s.endsWith(")"))).join("/").replace(/\$\{[^}]*\}/g, "X") || "/";
      const hit = matchers.find((m) => m.re.test(probe));
      const kind = hit?.route.presentation && /modal/i.test(hit.route.presentation) ? "modal" : "push";
      edges.push({ from: r.id, to: hit?.route.id ?? null, raw, target: t, kind });
    }
  }
  console.log(`[app-flow] parse: ${edges.length} edges built (${Date.now() - startedAt}ms)`);
  const appConfig = await readAppConfig(projectRoot2);
  const parentDir = (dir) => {
    if (!dir) return null;
    const segments = dir.split("/");
    segments.pop();
    return segments.join("/");
  };
  const layoutDirs = Object.keys(layoutsByDir);
  const layouts = layoutDirs.map((dir) => {
    const parent = parentDir(dir);
    return {
      name: dir || "/",
      navigator: layoutsByDir[dir].navigator ?? "Stack",
      parent: parent === null ? null : parent || "/"
    };
  });
  const chromeDir = layoutDirs.filter((dir) => /Tabs|Drawer/i.test(layoutsByDir[dir].navigator ?? "")).sort((a, b) => a.split("/").length - b.split("/").length)[0];
  const entryLayouts = chromeDir === void 0 ? [] : layoutDirs.filter((dir) => dir !== chromeDir && parentDir(dir) === chromeDir);
  const entryScreenIds = (chromeDir === void 0 ? [""] : entryLayouts).map((dir) => {
    const inGroup = nodes.filter((node) => node.group === dir);
    return (inGroup.find((node) => posix.basename(node.id) === "index") ?? inGroup[0])?.id ?? null;
  }).filter((id2) => id2 !== null);
  return {
    mode: "expo-router",
    appDir: rel(appDir),
    routesFile: null,
    scheme: appConfig.scheme,
    // Expo Router generates its own linking config from the file tree and the scheme is wired in
    // by the same tool, so there is no separate `prefixes` array to cross-check it against the way
    // React Navigation apps need — it is always assumed to work, as every route here already was.
    deepLinkConfidence: "assumed",
    linkingPrefixes: [],
    appName: appConfig.name,
    bundleId: appConfig.bundleId,
    slug: appConfig.slug,
    nodes,
    edges: finalizeEdges(edges),
    layouts,
    rootNavigator: layoutsByDir[""]?.navigator ?? null,
    entryLayouts,
    entryScreenIds
  };
}
function readJsxTag(src, start) {
  let braces = 0;
  let quote = null;
  for (let i = start; i < src.length; i++) {
    const char = src[i];
    if (quote) {
      if (char === "\\") i++;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") quote = char;
    else if (char === "{") braces++;
    else if (char === "}") braces--;
    else if (char === ">" && braces === 0) return src.slice(start, i + 1);
  }
  return src.slice(start);
}
function objectBlockAfter(src, key2, from = 0) {
  const at = key2 ? src.indexOf(key2, from) : from;
  if (at < 0) return null;
  const open2 = src.indexOf("{", at);
  if (open2 < 0) return null;
  let depth = 0;
  let quote = null;
  for (let i = open2; i < src.length; i++) {
    const char = src[i];
    if (quote) {
      if (char === "\\") i++;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") quote = char;
    else if (char === "{") depth++;
    else if (char === "}" && --depth === 0) return { body: src.slice(open2 + 1, i), end: i };
  }
  return null;
}
function propertyObjectBlock(src, key2) {
  const match = new RegExp(`\\b${key2}\\s*:`).exec(src);
  return match ? objectBlockAfter(src, "", match.index + match[0].length) : null;
}
var ROUTE_HELPER_CALL_RE = /\b([A-Za-z_$][\w$]*(?:Link|Path|Route|Url|URL))\s*\(([^()]*)\)/g;
function literalRouteSegments(path) {
  return path.split("/").filter((segment) => segment && !segment.startsWith(":") && !segment.startsWith("*"));
}
function routeSegmentLiterals(args) {
  return [...args.matchAll(/['"`]([a-z][a-z0-9-]*)['"`]/g)].map((match) => match[1]);
}
function resolveRouteHelperCall(segments, candidates) {
  if (segments.length === 0) return null;
  const matches = candidates.filter(
    (candidate) => candidate.segments.length >= segments.length && segments.every(
      (segment, index) => candidate.segments[candidate.segments.length - segments.length + index] === segment
    )
  );
  return matches.length === 1 ? matches[0].node : null;
}
function normalizeRoutePath(path) {
  const withoutQuery = path.split(/[?#]/)[0];
  const normalized = withoutQuery.split("/").map((segment) => segment.startsWith(":") ? ":param" : segment).join("/").replace(/\/+$/, "");
  return normalized || "/";
}
function joinRoutePath(prefix, segment) {
  const value = `${prefix.replace(/\/$/, "")}/${segment.replace(/^\//, "")}`.replace(/\/+/g, "/");
  return value.startsWith("/") ? value : `/${value}`;
}
function arrayBlockAfter(src, key2) {
  const match = new RegExp(`\\b${key2}\\s*:\\s*\\[`).exec(src);
  if (!match) return null;
  const open2 = match.index + match[0].length - 1;
  let depth = 0;
  for (let i = open2; i < src.length; i++) {
    const char = src[i];
    if (char === "[") depth++;
    else if (char === "]" && --depth === 0) return { body: src.slice(open2 + 1, i), end: i };
  }
  return null;
}
function parsePrefixes(src) {
  const block = arrayBlockAfter(src, "prefixes");
  if (!block) return [];
  return [...block.body.matchAll(/["'`]([^"'`]+)["'`]/g)].map((m) => m[1]);
}
function selectDeepLinkScheme(prefixes, expoScheme) {
  const customSchemes = prefixes.map((prefix) => prefix.match(/^([A-Za-z][\w+.-]*):\/\//)?.[1] ?? null).filter((s) => s !== null && !/^https?$/i.test(s));
  if (customSchemes.length === 0) {
    return { scheme: expoScheme, confidence: "assumed" };
  }
  if (expoScheme && customSchemes.includes(expoScheme)) {
    return { scheme: expoScheme, confidence: "verified-prefix" };
  }
  if (!expoScheme) {
    return { scheme: customSchemes[0], confidence: "assumed" };
  }
  return { scheme: customSchemes[0], confidence: "scheme-mismatch" };
}
function parseLinkingScreens(body, prefix = "") {
  const paths = {};
  const entry = /([A-Za-z_$][\w$]*)\s*:\s*/g;
  let match;
  while (match = entry.exec(body)) {
    const name2 = match[1];
    const rest = body.slice(entry.lastIndex);
    const literal = rest.match(/^["'`]([^"'`]*)["'`]/);
    if (literal) {
      paths[name2] = joinRoutePath(prefix, literal[1]);
      continue;
    }
    if (!rest.trimStart().startsWith("{")) continue;
    const block = objectBlockAfter(body, "", entry.lastIndex - 1);
    if (!block) continue;
    const path = block.body.match(/\bpath\s*:\s*["'`]([^"'`]*)["'`]/)?.[1];
    const here = path == null ? prefix : joinRoutePath(prefix, path);
    if (path != null) paths[name2] = here || "/";
    const nested = propertyObjectBlock(block.body, "screens");
    if (nested) Object.assign(paths, parseLinkingScreens(nested.body, here));
    entry.lastIndex = block.end + 1;
  }
  return paths;
}
function enclosingJsxTag(src, at) {
  const floor = Math.max(0, at - 1200);
  for (let i = at; i >= floor; i--) {
    if (src[i] !== "<") continue;
    if (!/[A-Za-z_$]/.test(src[i + 1] ?? "")) continue;
    const tag = readJsxTag(src, i);
    if (i + tag.length > at) return tag;
    return null;
  }
  return null;
}
function cleanTriggerText(value) {
  return value.replace(/^\{+|\}+$/g, "").replace(/^[A-Za-z_$][\w$]*`|`$/g, "").replace(/^["'`]|["'`]$/g, "").replace(/\s+/g, " ").trim();
}
function extractTrigger(src, at) {
  const tag = enclosingJsxTag(src, at);
  if (!tag) return null;
  const id2 = tag.match(/\btestID\s*=\s*(?:\{\s*)?["'`]([^"'`]+)["'`]/)?.[1];
  if (id2) return { by: "id", value: id2 };
  const label = tag.match(
    /\b(?:label|title|accessibilityLabel|aria-label)\s*=\s*(\{[^}]*\}|["'`][^"'`]*["'`])/
  )?.[1];
  const cleanedLabel = label ? cleanTriggerText(label) : "";
  if (cleanedLabel && !/[${}]/.test(cleanedLabel)) return { by: "label", value: cleanedLabel };
  const tagStart = src.indexOf(tag, Math.max(0, at - 1200));
  const body = src.slice(tagStart + tag.length, tagStart + tag.length + 400);
  const text2 = body.match(/^\s*([A-Za-z][^<{]{2,60})/)?.[1] ?? body.match(/<(?:Trans|Text)[^>]*>\s*([A-Za-z][^<{]{1,60})/)?.[1] ?? null;
  const cleanedText = text2 ? cleanTriggerText(text2) : "";
  return cleanedText ? { by: "text", value: cleanedText } : null;
}
function parseRouteMap(body) {
  const paths = {};
  for (const match of body.matchAll(/([A-Za-z_$][\w$]*)\s*:\s*(?:\[\s*)?["'`]([^"'`]*)["'`]/g)) {
    if (!match[2].startsWith("/")) continue;
    paths[match[1]] ??= match[2];
  }
  return paths;
}
async function projectDependencies(projectRoot2) {
  try {
    const pkg = JSON.parse(await readFile(join2(projectRoot2, "package.json"), "utf-8"));
    return { ...pkg.devDependencies, ...pkg.dependencies };
  } catch {
    return {};
  }
}
async function reactNavigationSourceFiles(projectRoot2) {
  for (const dir of ["src", "app", "screens", "navigation"]) {
    try {
      const root = join2(projectRoot2, dir);
      if (!(await stat(root)).isDirectory()) continue;
      return (await walk(root)).filter((file) => SOURCE_EXTS.includes(extname(file)));
    } catch {
    }
  }
  return [];
}
function enclosingFunctionName(src, index) {
  const before = src.slice(0, index);
  const declarations = [
    ...before.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g),
    ...before.matchAll(
      /\bconst\s+([A-Za-z_$][\w$]*)\s*(?::[^=]*)?=\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g
    )
  ].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  return declarations.at(-1)?.[1] ?? null;
}
function resolveScreenName(raw, scalars, objects) {
  const literal = raw.match(/^["'`]([^"'`]+)["'`]$/);
  if (literal) return literal[1];
  const cast = raw.match(/^["'`]([^"'`]+)["'`]\s+as\s+/);
  if (cast) return cast[1];
  const member = raw.match(/^([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)$/);
  if (member) return objects[member[1]]?.[member[2]] ?? null;
  return scalars[raw] ?? null;
}
function enclosingHelperFunction(src, index, paramName) {
  const before = src.slice(0, index);
  let found = null;
  for (const match of before.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/g)) {
    const params = match[2].split(",").map((p) => p.trim().split(/[:\s=]/)[0]);
    if (params.includes(paramName)) found = match[1];
  }
  return found;
}
function resolveHelperCaller(src, file, matchIndex, paramName, navigatorTypes, helperCallerCache) {
  const fnName2 = enclosingHelperFunction(src, matchIndex, paramName);
  if (!fnName2) return { key: null, all: [] };
  const cacheKey = `${file}::${fnName2}`;
  let callerKeys = helperCallerCache.get(cacheKey);
  if (callerKeys === void 0) {
    callerKeys = [];
    const seen = /* @__PURE__ */ new Set();
    const callRe = new RegExp(`\\b${escapeRe(fnName2)}\\s*\\(\\s*([A-Za-z_$][\\w$]*)`, "g");
    for (const call of src.matchAll(callRe)) {
      const before = src.slice(Math.max(0, call.index - 20), call.index);
      if (/\bfunction\s*$/.test(before)) continue;
      const key2 = `${file}::${call[1]}`;
      if (navigatorTypes[key2] === void 0 || seen.has(key2)) continue;
      seen.add(key2);
      callerKeys.push(key2);
    }
    helperCallerCache.set(cacheKey, callerKeys);
  }
  return { key: callerKeys[0] ?? null, all: callerKeys };
}
async function parseReactNavigation(projectRoot2) {
  const files = await reactNavigationSourceFiles(projectRoot2);
  if (!files.length) return null;
  const sources = /* @__PURE__ */ new Map();
  await Promise.all(files.map(async (file) => sources.set(file, await readFile(file, "utf-8"))));
  const scalars = {};
  const objects = {};
  for (const src of sources.values()) {
    for (const match of src.matchAll(
      /\bexport\s+const\s+([A-Za-z_$][\w$]*)\s*(?::[^=]*)?=\s*["'`]([^"'`]+)["'`]/g
    ))
      scalars[match[1]] ??= match[2];
    for (const match of src.matchAll(
      /\bexport\s+const\s+([A-Za-z_$][\w$]*)\s*(?::[^=]*)?=\s*\{([^}]*)\}/g
    )) {
      const members = {};
      for (const member of match[2].matchAll(/([A-Za-z_$][\w$]*)\s*:\s*["'`]([^"'`]+)["'`]/g))
        members[member[1]] = member[2];
      if (Object.keys(members).length) objects[match[1]] ??= members;
    }
  }
  const navigatorTypes = {};
  const helperCallerCache = /* @__PURE__ */ new Map();
  const navigatorRenderers = {};
  const initialRouteNameByNavigatorKey = {};
  const screens = [];
  let linkingFile = null;
  let linkingPaths = {};
  let linkingPrefixes = [];
  let prefixesFile = null;
  let routeMapFile = null;
  const routeMapPaths = {};
  for (const [file, src] of sources) {
    for (const match of src.matchAll(
      /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*(create[A-Za-z]*Navigator[A-Za-z]*)\s*(?:<[^>]*>)?\s*\(/g
    )) {
      navigatorTypes[`${file}::${match[1]}`] = classifyNavigatorFactory(match[2]);
    }
    for (const match of src.matchAll(/<([A-Za-z_$][\w$]*)\.Navigator\b/g)) {
      const navigatorKey = `${file}::${match[1]}`;
      navigatorRenderers[navigatorKey] = enclosingFunctionName(src, match.index);
      const tag = readJsxTag(src, match.index);
      const rawInitial = (tag.match(/\binitialRouteName\s*=\s*(?:\{([^}]*)\}|("(?:[^"]*)"|'(?:[^']*)'))/)?.slice(1).find(Boolean) ?? "").trim();
      const initialName = rawInitial ? resolveScreenName(rawInitial, scalars, objects) : null;
      if (initialName) initialRouteNameByNavigatorKey[navigatorKey] = initialName;
    }
    if (!linkingFile && /\b(linking|prefixes)\b/.test(src) && /\bscreens\s*:/.test(src)) {
      const block = propertyObjectBlock(src, "screens");
      if (block) {
        linkingFile = relative(projectRoot2, file).split(/[/\\]/).join("/");
        linkingPaths = parseLinkingScreens(block.body);
      }
    }
    if (!prefixesFile) {
      const prefixes = parsePrefixes(src);
      if (prefixes.length) {
        prefixesFile = file;
        linkingPrefixes = prefixes;
      }
    }
    const routerMatch = /\bnew\s+\w*Router\s*(?:<[^>]*>)?\s*\(/.exec(src);
    if (routerMatch) {
      const block = objectBlockAfter(src, "", routerMatch.index + routerMatch[0].length - 1);
      const mapped = block ? parseRouteMap(block.body) : {};
      if (Object.keys(mapped).length >= 3) {
        routeMapFile ??= relative(projectRoot2, file).split(/[/\\]/).join("/");
        for (const [name2, path] of Object.entries(mapped)) routeMapPaths[name2] ??= path;
      }
    }
    for (const match of src.matchAll(/<([A-Za-z_$][\w$]*)\.Screen\b/g)) {
      const tag = readJsxTag(src, match.index);
      if (!/\b(?:component|getComponent)\s*=\s*\{/.test(tag)) continue;
      const rawName = (tag.match(/\bname\s*=\s*(?:\{([^}]*)\}|("(?:[^"]*)"|'(?:[^']*)'))/)?.slice(1).find(Boolean) ?? "").trim();
      const name2 = resolveScreenName(rawName, scalars, objects);
      if (!name2) continue;
      const component = tag.match(/\bcomponent\s*=\s*\{\s*([A-Za-z_$][\w$]*)\s*\}/)?.[1] ?? tag.match(/\bgetComponent\s*=\s*\{\s*\(\)\s*=>\s*([A-Za-z_$][\w$]*)\s*\}/)?.[1] ?? null;
      const tagOwner = match[1];
      let key2 = `${file}::${tagOwner}`;
      let navigatorType = navigatorTypes[key2];
      let helperCallers = null;
      if (navigatorType === void 0) {
        const helper = resolveHelperCaller(
          src,
          file,
          match.index,
          tagOwner,
          navigatorTypes,
          helperCallerCache
        );
        if (helper.key) {
          key2 = helper.key;
          navigatorType = navigatorTypes[helper.key];
          if (helper.all.length > 1) helperCallers = helper.all;
        } else {
          navigatorType = "react-navigation";
        }
      }
      screens.push({
        name: name2,
        component,
        navigatorKey: key2,
        navigatorType,
        helperCallers,
        registrationFile: file,
        presentation: tag.match(/\bpresentation\s*:\s*["'`]([A-Za-z]+)["'`]/)?.[1] ?? null
      });
    }
  }
  if (!screens.length) return null;
  const appConfig = await readAppConfig(projectRoot2);
  const { scheme: deepLinkScheme, confidence: deepLinkConfidence } = selectDeepLinkScheme(
    linkingPrefixes,
    appConfig.scheme
  );
  const mountedNavigator = /* @__PURE__ */ new Map();
  const mountName = /* @__PURE__ */ new Map();
  for (const screen of screens) {
    if (!screen.component) continue;
    for (const [key2, renderer] of Object.entries(navigatorRenderers)) {
      if (renderer !== screen.component) continue;
      mountedNavigator.set(screen.name, key2);
      mountName.set(key2, screen.name);
    }
  }
  const containers = new Set(mountedNavigator.keys());
  const tabContainerNames = new Set(
    screens.filter(
      (screen) => containers.has(screen.name) && /Tabs/.test(navigatorTypes[screen.navigatorKey] ?? "")
    ).map((screen) => screen.name)
  );
  const tabRootNodeIds = /* @__PURE__ */ new Set();
  function classifyEdgeKind(source, target2, isReplace) {
    if (target2.presentation && /modal/i.test(target2.presentation)) return "modal";
    if (isReplace) return "replace";
    if (tabRootNodeIds.has(target2.id) && source.id !== target2.id) return "tab-switch";
    const sharesGroup = source.groups.some((layout) => target2.groups.includes(layout));
    const touchesTab = [...source.groups, ...target2.groups].some(
      (layout) => tabContainerNames.has(layout)
    );
    if (!sharesGroup && touchesTab) return "tab-switch";
    return "push";
  }
  const firstChild = /* @__PURE__ */ new Map();
  for (const [container, navigatorKey] of mountedNavigator) {
    const declared = initialRouteNameByNavigatorKey[navigatorKey];
    const registered = screens.filter((screen) => screen.navigatorKey === navigatorKey);
    const child = (declared ? registered.find((screen) => screen.name === declared) : void 0) ?? registered.find((screen) => !GUARD_FALLBACK_RE.test(screen.name)) ?? registered[0];
    if (child) firstChild.set(container, child.name);
  }
  const aliases = await loadPathAliases(projectRoot2);
  const counts = /* @__PURE__ */ new Map();
  screens.forEach((screen) => counts.set(screen.name, (counts.get(screen.name) ?? 0) + 1));
  const seen = /* @__PURE__ */ new Set();
  const nodes = [];
  const screenNames = /* @__PURE__ */ new Map();
  const componentFiles = /* @__PURE__ */ new Map();
  const screenByNavigatorAndName = /* @__PURE__ */ new Map();
  const nodesByMergeKey = /* @__PURE__ */ new Map();
  for (const screen of screens) {
    if (containers.has(screen.name)) continue;
    const layoutName = mountName.get(screen.navigatorKey) ?? screen.navigatorType;
    const src = sources.get(screen.registrationFile) ?? "";
    const spec = screen.component ? [
      ...src.matchAll(
        /import\s+(?:([A-Za-z_$][\w$]*)\s*,?\s*)?(?:\{([^}]*)\})?\s*from\s*["']([^"']+)["']/g
      )
    ].find(
      (match) => match[1] === screen.component || (match[2] ?? "").split(",").some(
        (part) => part.trim().split(/\s+as\s+/).pop() === screen.component
      )
    )?.[3] : null;
    let componentFile = spec ? await resolveImport(screen.registrationFile, spec, aliases) : null;
    if (!componentFile && screen.component && new RegExp(`(?:function|class|const|let|var)\\s+${escapeRe(screen.component)}\\b`).test(src)) {
      componentFile = screen.registrationFile;
    }
    const urlPath = linkingPaths[screen.name] ?? routeMapPaths[screen.name] ?? null;
    const registeredUnderKeys = screen.helperCallers ?? [screen.navigatorKey];
    const groups = registeredUnderKeys.map(
      (navKey) => mountName.get(navKey) ?? navKey.split("::")[1] ?? navKey
    );
    const mergeKey = componentFile ? `${componentFile}\0${urlPath ?? ""}\0${screen.name}` : null;
    const existingNode = mergeKey ? nodesByMergeKey.get(mergeKey) : void 0;
    if (existingNode) {
      for (const layout of groups) {
        if (!existingNode.groups.includes(layout)) existingNode.groups.push(layout);
      }
      if (!screenNames.has(screen.name)) screenNames.set(screen.name, existingNode);
      for (const navKey of registeredUnderKeys) {
        screenByNavigatorAndName.set(`${navKey}::${screen.name}`, existingNode.id);
      }
      continue;
    }
    let id2 = counts.get(screen.name) > 1 ? `${layoutName}/${screen.name}` : screen.name;
    while (seen.has(id2)) id2 += "_";
    seen.add(id2);
    const componentSrc = componentFile ? await readFile(componentFile, "utf-8") : "";
    const group = layoutName;
    const node = {
      id: id2,
      urlPath,
      // A route with no static path is navigation-only regardless of confidence. One that does have
      // a path is only truly `deep-link` when React Navigation will route it — a `scheme-mismatch`
      // means the URL opens the app and then goes nowhere, which is not a deep link in any useful
      // sense, so it must not be claimed as one.
      reach: urlPath && deepLinkConfidence !== "scheme-mismatch" ? "deep-link" : "navigation-only",
      title: screen.name,
      file: componentFile ? relative(projectRoot2, componentFile).split(/[/\\]/).join("/") : null,
      slug: generateSlug(id2),
      group,
      groups,
      navigator: screen.navigatorType,
      params: urlPath ? urlPath.split("/").filter((segment) => segment.startsWith(":")).map((segment) => segment.slice(1)) : [],
      presentation: screen.presentation,
      guard: extractGuard(componentSrc),
      capture: null
    };
    nodes.push(node);
    if (mergeKey) nodesByMergeKey.set(mergeKey, node);
    if (componentFile) componentFiles.set(id2, componentFile);
    if (!screenNames.has(screen.name)) screenNames.set(screen.name, node);
    for (const navKey of registeredUnderKeys) {
      screenByNavigatorAndName.set(`${navKey}::${screen.name}`, id2);
    }
  }
  for (const [container, child] of firstChild) {
    const target2 = screenNames.get(child);
    if (!target2) continue;
    if (!screenNames.has(container)) screenNames.set(container, target2);
    if (tabContainerNames.has(container)) tabRootNodeIds.add(target2.id);
  }
  const edges = [];
  const nodesByUrlPath = /* @__PURE__ */ new Map();
  for (const candidate of nodes) {
    if (candidate.urlPath) nodesByUrlPath.set(normalizeRoutePath(candidate.urlPath), candidate);
  }
  const routeCandidates = nodes.filter((candidate) => candidate.urlPath).map((candidate) => ({ node: candidate, segments: literalRouteSegments(candidate.urlPath) })).filter((candidate) => candidate.segments.length > 0);
  for (const node of nodes) {
    const abs = componentFiles.get(node.id) ?? null;
    const source = abs ? sources.get(abs) ?? await readFile(abs, "utf-8").catch(() => "") : "";
    const edgeSources = [source];
    if (abs) {
      for (const imported of source.matchAll(IMPORT_RE)) {
        const resolvedImport = await resolveImport(abs, imported[1], aliases);
        if (!resolvedImport) continue;
        const importedSource = sources.get(resolvedImport) ?? await readFile(resolvedImport, "utf-8").catch(() => "");
        if (importedSource) edgeSources.push(importedSource);
      }
    }
    const found = /* @__PURE__ */ new Set();
    for (const edgeSource of edgeSources) {
      for (const match of edgeSource.matchAll(
        /\b(navigate|push|replace|jumpTo)\(\s*["'`]([^"'`]+)["'`]/g
      )) {
        const target2 = screenNames.get(match[2]);
        if (!target2 || found.has(target2.id)) continue;
        found.add(target2.id);
        edges.push({
          from: node.id,
          to: target2.id,
          raw: `${match[1]}('${match[2]}')`,
          target: target2.urlPath ?? target2.id,
          trigger: extractTrigger(edgeSource, match.index),
          kind: classifyEdgeKind(node, target2, match[1] === "replace")
        });
      }
      for (const match of edgeSource.matchAll(/\b(?:to|href)\s*=\s*["'`](\/[^"'`{}]*)["'`]/g)) {
        const target2 = nodesByUrlPath.get(normalizeRoutePath(match[1]));
        if (!target2 || target2.id === node.id || found.has(target2.id)) continue;
        found.add(target2.id);
        edges.push({
          from: node.id,
          to: target2.id,
          raw: `to="${match[1]}"`,
          target: target2.urlPath ?? target2.id,
          trigger: extractTrigger(edgeSource, match.index),
          kind: classifyEdgeKind(node, target2, false)
        });
      }
      for (const match of edgeSource.matchAll(ROUTE_HELPER_CALL_RE)) {
        const segments = routeSegmentLiterals(match[2]);
        const target2 = resolveRouteHelperCall(segments, routeCandidates);
        if (!target2 || target2.id === node.id || found.has(target2.id)) continue;
        found.add(target2.id);
        edges.push({
          from: node.id,
          to: target2.id,
          raw: `${match[1]}(\u2026'${segments.join("', '")}')`,
          target: target2.urlPath ?? target2.id,
          trigger: extractTrigger(edgeSource, match.index),
          kind: classifyEdgeKind(node, target2, false)
        });
      }
    }
  }
  const mountedKeys = new Set(mountedNavigator.values());
  const navigatorKeys = new Set(screens.map((screen) => screen.navigatorKey));
  const parentOfNavigator = /* @__PURE__ */ new Map();
  for (const [container, navigatorKey] of mountedNavigator) {
    const containerScreen = screens.find((screen) => screen.name === container);
    if (containerScreen) parentOfNavigator.set(navigatorKey, containerScreen.navigatorKey);
  }
  const unmounted = [...navigatorKeys].filter((key2) => !mountedKeys.has(key2));
  const rootKey = unmounted.find((key2) => /Tabs|Drawer/.test(navigatorTypes[key2] ?? "")) ?? unmounted[0] ?? null;
  const layouts = [...navigatorKeys].map((key2) => {
    const parentKey = parentOfNavigator.get(key2);
    return {
      name: mountName.get(key2) ?? key2.split("::")[1] ?? key2,
      navigator: navigatorTypes[key2] ?? "react-navigation",
      parent: parentKey ? mountName.get(parentKey) ?? parentKey.split("::")[1] ?? null : null
    };
  });
  const entryLayouts = screens.filter((screen) => screen.navigatorKey === rootKey && containers.has(screen.name)).map((screen) => screen.name);
  const entryChromeNavigatorKeys = /* @__PURE__ */ new Set();
  if (rootKey) entryChromeNavigatorKeys.add(rootKey);
  for (const name2 of entryLayouts) {
    const childKey = mountedNavigator.get(name2);
    if (childKey) entryChromeNavigatorKeys.add(childKey);
  }
  const entryScreenIds = [...entryChromeNavigatorKeys].map((navigatorKey) => {
    const initialName = initialRouteNameByNavigatorKey[navigatorKey];
    if (initialName) {
      return containers.has(initialName) ? null : screenByNavigatorAndName.get(`${navigatorKey}::${initialName}`) ?? null;
    }
    const first = screens.find(
      (screen) => screen.navigatorKey === navigatorKey && !containers.has(screen.name)
    );
    return first ? screenByNavigatorAndName.get(`${navigatorKey}::${first.name}`) ?? null : null;
  }).filter((id2) => id2 !== null);
  return {
    mode: "react-navigation",
    appDir: null,
    routesFile: linkingFile ?? routeMapFile,
    scheme: deepLinkScheme,
    deepLinkConfidence,
    linkingPrefixes,
    appName: appConfig.name,
    bundleId: appConfig.bundleId,
    slug: appConfig.slug,
    nodes,
    edges: finalizeEdges(edges),
    layouts,
    rootNavigator: rootKey ? navigatorTypes[rootKey] ?? null : null,
    entryLayouts,
    entryScreenIds
  };
}
async function parseProject(projectRoot2) {
  setTypeScriptProject(projectRoot2);
  const dependencies = await projectDependencies(projectRoot2);
  const candidates = ["app", "src/app"].map((d) => join2(projectRoot2, d));
  if (dependencies["expo-router"])
    for (const appDir of candidates) {
      try {
        const s = await stat(appDir);
        if (s.isDirectory()) {
          console.log(`[app-flow] parse: using Expo Router app dir ${appDir}`);
          return await parseExpoRouter(projectRoot2, appDir);
        }
        console.log(`[app-flow] parse: ${appDir} exists but is not a directory`);
      } catch {
        console.log(`[app-flow] parse: no ${appDir}`);
      }
    }
  const reactNavigation = await parseReactNavigation(projectRoot2);
  if (reactNavigation) return reactNavigation;
  console.log(`[app-flow] parse: no supported router evidence under ${projectRoot2}`);
  return null;
}

// packages/core/src/app-flow/orchestrator.ts
import { EventEmitter } from "node:events";
import { createHash as createHash8, randomUUID as randomUUID3 } from "node:crypto";
import { copyFile, readFile as readFile6, unlink as unlink3 } from "node:fs/promises";
import { basename as basename3, isAbsolute as isAbsolute3, join as join11 } from "node:path";

// packages/shared/src/app-flow.ts
function emptyTokenUsage() {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, total: 0, cost: 0 };
}
function carriedSweepDurationMs(previous, chainContinues) {
  if (!chainContinues || !previous) return 0;
  return previous.cumulativeDurationMs ?? previous.durationMs ?? 0;
}
function addTokenUsage(base, delta) {
  return {
    input: (base?.input ?? 0) + delta.input,
    output: (base?.output ?? 0) + delta.output,
    cacheRead: (base?.cacheRead ?? 0) + delta.cacheRead,
    cacheWrite: (base?.cacheWrite ?? 0) + delta.cacheWrite,
    reasoning: (base?.reasoning ?? 0) + delta.reasoning,
    total: (base?.total ?? 0) + delta.total,
    cost: (base?.cost ?? 0) + delta.cost
  };
}

// packages/core/src/app-flow/decision-provider.ts
function parseSubAgentJson(text2, validate) {
  const candidates = [];
  let start = -1, depth = 0, inString = false, escaped = false;
  for (let index = 0; index < text2.length; index += 1) {
    const char = text2[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") {
      if (depth === 0) start = index;
      depth += 1;
    } else if (char === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) candidates.push(text2.slice(start, index + 1));
    }
  }
  for (const candidate of candidates.reverse()) {
    try {
      const value = JSON.parse(candidate);
      if (!validate || validate(value)) return value;
    } catch {
    }
  }
  return null;
}

// packages/core/src/app-flow-deps/pi/usage.ts
function snapshotUsage(totals) {
  return { ...totals };
}

// packages/core/src/app-flow/capture.ts
import { spawn } from "node:child_process";
import { setTimeout as sleep2 } from "node:timers/promises";
import { existsSync as existsSync2 } from "node:fs";
import { readdir as readdir4, readFile as readFile4, writeFile as writeFile3 } from "node:fs/promises";
import { homedir } from "node:os";
import { basename as basename2, isAbsolute, join as join7 } from "node:path";

// packages/core/src/app-flow-deps/ios/scheme-approval.ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
var execFileAsync = promisify(execFile);
var APPROVAL_DOMAIN = "com.apple.launchservices.schemeapproval";
var APPROVAL_KEY_PREFIX = "com.apple.CoreSimulator.CoreSimulatorBridge-->";
var OPEN_IN_PROMPT_RE = /\bopen in\b/i;
var OPEN_IN_PROMPT_TIMEOUT_MS = 15e3;
var schemeApprovals = /* @__PURE__ */ new Map();
function preapprovalKey(udid, scheme) {
  return `${udid}\0${scheme.toLowerCase()}`;
}
function isUrlSchemePreapproved(udid, url) {
  const scheme = urlSchemeFromUrl(url);
  if (!scheme || !udid?.trim()) return false;
  return schemeApprovals.get(preapprovalKey(udid, scheme)) === "approved";
}
function markUrlSchemeApproved(udid, url) {
  const scheme = urlSchemeFromUrl(url);
  if (!scheme || !udid?.trim()) return;
  schemeApprovals.set(preapprovalKey(udid, scheme), "approved");
}
function urlSchemeFromUrl(url) {
  const trimmed = url.trim();
  if (!trimmed) return null;
  try {
    return new URL(trimmed).protocol.replace(/:$/, "") || null;
  } catch {
    const match = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(trimmed);
    return match?.[1] ?? null;
  }
}
function shouldPreapproveUrlScheme(url) {
  const scheme = urlSchemeFromUrl(url)?.toLowerCase();
  return Boolean(scheme) && scheme !== "http" && scheme !== "https";
}
function schemeApprovalKey(scheme) {
  return `${APPROVAL_KEY_PREFIX}${scheme}`;
}
function collectPromptText(payload) {
  if (payload == null) return "";
  if (typeof payload === "string") return payload;
  if (typeof payload === "number" || typeof payload === "boolean") return String(payload);
  if (Array.isArray(payload)) return payload.map(collectPromptText).join(" ");
  if (typeof payload === "object") {
    return Object.values(payload).map(collectPromptText).join(" ");
  }
  return "";
}
async function preapproveIosUrlScheme(options) {
  if (!shouldPreapproveUrlScheme(options.url)) return false;
  const scheme = urlSchemeFromUrl(options.url);
  if (!scheme || !options.udid.trim() || !options.bundleId.trim()) return false;
  try {
    if (options.writeApproval) {
      await options.writeApproval({ udid: options.udid, scheme, bundleId: options.bundleId });
    } else {
      await execFileAsync("xcrun", [
        "simctl",
        "spawn",
        options.udid,
        "defaults",
        "write",
        APPROVAL_DOMAIN,
        schemeApprovalKey(scheme),
        "-string",
        options.bundleId
      ]);
    }
    const key2 = preapprovalKey(options.udid, scheme);
    if (schemeApprovals.get(key2) !== "approved") schemeApprovals.set(key2, "pending");
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `[ios] could not preapprove ${scheme} for ${options.bundleId} on ${options.udid}: ${message}`
    );
    return false;
  }
}
async function acceptOpenInAppPrompt(client) {
  let info;
  try {
    info = await client.command.alert({
      action: "get",
      platform: "ios",
      timeoutMs: OPEN_IN_PROMPT_TIMEOUT_MS
    });
  } catch {
    return "absent";
  }
  const text2 = collectPromptText(info);
  if (text2 && !OPEN_IN_PROMPT_RE.test(text2)) return "skipped";
  try {
    await client.command.alert({
      action: "accept",
      platform: "ios",
      timeoutMs: OPEN_IN_PROMPT_TIMEOUT_MS
    });
    return "accepted";
  } catch {
    try {
      await client.interactions.press({ selector: 'text="Open"', platform: "ios" });
      return "accepted";
    } catch {
      return "skipped";
    }
  }
}

// packages/core/src/app-flow-deps/ios/runner-busy.ts
var RUNNER_BUSY_RETRIES = 3;
var RUNNER_BUSY_BACKOFF_MS = [5e3, 12e3, 25e3];
function isRunnerBusyError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /RUNNER_BUSY|still finishing a previous command/i.test(message);
}
function sleep(ms) {
  return new Promise((resolve3) => setTimeout(resolve3, ms));
}
async function retryWhileRunnerBusy(work, options = {}) {
  const retries = options.retries ?? RUNNER_BUSY_RETRIES;
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await work();
    } catch (error) {
      if (!isRunnerBusyError(error) || attempt >= retries) throw error;
      const waitMs = RUNNER_BUSY_BACKOFF_MS[Math.min(attempt, RUNNER_BUSY_BACKOFF_MS.length - 1)];
      if (options.deadlineAt !== void 0 && waitMs >= options.deadlineAt - Date.now()) throw error;
      options.onRetry?.(attempt + 1, waitMs);
      await sleep(waitMs);
      if (options.signal?.aborted) throw new Error("Cancelled");
    }
  }
}

// packages/core/src/app-flow-deps/metro/port.ts
import { createServer } from "node:net";
var METRO_PORT_MIN = 8082;
var METRO_PORT_MAX = 9999;
var RANDOM_PORT_ATTEMPTS = 20;
function isReactNativeCliScript(script) {
  return /\breact-native\s+run-/.test(script) || /\brun-ios\b|\brun-android\b/.test(script);
}
function isExpoProject(pkg) {
  return Boolean(
    pkg.dependencies?.expo || pkg.devDependencies?.expo || pkg.scripts?.start && /\bexpo\b/.test(pkg.scripts.start)
  );
}
function metroStatusUrl(port) {
  return `http://127.0.0.1:${port}/status`;
}
async function isMetroReady(port) {
  try {
    const response = await fetch(metroStatusUrl(port), { signal: AbortSignal.timeout(2e3) });
    const body = await response.text();
    return response.ok && body.includes("packager-status:running");
  } catch {
    return false;
  }
}
function parseMetroPortFromOutput(output) {
  const patterns = [
    /(?:exp|http|https):\/\/(?:127\.0\.0\.1|localhost|\[::1\]):(\d+)/gi,
    /exp:\/\/[^/\s]+:(\d+)/gi,
    /Metro waiting on \S+:(\d+)/gi,
    /\b(?:on )?port (\d{4,5})\b/gi
  ];
  let found = null;
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match;
    while (match = pattern.exec(output)) {
      const port = Number(match[1] || "80");
      if (Number.isInteger(port) && port >= 1 && port <= 65535 && port !== 80 && port !== 443) {
        found = port;
      }
    }
  }
  return found;
}
function bundlerCliArgs(options) {
  if (!options.startBundler) {
    if (options.reactNativeCli) {
      return ["--no-packager", "--port", String(options.port)];
    }
    return ["--no-bundler"];
  }
  return ["--port", String(options.port)];
}
async function findAvailablePort() {
  for (let i = 0; i < RANDOM_PORT_ATTEMPTS; i++) {
    const candidate = METRO_PORT_MIN + Math.floor(Math.random() * (METRO_PORT_MAX - METRO_PORT_MIN + 1));
    if (await isPortFree(candidate)) return candidate;
  }
  return bindEphemeralPort();
}
function isPortFree(port) {
  return new Promise((resolve3) => {
    const server = createServer();
    server.unref();
    server.once("error", () => resolve3(false));
    server.listen(port, "127.0.0.1", () => {
      server.close((error) => resolve3(!error));
    });
  });
}
function bindEphemeralPort() {
  return new Promise((resolve3, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not allocate a TCP port for Metro."));
        return;
      }
      const port = address.port;
      server.close((error) => error ? reject(error) : resolve3(port));
    });
  });
}

// packages/core/src/app-flow-deps/metro/logs.ts
import { createWriteStream } from "node:fs";
import { mkdir, open } from "node:fs/promises";
import { dirname as dirname2, join as join3 } from "node:path";
var openLogs = /* @__PURE__ */ new Map();
function sanitizeSegment(value) {
  const trimmed = value.trim() || "session";
  return trimmed.replace(/[^A-Za-z0-9._-]+/g, "_");
}
function metroLogFilePath(userDataDir, projectId, sessionName) {
  return join3(
    userDataDir,
    "metro-logs",
    sanitizeSegment(projectId),
    `${sanitizeSegment(sessionName)}.log`
  );
}
async function beginSessionMetroLog(options) {
  const path = metroLogFilePath(options.userDataDir, options.projectId, options.sessionName);
  await endMetroLogFile(path);
  await mkdir(dirname2(path), { recursive: true });
  const stream = createWriteStream(path, { flags: "w" });
  stream.on("error", () => void 0);
  openLogs.set(path, stream);
  return path;
}
function pipeChildToMetroLog(path, child) {
  const stream = openLogs.get(path);
  if (!stream) return;
  const write = (chunk) => {
    if (!stream.destroyed && stream.writable) stream.write(chunk);
  };
  child.stdout?.on("data", write);
  child.stderr?.on("data", write);
}
function endMetroLogFile(path) {
  if (!path) return Promise.resolve();
  const stream = openLogs.get(path);
  if (!stream) return Promise.resolve();
  openLogs.delete(path);
  if (stream.destroyed || stream.writableEnded) return Promise.resolve();
  return new Promise((resolve3) => {
    stream.end(() => resolve3());
  });
}

// packages/core/src/app-flow/screen-signals.ts
var LOADING_LABEL_RE = /^(loading|please wait|downloading|bundling|building|starting|connecting|refreshing)\b/i;
function isLoadingScreen(pressables) {
  return pressables.every((pressable) => {
    const text2 = `${pressable.text ?? pressable.label ?? pressable.identifier ?? ""}`.trim();
    return !text2 || LOADING_LABEL_RE.test(text2);
  });
}
function tokenize(source) {
  const out = [];
  for (const word of source.toLowerCase().split(/[^a-z0-9@#']+/)) {
    if (word.length < 3 || /^\d+$/.test(word)) continue;
    out.push(word);
  }
  return out;
}
function fingerprint(pressables) {
  const out = /* @__PURE__ */ new Set();
  for (const pressable of pressables) {
    const source = [pressable.text, pressable.label, pressable.identifier].filter(Boolean).join(" ");
    for (const word of tokenize(source)) out.add(word);
  }
  return out;
}
function similarity(a, b) {
  if (!a.size && !b.size) return 1;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  return shared / (a.size + b.size - shared);
}
function isFrameUnchangedSinceAction(input) {
  if (input.elapsedMs >= input.graceMs) return false;
  return similarity(input.before, input.settled) >= input.similarityFloor;
}
var DEV_LAUNCHER_MARKER_RES = [
  /^development servers$/i,
  /^recently opened$/i,
  /^fetch development servers$/i,
  /\benter url manually\b/i,
  /^start a local development server/i
];
function isDevClientLauncher(pressables) {
  const matched = /* @__PURE__ */ new Set();
  for (const pressable of pressables) {
    for (const source of [pressable.text, pressable.label, pressable.identifier]) {
      const text2 = source?.trim();
      if (!text2) continue;
      DEV_LAUNCHER_MARKER_RES.forEach((re, index) => {
        if (re.test(text2)) matched.add(index);
      });
    }
  }
  return matched.size >= 2;
}
function devClientReconnectUrl(scheme, isNativeBuild, metroPort) {
  if (!isNativeBuild || !scheme || !metroPort) return null;
  return `${scheme}://expo-development-client/?url=${encodeURIComponent(`http://127.0.0.1:${metroPort}`)}`;
}
function needsDevClientReconnect(device) {
  return !device.launchUrl && Boolean(device.devClientUrl);
}

// packages/core/src/app-flow/cli-args.ts
function quoteCliArg(value) {
  if (/^[A-Za-z0-9._:+/=@-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

// packages/core/src/app-flow/walk-commands.ts
var SETTLE = "--settle";
function agentDeviceOpenCommand(app, url) {
  if (url) {
    return `agent-device open ${quoteCliArg(app)} ${quoteCliArg(url)} --platform ios`;
  }
  return `agent-device open ${quoteCliArg(app)} --platform ios`;
}
function pressCommand(selector) {
  return `agent-device press ${quoteCliArg(selector)} ${SETTLE}`;
}
function pressPointCommand(x, y) {
  return `agent-device press ${x} ${y} ${SETTLE}`;
}
function fillCommand(selector, value) {
  return `agent-device fill ${quoteCliArg(selector)} ${quoteCliArg(value)} ${SETTLE}`;
}
function scrollCommand(direction) {
  return `agent-device scroll ${direction} ${SETTLE}`;
}
function baselineLaunchCommands(device, url) {
  return [
    ...device.setupCommands,
    agentDeviceOpenCommand(device.launchTarget, url ?? device.launchUrl)
  ];
}
function walkStepCommand(step) {
  if (step.type === "wait") return null;
  if (step.type === "swipe") return scrollCommand(step.direction ?? "up");
  if (!step.locator) return null;
  const selector = `${step.locator.by}=${JSON.stringify(step.locator.value)}`;
  if (step.type === "input") return fillCommand(selector, step.value ?? "");
  if (step.type === "tap") return pressCommand(selector);
  return null;
}

// packages/core/src/app-flow/launcher-deferral.ts
function launcherDeferralMs(configuredMs, outcome) {
  if (!(configuredMs > 0)) return 0;
  return outcome === "expired" ? 0 : configuredMs;
}

// packages/core/src/app-flow/armed-recording.ts
function armRecording(scriptPath) {
  return { scriptPath, aborted: false };
}
function suppressesSoftHome(armed) {
  return armed !== null && armed !== void 0 && !armed.aborted;
}
function noteOpenWhileArmed(armed) {
  if (!armed || armed.aborted) return false;
  armed.aborted = true;
  return true;
}
function needsRearm(armed) {
  return armed !== null && armed !== void 0 && armed.aborted;
}

// packages/core/src/app-flow/param-store.ts
var SOURCE_RANK = {
  static: 0,
  "nav-state": 1,
  "a11y-learned": 2,
  "a11y-affinity": 3
};
var PARAM_VALUE_RE = /^[\w.~@%-]{1,128}$/;
var SENSITIVE_KEY_RE = /token|password|secret|authorization|cookie/i;
var PROTOTYPE_KEYS = /* @__PURE__ */ new Set(["__proto__", "constructor", "prototype"]);
var MAX_PARAM_KEY_LENGTH = 64;
var MAX_PARAM_VALUE_LENGTH = 128;
var CREDENTIAL_VALUE_RE = /^(?:Bearer\s|eyJ[A-Za-z0-9_-]+\.)/;
function unsafeParamReason(key2, value) {
  if (PROTOTYPE_KEYS.has(key2)) return "prototype-key";
  if (key2.length > MAX_PARAM_KEY_LENGTH) return "key-too-long";
  if (SENSITIVE_KEY_RE.test(key2)) return "sensitive-key";
  if (value.length > MAX_PARAM_VALUE_LENGTH) return "value-too-long";
  if (CREDENTIAL_VALUE_RE.test(value)) return "credential-shaped-value";
  return null;
}
function sharesRouteParams(owner3, target2) {
  if (!owner3 || !target2) return false;
  const ownerSegments = owner3.split("/").filter(Boolean);
  const targetSegments = target2.split("/").filter(Boolean);
  const shared = Math.min(ownerSegments.length, targetSegments.length);
  if (!shared) return false;
  for (let at = 0; at < shared; at += 1) {
    if (ownerSegments[at] !== targetSegments[at]) return false;
  }
  return true;
}
function shapeClass(value) {
  if (/^\d+$/.test(value)) return "digits";
  if (value.includes(".")) return "dotted";
  if (/^[a-z0-9]+$/.test(value)) return "token";
  return "mixed";
}
function tokenizeIdentifier(text2) {
  return text2.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2").split(/[^A-Za-z0-9]+/).map((word) => word.toLowerCase()).filter(Boolean);
}
var STOP_TOKENS = /* @__PURE__ */ new Set([
  "btn",
  "button",
  "link",
  "item",
  "card",
  "row",
  "cell",
  "view",
  "screen",
  "tab",
  "by",
  "to",
  "the",
  "a",
  "id"
]);
function nodeTokens(node) {
  const fromPath = (node.urlPath ?? "").split("/").filter((segment) => segment && !segment.startsWith(":") && !segment.startsWith("[")).flatMap((segment) => tokenizeIdentifier(segment));
  const fromTitle = tokenizeIdentifier(node.title ?? node.id.split("/").pop() ?? "");
  return new Set([...fromPath, ...fromTitle].filter((token) => !STOP_TOKENS.has(token)));
}
function affinityScore(prefix, node) {
  const prefixTokens = tokenizeIdentifier(prefix).filter((token) => !STOP_TOKENS.has(token));
  if (!prefixTokens.length) return 0;
  const routeTokens = nodeTokens(node);
  const shared = prefixTokens.filter((token) => routeTokens.has(token));
  if (!shared.some((token) => token.length >= 4)) return 0;
  return shared.length / prefixTokens.length;
}
var AFFINITY_FLOOR = 0.5;
function learnTemplate(identifier, value, nodeId, paramKey2) {
  if (!value || value.length < 2) return null;
  const at = identifier.indexOf(value);
  if (at === -1) return null;
  if (at === 0 && value.length === identifier.length) return null;
  return {
    prefix: identifier.slice(0, at),
    suffix: identifier.slice(at + value.length),
    nodeId,
    paramKey: paramKey2,
    evidence: "learned",
    score: 1
  };
}
function splitTestId(identifier) {
  const segments = identifier.split("-");
  if (segments.length < 2) return [];
  const out = [];
  for (let at = 0; at < segments.length; at += 1) {
    const token = segments[at];
    if (!token || !PARAM_VALUE_RE.test(token) || !looksLikeValue(token)) continue;
    const prefix = segments.slice(0, at).join("-");
    if (!prefix) continue;
    const suffix = segments.slice(at + 1).join("-");
    out.push({
      prefix: `${prefix}-`,
      token,
      suffix: suffix ? `-${suffix}` : ""
    });
  }
  return out;
}
function looksLikeValue(token) {
  if (/[.@%~]/.test(token)) return true;
  if (/\d/.test(token) && !/^\d{1,2}$/.test(token)) return true;
  return token.length >= 13;
}
function applyTemplate(template, identifier) {
  if (!identifier.startsWith(template.prefix)) return null;
  if (template.suffix && !identifier.endsWith(template.suffix)) return null;
  const token = identifier.slice(
    template.prefix.length,
    template.suffix ? identifier.length - template.suffix.length : void 0
  );
  if (!token || !PARAM_VALUE_RE.test(token)) return null;
  return token;
}
function matchFlowLink(url, nodes) {
  const path = normalizePath(url);
  if (path === null) return null;
  const actual = routeSegments(path);
  let best = null;
  for (const node of nodes) {
    if (!node.urlPath || node.urlPath === "/") continue;
    const pattern = routeSegments(node.urlPath);
    if (pattern.length !== actual.length) continue;
    if (pattern.some((segment) => segment.startsWith("[..."))) continue;
    let literals = 0;
    const values = {};
    let ok = true;
    for (let at = 0; at < pattern.length; at += 1) {
      const key2 = patternParamKey(pattern[at]);
      if (key2 === null) {
        if (pattern[at].toLowerCase() !== actual[at].toLowerCase()) {
          ok = false;
          break;
        }
        literals += 1;
        continue;
      }
      const value = decodeSegment(actual[at]);
      if (!value || !PARAM_VALUE_RE.test(value)) {
        ok = false;
        break;
      }
      values[key2] = value;
    }
    if (!ok) continue;
    if (!best || literals > best.literals) best = { nodeId: node.id, values, literals };
  }
  return best ? { nodeId: best.nodeId, values: best.values } : null;
}
function normalizePath(url) {
  const scheme = url.match(/^([a-zA-Z][\w+.-]*):\/\//)?.[1]?.toLowerCase();
  let path = (scheme ? url.slice(url.indexOf("://") + 3) : url).split(/[?#]/)[0];
  if (scheme === "http" || scheme === "https") path = path.split("/").slice(1).join("/");
  const trimmed = `/${path}`.replace(/\/{2,}/g, "/").replace(/\/+$/, "");
  return trimmed || null;
}
function routeSegments(path) {
  return path.split(/[?#]/)[0].split("/").filter((segment) => segment && segment !== "index" && !/^\(.+\)$/.test(segment));
}
function patternParamKey(segment) {
  if (segment.startsWith(":")) return segment.slice(1).replace(/\?$/, "");
  if (segment.startsWith("[") && segment.endsWith("]")) {
    return segment.slice(1, -1).replace(/^\.\.\./, "");
  }
  return null;
}
function decodeSegment(segment) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
var ParamStore = class _ParamStore {
  /**
   * Indexed by route and by (route, param) rather than held as flat lists.
   *
   * `ingestPressables` runs once per captured screen over every control on it against every
   * parameterised route — on Bluesky that is ~45 x 22 per screen, 76 times a sweep — and the
   * bootstrap layer can mint a template per (testID shape, route) pair. Flat arrays turn each of
   * those into a scan, which is a lot of work to spend inside a change whose entire purpose is to
   * make the sweep faster. The buckets are small and kept sorted on insert, so selection is a map
   * lookup and a short walk.
   */
  recordsByNode = /* @__PURE__ */ new Map();
  templatesByParam = /* @__PURE__ */ new Map();
  shapes = /* @__PURE__ */ new Map();
  seq = 0;
  /** Every param set refused as unsafe, in order. The same entries are logged as they happen. */
  rejections = [];
  /** Set by the orchestrator so one failed nav-state read is not retried all sweep. */
  navState = "unknown";
  /* ---------------------------------------------------------- static layer */
  /**
   * Register what `resolveRouteParams` found in source text. A complete set becomes the
   * highest-precedence record; every literal, complete or not, establishes the shape later
   * harvested values for that param have to match.
   */
  noteStatic(node, resolved) {
    const unsafe = this.firstUnsafe(node, resolved, "static");
    if (unsafe) return;
    for (const [key2, value] of Object.entries(resolved)) {
      if (PARAM_VALUE_RE.test(value)) this.shapes.set(shapeKey(node.id, key2), shapeClass(value));
    }
    if (node.params.length && node.params.every((key2) => resolved[key2])) {
      this.add({
        nodeId: node.id,
        values: Object.fromEntries(node.params.map((key2) => [key2, resolved[key2]])),
        source: "static",
        seenOn: "call-site",
        seq: this.seq += 1
      });
    }
  }
  /* ------------------------------------------------------- url observation */
  /**
   * A URL the app actually navigated to. Classified as a navigation observation because that is what
   * it is: the app produced the string, so every param in it is simultaneously real and
   * co-occurring.
   */
  ingestUrl(url, seenOn, nodes) {
    const match = matchFlowLink(url, nodes);
    if (!match) return null;
    const node = nodes.find((candidate) => candidate.id === match.nodeId);
    if (!node) return null;
    return this.addObserved(node, match.values, "nav-state", seenOn);
  }
  /**
   * One route out of a flattened navigation state. Non-string params are dropped rather than
   * coerced past numbers: an object or array in a param slot cannot be put in a URL, and stringifying
   * it produces `[object Object]`, which is an invented value.
   */
  ingestNavRoute(node, params, seenOn) {
    const values = {};
    for (const key2 of node.params) {
      const raw = params[key2];
      if (typeof raw === "string") values[key2] = raw;
      else if (typeof raw === "number" && Number.isFinite(raw)) values[key2] = String(raw);
      else return null;
    }
    return this.addObserved(node, values, "nav-state", seenOn);
  }
  /* ------------------------------------------------------- a11y harvesting */
  /**
   * Teach the store a testID shape from a navigation the harness just performed: the control it
   * tapped, and the URL the app reported afterwards. This is the only evidence class that ties a
   * value to a *route* rather than merely reading like it might belong to one, so it also
   * back-fills a record for the node it just demonstrated.
   */
  learnFromNavigation(identifier, landedUrl, seenOn, nodes) {
    const match = matchFlowLink(landedUrl, nodes);
    if (!match) return;
    const node = nodes.find((candidate) => candidate.id === match.nodeId);
    if (node) this.addObserved(node, match.values, "nav-state", seenOn);
    if (!identifier) return;
    for (const [key2, value] of Object.entries(match.values)) {
      const template = learnTemplate(identifier, value, match.nodeId, key2);
      if (template) this.addTemplate(template);
    }
  }
  /**
   * A walked arrival: the harness tapped a control and the arrival judge confirmed the app landed on
   * `node`. No URL is involved — an in-app tap produces none — so the value has to come out of the
   * identifier itself. The binding is still *demonstrated* rather than guessed, because the app is
   * what performed the navigation; this is the only way a walk pays for itself on later routes.
   *
   * Restricted to a single-param route whose identifier offers exactly one candidate position. Two
   * candidates are two readings of the same control with nothing to choose between them, and a
   * multi-param route would need every value out of this one identifier with no way to tell which
   * is which. Both stay unresolved, and the next route explores exactly as it does today.
   */
  learnFromArrival(identifier, node, seenOn) {
    if (!identifier || node.params.length !== 1) return null;
    const candidates = splitTestId(identifier);
    if (candidates.length !== 1) return null;
    const [candidate] = candidates;
    const paramKey2 = node.params[0];
    this.addTemplate({
      prefix: candidate.prefix,
      suffix: candidate.suffix,
      nodeId: node.id,
      paramKey: paramKey2,
      evidence: "learned",
      score: 1
    });
    return this.addObserved(node, { [paramKey2]: candidate.token }, "a11y-learned", seenOn);
  }
  /**
   * Read every value the controls on a captured screen carry.
   *
   * A record is only built from **one** pressable: all of a node's params must come out of the same
   * identifier, via one template each. That is what stops a `name` from one row pairing with an
   * `rkey` from another. Nodes whose params cannot all be filled from a single control stay
   * unresolved, and the caller explores — the intended outcome, not a failure.
   */
  ingestPressables(seenOn, pressables, nodes) {
    const wanted = nodes.filter((node) => node.params.length);
    if (!wanted.length) return [];
    this.proposeAffinityTemplates(pressables, wanted);
    const added = [];
    for (const pressable of pressables) {
      const identifier = pressable.identifier;
      if (!identifier) continue;
      for (const node of wanted) {
        const values = {};
        let evidence = "learned";
        for (const key2 of node.params) {
          const hit = this.templatesFor(node.id, key2).map((template) => ({ template, value: applyTemplate(template, identifier) })).find((candidate) => candidate.value !== null);
          if (!hit?.value) break;
          values[key2] = hit.value;
          if (hit.template.evidence === "affinity") evidence = "affinity";
        }
        if (Object.keys(values).length !== node.params.length) continue;
        const record2 = this.addObserved(
          node,
          values,
          evidence === "learned" ? "a11y-learned" : "a11y-affinity",
          seenOn
        );
        if (record2) added.push(record2);
      }
    }
    return added;
  }
  /**
   * Bootstrap templates from wording alone, for routes nothing has demonstrated yet. Only ever
   * produces `affinity` evidence, and only for a (node, param) pair that has no learned template —
   * once the app has shown us the real shape there is no reason to keep guessing at it.
   */
  proposeAffinityTemplates(pressables, nodes) {
    const bootstrap = nodes.filter(
      (node) => node.params.length === 1 && !this.hasLearnedTemplate(node.id, node.params[0])
    );
    if (!bootstrap.length) return;
    const shapes = /* @__PURE__ */ new Map();
    for (const pressable of pressables) {
      if (!pressable.identifier) continue;
      for (const candidate of splitTestId(pressable.identifier)) {
        shapes.set(`${candidate.prefix}\0${candidate.suffix}`, candidate);
      }
    }
    for (const shape of shapes.values()) {
      for (const node of bootstrap) {
        const score = affinityScore(shape.prefix, node);
        if (score < AFFINITY_FLOOR) continue;
        this.addTemplate({
          prefix: shape.prefix,
          suffix: shape.suffix,
          nodeId: node.id,
          paramKey: node.params[0],
          evidence: "affinity",
          score
        });
      }
    }
  }
  /** Candidate shapes for one param, demonstrated ones first. Kept sorted by `addTemplate`. */
  templatesFor(nodeId, paramKey2) {
    return this.templatesByParam.get(shapeKey(nodeId, paramKey2)) ?? [];
  }
  hasLearnedTemplate(nodeId, paramKey2) {
    return this.templatesFor(nodeId, paramKey2).some((template) => template.evidence === "learned");
  }
  /* ------------------------------------------------------------- selection */
  /**
   * The best complete param set for `node`, or null when nothing observed covers it.
   *
   * Precedence is applied to whole records and never merged: if the static layer filled `name` but
   * not `rkey`, a harvested record supplying both wins outright rather than contributing its `rkey`
   * to the static `name`.
   */
  best(node) {
    if (!node.params.length) return null;
    const covering = (records) => records.filter((record2) => node.params.every((key2) => record2.values[key2] !== void 0)).sort(recordOrder);
    const own = covering(this.recordsByNode.get(node.id) ?? []);
    const chosen = own[0] ?? covering(
      this.allRecords.filter(
        (record2) => record2.nodeId !== node.id && sharesRouteParams(record2.urlPath, node.urlPath)
      )
    )[0];
    if (!chosen) return null;
    return {
      values: Object.fromEntries(node.params.map((key2) => [key2, chosen.values[key2]])),
      source: chosen.source,
      seenOn: chosen.seenOn,
      ownedBy: chosen.nodeId
    };
  }
  /**
   * Forget a record that turned out to point at something the app does not have — a handle deleted
   * since the previous sweep, an affinity template that bound the wrong route. Called when a deep
   * link built from harvested values is rejected on arrival, so the next attempt falls through to
   * the next-best record and ultimately to exploration.
   *
   * `nodeId` is the route that *owns* the record (`ParamResolution.ownedBy`), which is not always
   * the route that just failed on it: a record borrowed by a descendant has to be forgotten where
   * it lives, or every other descendant goes on borrowing the same dead value.
   */
  demote(nodeId, values) {
    const stamp = valueStamp(values);
    const bucket = this.recordsByNode.get(nodeId);
    if (!bucket) return;
    this.recordsByNode.set(
      nodeId,
      bucket.filter((record2) => valueStamp(record2.values) !== stamp)
    );
  }
  /* ------------------------------------------------------------ bookkeeping */
  addObserved(node, values, source, seenOn) {
    if (!node.params.length) return null;
    if (this.firstUnsafe(node, values, source)) return null;
    const complete = {};
    for (const key2 of node.params) {
      const value = values[key2];
      if (!value || !PARAM_VALUE_RE.test(value)) return null;
      const expected = this.shapes.get(shapeKey(node.id, key2));
      if (expected && shapeClass(value) !== expected) return null;
      complete[key2] = value;
    }
    return this.add({
      nodeId: node.id,
      urlPath: node.urlPath,
      values: complete,
      source,
      seenOn,
      seq: this.seq += 1
    });
  }
  /**
   * The first unsafe param of a set, recorded and logged (key and reason only), or null when all are
   * safe. Checks the keys the route declares as well as any extra keys supplied.
   */
  firstUnsafe(node, values, origin2) {
    const keys = /* @__PURE__ */ new Set([...node.params, ...Object.keys(values)]);
    for (const key2 of keys) {
      const raw = Object.hasOwn(values, key2) ? values[key2] : void 0;
      const reason = unsafeParamReason(key2, typeof raw === "string" ? raw : "");
      if (!reason) continue;
      return this.reject({ nodeId: node.id, key: key2, reason, origin: origin2 });
    }
    return null;
  }
  reject(rejection) {
    this.rejections.push(rejection);
    console.warn(
      `[app-flow] param-store refused record for ${rejection.nodeId}: param "${rejection.key.slice(0, MAX_PARAM_KEY_LENGTH)}" ${rejection.reason} (${rejection.origin})`
    );
    return rejection;
  }
  add(record2) {
    const stamp = valueStamp(record2.values);
    const bucket = this.recordsByNode.get(record2.nodeId) ?? [];
    const existing = bucket.find((candidate) => valueStamp(candidate.values) === stamp);
    if (existing) {
      if (SOURCE_RANK[record2.source] < SOURCE_RANK[existing.source]) existing.source = record2.source;
      if (!existing.urlPath && record2.urlPath) existing.urlPath = record2.urlPath;
      existing.seq = record2.seq;
      existing.fromPriorRun = false;
      return existing;
    }
    bucket.push(record2);
    this.recordsByNode.set(record2.nodeId, bucket);
    return record2;
  }
  addTemplate(template) {
    const key2 = shapeKey(template.nodeId, template.paramKey);
    const bucket = this.templatesByParam.get(key2) ?? [];
    const existing = bucket.find(
      (candidate) => candidate.prefix === template.prefix && candidate.suffix === template.suffix
    );
    if (!existing) bucket.push(template);
    else if (existing.evidence === "affinity" && template.evidence === "learned") {
      existing.evidence = "learned";
      existing.score = 1;
    } else if (template.score > existing.score) existing.score = template.score;
    bucket.sort(templateOrder);
    this.templatesByParam.set(key2, bucket);
  }
  get allRecords() {
    return [...this.recordsByNode.values()].flat();
  }
  get allTemplates() {
    return [...this.templatesByParam.values()].flat();
  }
  /** Provenance for the sweep log: how much was learned and from where. */
  summary() {
    const templates = this.allTemplates;
    return {
      records: this.allRecords.length,
      templates: templates.length,
      learned: templates.filter((template) => template.evidence === "learned").length
    };
  }
  toJSON() {
    return {
      records: this.allRecords.map((record2) => ({ ...record2 })),
      templates: this.allTemplates.map((template) => ({ ...template })),
      shapes: Object.fromEntries(this.shapes)
    };
  }
  /**
   * Rehydrate from a previous sweep. Carried records are marked `fromPriorRun` and sort below
   * anything seen live, because the record they name may have been deleted in the meantime; a 404 on
   * one demotes it through `demote` exactly as a bad live record would be.
   *
   * Hostile or merely stale input is dropped rather than trusted: this file is on disk between runs.
   */
  static fromJSON(raw, { fromPriorRun = true } = {}) {
    const store = new _ParamStore();
    if (!raw || typeof raw !== "object") return store;
    const data = raw;
    for (const record2 of Array.isArray(data.records) ? data.records : []) {
      if (!isPlainRecord(record2)) continue;
      const unsafe = Object.entries(record2.values).find(
        ([key2, value]) => unsafeParamReason(key2, value)
      );
      if (unsafe) {
        store.reject({
          nodeId: record2.nodeId,
          key: unsafe[0],
          reason: unsafeParamReason(unsafe[0], unsafe[1]),
          origin: "disk"
        });
        continue;
      }
      store.add({ ...record2, fromPriorRun: fromPriorRun || record2.fromPriorRun });
      store.seq = Math.max(store.seq, record2.seq ?? 0);
    }
    for (const template of Array.isArray(data.templates) ? data.templates : []) {
      if (isPlainTemplate(template)) store.addTemplate(template);
    }
    for (const [key2, value] of Object.entries(data.shapes ?? {})) {
      if (value === "digits" || value === "dotted" || value === "token" || value === "mixed") {
        store.shapes.set(key2, value);
      }
    }
    return store;
  }
};
function shapeKey(nodeId, paramKey2) {
  return `${nodeId}\0${paramKey2}`;
}
function valueStamp(values) {
  return Object.keys(values).sort().map((key2) => `${key2}=${values[key2]}`).join("&");
}
function recordOrder(left, right) {
  const byRun = Number(left.fromPriorRun ?? false) - Number(right.fromPriorRun ?? false);
  if (byRun !== 0) return byRun;
  const bySource = SOURCE_RANK[left.source] - SOURCE_RANK[right.source];
  if (bySource !== 0) return bySource;
  return right.seq - left.seq;
}
function templateOrder(left, right) {
  if (left.evidence !== right.evidence) return left.evidence === "learned" ? -1 : 1;
  return right.score - left.score;
}
function isPlainRecord(value) {
  if (!value || typeof value !== "object") return false;
  const record2 = value;
  if (typeof record2.nodeId !== "string" || !record2.nodeId) return false;
  if (!record2.values || typeof record2.values !== "object") return false;
  if (record2.urlPath !== void 0 && record2.urlPath !== null && typeof record2.urlPath !== "string")
    return false;
  const entries = Object.entries(record2.values);
  if (!entries.length) return false;
  if (!entries.every(([key2, item]) => key2 && typeof item === "string" && PARAM_VALUE_RE.test(item))) {
    return false;
  }
  return record2.source !== void 0 && record2.source in SOURCE_RANK;
}
function isPlainTemplate(value) {
  if (!value || typeof value !== "object") return false;
  const template = value;
  return typeof template.prefix === "string" && typeof template.suffix === "string" && typeof template.nodeId === "string" && typeof template.paramKey === "string" && (template.evidence === "learned" || template.evidence === "affinity") && typeof template.score === "number";
}

// packages/core/src/app-flow/exploration.ts
var LOCATOR_KINDS = /* @__PURE__ */ new Set(["text", "label", "id"]);
function serializeLocator(locator, qualifiers) {
  const value = locator.value.trim();
  if (!LOCATOR_KINDS.has(locator.by) || !value) throw new Error("Invalid navigation locator");
  const base = `${locator.by}=${JSON.stringify(value)}`;
  const extra = Object.entries(qualifiers ?? {}).map(
    ([key2, term]) => `${key2}=${typeof term === "boolean" ? term : JSON.stringify(term)}`
  );
  return [base, ...extra].join(" ");
}
function isAmbiguousSelectorMessage(message) {
  return /matched \d+ distinct actionable elements/i.test(message);
}
function parseNavigationDecision(value) {
  if (!value || typeof value !== "object") return null;
  const decision = value;
  if (decision.decision === "arrived") {
    if (typeof decision.reason !== "string") return null;
    const destinationLocator = asDestinationLocator(decision.destinationLocator);
    return destinationLocator ? { decision: "arrived", reason: decision.reason, destinationLocator } : { decision: "arrived", reason: decision.reason };
  }
  if (decision.decision === "blocked") {
    return typeof decision.reason === "string" ? { decision: "blocked", reason: decision.reason } : null;
  }
  if (decision.decision !== "act" || !isNavigationAction(decision.action)) return null;
  return {
    decision: "act",
    action: decision.action,
    reason: typeof decision.reason === "string" ? decision.reason : ""
  };
}
function isNavigationAction(value) {
  if (!value || typeof value !== "object") return false;
  const action = value;
  if (!["tap", "swipe", "input", "wait"].includes(String(action.type))) return false;
  if (action.type === "tap" || action.type === "input") {
    if (!isLocator(action.locator)) return false;
  }
  if (action.type === "input" && typeof action.value !== "string") return false;
  if (action.type === "swipe" && action.direction !== void 0 && !["up", "down", "left", "right"].includes(String(action.direction))) {
    return false;
  }
  if (action.duration !== void 0 && typeof action.duration !== "number") return false;
  return true;
}
function asDestinationLocator(value) {
  if (!isLocator(value) || value.by === "text") return null;
  return { by: value.by, value: value.value.trim() };
}
function isLocator(value) {
  if (!value || typeof value !== "object") return false;
  const locator = value;
  return LOCATOR_KINDS.has(String(locator.by)) && typeof locator.value === "string" && !!locator.value.trim();
}
var ActiveTimeBudget = class {
  excludedMs = 0;
  limitMs;
  startedAt;
  now;
  constructor(limitMs, startedAt = Date.now(), now = Date.now) {
    this.limitMs = limitMs;
    this.startedAt = startedAt;
    this.now = now;
  }
  exclude(ms) {
    this.excludedMs += Math.max(0, ms);
  }
  get remainingMs() {
    return Math.max(0, this.limitMs - (this.now() - this.startedAt - this.excludedMs));
  }
  get expired() {
    return this.remainingMs === 0;
  }
};
var DeepLinkRejectionMemo = class {
  rejected = /* @__PURE__ */ new Set();
  wasRejected(url) {
    return this.rejected.has(url);
  }
  reject(url) {
    this.rejected.add(url);
  }
};
var GuardGateMemo = class {
  closed = /* @__PURE__ */ new Set();
  wasClosed(condition) {
    return this.closed.has(condition);
  }
  close(condition) {
    this.closed.add(condition);
  }
};
var UNRESOLVED_HOP_PENALTY = 1e3;
function findNavigationPath(edges, targetId, entryIds) {
  const entries = new Set(entryIds);
  if (entries.has(targetId)) return [targetId];
  const incoming = /* @__PURE__ */ new Map();
  for (const edge of edges) {
    if (!edge.to || edge.from === edge.to) continue;
    const hop = { from: edge.from, cost: edge.trigger ? 1 : 1 + UNRESOLVED_HOP_PENALTY };
    const sources = incoming.get(edge.to);
    if (sources) sources.push(hop);
    else incoming.set(edge.to, [hop]);
  }
  const cheapest = /* @__PURE__ */ new Map([[targetId, 0]]);
  const frontier = [{ path: [targetId], cost: 0 }];
  let best = null;
  while (frontier.length) {
    frontier.sort((a, b) => a.cost - b.cost);
    const current = frontier.shift();
    if (best && current.cost >= best.cost) break;
    for (const hop of incoming.get(current.path[0]) ?? []) {
      const cost = current.cost + hop.cost;
      const known = cheapest.get(hop.from);
      if (known !== void 0 && known <= cost) continue;
      cheapest.set(hop.from, cost);
      const path = [hop.from, ...current.path];
      if (entries.has(hop.from)) {
        if (!best || cost < best.cost) best = { path, cost };
        continue;
      }
      frontier.push({ path, cost });
    }
  }
  return best?.path ?? null;
}
function describeJourney(edges, path) {
  if (path.length < 2) return path[0] ?? "";
  const hops = [path[0]];
  for (let index = 1; index < path.length; index++) {
    const edge = edges.find(
      (candidate) => candidate.from === path[index - 1] && candidate.to === path[index]
    );
    const trigger = edge?.trigger;
    hops.push(
      trigger ? `--[tap ${trigger.by}=${JSON.stringify(trigger.value)}]--> ${path[index]}` : `--[control unknown, find it on screen]--> ${path[index]}`
    );
  }
  return hops.join(" ");
}
var EXPLORATION_MAX_DECISIONS = 7;
async function runInteractiveExploration(options) {
  const actions = [];
  const history = [];
  let previous = null;
  let noProgress = 0;
  let actionAttempted = false;
  let successfulActionPendingObservation = false;
  let plannerFailures = 0;
  const maxDecisions = options.maxDecisions ?? 30;
  const maxNoProgress = options.maxNoProgress ?? 3;
  const maxPlannerFailures = options.maxPlannerFailures ?? 3;
  const maxArrivalRejections = options.maxArrivalRejections ?? 2;
  let arrivalRejections = 0;
  for (let step = 0; step < maxDecisions && !options.budget.expired; step++) {
    options.check?.();
    const observation = await options.observe(step);
    options.check?.();
    if (options.observed) {
      try {
        await options.observed(observation);
      } catch (error) {
        console.error("[app-flow] observed hook failed:", error);
      }
      options.check?.();
    }
    if (options.budget.expired) break;
    const current = fingerprint(observation.pressables);
    if (actionAttempted) {
      if (previous && similarity(previous, current) >= 0.98) noProgress += 1;
      else noProgress = 0;
    }
    previous = current;
    actionAttempted = false;
    successfulActionPendingObservation = false;
    if (noProgress >= maxNoProgress) {
      return {
        arrived: false,
        actions,
        reason: "Three consecutive actions made no visible progress."
      };
    }
    let decision;
    try {
      decision = await options.decide(observation, history);
    } catch (error) {
      plannerFailures += 1;
      const detail = error instanceof Error ? error.message : String(error);
      history.push(`Planner call failed: ${detail}; decide again from the fresh observation.`);
      options.check?.();
      if (plannerFailures >= maxPlannerFailures) {
        return {
          arrived: false,
          actions,
          reason: `Planner failed ${plannerFailures} times in a row: ${detail}`
        };
      }
      continue;
    }
    options.check?.();
    if (options.budget.expired) break;
    if (!decision) {
      plannerFailures += 1;
      history.push("Planner returned an invalid decision; inspect the fresh UI and correct it.");
      if (plannerFailures >= maxPlannerFailures) {
        return {
          arrived: false,
          actions,
          reason: `Planner failed ${plannerFailures} times in a row: returned an invalid decision.`
        };
      }
      continue;
    }
    plannerFailures = 0;
    if (decision.decision === "blocked") return { arrived: false, actions, reason: decision.reason };
    if (decision.decision === "arrived") {
      if (await options.verifyArrival(observation)) {
        return decision.destinationLocator ? {
          arrived: true,
          actions,
          reason: decision.reason,
          destinationLocator: decision.destinationLocator
        } : { arrived: true, actions, reason: decision.reason };
      }
      arrivalRejections += 1;
      history.push(`Arrival rejected: ${decision.reason}`);
      if (arrivalRejections >= maxArrivalRejections) {
        return {
          arrived: false,
          actions,
          reason: `Planner claimed arrival ${arrivalRejections} times and the arrival check rejected each one: ${decision.reason}`
        };
      }
      continue;
    }
    try {
      actionAttempted = true;
      await options.act(decision.action);
      actions.push(decision.action);
      successfulActionPendingObservation = true;
    } catch (error) {
      history.push(
        `Action failed: ${JSON.stringify(decision.action)} \u2014 ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  if (successfulActionPendingObservation && !options.budget.expired) {
    options.check?.();
    const observation = await options.observe(maxDecisions);
    options.check?.();
    if (options.observed) {
      try {
        await options.observed(observation);
      } catch (error) {
        console.error("[app-flow] observed hook failed:", error);
      }
      options.check?.();
    }
    if (!options.budget.expired && await options.verifyArrival(observation)) {
      return {
        arrived: true,
        actions,
        reason: "The final navigation action reached the target."
      };
    }
  }
  return {
    arrived: false,
    actions,
    reason: options.budget.expired ? "Navigation budget exhausted after five minutes." : `Navigation stopped after ${maxDecisions} decisions.`
  };
}
function findRouteAncestors(urlPath, nodes) {
  const byPath = /* @__PURE__ */ new Map();
  for (const node of nodes) {
    if (node.urlPath) byPath.set(node.urlPath.replace(/\/+$/, ""), node);
  }
  const segments = urlPath.replace(/\/+$/, "").split("/");
  const found = [];
  for (let cut2 = segments.length - 1; cut2 > 1; cut2--) {
    const ancestor = byPath.get(segments.slice(0, cut2).join("/"));
    if (ancestor) found.push(ancestor);
  }
  return found;
}
function findRouteAncestor(urlPath, nodes) {
  return findRouteAncestors(urlPath, nodes)[0] ?? null;
}
function explainGuardGate(guard) {
  return `Registered but gated off in this build: the screen renders <${guard.fallback}/> unless \`${guard.condition}\` is false.`;
}
function explainUnavailable(node, ancestorStatus) {
  if (node.params.length) return null;
  if (node.guard) return explainGuardGate(node.guard);
  if (ancestorStatus === "ok" || ancestorStatus === "unavailable") {
    return "Registered but not available in this build: the route resolves under a reachable branch yet renders the not-found screen.";
  }
  return null;
}
function indexDeepLinkPath(node) {
  const group = node.id.split("/").find((seg) => seg.startsWith("(") && seg.endsWith(")"));
  if (group) return `/${group}`;
  if (node.group.startsWith("(") && node.group.endsWith(")")) return `/${node.group}`;
  return null;
}
function isUndeeplinkableRoot(node) {
  return (node.urlPath === "/" || node.urlPath === "") && indexDeepLinkPath(node) === null;
}
function paramFreeDeepLink(urlPath, unresolvedParams) {
  if (!unresolvedParams.length) return urlPath;
  const wanted = new Set(unresolvedParams);
  const segments = urlPath.replace(/\/+$/, "").split("/");
  const at = segments.findIndex((segment) => wanted.has(paramKey(segment) ?? ""));
  if (at === -1) return urlPath;
  const prefix = segments.slice(0, at).join("/");
  return prefix && prefix !== "/" ? prefix : null;
}
function paramKey(segment) {
  if (segment.startsWith(":")) return segment.slice(1);
  if (segment.startsWith("[") && segment.endsWith("]")) {
    return segment.slice(1, -1).replace(/^\.\.\./, "");
  }
  return null;
}
var PRESSABLE_TEXT_LIMIT = 80;
function summarizePressables(pressables, limit = 60, maxChars = PRESSABLE_TEXT_LIMIT) {
  const seen = /* @__PURE__ */ new Set();
  const unique = [];
  for (const pressable of pressables) {
    const identifier = pressable.identifier ? cut(pressable.identifier, maxChars) : void 0;
    const trimmed = identifier ? {
      identifier,
      ...pressable.role ? { role: pressable.role } : {},
      // `text` is dropped only when `label` is there to carry the caption: capture.ts sets
      // `text` from node.value and `label` from node.label (two independent fields), and on an
      // identified pressable that has both, node.value is almost always the same caption
      // node.label already carries — repeating it a third way just spends tokens nudging the
      // planner back toward the selectors that keep failing. When there is no `label`, node.value
      // is the control's only caption and dropping it would leave `{identifier, role}` saying
      // nothing about what the control holds — a text field's current contents, a control whose
      // state lives in its value. capture.ts keeps a pressable when ANY of text/label/identifier
      // is set, so that shape is one the capture side explicitly expects to emit.
      ...pressable.label ? { label: cut(pressable.label, maxChars) } : pressable.text ? { text: cut(pressable.text, maxChars) } : {}
    } : {
      ...pressable.text ? { text: cut(pressable.text, maxChars) } : {},
      ...pressable.label ? { label: cut(pressable.label, maxChars) } : {},
      ...pressable.role ? { role: pressable.role } : {}
    };
    const identity = JSON.stringify(trimmed);
    if (seen.has(identity)) continue;
    seen.add(identity);
    unique.push(trimmed);
  }
  return { shown: unique.slice(0, limit), omitted: Math.max(0, unique.length - limit) };
}
function cut(value, maxChars) {
  const collapsed = value.replace(/\s+/g, " ").trim();
  return collapsed.length > maxChars ? `${collapsed.slice(0, maxChars)}\u2026` : collapsed;
}
function isSessionLostMessage(message) {
  return /no active session|run open first|session_not_found/i.test(message);
}
function describeSessionLoss(message, hint) {
  const cut2 = (value) => {
    const collapsed = value.replace(/\s+/g, " ").trim();
    return collapsed.length > 160 ? `${collapsed.slice(0, 160)}\u2026` : collapsed;
  };
  if (isSessionLostMessage(message)) return `error message: ${cut2(message)}`;
  if (hint !== void 0 && isSessionLostMessage(hint)) {
    return `error hint: ${cut2(hint)} (message: ${cut2(message)})`;
  }
  return `error message: ${cut2(message)}`;
}
function isToolingFailure(reason) {
  if (!reason) return false;
  return /sub-agent timed out|planner failed|budget exhaust|runner busy|screenshot failed/i.test(
    reason
  ) || isSessionLostMessage(reason);
}
function shouldRetryFromEntry(seeded) {
  return !seeded.walkRan || isToolingFailure(seeded.reason);
}
function resolveRouteParams(node, edges) {
  const incoming = edges.filter((edge) => edge.to === node.id && edge.raw);
  const resolved = {};
  for (const key2 of node.params) {
    const escaped = escapeParamKey(key2);
    for (const edge of incoming) {
      const candidate = (
        // `?name=alice` or `/name=alice` in a href-style target.
        edge.raw.match(new RegExp(`[/?&]${escaped}=([^&/'"\`\\s)]+)`))?.[1] ?? // `navigate('Profile', { name: 'alice' })` — the params object at the call site.
        edge.raw.match(new RegExp(`\\b${escaped}\\s*:\\s*['"\`]([^'"\`]+)['"\`]`))?.[1] ?? // A literal segment sitting where the route declares the param.
        segmentForParam(edge, key2)
      );
      if (candidate && PARAM_VALUE_RE.test(candidate)) {
        resolved[key2] = candidate;
        break;
      }
    }
  }
  return resolved;
}
function escapeParamKey(key2) {
  return key2.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function resolveNodeParams(node, edges, store) {
  const fromSource = resolveRouteParams(node, edges);
  store?.noteStatic(node, fromSource);
  const harvested = store?.best(node) ?? null;
  if (harvested) {
    return {
      values: { ...harvested.values },
      unresolved: [],
      source: harvested.source,
      seenOn: harvested.seenOn,
      ownedBy: harvested.ownedBy
    };
  }
  const unresolved = node.params.filter((key2) => !(key2 in fromSource));
  return {
    values: fromSource,
    unresolved,
    source: !node.params.length || unresolved.length ? null : "static",
    seenOn: null,
    ownedBy: null
  };
}
function segmentForParam(edge, key2) {
  if (!edge.target) return null;
  const pattern = edge.target.split(/[?#]/)[0].split("/");
  const actual = edge.raw.split(/[?#]/)[0].split("/");
  if (pattern.length !== actual.length) return null;
  const at = pattern.findIndex((seg) => seg === `:${key2}` || seg === `[${key2}]`);
  return at === -1 ? null : actual[at] ?? null;
}
function splitCamelCase(text2) {
  return text2.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
}
function isParamSegment(segment) {
  return segment.startsWith(":") || segment.startsWith("[") && segment.endsWith("]");
}
function expectedNodeTokens(node) {
  const parts = [node.title, node.id.split("/").pop() ?? node.id];
  if (node.urlPath) {
    for (const segment of node.urlPath.split("/")) {
      if (segment && !isParamSegment(segment)) parts.push(segment);
    }
  }
  const out = /* @__PURE__ */ new Set();
  for (const part of parts) for (const token of tokenize(splitCamelCase(part))) out.add(token);
  return out;
}
function expectedCoverage(observed, expected) {
  if (expected.size === 0) return 0;
  let shared = 0;
  for (const token of expected) if (observed.has(token)) shared += 1;
  return shared / expected.size;
}
var MIN_OPPORTUNISTIC_OVERLAP = 0.85;
var MIN_OPPORTUNISTIC_MARGIN = 0.5;
function pickOpportunisticCandidate(observedTokens, pending) {
  const scored = pending.map((node) => ({ node, overlap: expectedCoverage(observedTokens, expectedNodeTokens(node)) })).filter((entry) => entry.overlap >= MIN_OPPORTUNISTIC_OVERLAP).sort((a, b) => b.overlap - a.overlap);
  if (scored.length === 0) return null;
  const [best, runnerUp] = scored;
  if (runnerUp && best.overlap - runnerUp.overlap < MIN_OPPORTUNISTIC_MARGIN) return null;
  return best.node;
}
function demoteFailedHarvest(store, nodeId, resolution, attempts) {
  if (resolution.unresolved.length || !resolution.source || resolution.source === "static") {
    return false;
  }
  const failedOnValue = attempts.some(
    (attempt) => (attempt.strategy === "deep-link" || attempt.strategy === "render") && !attempt.ok && attempt.touchedDevice && !isToolingFailure(attempt.reason)
  );
  if (!failedOnValue) return false;
  store.demote(resolution.ownedBy ?? nodeId, resolution.values);
  return true;
}

// packages/core/src/app-flow/reach/sweep-order.ts
function isFallbackRoute(node) {
  return /(^|[/\W_])(\+?not[\W_]?found|error[\W_]?boundary|unmatched)([\W_]|$)/i.test(
    `${node.id} ${node.title}`
  );
}
function routeSegments2(urlPath) {
  if (!urlPath || urlPath === "/") return null;
  const segments = urlPath.split("/").filter(Boolean);
  return segments.length ? segments : null;
}
function isRouteDescendant(parent, child) {
  return child.length > parent.length && parent.every((segment, at) => segment === child[at]);
}
function depthFirstByRoute(nodes) {
  const segments = new Map(nodes.map((node) => [node.id, routeSegments2(node.urlPath)]));
  const emitted = /* @__PURE__ */ new Set();
  const ordered = [];
  const emit2 = (node) => {
    if (emitted.has(node.id)) return;
    emitted.add(node.id);
    ordered.push(node);
    const parent = segments.get(node.id);
    if (!parent) return;
    for (const candidate of nodes) {
      if (emitted.has(candidate.id)) continue;
      const child = segments.get(candidate.id);
      if (child && isRouteDescendant(parent, child)) emit2(candidate);
    }
  };
  for (const node of nodes) emit2(node);
  return ordered;
}
function orderSweepNodes(nodes, edges, entryScreenIds, entryLayouts, options = {}) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const assigned = /* @__PURE__ */ new Set();
  const fallback = [];
  const eligible = [];
  for (const node of nodes) {
    if (isFallbackRoute(node)) fallback.push(node);
    else eligible.push(node);
  }
  const eligibleIds = new Set(eligible.map((node) => node.id));
  const layoutIndex = new Map(entryLayouts.map((name2, index) => [name2, index]));
  const tier1 = [...new Set(entryScreenIds)].map((id2) => byId.get(id2)).filter((node) => node !== void 0 && eligibleIds.has(node.id));
  tier1.sort((a, b) => (layoutIndex.get(a.group) ?? -1) - (layoutIndex.get(b.group) ?? -1));
  for (const node of tier1) assigned.add(node.id);
  const entryLayoutSet = new Set(entryLayouts);
  const tier2 = eligible.filter(
    (node) => !assigned.has(node.id) && node.groups.some((group) => entryLayoutSet.has(group))
  );
  for (const node of tier2) assigned.add(node.id);
  const adjacency = /* @__PURE__ */ new Map();
  for (const edge of edges) {
    if (!edge.to) continue;
    const list = adjacency.get(edge.from);
    if (list) list.push(edge.to);
    else adjacency.set(edge.from, [edge.to]);
  }
  const distance = /* @__PURE__ */ new Map();
  const queue = [];
  for (const node of tier1) {
    if (!distance.has(node.id)) {
      distance.set(node.id, 0);
      queue.push(node.id);
    }
  }
  let head2 = 0;
  while (head2 < queue.length) {
    const current = queue[head2];
    head2 += 1;
    const currentDistance = distance.get(current);
    for (const next of adjacency.get(current) ?? []) {
      if (distance.has(next)) continue;
      distance.set(next, currentDistance + 1);
      queue.push(next);
    }
  }
  const tier3 = eligible.filter((node) => !assigned.has(node.id) && distance.has(node.id)).sort((a, b) => distance.get(a.id) - distance.get(b.id));
  for (const node of tier3) assigned.add(node.id);
  const tier4 = eligible.filter((node) => !assigned.has(node.id));
  const namedAdjacency = /* @__PURE__ */ new Map();
  for (const edge of edges) {
    if (!edge.to || !edge.trigger?.value) continue;
    const list = namedAdjacency.get(edge.from);
    if (list) list.push(edge.to);
    else namedAdjacency.set(edge.from, [edge.to]);
  }
  const walkable = /* @__PURE__ */ new Set();
  const walkQueue = [];
  for (const node of [...tier1, ...tier2]) {
    if (walkable.has(node.id)) continue;
    walkable.add(node.id);
    walkQueue.push(node.id);
  }
  let walkHead = 0;
  while (walkHead < walkQueue.length) {
    const current = walkQueue[walkHead];
    walkHead += 1;
    for (const next of namedAdjacency.get(current) ?? []) {
      if (walkable.has(next)) continue;
      walkable.add(next);
      walkQueue.push(next);
    }
  }
  const deepLinksEnabled = options.deepLinksEnabled ?? true;
  const reachableByUrl = (node) => deepLinksEnabled && Boolean(node.urlPath) && node.urlPath !== "/" && !node.params?.length;
  const isUnwalkable = (node) => !walkable.has(node.id) && !reachableByUrl(node);
  const tier5 = [...tier3, ...tier4].filter(isUnwalkable);
  const walkableTier3 = tier3.filter((node) => !isUnwalkable(node));
  const walkableTier4 = tier4.filter((node) => !isUnwalkable(node));
  const tiered = [
    ...tier1,
    ...depthFirstByRoute([...tier2, ...walkableTier3, ...walkableTier4]),
    ...tier5,
    ...fallback
  ];
  const probeIndex = options.probeRouteId ? tiered.findIndex((node) => node.id === options.probeRouteId) : -1;
  const ordered = probeIndex > 0 ? [tiered[probeIndex], ...tiered.slice(0, probeIndex), ...tiered.slice(probeIndex + 1)] : tiered;
  if (ordered.length !== nodes.length) {
    throw new Error(
      `orderSweepNodes produced ${ordered.length} nodes from ${nodes.length} input nodes \u2014 every node must appear exactly once.`
    );
  }
  return ordered;
}

// packages/core/src/app-flow/reach/probe-route.ts
function isEligibleProbeRoute(node) {
  return Boolean(node.urlPath) && node.urlPath !== "/" && node.params.length === 0 && !isFallbackRoute(node);
}
function pickProbeRoute(nodes) {
  return nodes.find((node) => isEligibleProbeRoute(node)) ?? null;
}
var PROBE_FRAME_ELEMENT_FLOOR = 5;
function isSubstantiveFrame(elementCount) {
  return elementCount !== null && elementCount >= PROBE_FRAME_ELEMENT_FLOOR;
}
var PROBE_LAUNCH_READY_BUDGET_MS = 3e4;
function judgeProbeFrame(input) {
  if (input.verdict === "match") return "match";
  if (input.verdict === null || input.verdict === "uncertain") return "inconclusive";
  if (!input.preOpenSubstantive) return "inconclusive";
  if (input.frameChangedAfterOpen !== true) return "inconclusive";
  if (!input.settled) return "inconclusive";
  if (!isSubstantiveFrame(input.elementCount)) return "inconclusive";
  return "mismatch";
}

// packages/core/src/app-flow/replay-divergence.ts
function asRecord(value) {
  return typeof value === "object" && value !== null ? value : void 0;
}
function describeReplayDivergence(error) {
  const divergence = asRecord(asRecord(asRecord(error)?.details)?.divergence);
  if (!divergence) return void 0;
  const parts = [];
  const cause = asRecord(divergence.cause);
  if (typeof cause?.code === "string") parts.push(`cause ${cause.code}`);
  if (typeof divergence.repairHint === "string") parts.push(`repairHint ${divergence.repairHint}`);
  const binding = asRecord(divergence.targetBinding);
  if (binding) {
    if (typeof binding.matchCount === "number") parts.push(`matchCount ${binding.matchCount}`);
    if (Array.isArray(binding.mismatches) && binding.mismatches.length > 0)
      parts.push(`mismatches ${binding.mismatches.slice(0, 5).map(String).join("; ")}`);
    if (Array.isArray(binding.candidates))
      parts.push(`${binding.candidates.length} candidate(s) shared the recorded identity`);
  }
  const resume = asRecord(divergence.resume);
  if (resume) {
    const allowed = resume.allowed === true;
    parts.push(
      `resume ${allowed ? "allowed" : `denied${typeof resume.reason === "string" ? ` (${resume.reason})` : ""}`}`
    );
    if (allowed) {
      parts.push(`from ${String(resume.from)}`);
      if (typeof resume.alternateFrom === "number")
        parts.push(`alternateFrom ${resume.alternateFrom}`);
      if (typeof resume.planDigest === "string") parts.push(`planDigest ${resume.planDigest}`);
    }
    if (resume.repairSessionHeld === true) parts.push("repairSessionHeld");
  }
  const screen = asRecord(divergence.screen);
  if (typeof screen?.state === "string") parts.push(`screen ${screen.state}`);
  if (Array.isArray(screen?.refs) && screen.refs.length > 0) {
    const refs = screen.refs.slice(0, 3).map((raw) => {
      const ref = asRecord(raw);
      if (!ref) return String(raw);
      const label = typeof ref.label === "string" ? ` "${ref.label}"` : "";
      return `${String(ref.ref ?? "?")} [${String(ref.role)}]${label}`;
    });
    parts.push(
      `refs ${refs.join(", ")}${screen.refs.length > 3 ? ` (+${screen.refs.length - 3})` : ""}`
    );
  }
  const suggestions = Array.isArray(divergence.suggestions) ? divergence.suggestions : [];
  for (const raw of suggestions.slice(0, 3)) {
    const suggestion = asRecord(raw);
    if (!suggestion) continue;
    const label = typeof suggestion.label === "string" ? ` "${suggestion.label}"` : "";
    parts.push(`suggestion [${String(suggestion.basis)}]${label} ${String(suggestion.selector)}`);
  }
  return parts.length > 0 ? parts.join(" | ") : void 0;
}
function isStructuralOnlyMismatch(divergence) {
  if (asRecord(divergence.cause)?.code !== "IDENTITY_MISMATCH") return false;
  const binding = asRecord(divergence.targetBinding);
  if (!binding || binding.matchCount !== 1) return false;
  if (Array.isArray(binding.candidates) && binding.candidates.length > 0) return false;
  const mismatches = binding.mismatches;
  if (!Array.isArray(mismatches) || mismatches.length === 0) return false;
  return mismatches.every((entry) => {
    const field2 = String(entry).trimStart();
    return field2.startsWith("ancestry[") || field2.startsWith("position:");
  });
}
function parseStructuralOnlyMismatchStep(error) {
  const divergence = asRecord(asRecord(asRecord(error)?.details)?.divergence);
  if (!divergence || !isStructuralOnlyMismatch(divergence)) return void 0;
  const failedStep = asRecord(divergence.resume)?.from;
  return typeof failedStep === "number" ? failedStep : void 0;
}

// packages/core/src/app-flow/ad-script.ts
var TARGET_COMMENT = "# agent-device:target-v1";
function isExecutable(line) {
  const trimmed = line.trim();
  return trimmed.length > 0 && !trimmed.startsWith("#") && !trimmed.startsWith("context ");
}
function lineIndexOfStep(lines, step) {
  let seen = 0;
  for (const [index, line] of lines.entries()) {
    if (!isExecutable(line)) continue;
    seen += 1;
    if (seen === step) return index;
  }
  return void 0;
}
function pressSelectorAtStep(lines, step) {
  const index = lineIndexOfStep(lines, step);
  if (index === void 0) return void 0;
  const match = /^press\s+"(.*)"$/.exec(lines[index].trim());
  return match ? match[1].replace(/\\(["\\])/g, "$1") : void 0;
}
function stripRecordedIdentity(lines, step) {
  const index = lineIndexOfStep(lines, step);
  if (index === void 0) return void 0;
  if (!/^press\s+"/.test(lines[index].trim())) return void 0;
  if (index === 0 || !lines[index - 1].trim().startsWith(TARGET_COMMENT)) return void 0;
  return [...lines.slice(0, index - 1), ...lines.slice(index)];
}
var INSERTED_WAIT_TIMEOUT_MS = 15e3;
function identityAtStep(lines, step) {
  const index = lineIndexOfStep(lines, step);
  if (index === void 0 || index === 0) return void 0;
  const previous = lines[index - 1].trim();
  if (!previous.startsWith(TARGET_COMMENT)) return void 0;
  try {
    const parsed = JSON.parse(previous.slice(TARGET_COMMENT.length).trim());
    return typeof parsed === "object" && parsed !== null ? parsed : void 0;
  } catch {
    return void 0;
  }
}
function ancestryKeys(identity) {
  const ancestry = identity?.ancestry;
  if (!Array.isArray(ancestry)) return [];
  return ancestry.flatMap((raw) => {
    if (typeof raw !== "object" || raw === null) return [];
    const entry = raw;
    const role = typeof entry.role === "string" ? entry.role : "";
    const label = typeof entry.label === "string" ? entry.label : "";
    return [`${role}/${label}`];
  });
}
function idClause(selector) {
  const first = selector.split("||")[0].trim();
  return /^id="[^"]+"$/.test(first) ? first : void 0;
}
function waitLineFor(clause) {
  const escaped = clause.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `wait "${escaped}" ${INSERTED_WAIT_TIMEOUT_MS}`;
}
function previousExecutable(lines, index) {
  for (let i = index - 1; i >= 0; i--) if (isExecutable(lines[i])) return lines[i].trim();
  return void 0;
}
function unguardPressSteps(lines, step) {
  if (!stripRecordedIdentity(lines, step)) return void 0;
  const unstable = new Set(ancestryKeys(identityAtStep(lines, step)));
  const targets = [];
  let seen = 0;
  for (const [index, line] of lines.entries()) {
    if (!isExecutable(line)) continue;
    seen += 1;
    if (!/^press\s+"/.test(line.trim())) continue;
    if (index === 0 || !lines[index - 1].trim().startsWith(TARGET_COMMENT)) continue;
    const shares = ancestryKeys(identityAtStep(lines, seen)).some((key2) => unstable.has(key2));
    if (seen === step || shares) targets.push({ step: seen, index });
  }
  let next = [...lines];
  const stripped = [];
  const guarded = [];
  for (const target2 of [...targets].reverse()) {
    const selector = pressSelectorAtStep(lines, target2.step);
    const clause = selector ? idClause(selector) : void 0;
    const wait2 = clause ? waitLineFor(clause) : void 0;
    const alreadyGuarded = previousExecutable(lines, target2.index - 1) === wait2;
    next = [
      ...next.slice(0, target2.index - 1),
      ...wait2 && !alreadyGuarded ? [wait2] : [],
      ...next.slice(target2.index)
    ];
    stripped.unshift(target2.step);
    if (wait2 && !alreadyGuarded) guarded.unshift(target2.step);
  }
  return { lines: next, stripped, guarded };
}
function destinationGuardSelector(lines) {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!isExecutable(lines[i])) continue;
    const match = /^wait\s+"(.*)"\s+\d+$/.exec(lines[i].trim());
    return match ? match[1].replace(/\\(["\\])/g, "$1") : void 0;
  }
  return void 0;
}

// packages/core/src/app-flow/storage.ts
import { createHash, randomUUID } from "node:crypto";
import { mkdir as mkdir2, readdir as readdir2, readFile as readFile2, rename, rm, unlink, writeFile } from "node:fs/promises";
import { basename, join as join5 } from "node:path";

// packages/core/src/app-flow/reach/chrome-inventory.ts
var MIN_CHROME_ITEM_COVERAGE = 0.5;
var MIN_CHROME_ITEMS = 3;
var MAX_CHROME_ITEM_LABEL_LENGTH = 40;
var MAX_CHROME_ITEM_LABEL_WORDS = 5;
function looksLikeChromeCaption(label) {
  if (label.includes("\n")) return false;
  if (label.length > MAX_CHROME_ITEM_LABEL_LENGTH) return false;
  if (label.trim().split(/\s+/).length > MAX_CHROME_ITEM_LABEL_WORDS) return false;
  return true;
}
function pressableTrigger(pressable) {
  if (pressable.identifier?.trim()) return { by: "id", value: pressable.identifier.trim() };
  if (pressable.label?.trim()) return { by: "label", value: pressable.label.trim() };
  if (pressable.text?.trim()) return { by: "text", value: pressable.text.trim() };
  return null;
}
function pressableLabel(pressable) {
  return (pressable.text ?? pressable.label ?? pressable.identifier ?? "").trim();
}
var DRAWER_OPENER_PATTERN = /drawer|hamburger|burger[-_ ]?menu|nav(?:igation)?[-_ ]?menu|menu[-_ ]?(?:button|icon|toggle)|open[-_ ]?menu/i;
function triggerMatchCount(pressables, trigger) {
  const field2 = trigger.by === "id" ? "identifier" : trigger.by === "label" ? "label" : "text";
  let count = 0;
  for (const pressable of pressables) {
    if (pressable[field2]?.trim() === trigger.value)
      count++;
  }
  return count;
}
function candidateTriggers(pressable) {
  const triggers = [];
  if (pressable.identifier?.trim()) triggers.push({ by: "id", value: pressable.identifier.trim() });
  if (pressable.label?.trim()) triggers.push({ by: "label", value: pressable.label.trim() });
  if (pressable.text?.trim()) triggers.push({ by: "text", value: pressable.text.trim() });
  return triggers;
}
function findDrawerOpener(pressables) {
  for (const pressable of pressables) {
    const candidateText = [pressable.identifier, pressable.label, pressable.text].filter(Boolean).join(" ");
    if (!DRAWER_OPENER_PATTERN.test(candidateText)) continue;
    for (const trigger of candidateTriggers(pressable)) {
      if (triggerMatchCount(pressables, trigger) === 1) return trigger;
    }
  }
  return null;
}
function inferChromeKind(reveal) {
  const openedByDrawerControl = reveal.some((step) => {
    const locator = "locator" in step ? step.locator : null;
    return locator ? DRAWER_OPENER_PATTERN.test(locator.value) : false;
  });
  return openedByDrawerControl ? "drawer" : "tabs";
}
function detectChromeInventory(pressables, candidates, options = {}) {
  const minCoverage = options.minCoverage ?? MIN_CHROME_ITEM_COVERAGE;
  const claimed = /* @__PURE__ */ new Set();
  const items = [];
  for (const pressable of pressables) {
    const trigger = pressableTrigger(pressable);
    const label = pressableLabel(pressable);
    if (!trigger || !label) continue;
    if (!looksLikeChromeCaption(label)) continue;
    const tokens = new Set(tokenize(label));
    if (!tokens.size) continue;
    let best = null;
    for (const candidate of candidates) {
      if (claimed.has(candidate.label)) continue;
      const score = expectedCoverage(tokens, candidate.tokens);
      if (score < minCoverage) continue;
      if (!best || score > best.score) best = { candidate, score };
    }
    if (!best) continue;
    claimed.add(best.candidate.label);
    items.push({ label, toNodeId: best.candidate.toNodeId, trigger });
  }
  return items.length >= MIN_CHROME_ITEMS ? { items } : null;
}
function chromeEdges(chrome) {
  const evidence = {
    structureRevision: chrome.structureRevision,
    observedAt: chrome.observedAt,
    verified: false,
    chromeId: chrome.id
  };
  const edges = [
    {
      from: chrome.entryNodeId,
      to: chrome.id,
      raw: `reveal "${chrome.id}"`,
      target: null,
      trigger: revealLocator(chrome),
      origin: "runtime-chrome",
      kind: "reveal",
      evidence
    }
  ];
  for (const item of corroboratedChromeItems(chrome)) {
    if (!item.toNodeId) continue;
    edges.push({
      from: chrome.id,
      to: item.toNodeId,
      raw: `chrome "${item.label}"`,
      target: null,
      trigger: item.trigger,
      origin: "runtime-chrome",
      evidence
    });
  }
  return edges;
}
function chromeSlug(id2) {
  return id2.replace(/[^a-zA-Z0-9]/g, "_").replace(/_+/g, "_").toLowerCase();
}
function chromeTitle(kind) {
  return kind === "drawer" ? "Drawer" : "Tab bar";
}
function chromeVirtualNodes(chrome) {
  const seen = /* @__PURE__ */ new Set();
  return chrome.filter((entry) => {
    if (seen.has(entry.id)) return false;
    seen.add(entry.id);
    return true;
  }).map((entry) => ({
    id: entry.id,
    urlPath: null,
    reach: "navigation-only",
    title: chromeTitle(entry.kind),
    file: null,
    slug: chromeSlug(entry.id),
    group: "",
    groups: [],
    navigator: null,
    params: [],
    presentation: null,
    guard: null,
    capture: null,
    origin: "chrome"
  }));
}
function chromeItemLabels(chrome) {
  return new Set(chrome.items.map((item) => item.label.trim().toLowerCase()));
}
var MIN_SHARED_CHROME_ITEMS = 2;
function sameChrome(a, b) {
  if (a.id === b.id) return true;
  if ((a.kind ?? inferChromeKind(a.reveal)) !== (b.kind ?? inferChromeKind(b.reveal))) return false;
  const labelsA = chromeItemLabels(a);
  const labelsB = chromeItemLabels(b);
  let shared = 0;
  for (const label of labelsB) if (labelsA.has(label)) shared++;
  return shared >= Math.min(MIN_SHARED_CHROME_ITEMS, labelsA.size, labelsB.size);
}
function findMatchingChrome(existing, detected) {
  return existing.find((chrome) => sameChrome(chrome, detected)) ?? null;
}
var MIN_CHROME_ITEM_SIGHTINGS = 2;
var MIN_CHROME_ITEM_SIGHTING_RATIO = 0.5;
function mergeChromeInventory(existing, detected) {
  const match = findMatchingChrome(existing, detected);
  if (!match) {
    return [...existing, { ...detected, sightings: 1, items: detected.items.map(firstSighting) }];
  }
  const items = new Map(
    match.items.map((item) => [item.label, { ...item, sightings: item.sightings ?? 1 }])
  );
  for (const item of detected.items) {
    const already = items.get(item.label);
    items.set(item.label, { ...item, sightings: (already?.sightings ?? 0) + 1 });
  }
  const merged = {
    ...match,
    items: [...items.values()],
    sightings: (match.sightings ?? 1) + 1,
    observedAt: detected.observedAt,
    structureRevision: detected.structureRevision,
    reveal: detected.reveal.length ? detected.reveal : match.reveal
  };
  return existing.map((chrome) => chrome === match ? merged : chrome);
}
function firstSighting(item) {
  return { ...item, sightings: 1 };
}
function corroboratedChromeItems(chrome) {
  const sightings = chrome.sightings ?? 1;
  if (sightings < 2) return [...chrome.items];
  const required = Math.max(
    MIN_CHROME_ITEM_SIGHTINGS,
    Math.ceil(sightings * MIN_CHROME_ITEM_SIGHTING_RATIO)
  );
  return chrome.items.filter((item) => (item.sightings ?? 1) >= required);
}
function revealLocator(chrome) {
  return chrome.reveal.find((step) => "locator" in step && step.locator)?.locator ?? null;
}
function showsControl(node, locator) {
  return (node.capture?.pressables ?? []).some((pressable) => {
    if (locator.by === "id") return pressable.identifier === locator.value;
    if (locator.by === "label") return pressable.label === locator.value;
    return pressable.text === locator.value;
  });
}
var MIN_CHROME_SITES = 2;
function chromeSites(chrome, nodes) {
  const locator = revealLocator(chrome);
  if (locator) {
    return nodes.filter((node) => node.id !== chrome.id && showsControl(node, locator)).map((node) => node.id);
  }
  const triggers = corroboratedChromeItems(chrome).map((item) => item.trigger);
  return nodes.filter(
    (node) => node.id !== chrome.id && triggers.filter((trigger) => showsControl(node, trigger)).length >= MIN_SHARED_CHROME_ITEMS
  ).map((node) => node.id);
}
function navigatorChrome(chrome, nodes) {
  return chrome.filter((record2) => chromeSites(record2, nodes).length >= MIN_CHROME_SITES);
}
function chromeRevealEdges(chrome, nodes) {
  const locator = revealLocator(chrome);
  if (!locator) return [];
  const evidence = {
    structureRevision: chrome.structureRevision,
    observedAt: chrome.observedAt,
    verified: false,
    chromeId: chrome.id
  };
  return chromeSites(chrome, nodes).map((source) => ({
    from: source,
    to: chrome.id,
    raw: `reveal "${chrome.id}"`,
    target: null,
    trigger: locator,
    origin: "runtime-chrome",
    kind: "reveal",
    evidence
  }));
}
function rebuildChromeEdges(runtimeEdges, chrome, nodes) {
  const kept = runtimeEdges.filter((edge) => edge.origin !== "runtime-chrome");
  const derived = chrome.flatMap((record2) => [
    ...chromeRevealEdges(record2, nodes),
    ...chromeEdges(record2).filter((edge) => edge.kind !== "reveal")
  ]);
  return [...kept, ...derived];
}

// packages/core/src/app-flow/app-flow-normalize.ts
function normalizeAppFlow(result) {
  const healed = dedupeById(
    (result.chrome ?? []).map((chrome) => ({
      ...chrome,
      kind: chrome.kind ?? inferChromeKind(chrome.reveal),
      items: chrome.items.filter((item) => looksLikeChromeCaption(item.label))
    }))
  );
  const allNodes = result.nodes.map((node) => ({
    ...node,
    urlPath: node.urlPath ?? null,
    reach: node.reach ?? (node.urlPath ? "deep-link" : "navigation-only"),
    deepLinkRejection: node.deepLinkRejection ?? null,
    origin: node.origin ?? "parsed"
  }));
  const navigators = navigatorChrome(healed, allNodes);
  const navigatorIds = new Set(navigators.map((chrome) => chrome.id));
  const nodes = allNodes.filter((node) => node.origin !== "chrome" || navigatorIds.has(node.id));
  return {
    ...result,
    manifest: {
      ...result.manifest,
      formatVersion: Math.max(result.manifest.formatVersion ?? 1, 1)
    },
    nodes,
    edges: result.edges.map((edge) => ({
      ...edge,
      origin: edge.origin ?? "parsed"
    })),
    // Filtered to the surfaces the captures corroborate, exactly as the sweep's own assembly does
    // (`orchestrator.ts`) — a document written before `navigatorChrome` existed carries records for
    // context menus that were never navigator chrome, and they must not survive a read.
    runtimeEdges: rebuildChromeEdges(result.runtimeEdges ?? [], navigators, nodes),
    // Per-item, like `node.origin` above, not just defaulting the whole array to `[]`: a document
    // can have a real, non-empty `chrome` array and still predate the `kind` field on each entry.
    // `inferChromeKind` is the same reveal-length rule a fresh detection already uses, so a
    // back-filled record compares identically under `sameChrome` (`reach/chrome-inventory.ts`) to one
    // that carried `kind` from the start.
    // Two repairs beyond the `kind` back-fill, both applied on read so a document written by an
    // earlier sweep heals instead of carrying its damage into every consumer that opens it.
    //
    // Items are re-filtered through `looksLikeChromeCaption`. That guard did not exist when these
    // documents were written, and without it a real sweep recorded 97 items for one tab bar —
    // whole post bodies matched against node vocabulary by token overlap, so that a feed caption
    // about budget legislation was persisted as the control that opens `Support`. Re-running the
    // guard here costs a string length check per item and removes every one of them.
    //
    // Records are deduped by id because a chrome id doubles as a graph node id now
    // (`chromeVirtualNodes`), and a document written before `sameChrome` settled identical ids can
    // hold two records under one — a real sweep produced two `chrome:tabs:MessagesConversation`.
    // First wins: the earlier sighting is the one whose provenance the id already describes.
    chrome: healed,
    navigation: result.navigation ?? null
  };
}
function dedupeById(records) {
  const seen = /* @__PURE__ */ new Set();
  return records.filter((record2) => {
    if (seen.has(record2.id)) return false;
    seen.add(record2.id);
    return true;
  });
}

// packages/core/src/app-flow/host.ts
import { join as join4 } from "node:path";
var configuredHost = null;
function configureAppFlowHost(host) {
  configuredHost = host;
}
function getAppFlowHost() {
  if (!configuredHost) throw new Error("App Flow host has not been configured.");
  return configuredHost;
}
function appFlowDataDir() {
  return getAppFlowHost().dataDir;
}
function appFlowAgentDeviceStateDir() {
  return join4(appFlowDataDir(), "agent-device");
}
function resolveAgentDeviceCommand(command) {
  if (!command.startsWith("agent-device")) return command;
  return `${getAppFlowHost().agentDeviceCli ?? "agent-device"}${command.slice("agent-device".length)}`;
}

// packages/core/src/app-flow/storage.ts
var APP_FLOWS_DIR_NAME = "app-flows";
var PROJECTS_REGISTRY_FILE = "projects.json";
var APP_FLOW_FILE = "app-flow.json";
var MANIFEST_FILE = "manifest.json";
var CAPTURE_STATUS_FILE = "capture-status.json";
var AGENT_DEVICE_SCREENS_FILE = "agent-device-screens.json";
var SWEEP_PROGRESS_FILE = "sweep-progress.json";
var PARAM_STORE_FILE = "param-store.json";
var SCRATCH_DIR_NAME = "scratch";
var AUTH_CHECKPOINT_SLUG = "--auth-checkpoint";
function getScratchDir(projectId) {
  return join5(getProjectDir(projectId), SCRATCH_DIR_NAME);
}
function getScratchPath(projectId, name2) {
  return join5(getScratchDir(projectId), `${name2}.png`);
}
async function prepareScratchDir(projectId) {
  await rm(getScratchDir(projectId), { recursive: true, force: true });
  await ensureDir(getScratchDir(projectId));
}
async function pruneTransientScreens(projectId) {
  const dir = getScreensDir(projectId);
  let entries;
  try {
    entries = await readdir2(dir);
  } catch {
    return;
  }
  const transient = /(^--auth-checkpoint-[0-9a-f-]{8,}\.png$)|(--navigation-step-\d+\.png$)|(--saved-replay-check\.png$)|(--deep-link-check\.png$)|(--navigation-replay-check\.png$)|(--state-start\.png$)|(--state-replay-base-check\.png$)/;
  await Promise.all(
    entries.filter((entry) => transient.test(entry)).map((entry) => unlink(join5(dir, entry)).catch(() => void 0))
  );
}
function getAppFlowsDir() {
  return join5(appFlowDataDir(), APP_FLOWS_DIR_NAME);
}
function getRegistryPath() {
  return join5(getAppFlowsDir(), PROJECTS_REGISTRY_FILE);
}
function getProjectId(projectPath) {
  return createHash("sha256").update(projectPath).digest("hex").slice(0, 16);
}
function getProjectDir(projectId) {
  return join5(getAppFlowsDir(), projectId);
}
function getScreensDir(projectId) {
  return join5(getProjectDir(projectId), "screens");
}
function getFlowsDir(projectId) {
  return join5(getProjectDir(projectId), "flows");
}
async function clearSavedAppFlow(projectId) {
  await rm(getProjectDir(projectId), { recursive: true, force: true });
}
async function ensureDir(path) {
  await mkdir2(path, { recursive: true });
}
async function readJson(path) {
  try {
    const raw = await readFile2(path, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
async function writeJson(path, data) {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(data, null, 2), "utf-8");
  await rename(temporary, path);
}
async function readRegistry() {
  return await readJson(getRegistryPath()) ?? [];
}
async function writeRegistry(entries) {
  await ensureDir(getAppFlowsDir());
  await writeJson(getRegistryPath(), entries);
}
async function registerProject(projectPath) {
  const projectId = getProjectId(projectPath);
  const name2 = basename(projectPath);
  const entries = await readRegistry();
  const existingIndex = entries.findIndex((entry2) => entry2.id === projectId);
  const entry = {
    id: projectId,
    name: name2,
    path: projectPath,
    lastOpenedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  if (existingIndex >= 0) {
    entries[existingIndex] = entry;
  } else {
    entries.push(entry);
  }
  await writeRegistry(entries);
  await ensureDir(getProjectDir(projectId));
  await ensureDir(getScreensDir(projectId));
  await ensureDir(getFlowsDir(projectId));
  return { projectId, name: name2 };
}
async function readAppFlow(projectId) {
  const result = await readJson(join5(getProjectDir(projectId), APP_FLOW_FILE));
  if (!result) return null;
  return normalizeAppFlow(result);
}
function screenshotUrl(projectId, relativePath, version) {
  if (!relativePath) return null;
  const path = relativePath.replace(/^\/+/, "");
  const cached2 = version && !path.includes("?") ? `${path}?v=${version}` : path;
  return getAppFlowHost().screenshotUri?.(projectId, cached2) ?? `appflow-image://${projectId}/${cached2}`;
}
function withScreenshotUrls(projectId, capture, version) {
  return {
    ...capture,
    screenshot: screenshotUrl(projectId, capture.screenshot, version),
    // UI-state variants are per-screen files the next explore pass overwrites in place, exactly
    // like the screen's own capture, so they need the same cache-busting version.
    ...capture.uiStates ? {
      uiStates: capture.uiStates.map((state) => ({
        ...state,
        screenshot: screenshotUrl(projectId, state.screenshot, version)
      }))
    } : {}
  };
}
async function readAppFlowForRenderer(projectId) {
  const result = await readAppFlow(projectId);
  if (!result) return null;
  const version = (result.manifest.generatedAt ?? "").replace(/[^0-9a-zA-Z]/g, "");
  return {
    ...result,
    nodes: result.nodes.map(
      (node) => node.capture ? { ...node, capture: withScreenshotUrls(projectId, node.capture, version) } : node
    )
  };
}
async function writeAppFlow(projectId, result) {
  await writeJson(join5(getProjectDir(projectId), APP_FLOW_FILE), result);
}
async function readManifest(projectId) {
  return readJson(join5(getProjectDir(projectId), MANIFEST_FILE));
}
async function writeManifest(projectId, manifest) {
  await writeJson(join5(getProjectDir(projectId), MANIFEST_FILE), manifest);
}
async function writeCaptureStatus(projectId, status) {
  await writeJson(join5(getProjectDir(projectId), CAPTURE_STATUS_FILE), status);
}
async function readParamStore(projectId) {
  return await readJson(join5(getProjectDir(projectId), PARAM_STORE_FILE));
}
async function writeParamStore(projectId, store) {
  await writeJson(join5(getProjectDir(projectId), PARAM_STORE_FILE), store);
}
async function writeAgentDeviceScreens(projectId, screens) {
  await writeJson(join5(getProjectDir(projectId), AGENT_DEVICE_SCREENS_FILE), screens);
}
async function readAgentDeviceScreens(projectId) {
  return await readJson(
    join5(getProjectDir(projectId), AGENT_DEVICE_SCREENS_FILE)
  ) ?? {};
}
async function readSweepProgress(projectId) {
  const progress = await readJson(
    join5(getProjectDir(projectId), SWEEP_PROGRESS_FILE)
  );
  if (!progress?.structureKey) return null;
  return {
    ...progress,
    captures: progress.captures ?? {},
    opened: progress.opened ?? {},
    inferred: progress.inferred ?? {},
    runtimeNodes: progress.runtimeNodes ?? [],
    runtimeEdges: progress.runtimeEdges ?? [],
    chrome: progress.chrome ?? []
  };
}
async function writeSweepProgress(projectId, progress) {
  await writeJson(join5(getProjectDir(projectId), SWEEP_PROGRESS_FILE), progress);
}
async function clearSweepProgress(projectId) {
  await unlink(join5(getProjectDir(projectId), SWEEP_PROGRESS_FILE)).catch(() => void 0);
}
function generateSlug2(routeId) {
  return routeId.replace(/[^a-zA-Z0-9]/g, "_").replace(/_+/g, "_").toLowerCase();
}
function getScreenshotPath(projectId, slug) {
  return join5(getScreensDir(projectId), `${slug}.png`);
}

// packages/core/src/app-flow-deps/native-build.ts
import { createHash as createHash2 } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir as mkdir3, readdir as readdir3, readFile as readFile3, stat as stat2, writeFile as writeFile2 } from "node:fs/promises";
import { dirname as dirname3, join as join6 } from "node:path";
var NATIVE_BUILDS_FILE = "native-builds.json";
var IGNORED_DIRS = /* @__PURE__ */ new Set([
  "build",
  "Build",
  "Pods",
  "DerivedData",
  ".gradle",
  ".cxx",
  "xcuserdata",
  "node_modules"
]);
var ROOT_INPUTS = [
  "package.json",
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lockb",
  "bun.lock",
  "app.json",
  "app.config.js",
  "app.config.ts",
  "app.config.json",
  "expo-env.d.ts"
];
function projectHash(projectPath) {
  return createHash2("sha256").update(projectPath).digest("hex").slice(0, 16);
}
function recordKey(projectPath, platform, deviceId) {
  return `${projectHash(projectPath)}:${platform}:${deviceId}`;
}
async function readRecords(file) {
  try {
    return JSON.parse(await readFile3(file, "utf-8"));
  } catch {
    return {};
  }
}
async function writeRecords(file, records) {
  await mkdir3(dirname3(file), { recursive: true });
  await writeFile2(file, JSON.stringify(records, null, 2), "utf-8");
}
async function collectDir(root, dir, into) {
  let entries;
  try {
    entries = await readdir3(dir, { withFileTypes: true, encoding: "utf-8" });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") && entry.name !== ".xcode.env") continue;
    const full = join6(dir, entry.name);
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      await collectDir(root, full, into);
      continue;
    }
    if (!entry.isFile()) continue;
    into.push(full.slice(root.length + 1));
  }
}
var MAX_HASHED_BYTES = 2 * 1024 * 1024;
async function hashFile(path, hash2) {
  try {
    const { size } = await stat2(path);
    if (size > MAX_HASHED_BYTES) {
      hash2.update(`size:${size}`);
      return;
    }
    hash2.update(await readFile3(path));
  } catch {
    hash2.update("<unreadable>");
  }
}
async function computeNativeBuildFingerprint(projectPath, platform) {
  const nativeDir = join6(projectPath, platform);
  if (!existsSync(nativeDir)) return null;
  const relatives = [];
  await collectDir(nativeDir, nativeDir, relatives);
  if (!relatives.length) return null;
  relatives.sort();
  const hash2 = createHash2("sha256");
  for (const relative5 of relatives) {
    hash2.update(relative5);
    hash2.update("\0");
    await hashFile(join6(nativeDir, relative5), hash2);
    hash2.update("\0");
  }
  for (const name2 of ROOT_INPUTS) {
    const full = join6(projectPath, name2);
    if (!existsSync(full)) continue;
    hash2.update(name2);
    hash2.update("\0");
    await hashFile(full, hash2);
    hash2.update("\0");
  }
  return hash2.digest("hex");
}
function createNativeBuildStore(storeDir) {
  const file = join6(storeDir, NATIVE_BUILDS_FILE);
  async function record2(projectPath, platform, deviceId, fingerprint2, launchTarget) {
    if (!fingerprint2) return;
    const records = await readRecords(file);
    records[recordKey(projectPath, platform, deviceId)] = {
      fingerprint: fingerprint2,
      launchTarget,
      recordedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    await writeRecords(file, records);
  }
  return {
    async has(projectPath, platform, deviceId) {
      return recordKey(projectPath, platform, deviceId) in await readRecords(file);
    },
    async read(projectPath, platform, deviceId, fingerprint2) {
      if (!fingerprint2) return null;
      const existing = (await readRecords(file))[recordKey(projectPath, platform, deviceId)];
      if (!existing || existing.fingerprint !== fingerprint2) return null;
      return existing.launchTarget;
    },
    record: record2,
    async preferredDevice(projectPath, platform) {
      const prefix = `${projectHash(projectPath)}:${platform}:`;
      let best = null;
      for (const [key2, value] of Object.entries(await readRecords(file))) {
        if (!key2.startsWith(prefix)) continue;
        if (best && value.recordedAt <= best.recordedAt) continue;
        best = { deviceId: key2.slice(prefix.length), recordedAt: value.recordedAt };
      }
      return best?.deviceId ?? null;
    },
    async refresh(projectPath, platform, deviceId, fingerprint2) {
      const existing = (await readRecords(file))[recordKey(projectPath, platform, deviceId)];
      if (!existing || !fingerprint2) return;
      await record2(projectPath, platform, deviceId, fingerprint2, existing.launchTarget);
    }
  };
}

// packages/core/src/app-flow-deps/native-build-store.ts
function createAppFlowNativeBuildStore(dataDir) {
  return createNativeBuildStore(dataDir);
}

// packages/core/src/app-flow-deps/profiling/transition-target.ts
var PLACEHOLDER_COORDINATES = /^[xy]\s+[xy]$/i;
var NUMERIC_COORDINATES = /^(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)$/;
function parseInteractionTarget(target2) {
  const trimmed = target2.trim();
  if (!trimmed) throw new Error("Interaction target cannot be empty");
  if (PLACEHOLDER_COORDINATES.test(trimmed)) {
    throw new Error(
      'Target "x y" is a schema placeholder, not a locator. Use text=, label=, id=, an @ref, or numeric coordinates such as "184 412".'
    );
  }
  const coords = NUMERIC_COORDINATES.exec(trimmed);
  if (coords) {
    return { kind: "point", x: Number(coords[1]), y: Number(coords[2]) };
  }
  if (trimmed.startsWith("@")) {
    return { kind: "ref", ref: trimmed };
  }
  return { kind: "selector", selector: trimmed };
}
function toAgentDeviceTarget(target2) {
  if (target2.kind === "point") return { x: target2.x, y: target2.y };
  if (target2.kind === "ref") return { ref: target2.ref };
  return { selector: target2.selector };
}

// packages/core/src/app-flow/capture.ts
var LAUNCH_TIMEOUT_MS = 10 * 60 * 1e3;
var APP_LOAD_WAIT_MS = 1500;
var APP_READY_TIMEOUT_MS = 90 * 1e3;
var SUBSTANTIVE_FRAME_GRACE_MS = 20 * 1e3;
var APP_STABLE_QUIET_MS = 500;
var APP_STABLE_TIMEOUT_MS = 20 * 1e3;
var ENTRY_GATE_TIMEOUT_MS = 15 * 1e3;
var LAUNCHER_RECOVERY_GRACE_MS = 30 * 1e3;
var APP_READY_POLL_MS = 400;
var APP_READY_SETTLE_SIMILARITY = 0.98;
var APP_READY_STALE_SIMILARITY = 0.88;
var APP_READY_MAX_READ_FAILURES = 3;
var ROUTE_WAIT_MS = 800;
var ROUTE_STALE_GRACE_MS = 2e3;
var ROUTE_STALE_MIN_REJECTED_PAIRS = 2;
var ROUTE_OPEN_CLOCK_MAX_AGE_MS = 5e3;
var SETTLE_QUIET_MS = 200;
var ROUTE_SETTLE_TIMEOUT_MS = 30 * 1e3;
var APP_ALIVE_PROBE_TIMEOUT_MS = 5 * 1e3;
var FRAME_COMPARISON_MAX_AGE_MS = 60 * 1e3;
var APP_ALIVE_REUSE_MS = 10 * 1e3;
var NATIVE_INSTALL_SUCCESS_RE = /successfully launched the app|installed the app|opening on |opening .+ on /i;
var EXPO_GO_APP_NAME = "Expo Go";
var EXPO_GO_VERSION = "57.0.9";
function log(step, detail) {
  console.log(detail ? `[app-flow] ${step} \u2014 ${detail}` : `[app-flow] ${step}`);
}
function measurePhase(ctx, phase, work) {
  return ctx.timing?.measure(phase, work) ?? work();
}
function agentDeviceBootCommand() {
  return "agent-device boot --platform ios --target mobile";
}
function agentDeviceInstallCommand(app, appPath) {
  return `agent-device install ${quoteCliArg(app)} ${quoteCliArg(appPath)} --platform ios`;
}
function pinAgentDeviceStateDir() {
  if (process.env.AGENT_DEVICE_STATE_DIR?.trim()) return;
  process.env.AGENT_DEVICE_STATE_DIR = appFlowAgentDeviceStateDir();
}
async function loadAgentDevice() {
  pinAgentDeviceStateDir();
  return getAppFlowHost().loadAgentDevice();
}
var nativeStore = null;
function nativeBuildStore() {
  const dataDir = appFlowDataDir();
  if (!nativeStore || nativeStore.dataDir !== dataDir) {
    nativeStore = { dataDir, store: createAppFlowNativeBuildStore(dataDir) };
  }
  return nativeStore.store;
}
async function closeExistingSession(client) {
  try {
    await client.sessions.close();
  } catch {
  }
}
function detectPackageManager(projectPath) {
  if (existsSync2(join7(projectPath, "yarn.lock"))) return "yarn";
  if (existsSync2(join7(projectPath, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync2(join7(projectPath, "bun.lockb")) || existsSync2(join7(projectPath, "bun.lock"))) {
    return "bun";
  }
  return "npm";
}
function runScriptCommand(packageManager, script, extraArgs = []) {
  const extras = extraArgs.join(" ");
  if (packageManager === "npm") {
    return extras ? `npm run ${script} -- ${extras}` : `npm run ${script}`;
  }
  if (packageManager === "bun") {
    return extras ? `bun run ${script} -- ${extras}` : `bun run ${script}`;
  }
  return extras ? `${packageManager} ${script} ${extras}` : `${packageManager} ${script}`;
}
async function readPackageJson(projectPath) {
  const pkgPath = join7(projectPath, "package.json");
  if (!existsSync2(pkgPath)) {
    throw new Error(`No package.json found in ${projectPath}`);
  }
  return JSON.parse(await readFile4(pkgPath, "utf-8"));
}
async function readPlatformScript(projectPath, platform) {
  const pkg = await readPackageJson(projectPath);
  const script = pkg.scripts?.[platform];
  if (!script) {
    throw new Error(
      `package.json is missing an "${platform}" script. Add one (for example "ios": "expo run:ios") and retry.`
    );
  }
  return script;
}
function classifyLaunchMode(script) {
  if (/\b(expo\s+run:|react-native\s+run-|run-ios|run:ios|run-android|run:android)\b/.test(script)) {
    return "native-run";
  }
  return "expo-go";
}
function nativeDeviceArgs(script, deviceId) {
  const reactNativeCli = isReactNativeCliScript(script);
  if (!deviceId || /\s--(?:device|deviceId|udid)(?:\s|=|$)/.test(` ${script} `)) return [];
  return [reactNativeCli ? "--udid" : "--device", deviceId];
}
function attachAbort(child, signal) {
  const abort = () => {
    if (child.pid) child.kill("SIGTERM");
  };
  signal?.addEventListener("abort", abort, { once: true });
  return () => signal?.removeEventListener("abort", abort);
}
async function spawnCommand(command, cwd, signal) {
  pinAgentDeviceStateDir();
  const child = spawn("/bin/zsh", ["-lc", resolveAgentDeviceCommand(command)], {
    cwd,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  const append = (chunk) => {
    output = (output + chunk.toString("utf-8")).slice(-12e3);
  };
  child.stdout?.on("data", append);
  child.stderr?.on("data", append);
  let exitCode = null;
  child.on("exit", (code) => {
    exitCode = code;
  });
  const detachAbort = attachAbort(child, signal);
  child.once("exit", detachAbort);
  return {
    child,
    getOutput: () => output,
    getExitCode: () => exitCode
  };
}
async function waitWhile(signal, predicate, timeoutMessage) {
  const deadline = Date.now() + LAUNCH_TIMEOUT_MS;
  log("waitWhile", `poll 1s, timeout ${LAUNCH_TIMEOUT_MS / 1e3}s`);
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error("Cancelled");
    if (await predicate()) return;
    await new Promise((resolve3) => setTimeout(resolve3, 1e3));
  }
  throw new Error(timeoutMessage());
}
async function installNativeApp(ctx, script, deviceId) {
  const reactNativeCli = isReactNativeCliScript(script);
  let metroPort = reactNativeCli ? await findAvailablePort() : null;
  const extraArgs = [
    ...bundlerCliArgs({
      reactNativeCli,
      startBundler: true,
      port: reactNativeCli ? metroPort : 0
    }),
    ...nativeDeviceArgs(script, deviceId)
  ];
  const command = runScriptCommand(detectPackageManager(ctx.projectPath), ctx.platform, extraArgs);
  log("install native app", `${command} (timeout ${LAUNCH_TIMEOUT_MS / 1e3}s)`);
  const metroLogPath = await beginSessionMetroLog({
    userDataDir: appFlowDataDir(),
    projectId: ctx.projectId,
    sessionName: ctx.sessionName
  });
  const { child, getOutput, getExitCode } = await spawnCommand(command, ctx.projectPath, ctx.signal);
  pipeChildToMetroLog(metroLogPath, child);
  let launched = false;
  const watch = (chunk) => {
    const text2 = chunk.toString("utf-8");
    if (NATIVE_INSTALL_SUCCESS_RE.test(text2)) launched = true;
    if (metroPort == null) {
      const parsed = parseMetroPortFromOutput(text2);
      if (parsed) metroPort = parsed;
    }
  };
  child.stdout?.on("data", watch);
  child.stderr?.on("data", watch);
  try {
    await waitWhile(
      ctx.signal,
      async () => {
        const exitCode = getExitCode();
        if (exitCode !== null && exitCode !== 0) {
          throw new Error(
            `"${command}" exited with code ${exitCode}.
${getOutput().trim() || "(no output)"}`
          );
        }
        if (!(exitCode === 0 || launched)) return false;
        if (metroPort == null) metroPort = parseMetroPortFromOutput(getOutput());
        return metroPort != null && await isMetroReady(metroPort);
      },
      () => `"${command}" timed out waiting for the native ${ctx.platform} install.
${getOutput().trim() || "(no output)"}`
    );
  } catch (error) {
    if (child.pid) child.kill("SIGTERM");
    throw error;
  }
  log("install native app", `app launched, Metro on ${metroPort} pid=${child.pid}`);
  return { child, metroPort, metroLogPath };
}
async function runUntilExit(command, cwd, signal) {
  const { child, getOutput, getExitCode } = await spawnCommand(command, cwd, signal);
  try {
    await waitWhile(
      signal,
      () => getExitCode() !== null,
      () => `"${command}" timed out.
${getOutput().trim() || "(no output)"}`
    );
  } catch (error) {
    if (child.pid) child.kill("SIGTERM");
    throw error;
  }
  const exitCode = getExitCode();
  if (exitCode !== 0) {
    throw new Error(
      `"${command}" exited with code ${exitCode}.
${getOutput().trim() || "(no output)"}`
    );
  }
  return getOutput();
}
function stripAnsi(text2) {
  return text2.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g"), "");
}
function resolveMaybeHomePath(filePath, cwd) {
  if (filePath === "~") return homedir();
  if (filePath.startsWith("~/")) return join7(homedir(), filePath.slice(2));
  if (!isAbsolute(filePath)) return join7(cwd, filePath);
  return filePath;
}
function parseExpoGoDownloadPath(output, cwd) {
  const lines = stripAnsi(output).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const marker = "Expo Go downloaded to";
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith(marker)) continue;
    const rest = lines[i].slice(marker.length).trim();
    const candidate = rest || lines[i + 1];
    if (candidate) return resolveMaybeHomePath(candidate, cwd);
  }
  return null;
}
async function findDownloadedExpoGo(cwd, platform) {
  const entries = await readdir4(cwd).catch(() => []);
  const suffix = platform === "android" ? ".apk" : ".app";
  const hit = entries.find((entry) => entry.toLowerCase().endsWith(suffix));
  return hit ? join7(cwd, hit) : null;
}
async function downloadExpoGo(ctx) {
  const projectDir = getProjectDir(ctx.projectId);
  const existing = await findDownloadedExpoGo(projectDir, ctx.platform);
  if (existing && existsSync2(existing)) return existing;
  const command = `npx -y expo-go download ${ctx.platform} ${EXPO_GO_VERSION}`;
  log("download Expo Go", `${command} (timeout ${LAUNCH_TIMEOUT_MS / 1e3}s)`);
  const output = await runUntilExit(command, projectDir, ctx.signal);
  const fromLog = parseExpoGoDownloadPath(output, projectDir);
  if (fromLog && existsSync2(fromLog)) return fromLog;
  const fromDir = await findDownloadedExpoGo(projectDir, ctx.platform);
  if (fromDir) return fromDir;
  throw new Error(
    `Could not determine the Expo Go download path after "${command}".
${output.trim() || "(no output)"}`
  );
}
async function ensureMetro(ctx) {
  const pkg = await readPackageJson(ctx.projectPath);
  const packageManager = detectPackageManager(ctx.projectPath);
  const expo = isExpoProject(pkg);
  let metroPort = expo ? null : await findAvailablePort();
  const portArgs = ["--port", expo ? "0" : String(metroPort)];
  const command = pkg.scripts?.start ? runScriptCommand(packageManager, "start", portArgs) : expo ? "npx expo start --port 0" : `npx react-native start --port ${metroPort}`;
  log("start Metro", `${command} (poll 1s, timeout ${LAUNCH_TIMEOUT_MS / 1e3}s)`);
  const metroLogPath = await beginSessionMetroLog({
    userDataDir: appFlowDataDir(),
    projectId: ctx.projectId,
    sessionName: ctx.sessionName
  });
  const { child, getOutput, getExitCode } = await spawnCommand(command, ctx.projectPath, ctx.signal);
  pipeChildToMetroLog(metroLogPath, child);
  const watch = (chunk) => {
    if (metroPort != null) return;
    const parsed = parseMetroPortFromOutput(chunk.toString("utf-8"));
    if (parsed) metroPort = parsed;
  };
  child.stdout?.on("data", watch);
  child.stderr?.on("data", watch);
  try {
    await waitWhile(
      ctx.signal,
      async () => {
        const exitCode = getExitCode();
        if (exitCode !== null && exitCode !== 0) {
          throw new Error(
            `"${command}" exited with code ${exitCode}.
${getOutput().trim() || "(no output)"}`
          );
        }
        if (metroPort == null) metroPort = parseMetroPortFromOutput(getOutput());
        return metroPort != null && await isMetroReady(metroPort);
      },
      () => `"${command}" timed out waiting for Metro.
${getOutput().trim() || "(no output)"}`
    );
    log("metro status", `running on ${metroPort}`);
    return { child, metroPort, metroLogPath };
  } catch (error) {
    if (child.pid) child.kill("SIGTERM");
    throw error;
  }
}
var MetroUnavailableError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "MetroUnavailableError";
  }
};
async function ensureAdoptedMetro(ctx, device, options) {
  const probe = options.probe ?? isMetroReady;
  const recover = options.recover ?? ensureMetro;
  const adoptedPort = device.metroPort;
  if (adoptedPort && await probe(adoptedPort)) {
    log("adopted metro", `port ${adoptedPort} still answering`);
    return { status: "live", metroPort: adoptedPort };
  }
  log(
    "adopted metro",
    `port ${adoptedPort || "none"} did not answer \u2014 restarting the dev server for this project`
  );
  try {
    const metro = await recover(ctx);
    stopLaunchProcess(device.launchProcess);
    await endMetroLogFile(device.metroLogPath);
    device.launchProcess = metro.child;
    device.metroPort = metro.metroPort;
    device.metroLogPath = metro.metroLogPath;
    device.devClientUrl = device.devClientUrl ? devClientReconnectUrl(ctx.scheme, true, metro.metroPort) : null;
    if (device.launchUrl && adoptedPort) {
      device.launchUrl = device.launchUrl.split(`:${adoptedPort}`).join(`:${metro.metroPort}`);
    }
    log("adopted metro", `recovered on ${metro.metroPort} pid=${metro.child.pid}`);
    return { status: "recovered", metroPort: metro.metroPort };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const problem = `The Metro dev server for this project is not reachable${adoptedPort ? ` on port ${adoptedPort}` : ""}, and restarting it failed: ${detail}`;
    if (options.explorationMode === "fast") {
      throw new MetroUnavailableError(
        `${problem}
Fast capture reaches every screen through Metro, so it cannot run without it. Start the dev server for this project and build again.`
      );
    }
    return {
      status: "degraded",
      metroPort: adoptedPort,
      warning: `${problem} Continuing without runtime navigation \u2014 deep links and on-device exploration do not need it.`
    };
  }
}
function matchInstalledApp(apps, candidates) {
  const installed = apps.map((app) => app.trim()).filter(Boolean);
  for (const candidate of candidates) {
    if (!candidate) continue;
    const hit = installed.find(
      (app) => app === candidate || app.toLowerCase() === candidate.toLowerCase()
    );
    if (hit) return installedAppLaunchTarget(hit);
  }
  for (const candidate of candidates) {
    if (!candidate) continue;
    const needle = candidate.toLowerCase();
    const hit = installed.find((app) => app.toLowerCase().includes(needle));
    if (hit) return installedAppLaunchTarget(hit);
  }
  return null;
}
function installedAppLaunchTarget(app) {
  const formattedApp = app.match(/^.+\s+\(([A-Za-z0-9_.-]+\.[A-Za-z0-9_.-]+)\)$/);
  return formattedApp?.[1]?.trim() || app;
}
async function listInstalledApps(client, platform) {
  return await client.apps.list({ platform }).catch(() => []);
}
async function ensureExpoGoInstalled(client, ctx) {
  const apps = await listInstalledApps(client, ctx.platform);
  const existing = matchInstalledApp(apps, [EXPO_GO_APP_NAME, "host.exp.Exponent"]);
  if (existing) {
    log("Expo Go already installed", existing);
    return { launchTarget: existing, installPath: null };
  }
  const appPath = await downloadExpoGo(ctx);
  log("apps.install", appPath);
  const result = await client.apps.install({
    appPath,
    platform: ctx.platform
  });
  return {
    launchTarget: result.app || result.appId || EXPO_GO_APP_NAME,
    installPath: appPath
  };
}
function agentDeviceErrorHint(error) {
  const details = error?.details;
  const hint = details?.hint;
  return typeof hint === "string" ? hint : void 0;
}
function isMissingSessionError(error) {
  if (isSessionLostMessage(errorMessage(error))) return true;
  const hint = agentDeviceErrorHint(error);
  return hint !== void 0 && isSessionLostMessage(hint);
}
async function openAppSession(client, app, options) {
  const launchTarget = installedAppLaunchTarget(app);
  const url = options?.url?.trim() || null;
  const open2 = async () => {
    if (url && options?.udid && shouldPreapproveUrlScheme(url)) {
      log("preapprove url scheme", `${url} \u2192 ${launchTarget}`);
      await preapproveIosUrlScheme({ udid: options.udid, url, bundleId: launchTarget });
    }
    log(
      "apps.open",
      `${launchTarget}${url ? ` ${url}` : ""}${options?.relaunch ? " --relaunch" : ""}`
    );
    await client.apps.open({
      app: launchTarget,
      platform: "ios",
      ...url ? { url } : {},
      ...options?.relaunch ? { relaunch: true } : {}
    });
  };
  await (options?.timing?.measure("open-url", open2) ?? open2());
}
async function dismissOpenInAppPrompt(device, url) {
  if (device.schemePromptChecked) return;
  if (!url || !shouldPreapproveUrlScheme(url)) return;
  if (isUrlSchemePreapproved(device.deviceId, url)) {
    device.schemePromptChecked = true;
    log("ios open-in prompt", "skipped \u2014 scheme preapproved");
    return;
  }
  const result = await acceptOpenInAppPrompt(device.client);
  if (result === "accepted" || result === "absent") {
    device.schemePromptChecked = true;
    markUrlSchemeApproved(device.deviceId, url);
  }
  log("ios open-in prompt", result);
}
async function openPathToReachApp(device, app, url) {
  await openAppSession(device.client, app, { url, udid: device.deviceId });
  await dismissOpenInAppPrompt(device, url);
}
async function reopenBoundApp(ctx, device, timeoutMs = APP_READY_TIMEOUT_MS) {
  await launchBoundApp(device, ctx.timing);
  await waitForAppReady(ctx, device, ctx.signal, timeoutMs);
}
async function reconnectDevClient(device, timing) {
  if (!device.devClientUrl) return false;
  log("reconnect dev client", device.devClientUrl);
  await openAppSession(device.client, device.launchTarget, {
    timing,
    url: device.devClientUrl,
    // The dev client is already running and showing its launcher; the URL is what it needs, not a
    // restart. Relaunching first would only throw away the process it is about to load into.
    relaunch: false,
    udid: device.deviceId
  });
  await dismissOpenInAppPrompt(device, device.devClientUrl);
  return true;
}
async function goHome(ctx, device, options) {
  if (suppressesSoftHome(device.armedRecording)) {
    log(
      "go home",
      `deferred \u2014 a recording is armed (${device.armedRecording?.scriptPath}) and opening the app here would abort it`
    );
    return;
  }
  if (options?.reconnectDevClientWhenUnloaded && needsDevClientReconnect(device)) {
    await reconnectDevClient(device, ctx.timing);
    await waitForAppReady(ctx, device, ctx.signal);
    return;
  }
  log("go home", `${device.launchTarget}${device.launchUrl ? ` ${device.launchUrl}` : ""}`);
  await openAppSession(device.client, device.launchTarget, {
    timing: ctx.timing,
    url: device.launchUrl,
    relaunch: false,
    udid: device.deviceId
  });
  await dismissOpenInAppPrompt(device, device.launchUrl);
  await waitForAppReady(ctx, device, ctx.signal);
}
async function endLiveSession(device) {
  await device.client.sessions.close().catch(() => void 0);
  device.armedRecording = null;
}
async function launchBoundApp(device, timing) {
  log(
    "reopen bound app",
    `${device.launchTarget}${device.launchUrl ? ` ${device.launchUrl}` : ""} --relaunch=${Boolean(device.launchUrl)}`
  );
  await openAppSession(device.client, device.launchTarget, {
    timing,
    url: device.launchUrl,
    relaunch: Boolean(device.launchUrl),
    udid: device.deviceId
  });
  await dismissOpenInAppPrompt(device, device.launchUrl);
}
async function openInstalledApp(client, ctx, mode, options) {
  if (mode === "expo-go") {
    const launchTarget = options.expoGoTarget ?? EXPO_GO_APP_NAME;
    const launchUrl = `exp://127.0.0.1:${options.metroPort}`;
    await openAppSession(client, launchTarget, {
      url: launchUrl,
      udid: options.udid,
      timing: ctx.timing
    });
    return { launchTarget, launchUrl, useCustomScheme: false };
  }
  const apps = await listInstalledApps(client, ctx.platform);
  const nativeTarget = matchInstalledApp(apps, [ctx.bundleId, ctx.appName, ctx.slug]);
  if (!nativeTarget) {
    const lookedFor = [ctx.bundleId, ctx.appName, ctx.slug].filter(Boolean).join(", ") || "an app name";
    const installed = apps.filter(Boolean).slice(0, 20).join(", ") || "(none)";
    throw new Error(
      `Native ${ctx.platform} app was not installed after running the ${ctx.platform} script. Looked for ${lookedFor}. Installed: ${installed}.`
    );
  }
  await openAppSession(client, nativeTarget, {
    url: options.devClientUrl ?? null,
    udid: options.udid,
    timing: ctx.timing
  });
  return { launchTarget: nativeTarget, launchUrl: null, useCustomScheme: Boolean(ctx.scheme) };
}
async function resolveReusableNativeBuild(client, ctx, deviceId) {
  if (process.env.AI_HARNESS_FORCE_NATIVE_BUILD === "1") {
    log("checkInstalledBuild", "AI_HARNESS_FORCE_NATIVE_BUILD=1 \u2014 rebuilding");
    return null;
  }
  const fingerprint2 = await computeNativeBuildFingerprint(ctx.projectPath, ctx.platform);
  if (!fingerprint2) {
    log("checkInstalledBuild", `no ${ctx.platform}/ sources to fingerprint \u2014 rebuilding`);
    return null;
  }
  const known = await nativeBuildStore().has(ctx.projectPath, ctx.platform, deviceId);
  const recorded = await nativeBuildStore().read(ctx.projectPath, ctx.platform, deviceId, fingerprint2);
  if (!recorded) {
    log(
      "checkInstalledBuild",
      known ? "native sources changed since the last install \u2014 rebuilding" : "no install recorded for this device yet \u2014 building once"
    );
    return null;
  }
  const apps = await listInstalledApps(client, ctx.platform);
  const installed = matchInstalledApp(apps, [recorded]);
  if (!installed) {
    log("checkInstalledBuild", `${recorded} is no longer installed \u2014 rebuilding`);
    return null;
  }
  return installed;
}
async function bootPreferredDevice(client, ctx) {
  const preferred = await nativeBuildStore().preferredDevice(ctx.projectPath, ctx.platform);
  if (preferred) {
    log("devices.boot", `platform=ios target=mobile udid=${preferred} (last built here)`);
    try {
      return await client.devices.boot({
        platform: "ios",
        target: "mobile",
        udid: preferred
      });
    } catch (error) {
      log(
        "devices.boot",
        `${preferred} unavailable (${errorMessage(error)}) \u2014 letting the daemon pick`
      );
    }
  } else {
    log("devices.boot", "platform=ios target=mobile");
  }
  return await client.devices.boot({
    platform: "ios",
    target: "mobile"
  });
}
async function bootDevice(ctx) {
  const script = await readPlatformScript(ctx.projectPath, ctx.platform);
  const mode = classifyLaunchMode(script);
  log("bootDevice", `mode=${mode} session=${ctx.sessionName}`);
  const { createAgentDeviceClient } = await loadAgentDevice();
  const client = createAgentDeviceClient({
    session: ctx.sessionName,
    cwd: ctx.projectPath,
    responseLevel: "digest"
  });
  log("sessions.close", "drop leftover session if any");
  await closeExistingSession(client);
  const bootResult = await bootPreferredDevice(client, ctx);
  log("devices.boot", `device=${bootResult.device} id=${bootResult.id}`);
  const setupCommands = [agentDeviceBootCommand()];
  let expoGoTarget;
  let launchProcess = null;
  let metroPort;
  let metroLogPath = null;
  let reusedNativeBuild = false;
  try {
    if (mode === "native-run") {
      const reusable = await resolveReusableNativeBuild(client, ctx, bootResult.id);
      if (reusable) {
        log("installNativeApp", `skipped \u2014 ${reusable} already installed and unchanged`);
        reusedNativeBuild = true;
        const metro = await ensureMetro(ctx);
        launchProcess = metro.child;
        metroPort = metro.metroPort;
        metroLogPath = metro.metroLogPath;
      } else {
        const installed = await installNativeApp(ctx, script, bootResult.id);
        launchProcess = installed.child;
        metroPort = installed.metroPort ?? 0;
        metroLogPath = installed.metroLogPath;
        if (!metroPort) {
          throw new Error("Native install finished but Metro did not report a port.");
        }
      }
    } else {
      const expoGo = await ensureExpoGoInstalled(client, ctx);
      expoGoTarget = expoGo.launchTarget;
      if (expoGo.installPath) {
        setupCommands.push(agentDeviceInstallCommand(expoGo.launchTarget, expoGo.installPath));
      }
      const metro = await ensureMetro(ctx);
      launchProcess = metro.child;
      metroPort = metro.metroPort;
      metroLogPath = metro.metroLogPath;
      log("ensureMetro", `started pid=${metro.child.pid} port=${metroPort}`);
    }
    const devClientUrl = devClientReconnectUrl(ctx.scheme, mode === "native-run", metroPort);
    const { launchTarget, launchUrl, useCustomScheme } = await openInstalledApp(client, ctx, mode, {
      expoGoTarget,
      udid: bootResult.id,
      metroPort,
      devClientUrl: reusedNativeBuild ? devClientUrl : null
    });
    if (mode === "native-run" && !reusedNativeBuild) {
      await nativeBuildStore().record(
        ctx.projectPath,
        ctx.platform,
        bootResult.id,
        await computeNativeBuildFingerprint(ctx.projectPath, ctx.platform),
        launchTarget
      );
    }
    log(
      "bootDevice done",
      `launchTarget=${launchTarget} launchUrl=${launchUrl ?? "none"} devClientUrl=${devClientUrl ?? "none"} metroPort=${metroPort} metroLog=${metroLogPath ?? "none"} useCustomScheme=${useCustomScheme} nativeBuild=${mode === "native-run" ? reusedNativeBuild ? "reused" : "built" : "n/a"}`
    );
    const device = {
      client,
      deviceId: bootResult.id,
      deviceName: bootResult.device,
      launchProcess,
      metroPort,
      metroLogPath,
      launchTarget,
      launchUrl,
      devClientUrl,
      useCustomScheme,
      setupCommands,
      schemePromptChecked: false,
      lastRead: null,
      lastRouteOpenAt: null,
      pendingEntryGate: false
    };
    await dismissOpenInAppPrompt(device, launchUrl);
    return device;
  } catch (error) {
    stopLaunchProcess(launchProcess);
    await endMetroLogFile(metroLogPath);
    throw error;
  }
}
function buildUrlPath(node, params) {
  if (!node.urlPath) throw new Error(`Screen ${node.id} has no deep link`);
  const pattern = node.urlPath;
  const fill = (key2) => {
    const value = params[key2];
    if (value === void 0) {
      throw new Error(
        `Screen ${node.id} has no observed value for :${key2} \u2014 ${pattern} cannot be opened by URL`
      );
    }
    return value;
  };
  const urlPath = pattern.split("/").map((seg) => {
    if (seg.startsWith(":")) return fill(seg.slice(1));
    if (seg.startsWith("[") && seg.endsWith("]")) {
      return fill(seg.slice(1, -1).replace(/^\.\.\./, ""));
    }
    return seg;
  }).join("/");
  if (urlPath === "/" || urlPath === "") {
    const indexPath = indexDeepLinkPath(node);
    if (!indexPath) {
      throw new Error(
        `Screen ${node.id} sits at "/" and this app declares no route group to open instead \u2014 it has to be reached through the UI`
      );
    }
    return indexPath;
  }
  return urlPath;
}
async function wait(signal, ms, label) {
  log(label, `${ms / 1e3}s`);
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error("Cancelled");
    await sleep2(Math.min(500, deadline - Date.now()));
  }
}
async function waitForAppReady(ctx, device, signal, timeoutMs = APP_READY_TIMEOUT_MS, options) {
  let deadline = Date.now() + timeoutMs;
  const initialWaitMs = options?.initialWaitMs ?? APP_LOAD_WAIT_MS;
  const recentRead = device.lastRead;
  const frameBeforeAction = recentRead && Date.now() - recentRead.at <= FRAME_COMPARISON_MAX_AGE_MS ? fingerprint(recentRead.pressables) : null;
  const staleGraceMs = options?.staleGraceMs ?? APP_LOAD_WAIT_MS;
  const staleSimilarityFloor = options?.staleSimilarityFloor ?? APP_READY_SETTLE_SIMILARITY;
  const staleMinRejectedPairs = options?.staleMinRejectedPairs ?? 0;
  const minInteractiveElements = options?.minInteractiveElements ?? 0;
  const minInteractiveElementsGraceMs = options?.minInteractiveElementsGraceMs ?? Infinity;
  const requestedLauncherDeferralMs = options?.deferLauncherRecoveryMs ?? 0;
  const deferLauncherRecoveryMs = launcherDeferralMs(
    requestedLauncherDeferralMs,
    device.launcherDeferral ?? "untested"
  );
  let loggedLauncherDeferral = false;
  let loggedLauncherRecoveryCause = false;
  const startedAt = Date.now();
  const staleClockStartedAt = Math.min(options?.staleClockStartedAt ?? startedAt, startedAt);
  let heldStaleFrame = false;
  let staleRejectedPairs = 0;
  let lastUndersizedCount = null;
  let undersizedSettledAt = null;
  if (!frameBeforeAction && initialWaitMs > 0) {
    await wait(signal, Math.min(initialWaitMs, timeoutMs), "wait for app to load");
  }
  log("waitForAppReady", `poll ${APP_READY_POLL_MS}ms, timeout ${timeoutMs / 1e3}s`);
  let previous = null;
  let consecutiveReadFailures = 0;
  let reads = 0;
  const sleeps = { launcher: 0, staleFrame: 0, undersized: 0, unsettled: 0 };
  const sleepSummary = () => `sleeps: ${sleeps.staleFrame} stale-frame, ${sleeps.undersized} undersized, ${sleeps.launcher} launcher, ${sleeps.unsettled} unsettled`;
  let launcherRecoveries = 0;
  let lastLauncherRecoveryAt = 0;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error("Cancelled");
    const pressables = await capturePressables(
      ctx,
      device,
      Math.max(1e3, Math.min(3e4, deadline - Date.now())),
      // The poll already clamps each read to what is left; this makes the busy-retry backoff
      // respect the same deadline instead of sleeping 42s of waits inside a 30s window.
      { deadlineAt: deadline }
    ).catch(() => {
      consecutiveReadFailures += 1;
      return null;
    });
    reads += 1;
    if (pressables !== null) consecutiveReadFailures = 0;
    else if (consecutiveReadFailures >= APP_READY_MAX_READ_FAILURES) {
      log("waitForAppReady", `device stopped answering after ${consecutiveReadFailures} reads`);
      return false;
    }
    if (pressables?.length && isDevClientLauncher(pressables)) {
      const deferringRecovery = Date.now() - startedAt < deferLauncherRecoveryMs;
      const waitingOnRecovery = Date.now() - lastLauncherRecoveryAt < LAUNCHER_RECOVERY_GRACE_MS;
      if (deferringRecovery) {
        if (!loggedLauncherDeferral) {
          loggedLauncherDeferral = true;
          log(
            "waitForAppReady",
            `dev-client launcher on screen with a recording armed \u2014 waiting up to ${(deferLauncherRecoveryMs / 1e3).toFixed(
              1
            )}s for it to clear, because opening the app again here would abort publication`
          );
        }
        deadline = Math.max(deadline, startedAt + deferLauncherRecoveryMs);
      } else if (!waitingOnRecovery) {
        if (requestedLauncherDeferralMs > 0 && !loggedLauncherRecoveryCause) {
          loggedLauncherRecoveryCause = true;
          log(
            "waitForAppReady",
            deferLauncherRecoveryMs > 0 ? `dev-client launcher did not clear in ${(deferLauncherRecoveryMs / 1e3).toFixed(1)}s \u2014 recovering, which will abort the armed recording` : "dev-client launcher on screen with a recording armed \u2014 recovering immediately, an earlier deferral on this device already ran out without it clearing"
          );
        }
        if (requestedLauncherDeferralMs > 0) device.launcherDeferral = "expired";
        if (noteOpenWhileArmed(device.armedRecording)) {
          log(
            "waitForAppReady",
            `the recovery below aborts the armed recording (${device.armedRecording?.scriptPath}); it will be re-armed once the app is back`
          );
        }
        if (launcherRecoveries >= 2) {
          log(
            "waitForAppReady",
            `dev-client launcher still on screen after ${launcherRecoveries} recovery attempts`
          );
          return false;
        }
        const reconnected = launcherRecoveries === 0 && await reconnectDevClient(device, ctx.timing);
        if (reconnected) {
          log("waitForAppReady", "dev-client launcher on screen \u2014 reconnecting to Metro");
          launcherRecoveries = 1;
        } else {
          log("waitForAppReady", "dev-client launcher on screen \u2014 relaunching the bound app");
          await launchBoundApp(device, ctx.timing);
          launcherRecoveries = 2;
        }
        lastLauncherRecoveryAt = Date.now();
        deadline = Math.max(deadline, lastLauncherRecoveryAt + LAUNCHER_RECOVERY_GRACE_MS);
      }
      previous = null;
      sleeps.launcher += 1;
      await measurePhase(ctx, "settle-poll", () => sleep2(Math.max(APP_READY_POLL_MS, 1500)));
      continue;
    }
    if (pressables?.length && !isLoadingScreen(pressables)) {
      const current = fingerprint(pressables);
      if (previous && similarity(previous, current) >= APP_READY_SETTLE_SIMILARITY) {
        if (frameBeforeAction && isFrameUnchangedSinceAction({
          before: frameBeforeAction,
          settled: current,
          // The grace clock is not allowed to run at all until the guard has actually rejected
          // `staleMinRejectedPairs` agreeing pairs — see that option. Reporting 0 elapsed is how
          // that is said through a function whose contract is "elapsed versus grace", and it
          // keeps `isFrameUnchangedSinceAction` free of a second, device-shaped concept.
          elapsedMs: staleRejectedPairs >= staleMinRejectedPairs ? Date.now() - staleClockStartedAt : 0,
          graceMs: staleGraceMs,
          similarityFloor: staleSimilarityFloor
        })) {
          if (!heldStaleFrame) {
            heldStaleFrame = true;
            log(
              "waitForAppReady",
              `frame is still the one from before this action \u2014 waiting up to ${staleGraceMs / 1e3}s for it to change`
            );
          }
          staleRejectedPairs += 1;
          previous = current;
          sleeps.staleFrame += 1;
          await measurePhase(ctx, "settle-poll", () => sleep2(APP_READY_POLL_MS));
          continue;
        }
        if (pressables.length < minInteractiveElements) {
          undersizedSettledAt ??= Date.now();
          const heldForMs = Date.now() - undersizedSettledAt;
          if (heldForMs >= minInteractiveElementsGraceMs) {
            log(
              "waitForAppReady",
              `stable at ${pressables.length} interactive elements for ${(heldForMs / 1e3).toFixed(1)}s without reaching ${minInteractiveElements} \u2014 treating this as the app's own screen`
            );
            return false;
          }
          if (lastUndersizedCount !== pressables.length) {
            lastUndersizedCount = pressables.length;
            log(
              "waitForAppReady",
              `stable at ${pressables.length} interactive elements, below the ${minInteractiveElements} required \u2014 still waiting for the app to finish loading`
            );
          }
          previous = current;
          sleeps.undersized += 1;
          await measurePhase(ctx, "settle-poll", () => sleep2(APP_READY_POLL_MS));
          continue;
        }
        log(
          "waitForAppReady",
          `settled with ${pressables.length} interactive elements after ${reads} reads in ${((Date.now() - startedAt) / 1e3).toFixed(1)}s (${sleepSummary()})`
        );
        return true;
      }
      previous = current;
    } else {
      previous = null;
    }
    sleeps.unsettled += 1;
    await measurePhase(ctx, "settle-poll", () => sleep2(APP_READY_POLL_MS));
  }
  log(
    "waitForAppReady",
    `still loading after ${timeoutMs / 1e3}s and ${reads} reads, capturing anyway (${sleepSummary()})`
  );
  return false;
}
async function waitForRoute(signal, timeoutMs = ROUTE_WAIT_MS) {
  await wait(signal, Math.min(ROUTE_WAIT_MS, timeoutMs), "wait for route");
}
async function settleAfterRoute(ctx, device, signal, timeoutMs = ROUTE_SETTLE_TIMEOUT_MS, options) {
  const openedAt = device.lastRouteOpenAt;
  const staleClockStartedAt = openedAt !== null && Date.now() - openedAt <= ROUTE_OPEN_CLOCK_MAX_AGE_MS ? openedAt : void 0;
  return waitForAppReady(ctx, device, signal, timeoutMs, {
    minInteractiveElements: options?.minInteractiveElements,
    // No sleep in front of the poll, and none needed: the pre-open frame is what the sleep was
    // guarding against being mistaken for the destination, and `waitForAppReady` now compares
    // against it directly. `ROUTE_WAIT_MS` survives as the ceiling on that comparison — the
    // router beat it was always sized for — rather than as a cost every route pays.
    initialWaitMs: 0,
    staleGraceMs: ROUTE_STALE_GRACE_MS,
    // The three things `session_2026-10-13_14-33-40.log` showed the guard needed and did not have:
    // a floor that recognises a mid-transition composite (0.98 did not — see
    // `APP_READY_STALE_SIMILARITY`), a clock that starts at the open rather than at this wait
    // (~0.5s of the old 800ms went to the gap between them), and a minimum number of rejections so
    // a fast read cannot settle before the guard has judged anything at all (PostLikedBy's first
    // agreeing pair landed at 1.18s, past the whole grace).
    staleSimilarityFloor: APP_READY_STALE_SIMILARITY,
    staleClockStartedAt,
    staleMinRejectedPairs: ROUTE_STALE_MIN_REJECTED_PAIRS
  });
}
async function openUrlInSession(ctx, device, app, url, options) {
  try {
    await openAppSession(device.client, app, {
      url,
      relaunch: options?.relaunch,
      udid: device.deviceId,
      timing: ctx.timing
    });
  } catch (error) {
    if (!isMissingSessionError(error)) throw error;
    log(
      "openApp",
      `no active session, recovering \u2014 while opening ${app}${url ? " with a URL" : ""} \u2014 ${describeSessionLoss(errorMessage(error), agentDeviceErrorHint(error))}`
    );
    await reopenBoundApp(ctx, device);
    await openAppSession(device.client, app, {
      url,
      relaunch: options?.relaunch,
      udid: device.deviceId,
      timing: ctx.timing
    });
  }
  await dismissOpenInAppPrompt(device, url);
}
function resolveDeepLink(ctx, device, node, params) {
  const urlPath = buildUrlPath(node, params);
  if (device.useCustomScheme && ctx.scheme) {
    return {
      app: device.launchTarget,
      url: `${ctx.scheme}://${urlPath.replace(/^\//, "")}`
    };
  }
  if (!device.launchUrl) {
    throw new Error(`Screen ${node.id} has no usable native URL scheme`);
  }
  return {
    app: device.launchTarget,
    url: `exp://127.0.0.1:${device.metroPort}/--${urlPath}`
  };
}
function buildAgentDevicePathToReach(ctx, device, node, params, opened) {
  const target2 = opened ?? resolveDeepLink(ctx, device, node, params);
  return [...device.setupCommands, agentDeviceOpenCommand(target2.app, target2.url)];
}
async function openDeepLink(ctx, device, node, params) {
  const urlPath = buildUrlPath(node, params);
  log("openDeepLink", `${node.id} \u2192 ${urlPath}`);
  const recent = device.lastRead;
  const reusable = recent && Date.now() - recent.at <= APP_ALIVE_REUSE_MS ? recent.pressables : null;
  if (reusable) log("openDeepLink", "app was alive moments ago, skipping the liveness probe");
  const alive = reusable ?? await capturePressables(ctx, device, APP_ALIVE_PROBE_TIMEOUT_MS, {
    retries: 0
  }).catch(() => null);
  if (!alive?.length || isLoadingScreen(alive) || isDevClientLauncher(alive)) {
    await waitForAppReady(ctx, device, ctx.signal, ROUTE_SETTLE_TIMEOUT_MS, { initialWaitMs: 0 });
  }
  const preOpenPressables = device.lastRead?.pressables ?? alive ?? null;
  if (device.useCustomScheme && ctx.scheme) {
    const deepPath = urlPath.replace(/^\//, "");
    const url = `${ctx.scheme}://${deepPath}`;
    try {
      await openUrlInSession(ctx, device, device.launchTarget, url);
      device.lastRouteOpenAt = Date.now();
      return { app: device.launchTarget, url, preOpenPressables };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/failed to open/i.test(message)) throw error;
    }
  }
  if (!device.launchUrl) {
    throw new Error(`Screen ${node.id} has no usable native URL scheme`);
  }
  const metroUrl = `exp://127.0.0.1:${device.metroPort}/--${urlPath}`;
  const app = device.launchTarget;
  await openUrlInSession(ctx, device, app, metroUrl);
  device.lastRouteOpenAt = Date.now();
  return { app, url: metroUrl, preOpenPressables };
}
var RECORDING_LAUNCHER_PATIENCE_MS = 20 * 1e3;
async function startReplayRecording(ctx, device, scriptPath, launchUrl = device.launchUrl, timeoutMs = APP_READY_TIMEOUT_MS) {
  try {
    await device.client.sessions.close();
  } catch {
  }
  async function recordStableWait() {
    try {
      await measurePhase(
        ctx,
        "device-wait",
        () => device.client.command.wait({
          platform: ctx.platform,
          stable: true,
          quietMs: APP_STABLE_QUIET_MS,
          timeoutMs: Math.max(1e3, Math.min(timeoutMs, APP_STABLE_TIMEOUT_MS))
        })
      );
    } catch (error) {
      log("startReplayRecording", `stable wait not recorded \u2014 ${errorMessage(error)}`);
    }
  }
  const arm = async (relaunch) => {
    await measurePhase(
      ctx,
      "open-url",
      () => device.client.apps.open({
        app: installedAppLaunchTarget(device.launchTarget),
        platform: ctx.platform,
        udid: device.deviceId,
        ...relaunch ? { relaunch: true } : {},
        saveScript: scriptPath,
        force: true,
        ...launchUrl ? { url: launchUrl } : {}
      })
    );
    device.armedRecording = armRecording(scriptPath);
    await dismissOpenInAppPrompt(device, launchUrl);
    await recordStableWait();
  };
  await arm(true);
  await waitForAppReady(ctx, device, ctx.signal, timeoutMs, {
    deferLauncherRecoveryMs: RECORDING_LAUNCHER_PATIENCE_MS,
    minInteractiveElements: PROBE_FRAME_ELEMENT_FLOOR,
    minInteractiveElementsGraceMs: SUBSTANTIVE_FRAME_GRACE_MS
  });
  if (needsRearm(device.armedRecording)) {
    log(
      "startReplayRecording",
      `re-arming ${scriptPath} after the launcher recovery \u2014 its open aborted the first transaction; the replacement records "open" rather than "open --relaunch"`
    );
    try {
      await device.client.sessions.close();
    } catch {
    }
    await arm(false);
    await waitForAppReady(ctx, device, ctx.signal, timeoutMs, {
      minInteractiveElements: PROBE_FRAME_ELEMENT_FLOOR,
      minInteractiveElementsGraceMs: SUBSTANTIVE_FRAME_GRACE_MS
    });
  }
  device.pendingEntryGate = true;
}
async function pressWithLocator(ctx, device, locator, timeoutMs = 1e4) {
  if (device.pendingEntryGate) await recordEntryGate(ctx, device, locator);
  const pressWith = (qualifiers) => measurePhase(
    ctx,
    "press",
    () => device.client.interactions.press({
      platform: ctx.platform,
      ...toAgentDeviceTarget(parseInteractionTarget(serializeLocator(locator, qualifiers))),
      settle: true,
      settleQuietMs: SETTLE_QUIET_MS,
      timeoutMs: Math.max(1, Math.min(1e4, timeoutMs))
    })
  );
  try {
    return didSettle(await pressWith());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!isAmbiguousSelectorMessage(message)) throw error;
    log(
      "pressWithLocator",
      `${serializeLocator(locator)} matched several elements, retrying with hittable=true`
    );
    return didSettle(await pressWith({ hittable: true }));
  }
}
function didSettle(result) {
  return result?.settle?.settled === true;
}
async function recordEntryGate(ctx, device, locator) {
  device.pendingEntryGate = false;
  const selector = serializeLocator(locator);
  try {
    await measurePhase(
      ctx,
      "device-wait",
      () => device.client.command.wait({
        platform: ctx.platform,
        selector,
        timeoutMs: ENTRY_GATE_TIMEOUT_MS
      })
    );
    log("pressWithLocator", `entry gate ${selector}`);
  } catch (error) {
    log("pressWithLocator", `entry gate ${selector} not recorded \u2014 ${errorMessage(error)}`);
  }
}
async function executeNavigationActions(ctx, device, actions, timeoutMs) {
  const deadline = Date.now() + (timeoutMs ?? 12500 * Math.max(1, actions.length));
  for (let index = 0; index < actions.length; index++) {
    if (ctx.signal?.aborted) throw new Error("Cancelled");
    if (Date.now() >= deadline) throw new Error("Navigation action budget exhausted");
    const action = actions[index];
    let settled = false;
    switch (action.type) {
      case "tap": {
        if (!action.locator) throw new Error("Tap action requires a locator");
        settled = await pressWithLocator(
          ctx,
          device,
          action.locator,
          Math.max(1, Math.min(1e4, deadline - Date.now()))
        );
        break;
      }
      case "input":
        if (!action.locator || action.value == null)
          throw new Error("Input action requires locator and value");
        settled = didSettle(
          await device.client.interactions.fill({
            platform: ctx.platform,
            ...toAgentDeviceTarget(parseInteractionTarget(serializeLocator(action.locator))),
            text: action.value,
            settle: true,
            settleQuietMs: SETTLE_QUIET_MS,
            timeoutMs: Math.max(1, Math.min(1e4, deadline - Date.now()))
          })
        );
        break;
      case "swipe":
        await device.client.interactions.scroll({
          platform: ctx.platform,
          direction: action.direction ?? "up"
        });
        break;
      case "wait":
        await measurePhase(
          ctx,
          "device-wait",
          () => device.client.command.wait({
            platform: ctx.platform,
            durationMs: Math.max(
              0,
              Math.min(action.duration ?? 1e3, 1e4, deadline - Date.now())
            )
          })
        );
        break;
    }
    if (action.type !== "wait" && !settled) {
      await waitForRoute(ctx.signal, Math.max(0, deadline - Date.now()));
    }
  }
}
async function stripIdentityAndReplay(ctx, device, scriptPath, destinationSelector, error, deadline) {
  const step = parseStructuralOnlyMismatchStep(error);
  if (step === void 0) return false;
  const original = await readFile4(scriptPath, "utf8").catch(() => void 0);
  if (original === void 0) return false;
  const unguarded = unguardPressSteps(original.split("\n"), step);
  if (!unguarded) return false;
  await device.client.sessions.close().catch(() => void 0);
  const attempt = async () => {
    await runRepairedReplay(ctx, device, scriptPath, deadline);
    await measurePhase(
      ctx,
      "device-wait",
      () => device.client.command.wait({
        platform: ctx.platform,
        selector: destinationSelector,
        timeoutMs: 15e3
      })
    );
  };
  log(
    "saveAndReplayRecording",
    `dropped recorded identity at step(s) ${unguarded.stripped.join(", ")} of ${scriptPath}` + (unguarded.guarded.length > 0 ? `; inserted a selector wait before step(s) ${unguarded.guarded.join(", ")}` : "")
  );
  await writeFile3(scriptPath, unguarded.lines.join("\n"), "utf8");
  let transientRetry = true;
  while (Date.now() < deadline) {
    try {
      await attempt();
      log(
        "saveAndReplayRecording",
        `verified ${scriptPath} with ${unguarded.stripped.length} recorded identity(ies) dropped`
      );
      return true;
    } catch (replayError) {
      const divergence = describeReplayDivergence(replayError);
      log(
        "saveAndReplayRecording",
        `${scriptPath} still diverges after unguarding \u2014 ${errorMessage(replayError)}${divergence ? ` \u2014 divergence: ${divergence}` : ""}`
      );
      if (divergence !== void 0 || !transientRetry) break;
      transientRetry = false;
      log("saveAndReplayRecording", `no divergence reported \u2014 retrying ${scriptPath} once`);
    }
  }
  await writeFile3(scriptPath, original, "utf8").catch(() => void 0);
  log("saveAndReplayRecording", `restored ${scriptPath}; stripping did not make it replayable`);
  return false;
}
async function runRepairedReplay(ctx, device, scriptPath, deadline) {
  const replay = await measurePhase(
    ctx,
    "replay",
    () => device.client.replay.run({
      path: scriptPath,
      platform: ctx.platform,
      udid: device.deviceId,
      keepSession: true,
      timeoutMs: Math.max(1e3, deadline - Date.now())
    })
  );
  if (!replay.sessionActive)
    throw new Error(`Repaired replay ${scriptPath} did not keep an active session`);
  await waitForAppReady(
    ctx,
    device,
    ctx.signal,
    Math.max(0, Math.min(APP_READY_TIMEOUT_MS, deadline - Date.now()))
  );
}
async function saveAndReplayRecording(ctx, device, scriptPath, destinationSelector, timeoutMs = 12e4, {
  repairArmed = false,
  verifyByReplay = true
} = {}) {
  const deadline = Date.now() + timeoutMs;
  await measurePhase(
    ctx,
    "device-wait",
    () => device.client.command.wait({
      platform: ctx.platform,
      selector: destinationSelector,
      timeoutMs: Math.max(1e3, Math.min(15e3, deadline - Date.now()))
    })
  );
  device.armedRecording = null;
  if (repairArmed) {
    await device.client.sessions.close({ saveScript: scriptPath, force: true });
  } else {
    await device.client.sessions.saveScript({ path: scriptPath, force: true });
  }
  if (!verifyByReplay) return;
  await verifyAndRepairReplay(ctx, device, scriptPath, destinationSelector, deadline);
}
async function verifyAndRepairReplay(ctx, device, scriptPath, destinationSelector, deadline, replayError) {
  await endLiveSession(device);
  const runReplay = async () => {
    const replayTimeoutMs = Math.max(1e3, deadline - Date.now());
    const replay = await measurePhase(
      ctx,
      "replay",
      () => device.client.replay.run({
        path: scriptPath,
        platform: ctx.platform,
        udid: device.deviceId,
        keepSession: true,
        saveScript: scriptPath,
        force: true,
        timeoutMs: replayTimeoutMs
      })
    );
    if (!replay.sessionActive)
      throw new Error(`Replay ${scriptPath} did not keep an active session`);
    await waitForAppReady(
      ctx,
      device,
      ctx.signal,
      Math.max(0, Math.min(APP_READY_TIMEOUT_MS, deadline - Date.now()))
    );
  };
  let error = replayError;
  if (error === void 0) {
    try {
      await runReplay();
      return;
    } catch (firstFailure) {
      error = firstFailure;
    }
  }
  if (await stripIdentityAndReplay(ctx, device, scriptPath, destinationSelector, error, deadline))
    return;
  if (!isMissingSessionError(error)) throw error;
  log(
    "saveAndReplayRecording",
    `no active session mid-replay, recovering \u2014 ${describeSessionLoss(errorMessage(error), agentDeviceErrorHint(error))}`
  );
  await reopenBoundApp(ctx, device);
  await runReplay();
}
function replayPathToReach(device, scriptPath) {
  return [...device.setupCommands, `agent-device replay ${quoteCliArg(scriptPath)} --keep-session`];
}
async function captureScreenshot(ctx, device, path) {
  log("screenshot", path);
  try {
    await measurePhase(
      ctx,
      "screenshot",
      () => retryWhileRunnerBusy(() => device.client.capture.screenshot({ path }), {
        signal: ctx.signal,
        onRetry: (attempt, waitMs) => log("screenshot", `runner busy; retry ${attempt} in ${Math.round(waitMs / 1e3)}s`)
      })
    );
    log("screenshot", "saved");
    return { relaunched: false };
  } catch (error) {
    if (!isMissingSessionError(error)) throw error;
    log(
      "screenshot",
      `no active session, recovering \u2014 while saving ${basename2(path)} \u2014 ${describeSessionLoss(errorMessage(error), agentDeviceErrorHint(error))}`
    );
    await reopenBoundApp(ctx, device);
    await measurePhase(ctx, "screenshot", () => device.client.capture.screenshot({ path }));
    return { relaunched: true };
  }
}
async function capturePressables(ctx, device, timeoutMs = 3e4, options) {
  const snapshot = await measurePhase(
    ctx,
    "device-read",
    () => retryWhileRunnerBusy(
      () => device.client.capture.snapshot({
        platform: ctx.platform,
        // The client defaults to the compact digest response level for routine App
        // Flow commands. Snapshot extraction needs the typed node payload instead.
        responseLevel: "default",
        interactiveOnly: true,
        // No `customActions`. It was requested on every read in this module and consumed by
        // none of them: the node loop below keeps `value`, `label`, `identifier` and `role`,
        // and nothing downstream of `AppFlowPressable` has ever had a field to put an
        // accessibility custom action in. On the iOS simulator the flag is not free — it
        // selects a capability the snapshot backend then has to be admitted for, and enumerates
        // the custom actions of every merged element — so this was per-element device work on
        // all 114 reads of the reference sweep in service of a field that was dropped on the
        // floor. How much of the measured 1.56s it was buying is exactly what the next sweep
        // will say; the case for removing it does not depend on the answer.
        forceFull: true,
        noRecord: true,
        timeoutMs
      }),
      {
        signal: ctx.signal,
        deadlineAt: options?.deadlineAt,
        retries: options?.retries,
        onRetry: (attempt, waitMs) => log("capturePressables", `runner busy; retry ${attempt} in ${Math.round(waitMs / 1e3)}s`)
      }
    )
  );
  if (!Array.isArray(snapshot.nodes)) {
    throw new Error("agent-device snapshot did not return a nodes array");
  }
  const seen = /* @__PURE__ */ new Set();
  const pressables = [];
  for (const nodeValue of snapshot.nodes) {
    if (!nodeValue || typeof nodeValue !== "object") continue;
    const node = nodeValue;
    if (node.visibleToUser === false || node.enabled === false) continue;
    const semanticType = `${node.role ?? node.type ?? ""}`.toLowerCase().replace(/^xcuielementtype/, "");
    if (["application", "window", "scrollview", "scroll-view"].includes(semanticType)) continue;
    const pressable = {
      ...node.value ? { text: node.value } : {},
      ...node.label ? { label: node.label } : {},
      ...node.identifier ? { identifier: node.identifier } : {},
      ...node.role || node.type ? { role: node.role ?? node.type } : {}
    };
    if (![pressable.text, pressable.label, pressable.identifier].some((value) => value?.trim())) {
      continue;
    }
    const identity = JSON.stringify(pressable);
    if (seen.has(identity)) continue;
    seen.add(identity);
    pressables.push(pressable);
  }
  device.lastRead = { at: Date.now(), pressables };
  return pressables;
}
function stopLaunchProcess(child) {
  if (!child?.pid) return;
  try {
    child.kill("SIGTERM");
  } catch {
  }
}
async function closeDevice(device) {
  log("closeDevice", "stop Metro if we started it, sessions.close --shutdown");
  stopLaunchProcess(device.launchProcess);
  await endMetroLogFile(device.metroLogPath);
  try {
    await device.client.sessions.close({ shutdown: true });
    log("sessions.close", "done");
  } catch (error) {
    console.error("Failed to close agent-device session:", error);
  }
}

// packages/core/src/app-flow-deps/profiling/agent-device-command.ts
function tokenizeAgentDeviceCommand(command) {
  const tokens = [];
  let current = "";
  let quoted = false;
  let quote = null;
  let escaped = false;
  const push = () => {
    if (current || quoted) tokens.push(current);
    current = "";
    quoted = false;
  };
  for (const char of command) {
    if (escaped) {
      current += char;
      quoted = true;
      escaped = false;
    } else if (quote) {
      if (char === quote) quote = null;
      else current += char;
    } else if (char === "\\") {
      escaped = true;
    } else if (char === "'" || char === '"') {
      quote = char;
      quoted = true;
    } else if (/\s/.test(char)) push();
    else current += char;
  }
  if (escaped) current += "\\";
  push();
  return tokens;
}

// packages/core/src/app-flow/manual/path-commands.ts
var SCROLL_DIRECTIONS = /* @__PURE__ */ new Set(["up", "down", "left", "right"]);
function positionals(tokens, from) {
  const values = [];
  for (let i = from; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token.startsWith("--")) {
      values.push(token);
      continue;
    }
    if (!token.includes("=") && tokens[i + 1] && !tokens[i + 1].startsWith("--")) i++;
  }
  return values;
}
function parsePathStep(command) {
  const tokens = tokenizeAgentDeviceCommand(command.trim());
  if (tokens[0] !== "agent-device") return null;
  const verb = tokens[1];
  const args = positionals(tokens, 2);
  if (verb === "boot" || verb === "install") return { kind: "skip" };
  if (verb === "replay") {
    const path = args[0] === "run" ? args[1] : args[0];
    return path ? { kind: "replay", path } : null;
  }
  if (verb === "open") {
    return args[0] ? { kind: "open", app: args[0], url: args[1] ?? null } : null;
  }
  if (verb === "press") {
    if (args.length >= 2 && args.every((arg) => /^-?\d+(\.\d+)?$/.test(arg))) {
      return { kind: "pressPoint", x: Number(args[0]), y: Number(args[1]) };
    }
    return args[0] ? { kind: "press", selector: args[0] } : null;
  }
  if (verb === "fill") {
    return args.length >= 2 && args[0] ? { kind: "fill", selector: args[0], value: args[1] } : null;
  }
  if (verb === "scroll") {
    return args[0] && SCROLL_DIRECTIONS.has(args[0]) ? { kind: "scroll", direction: args[0] } : null;
  }
  return null;
}

// packages/core/src/app-flow/path-minimize.ts
function selectorParts(selector) {
  const match = /^(id|label|text)=(?:"([\s\S]*)"|([\s\S]*))$/.exec(selector.trim());
  if (!match) return null;
  const raw = match[2] ?? match[3] ?? "";
  return { by: match[1], value: raw.replace(/\\(["\\])/g, "$1") };
}
var DISMISS_VALUES = /* @__PURE__ */ new Set([
  "dismiss",
  "dismiss popup",
  "dismiss popover",
  "popoverdismissregion",
  "close",
  "close popup",
  "close menu",
  "cancel"
]);
function isDismissSelector(selector) {
  const parts = selectorParts(selector);
  if (!parts) return false;
  return DISMISS_VALUES.has(parts.value.trim().toLowerCase());
}
function minimizeWalkCommands(commands) {
  const kept = [];
  const removed = [];
  for (const command of commands) {
    const step = parsePathStep(command);
    const isPress = step?.kind === "press";
    if (isPress && isDismissSelector(step.selector)) {
      const previous = kept[kept.length - 1];
      if (previous?.press) {
        kept.pop();
        removed.push(
          { command: previous.command, rule: "cancelled-overlay" },
          { command, rule: "cancelled-overlay" }
        );
        continue;
      }
    }
    kept.push({ command, press: isPress });
  }
  return { commands: kept.map((entry) => entry.command), removed };
}
function contentMatchedSelectors(commands) {
  const found = [];
  for (const command of commands) {
    const step = parsePathStep(command);
    if (step?.kind !== "press" && step?.kind !== "fill") continue;
    const parts = selectorParts(step.selector);
    if (!parts || parts.by === "id") continue;
    if (!found.includes(step.selector)) found.push(step.selector);
  }
  return found;
}

// packages/core/src/app-flow/path-provenance.ts
function pathSource(input) {
  if (input.pathCommands?.length) return "walk";
  if (input.replayScript) return "replay-script";
  if (input.deepLinkOpened) return "deep-link";
  return "chrome-inferred";
}
function isPathVerified(input) {
  switch (pathSource(input)) {
    case "walk":
      return true;
    case "replay-script":
      return input.replayVerified ?? false;
    case "deep-link":
      return true;
    case "chrome-inferred":
      return false;
  }
}

// packages/core/src/app-flow/path-run.ts
import { readFileSync } from "node:fs";
var REPLAY_TIMEOUT_MS = 12e4;
function log2(step, detail) {
  console.log(detail ? `[app-flow:replay] ${step} \u2014 ${detail}` : `[app-flow:replay] ${step}`);
}
async function runPathToReach(ctx, device, pathToReach) {
  log2("run", `${pathToReach.length} commands`);
  await waitForReplayableFrame(ctx, device);
  for (const command of pathToReach) {
    if (ctx.signal?.aborted) throw new Error("Cancelled");
    const step = parsePathStep(command);
    if (!step) throw new Error(`This screen's path contains a command I cannot run: ${command}`);
    if (step.kind === "skip") {
      log2("skip setup", command);
      continue;
    }
    log2("step", command);
    try {
      await execute(ctx, device, step);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`${command} failed: ${detail}`);
    }
  }
  await waitForRoute();
}
async function waitForReplayableFrame(ctx, device) {
  await waitForAppReady(ctx, device, ctx.signal, void 0, {
    minInteractiveElements: PROBE_FRAME_ELEMENT_FLOOR,
    minInteractiveElementsGraceMs: SUBSTANTIVE_FRAME_GRACE_MS
  });
}
async function execute(ctx, device, step) {
  const platform = ctx.platform;
  switch (step.kind) {
    case "replay": {
      const guard = destinationGuardSelector(readFileSync(step.path, "utf8").split("\n"));
      if (guard === void 0) {
        const result = await device.client.replay.run({
          path: step.path,
          platform,
          udid: device.deviceId,
          keepSession: true,
          timeoutMs: REPLAY_TIMEOUT_MS
        });
        if (!result.sessionActive)
          throw new Error(`Replay did not leave an active session: ${step.path}`);
      } else {
        await verifyAndRepairReplay(ctx, device, step.path, guard, Date.now() + REPLAY_TIMEOUT_MS);
      }
      await waitForReplayableFrame(ctx, device);
      return;
    }
    case "open": {
      await openPathToReachApp(device, step.app, step.url);
      await waitForReplayableFrame(ctx, device);
      return;
    }
    case "press":
      await device.client.interactions.press({
        platform,
        selector: step.selector,
        settle: true,
        timeoutMs: 1e4
      });
      return;
    case "pressPoint":
      await device.client.interactions.press({
        platform,
        x: step.x,
        y: step.y,
        settle: true,
        timeoutMs: 1e4
      });
      return;
    case "fill":
      await device.client.interactions.fill({
        platform,
        selector: step.selector,
        text: step.value,
        settle: true,
        timeoutMs: 1e4
      });
      return;
    case "scroll":
      await device.client.interactions.scroll({ platform, direction: step.direction });
      return;
  }
}

// packages/core/src/app-flow/reach/arrival.ts
function parseArrivalVerdict(value) {
  if (!value || typeof value !== "object") return null;
  const parsed = value;
  if (["match", "mismatch", "uncertain"].includes(String(parsed.verdict)) && (parsed.status === null || parsed.status === "ok" || parsed.status === "empty-state" || parsed.status === "not-found") && typeof parsed.reason === "string" && (parsed.key === void 0 || typeof parsed.key === "string") && (parsed.info === void 0 || typeof parsed.info === "string")) {
    return parsed;
  }
  return null;
}

// packages/core/src/app-flow/reach/prompts.ts
var NAVIGATION_SYSTEM_PROMPT = `You explore a mobile app one observation at a time to reach an exact target screen.
Return STRICT JSON only:
{
  "decision": "act",
  "action": {"type":"tap"|"swipe"|"input"|"wait","locator":{"by":"text"|"label"|"id","value":"Settings"},"value":"optional","direction":"up"|"down"|"left"|"right","duration":1000},
  "reason": "short reason"
}
Return {"decision":"arrived","reason":"target-specific visible evidence","destinationLocator":{"by":"label"|"id","value":"Followers"}} only when the current UI is the exact target, not merely a normal home screen or shared app chrome.
destinationLocator names one durable landmark that identifies this screen and nothing else \u2014 a heading, a nav-bar title, a selected tab \u2014 so the journey you just walked can be saved and replayed later. It must be by "label" or by "id": "text" is not accepted here, because a landmark is only usable if the element carries an accessibility label or an identifier, and matching on rendered text does not guarantee either. Pick something that is part of the screen itself, not a list item that exists only because of today's data.
Return {"decision":"blocked","reason":"why no safe progress is possible"} when no safe action is available.
For act, return exactly one action. Use durable text, label, or id locators. Do not submit, delete, purchase, log out, or enter credentials.
When a control in the visible list shows an "identifier", select it with by:"id" and that identifier. Identifiers are testIDs the app sets deliberately and they survive re-renders, relayout and copy changes; captions and accessibility labels do not, and by:"text" in particular is matched against the element's value rather than its caption, so it fails outright on controls whose caption lives in the label. Fall back to label, then text, only for controls that show no identifier.
A journey hop written as 'tap label="X"' names the exact control the source code opens that screen with: use that locator verbatim. Walk the given path in order; it is the intended journey. When a tap fails or is ambiguous, retry the SAME step with a different locator for the same control \u2014 unique visible text instead of a duplicated id \u2014 rather than abandoning the path for another branch.
Before taking the first hop of a given path, check the entry chrome for a tab, drawer, or menu item whose name matches the target itself. That item goes straight there and beats any path, because a path is only the shortest route the source happened to spell out, not the shortest route the app offers.
Every action you take is recorded as a step in a script that is replayed later against whatever data the app holds then. So a hop must never go through today's content: a post, a feed row, a search result, a message, an avatar or a name belonging to one of them is gone or reordered on the next run, and the replay dies on that step even though your walk succeeded. Reach a content-backed screen through the app's own chrome \u2014 the tab, drawer or header control that owns it \u2014 and treat a list item as a last resort you note in your reason. This is the same rule line 'destinationLocator' already follows, applied to the way you get there.
A hop written as 'control unknown' is one the route graph could not resolve: the source navigates to the next screen from there, but nothing says which control does it, and it is often a link on content that only exists once the app has data. Never manufacture that content \u2014 do not type, search, filter, sort, or post to make a hop's control appear. If an unknown hop's control is not already visible, abandon the path and use the entry chrome instead.
When no path is given, the route graph does not know this journey. Start from the app's entry chrome, open the entry the target's layout names, and look for the target there. Do not guess a journey through unrelated screens, and never type into a search field hoping the target appears in results.
The action history is your only memory of the journey so far. Never repeat an action that already failed the same way, and never restart from an unrelated screen while you are part-way along the path.
A named entry control that is absent is evidence, not an obstacle: when you are on the screen an incoming edge names and that control is not in the visible controls, the build does not offer this screen. Return blocked saying which control was missing on which screen. Do not go looking for another way in.`;
var ARRIVAL_SYSTEM_PROMPT = `Verify whether the mobile screenshot is the exact requested destination.
Return STRICT JSON only:
{"verdict":"match"|"mismatch"|"uncertain","status":"ok"|"empty-state"|"not-found"|null,"reason":"short target-specific evidence","key":"Title-Case-Key","info":"short screen description"}
A normal home or landing screen is a mismatch unless it is the requested target. Shared chrome, tabs, or a route command succeeding are not proof. Use visible content specific to the requested destination. Use uncertain only when the screenshot lacks enough evidence.
Set status "not-found" when the frame is the app's own unmatched-route screen \u2014 a "page not found" or 404 message with a go-back or go-home button and no content of its own. That is a property of the frame, so report it whatever the verdict is; an empty list or a failed fetch inside the real screen is "empty-state", not "not-found".`;
var RUNTIME_SCREEN_SYSTEM_PROMPT = `You look at a live mobile app screenshot taken mid-exploration, while the agent was walking toward a different target screen.
Decide whether this frame shows a genuinely distinct, load-bearing screen of the app \u2014 as opposed to a modal, toast, permission prompt, loading state, or other shared chrome layered over a screen already accounted for.
Return STRICT JSON only:
{"distinct": boolean, "key": "Title-Case-Key" | null, "info": "short screen description" | null}
Set "distinct" to true only for a real screen someone would recognise as its own place in the app, never a transient overlay or a partially loaded frame. "key" is a short, stable, human name for this screen (e.g. "SavedPosts") that must stay the same across repeat visits \u2014 it is used as this screen's identity. Omit key and info (null) whenever distinct is false.`;

// packages/core/src/app-flow/reach/adapters.ts
var SETTLE_DEADLINES_MS = [8e3];
var IDLE_AFTER_MS = 1500;
var IDLE_STABLE_POLLS = 3;
var POLL_INTERVAL_MS = 40;
function delay(ms) {
  return new Promise((resolve3) => setTimeout(resolve3, ms));
}
function createRenderPort(transport, nodeRouteName, expoRouter, deadlinesMs, measurePoll, metrics) {
  const firstDeadline = deadlinesMs[0] ?? 8e3;
  const lastDeadline = deadlinesMs[deadlinesMs.length - 1] ?? firstDeadline;
  return {
    async available() {
      return await transport.ready();
    },
    async navigate(node, params) {
      const segments = nodeRouteName(node);
      if (!segments.length) return { ok: false, reason: "No navigator route name for this node." };
      const outcome = await transport.navigate(
        segments,
        params,
        expoRouter ? node.urlPath : null,
        navigatorCandidates(node, segments)
      );
      if (outcome.ok) {
        const resolved = outcome.path?.length ? outcome.path : segments;
        const description = outcome.action === "expo-replace" ? `Replaced Expo pathname ${node.urlPath}.` : outcome.action === "replace" ? `Replaced focused stack leaf with ${resolved[resolved.length - 1]}.` : outcome.action === "noop" ? `${resolved.join(" > ")} was already focused.` : `Dispatched ${resolved.join(" > ")}.`;
        metrics?.navigate(outcome.via ?? "exact");
        return {
          ok: true,
          reason: description,
          action: outcome.action,
          ...outcome.path?.length ? { path: outcome.path } : {}
        };
      }
      metrics?.navigate("refused");
      let why;
      if (outcome.reason === "unregistered") {
        const searched = outcome.detail ? ` (${outcome.detail})` : "";
        why = `Route ${segments.join(" > ")} is not registered in the running navigator${searched}.`;
      } else if (outcome.reason === "no-navigator") {
        why = "No mounted navigator found.";
      } else if (outcome.reason === "no-dispatch") {
        why = "The mounted navigator cannot be dispatched to.";
      } else if (outcome.reason === "no-expo-router") {
        why = "Expo Router is not exposed by the running development runtime.";
      } else if (outcome.reason === "invalid-route") {
        why = "The route has no runtime navigator path.";
      } else {
        why = `Navigation dispatch threw: ${outcome.detail ?? "no detail"}`;
      }
      return { ok: false, reason: why, refusal: outcome.reason };
    },
    async awaitSettled(node, params, budget) {
      const segments = nodeRouteName(node);
      const target2 = segments[segments.length - 1] ?? node.id;
      const remainingMs = Math.max(0, budget.remainingMs);
      const budgetCapped = budget.remainingMs < lastDeadline;
      const startedAt = Date.now();
      let sawLoading = false;
      let polls = 0;
      let last = "never sampled";
      let lastSnapshot = null;
      let stableSignature = null;
      let stablePolls = 0;
      const finish = (result) => {
        metrics?.settle(Date.now() - startedAt, result.stop ?? "unknown");
        return {
          ...result,
          active: lastSnapshot?.active ?? [],
          found: lastSnapshot?.found ?? false,
          content: lastSnapshot?.content ?? 0,
          paramMismatch: lastSnapshot?.paramMismatch ?? [],
          signature: lastSnapshot?.signature ?? ""
        };
      };
      while (Date.now() - startedAt < Math.min(sawLoading ? lastDeadline : firstDeadline, remainingMs)) {
        polls += 1;
        const snapshot = await measurePoll(() => transport.readiness(target2, params));
        if (!snapshot) {
          return finish({
            settled: false,
            reason: "Runtime stopped answering readiness polls.",
            polls,
            stop: "no-answer"
          });
        }
        lastSnapshot = snapshot;
        if (snapshot.loading) sawLoading = true;
        last = snapshot.found ? `loading=${snapshot.loading ?? "no"} content=${snapshot.content}` : snapshot.paramMismatch.length ? `on ${target2} with different ${snapshot.paramMismatch.join(", ")}` : `target screen not focused (on ${snapshot.active.join("/") || "unknown"})`;
        if (!snapshot.found || snapshot.loading || !snapshot.content) {
          stableSignature = null;
          stablePolls = 0;
          await delay(POLL_INTERVAL_MS);
          continue;
        }
        if (snapshot.settled) {
          return finish({
            settled: true,
            reason: `Settled with ${snapshot.content} content nodes (${snapshot.confident ? "full signals" : `missing ${snapshot.missing.join(", ")}`}).`,
            polls,
            stop: "settled"
          });
        }
        if (snapshot.signature && snapshot.signature === stableSignature) stablePolls += 1;
        else {
          stableSignature = snapshot.signature;
          stablePolls = 1;
        }
        if (Date.now() - startedAt >= IDLE_AFTER_MS && stablePolls >= IDLE_STABLE_POLLS) {
          return finish({
            settled: true,
            reason: `Stable but never quiet \u2014 ${snapshot.content} content nodes unchanged across ${stablePolls} polls.`,
            polls,
            stop: "stable-not-quiet"
          });
        }
        await delay(POLL_INTERVAL_MS);
      }
      return finish({
        settled: false,
        reason: `Did not settle in time \u2014 ${last}.`,
        polls,
        stop: budgetCapped ? "budget" : "timeout"
      });
    }
  };
}
function createDevicePort(ctx, device, signal) {
  return {
    async replayRun(options) {
      await endLiveSession(device);
      const result = await measurePhase(
        ctx,
        "replay",
        () => device.client.replay.run({
          path: options.path,
          platform: ctx.platform,
          udid: device.deviceId,
          keepSession: true,
          timeoutMs: options.timeoutMs
        })
      );
      return { sessionActive: result.sessionActive };
    },
    openDeepLink(node, params) {
      return openDeepLink(ctx, device, node, params);
    },
    // Deep-link arrival is judged off the frame taken right after this returns, so it waits for the
    // app to actually settle rather than sleeping a flat 2.5s — see `settleAfterRoute`.
    async waitForRoute(options) {
      const settled = await settleAfterRoute(ctx, device, signal, options?.timeoutMs, {
        minInteractiveElements: options?.minInteractiveElements
      });
      return { settled, pressables: device.lastRead?.pressables ?? null };
    },
    captureScreenshot(path) {
      return captureScreenshot(ctx, device, path);
    },
    capturePressables(timeoutMs) {
      return capturePressables(ctx, device, timeoutMs);
    },
    executeNavigationActions(actions, timeoutMs) {
      return executeNavigationActions(ctx, device, actions, timeoutMs);
    },
    // `openPathToReachApp` rather than `goHome`: it is the same `apps.open` without the armed-
    // recording suppression `goHome` carries for a sweep that no longer arms anything, and it is
    // literally the call `path-run.ts` makes for an `open` line — so the live reset and the stored
    // baseline line are the same operation rather than two that have to be kept in step.
    //
    // The floored wait is the one `startReplayRecording` already paid for its first screenshot:
    // a stable frame and a loaded app are different things, and a dev client's splash is stable.
    // Graced rather than held to `timeoutMs` because a walk may legitimately begin on a sparse
    // screen. What is deliberately *not* here is the launcher-recovery deferral: that existed only
    // so the recovery's own `apps.open` could not abort an armed recording, and there is no
    // recording left to protect.
    async resetToLaunch(url, timeoutMs) {
      await openPathToReachApp(device, device.launchTarget, url ?? device.launchUrl);
      await waitForAppReady(ctx, device, signal, timeoutMs, {
        minInteractiveElements: PROBE_FRAME_ELEMENT_FLOOR,
        minInteractiveElementsGraceMs: SUBSTANTIVE_FRAME_GRACE_MS
      });
    },
    runPathCommands(commands) {
      return runPathToReach(ctx, device, commands);
    }
  };
}
function createRecorderPort(device, ctx) {
  return {
    saveAndReplayRecording(scriptPath, destinationSelector, timeoutMs, options) {
      return saveAndReplayRecording(
        ctx,
        device,
        scriptPath,
        destinationSelector,
        timeoutMs,
        options
      );
    },
    verifyAndRepairReplay(scriptPath, destinationSelector, timeoutMs, error) {
      return verifyAndRepairReplay(
        ctx,
        device,
        scriptPath,
        destinationSelector,
        Date.now() + timeoutMs,
        error
      );
    }
  };
}
function createJudgePort(runAgent, projectPath) {
  return {
    async verifyArrival(node, screenshotPath, budget) {
      let result = null;
      for (let attempt = 0; attempt < 2 && !budget.expired; attempt++) {
        const response = await runAgent(
          {
            cwd: projectPath,
            systemPrompt: ARRIVAL_SYSTEM_PROMPT,
            userPrompt: `Target screen: ${node.id} (${node.title})
URL path: ${node.urlPath ?? "none"}
Source: ${node.file ?? "unknown"}
Decide whether the current screenshot is this exact destination.`,
            // No tools: this is a yes/no judgement about one screenshot, and a judge that can read
            // the repo can talk itself into a verdict the frame does not support — the whole value
            // of this call is that it sees only what the device showed.
            tools: [],
            // `low`, not `off` like the other judges, and this is a deliberate walk-back of an
            // earlier change rather than an oversight.
            //
            // `off` looked right on the arithmetic: 22 calls, 29% of a sweep, 60-80% of each
            // reply's output spent on reasoning to answer "is this frame the screen I named?". It
            // measured well in isolation too — output per call fell from ~200 tokens to ~70. What
            // it missed is that this verdict is a *gate*. A wrong mismatch does not cost the
            // judge's own tokens, it costs another lap of the exploration loop: another planner
            // call, another observation, another judge call. On device, `SearchTab/Search` — an
            // intrinsically ambiguous screen, which the reasoning judge had previously spent 866
            // reasoning tokens getting right in one call — took three attempts at `off`, two of
            // them wrong, and the two extra laps cost roughly 12k tokens to save about 800.
            //
            // So this role buys deliberation for the same reason the navigator does: it is not the
            // size of the answer that matters, it is what an incorrect one sets in motion. The
            // binary, low-stakes judges (`auth-gate`, `runtime-screen`) stay at `off`, where a
            // thin answer costs nothing beyond itself.
            thinkingLevel: "low",
            imagePath: screenshotPath,
            timeoutMs: Math.max(1e3, Math.min(12e4, budget.remainingMs))
          },
          `arrival ${node.id}`
        );
        const parsedResult = parseArrivalVerdict(parseSubAgentJson(response.text));
        if (parsedResult) result = parsedResult;
        if (result && result.verdict !== "uncertain") break;
      }
      return result ?? {
        verdict: "uncertain",
        status: null,
        reason: "Arrival verifier returned invalid JSON."
      };
    }
  };
}
function createAuthPort(checkAuthGate) {
  return { checkGate: checkAuthGate };
}
function createReachPorts(options) {
  const { ctx, device, runAgent, projectPath, checkAuthGate, signal, renderTransport } = options;
  return {
    device: createDevicePort(ctx, device, signal),
    recorder: createRecorderPort(device, ctx),
    judge: createJudgePort(runAgent, projectPath),
    auth: createAuthPort(checkAuthGate),
    // Both are pure sinks the orchestrator owns (a JSONL file and the Sentry helper), passed
    // straight through: nothing under `reach/` may open either for itself.
    ...options.sweepLog ? { sweepLog: options.sweepLog } : {},
    ...options.metrics ? { metrics: options.metrics } : {},
    // Omitted rather than stubbed when there is no transport, so `renderStrategy` skips on the
    // port's absence instead of on a port that always answers no.
    ...renderTransport ? {
      render: createRenderPortForTransport({
        transport: renderTransport,
        expoRouter: options.expoRouter === true,
        ...options.settleDeadlinesMs ? { settleDeadlinesMs: options.settleDeadlinesMs } : {},
        metrics: options.metrics ?? null,
        // `ctx` is always present in the sweep; guarded so the port stays constructible from a
        // test that supplies only a transport.
        measurePoll: (work) => ctx ? measurePhase(ctx, "settle-poll", work) : work()
      })
    } : {}
  };
}
function createRenderPortForTransport(options) {
  return createRenderPort(
    options.transport,
    navigatorSegments,
    options.expoRouter === true,
    options.settleDeadlinesMs?.length ? options.settleDeadlinesMs : SETTLE_DEADLINES_MS,
    options.measurePoll ?? ((work) => work()),
    options.metrics ?? null
  );
}
function navigatorSegments(node) {
  return node.id.split("/").filter(Boolean);
}
function navigatorCandidates(node, segments) {
  const out = [];
  const seen = new Set(segments);
  for (const name2 of [...node.groups ?? [], node.group, node.navigator]) {
    if (!name2 || typeof name2 !== "string" || seen.has(name2)) continue;
    seen.add(name2);
    out.push(name2);
  }
  return out;
}

// packages/core/src/app-flow/cdp/connection.ts
import { randomUUID as randomUUID2 } from "node:crypto";

// packages/core/src/app-flow/cdp/agent-runtime.ts
var WALK_BUDGET = 6e4;
var WALK_DEADLINE_MS = 1e3;
var INNER_WALK_BUDGET = 4e4;
var AGENT_LEASE_MS = 1e4;
var QUIET_MS = 500;
var IDLE_MS = 500;
var PAINT_TIMEOUT_MS = 500;
var DEFAULT_AGENT_LIMITS = {
  walkBudget: WALK_BUDGET,
  walkDeadlineMs: WALK_DEADLINE_MS,
  innerWalkBudget: INNER_WALK_BUDGET,
  quietMs: QUIET_MS,
  idleMs: IDLE_MS,
  paintTimeoutMs: PAINT_TIMEOUT_MS
};
function agentCollectFiberRoots() {
  var hook = globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  if (!hook || typeof hook.getFiberRoots !== "function") return [];
  var rendererIds = [];
  try {
    if (hook.renderers && typeof hook.renderers.forEach === "function") {
      hook.renderers.forEach(function(renderer, id2) {
        if (!renderer || renderer.rendererPackageName === "react-native-renderer") {
          rendererIds.push(id2);
        }
      });
    }
  } catch (error) {
    rendererIds = [];
  }
  if (!rendererIds.length) rendererIds.push(1);
  var stack = [];
  for (var r = 0; r < rendererIds.length; r++) {
    var roots = null;
    try {
      roots = hook.getFiberRoots(rendererIds[r]);
    } catch (error) {
      roots = null;
    }
    if (!roots || typeof roots.forEach !== "function") continue;
    roots.forEach(function(root) {
      if (root && root.current) stack.push(root.current);
    });
  }
  return stack;
}
function agentFindNavigator(limits) {
  var stack = agentCollectFiberRoots();
  if (!stack.length) return null;
  var deadline = Date.now() + limits.walkDeadlineMs;
  var budget = limits.walkBudget;
  var seen = /* @__PURE__ */ new Set();
  var climb = function(value) {
    if (!value || typeof value !== "object") return null;
    if (typeof value.getState !== "function" || typeof value.getParent !== "function") return null;
    try {
      var nav = value;
      var climbed = /* @__PURE__ */ new Set();
      while (typeof nav.getParent === "function" && !climbed.has(nav)) {
        climbed.add(nav);
        var parent = nav.getParent();
        if (!parent) break;
        nav = parent;
      }
      var state = typeof nav.getRootState === "function" ? nav.getRootState() : nav.getState();
      return state && state.routes ? { nav, state } : null;
    } catch (error) {
      return null;
    }
  };
  var found = null;
  while (stack.length && budget-- > 0 && !found) {
    if ((budget & 255) === 0 && Date.now() > deadline) return null;
    var fiber = stack.pop();
    if (!fiber || seen.has(fiber)) continue;
    seen.add(fiber);
    var memo = fiber.memoizedState;
    var props = fiber.memoizedProps;
    var carriers = [
      fiber.stateNode,
      props && props.value,
      props && props.navigationRef,
      memo && memo.memoizedState && memo.memoizedState.current
    ];
    for (var at = 0; at < carriers.length && !found; at++) {
      var carrier = carriers[at];
      if (carrier && typeof carrier.getRootState === "function") {
        try {
          var direct = carrier.getRootState();
          if (direct && direct.routes) found = { nav: carrier, state: direct };
        } catch (error) {
          found = null;
        }
      }
    }
    if (!found) found = climb(props && props.navigation);
    if (!found) found = climb(props && props.value);
    if (!found) found = climb(fiber.stateNode);
    if (fiber.child) stack.push(fiber.child);
    if (fiber.sibling) stack.push(fiber.sibling);
  }
  return found;
}
function agentFlattenRoutes(state) {
  var flat = [];
  var walk3 = function(node, depth) {
    if (!node || depth > 12 || !Array.isArray(node.routes)) return;
    for (var i = 0; i < node.routes.length; i++) {
      var route = node.routes[i];
      if (!route || typeof route.name !== "string") continue;
      var entry = { name: route.name };
      if (typeof route.path === "string" && route.path) entry.path = route.path;
      var raw = route.params;
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        var kept = {};
        var any = false;
        for (var key2 in raw) {
          var value = raw[key2];
          if (typeof value === "string") {
            kept[key2] = value;
            any = true;
          } else if (typeof value === "number" && isFinite(value)) {
            kept[key2] = String(value);
            any = true;
          }
        }
        if (any) entry.params = kept;
      }
      flat.push(entry);
      if (route.state) walk3(route.state, depth + 1);
    }
  };
  walk3(state, 0);
  return flat;
}
function agentNavState(limits) {
  var found = agentFindNavigator(limits);
  if (!found || !found.state) return { routes: null };
  return { routes: agentFlattenRoutes(found.state) };
}
var LINK_CANDIDATE_CAP = 200;
function agentRoutablePath(value) {
  if (typeof value !== "string") return null;
  if (!value || value.length > 500) return null;
  if (value.charAt(0) === "/") return value;
  if (/^[a-zA-Z][\w+.-]*:\/\//.test(value)) return value;
  return null;
}
function agentLinkCandidate(href) {
  var candidate = {};
  var asPath = agentRoutablePath(href);
  if (asPath) {
    candidate.path = asPath;
    return candidate;
  }
  if (!href || typeof href !== "object" || Array.isArray(href)) return null;
  if (typeof href.screen === "string" && href.screen) candidate.name = href.screen;
  var fromPathname = agentRoutablePath(href.pathname);
  if (fromPathname) candidate.path = fromPathname;
  var raw = href.params;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    var kept = {};
    var any = false;
    for (var key2 in raw) {
      var value = raw[key2];
      if (typeof value === "string") {
        kept[key2] = value;
        any = true;
      } else if (typeof value === "number" && isFinite(value)) {
        kept[key2] = String(value);
        any = true;
      }
    }
    if (any) candidate.params = kept;
  }
  if (candidate.path) return candidate;
  if (candidate.name && candidate.params) return candidate;
  return null;
}
function agentCollectLinks(limits, max) {
  var stack = agentCollectFiberRoots();
  var links = [];
  var keys = /* @__PURE__ */ new Set();
  var seen = /* @__PURE__ */ new Set();
  var scanned = 0;
  var capped = false;
  var deadline = Date.now() + limits.walkDeadlineMs;
  var budget = limits.walkBudget;
  while (stack.length) {
    if (budget-- <= 0) {
      capped = true;
      break;
    }
    if ((budget & 255) === 0 && Date.now() > deadline) {
      capped = true;
      break;
    }
    var fiber = stack.pop();
    if (!fiber || seen.has(fiber)) continue;
    seen.add(fiber);
    scanned += 1;
    if (fiber.child) stack.push(fiber.child);
    if (fiber.sibling) stack.push(fiber.sibling);
    var props = fiber.memoizedProps;
    if (!props || typeof props !== "object") continue;
    var href = props.href;
    if (href === void 0 || href === null) href = props.to;
    if (href === void 0 || href === null) continue;
    var candidate = agentLinkCandidate(href);
    if (!candidate) continue;
    var key2;
    try {
      key2 = JSON.stringify([candidate.name, candidate.path, candidate.params]);
    } catch (error) {
      continue;
    }
    if (keys.has(key2)) continue;
    if (links.length >= max) {
      capped = true;
      break;
    }
    keys.add(key2);
    links.push(candidate);
  }
  return { links, scanned, capped };
}
function agentResolveRoutePath(state, route) {
  var head2 = String(route[0]);
  if (state && Array.isArray(state.routeNames) && state.routeNames.indexOf(head2) >= 0) {
    return { path: route.slice(), via: "exact", searched: 0 };
  }
  var focused = [];
  var cursor = state;
  for (var level = 0; cursor && Array.isArray(cursor.routes) && cursor.routes.length && level < 16; level++) {
    var active = cursor.routes[cursor.index == null ? 0 : cursor.index];
    if (!active || typeof active.name !== "string") break;
    focused.push(active.name);
    cursor = active.state;
  }
  var matches = [];
  var pending = [{ state, depth: 0, chain: [] }];
  var searched = 0;
  while (pending.length && searched < 500) {
    var item = pending.shift();
    var node = item && item.state;
    if (!node || item.depth >= 16) continue;
    searched++;
    if (item.chain.length && Array.isArray(node.routeNames) && node.routeNames.indexOf(head2) >= 0) {
      matches.push(item.chain.concat(route));
    }
    if (!Array.isArray(node.routes)) continue;
    for (var index = 0; index < node.routes.length; index++) {
      var child = node.routes[index];
      if (!child || !child.state || typeof child.name !== "string") continue;
      pending.push({
        state: child.state,
        depth: item.depth + 1,
        chain: item.chain.concat([child.name])
      });
    }
  }
  if (!matches.length) return { path: route.slice(), via: "none", searched };
  var best = matches[0];
  var bestScore = -1;
  for (var candidate = 0; candidate < matches.length; candidate++) {
    var shared = 0;
    while (shared < matches[candidate].length && shared < focused.length && matches[candidate][shared] === focused[shared]) shared++;
    if (shared > bestScore) {
      bestScore = shared;
      best = matches[candidate];
    }
  }
  return { path: best, via: "nested", searched };
}
function agentNavigate(route, params, limits, expoPath, candidates) {
  if (!Array.isArray(route) || !route.length) return { ok: false, reason: "invalid-route" };
  if (expoPath) {
    var modules = globalThis.__r && globalThis.__r.getModules ? globalThis.__r.getModules() : null;
    if (modules && typeof modules.values === "function") {
      var values = modules.values();
      var next = values.next();
      while (!next.done) {
        var module = next.value;
        if (module && module.isInitialized) {
          var exports = module.publicModule && module.publicModule.exports;
          var descriptor = exports && Object.getOwnPropertyDescriptor(exports, "router");
          var router = descriptor && "value" in descriptor ? descriptor.value : null;
          if (router && typeof router.push === "function" && typeof router.replace === "function" && typeof router.canGoBack === "function") {
            try {
              router.replace({ pathname: expoPath, params: params || {} });
              return { ok: true, action: "expo-replace" };
            } catch (error) {
              return {
                ok: false,
                reason: "threw",
                detail: String(error && error.message).slice(0, 80)
              };
            }
          }
        }
        next = values.next();
      }
    }
    return { ok: false, reason: "no-expo-router" };
  }
  var found = agentFindNavigator(limits);
  if (!found) return { ok: false, reason: "no-navigator" };
  var nav = found.nav;
  if (!nav || typeof nav.dispatch !== "function") return { ok: false, reason: "no-dispatch" };
  var current = found.state;
  var resolved = agentResolveRoutePath(current, route);
  if (resolved.via === "none" && Array.isArray(candidates) && Array.isArray(current.routeNames)) {
    for (var guess = 0; guess < candidates.length; guess++) {
      var ancestor = String(candidates[guess]);
      if (!ancestor || current.routeNames.indexOf(ancestor) < 0) continue;
      resolved = {
        path: [ancestor].concat(route),
        via: "nested",
        searched: resolved.searched
      };
      break;
    }
  }
  if (resolved.via === "none") {
    return {
      ok: false,
      reason: "unregistered",
      detail: "searched " + resolved.searched + " mounted navigator(s)"
    };
  }
  var path = resolved.path;
  var via = resolved.via;
  var leaf = current;
  for (var depth = 0; depth < path.length - 1; depth++) {
    var step = leaf && leaf.routes && leaf.routes[leaf.index == null ? 0 : leaf.index];
    if (!step || step.name !== path[depth]) {
      leaf = null;
      break;
    }
    leaf = step.state;
  }
  var expected = String(path[path.length - 1]);
  var selected = leaf && leaf.routes && leaf.routes[leaf.index == null ? 0 : leaf.index];
  var same = function(before, after, depth2, budget) {
    if (Object.is(before, after)) return true;
    if (!before || !after || typeof before !== "object" || typeof after !== "object" || depth2 > 6 || --budget.left < 0) return false;
    var array = Array.isArray(before);
    if (array !== Array.isArray(after) || !array && (Object.getPrototypeOf(before) !== Object.prototype || Object.getPrototypeOf(after) !== Object.prototype)) return false;
    var a = Object.getOwnPropertyDescriptors(before);
    var b = Object.getOwnPropertyDescriptors(after);
    var keys = Object.keys(a);
    if (keys.length > 200 || keys.length !== Object.keys(b).length) return false;
    for (var keyIndex = 0; keyIndex < keys.length; keyIndex++) {
      var key2 = keys[keyIndex];
      if (!a[key2] || !b[key2] || !("value" in a[key2]) || !("value" in b[key2]) || !same(a[key2].value, b[key2].value, depth2 + 1, budget)) return false;
    }
    return true;
  };
  var nested = params && Object.keys(params).length ? params : void 0;
  for (var offset = path.length - 1; offset > 0; offset--) {
    nested = { screen: String(path[offset]), params: nested, initial: false };
  }
  var payload = { name: String(path[0]) };
  if (nested !== void 0) payload.params = nested;
  try {
    if (leaf && leaf.type === "stack" && leaf.key && Array.isArray(leaf.routeNames) && leaf.routeNames.indexOf(expected) >= 0) {
      if (selected && selected.name === expected && (!params || same(selected.params || {}, params, 0, { left: 200 }))) return { ok: true, action: "noop", path, via };
      nav.dispatch({
        type: "REPLACE",
        target: leaf.key,
        payload: { name: expected, params: params || void 0 }
      });
      return { ok: true, action: "replace", path, via };
    }
    nav.dispatch({ type: "NAVIGATE", payload });
    return { ok: true, action: "navigate", path, via };
  } catch (error) {
    return {
      ok: false,
      reason: "threw",
      detail: String(error && error.message).slice(0, 80)
    };
  }
}
function agentStyleFlags(style) {
  var out = {};
  var stack = [{ node: style, depth: 0 }];
  while (stack.length) {
    var item = stack.pop();
    var node = item.node;
    if (!node || item.depth > 5) continue;
    if (Array.isArray(node)) {
      for (var index = node.length - 1; index >= 0; index--) {
        stack.push({ node: node[index], depth: item.depth + 1 });
      }
      continue;
    }
    if (typeof node !== "object") continue;
    if (node.display !== void 0) out.display = node.display;
    if (node.opacity !== void 0) out.opacity = node.opacity;
  }
  return out;
}
function agentHidden(props) {
  if (!props) return false;
  if (props.focused === false || props.isFocused === false || props.screenFocused === false) {
    return true;
  }
  if (props.style) {
    var flags = agentStyleFlags(props.style);
    if (flags.display === "none" || flags.opacity === 0) return true;
  }
  return props.accessibilityElementsHidden === true || props["aria-hidden"] === true;
}
function agentComponentName(value) {
  for (var hops = 0; hops < 8; hops++) {
    if (!value) return "";
    if (typeof value === "function") return value.displayName || value.name || "";
    if (typeof value !== "object") return "";
    var direct = value.displayName || (typeof value.render === "function" ? value.render.displayName || value.render.name || "" : "");
    if (direct) return direct;
    value = value.type;
  }
  return "";
}
function agentReadiness(routeName, expectedParams, limits) {
  var empty = {
    found: false,
    content: 0,
    loading: null,
    signature: "",
    active: [],
    paramMismatch: []
  };
  var found = agentFindNavigator(limits);
  if (!found) return empty;
  var state = found.state;
  var active = [];
  for (var depth = 0; state && state.routes && state.routes.length && depth < 16; depth++) {
    var route = state.routes[state.index == null ? 0 : state.index];
    if (!route) break;
    active.push(route.name);
    state = route.state;
  }
  var expected = expectedParams || {};
  var screen = null;
  var stack = agentCollectFiberRoots();
  var seen = /* @__PURE__ */ new Set();
  var budget = limits.walkBudget;
  var deadline = Date.now() + limits.walkDeadlineMs;
  while (stack.length && budget-- > 0 && !screen) {
    if ((budget & 255) === 0 && Date.now() > deadline) break;
    var fiber = stack.pop();
    if (!fiber || seen.has(fiber)) continue;
    seen.add(fiber);
    if (fiber.sibling) stack.push(fiber.sibling);
    var props = fiber.memoizedProps;
    if (agentHidden(props)) continue;
    if (props && props.route && props.route.name === routeName) {
      var focused = true;
      try {
        if (props.navigation && typeof props.navigation.isFocused === "function") {
          focused = props.navigation.isFocused();
        }
      } catch (error) {
        focused = true;
      }
      if (focused) screen = fiber;
    }
    if (fiber.child) stack.push(fiber.child);
  }
  var content = 0;
  var loading = "";
  var parts = [];
  var missed = [];
  if (screen) {
    var inner = [screen.child];
    var innerSeen = /* @__PURE__ */ new Set();
    var innerBudget = limits.innerWalkBudget;
    var loaderPattern = /Skeleton|Shimmer|LoadingPlaceholder|LoadingIndicator|LoadingSpinner|LoadingView|LoadingScreen|ActivityIndicator|Spinner|^Loader$/;
    while (inner.length && innerBudget-- > 0) {
      var node = inner.pop();
      if (!node || innerSeen.has(node)) continue;
      innerSeen.add(node);
      if (node.sibling) inner.push(node.sibling);
      var nodeProps = node.memoizedProps;
      if (agentHidden(nodeProps)) continue;
      if (!loading) {
        var typeName = agentComponentName(node.type) || agentComponentName(node.elementType);
        if (typeName && loaderPattern.test(typeName)) loading = "skeleton";
        else if (node.tag === 13 && node.memoizedState !== null) loading = "suspense";
        else if (nodeProps) {
          var busy = nodeProps.accessibilityState && nodeProps.accessibilityState.busy || nodeProps["aria-busy"];
          if (busy === true) loading = "busy";
          else if (nodeProps.isLoading === true || nodeProps.loading === true || nodeProps.animating === true) {
            loading = "busy";
          } else if (nodeProps.accessibilityRole === "progressbar" || nodeProps.role === "progressbar") {
            loading = "busy";
          }
        }
      }
      if (node.tag === 5 && nodeProps) {
        var text2 = typeof nodeProps.children === "string" ? nodeProps.children : null;
        var media = nodeProps.source || nodeProps.src;
        var label = typeof nodeProps.accessibilityLabel === "string" ? nodeProps.accessibilityLabel : null;
        if (text2 || media || label) {
          content += 1;
          if (parts.length < 250) {
            parts.push(String(node.type) + ":" + String(text2 || label || "src").slice(0, 60));
          }
        }
      }
      if (node.child) inner.push(node.child);
    }
    var leaf = found.state;
    while (leaf && leaf.routes && leaf.routes.length) {
      var next = leaf.routes[leaf.index == null ? 0 : leaf.index];
      if (!next) break;
      leaf = next.state || next;
    }
    for (var key2 in expected) {
      var actual = leaf && leaf.params ? leaf.params[key2] : void 0;
      if (String(actual) !== String(expected[key2]) && missed.length < 4) missed.push(key2);
    }
    if (missed.length) {
      screen = null;
      content = 0;
    }
  }
  var joined = parts.join("|");
  var hash2 = 0;
  for (var at = 0; at < joined.length; at++) {
    hash2 = hash2 * 31 + joined.charCodeAt(at) | 0;
  }
  return {
    found: !!screen,
    content,
    loading: loading ? loading : null,
    signature: (hash2 >>> 0).toString(36),
    active,
    paramMismatch: missed
  };
}
function agentPatchProperty(target2, name2, requireOriginal, makeWrapper, undo, release) {
  if (!target2 || typeof target2 !== "object" && typeof target2 !== "function") return false;
  var current;
  try {
    current = target2[name2];
  } catch (error) {
    return false;
  }
  if (current && typeof current.__aiHarnessRelease === "function") {
    try {
      current.__aiHarnessRelease();
    } catch (error) {
      current = null;
    }
    try {
      current = target2[name2];
    } catch (error) {
      return false;
    }
  }
  if (requireOriginal && typeof current !== "function") return false;
  var hadOwn = Object.prototype.hasOwnProperty.call(target2, name2);
  var control = { live: true };
  var wrapper;
  try {
    wrapper = makeWrapper(typeof current === "function" ? current : null, control);
  } catch (error) {
    return false;
  }
  if (typeof wrapper !== "function") return false;
  try {
    wrapper.__aiHarnessRelease = release;
  } catch (error) {
  }
  try {
    target2[name2] = wrapper;
  } catch (error) {
    return false;
  }
  var applied = false;
  try {
    applied = target2[name2] === wrapper;
  } catch (error) {
    applied = false;
  }
  if (!applied) return false;
  undo.push(function() {
    control.live = false;
    if (target2[name2] !== wrapper) return;
    if (hadOwn) target2[name2] = current;
    else delete target2[name2];
  });
  return true;
}
function agentCreateSignals(root, undo, release) {
  var started = Date.now();
  var signals = {
    installedAt: started,
    commitAt: started,
    settledAt: started,
    pending: 0,
    fetchDepth: 0,
    available: { commits: false, fetch: false, xhr: false }
  };
  signals.begin = function() {
    try {
      signals.pending += 1;
      return { done: false };
    } catch (error) {
      return null;
    }
  };
  signals.end = function(token) {
    try {
      if (!token || token.done) return;
      token.done = true;
      if (signals.pending > 0) signals.pending -= 1;
      signals.settledAt = Date.now();
    } catch (error) {
      token = null;
    }
  };
  var hook = null;
  try {
    hook = root.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  } catch (error) {
    hook = null;
  }
  signals.available.commits = agentPatchProperty(
    hook,
    "onCommitFiberRoot",
    false,
    function(original, control) {
      return function() {
        if (control.live) {
          try {
            signals.commitAt = Date.now();
          } catch (error) {
            control.live = true;
          }
        }
        if (typeof original === "function") return original.apply(this, arguments);
        return void 0;
      };
    },
    undo,
    release
  );
  signals.available.fetch = agentPatchProperty(
    root,
    "fetch",
    true,
    function(original, control) {
      return function() {
        if (!control.live) return original.apply(this, arguments);
        var token = signals.begin();
        var result;
        signals.fetchDepth += 1;
        try {
          result = original.apply(this, arguments);
        } catch (error) {
          signals.end(token);
          throw error;
        } finally {
          signals.fetchDepth -= 1;
        }
        try {
          if (result && typeof result.then === "function") {
            var done = function() {
              signals.end(token);
            };
            result.then(done, done);
          } else {
            signals.end(token);
          }
        } catch (error) {
          signals.end(token);
        }
        return result;
      };
    },
    undo,
    release
  );
  var xhrProto = null;
  try {
    xhrProto = root.XMLHttpRequest ? root.XMLHttpRequest.prototype : null;
  } catch (error) {
    xhrProto = null;
  }
  if (xhrProto && typeof xhrProto.addEventListener === "function") {
    signals.available.xhr = agentPatchProperty(
      xhrProto,
      "send",
      true,
      function(original, control) {
        return function() {
          if (!control.live || signals.fetchDepth > 0) return original.apply(this, arguments);
          var token = signals.begin();
          try {
            var xhr = this;
            var done = function() {
              signals.end(token);
            };
            xhr.addEventListener("loadend", done);
            xhr.addEventListener("readystatechange", function() {
              if (xhr.readyState === 4) done();
            });
          } catch (error) {
            signals.end(token);
          }
          try {
            return original.apply(this, arguments);
          } catch (error) {
            signals.end(token);
            throw error;
          }
        };
      },
      undo,
      release
    );
  }
  return signals;
}
function agentVerdict(snapshot, signals, painted, now, quietMs, idleMs) {
  var missing = [];
  if (!signals.available.commits) missing.push("commits");
  if (!signals.available.fetch) missing.push("fetch");
  if (!signals.available.xhr) missing.push("xhr");
  if (painted === null) missing.push("paint");
  var commitQuietMs = signals.available.commits ? Math.max(0, now - signals.commitAt) : null;
  var networkTracked = signals.available.fetch || signals.available.xhr;
  var networkQuietMs = networkTracked ? signals.pending > 0 ? 0 : Math.max(0, now - signals.settledAt) : null;
  var quiet = (commitQuietMs === null || commitQuietMs >= quietMs) && (networkQuietMs === null || signals.pending === 0 && networkQuietMs >= idleMs);
  var out = snapshot;
  out.quiet = quiet;
  out.painted = painted;
  out.commitQuietMs = commitQuietMs;
  out.networkQuietMs = networkQuietMs;
  out.inflight = networkTracked ? signals.pending : null;
  out.missing = missing;
  out.confident = missing.length === 0;
  out.settled = !!out.found && !out.loading && quiet && painted !== false;
  return out;
}
function agentSettle(signals, routeName, expectedParams, limits, quietMs, idleMs, reply) {
  var root = globalThis;
  var finished = false;
  var timer = null;
  var commitAtStart = signals.commitAt;
  var finish = function(painted) {
    if (finished) return;
    finished = true;
    try {
      if (timer !== null) root.clearTimeout(timer);
    } catch (error) {
      timer = null;
    }
    try {
      var now = Date.now();
      var snapshot = agentReadiness(routeName, expectedParams, limits);
      reply(agentVerdict(snapshot, signals, painted, now, quietMs, idleMs));
    } catch (error) {
      reply({
        error: "command-failed",
        detail: String(error && error.message).slice(0, 200)
      });
    }
  };
  var raf = root.requestAnimationFrame;
  if (typeof raf !== "function") {
    finish(null);
    return;
  }
  try {
    var timeout = typeof limits.paintTimeoutMs === "number" && limits.paintTimeoutMs > 0 ? limits.paintTimeoutMs : 500;
    timer = root.setTimeout(function() {
      finish(false);
    }, timeout);
    raf.call(root, function() {
      raf.call(root, function() {
        finish(signals.commitAt === commitAtStart);
      });
    });
  } catch (error) {
    finish(null);
  }
}
function agentOpeningControl(value, method2) {
  if (!value || typeof value !== "object") return false;
  var data = function(key3) {
    var descriptor = Object.getOwnPropertyDescriptor(value, key3);
    return descriptor && "value" in descriptor ? descriptor.value : void 0;
  };
  var pairs = [
    ["open", ["close", "dismiss", "hide"]],
    ["present", ["dismiss", "close"]],
    ["show", ["hide", "close"]],
    ["expand", ["close", "collapse"]]
  ];
  for (var at = 0; at < pairs.length; at++) {
    var key2 = pairs[at][0];
    var closers = pairs[at][1];
    if (method2 && method2 !== key2) continue;
    var opener = data(key2);
    if (typeof opener !== "function" || opener.length !== 0) continue;
    for (var c = 0; c < closers.length; c++) {
      if (typeof data(closers[c]) === "function") return true;
    }
  }
  return false;
}
function agentControlCloser(value, method2) {
  if (!value || typeof value !== "object") return null;
  var table = {
    open: ["close", "dismiss", "hide"],
    present: ["dismiss", "close"],
    show: ["hide", "close"],
    expand: ["close", "collapse"]
  };
  var closers = table[method2];
  if (!closers) return null;
  for (var at = 0; at < closers.length; at++) {
    var descriptor = Object.getOwnPropertyDescriptor(value, closers[at]);
    if (descriptor && "value" in descriptor && typeof descriptor.value === "function") {
      return closers[at];
    }
  }
  return null;
}
function agentSetPath(value, path, next) {
  if (!Array.isArray(path) || !path.length) return next;
  var copies = [];
  var cursor = value;
  for (var at = 0; at < path.length; at++) {
    copies.push(cursor);
    cursor = cursor === null || cursor === void 0 ? void 0 : cursor[path[at]];
  }
  var result = next;
  for (var back = path.length - 1; back >= 0; back--) {
    var source = copies[back];
    var copy;
    if (Array.isArray(source)) copy = source.slice();
    else if (source && typeof source === "object") {
      copy = {};
      for (var key2 in source) copy[key2] = source[key2];
    } else copy = {};
    copy[path[back]] = result;
    result = copy;
  }
  return result;
}
function agentPresentationIndex(pres) {
  if (pres.structureCache) return pres.structureCache;
  var all = [];
  var current = /* @__PURE__ */ new Map();
  var props = /* @__PURE__ */ new Map();
  var names = /* @__PURE__ */ new Map();
  var seen = /* @__PURE__ */ new Set();
  var concealed = /* @__PURE__ */ new Set();
  var stack = agentCollectFiberRoots();
  var budget = pres.limits.walkBudget;
  var deadline = Date.now() + pres.limits.walkDeadlineMs;
  var capped = false;
  while (stack.length) {
    if (budget-- <= 0 || (budget & 255) === 0 && Date.now() > deadline) {
      capped = true;
      break;
    }
    var fiber = stack.pop();
    if (!fiber || seen.has(fiber)) continue;
    seen.add(fiber);
    if (fiber.sibling) stack.push(fiber.sibling);
    if (concealed.has(fiber.return) || agentHidden(fiber.memoizedProps)) {
      concealed.add(fiber);
      continue;
    }
    if (fiber.child) stack.push(fiber.child);
    all.push(fiber);
    current.set(fiber, fiber);
    if (fiber.alternate) current.set(fiber.alternate, fiber);
    var label = agentComponentName(fiber.type) || agentComponentName(fiber.elementType);
    if (label) {
      var byName = names.get(label);
      if (!byName) {
        byName = [];
        names.set(label, byName);
      }
      byName.push(fiber);
    }
    var owned = fiber.memoizedProps;
    if (owned && typeof owned === "object") {
      var byProps = props.get(owned);
      if (!byProps) {
        byProps = [];
        props.set(owned, byProps);
      }
      byProps.push(fiber);
    }
  }
  var entryMap = /* @__PURE__ */ new Map();
  if (pres.entries) {
    pres.entries.forEach(function(record2) {
      record2.fibers.forEach(function(entryFiber) {
        var live = current.get(entryFiber);
        if (!live) return;
        record2.actions.forEach(function(site) {
          var list = entryMap.get(site);
          if (!list) {
            list = [];
            entryMap.set(site, list);
          }
          if (list.indexOf(live) < 0) list.push(live);
        });
      });
    });
  }
  var visibility = /* @__PURE__ */ new Map();
  var tree = {
    all,
    current,
    props,
    names,
    entries: entryMap,
    capped,
    // Mounted, not pruned as hidden, and not under a disabled, unfocused or hidden-modal ancestor.
    isVisible: function(fiber2) {
      var live = current.get(fiber2);
      if (!live) return false;
      var known = visibility.get(live);
      if (known === void 0) {
        known = agentActiveAncestors(live);
        visibility.set(live, known);
      }
      return known;
    },
    inside: function(fiber2, owner3) {
      if (!owner3) return false;
      var walked = /* @__PURE__ */ new Set();
      for (var parent = fiber2; parent && !walked.has(parent); parent = parent.return) {
        if (parent === owner3 || parent === owner3.alternate) return true;
        walked.add(parent);
      }
      return false;
    }
  };
  pres.structureCache = tree;
  return tree;
}
function agentActiveAncestors(fiber) {
  var walked = /* @__PURE__ */ new Set();
  for (var parent = fiber; parent && !walked.has(parent); parent = parent.return) {
    walked.add(parent);
    var props = parent.memoizedProps;
    if (!props || typeof props !== "object") continue;
    if (agentHidden(props)) return false;
    if (props.disabled === true) return false;
    if (props.accessibilityState && props.accessibilityState.disabled === true) return false;
    if (props.visible === false && (agentComponentName(parent.type) === "Modal" || parent.tag === 5 && typeof props.onShow === "function")) {
      return false;
    }
    for (var key2 in props) {
      if (props[key2] === false && /^(?:is)?(?:screen|page|tab)(?:focused|active)$/i.test(key2)) {
        return false;
      }
    }
    if (props.route && props.navigation && typeof props.navigation.isFocused === "function") {
      try {
        if (!props.navigation.isFocused()) return false;
      } catch (error) {
        return false;
      }
    }
  }
  return true;
}
function agentFocusedScope(tree) {
  if (tree.scopeResolved) return tree.scope;
  var routes = [];
  for (var at = 0; at < tree.all.length; at++) {
    var fiber = tree.all[at];
    var props = fiber.memoizedProps;
    if (!props || !props.route || typeof props.route.name !== "string") continue;
    if (!props.navigation || typeof props.navigation.isFocused !== "function") continue;
    var focused = false;
    try {
      focused = props.navigation.isFocused() === true && tree.isVisible(fiber);
    } catch (error) {
      focused = false;
    }
    if (focused) routes.push(fiber);
  }
  var leaves = [];
  for (var r = 0; r < routes.length; r++) {
    var holdsAnother = false;
    for (var c = 0; c < routes.length; c++) {
      if (c !== r && tree.inside(routes[c], routes[r])) holdsAnother = true;
    }
    if (!holdsAnother) leaves.push(routes[r]);
  }
  tree.scope = leaves.length === 1 ? leaves[0] : null;
  tree.scopeResolved = true;
  return tree.scope;
}
function agentOwnedBy(fiber, owner3) {
  if (!fiber || !owner3) return false;
  var queue = [fiber];
  var seen = /* @__PURE__ */ new Set();
  for (var at = 0; at < queue.length && at < 2e3; at++) {
    var node = queue[at];
    if (!node || seen.has(node)) continue;
    seen.add(node);
    if (node === owner3 || node === owner3.alternate) return true;
    if (node.return) queue.push(node.return);
    if (node._debugOwner) queue.push(node._debugOwner);
  }
  return false;
}
function agentListOf(fiber, tree) {
  var walked = /* @__PURE__ */ new Set();
  for (var parent = fiber.return; parent && !walked.has(parent) && walked.size < 400; parent = parent.return) {
    walked.add(parent);
    if (parent.tag !== 5) continue;
    var kind = parent.stateNode && parent.stateNode.viewConfig && parent.stateNode.viewConfig.uiViewClassName ? parent.stateNode.viewConfig.uiViewClassName : typeof parent.type === "string" ? parent.type : void 0;
    if (kind !== "RCTScrollView" && kind !== "AndroidScrollView") continue;
    var props = parent.memoizedProps;
    if (props && (props.horizontal || props.pagingEnabled || props.scrollEnabled === false)) return null;
    return tree.current.get(parent) ? tree.current.get(parent) : parent;
  }
  return null;
}
function agentVisibleCount(pres) {
  pres.structureCache = void 0;
  var tree = agentPresentationIndex(pres);
  pres.structureCache = void 0;
  return tree.capped ? -1 : tree.all.length;
}
function agentHookValue(pres, binding) {
  var tree = agentPresentationIndex(pres);
  var live = tree.current.get(binding.fiber);
  if (!live) return void 0;
  binding.fiber = live;
  var state = live.memoizedState;
  for (var at = 0; state && at < binding.index; at++) state = state.next;
  return state ? state.memoizedState : void 0;
}
function agentCollectionTargets(pres, states) {
  var targets = /* @__PURE__ */ new Map();
  var modules = globalThis.__r && globalThis.__r.getModules ? globalThis.__r.getModules() : null;
  var initialized = /* @__PURE__ */ new Map();
  var normalize = function(value) {
    return String(value).split("\\").join("/").replace(/^file:\/\//, "").replace(/^\.\//, "");
  };
  if (modules && typeof modules.values === "function") {
    var values = modules.values();
    var next = values.next();
    while (!next.done) {
      var module = next.value;
      if (module && module.isInitialized && typeof module.verboseName === "string") {
        initialized.set(
          normalize(module.verboseName),
          module.publicModule ? module.publicModule.exports : void 0
        );
      }
      next = values.next();
    }
  }
  var exportsFor = function(file2) {
    var direct = initialized.get(file2);
    if (direct !== void 0) return direct;
    return pres.sourceRoot ? initialized.get(pres.sourceRoot + "/" + file2) : void 0;
  };
  for (var s = 0; s < states.length; s++) {
    var site = states[s];
    if (!site || typeof site.id !== "string") continue;
    var qualified = Array.isArray(site.ownerSites) ? site.ownerSites : [];
    var sources = [{ owner: site.owner, file: site.file }];
    for (var q = 0; q < qualified.length; q++) sources.push(qualified[q]);
    var extra = Array.isArray(site.owners) ? site.owners : [];
    for (var e = 0; e < extra.length; e++) {
      var already = false;
      for (var k = 0; k < qualified.length; k++) if (qualified[k].owner === extra[e]) already = true;
      if (!already) sources.push({ owner: extra[e], file: site.file });
    }
    for (var at = 0; at < sources.length; at++) {
      var owner3 = sources[at].owner;
      var file = sources[at].file;
      var target2 = targets.get(owner3);
      if (!target2) {
        target2 = { types: /* @__PURE__ */ new Set(), sitesByType: /* @__PURE__ */ new Map(), fallbackSites: /* @__PURE__ */ new Set(), fallback: false };
        targets.set(owner3, target2);
      }
      var addType = function(bucket, type2, id2) {
        bucket.types.add(type2);
        var sites = bucket.sitesByType.get(type2);
        if (!sites) {
          sites = /* @__PURE__ */ new Set();
          bucket.sitesByType.set(type2, sites);
        }
        sites.add(id2);
      };
      var exported = exportsFor(file);
      var matches = [];
      var descriptors = exported && (typeof exported === "object" || typeof exported === "function") ? Object.getOwnPropertyDescriptors(exported) : {};
      for (var key2 in descriptors) {
        var descriptor = descriptors[key2];
        if (!descriptor || !("value" in descriptor)) continue;
        var type = descriptor.value;
        var read = function(holder, field2) {
          if (!holder || typeof holder !== "object" && typeof holder !== "function") return void 0;
          var found = Object.getOwnPropertyDescriptor(holder, field2);
          return found && "value" in found ? found.value : void 0;
        };
        var body = read(type, "render");
        if (body === void 0) body = read(type, "type");
        if (body === void 0) body = type;
        var named = key2 === owner3 || body && (body.displayName === owner3 || body.name === owner3);
        if (named && typeof body === "function") {
          matches.push(type);
          matches.push(body);
        }
      }
      if (typeof exported === "function" && exported.name === owner3) matches.push(exported);
      if (matches.length) {
        for (var m = 0; m < matches.length; m++) addType(target2, matches[m], site.id);
      } else {
        target2.fallback = true;
        target2.fallbackSites.add(site.id);
      }
    }
  }
  return targets;
}
function agentPatchPresentationHooks(pres) {
  if (pres.patches.length) return true;
  var modules = globalThis.__r && globalThis.__r.getModules ? globalThis.__r.getModules() : null;
  if (!modules || typeof modules.values !== "function") return false;
  var values = modules.values();
  var next = values.next();
  while (!next.done) {
    var module = next.value;
    if (module && module.isInitialized) {
      var react = agentMutableReact(module.publicModule ? module.publicModule.exports : void 0);
      if (react && typeof react.createElement === "function" && typeof react.useState === "function" && typeof react.useReducer === "function") {
        var keys = ["useState", "useReducer"];
        for (var at = 0; at < keys.length; at++) {
          var key2 = keys[at];
          var descriptor = Object.getOwnPropertyDescriptor(react, key2);
          if (!descriptor || !descriptor.writable) continue;
          var original = react[key2];
          var wrapped = agentHookWrapper(pres, key2, original);
          try {
            react[key2] = wrapped;
          } catch (error) {
            agentUnpatchPresentationHooks(pres);
            return false;
          }
          pres.patches.push({ react, key: key2, original, wrapped });
        }
        break;
      }
    }
    next = values.next();
  }
  return pres.patches.length > 0;
}
function agentUnpatchPresentationHooks(pres) {
  for (var at = 0; at < pres.patches.length; at++) {
    var patch = pres.patches[at];
    if (patch.react[patch.key] === patch.wrapped) patch.react[patch.key] = patch.original;
  }
  pres.patches.length = 0;
}
function agentHookWrapper(pres, kind, original) {
  return function() {
    var args = [];
    for (var at = 0; at < arguments.length; at++) args.push(arguments[at]);
    return agentRegisterHook(pres, kind, original, args);
  };
}
function agentRegisterHook(pres, kind, original, args) {
  var live = pres.current();
  if (!live) return original.apply(void 0, args);
  var index = 0;
  for (var hook = live.fiber.memoizedState; hook && index < 300; hook = hook.next) index++;
  var pending = live.fiber.pendingProps;
  if (pending === void 0 || pending === null) pending = live.fiber.memoizedProps;
  var projection = null;
  for (var at = 0; at < pres.projected.length && !projection; at++) {
    var candidate = pres.projected[at];
    if (candidate.seed && candidate.child.props === pending && candidate.focus.type === live.fiber.type) {
      projection = candidate;
    }
  }
  if (projection && projection.seed.index === index && projection.seed.kind === kind) {
    var value = projection.seed.value;
    projection.seed.applied = true;
    args = kind === "useReducer" ? [args[0], value, function() {
      return value;
    }] : [function() {
      return value;
    }];
  }
  var result = original.apply(void 0, args);
  if (!pres.collecting.has(live.fiber) && !pres.collecting.has(live.fiber.alternate)) return result;
  if (!Array.isArray(result) || typeof result[1] !== "function") return result;
  var record2 = pres.owners.get(live.fiber);
  if (!record2) record2 = pres.owners.get(live.fiber.alternate);
  if (!record2) record2 = /* @__PURE__ */ new Map();
  pres.owners.set(live.fiber, record2);
  var id2 = record2.get(index);
  var binding = id2 ? pres.bindings.get(id2) : void 0;
  if (!binding && pres.bindings.size < 1500) {
    id2 = String(++pres.sequence);
    record2.set(index, id2);
    binding = {
      id: id2,
      index,
      kind,
      stack: String(new Error().stack).slice(0, 8e3),
      fiber: live.fiber,
      renderer: live.renderer,
      setter: result[1]
    };
    pres.bindings.set(id2, binding);
  }
  if (binding) {
    binding.fiber = live.fiber;
    binding.setter = result[1];
  }
  return result;
}
function agentMutableReact(exported) {
  if (!exported) return exported;
  var descriptor = Object.getOwnPropertyDescriptor(exported, "default");
  var value = descriptor && "value" in descriptor ? descriptor.value : void 0;
  if (value && value.createElement === exported.createElement && typeof value.useState === "function" && value.useState === exported.useState && value.useReducer === exported.useReducer) return value;
  return exported;
}
function agentRegisterEntries(pres, tree) {
  var wanted = /* @__PURE__ */ new Set();
  var actions = pres.catalog.actions;
  for (var a = 0; a < actions.length; a++) {
    var action = actions[a];
    if (!action || !action.effect || action.effect.kind === "mount") continue;
    wanted.add(action.component);
    if (action.effect.kind === "control") wanted.add(action.effect.component);
    if (action.consumer) wanted.add(action.consumer.component);
  }
  var mounted = new Set(tree.all);
  var gone = [];
  pres.entries.forEach(function(record3, id2) {
    var live = false;
    record3.fibers.forEach(function(fiber2) {
      if (mounted.has(fiber2) || mounted.has(fiber2.alternate)) live = true;
    });
    if (live) record3.fibers.clear();
    else gone.push(id2);
  });
  for (var g = 0; g < gone.length; g++) {
    var dead = pres.entries.get(gone[g]);
    pres.entries.delete(gone[g]);
    if (dead) pres.entryKeys.delete(dead.key);
  }
  for (var at = 0; at < tree.all.length; at++) {
    var fiber = tree.all[at];
    var label = agentComponentName(fiber.type) || agentComponentName(fiber.elementType);
    if (!label || !wanted.has(label)) continue;
    var origin2 = fiber._debugStack ? fiber._debugStack : fiber._debugSource;
    if (!origin2 || typeof origin2 !== "object") continue;
    var record2 = pres.entrySources.get(origin2);
    if (record2 && pres.entries.get(record2.id) !== record2) {
      var existing = pres.entryKeys.get(record2.key);
      if (existing) record2 = existing;
      else if (pres.entries.size < 1500) {
        pres.entries.set(record2.id, record2);
        pres.entryKeys.set(record2.key, record2);
      } else record2 = void 0;
    }
    if (!record2) {
      var stack = typeof origin2.stack === "string" ? origin2.stack.slice(0, 8e3) : void 0;
      var location = !stack && typeof origin2.fileName === "string" ? {
        file: origin2.fileName,
        line: origin2.lineNumber,
        column: Math.max(0, (origin2.columnNumber === void 0 ? 1 : origin2.columnNumber) - 1)
      } : void 0;
      if (!stack && !location) continue;
      var key2 = JSON.stringify([label, stack ? stack : location]);
      record2 = pres.entryKeys.get(key2);
      if (!record2 && pres.entries.size < 1500) {
        record2 = {
          id: "entry-" + ++pres.sequence,
          key: key2,
          kind: "entry",
          name: label,
          stack,
          source: location,
          actions: /* @__PURE__ */ new Set(),
          fibers: /* @__PURE__ */ new Set(),
          checked: false
        };
        pres.entryKeys.set(key2, record2);
        pres.entries.set(record2.id, record2);
      }
      if (record2) pres.entrySources.set(origin2, record2);
    }
    if (record2) record2.fibers.add(fiber);
  }
}
function agentPresentationCollect(pres, done) {
  var started = Date.now();
  var root = globalThis;
  var finish = function(error) {
    agentUnpatchPresentationHooks(pres);
    pres.collecting.clear();
    pres.structureCache = void 0;
    var matched = 0;
    var unbound = [];
    var stateCount = 0;
    pres.bindings.forEach(function(binding) {
      if (binding.site) {
        matched += 1;
        return;
      }
      if (stateCount >= 400 || !binding.stack || binding.checked) return;
      stateCount += 1;
      unbound.push({
        id: binding.id,
        owner: agentComponentName(binding.fiber && binding.fiber.type) || agentComponentName(binding.fiber && binding.fiber.elementType) || "",
        kind: "state",
        stack: binding.stack
      });
    });
    var entryCount = 0;
    var entriesMatched = 0;
    pres.entries.forEach(function(record2) {
      if (record2.actions.size) {
        entriesMatched += 1;
        return;
      }
      if (record2.checked || entryCount >= 400) return;
      if (!record2.stack && !record2.source) return;
      entryCount += 1;
      var wire = { id: record2.id, owner: record2.name, kind: "entry", stack: record2.stack ? record2.stack : "" };
      if (record2.source) wire.source = record2.source;
      unbound.push(wire);
    });
    done({
      ok: !error,
      bindings: pres.bindings.size,
      matched,
      entries: pres.entries.size,
      entriesMatched,
      unbound,
      scheduled: pres.lastScheduled,
      elapsedMs: Date.now() - started,
      error
    });
  };
  try {
    pres.lastScheduled = 0;
    pres.structureCache = void 0;
    var tree = agentPresentationIndex(pres);
    var mounted = new Set(tree.all);
    var stale = [];
    pres.bindings.forEach(function(binding, id2) {
      if (!mounted.has(binding.fiber) && !mounted.has(binding.fiber.alternate)) stale.push(id2);
    });
    for (var s = 0; s < stale.length; s++) pres.bindings.delete(stale[s]);
    try {
      agentRegisterEntries(pres, tree);
    } catch (error) {
      pres.entries.clear();
      pres.entryKeys.clear();
    }
    var targets = agentCollectionTargets(pres, pres.catalog.states);
    for (var at = 0; at < tree.all.length; at++) {
      var fiber = tree.all[at];
      if (fiber.tag === 14) continue;
      if (Array.isArray(fiber._debugHookTypes)) {
        var stateful = false;
        for (var h = 0; h < fiber._debugHookTypes.length; h++) {
          var kind = fiber._debugHookTypes[h];
          if (kind === "useState" || kind === "useReducer") stateful = true;
        }
        if (!stateful) continue;
      }
      var label = agentComponentName(fiber.type) || agentComponentName(fiber.elementType);
      var target2 = targets.get(label);
      if (!target2) continue;
      if (target2.fallback || target2.types.has(fiber.type) || target2.types.has(fiber.elementType)) {
        pres.collecting.add(fiber);
        var byType = target2.sitesByType.get(fiber.type);
        if (!byType) byType = target2.sitesByType.get(fiber.elementType);
        pres.pendingSites.set(fiber, byType ? byType : target2.fallbackSites);
      }
    }
    if (!pres.collecting.size || !agentPatchPresentationHooks(pres)) {
      finish();
      return;
    }
    pres.collecting.forEach(function(fiber2) {
      var renderers = pres.renderers();
      for (var r = 0; r < renderers.length; r++) {
        if (typeof renderers[r].scheduleUpdate !== "function") continue;
        try {
          renderers[r].scheduleUpdate(fiber2);
          pres.lastScheduled += 1;
        } catch (error) {
          continue;
        }
        break;
      }
    });
    if (!pres.lastScheduled) {
      finish();
      return;
    }
    root.setTimeout(function() {
      try {
        agentAttributeBindings(pres);
      } catch (error) {
        finish(String(error && error.message).slice(0, 120));
        return;
      }
      finish();
    }, 80);
  } catch (error) {
    finish(String(error && error.message).slice(0, 120));
  }
}
function agentAttributeBindings(pres) {
  pres.bindings.forEach(function(binding) {
    if (binding.site) return;
    var sites = pres.pendingSites.get(binding.fiber);
    if (!sites) sites = pres.pendingSites.get(binding.fiber.alternate);
    if (!sites || sites.size !== 1) return;
    sites.forEach(function(id2) {
      binding.site = id2;
    });
  });
}
function agentResolvePresentationEntry(pres, action, tree) {
  if (action.effect.kind === "state") return agentResolveStateEntry(pres, action, tree);
  if (action.effect.kind === "control") return agentResolveControlEntry(action, tree);
  if (action.effect.kind === "mount") {
    var type = agentMountedExport(pres, action.effect.file, action.effect.export);
    if (!type) return { reason: "not-loaded", error: "The source component is not loaded." };
    var body = agentMountBody(type);
    if (typeof body !== "function" || agentComponentName(type) !== action.owner) {
      return { reason: "owner-mismatch", error: "The source export is not the named component." };
    }
    var mounted = false;
    for (var m = 0; m < tree.all.length; m++) {
      var fiber = tree.all[m];
      if (fiber.type === type || fiber.elementType === type || fiber.type === body) {
        mounted = true;
        break;
      }
    }
    if (mounted) {
      return { reason: "already-mounted", error: "The app already renders this component." };
    }
    return { type, expected: action.owner };
  }
  return { reason: "unsupported", error: "Unsupported presentation transition." };
}
function agentResolveOpener(action, tree) {
  var scope = agentFocusedScope(tree);
  var inScope = function(fiber) {
    return !scope || tree.inside(fiber, scope);
  };
  var refuse = function(reason, error) {
    return { reason, error };
  };
  var labelOf = function(fiber) {
    return agentComponentName(fiber.type) || agentComponentName(fiber.elementType);
  };
  var bound = tree.entries.get(action.id);
  if (!bound || !bound.length) {
    return refuse("unbound", "The opening control could not be bound to its source.");
  }
  var openers = [];
  var disabled = 0;
  for (var e = 0; e < bound.length; e++) {
    var opener = bound[e];
    var props = opener.memoizedProps;
    if (labelOf(opener) !== action.component) continue;
    if (!props || typeof props[action.prop] !== "function") continue;
    if (props.disabled === true || props["aria-disabled"] === true || props.accessibilityState && props.accessibilityState.disabled === true) {
      disabled += 1;
      continue;
    }
    if (!inScope(opener) || !tree.isVisible(opener)) continue;
    var triggered = true;
    if (action.trigger) {
      for (var key2 in action.trigger) if (props[key2] !== action.trigger[key2]) triggered = false;
    }
    if (triggered) openers.push(opener);
  }
  if (!openers.length) {
    return disabled ? refuse("disabled", "The opening control is disabled in this app state.") : refuse("not-in-view", "The opening control is not in the active view.");
  }
  var candidates = tree.names.get(action.owner);
  var visibleOwners = [];
  for (var c = 0; candidates && c < candidates.length; c++) {
    if (tree.isVisible(candidates[c]) && inScope(candidates[c])) visibleOwners.push(candidates[c]);
  }
  var owners = [];
  for (var o = 0; o < visibleOwners.length; o++) {
    var owner3 = visibleOwners[o];
    var holdsOpener = false;
    for (var h = 0; h < openers.length; h++) if (tree.inside(openers[h], owner3)) holdsOpener = true;
    if (!holdsOpener) continue;
    var holdsInner = false;
    for (var i = 0; i < visibleOwners.length; i++) {
      if (visibleOwners[i] !== owner3 && tree.inside(visibleOwners[i], owner3)) holdsInner = true;
    }
    if (!holdsInner) owners.push(owner3);
  }
  if (!owners.length) return refuse("no-owner", "The opening control has no visible source owner in the active view.");
  if (owners.length > 1) {
    var list = agentListOf(owners[0], tree);
    var rows = !!list;
    for (var r = 1; rows && r < owners.length; r++) if (agentListOf(owners[r], tree) !== list) rows = false;
    if (!rows) return refuse("ambiguous-owner", "More than one live owner renders this opening control.");
  }
  return { owners, openers };
}
function agentResolveStateEntry(pres, action, tree) {
  var effect = action.effect;
  var refuse = function(reason, error) {
    return { reason, error };
  };
  var read = function(binding) {
    var value2 = agentHookValue(pres, binding);
    for (var p = 0; p < effect.path.length; p++) {
      value2 = value2 === null || value2 === void 0 ? void 0 : value2[effect.path[p]];
    }
    return value2;
  };
  var sameSite = function(binding) {
    return binding.site === effect.site && binding.kind !== "useReducer" && !!tree.current.get(binding.fiber);
  };
  if (action.preview) {
    var visible = [];
    pres.bindings.forEach(function(binding) {
      if (sameSite(binding) && tree.isVisible(binding.fiber)) visible.push(binding);
    });
    if (visible.length !== 1) {
      return visible.length ? refuse("ambiguous-binding", "More than one live instance owns this opening state.") : refuse("no-binding", "The opening state could not be bound to its source.");
    }
    return { binding: visible[0] };
  }
  if (action.input) {
    return refuse("unsupported", "This opening needs data from its opener, which this runtime cannot supply.");
  }
  var resolved = agentResolveOpener(action, tree);
  if (resolved.error) return resolved;
  var site = null;
  var states = pres.catalog.states;
  for (var s = 0; states && s < states.length; s++) if (states[s].id === effect.site) site = states[s];
  var last = null;
  for (var w = 0; w < resolved.owners.length && w < 24; w++) {
    var owner3 = resolved.owners[w];
    var callbacks = [];
    var named = [];
    for (var o = 0; o < resolved.openers.length; o++) {
      var opener = resolved.openers[o];
      if (!tree.inside(opener, owner3)) continue;
      var callback = opener.memoizedProps[action.prop];
      if (callbacks.indexOf(callback) < 0) callbacks.push(callback);
    }
    if (callbacks.length > 1 && action.handler) {
      for (var c = 0; c < callbacks.length; c++) if (callbacks[c].name === action.handler) named.push(callbacks[c]);
      callbacks = named;
    }
    if (callbacks.length !== 1) {
      last = refuse("ambiguous-callback", "More than one opening entry matches this control.");
      continue;
    }
    if (!agentCondition(action.guard, owner3.memoizedProps)) {
      last = refuse("unmet-condition", "The opening control does not meet its source condition.");
      continue;
    }
    var matches = [];
    pres.bindings.forEach(function(binding) {
      if (!sameSite(binding) || !tree.isVisible(binding.fiber)) return;
      if (site && site.owner === action.owner && !tree.inside(binding.fiber, owner3)) return;
      matches.push(binding);
    });
    if (matches.length !== 1) {
      last = matches.length ? refuse("ambiguous-binding", "More than one live instance owns this opening state.") : refuse("no-binding", "The opening state could not be bound to its source.");
      continue;
    }
    var value = read(matches[0]);
    var already = JSON.stringify(value) === JSON.stringify(effect.value) || !effect.path.length && typeof effect.value === "object" && value !== null && value !== void 0;
    if (already) {
      last = refuse("already-open", "This state already holds the opening value.");
      continue;
    }
    return { binding: matches[0] };
  }
  return last;
}
function agentCondition(node, props) {
  if (!node) return true;
  if ("value" in node) return node.value;
  if (node.prop) {
    var value = props;
    for (var at = 0; at < node.prop.length; at++) {
      value = value === null || value === void 0 ? void 0 : value[node.prop[at]];
    }
    return value;
  }
  var a = agentCondition(node.args[0], props);
  var b = node.args[1] && agentCondition(node.args[1], props);
  switch (node.op) {
    case "!":
      return !a;
    case "&&":
      return a && b;
    case "||":
      return a || b;
    case "===":
      return a === b;
    case "!==":
      return a !== b;
    case "==":
      return a == b;
    case "!=":
      return a != b;
  }
  return false;
}
function agentResolveControlEntry(action, tree) {
  var effect = action.effect;
  var scope = agentFocusedScope(tree);
  var inScope = function(fiber) {
    return !scope || tree.inside(fiber, scope);
  };
  var refuse = function(reason, error) {
    return { reason, error };
  };
  var labelOf = function(fiber) {
    return agentComponentName(fiber.type) || agentComponentName(fiber.elementType);
  };
  var controllerOf = function(fiber) {
    var props = fiber.memoizedProps;
    if (!props || typeof props !== "object") return null;
    var carried = props[effect.prop];
    if (carried && typeof carried === "object" && "current" in carried) carried = carried.current;
    if (!agentOpeningControl(carried, effect.method)) return null;
    var close = agentControlCloser(carried, effect.method);
    return close ? { value: carried, close, fiber } : null;
  };
  var controllers = function(pool, keep) {
    var seen = [];
    var distinct = [];
    for (var at = 0; at < pool.length; at++) {
      var fiber = pool[at];
      if (labelOf(fiber) !== effect.component || !keep(fiber)) continue;
      var carried = controllerOf(fiber);
      if (!carried) continue;
      if (seen.indexOf(carried.value) >= 0) continue;
      seen.push(carried.value);
      distinct.push(carried);
    }
    return distinct;
  };
  var targetPool = function() {
    if (effect.target) {
      var bound = tree.entries.get(action.id + ":target");
      return bound ? bound : [];
    }
    var named = tree.names.get(effect.component);
    return named ? named : [];
  };
  var pick = function(distinct) {
    if (distinct.length === 1) return { target: distinct[0] };
    return distinct.length ? refuse("ambiguous-control", "More than one live control matches this opening.") : refuse("no-control", "The opening control could not be bound to its source.");
  };
  if (action.preview) {
    return pick(
      controllers(targetPool(), function(fiber) {
        return inScope(fiber) && tree.isVisible(fiber);
      })
    );
  }
  var resolved = agentResolveOpener(action, tree);
  if (resolved.error) return resolved;
  var owners = resolved.owners;
  var last = null;
  for (var w = 0; w < owners.length && w < 24; w++) {
    var current = owners[w];
    last = pick(
      controllers(targetPool(), function(fiber) {
        return agentOwnedBy(fiber, current);
      })
    );
    if (last.target) return last;
  }
  return last;
}
function agentMountBody(type) {
  if (!type || typeof type !== "object" && typeof type !== "function") return void 0;
  var read = function(key2) {
    var descriptor = Object.getOwnPropertyDescriptor(type, key2);
    return descriptor && "value" in descriptor ? descriptor.value : void 0;
  };
  var render = read("render");
  if (render !== void 0) return render;
  var inner = read("type");
  if (inner !== void 0) return inner;
  return type;
}
function agentMountedExport(pres, file, name2) {
  var modules = globalThis.__r && globalThis.__r.getModules ? globalThis.__r.getModules() : null;
  if (!modules || typeof modules.values !== "function") return null;
  var normalize = function(value) {
    return String(value).split("\\").join("/").replace(/^file:\/\//, "").replace(/^\.\//, "");
  };
  var values = modules.values();
  var next = values.next();
  while (!next.done) {
    var module = next.value;
    if (module && module.isInitialized && typeof module.verboseName === "string") {
      var path = normalize(module.verboseName);
      if (path === file || pres.sourceRoot && path === pres.sourceRoot + "/" + file) {
        var exported = module.publicModule ? module.publicModule.exports : void 0;
        var descriptor = exported ? Object.getOwnPropertyDescriptor(exported, name2) : void 0;
        if (descriptor && "value" in descriptor && descriptor.value) return descriptor.value;
      }
    }
    next = values.next();
  }
  return null;
}
function agentProjectionRoot(pres, focus) {
  var modules = globalThis.__r && globalThis.__r.getModules ? globalThis.__r.getModules() : null;
  if (!modules || typeof modules.values !== "function") return null;
  var react = null;
  var native = null;
  var values = modules.values();
  var next = values.next();
  while (!next.done) {
    var module = next.value;
    if (module && module.isInitialized) {
      var exported = module.publicModule ? module.publicModule.exports : void 0;
      if (exported && typeof exported.createElement === "function" && typeof exported.useState === "function") {
        react = agentMutableReact(exported);
      }
      if (exported && Object.getOwnPropertyDescriptor(exported, "Platform") && Object.getOwnPropertyDescriptor(exported, "StyleSheet")) {
        try {
          if (exported.Platform && typeof exported.Platform.OS === "string" && exported.StyleSheet && typeof exported.StyleSheet.create === "function" && exported.View && exported.Modal) native = exported;
        } catch (error) {
          native = native;
        }
      }
    }
    next = values.next();
  }
  if (!react || typeof react.Component !== "function" || !native) return null;
  var ancestor = null;
  var seen = /* @__PURE__ */ new Set();
  for (var parent = focus; parent && !seen.has(parent) && !ancestor; parent = parent.return) {
    seen.add(parent);
    if (parent.type === native.View || parent.elementType === native.View) ancestor = parent;
  }
  if (!ancestor) return null;
  var tree = agentPresentationIndex(pres);
  var root = tree.current.get(ancestor);
  if (!root) return null;
  var renderers = pres.renderers();
  for (var at = 0; at < renderers.length; at++) {
    if (typeof renderers[at].overrideProps === "function") {
      return { root, renderer: renderers[at], react, native };
    }
  }
  return null;
}
function agentBodyFrame(focus) {
  var left = Infinity;
  var top = Infinity;
  var right = -Infinity;
  var bottom = -Infinity;
  var hosts = 0;
  var stack = [focus ? focus.child : null];
  while (stack.length && hosts < 50) {
    var fiber = stack.pop();
    if (!fiber) continue;
    if (fiber.sibling) stack.push(fiber.sibling);
    if (fiber.tag !== 5) {
      stack.push(fiber.child);
      continue;
    }
    hosts++;
    try {
      var box = agentWindowRect(fiber);
      if (!box) continue;
      if (!isFinite(box.x) || !isFinite(box.y) || !isFinite(box.width) || !isFinite(box.height)) continue;
      if (box.width <= 0 || box.height <= 0) continue;
      left = Math.min(left, box.x);
      top = Math.min(top, box.y);
      right = Math.max(right, box.x + box.width);
      bottom = Math.max(bottom, box.y + box.height);
    } catch (error) {
      continue;
    }
  }
  return right > left && bottom > top ? { x: left, y: top, width: right - left, height: bottom - top } : void 0;
}
function agentWindowRect(fiber) {
  var state = fiber.stateNode;
  var instance = state && state.canonical && state.canonical.publicInstance ? state.canonical.publicInstance : state;
  if (instance && typeof instance.getBoundingClientRect === "function") {
    return instance.getBoundingClientRect();
  }
  var node = state ? state.node : void 0;
  var manager = globalThis.nativeFabricUIManager;
  var rect = node && manager && typeof manager.getBoundingClientRect === "function" ? manager.getBoundingClientRect(node, true) : void 0;
  if (!Array.isArray(rect) || rect.length !== 4) return void 0;
  return { x: rect[0], y: rect[1], width: rect[2], height: rect[3] };
}
function agentModalCarryOver(focus, Modal) {
  var carried = {};
  if (!Modal) return carried;
  var keys = [
    "presentationStyle",
    "transparent",
    "statusBarTranslucent",
    "navigationBarTranslucent",
    "hardwareAccelerated",
    "supportedOrientations"
  ];
  var seen = /* @__PURE__ */ new Set();
  for (var parent = focus ? focus.return : null; parent && !seen.has(parent); parent = parent.return) {
    seen.add(parent);
    if (parent.type !== Modal && parent.elementType !== Modal) continue;
    var props = parent.memoizedProps;
    if (props) {
      for (var at = 0; at < keys.length; at++) {
        if (keys[at] in props) carried[keys[at]] = props[keys[at]];
      }
    }
    break;
  }
  return carried;
}
function agentCopiesLiveNavigation(focus, props, tree) {
  var own = function(holder, key2) {
    if (!holder || typeof holder !== "object" && typeof holder !== "function") return void 0;
    var descriptor = Object.getOwnPropertyDescriptor(holder, key2);
    return descriptor && "value" in descriptor ? descriptor.value : void 0;
  };
  var children = own(props, "children");
  if (!children || typeof children !== "object") return false;
  var scopes = [];
  var seen = /* @__PURE__ */ new Set();
  var queue = [children];
  while (queue.length && seen.size < 2e3) {
    var element = queue.pop();
    if (!element || typeof element !== "object" || seen.has(element)) continue;
    seen.add(element);
    if (Array.isArray(element)) {
      for (var at = 0; at < element.length; at++) queue.push(element[at]);
      continue;
    }
    var type = own(element, "type");
    var elementProps = own(element, "props");
    if (!type || !elementProps) continue;
    var rendering = tree.props.get(elementProps);
    var list = rendering ? rendering : [];
    for (var r = 0; r < list.length; r++) {
      var fiber = list[r];
      if ((fiber.type === type || fiber.elementType === type) && tree.inside(fiber, focus)) {
        scopes.push(fiber);
      }
    }
    var nested = own(elementProps, "children");
    if (nested) queue.push(nested);
  }
  if (queue.length) return true;
  if (!scopes.length) return false;
  for (var n = 0; n < tree.all.length; n++) {
    var node = tree.all[n];
    var nodeProps = node.memoizedProps;
    var route = own(nodeProps, "route");
    var navigation = own(nodeProps, "navigation");
    if (typeof own(route, "name") !== "string") continue;
    if (typeof own(navigation, "getState") !== "function") continue;
    for (var s = 0; s < scopes.length; s++) if (tree.inside(node, scopes[s])) return true;
  }
  return false;
}
function agentContainPreviewErrors(pres, focus, record2, boundaryType) {
  var root = null;
  var seen = /* @__PURE__ */ new Set();
  for (var parent = focus; parent && !seen.has(parent); parent = parent.return) {
    seen.add(parent);
    if (parent.tag === 3) root = parent.stateNode;
  }
  if (!root || typeof root.onCaughtError !== "function") return;
  record2.errorRoot = root;
  record2.boundaryType = boundaryType;
  for (var at = 0; at < pres.caughtPatches.length; at++) {
    if (pres.caughtPatches[at].root === root && root.onCaughtError === pres.caughtPatches[at].wrapped) return;
  }
  var original = root.onCaughtError;
  var projected = pres.projected;
  var wrapped = function(_error, info) {
    for (var index = 0; index < projected.length; index++) {
      var item = projected[index];
      if (item.errorRoot === root && info && info.errorBoundary && info.errorBoundary.constructor === item.boundaryType) {
        item.failed = true;
        return void 0;
      }
    }
    return original.apply(this, arguments);
  };
  root.onCaughtError = wrapped;
  pres.caughtPatches.push({ root, original, wrapped });
}
function agentReleasePreviewErrors(pres, all) {
  for (var index = pres.caughtPatches.length - 1; index >= 0; index--) {
    var patch = pres.caughtPatches[index];
    var needed = false;
    if (!all) {
      for (var at = 0; at < pres.projected.length; at++) {
        if (pres.projected[at].errorRoot === patch.root) needed = true;
      }
    }
    if (needed) continue;
    if (patch.root.onCaughtError === patch.wrapped) patch.root.onCaughtError = patch.original;
    pres.caughtPatches.splice(index, 1);
  }
}
function agentSeedDeadline(pres, record2) {
  var root = globalThis;
  try {
    root.clearTimeout(record2.seedTimer);
  } catch (error) {
    record2.seedTimer = void 0;
  }
  record2.seedTimer = root.setTimeout(function() {
    if (pres.projected.indexOf(record2) < 0) return;
    if (!record2.seed.applied) record2.failed = true;
    var waiting = false;
    for (var at = 0; at < pres.projected.length; at++) {
      var item = pres.projected[at];
      if (item.seed && !item.seed.applied && !item.failed) waiting = true;
    }
    if (!pres.collecting.size && !waiting) agentUnpatchPresentationHooks(pres);
  }, 1e3);
}
function agentProject(pres, focus, preview, mountedContext) {
  pres.structureCache = void 0;
  var tree = agentPresentationIndex(pres);
  var live = tree.current.get(focus);
  if (live) focus = live;
  if (!focus) return { error: "This view cannot be projected." };
  for (var at = 0; at < pres.projected.length; at++) {
    if (!preview && (pres.projected[at].focus === focus || pres.projected[at].focus === focus.alternate)) {
      return { error: "This view cannot be projected." };
    }
  }
  var sourceProps = preview && preview.props ? preview.props : focus.memoizedProps;
  if (agentCopiesLiveNavigation(focus, sourceProps, tree)) {
    return {
      status: "needs-data",
      error: "This preview would duplicate live navigation. Its source recipe must isolate the presentation from the existing app children."
    };
  }
  var context = mountedContext ? mountedContext : agentProjectionRoot(pres, focus);
  if (!context) return { error: "This renderer cannot project a local view." };
  var type = focus.elementType ? focus.elementType : focus.type;
  if (!type || typeof type === "string") return { error: "No component view to project." };
  var root = context.root;
  var renderer = context.renderer;
  var react = context.react;
  var native = context.native;
  var props = root.memoizedProps;
  var child = react.createElement(type, sourceProps);
  var content = child;
  var resetContexts = [];
  if (native.ScrollView && native.ScrollView.Context) resetContexts.push(native.ScrollView.Context);
  if (native.VirtualizedList && native.VirtualizedList.contextType) {
    resetContexts.push(native.VirtualizedList.contextType);
  }
  var ancestors = /* @__PURE__ */ new Set();
  for (var parent = focus.return; parent && !ancestors.has(parent); parent = parent.return) {
    ancestors.add(parent);
    if (parent.tag !== 10 || !parent.memoizedProps || !("value" in parent.memoizedProps)) continue;
    var provider = parent.elementType ? parent.elementType : parent.type;
    if (!provider) continue;
    var identity = provider._context ? provider._context : provider;
    if (resetContexts.indexOf(identity) >= 0) continue;
    var carried = preview && preview.providers ? preview.providers.get(parent) : void 0;
    content = react.createElement(
      provider,
      { value: carried === void 0 ? parent.memoizedProps.value : carried },
      content
    );
  }
  var record2 = {
    root,
    renderer,
    react,
    props,
    focus,
    child,
    content,
    seed: preview ? preview.seed : void 0,
    mount: preview ? preview.mount : void 0,
    ios: native.Platform.OS === "ios",
    shown: false,
    dismissed: false,
    failed: false
  };
  var PreviewBoundary = class extends react.Component {
    constructor(boundaryProps) {
      super(boundaryProps);
      this.state = { failed: false };
    }
    static getDerivedStateFromError() {
      return { failed: true };
    }
    componentDidCatch() {
      record2.failed = true;
    }
    render() {
      return this.state.failed ? null : this.props.children;
    }
  };
  var body = react.createElement(PreviewBoundary, null, content);
  var key2 = "mobile-flow-preview-" + ++pres.sequence;
  record2.frame = agentBodyFrame(focus);
  var frame = record2.frame;
  var placed = frame && (frame.x >= 1 || frame.y >= 1) ? react.createElement(
    native.View,
    { style: { position: "absolute", left: frame.x, top: frame.y, width: frame.width, height: frame.height } },
    body
  ) : body;
  record2.positioned = placed !== body;
  var modalProps = { key: key2, transparent: false };
  var carriedProps = agentModalCarryOver(focus, native.Modal);
  for (var carryKey in carriedProps) modalProps[carryKey] = carriedProps[carryKey];
  modalProps.visible = true;
  modalProps.animationType = "none";
  modalProps.onShow = function() {
    record2.shown = true;
  };
  modalProps.onDismiss = function() {
    record2.dismissed = true;
  };
  var modal = react.createElement(native.Modal, modalProps, placed);
  var transparentRoot = props.children && props.children.type === react.Fragment && props.children.key == null && props.children.props && props.children.props.ref === void 0;
  var appBody = transparentRoot ? props.children.props.children : props.children;
  var appChildren = Array.isArray(appBody) ? appBody : [appBody];
  record2.element = modal;
  var nextChildren = react.createElement.apply(
    react,
    [react.Fragment, null].concat(appChildren).concat([modal])
  );
  record2.next = {};
  for (var propKey in props) record2.next[propKey] = props[propKey];
  record2.next.children = nextChildren;
  if (record2.seed && !agentPatchPresentationHooks(pres)) {
    return { error: "Temporary hook initialization is unavailable." };
  }
  agentContainPreviewErrors(pres, focus, record2, PreviewBoundary);
  pres.projected.push(record2);
  pres.undo.push({ projection: record2 });
  pres.structureCache = void 0;
  renderer.overrideProps(root, [], record2.next);
  if (record2.seed) agentSeedDeadline(pres, record2);
  return { ok: true, focus };
}
function agentProjectionAttached(pres, record2) {
  var tree = agentPresentationIndex(pres);
  var root = tree.current.get(record2.root);
  var children = root && root.memoizedProps && root.memoizedProps.children && root.memoizedProps.children.props ? root.memoizedProps.children.props.children : void 0;
  if (!Array.isArray(children)) return false;
  for (var at = 0; at < children.length; at++) if (children[at] === record2.element) return true;
  return false;
}
function agentReleaseProjection(pres, record2) {
  var root = globalThis;
  try {
    root.clearTimeout(record2.seedTimer);
  } catch (error) {
    record2.seedTimer = void 0;
  }
  var position = pres.projected.indexOf(record2);
  if (position >= 0) pres.projected.splice(position, 1);
  agentReleasePreviewErrors(pres, false);
  var waiting = false;
  for (var at = 0; at < pres.projected.length; at++) {
    var item = pres.projected[at];
    if (item.seed && !item.seed.applied && !item.failed) waiting = true;
  }
  if (record2.seed && !waiting) agentUnpatchPresentationHooks(pres);
  pres.structureCache = void 0;
}
function agentPresentationOpen(pres, id2, focus) {
  var started = Date.now();
  for (var at = 0; at < pres.undo.length; at++) {
    if (pres.undo[at].closing) {
      return { ok: false, error: "A native presentation is still dismissing.", checkpoint: pres.undo.length, elapsedMs: Date.now() - started };
    }
  }
  var action = null;
  for (var a = 0; a < pres.catalog.actions.length; a++) {
    if (pres.catalog.actions[a].id === id2) action = pres.catalog.actions[a];
  }
  if (!action) {
    return { ok: false, error: "The requested view is not in the source catalog.", checkpoint: pres.undo.length, elapsedMs: Date.now() - started };
  }
  pres.structureCache = void 0;
  var tree = agentPresentationIndex(pres);
  var found = agentResolvePresentationEntry(pres, action, tree);
  if (found.error) {
    return {
      ok: false,
      error: found.error,
      reason: found.reason ? found.reason : "other",
      checkpoint: pres.undo.length,
      elapsedMs: Date.now() - started
    };
  }
  if (action.effect.kind === "mount") {
    var mountScope = focus ? focus : agentFocusedScope(tree);
    var context = mountScope ? agentProjectionRoot(pres, mountScope) : null;
    if (!context) {
      return {
        ok: false,
        error: "This renderer cannot project a local view.",
        checkpoint: pres.undo.length,
        elapsedMs: Date.now() - started
      };
    }
    var owner3 = { type: found.type, elementType: found.type, memoizedProps: {}, return: focus };
    var projection = agentProject(pres, owner3, { mount: true }, context);
    if (!projection.ok) {
      return { ok: false, error: projection.error, checkpoint: pres.undo.length, elapsedMs: Date.now() - started };
    }
    return {
      ok: true,
      kind: "mount",
      expected: action.owner,
      checkpoint: pres.undo.length,
      elapsedMs: Date.now() - started
    };
  }
  if (action.effect.kind === "state") {
    var binding = found.binding;
    var previous = agentHookValue(pres, binding);
    for (var p = 0; p < action.effect.path.length; p++) {
      previous = previous === null || previous === void 0 ? void 0 : previous[action.effect.path[p]];
    }
    pres.undo.push({
      binding,
      path: action.effect.path,
      value: previous,
      nativeDismiss: previous === null || previous === void 0 || previous === false
    });
    var before = previous;
    var path = action.effect.path;
    var opened = action.effect.value;
    binding.setter(function(current) {
      var reference = current;
      for (var step = 0; step < path.length; step++) {
        reference = reference === null || reference === void 0 ? void 0 : reference[path[step]];
      }
      if (!Object.is(reference, before)) return current;
      return agentSetPath(current, path, opened);
    });
    pres.structureCache = void 0;
    return { ok: true, kind: "state", checkpoint: pres.undo.length, elapsedMs: Date.now() - started };
  }
  if (action.effect.kind === "control") {
    var target2 = found.target;
    for (var o = 0; o < pres.undo.length; o++) {
      if (!pres.undo[o].closed && pres.undo[o].control === target2.value) {
        return { ok: true, kind: "control", checkpoint: pres.undo.length, elapsedMs: Date.now() - started };
      }
    }
    pres.undo.push({
      control: target2.value,
      close: target2.close,
      focus: target2.fiber,
      nativeFocus: target2.fiber,
      origin: target2.fiber,
      // What the tree looked like before this opened. A dismissal is confirmed against it.
      baseline: tree.capped ? -1 : tree.all.length
    });
    target2.value[action.effect.method]();
    pres.structureCache = void 0;
    return { ok: true, kind: "control", checkpoint: pres.undo.length, elapsedMs: Date.now() - started };
  }
  return { ok: false, error: "Unsupported presentation transition.", checkpoint: pres.undo.length, elapsedMs: Date.now() - started };
}
function agentWaitForDismissal(pres, entry, done) {
  var root = globalThis;
  var started = Date.now();
  var stable = 0;
  var last = -2;
  var step = function() {
    if (entry.dismissed) {
      pres.lastDismissEvidence = "event";
      done(null);
      return;
    }
    var count = agentVisibleCount(pres);
    if (count >= 0) {
      if (entry.openCount === void 0) entry.openCount = count;
      var grew = entry.baseline >= 0 ? entry.openCount - entry.baseline : 0;
      if (grew > 0) {
        if (count - entry.baseline <= Math.max(2, Math.floor(grew / 4))) {
          pres.lastDismissEvidence = "tree";
          done(null);
          return;
        }
      } else {
        stable = count === last ? stable + 1 : 0;
        last = count;
        if (stable >= 4 && Date.now() - started >= 800) {
          pres.lastDismissEvidence = "stable";
          done(null);
          return;
        }
      }
    }
    var shrinking = count >= 0 && entry.openCount !== void 0 && count < entry.openCount;
    if (!entry.closeRetried && !shrinking && Date.now() - started >= 1e3) {
      entry.closeRetried = true;
      try {
        entry.control[entry.close]();
      } catch (error) {
        entry.closeRetried = true;
      }
    }
    if (Date.now() - started >= 4e3) {
      done("Native presentation dismissal has not finished.");
      return;
    }
    root.setTimeout(step, 100);
  };
  step();
}
function agentRestorePresentations(pres, level, wait2, done) {
  var root = globalThis;
  var floor = Math.max(0, level);
  var step = function() {
    if (pres.undo.length <= floor) {
      if (wait2) {
        root.setTimeout(function() {
          done(null);
        }, 80);
        return;
      }
      done(null);
      return;
    }
    var entry = pres.undo[pres.undo.length - 1];
    if (entry.closed) {
      pres.undo.pop();
      step();
      return;
    }
    var finishEntry = function() {
      entry.closed = true;
      pres.undo.pop();
      step();
    };
    if (entry.projection) {
      var record2 = entry.projection;
      try {
        root.clearTimeout(record2.seedTimer);
      } catch (error) {
        record2.seedTimer = void 0;
      }
      pres.structureCache = void 0;
      if (!agentProjectionAttached(pres, record2)) {
        if (record2.ios && record2.shown && !record2.dismissed) {
          done("Temporary modal dismissal is unconfirmed after its owner detached.");
          return;
        }
        agentReleaseProjection(pres, record2);
        finishEntry();
        return;
      }
      var restoreChildren = function() {
        var currentProps = record2.root.memoizedProps ? record2.root.memoizedProps : record2.props;
        var restored = {};
        for (var key2 in currentProps) restored[key2] = currentProps[key2];
        restored.children = record2.props.children;
        pres.structureCache = void 0;
        record2.renderer.overrideProps(record2.root, [], restored);
      };
      if (!entry.closing) {
        if (wait2 && record2.ios && record2.shown) {
          var hidden = record2.react.cloneElement(record2.element, { visible: false });
          var siblings = record2.next.children.props.children;
          var swapped = [];
          for (var s = 0; s < siblings.length; s++) {
            swapped.push(siblings[s] === record2.element ? hidden : siblings[s]);
          }
          var children = record2.react.cloneElement.apply(
            record2.react,
            [record2.next.children, {}].concat(swapped)
          );
          var nextProps = {};
          var live = record2.root.memoizedProps ? record2.root.memoizedProps : record2.props;
          for (var liveKey in live) nextProps[liveKey] = live[liveKey];
          nextProps.children = children;
          pres.structureCache = void 0;
          record2.renderer.overrideProps(record2.root, [], nextProps);
        } else restoreChildren();
        entry.closing = true;
      }
      if (wait2 && record2.ios && record2.shown) {
        var dismissStarted = Date.now();
        var poll = function() {
          if (record2.dismissed) {
            restoreChildren();
            agentReleaseProjection(pres, record2);
            finishEntry();
            return;
          }
          if (!agentProjectionAttached(pres, record2)) {
            done("Temporary modal dismissal is unconfirmed after its owner detached.");
            return;
          }
          if (Date.now() - dismissStarted >= 2e3) {
            done("Temporary modal dismissal has not finished.");
            return;
          }
          root.setTimeout(poll, 40);
        };
        poll();
        return;
      }
      agentReleaseProjection(pres, record2);
      finishEntry();
      return;
    }
    if (entry.control) {
      if (!entry.closing) {
        entry.closing = true;
        if (wait2 && entry.openCount === void 0) {
          var openCount = agentVisibleCount(pres);
          if (openCount >= 0) entry.openCount = openCount;
        }
        try {
          entry.control[entry.close]();
        } catch (error) {
          done("The presentation control refused to close.");
          return;
        }
      }
      if (wait2) {
        agentWaitForDismissal(pres, entry, function(error) {
          if (error) {
            done(error);
            return;
          }
          entry.closing = false;
          finishEntry();
        });
        return;
      }
      entry.closing = false;
      finishEntry();
      return;
    }
    if (!entry.closing) {
      var path = entry.path;
      var value = entry.value;
      entry.binding.setter(function(current) {
        return agentSetPath(current, path, value);
      });
      entry.closing = true;
      pres.structureCache = void 0;
    }
    entry.closing = false;
    finishEntry();
  };
  step();
}
function agentPresentationContent(pres, expected) {
  pres.structureCache = void 0;
  var tree = agentPresentationIndex(pres);
  var targets = expected ? tree.names.get(expected) : void 0;
  if (!targets || !targets.length) return { found: false, hosts: 0, visible: 0 };
  var hosts = 0;
  var visible = 0;
  for (var t = 0; t < targets.length; t++) {
    var root = targets[t];
    var stack = [root];
    var seen = 0;
    while (stack.length && seen < 4e3) {
      var fiber = stack.pop();
      seen++;
      if (!fiber) continue;
      if (fiber.tag === 5) {
        hosts++;
        if (tree.isVisible(fiber)) visible++;
      }
      if (fiber.child) stack.push(fiber.child);
      if (fiber !== root && fiber.sibling) stack.push(fiber.sibling);
    }
  }
  return { found: true, hosts, visible };
}
function agentPresentationRollback(pres, level, wait2, done) {
  var started = Date.now();
  var run = function() {
    agentRestorePresentations(pres, level, wait2, function(error) {
      pres.rollbackRunning = false;
      var reply = error ? { ok: false, error, checkpoint: pres.undo.length, elapsedMs: Date.now() - started } : { ok: true, checkpoint: pres.undo.length, elapsedMs: Date.now() - started };
      if (pres.lastDismissEvidence) {
        reply.evidence = pres.lastDismissEvidence;
        pres.lastDismissEvidence = void 0;
      }
      try {
        done(reply);
      } catch (replyError) {
        pres.rollbackRunning = false;
      }
      var next = pres.rollbackQueue.shift();
      if (next) next();
    });
  };
  if (pres.rollbackRunning) {
    pres.rollbackQueue.push(function() {
      pres.rollbackRunning = true;
      run();
    });
    return;
  }
  pres.rollbackRunning = true;
  run();
}
function agentPresentationList(pres) {
  var started = Date.now();
  pres.structureCache = void 0;
  var tree = agentPresentationIndex(pres);
  var available = [];
  var unavailable = 0;
  var rejected = {};
  var aliased = 0;
  var seenStates = /* @__PURE__ */ new Set();
  var seenControls = [];
  var kinds = {};
  for (var at = 0; at < pres.catalog.actions.length && available.length < 200; at++) {
    var action = pres.catalog.actions[at];
    var found = agentResolvePresentationEntry(pres, action, tree);
    if (found.error) {
      unavailable += 1;
      var why = found.reason ? found.reason : "other";
      rejected[why] = (rejected[why] ? rejected[why] : 0) + 1;
      continue;
    }
    if (found.binding && !action.preview) {
      var stateKey = JSON.stringify([action.effect.site, action.effect.path, action.effect.value]);
      if (seenStates.has(stateKey)) {
        aliased += 1;
        continue;
      }
      seenStates.add(stateKey);
    }
    if (found.target && !action.preview) {
      if (seenControls.indexOf(found.target.value) >= 0) {
        aliased += 1;
        continue;
      }
      seenControls.push(found.target.value);
    }
    kinds[action.effect.kind] = (kinds[action.effect.kind] ? kinds[action.effect.kind] : 0) + 1;
    available.push({ id: action.id, kind: action.effect.kind });
  }
  return {
    available,
    unavailable,
    rejected,
    aliased,
    kinds,
    elapsedMs: Date.now() - started
  };
}
function agentCreatePresentations(root, limits, undo) {
  var pres = {
    limits,
    sequence: 0,
    sourceRoot: void 0,
    catalog: { states: [], actions: [] },
    bindings: /* @__PURE__ */ new Map(),
    entries: /* @__PURE__ */ new Map(),
    entryKeys: /* @__PURE__ */ new Map(),
    entrySources: /* @__PURE__ */ new WeakMap(),
    lastDismissEvidence: void 0,
    owners: /* @__PURE__ */ new WeakMap(),
    pendingSites: /* @__PURE__ */ new WeakMap(),
    collecting: /* @__PURE__ */ new Set(),
    patches: [],
    caughtPatches: [],
    projected: [],
    undo: [],
    rollbackQueue: [],
    rollbackRunning: false,
    lastScheduled: 0,
    structureCache: void 0
  };
  pres.renderers = function() {
    var hook = root.__REACT_DEVTOOLS_GLOBAL_HOOK__;
    var found = [];
    try {
      if (hook && hook.renderers && typeof hook.renderers.forEach === "function") {
        hook.renderers.forEach(function(renderer) {
          if (renderer && renderer.rendererPackageName === "react-native-renderer") found.push(renderer);
        });
      }
    } catch (error) {
      return found;
    }
    return found;
  };
  pres.current = function() {
    var renderers = pres.renderers();
    for (var at = 0; at < renderers.length; at++) {
      var renderer = renderers[at];
      if (typeof renderer.getCurrentFiber !== "function") continue;
      var fiber = null;
      try {
        fiber = renderer.getCurrentFiber();
      } catch (error) {
        fiber = null;
      }
      if (fiber) return { fiber, renderer };
    }
    return null;
  };
  undo.push(function() {
    agentUnpatchPresentationHooks(pres);
    agentReleasePreviewErrors(pres, true);
    pres.collecting.clear();
    pres.bindings.clear();
    pres.entries.clear();
    pres.entryKeys.clear();
    pres.projected.length = 0;
    pres.undo.length = 0;
    pres.structureCache = void 0;
  });
  return pres;
}
function agentInstall(key2, leaseMs, limits) {
  var root = globalThis;
  var previous = root[key2];
  if (previous && typeof previous.restore === "function") {
    try {
      previous.restore();
    } catch (error) {
      previous = null;
    }
  }
  if (typeof root.setTimeout !== "function" || typeof root.clearTimeout !== "function") {
    throw new Error("no timers available: refusing to install without a watchdog");
  }
  var lease = typeof leaseMs === "number" && isFinite(leaseMs) && leaseMs > 0 ? leaseMs : 1e4;
  var stopped = false;
  var watchdog = null;
  var undo = [];
  var agent = null;
  var signals = null;
  var presentations = null;
  function restore() {
    if (stopped) return;
    stopped = true;
    try {
      root.clearTimeout(watchdog);
    } catch (error) {
      watchdog = null;
    }
    watchdog = null;
    for (var i = undo.length - 1; i >= 0; i--) {
      try {
        undo[i]();
      } catch (error) {
        continue;
      }
    }
    undo.length = 0;
    try {
      if (root[key2] === agent) delete root[key2];
    } catch (error) {
      try {
        root[key2] = void 0;
      } catch (inner) {
        stopped = true;
      }
    }
  }
  function renewLease() {
    if (stopped) return;
    try {
      root.clearTimeout(watchdog);
      watchdog = root.setTimeout(function() {
        restore();
      }, lease);
    } catch (error) {
      restore();
    }
  }
  function dispatch(command, done) {
    var type = command && command.type;
    if (type === "heartbeat") {
      done({ alive: true });
    } else if (type === "nav-state") {
      done(agentNavState(limits));
    } else if (type === "navigate") {
      done(
        agentNavigate(
          command.route,
          command.params || null,
          limits,
          command.expoPath || null,
          command.candidates || null
        )
      );
    } else if (type === "links") {
      var max = typeof command.max === "number" && isFinite(command.max) && command.max > 0 ? command.max : 200;
      done(agentCollectLinks(limits, max));
    } else if (type === "readiness") {
      var quiet = typeof command.quietMs === "number" && isFinite(command.quietMs) && command.quietMs >= 0 ? command.quietMs : limits.quietMs;
      var idle = typeof command.idleMs === "number" && isFinite(command.idleMs) && command.idleMs >= 0 ? command.idleMs : limits.idleMs;
      agentSettle(
        signals,
        String(command.route),
        command.expectedParams || null,
        limits,
        quiet,
        idle,
        done
      );
    } else if (type === "presentation-setup") {
      presentations.catalog = {
        states: Array.isArray(command.states) ? command.states : [],
        actions: Array.isArray(command.actions) ? command.actions : []
      };
      presentations.sourceRoot = typeof command.projectRoot === "string" ? String(command.projectRoot).split("\\").join("/").replace(/\/$/, "") : void 0;
      agentPresentationCollect(presentations, done);
    } else if (type === "presentation-configure") {
      var configureStarted = Date.now();
      var matches = Array.isArray(command.matches) ? command.matches : [];
      var configured = 0;
      for (var mi = 0; mi < matches.length && mi < 3e3; mi++) {
        var match = matches[mi];
        if (!match || typeof match.binding !== "string" || typeof match.site !== "string") continue;
        var target2 = presentations.bindings.get(String(match.binding));
        if (target2) {
          target2.site = String(match.site);
          configured += 1;
          continue;
        }
        var entryRecord = presentations.entries.get(String(match.binding));
        if (entryRecord) {
          entryRecord.actions.add(String(match.site));
          configured += 1;
        }
      }
      var checkedIds = Array.isArray(command.checked) ? command.checked : [];
      for (var ci = 0; ci < checkedIds.length && ci < 3e3; ci++) {
        var checkedRecord = presentations.bindings.get(String(checkedIds[ci])) || presentations.entries.get(String(checkedIds[ci]));
        if (checkedRecord) checkedRecord.checked = true;
      }
      presentations.structureCache = void 0;
      done({ ok: true, configured, elapsedMs: Date.now() - configureStarted });
    } else if (type === "presentations") {
      done(agentPresentationList(presentations));
    } else if (type === "presentation-open") {
      done(agentPresentationOpen(presentations, String(command.id), null));
    } else if (type === "presentation-content") {
      done(agentPresentationContent(presentations, String(command.expected)));
    } else if (type === "presentation-rollback") {
      var level = typeof command.level === "number" && isFinite(command.level) && command.level >= 0 ? command.level : 0;
      agentPresentationRollback(presentations, level, command.wait !== false, done);
    } else {
      done({ error: "unknown-command" });
    }
  }
  agent = {
    invoke: function(commandJson, reply) {
      var replied = false;
      var once = function(value) {
        if (replied) return;
        replied = true;
        try {
          reply(value);
        } catch (error) {
          replied = true;
        }
      };
      var command;
      try {
        command = JSON.parse(commandJson);
      } catch (error) {
        once({ error: "invalid-command" });
        return;
      }
      if (command && command.type === "restore") {
        restore();
        once({ restored: true });
        return;
      }
      if (stopped) {
        once({ stopped: true });
        return;
      }
      renewLease();
      if (stopped) {
        once({ stopped: true });
        return;
      }
      try {
        dispatch(command, once);
      } catch (error) {
        once({
          error: "command-failed",
          detail: String(error && error.message).slice(0, 200)
        });
      }
    },
    restore
  };
  renewLease();
  if (stopped) throw new Error("could not arm the lease watchdog");
  try {
    signals = agentCreateSignals(root, undo, restore);
    presentations = agentCreatePresentations(root, limits, undo);
    root[key2] = agent;
  } catch (error) {
    restore();
    throw error;
  }
}
var AGENT_FUNCTIONS = {
  agentCollectFiberRoots,
  agentFindNavigator,
  agentFlattenRoutes,
  agentNavState,
  agentRoutablePath,
  agentLinkCandidate,
  agentCollectLinks,
  agentResolveRoutePath,
  agentNavigate,
  agentStyleFlags,
  agentHidden,
  agentComponentName,
  agentReadiness,
  agentPatchProperty,
  agentCreateSignals,
  agentVerdict,
  agentSettle,
  agentOpeningControl,
  agentControlCloser,
  agentSetPath,
  agentActiveAncestors,
  agentFocusedScope,
  agentOwnedBy,
  agentListOf,
  agentVisibleCount,
  agentPresentationIndex,
  agentHookValue,
  agentCollectionTargets,
  agentMutableReact,
  agentPatchPresentationHooks,
  agentUnpatchPresentationHooks,
  agentHookWrapper,
  agentRegisterHook,
  agentPresentationCollect,
  agentAttributeBindings,
  agentRegisterEntries,
  agentResolvePresentationEntry,
  agentResolveOpener,
  agentResolveStateEntry,
  agentCondition,
  agentResolveControlEntry,
  agentMountedExport,
  agentProjectionRoot,
  agentWindowRect,
  agentBodyFrame,
  agentModalCarryOver,
  agentCopiesLiveNavigation,
  agentContainPreviewErrors,
  agentReleasePreviewErrors,
  agentSeedDeadline,
  agentProject,
  agentProjectionAttached,
  agentReleaseProjection,
  agentPresentationOpen,
  agentWaitForDismissal,
  agentRestorePresentations,
  agentMountBody,
  agentPresentationContent,
  agentPresentationRollback,
  agentPresentationList,
  agentCreatePresentations,
  agentInstall
};

// packages/core/src/app-flow/cdp/discovery.ts
var DISCOVERY_TIMEOUT_MS = 5e3;
var MAX_DISCOVERY_BODY_BYTES = 1024 * 1024;
var MAX_DISCOVERY_TARGETS = 100;
var MAX_FIELD_LENGTH = 512;
var LOOPBACK_HOSTS = /* @__PURE__ */ new Set(["127.0.0.1", "localhost", "[::1]"]);
var asString = (value) => typeof value === "string" ? value.slice(0, MAX_FIELD_LENGTH) : void 0;
function validateDebuggerUrl(raw, metroPort) {
  let url;
  try {
    url = new URL(raw, `http://127.0.0.1:${metroPort}`);
  } catch {
    return null;
  }
  if (url.protocol !== "ws:") return null;
  if (!LOOPBACK_HOSTS.has(url.hostname)) return null;
  if (url.username || url.password || url.hash) return null;
  if (Number(url.port || 80) !== metroPort) return null;
  return url.href;
}
async function readCappedText(response, maxBytes) {
  const tooLarge = () => new Error("Metro returned too much data for its target list.");
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw tooLarge();
  if (!response.body) {
    const text3 = await response.text();
    if (Buffer.byteLength(text3) > maxBytes) throw tooLarge();
    return text3;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text2 = "";
  for (; ; ) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel().catch(() => void 0);
      throw tooLarge();
    }
    text2 += decoder.decode(value, { stream: true });
  }
  return text2 + decoder.decode();
}
async function listMetroTargets(metroPort, options = {}) {
  const { signal, fetchImpl = fetch, timeoutMs = DISCOVERY_TIMEOUT_MS } = options;
  const origin2 = `http://127.0.0.1:${metroPort}`;
  const timeout = AbortSignal.timeout(timeoutMs);
  let response;
  try {
    response = await fetchImpl(`${origin2}/json/list`, {
      // A redirect is a different server answering; following it would defeat the port check.
      redirect: "error",
      signal: signal ? AbortSignal.any([timeout, signal]) : timeout
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error(`Cannot reach Metro at ${origin2}.`, { cause: error });
  }
  if (!response.ok) throw new Error(`Metro returned HTTP ${response.status}.`);
  const body = await readCappedText(response, MAX_DISCOVERY_BODY_BYTES);
  let payload;
  try {
    payload = JSON.parse(body);
  } catch (error) {
    throw new Error("Metro returned a target list that is not valid JSON.", { cause: error });
  }
  if (!Array.isArray(payload)) throw new Error("Metro returned an invalid target list.");
  const targets = [];
  for (const item of payload.slice(0, MAX_DISCOVERY_TARGETS)) {
    if (typeof item !== "object" || item === null) continue;
    const record2 = item;
    if (typeof record2.id !== "string" || typeof record2.webSocketDebuggerUrl !== "string") continue;
    const webSocketDebuggerUrl = validateDebuggerUrl(record2.webSocketDebuggerUrl, metroPort);
    if (!webSocketDebuggerUrl) continue;
    const reactNative = record2.reactNative ?? {};
    targets.push({
      id: record2.id,
      title: asString(record2.title) ?? record2.id,
      appId: asString(record2.appId),
      deviceName: asString(record2.deviceName),
      deviceId: asString(reactNative.logicalDeviceId),
      webSocketDebuggerUrl,
      supportsMultipleDebuggers: reactNative.capabilities?.supportsMultipleDebuggers === true
    });
  }
  return targets;
}
var normalizeDeviceName = (name2) => name2.toLowerCase().replace(/[^a-z\d]/g, "");
function reidentifyTarget(targets, previousId, previous) {
  if (!previous) return targets.find((target2) => target2.id === previousId);
  const matches = targets.filter((target2) => {
    const sameApp = previous.appId ? target2.appId === previous.appId : target2.id === previousId && !target2.appId;
    const sameDevice = previous.deviceId !== void 0 && target2.deviceId === previous.deviceId || previous.deviceName !== void 0 && target2.deviceName !== void 0 && normalizeDeviceName(target2.deviceName) === normalizeDeviceName(previous.deviceName);
    return sameApp && sameDevice;
  });
  const exact = matches.find((target2) => target2.id === previousId);
  return exact ?? (matches.length === 1 ? matches[0] : void 0);
}

// packages/core/src/app-flow/cdp/runtime-source.ts
var EXPECTED_AGENT_FUNCTION_COUNT = 62;
var MAX_AGENT_SOURCE_BYTES = 256 * 1024;
var BANNED_SYNTAX = [
  ["async function", /\basync\b/],
  ["await", /\bawait\b/],
  ["nullish coalescing", /\?\?/]
];
var AgentSourceError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "AgentSourceError";
  }
};
function assertAgentSourceIntegrity(functions, source, expectedCount = EXPECTED_AGENT_FUNCTION_COUNT) {
  const names = Object.keys(functions);
  if (names.length !== expectedCount) {
    throw new AgentSourceError(
      `agent has ${names.length} functions, expected ${expectedCount}; update EXPECTED_AGENT_FUNCTION_COUNT with the registry`
    );
  }
  for (const name2 of names) {
    if (functions[name2].name !== name2) {
      throw new AgentSourceError(
        `agent function "${name2}" was renamed to "${functions[name2].name}" by the build; injected functions call each other by name`
      );
    }
  }
  if (Buffer.byteLength(source, "utf8") > MAX_AGENT_SOURCE_BYTES) {
    throw new AgentSourceError(`agent source exceeds ${MAX_AGENT_SOURCE_BYTES} bytes`);
  }
  for (const [label, pattern] of BANNED_SYNTAX) {
    const hit = pattern.exec(source);
    if (hit) {
      throw new AgentSourceError(
        `agent source contains ${label}, near "${source.slice(Math.max(0, hit.index - 20), hit.index + 30).replace(/\s+/g, " ")}"; the Hermes debugger evaluator runs this text as written, so write the ES2015-or-below form instead`
      );
    }
  }
}
function checkDeclaration(name2, text2) {
  const code = text2.trim();
  if (!new RegExp(`(^|[^\\w$])function\\s+${name2}\\s*\\(`).test(code)) {
    throw new AgentSourceError(
      `agent function "${name2}" is not a top-level declaration; injected functions call each other by name`
    );
  }
  return code;
}
function buildAgentSource(functions = AGENT_FUNCTIONS) {
  const declarations = Object.entries(functions).map(([name2, fn]) => checkDeclaration(name2, fn.toString())).join("\n");
  const source = `(function () {
${declarations}
return agentInstall;
})()`;
  assertAgentSourceIntegrity(functions, source, Object.keys(functions).length);
  return source;
}
var cached;
function agentSource() {
  if (cached === void 0) {
    const source = buildAgentSource();
    assertAgentSourceIntegrity(AGENT_FUNCTIONS, source);
    cached = source;
  }
  return cached;
}

// packages/core/src/app-flow/cdp/connection.ts
var CdpError = class extends Error {
  kind;
  constructor(kind, message) {
    super(message);
    this.name = new.target.name;
    this.kind = kind;
  }
};
var CdpTimeoutError = class extends CdpError {
  operation;
  timeoutMs;
  constructor(operation, timeoutMs) {
    super("timeout", `${operation} did not complete within ${timeoutMs}ms`);
    this.operation = operation;
    this.timeoutMs = timeoutMs;
  }
};
var CommandExpiredError = class extends CdpError {
  operation;
  constructor(operation) {
    super("command-expired", `${operation} reached the app after its deadline and was not run`);
    this.operation = operation;
  }
};
var RuntimeUnavailableError = class extends CdpError {
  operation;
  constructor(operation) {
    super("runtime-unavailable", `${operation}: the in-app agent is not installed`);
    this.operation = operation;
  }
};
var CdpEvaluationError = class extends CdpError {
  operation;
  detail;
  constructor(operation, detail) {
    super(
      "evaluation-failed",
      `${operation} was rejected by the runtime${detail ? `: ${detail}` : ""}`
    );
    this.operation = operation;
    this.detail = detail;
  }
};
var CdpConnectionLostError = class extends CdpError {
  reason;
  constructor(reason) {
    super("connection-lost", `the debugger connection was lost (${reason})`);
    this.reason = reason;
  }
};
var HANDSHAKE_TIMEOUT_MS = 2e3;
var INSTALL_TIMEOUT_MS = 5e3;
var DEFAULT_COMMAND_TIMEOUT_MS = 1500;
var HEARTBEAT_INTERVAL_MS = 2e3;
var HEARTBEAT_COMMAND_TIMEOUT_MS = 2500;
var HEARTBEAT_RECENT_REPLY_MS = 1500;
var HEARTBEAT_FAILURE_LIMIT = 3;
var RESTORE_TIMEOUT_MS = 5e3;
var TEARDOWN_FLUSH_MS = 500;
var SOCKET_HANDSHAKE_TIMEOUT_MS = 3e3;
var SOCKET_MAX_PAYLOAD_BYTES = 2 * 1024 * 1024;
var KEY_PREFIX = "__aiHarnessCdp_";
function reconnectBackoffMs(attempt) {
  return Math.min(500 * 2 ** Math.min(Math.max(attempt, 1) - 1, 4), 5e3);
}
function escapeSurrogates(source) {
  return source.replace(
    /[\ud800-\udfff]/g,
    (unit) => `\\u${unit.charCodeAt(0).toString(16).padStart(4, "0")}`
  );
}
var wellFormed = (_key, value) => typeof value === "string" ? escapeSurrogates(value) : value;
var APP_CLOCK_EXPR = "(typeof performance!=='undefined'&&performance&&typeof performance.now==='function'?performance.now():Date.now())";
var defaultSocketFactory = (url, options) => new import_websocket.default(url, options);
var OPEN = 1;
var CdpLink = class {
  socket;
  key;
  binding;
  leaseMs;
  limits;
  now;
  heartbeatIntervalMs;
  heartbeatRecentReplyMs;
  heartbeatTimeoutMs;
  onLost;
  pending = /* @__PURE__ */ new Map();
  /** ONE counter for both id kinds: positive for CDP calls, negated for app commands. */
  sequence = 0;
  dead = false;
  closing;
  heartbeat;
  heartbeatInFlight = false;
  heartbeatFailures = 0;
  lastReply = Number.NEGATIVE_INFINITY;
  appClockOffset;
  /** Resolves once the handshake has installed the agent; rejects if any step fails. */
  ready;
  constructor(url, options = {}) {
    this.key = options.key ?? `${KEY_PREFIX}${randomUUID2().replaceAll("-", "")}`;
    this.binding = `${this.key}_reply_${randomUUID2().replaceAll("-", "")}`;
    this.leaseMs = options.leaseMs ?? AGENT_LEASE_MS;
    this.limits = options.limits ?? DEFAULT_AGENT_LIMITS;
    this.now = options.now ?? (() => performance.now());
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS;
    this.heartbeatRecentReplyMs = options.heartbeatRecentReplyMs ?? HEARTBEAT_RECENT_REPLY_MS;
    this.heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? HEARTBEAT_COMMAND_TIMEOUT_MS;
    this.onLost = options.onLost;
    const origin2 = new URL(url);
    origin2.protocol = "http:";
    this.socket = (options.createSocket ?? defaultSocketFactory)(url, {
      origin: origin2.origin,
      handshakeTimeout: SOCKET_HANDSHAKE_TIMEOUT_MS,
      maxPayload: SOCKET_MAX_PAYLOAD_BYTES,
      followRedirects: false
    });
    const opened = new Promise((resolve3, reject) => {
      this.socket.once("open", () => resolve3());
      this.socket.once("error", () => reject(new CdpConnectionLostError("socket")));
      this.socket.once("close", () => reject(new CdpConnectionLostError("socket")));
    });
    this.socket.on("message", (data) => this.onMessage(data.toString()));
    this.socket.on("error", () => this.fail(new CdpConnectionLostError("socket")));
    this.socket.on("close", () => this.fail(new CdpConnectionLostError("socket")));
    this.ready = opened.then(() => this.install());
    this.ready.catch(() => void 0);
  }
  async install() {
    await this.send("Runtime.enable", {}, HANDSHAKE_TIMEOUT_MS, "runtime-enable");
    await this.send(
      "Runtime.addBinding",
      { name: this.binding },
      HANDSHAKE_TIMEOUT_MS,
      "add-binding"
    );
    const keyPrefix = `${this.key}_reply_`;
    const expression2 = `(function(){var __name=function(value){return value};var names=Object.keys(globalThis);for(var i=0;i<names.length;i++){if(names[i].indexOf(${JSON.stringify(keyPrefix)})===0&&names[i]!==${JSON.stringify(this.binding)}){try{delete globalThis[names[i]]}catch(error){}}}(${agentSource()})(${JSON.stringify(this.key)},${this.leaseMs},${JSON.stringify(this.limits)});return {clock:${APP_CLOCK_EXPR}}})()`;
    const installStarted = this.now();
    const installed = await this.send(
      "Runtime.evaluate",
      { expression: expression2, silent: true, returnByValue: true, objectGroup: this.key },
      INSTALL_TIMEOUT_MS,
      "install"
    );
    const appClock = installed?.result?.value?.clock;
    if (typeof appClock === "number" && Number.isFinite(appClock)) {
      this.appClockOffset = appClock - installStarted;
    }
    if (this.dead || this.closing) return;
    this.heartbeat = setInterval(() => this.beat(), this.heartbeatIntervalMs);
    this.heartbeat.unref();
  }
  /**
   * Skipped when one is already in flight, or when a real reply landed recently: every command
   * renews the app's lease, so a recent reply is proof of life and a heartbeat queued behind real
   * work would only add a traversal's worth of latency to it. Three failures in a row with no reply
   * in between closes the link; a reply that arrives while a heartbeat is outstanding clears the
   * count, which is why failure is judged against when the heartbeat was *sent*.
   */
  beat() {
    if (this.heartbeatInFlight || this.now() - this.lastReply < this.heartbeatRecentReplyMs) return;
    this.heartbeatInFlight = true;
    const sentAt = this.now();
    this.invoke({ type: "heartbeat" }, this.heartbeatTimeoutMs).catch(() => {
      if (this.lastReply < sentAt && ++this.heartbeatFailures >= HEARTBEAT_FAILURE_LIMIT) {
        this.fail(new CdpConnectionLostError("heartbeat"));
      }
    }).finally(() => {
      this.heartbeatInFlight = false;
    });
  }
  onMessage(text2) {
    let message;
    try {
      message = JSON.parse(text2);
    } catch {
      this.fail(new CdpConnectionLostError("socket"));
      return;
    }
    if (message.method === "Runtime.executionContextsCleared" || message.method === "Runtime.executionContextDestroyed") {
      this.fail(new CdpConnectionLostError("reload"));
      return;
    }
    if (message.method === "Runtime.bindingCalled") {
      if (message.params?.name !== this.binding) return;
      let value;
      try {
        value = JSON.parse(message.params.payload ?? "");
      } catch {
        return;
      }
      if (typeof value.id === "number") this.settleReply(value.id, value.result);
      return;
    }
    if (typeof message.id !== "number" || message.id === 0) return;
    const details = message.result?.exceptionDetails;
    if (message.error || details) {
      const detail = details?.exception?.description ?? details?.text ?? message.error?.message;
      const operation = this.pending.get(message.id)?.operation ?? "other";
      this.finish(message.id, void 0, new CdpEvaluationError(operation, detail));
      return;
    }
    if (message.id > 0) this.finish(message.id, message.result);
  }
  settleReply(id2, result) {
    const pending = this.pending.get(id2);
    if (!pending) return;
    const reply = result;
    if (reply && reply.runtimeUnavailable) {
      this.finish(id2, void 0, new RuntimeUnavailableError(pending.operation));
      this.fail(new CdpConnectionLostError("runtime-unavailable"));
      return;
    }
    this.lastReply = this.now();
    this.heartbeatFailures = 0;
    if (reply && reply.commandExpired) {
      this.finish(id2, void 0, new CommandExpiredError(pending.operation));
      return;
    }
    this.finish(id2, result);
  }
  finish(id2, value, error) {
    const pending = this.pending.get(id2);
    if (!pending) return;
    this.pending.delete(id2);
    clearTimeout(pending.timer);
    if (error) pending.reject(error);
    else pending.resolve(value);
  }
  /** Marks the link dead, fails everything pending, and tells the owner, exactly once. */
  fail(error) {
    if (this.dead) return;
    this.dead = true;
    clearInterval(this.heartbeat);
    for (const id2 of [...this.pending.keys()]) this.finish(id2, void 0, error);
    if (!this.closing) {
      this.socket.terminate();
      this.onLost?.(error);
    }
  }
  send(method2, params, timeoutMs, operation, id2 = ++this.sequence) {
    if (this.dead || this.socket.readyState !== OPEN) {
      return Promise.reject(new CdpConnectionLostError(this.dead ? "closed" : "socket"));
    }
    return new Promise((resolve3, reject) => {
      const timer = setTimeout(
        () => this.finish(id2, void 0, new CdpTimeoutError(operation, timeoutMs)),
        timeoutMs
      );
      this.pending.set(id2, { resolve: resolve3, reject, timer, operation });
      const safe = method2 === "Runtime.evaluate" && typeof params.expression === "string" ? {
        ...params,
        expression: escapeSurrogates(params.expression)
      } : params;
      this.socket.send(JSON.stringify({ id: id2, method: method2, params: safe }), (error) => {
        if (error) this.finish(id2, void 0, new CdpConnectionLostError("socket"));
      });
    });
  }
  /**
   * Runs one agent command. Resolves with the agent's reply, or rejects with a typed `CdpError`.
   * `timeoutMs` bounds both the host's wait and, through the embedded deadline, the app's willingness
   * to start the command at all.
   */
  async invoke(command, timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS) {
    await this.ready;
    const id2 = -++this.sequence;
    const deadline = this.appClockOffset === void 0 || command.type === "restore" ? void 0 : this.now() + timeoutMs + this.appClockOffset;
    const reply = `var reply=function(result){var send=globalThis[${JSON.stringify(this.binding)}];if(typeof send==='function')send(JSON.stringify({id:${id2},result:result===undefined?null:result}))};`;
    const expression2 = `(function(){var runtime=globalThis[${JSON.stringify(this.key)}];${reply}` + (deadline === void 0 ? "" : `if(${APP_CLOCK_EXPR}>${deadline}){reply({commandExpired:true});return}`) + `if(!runtime||typeof runtime.invoke!=='function'){reply({runtimeUnavailable:true});return}runtime.invoke(${JSON.stringify(JSON.stringify(command, wellFormed))},reply)})()`;
    const result = await this.send(
      "Runtime.evaluate",
      { expression: expression2, silent: true, returnByValue: true, objectGroup: this.key },
      timeoutMs,
      command.type,
      id2
    );
    if (command.type === "heartbeat" && result?.alive !== true) {
      throw new CdpEvaluationError("heartbeat", "invalid response");
    }
    return result;
  }
  /**
   * Idempotent teardown, in this order: stop the heartbeat; ask the agent to restore itself
   * (best effort, bounded; the lease restores it anyway if this fails); remove the binding, delete
   * its global, release the object group; fail whatever is still pending; terminate the socket.
   * Every call after the first returns the first's promise.
   */
  close(options = {}) {
    return this.closing ??= this.dispose(options.restore !== false);
  }
  async dispose(restore) {
    clearInterval(this.heartbeat);
    if (restore && !this.dead && this.socket.readyState === OPEN) {
      let timer;
      try {
        await Promise.race([
          this.ready.then(() => this.invoke({ type: "restore" }, RESTORE_TIMEOUT_MS)),
          new Promise((resolve3) => {
            timer = setTimeout(resolve3, RESTORE_TIMEOUT_MS + 500);
          })
        ]);
      } catch {
      } finally {
        clearTimeout(timer);
      }
    }
    if (this.socket.readyState === OPEN) {
      const writes = [
        { method: "Runtime.removeBinding", params: { name: this.binding } },
        {
          method: "Runtime.evaluate",
          params: {
            expression: `delete globalThis[${JSON.stringify(this.binding)}]`,
            silent: true,
            returnByValue: true
          }
        },
        { method: "Runtime.releaseObjectGroup", params: { objectGroup: this.key } }
      ].map(
        (call) => new Promise((resolve3) => {
          try {
            this.socket.send(JSON.stringify({ id: ++this.sequence, ...call }), () => resolve3());
          } catch {
            resolve3();
          }
        })
      );
      let flush;
      await Promise.race([
        Promise.all(writes),
        new Promise((resolve3) => {
          flush = setTimeout(resolve3, TEARDOWN_FLUSH_MS);
        })
      ]);
      clearTimeout(flush);
    }
    this.fail(new CdpConnectionLostError("closed"));
    this.socket.terminate();
  }
};
function createTargetResolver(metroPort, initial, options = {}) {
  const list = options.list ?? listMetroTargets;
  let current = initial;
  return async () => {
    const targets = await list(metroPort);
    const match = reidentifyTarget(targets, current.id, current);
    if (!match) throw new Error(`no Metro target matches the app on port ${metroPort}`);
    current = match;
    return match;
  };
}
var defaultSleep = (ms) => new Promise((resolve3) => setTimeout(resolve3, ms));
var CdpConnection = class {
  link;
  recovery;
  currentState = "idle";
  key;
  sleep;
  backoffMs;
  maxAttempts;
  options;
  constructor(options) {
    this.options = options;
    this.key = `${KEY_PREFIX}${(options.sessionId ?? randomUUID2()).replaceAll("-", "")}`;
    this.sleep = options.sleep ?? defaultSleep;
    this.backoffMs = options.backoffMs ?? reconnectBackoffMs;
    this.maxAttempts = options.maxReconnectAttempts ?? 10;
  }
  get state() {
    return this.currentState;
  }
  setState(state) {
    if (this.currentState === state) return;
    this.currentState = state;
    this.options.onStateChange?.(state);
  }
  /** The first connection. One attempt, and it throws: whether to carry on without us is the caller's call. */
  async connect() {
    if (this.currentState !== "idle")
      throw new Error(`cannot connect from state ${this.currentState}`);
    this.setState("connecting");
    try {
      await this.openLink();
      this.setState("ready");
    } catch (error) {
      if (this.currentState !== "closed") this.setState("idle");
      throw error;
    }
  }
  async openLink() {
    const target2 = await this.options.resolveTarget();
    const link = new CdpLink(target2.webSocketDebuggerUrl, {
      key: this.key,
      leaseMs: this.options.leaseMs,
      limits: this.options.limits,
      createSocket: this.options.createSocket,
      heartbeatIntervalMs: this.options.heartbeatIntervalMs,
      heartbeatRecentReplyMs: this.options.heartbeatRecentReplyMs,
      heartbeatTimeoutMs: this.options.heartbeatTimeoutMs,
      onLost: (error) => {
        if (this.link === link && this.currentState === "ready") this.recover(error);
      }
    });
    try {
      await link.ready;
    } catch (error) {
      await link.close({ restore: false }).catch(() => void 0);
      throw error;
    }
    if (this.currentState === "closed") {
      await link.close();
      throw new CdpConnectionLostError("closed");
    }
    this.link = link;
  }
  recover(cause) {
    if (this.recovery || this.currentState === "closed") return;
    this.options.log?.(`link lost (${cause.reason}); reconnecting`);
    this.recovery = this.runRecovery().finally(() => {
      this.recovery = void 0;
    });
    this.recovery.catch(() => void 0);
  }
  async runRecovery() {
    this.setState("reconnecting");
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      await this.sleep(this.backoffMs(attempt));
      if (this.currentState === "closed") throw new CdpConnectionLostError("closed");
      try {
        await this.openLink();
        this.setState("ready");
        return;
      } catch (error) {
        this.options.log?.(
          `reconnect attempt ${attempt}/${this.maxAttempts} failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
    this.setState("failed");
    throw new CdpConnectionLostError("exhausted");
  }
  /**
   * Replaces the link now, from any state but `closed`. Used after `failed`, or by a caller that
   * knows it just relaunched the app and does not want to wait for the heartbeat to notice.
   * Resolves when a fresh link is installed; rejects with `CdpConnectionLostError('exhausted')`.
   */
  async reconnect() {
    if (this.currentState === "closed") throw new CdpConnectionLostError("closed");
    if (this.recovery) return this.recovery;
    const old = this.link;
    this.link = void 0;
    if (old) await old.close({ restore: false }).catch(() => void 0);
    this.recover(new CdpConnectionLostError("reconnecting"));
    return this.recovery;
  }
  /**
   * Runs one agent command. While a reconnect is in progress it waits for it, up to `timeoutMs`
   * from now, rather than failing; a command already in flight when the link died has been rejected
   * and is never replayed. See the file doc.
   */
  async invoke(command, timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS) {
    if (this.currentState === "closed") throw new CdpConnectionLostError("closed");
    if (this.currentState === "failed") throw new CdpConnectionLostError("exhausted");
    if (this.recovery) {
      let timer;
      try {
        await Promise.race([
          this.recovery,
          new Promise((_resolve, reject) => {
            timer = setTimeout(() => reject(new CdpConnectionLostError("reconnecting")), timeoutMs);
          })
        ]);
      } finally {
        clearTimeout(timer);
      }
    }
    if (!this.link) throw new CdpConnectionLostError("socket");
    return this.link.invoke(command, timeoutMs);
  }
  /** Tears the link down (restoring the app) and stops any recovery. Idempotent. */
  async close() {
    if (this.currentState === "closed") return;
    this.setState("closed");
    const link = this.link;
    this.link = void 0;
    await link?.close();
  }
};

// packages/core/src/app-flow/runtime-telemetry.ts
function telemetryEnabled() {
  return process.env.MOBILE_DEV_TELEMETRY !== "off";
}
function baseAttributes(attributes2) {
  return { surface: "app-flow", device_platform: "ios", ...attributes2 };
}
function recordRuntimeTiming(name2, durationMs, attributes2 = {}) {
  if (!telemetryEnabled()) return;
  public_api_exports.distribution(name2, Math.max(0, durationMs), {
    unit: "millisecond",
    attributes: baseAttributes(attributes2)
  });
}
function recordRuntimeCount(name2, attributes2 = {}) {
  if (!telemetryEnabled()) return;
  public_api_exports.count(name2, 1, { attributes: baseAttributes(attributes2) });
}
function recordRuntimeAmount(name2, value, attributes2 = {}) {
  if (!telemetryEnabled()) return;
  if (!Number.isFinite(value)) return;
  public_api_exports.count(name2, Math.max(0, Math.round(value)), { attributes: baseAttributes(attributes2) });
}

// packages/core/src/app-flow/cdp/app-runtime-transport.ts
var COMMAND_TIMEOUT_MS = 5e3;
function describeTransportFailure(error) {
  const raw = (error instanceof Error ? error.message : String(error)).trim();
  const scrubbed = raw.replace(/(?:\/[\w.@~-]+){2,}/g, "<path>").replace(/\s+/g, " ").trim();
  if (!scrubbed) return "The runtime handshake failed without a message.";
  return scrubbed.length > 200 ? `${scrubbed.slice(0, 197)}...` : scrubbed;
}
function createAppRuntimeTransport(options) {
  const label = options.logLabel ?? "[app-flow]";
  let connection = null;
  let target2 = null;
  let unavailable = false;
  let unavailableReason = "";
  const timing = (name2, started, attributes2 = {}) => {
    recordRuntimeTiming(name2, performance.now() - started, attributes2);
  };
  const transport = {
    async ready() {
      if (connection?.state === "ready") return { ok: true };
      if (unavailable) return { ok: false, reason: unavailableReason };
      const started = performance.now();
      try {
        const targets = await listMetroTargets(options.metroPort, { signal: options.signal });
        const normalize = (value) => (value ?? "").toLowerCase().replace(/[^a-z\d]/g, "");
        const app = normalize(options.appName);
        const candidates = targets.filter((entry) => entry.supportsMultipleDebuggers);
        const deviceCandidates = candidates.filter(
          (entry) => entry.deviceId === options.deviceId || !!entry.deviceName && normalize(entry.deviceName) === normalize(options.deviceName ?? null)
        );
        target2 = deviceCandidates.find(
          (entry) => !app || normalize(entry.title) === app || normalize(entry.appId) === app
        ) ?? (deviceCandidates.length === 1 ? deviceCandidates[0] : null);
        if (!target2) throw new Error("No unambiguous Metro runtime supports Fast capture.");
        connection = new CdpConnection({
          resolveTarget: createTargetResolver(options.metroPort, target2),
          sessionId: options.sessionId,
          log: (message) => console.log(`${label} fast runtime \u2014 ${message}`),
          onStateChange: (state) => {
            recordRuntimeCount("app_flow.runtime.state", { state });
          }
        });
        await connection.connect();
        options.onAvailability?.("ready");
        return { ok: true };
      } catch (error) {
        unavailable = true;
        unavailableReason = describeTransportFailure(error);
        options.onAvailability?.("unavailable");
        console.log(`${label} fast runtime unavailable \u2014 ${unavailableReason}`);
        return { ok: false, reason: unavailableReason };
      } finally {
        timing("app_flow.runtime.connect", started, {
          outcome: connection?.state === "ready" ? "ready" : "unavailable"
        });
      }
    },
    async navigate(route, params, expoPath, candidates) {
      const started = performance.now();
      try {
        return await connection.invoke(
          { type: "navigate", route, params, expoPath, candidates },
          COMMAND_TIMEOUT_MS
        );
      } finally {
        timing("app_flow.runtime.command", started, { operation: "navigate" });
      }
    },
    async readiness(route, params) {
      const started = performance.now();
      try {
        return await connection.invoke(
          { type: "readiness", route, expectedParams: params },
          COMMAND_TIMEOUT_MS
        );
      } finally {
        timing("app_flow.runtime.command", started, { operation: "readiness" });
      }
    },
    // Same `app_flow.runtime.command` wrapper, name, unit and attribute shape as its two siblings
    // above, deliberately: the whole point of reading nav-state here is that it replaces a CLI
    // subprocess, and the only way that saving stays legible across releases is if the fast read
    // is billed to the same meter under a new `operation`.
    async navState() {
      const started = performance.now();
      try {
        const reply = await connection.invoke(
          { type: "nav-state" },
          COMMAND_TIMEOUT_MS
        );
        return reply?.routes ?? null;
      } finally {
        timing("app_flow.runtime.command", started, { operation: "nav-state" });
      }
    },
    async close() {
      await connection?.close();
      connection = null;
    }
  };
  return {
    transport,
    get connection() {
      return connection;
    },
    get state() {
      return connection?.state ?? "idle";
    },
    /**
     * A structured command the caller composes itself (the sweep's `links` read), billed to the
     * same `app_flow.runtime.command` meter as the three the transport issues, under the
     * command's own `type` as `operation`. The raw `connection` stays unmetered: the UI-state
     * session drives it in bursts, and one span per burst command is the per-frame noise the
     * telemetry rules rule out.
     */
    async invoke(command, timeoutMs = COMMAND_TIMEOUT_MS) {
      const started = performance.now();
      try {
        return await connection.invoke(command, timeoutMs);
      } finally {
        timing("app_flow.runtime.command", started, { operation: command.type });
      }
    },
    close() {
      return transport.close();
    }
  };
}

// packages/core/src/app-flow/nav-route-target.ts
var routeAnswersTo = (node, routeName) => node.id === routeName || node.id.split("/").pop() === routeName;
var answersTo = routeAnswersTo;
function resolveNavRouteTarget(nodes, routeName) {
  const direct = nodes.filter((node) => node.params.length > 0 && answersTo(node, routeName));
  if (direct.length) return direct.length === 1 ? direct[0] : null;
  const named = nodes.filter((node) => answersTo(node, routeName));
  if (named.length !== 1 || !named[0].file) return null;
  const sharing = nodes.filter(
    (node) => node !== named[0] && node.file === named[0].file && node.params.length > 0
  );
  return sharing.length === 1 ? sharing[0] : null;
}

// packages/core/src/app-flow/explore-ui.ts
var EXPLORE_UI_ROLLBACK_TIMEOUT_MS = 8e3;
var EXPLORE_UI_SWEEP_LIMIT = 10;
var REFUSAL_REASONS = /* @__PURE__ */ new Set([
  "unbound",
  "not-in-view",
  "disabled",
  "no-owner",
  "ambiguous-owner",
  "no-control",
  "ambiguous-control",
  "not-loaded",
  "unsupported",
  "no-binding",
  "ambiguous-binding",
  "ambiguous-callback",
  "unmet-condition",
  "already-open",
  // The reference's two `mountedExport` guards, and its readiness reasons for a projection that
  // mounted nothing (`target`) or drew nothing (`empty`).
  "owner-mismatch",
  "already-mounted",
  "target",
  "empty"
]);
function refusalReason(reason) {
  return reason !== void 0 && REFUSAL_REASONS.has(reason) ? reason : "other";
}
function rollbackFailureCategory(error) {
  if (!error) return "unknown";
  if (/has not finished/i.test(error)) return "dismissal-timeout";
  if (/unconfirmed/i.test(error)) return "dismissal-unconfirmed";
  if (/refused to close/i.test(error)) return "close-refused";
  if (/rollback failed|timed out|timeout/i.test(error)) return "transport";
  return "other";
}
function passFailureCategory(stage, error) {
  if (stage === "open") return "pass-failed";
  return `${stage}-${/did not complete within|timed out|timeout/i.test(error) ? "timeout" : "failed"}`;
}
function aborted(signal) {
  return signal?.aborted === true;
}
function uiStateSlug(nodeSlug, actionId, used) {
  const base = `${nodeSlug}--state-${actionId}`.replace(/[^a-zA-Z0-9]+/g, "_").replace(/_+/g, "_").toLowerCase();
  let slug = base;
  let index = 2;
  while (used.has(slug)) slug = `${base}_${index++}`;
  used.add(slug);
  return slug;
}
function attributeToNode(nodes, routeName) {
  if (!routeName) return null;
  const named = nodes.filter((node) => node.origin !== "chrome" && routeAnswersTo(node, routeName));
  if (named.length !== 1) return null;
  return named[0];
}
async function captureScreenUiStates(input, ports) {
  const clock = ports.now ?? (() => Date.now());
  const passStartedAt = clock();
  const { node } = input;
  const uiStates = [];
  const discoveryFailures = [];
  const used = input.used ?? /* @__PURE__ */ new Set();
  const result = {
    uiStates,
    discoveryFailures,
    unresolvedBindings: 0,
    rolledBack: true,
    cancelled: false,
    diagnostics: {
      candidates: 0,
      listed: 0,
      listedKinds: {},
      aliased: 0,
      refusedAtList: {},
      opened: 0,
      refusedAtOpen: {},
      captured: 0,
      unbound: 0,
      rolledBack: true,
      latched: false
    }
  };
  const diag = result.diagnostics;
  const noteUnwind = (unwound) => {
    if (unwound.evidence) diag.dismissEvidence = unwound.evidence;
    if (!unwound.ok) {
      result.rolledBack = false;
      diag.rollbackFailure = rollbackFailureCategory(unwound.error);
    }
  };
  let opened = false;
  let stage = "setup";
  let outcome = "completed";
  const actions = new Map(input.catalog.actions.map((action) => [action.id, action]));
  const previews = new Map((input.catalog.previews ?? []).map((action) => [action.id, action]));
  const recipe = (id2) => actions.get(id2) ?? previews.get(id2);
  try {
    ports.emit({ type: "phase", message: "Reading the app\u2019s UI states\u2026" });
    const setup = await ports.runtime.setup({
      states: [...input.catalog.states, ...input.catalog.previewStates ?? [], ...input.catalog.viewStates ?? []],
      actions: [...input.catalog.actions, ...input.catalog.previews ?? []]
    });
    if (!setup.ok) throw new Error(setup.error ?? "The app could not be prepared for UI exploration.");
    const unbound = setup.unbound ?? [];
    if (unbound.length) {
      let joined = true;
      let stats;
      const matches = await ports.bind(unbound, (reported) => {
        stats = reported;
      }).catch(() => {
        joined = false;
        return [];
      });
      const resolved = new Set(matches.map((match) => match.binding));
      const trusted = joined && !(stats && stats.failedBatches > 0);
      const checked = trusted ? unbound.filter((binding) => !resolved.has(binding.id)).map((binding) => binding.id) : [];
      let configured = 0;
      if (matches.length || checked.length) {
        configured = (await ports.runtime.configure(matches, checked).catch(() => void 0))?.configured ?? 0;
      }
      result.unresolvedBindings = unbound.filter((binding) => !resolved.has(binding.id)).length;
      diag.join = {
        emittedState: unbound.filter((binding) => binding.kind === "state").length,
        emittedEntry: unbound.filter((binding) => binding.kind === "entry").length,
        entriesLive: setup.entries ?? 0,
        entriesPlacedBefore: setup.entriesMatched ?? 0,
        noFrames: stats?.noFrames ?? 0,
        foreignFrames: stats?.foreignFrames ?? 0,
        frames: stats?.frames ?? 0,
        resolved: stats?.resolved ?? 0,
        failedBatches: stats?.failedBatches ?? (joined ? 0 : 1),
        projectFrames: stats?.projectFrames ?? 0,
        placed: stats?.placed ?? 0,
        entryPlaced: stats?.entryPlaced ?? 0,
        configured
      };
      for (const [name2, count] of [
        ["no-frames", diag.join.noFrames],
        ["foreign-frames", diag.join.foreignFrames],
        ["symbolicate-failed", diag.join.failedBatches]
      ]) {
        if (count > 0) recordRuntimeAmount("app_flow.runtime.presentation_unbound", count, { stage: name2 });
      }
    }
    diag.unbound = result.unresolvedBindings;
    recordRuntimeAmount("app_flow.runtime.presentation_unbound", result.unresolvedBindings, {
      stage: "configure"
    });
    stage = "list";
    const listed = await ports.runtime.list();
    diag.listed = listed.available.length;
    diag.aliased = listed.aliased ?? 0;
    diag.listedKinds = { ...listed.kinds ?? {} };
    diag.candidates = listed.available.length + diag.aliased + listed.unavailable;
    diag.refusedAtList = { ...listed.rejected ?? {} };
    const limit = input.limit ?? listed.available.length;
    ports.emit({
      type: "phase",
      message: `Capturing ${Math.min(limit, listed.available.length)} UI state(s) on this screen\u2026`,
      completed: 0,
      total: Math.min(limit, listed.available.length)
    });
    stage = "open";
    for (const entry of listed.available) {
      if (uiStates.filter((state) => state.screenshot).length >= limit) break;
      if (aborted(ports.signal)) {
        result.cancelled = true;
        outcome = "cancelled";
        break;
      }
      if (!result.rolledBack) break;
      const action = recipe(entry.id);
      if (!action) {
        discoveryFailures.push({ id: entry.id, reason: "The device offered a presentation this catalog does not describe." });
        continue;
      }
      const openStartedAt = clock();
      const openedState = await ports.runtime.open(entry.id);
      if (!openedState.ok) {
        const why = refusalReason(openedState.reason);
        diag.refusedAtOpen[why] = (diag.refusedAtOpen[why] ?? 0) + 1;
        recordRuntimeTiming("app_flow.runtime.presentation", clock() - openStartedAt, {
          outcome: "failed",
          kind: entry.kind
        });
        discoveryFailures.push({ id: entry.id, reason: openedState.error });
        uiStates.push({
          id: action.id,
          name: action.name,
          screenshot: null,
          file: action.file,
          line: action.line,
          ...action.views?.length ? { sourceViews: action.views } : {},
          error: openedState.error
        });
        noteUnwind(await ports.runtime.rollback(0).catch(() => ({ ok: false, error: "rollback failed" })));
        continue;
      }
      opened = true;
      diag.opened += 1;
      try {
        await ports.settle();
        if (openedState.expected) {
          const content = await ports.runtime.content(openedState.expected).catch(() => ({ found: true, hosts: 1, visible: 1 }));
          if (!content.found || content.visible === 0) {
            const why = content.found ? "empty" : "target";
            diag.refusedAtOpen[why] = (diag.refusedAtOpen[why] ?? 0) + 1;
            recordRuntimeTiming("app_flow.runtime.presentation", clock() - openStartedAt, {
              outcome: "failed",
              kind: entry.kind
            });
            const reason = content.found ? "This view renders nothing in this app state." : "The expected component did not mount.";
            discoveryFailures.push({ id: entry.id, reason });
            uiStates.push({
              id: action.id,
              name: action.name,
              screenshot: null,
              file: action.file,
              line: action.line,
              ...action.views?.length ? { sourceViews: action.views } : {},
              error: reason
            });
            continue;
          }
        }
        const slug = uiStateSlug(node.slug, action.id, used);
        const screenshot = await ports.screenshot(slug);
        uiStates.push({
          id: action.id,
          name: action.name,
          screenshot,
          file: action.file,
          line: action.line,
          ...action.views?.length ? { sourceViews: action.views } : {},
          openedBy: openedState.kind
        });
        recordRuntimeTiming("app_flow.runtime.presentation", clock() - openStartedAt, {
          outcome: "captured",
          kind: entry.kind
        });
        ports.emit({
          type: "step",
          message: `Captured ${action.name}.`,
          completed: uiStates.filter((state) => state.screenshot).length,
          total: Math.min(limit, listed.available.length)
        });
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        recordRuntimeTiming("app_flow.runtime.presentation", clock() - openStartedAt, {
          outcome: "failed",
          kind: entry.kind
        });
        discoveryFailures.push({ id: entry.id, reason });
        uiStates.push({
          id: action.id,
          name: action.name,
          screenshot: null,
          file: action.file,
          line: action.line,
          ...action.views?.length ? { sourceViews: action.views } : {},
          error: reason
        });
      } finally {
        noteUnwind(await ports.runtime.rollback(0).catch(() => ({ ok: false, error: "rollback failed" })));
      }
    }
    if (listed.unavailable) {
      discoveryFailures.push({
        id: "",
        reason: `${listed.unavailable} discovered UI state(s) could not be bound to anything live on this screen.`
      });
    }
  } catch (error) {
    outcome = aborted(ports.signal) ? "cancelled" : "failed";
    if (outcome === "cancelled") result.cancelled = true;
    result.error = error instanceof Error ? error.message : String(error);
  } finally {
    const unwound = await ports.runtime.rollback(0).catch(() => ({ ok: false, error: "rollback failed" }));
    if (unwound.evidence) diag.dismissEvidence = unwound.evidence;
    if (!unwound.ok && (opened || result.error !== void 0)) {
      result.rolledBack = false;
      diag.rollbackFailure = rollbackFailureCategory(unwound.error);
    }
    for (const [reason, count] of Object.entries(diag.refusedAtList)) {
      recordRuntimeAmount("app_flow.runtime.presentation_refused", count, { stage: "list", reason });
    }
    for (const [reason, count] of Object.entries(diag.refusedAtOpen)) {
      recordRuntimeAmount("app_flow.runtime.presentation_refused", count, { stage: "open", reason });
    }
    diag.rolledBack = result.rolledBack;
    diag.captured = uiStates.filter((state) => state.screenshot).length;
    if (result.error !== void 0) diag.failure = outcome === "cancelled" ? "cancelled" : passFailureCategory(stage, result.error);
    recordRuntimeTiming("app_flow.runtime.presentation_pass", clock() - passStartedAt, { outcome });
  }
  return result;
}
async function exploreUiStates(input, ports) {
  const route = await ports.focusedRoute();
  const node = attributeToNode(input.nodes, route);
  if (!node) {
    throw new Error(
      route ? `The screen the app is on (${route}) is not one of this project\u2019s captured screens, so its UI states have nowhere to attach. Build the flow first, then open a captured screen.` : "The app did not report a focused screen, so its UI states have nowhere to attach."
    );
  }
  if (!node.capture) {
    throw new Error("The screen the app is on has no capture yet. Build the flow first, then open a captured screen.");
  }
  const screen = await captureScreenUiStates(
    { catalog: input.catalog, node, ...input.limit === void 0 ? {} : { limit: input.limit } },
    ports
  );
  if (screen.error !== void 0 && !screen.cancelled) {
    throw new Error(
      screen.rolledBack ? screen.error : `${screen.error.replace(/[.\s]+$/, "")}. The app may still be showing a UI state this run opened.`
    );
  }
  return {
    nodeId: node.id,
    uiStates: screen.uiStates,
    discoveryFailures: screen.discoveryFailures,
    unresolvedBindings: screen.unresolvedBindings,
    rolledBack: screen.rolledBack,
    cancelled: screen.cancelled
  };
}
function createSweepUiStateCapturer(deps) {
  const limit = deps.limit ?? EXPLORE_UI_SWEEP_LIMIT;
  const used = /* @__PURE__ */ new Set();
  let session = null;
  let latched = false;
  let captured = 0;
  return {
    /** UI states captured so far across the sweep. */
    get captured() {
      return captured;
    },
    /** True once nothing further will be attempted (cap reached, or latched off by a failure). */
    get done() {
      return latched || captured >= limit;
    },
    async capture(node) {
      if (latched || captured >= limit || aborted(deps.signal)) return void 0;
      try {
        if (!session) {
          const openStartedAt = performance.now();
          try {
            session = await deps.open();
          } finally {
            recordRuntimeTiming("app_flow.runtime.presentation_open_session", performance.now() - openStartedAt, {
              outcome: session ? "ready" : "unavailable"
            });
          }
        }
        const screen = await captureScreenUiStates(
          { catalog: session.catalog, node, limit: limit - captured, used },
          session.ports
        );
        captured += screen.uiStates.filter((state) => state.screenshot).length;
        if (!screen.rolledBack) screen.diagnostics.latched = true;
        try {
          deps.onScreen?.(node, screen.diagnostics);
        } catch {
        }
        if (!screen.rolledBack) {
          latched = true;
          deps.note(
            "UI states stopped: the app may still be showing one this sweep opened. Remaining screens will not capture UI states."
          );
          deps.report?.(new Error(screen.error ?? "UI state rollback did not reach level 0."));
        } else if (screen.error !== void 0 && !screen.cancelled) {
          deps.report?.(new Error(screen.error));
        }
        return screen.uiStates.length ? screen.uiStates : void 0;
      } catch (error) {
        latched = true;
        try {
          deps.onScreen?.(node, {
            candidates: 0,
            listed: 0,
            listedKinds: {},
            aliased: 0,
            refusedAtList: {},
            opened: 0,
            refusedAtOpen: {},
            captured: 0,
            unbound: 0,
            rolledBack: true,
            latched: true,
            failure: session ? "capture-threw" : "session-unavailable"
          });
        } catch {
        }
        if (!aborted(deps.signal)) {
          deps.note(
            `UI states unavailable \u2014 ${error instanceof Error ? error.message : String(error)}`
          );
          deps.report?.(error);
        }
        return void 0;
      }
    }
  };
}
async function attachSweepUiStates(capturer, node, delivery) {
  if (!capturer || delivery.kind !== "reached" || !delivery.capture.screenshot) return delivery.capture;
  const uiStates = await capturer.capture(node);
  return uiStates ? { ...delivery.capture, uiStates } : delivery.capture;
}

// packages/core/src/app-flow/explore-ui-run.ts
import { readFile as readFile5, readdir as readdir5 } from "node:fs/promises";
import { join as join9 } from "node:path";

// packages/core/src/app-flow/presentations-bindings.ts
import { isAbsolute as isAbsolute2, relative as relative2 } from "node:path";
var bindingLimit = 3e3;
var frameLimit = 16;
var batchSize = 120;
var symbolicateTimeoutMs = 15e3;
var sourceLimit = 512e3;
var framePatterns = [
  /at\s+(.*?)\s+\((?:address at )?(https?:\/\/.*):(\d+):(\d+)\)/,
  /^(.*?)@(https?:\/\/.*):(\d+):(\d+)$/
];
function portOf(url) {
  return url.port || (url.protocol === "https:" ? "443" : "80");
}
function sameMetro(frame, base) {
  return frame.protocol.startsWith("http") && portOf(frame) === portOf(base);
}
function isProjectFile(file) {
  return !isAbsolute2(file) && !file.startsWith("..") && !file.split(/[\\/]/).includes("node_modules");
}
function contains(range, line, column) {
  if (!range || line < range.line || line > range.endLine) return false;
  if (column === void 0) return false;
  if (line === range.line && column < range.column) return false;
  if (range.endColumn !== void 0 && line === range.endLine && column >= range.endColumn) return false;
  return true;
}
async function bindPresentationSites(root, bindings, presentations, ports) {
  const base = parseBaseUrl(ports.metroOrigin, "Metro URL");
  const states = presentations.states ?? [];
  const actions = presentations.actions ?? [];
  const frames = [];
  const frameIds = /* @__PURE__ */ new Map();
  const references = [];
  const resolved = [];
  const stats = {
    records: 0,
    entryRecords: 0,
    noFrames: 0,
    foreignFrames: 0,
    frames: 0,
    resolved: 0,
    failedBatches: 0,
    projectFrames: 0,
    placed: 0,
    entryPlaced: 0
  };
  const matches = [];
  const resolvedEntries = /* @__PURE__ */ new Set();
  const resolvedStates = /* @__PURE__ */ new Set();
  const entryIds = new Set(bindings.filter((binding) => binding.kind === "entry").map((binding) => binding.id));
  const deferred = [];
  const matchFrame = (binding, frame) => {
    const line = frame.lineNumber;
    if (!frame.file || line === void 0 || !Number.isInteger(line)) return;
    if (binding.kind === "portal" || binding.kind === "ui-effect") {
      deferred.push({ binding: binding.id, frame });
      return;
    }
    const file = relative2(root, frame.file.replace(/^file:\/\//, ""));
    if (!isProjectFile(file)) return;
    stats.projectFrames += 1;
    const column = frame.column;
    if (binding.kind === "entry") {
      if (resolvedEntries.has(binding.id)) return;
      resolvedEntries.add(binding.id);
      for (const site of states) {
        for (const entry of site.ownerEntries ?? []) {
          if (entry.component !== binding.owner || entry.file !== file) continue;
          if (!contains(entry.source, line, column)) continue;
          matches.push({ binding: binding.id, site: `owner:${site.id}:${entry.component}` });
        }
      }
      for (const action of actions) {
        if (action.effect?.kind === "mount") continue;
        const sites = entrySites(action, binding.owner);
        for (const site of sites) {
          if (site.file !== file || !contains(site.source, line, column)) continue;
          matches.push({ binding: binding.id, site: site.id });
        }
      }
      return;
    }
    const candidates = states.filter((site) => site.file === file && line >= site.line && line <= site.endLine && (column === void 0 || site.endColumn === void 0 || !(line === site.line && column < site.column || line === site.endLine && column >= site.endColumn)));
    if (candidates.length !== 1 || resolvedStates.has(binding.id)) return;
    resolvedStates.add(binding.id);
    matches.push({ binding: binding.id, site: candidates[0].id });
  };
  for (const binding of bindings.slice(0, bindingLimit)) {
    stats.records += 1;
    if (binding.kind === "entry") stats.entryRecords += 1;
    if (binding.source) {
      matchFrame(binding, { file: binding.source.file, lineNumber: binding.source.line, column: binding.source.column });
      continue;
    }
    let parsed = 0;
    for (const line of (binding.stack ?? "").split("\n").slice(0, frameLimit)) {
      const match = framePatterns[0].exec(line) ?? framePatterns[1].exec(line);
      if (!match) continue;
      let url;
      try {
        url = new URL(match[2]);
      } catch {
        continue;
      }
      if (!sameMetro(url, base)) {
        stats.foreignFrames += 1;
        continue;
      }
      parsed += 1;
      const frame = { file: `${base.origin}${url.pathname}${url.search}`, methodName: match[1], lineNumber: Number(match[3]), column: Math.max(0, Number(match[4]) - 1) };
      const key2 = JSON.stringify(frame);
      let index = frameIds.get(key2);
      if (index === void 0) {
        index = frames.length;
        frameIds.set(key2, index);
        frames.push(frame);
      }
      references.push({ owner: binding, index });
    }
    if (!parsed) stats.noFrames += 1;
  }
  stats.frames = frames.length;
  stats.failedBatches = await symbolicate(base, frames, resolved, ports);
  stats.resolved = resolved.filter(Boolean).length;
  for (const reference of references) {
    const frame = resolved[reference.index];
    if (frame) matchFrame(reference.owner, frame);
  }
  await resolveDeferred(root, bindings, deferred, matches, ports);
  stats.placed = new Set(matches.map((match) => match.binding)).size;
  stats.entryPlaced = new Set(matches.filter((match) => entryIds.has(match.binding)).map((match) => match.binding)).size;
  ports.report?.(stats);
  return matches;
}
function entrySites(action, owner3) {
  const sites = [
    { file: action.file, source: action.source, id: action.id }
  ];
  if (action.expected && action.expected.component === owner3) {
    sites.push({ file: action.expected.file, source: action.expected.source, id: `${action.id}:expected` });
  }
  if (action.effect?.kind === "control" && action.effect.target) {
    sites.push({ file: action.effect.target.file, source: action.effect.target.source, id: `${action.id}:target` });
  }
  for (const entry of action.consumer?.entries ?? []) {
    sites.push({ file: entry.file, source: entry.source, id: `${action.id}:consumer` });
  }
  return sites;
}
async function symbolicate(base, frames, resolved, ports) {
  let failed = 0;
  if (!frames.length) return failed;
  const request = ports.fetch ?? globalThis.fetch;
  for (let offset = 0; offset < frames.length; offset += batchSize) {
    const batch = frames.slice(offset, offset + batchSize);
    try {
      const response = await request(new URL("/symbolicate", base), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stack: batch }),
        redirect: "error",
        signal: AbortSignal.any([AbortSignal.timeout(ports.timeoutMs ?? symbolicateTimeoutMs), ...ports.signal ? [ports.signal] : []])
      });
      if (!response.ok) {
        failed += 1;
        continue;
      }
      const result = await response.json();
      for (const [index, frame] of (result.stack ?? []).slice(0, batch.length).entries()) resolved[offset + index] = frame;
    } catch {
      failed += 1;
    }
  }
  return failed;
}
async function resolveDeferred(root, bindings, deferred, matches, ports) {
  if (!deferred.length || !ports.readSource) return;
  const sources = /* @__PURE__ */ new Map();
  const matched = /* @__PURE__ */ new Set();
  for (const { binding, frame } of deferred) {
    if (matched.has(binding)) continue;
    try {
      const file = frame.file.replace(/^file:\/\//, "");
      if (!isProjectFile(relative2(root, file))) continue;
      if (!sources.has(file)) sources.set(file, await ports.readSource(file));
      const source = sources.get(file);
      if (source === void 0 || source.length > sourceLimit) continue;
      const kind = bindings.find((candidate) => candidate.id === binding)?.kind;
      const line = frame.lineNumber, column = frame.column ?? 0;
      const opening = kind === "ui-effect" ? ports.sourceUiOpenEffect?.(source, line, column) : void 0;
      const portal = !opening && kind === "portal" ? ports.sourceUiPortal?.(source, line, column) : false;
      const site = opening ? `ui-effect:${opening.dependency}:${opening.method}` : portal ? `portal:${portal.append}:${portal.remove}` : void 0;
      if (!site) continue;
      matches.push({ binding, site });
      matched.add(binding);
    } catch {
    }
  }
}

// packages/core/src/app-flow/preview-plans.ts
import { createHash as createHash3 } from "node:crypto";
var protectedPreviewField = /token|password|secret|authorization|cookie|credential|authenticated|loggedin|signedin|session|identity|currentuser|accesskey|verified|captcha|challenge|account|mutation|submit|fetch|loading|pending|error|success|result|^data$|^status$|^(__proto__|constructor|prototype)$/i;
var inlineBody = /^(?:View|Text|Button|Icon|Avatar|Fragment|ActivityIndicator)$|Skeleton|Shimmer|Loading|Spinner|EmptyState|ErrorMessage/;
var destination = (action) => JSON.stringify(action.effect.kind === "state" ? [action.effect.site, action.effect.path, action.effect.value] : [action.file, action.owner, action.effect]);
var id = (key2) => `preview-${createHash3("sha256").update(key2).digest("hex").slice(0, 20)}`;
function requiresProgress(branch) {
  if (!branch || branch.side === "case") return false;
  const ast = typescript_runtime_default.createSourceFile("condition.ts", `const condition=(${branch.condition});`, typescript_runtime_default.ScriptTarget.Latest, true);
  const statement = ast.statements[0];
  if (!statement || !typescript_runtime_default.isVariableStatement(statement)) return false;
  const expression2 = statement.declarationList.declarations[0]?.initializer;
  if (!expression2) return false;
  const progress = /^(?:is)?(?:pending|loading|fetching|submitting|mutating|busy)$/i;
  const required = (node, positive) => {
    if (typescript_runtime_default.isParenthesizedExpression(node)) return required(node.expression, positive);
    if (typescript_runtime_default.isPrefixUnaryExpression(node) && node.operator === typescript_runtime_default.SyntaxKind.ExclamationToken) return required(node.operand, !positive);
    if (typescript_runtime_default.isIdentifier(node) || typescript_runtime_default.isPropertyAccessExpression(node)) return positive && progress.test(typescript_runtime_default.isIdentifier(node) ? node.text : node.name.text);
    if (!typescript_runtime_default.isBinaryExpression(node)) return false;
    const op = node.operatorToken.kind;
    if (op === typescript_runtime_default.SyntaxKind.AmpersandAmpersandToken || op === typescript_runtime_default.SyntaxKind.BarBarToken) {
      const a = required(node.left, positive), b = required(node.right, positive);
      return op === typescript_runtime_default.SyntaxKind.AmpersandAmpersandToken === positive ? a || b : a && b;
    }
    if (op !== typescript_runtime_default.SyntaxKind.EqualsEqualsEqualsToken && op !== typescript_runtime_default.SyntaxKind.ExclamationEqualsEqualsToken) return false;
    const boolean = (value2) => value2.kind === typescript_runtime_default.SyntaxKind.TrueKeyword ? true : value2.kind === typescript_runtime_default.SyntaxKind.FalseKeyword ? false : void 0;
    const left = boolean(node.left), right = boolean(node.right), value = left ?? right;
    if (value === void 0) return false;
    return required(left === void 0 ? node.left : node.right, op === typescript_runtime_default.SyntaxKind.EqualsEqualsEqualsToken === positive ? value : !value);
  };
  return required(expression2, branch.side === "true");
}
function addSourcePreviewPlans(catalog, navigators = []) {
  const sites = new Map((catalog.viewStates ?? []).map((site) => [site.id, site]));
  const plans = /* @__PURE__ */ new Map();
  const booleanSelectors = new Set(catalog.actions.filter((action) => action.effect.kind === "state" && typeof action.effect.value === "boolean").map((action) => action.effect.kind === "state" ? JSON.stringify([action.effect.site, action.effect.path]) : ""));
  const ownersBySource = new Map((catalog.views ?? []).filter((view) => view.kind === "component").map((view) => [JSON.stringify([view.file, view.owner]), view]));
  for (const view of catalog.views ?? []) {
    const base = { id: "", file: view.file, line: view.line, owner: view.owner, component: view.name, prop: "", name: view.name, preview: true, views: [view.id] };
    let action;
    if (view.state) {
      const site = sites.get(view.state.site), field2 = view.state.path.at(-1) ?? site?.valueName;
      if (!site?.hook || !field2 || view.state.path.some((part) => protectedPreviewField.test(part) || /^(?:auth|user)$/.test(part)) || protectedPreviewField.test(field2) || protectedPreviewField.test(site.valueName ?? "") || /^use.*(?:Session|Account|Auth|Query|Mutation)/.test(site.owner)) continue;
      const value = view.state.value;
      if (!["string", "number", "boolean"].includes(typeof value) || typeof value === "number" && !Number.isFinite(value)) continue;
      const candidates = (view.renders ?? [view]).flatMap((render2) => {
        if (requiresProgress(render2.branch)) return [];
        if (typeof value === "boolean" && !/open|visible|show|view|screen|dialog|modal/i.test(field2) && !(render2.renderBody && booleanSelectors.has(JSON.stringify([view.state.site, view.state.path])))) return [];
        const target3 = render2.components.filter((c) => !inlineBody.test(c.component) && c.component !== "default").sort((a, b) => (a.guards ?? 0) - (b.guards ?? 0))[0];
        const component2 = target3?.component;
        if (!component2) return [];
        const local = site.owner === render2.owner && site.file === render2.file;
        const entries2 = local ? void 0 : ownersBySource.get(JSON.stringify([render2.file, render2.owner]))?.entries?.flatMap((entry) => entry.source ? [{ file: entry.file, owner: entry.owner, source: entry.source }] : []);
        if (!local && !entries2?.length) return [];
        return [{ render: render2, component: component2, target: target3, local, entries: entries2, rank: (render2.renderBody ? 0 : 2) + (local ? 0 : 1), guards: target3?.guards ?? 0 }];
      }).sort((a, b) => a.rank - b.rank || a.guards - b.guards);
      const selected = candidates[0];
      if (!selected) continue;
      const { render, component, target: target2, entries } = selected;
      action = {
        ...base,
        file: render.file,
        line: render.line,
        owner: render.owner,
        name: component,
        component,
        effect: { kind: "state", ...view.state },
        ...target2?.entry ? { expected: { component, file: target2.entry.file, owner: render.owner, source: target2.entry.source, ...!render.renderBody || render.source.line !== target2.entry.source.line || render.source.column !== target2.entry.source.column ? { scope: "owner" } : {} } } : {},
        ...!selected.local ? { consumer: { component: render.owner, entries } } : {}
      };
    } else if (view.control?.boundary) {
      action = { ...base, effect: { kind: "control", component: view.control.component, prop: view.control.prop, method: "auto", close: ["close", "dismiss", "hide", "collapse"], target: { file: view.file, owner: view.owner, line: view.line, source: view.source } } };
    }
    if (!action) continue;
    const key2 = destination(action), existing = plans.get(key2);
    if (existing) {
      existing.views.push(view.id);
      continue;
    }
    action.id = id(key2);
    plans.set(key2, action);
  }
  const owners = new Set([...plans.values()].filter((plan) => plan.effect.kind === "state").map((plan) => JSON.stringify([plan.file, plan.owner])));
  for (const view of catalog.views ?? []) {
    if (view.kind !== "component" || !view.mount || !owners.has(JSON.stringify([view.file, view.owner])) || protectedPreviewField.test(view.owner)) continue;
    const effect = { kind: "mount", file: view.file, export: view.mount.export };
    const key2 = JSON.stringify([view.file, view.owner, effect]);
    plans.set(key2, { id: id(key2), file: view.file, line: view.line, owner: view.owner, component: view.owner, prop: "", name: view.owner, preview: true, views: [view.id], effect });
  }
  const componentViews = /* @__PURE__ */ new Map();
  const sourceKey = (file, component) => JSON.stringify([file, component]);
  for (const view of catalog.views ?? []) if (view.kind === "component") {
    componentViews.set(sourceKey(view.file, view.owner), view);
    if (view.mount) componentViews.set(sourceKey(view.file, view.mount.export), view);
  }
  const parents = /* @__PURE__ */ new Map();
  for (const view of catalog.views ?? []) if (view.kind === "component") for (const child of view.components) {
    const target2 = componentViews.get(sourceKey(child.file, child.component));
    const key2 = sourceKey(target2?.file ?? child.file, target2?.owner ?? child.component);
    const owners2 = parents.get(key2) ?? /* @__PURE__ */ new Set();
    owners2.add(sourceKey(view.file, view.owner));
    parents.set(key2, owners2);
  }
  const navigationOwners = /* @__PURE__ */ new Set();
  for (const navigator of navigators) if (navigator.kind === "navigator" && navigator.file) {
    const component = navigator.definition?.split("#").at(-1) ?? navigator.component ?? navigator.name;
    if (component) navigationOwners.add(sourceKey(navigator.file, component));
  }
  const queue = [...navigationOwners];
  for (let index = 0; index < queue.length; index++) for (const parent of parents.get(queue[index]) ?? []) if (!navigationOwners.has(parent)) {
    navigationOwners.add(parent);
    queue.push(parent);
  }
  for (const branch of catalog.views ?? []) {
    if (branch.kind !== "branch" || !branch.branch || branch.components.length !== 1 || !navigationOwners.has(sourceKey(branch.file, branch.owner)) || !protectedPreviewField.test(branch.branch.condition) || requiresProgress(branch.branch)) continue;
    const target2 = branch.components[0], body = componentViews.get(sourceKey(target2.file, target2.component));
    if (!body?.mount || inlineBody.test(body.owner)) continue;
    const effect = { kind: "mount", file: body.file, export: body.mount.export };
    const key2 = JSON.stringify([body.file, body.owner, effect]), existing = plans.get(key2);
    if (existing) {
      existing.views = [.../* @__PURE__ */ new Set([...existing.views ?? [], body.id, branch.id])];
      continue;
    }
    plans.set(key2, { id: id(key2), file: body.file, line: body.line, owner: body.owner, component: body.owner, prop: "", name: body.owner, preview: true, views: [body.id, branch.id], effect });
  }
  const states = /* @__PURE__ */ new Map();
  for (const plan of plans.values()) if (plan.effect.kind === "state") {
    const site = sites.get(plan.effect.site);
    states.set(site.id, site);
  }
  catalog.previewStates = [...states.values()];
  catalog.previews = [...plans.values()];
  return catalog;
}

// packages/core/src/app-flow/presentations-source.ts
import { relative as relative3 } from "node:path";

// packages/core/src/app-flow/source-units.ts
import { createHash as createHash4 } from "node:crypto";
import { dirname as dirname4, join as join8, resolve as resolve2 } from "node:path";
function unwrap(node) {
  while (typescript_runtime_default.isParenthesizedExpression(node) || typescript_runtime_default.isAsExpression(node) || typescript_runtime_default.isSatisfiesExpression(node) || typescript_runtime_default.isTypeAssertionExpression(node))
    node = node.expression;
  return node;
}
function sourceHash(value) {
  return createHash4("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex").slice(0, 20);
}
function ownerFn(node) {
  for (let parent = node.parent; parent; parent = parent.parent)
    if (typescript_runtime_default.isFunctionLike(parent) && "body" in parent && parent.body) return parent;
  return void 0;
}
function fnName(fn, { depth = 5, stopAtNestedFunction = true } = {}) {
  if (fn.name && typescript_runtime_default.isIdentifier(fn.name)) return fn.name.text;
  let parent = fn;
  for (let i = 0; parent.parent && i < depth; i++, parent = parent.parent) {
    if (stopAtNestedFunction && typescript_runtime_default.isFunctionLike(parent.parent)) break;
    if (typescript_runtime_default.isVariableDeclaration(parent.parent) && typescript_runtime_default.isIdentifier(parent.parent.name))
      return parent.parent.name.text;
  }
  return "default";
}
function jsxAttributes(node) {
  return node.attributes.properties.filter(typescript_runtime_default.isJsxAttribute);
}
var extensions = [".tsx", ".ts", ".jsx", ".js"];
function createSourceUnit(file, text2) {
  const ast = typescript_runtime_default.createSourceFile(file, text2, typescript_runtime_default.ScriptTarget.Latest, true, /x$/.test(file) ? typescript_runtime_default.ScriptKind.TSX : typescript_runtime_default.ScriptKind.TS);
  const unit = { file, ast, imports: /* @__PURE__ */ new Map(), constants: /* @__PURE__ */ new Map() };
  const collect = (node) => {
    if (typescript_runtime_default.isImportDeclaration(node) && typescript_runtime_default.isStringLiteral(node.moduleSpecifier)) {
      const module = node.moduleSpecifier.text, clause = node.importClause;
      if (clause?.name) unit.imports.set(clause.name.text, { module, name: "default" });
      if (clause?.namedBindings && typescript_runtime_default.isNamedImports(clause.namedBindings)) for (const entry of clause.namedBindings.elements) unit.imports.set(entry.name.text, { module, name: entry.propertyName?.text ?? entry.name.text });
      if (clause?.namedBindings && typescript_runtime_default.isNamespaceImport(clause.namedBindings)) unit.imports.set(clause.namedBindings.name.text, { module, name: "*" });
    }
    if (typescript_runtime_default.isVariableDeclaration(node) && typescript_runtime_default.isIdentifier(node.name) && node.initializer) unit.constants.set(node.name.text, node.initializer);
    typescript_runtime_default.forEachChild(node, collect);
  };
  collect(ast);
  return unit;
}
function createSourceUnits(sources) {
  const units = /* @__PURE__ */ new Map();
  for (const source of sources) units.set(source.file, createSourceUnit(source.file, source.text));
  return units;
}
function createSymbolResolver(units, options = { root: "" }) {
  const { root, paths = {}, platform = "ios" } = options;
  function moduleFile(unit, module) {
    const bases = module.startsWith(".") ? [resolve2(dirname4(unit.file), module)] : Object.entries(paths).flatMap(([key2, values]) => {
      const prefix = key2.replace(/\*$/, "");
      return module.startsWith(prefix) && Array.isArray(values) ? values.map((value) => resolve2(root, value.replace(/\*/g, module.slice(prefix.length)))) : [];
    });
    if (/^[#@~]\//.test(module)) bases.push(resolve2(root, "src", module.slice(2)), resolve2(root, module.slice(2)));
    for (const base of bases) {
      if (units.has(base)) return base;
      for (const stem of [base, join8(base, "index")]) for (const suffix of [`.${platform}`, ".native", ""]) for (const ext of extensions) {
        if (units.has(`${stem}${suffix}${ext}`)) return `${stem}${suffix}${ext}`;
      }
    }
  }
  const cache = /* @__PURE__ */ new Map();
  function symbol(unit, name2, seen = /* @__PURE__ */ new Set()) {
    const key2 = `${unit.file}#${name2}`;
    if (seen.has(key2)) return key2;
    if (cache.has(key2)) return cache.get(key2);
    seen = new Set(seen).add(key2);
    const [head2, ...members] = name2.split("."), member = members.join("."), imported = unit.imports.get(head2);
    const follow = (module, exported) => {
      const file = moduleFile(unit, module);
      return file ? symbol(units.get(file), exported, seen) : `${module}#${exported}`;
    };
    let result = key2;
    if (imported) result = follow(imported.module, imported.name === "*" && member ? member : [imported.name, member].filter(Boolean).join("."));
    else for (const statement of unit.ast.statements) {
      if (!typescript_runtime_default.isExportDeclaration(statement)) continue;
      if (statement.exportClause && typescript_runtime_default.isNamespaceExport(statement.exportClause) && statement.exportClause.name.text === head2 && member && statement.moduleSpecifier && typescript_runtime_default.isStringLiteral(statement.moduleSpecifier)) {
        result = follow(statement.moduleSpecifier.text, member);
        break;
      }
      if (statement.exportClause && typescript_runtime_default.isNamedExports(statement.exportClause)) {
        const exported = statement.exportClause.elements.find((item) => item.name.text === head2);
        if (exported) {
          const local = [exported.propertyName?.text ?? head2, member].filter(Boolean).join(".");
          result = statement.moduleSpecifier && typescript_runtime_default.isStringLiteral(statement.moduleSpecifier) ? follow(statement.moduleSpecifier.text, local) : symbol(unit, local, seen);
          break;
        }
      }
    }
    cache.set(key2, result);
    return result;
  }
  return (unit, name2) => symbol(units.get(unit.file) ?? unit, name2);
}

// packages/core/src/app-flow/presentations-source.ts
var bad = /token|password|secret|authorization|cookie|credential|authenticated|loggedin|signedin|session|identity|currentUser|accessKey|^(__proto__|constructor|prototype)$/i;
var destructiveHandler = /\b(?:on(?:Save|Discard|Delete|Submit)|(?:save|discard|delete|submit|mutate|signOut|logout)[A-Z]?\w*)\s*\(/i;
var key = sourceHash;
var attributes = jsxAttributes;
var expression = (node) => node.initializer && typescript_runtime_default.isJsxExpression(node.initializer) ? node.initializer.expression : void 0;
var head = (node) => node.getText().replace(/\?\./g, ".").split(".")[0];
var method = (node) => typescript_runtime_default.isPropertyAccessExpression(node) ? node.name.text : typescript_runtime_default.isIdentifier(node) ? node.text : "";
var owner = ownerFn;
var functionName = (fn) => fnName(fn, { depth: 4 });
function components(node) {
  const result = /* @__PURE__ */ new Set();
  const visit = (child) => {
    if (typescript_runtime_default.isFunctionLike(child)) return;
    if (typescript_runtime_default.isJsxOpeningElement(child) || typescript_runtime_default.isJsxSelfClosingElement(child)) {
      const name2 = child.tagName.getText();
      if (/^[A-Z]/.test(name2)) result.add(name2.split(".").at(-1));
    }
    typescript_runtime_default.forEachChild(child, visit);
  };
  visit(node);
  return [...result];
}
function declarationBindings() {
  const scopes = /* @__PURE__ */ new WeakMap();
  const bind = (name2, values) => {
    if (typescript_runtime_default.isIdentifier(name2)) values.set(name2.text, name2);
    else for (const item of name2.elements) if (typescript_runtime_default.isBindingElement(item)) bind(item.name, values);
  };
  const scope = (node) => {
    let values = scopes.get(node);
    if (values) return values;
    values = /* @__PURE__ */ new Map();
    scopes.set(node, values);
    const collect = (child) => {
      if (typescript_runtime_default.isVariableDeclaration(child) || typescript_runtime_default.isParameter(child)) bind(child.name, values);
      if (typescript_runtime_default.isFunctionLike(child) || typescript_runtime_default.isBlock(child)) return;
      typescript_runtime_default.forEachChild(child, collect);
    };
    typescript_runtime_default.forEachChild(node, collect);
    return values;
  };
  return (node) => {
    for (let parent = node.parent; parent; parent = parent.parent) if (typescript_runtime_default.isBlock(parent) || typescript_runtime_default.isFunctionLike(parent) || typescript_runtime_default.isSourceFile(parent)) {
      const value = scope(parent).get(node.text);
      if (value) return value;
    }
  };
}
function scanPresentations(units, root, symbol, options = {}) {
  const stateBinding = declarationBindings();
  const states = [], functions = /* @__PURE__ */ new Map(), enums = /* @__PURE__ */ new Map();
  const guards = /* @__PURE__ */ new Map();
  const views = /* @__PURE__ */ new Map();
  const functionUnits = /* @__PURE__ */ new WeakMap();
  const walk3 = (node, visit) => {
    visit(node);
    typescript_runtime_default.forEachChild(node, (child) => walk3(child, visit));
  };
  for (const unit of units.values()) walk3(unit.ast, (node) => {
    if (typescript_runtime_default.isEnumDeclaration(node)) {
      const values = /* @__PURE__ */ new Map();
      let next = 0;
      for (const member of node.members) {
        const value2 = member.initializer && typescript_runtime_default.isStringLiteralLike(member.initializer) ? member.initializer.text : member.initializer && typescript_runtime_default.isNumericLiteral(member.initializer) ? Number(member.initializer.text) : next;
        values.set(member.name.getText().replace(/^['"]|['"]$/g, ""), value2);
        if (typeof value2 === "number") next = value2 + 1;
      }
      enums.set(`${unit.file}#${node.name.text}`, values);
    }
    if (typescript_runtime_default.isFunctionLike(node) && "body" in node && node.body) {
      const fn2 = node;
      functionUnits.set(fn2, unit);
      functions.set(`${unit.file}#${functionName(fn2)}`, fn2);
    }
    if (!typescript_runtime_default.isVariableDeclaration(node) || !typescript_runtime_default.isArrayBindingPattern(node.name) || !node.initializer) return;
    const call = unwrap(node.initializer);
    if (!typescript_runtime_default.isCallExpression(call)) return;
    const resolved = symbol(unit, call.expression.getText());
    if (!/^react#useState$/.test(resolved)) return;
    const [value, setter] = node.name.elements;
    if (!value || !setter || !typescript_runtime_default.isBindingElement(value) || !typescript_runtime_default.isBindingElement(setter) || !typescript_runtime_default.isIdentifier(value.name) || !typescript_runtime_default.isIdentifier(setter.name)) return;
    const fn = owner(node);
    if (!fn) return;
    const start = unit.ast.getLineAndCharacterOfPosition(call.getStart()), end = unit.ast.getLineAndCharacterOfPosition(call.getEnd());
    states.push({
      unit,
      fn,
      value: value.name.text,
      setter: setter.name.text,
      setterNode: setter.name,
      site: { id: key(`${relative3(root, unit.file)}:${call.pos}`), file: relative3(root, unit.file), line: start.line + 1, column: start.character, endLine: end.line + 1, owner: functionName(fn), paths: [], hook: "useState", valueName: value.name.text }
    });
  });
  function known(unit, node, env, depth = 0) {
    if (!node || depth > 12) return false;
    node = unwrap(node);
    if (typescript_runtime_default.isIdentifier(node)) return env.has(node.text) || node.text === "undefined" || known(unit, unit.constants.get(node.text), env, depth + 1);
    if (typescript_runtime_default.isStringLiteralLike(node) || typescript_runtime_default.isNumericLiteral(node) || [typescript_runtime_default.SyntaxKind.TrueKeyword, typescript_runtime_default.SyntaxKind.FalseKeyword, typescript_runtime_default.SyntaxKind.NullKeyword].includes(node.kind)) return true;
    if (typescript_runtime_default.isPrefixUnaryExpression(node)) return known(unit, node.operand, env, depth + 1);
    if (typescript_runtime_default.isCallExpression(node) && node.expression.getText() === "Boolean") return known(unit, node.arguments[0], env, depth + 1);
    if (typescript_runtime_default.isPropertyAccessExpression(node)) return enums.has(symbol(unit, node.expression.getText())) || known(unit, node.expression, env, depth + 1);
    if (typescript_runtime_default.isBinaryExpression(node)) {
      if (!known(unit, node.left, env, depth + 1)) return false;
      const left = constant(unit, node.left, env, depth + 1);
      if (node.operatorToken.kind === typescript_runtime_default.SyntaxKind.AmpersandAmpersandToken && !left || node.operatorToken.kind === typescript_runtime_default.SyntaxKind.BarBarToken && left) return true;
      return known(unit, node.right, env, depth + 1);
    }
    if (typescript_runtime_default.isObjectLiteralExpression(node)) return node.properties.every((p) => typescript_runtime_default.isPropertyAssignment(p) && known(unit, p.initializer, env, depth + 1));
    return false;
  }
  function constant(unit, node, env = /* @__PURE__ */ new Map(), depth = 0) {
    if (!node || depth > 12) return void 0;
    node = unwrap(node);
    if (typescript_runtime_default.isIdentifier(node)) {
      if (env.has(node.text)) return env.get(node.text);
      return constant(unit, unit.constants.get(node.text), env, depth + 1);
    }
    if (typescript_runtime_default.isStringLiteralLike(node)) return node.text;
    if (typescript_runtime_default.isNumericLiteral(node)) return Number(node.text);
    if (node.kind === typescript_runtime_default.SyntaxKind.TrueKeyword) return true;
    if (node.kind === typescript_runtime_default.SyntaxKind.FalseKeyword) return false;
    if (node.kind === typescript_runtime_default.SyntaxKind.NullKeyword) return null;
    if (typescript_runtime_default.isPrefixUnaryExpression(node) && node.operator === typescript_runtime_default.SyntaxKind.ExclamationToken) return !known(unit, node.operand, env, depth + 1) ? void 0 : !constant(unit, node.operand, env, depth + 1);
    if (typescript_runtime_default.isCallExpression(node) && node.expression.getText() === "Boolean") return !known(unit, node.arguments[0], env, depth + 1) ? void 0 : !!constant(unit, node.arguments[0], env, depth + 1);
    if (typescript_runtime_default.isBinaryExpression(node)) {
      if (!known(unit, node, env, depth + 1)) return void 0;
      const a = constant(unit, node.left, env, depth + 1), b = constant(unit, node.right, env, depth + 1);
      switch (node.operatorToken.kind) {
        case typescript_runtime_default.SyntaxKind.AmpersandAmpersandToken:
          return a && b;
        case typescript_runtime_default.SyntaxKind.BarBarToken:
          return a || b;
        case typescript_runtime_default.SyntaxKind.EqualsEqualsEqualsToken:
          return a === b;
        case typescript_runtime_default.SyntaxKind.ExclamationEqualsEqualsToken:
          return a !== b;
      }
    }
    if (typescript_runtime_default.isPropertyAccessExpression(node)) {
      const values = enums.get(symbol(unit, node.expression.getText()));
      if (values) return values.get(node.name.text);
      const value = constant(unit, node.expression, env, depth + 1);
      return value && typeof value === "object" ? value[node.name.text] : void 0;
    }
    if (typescript_runtime_default.isObjectLiteralExpression(node)) {
      const value = {};
      for (const prop of node.properties) {
        if (!typescript_runtime_default.isPropertyAssignment(prop) || typescript_runtime_default.isComputedPropertyName(prop.name)) return void 0;
        const name2 = prop.name.getText().replace(/^['"]|['"]$/g, "");
        if (bad.test(name2)) return void 0;
        const v = constant(unit, prop.initializer, env, depth + 1);
        if (v === void 0) return void 0;
        value[name2] = v;
      }
      return value;
    }
  }
  const lexical = (node, name2) => {
    for (let scope = node.parent; scope; scope = scope.parent) {
      if (!typescript_runtime_default.isBlock(scope) && !typescript_runtime_default.isFunctionLike(scope) && !typescript_runtime_default.isSourceFile(scope)) continue;
      let found;
      const visit = (child) => {
        if (typescript_runtime_default.isFunctionDeclaration(child) && child.name?.text === name2) found = child;
        if (typescript_runtime_default.isVariableDeclaration(child) && typescript_runtime_default.isIdentifier(child.name) && child.name.text === name2) found = child.initializer;
        if (typescript_runtime_default.isFunctionLike(child) || typescript_runtime_default.isBlock(child)) return;
        typescript_runtime_default.forEachChild(child, visit);
      };
      typescript_runtime_default.forEachChild(scope, visit);
      if (found) return found;
    }
  };
  const callback = (unit, node, depth = 0) => {
    if (!node || depth > 12) return;
    node = unwrap(node);
    if (typescript_runtime_default.isIdentifier(node)) {
      const local = lexical(node, node.text);
      if (local && local !== node) return callback(unit, local, depth + 1);
      return functions.get(symbol(unit, node.text));
    }
    if (typescript_runtime_default.isCallExpression(node) && node.arguments[0]) return callback(unit, node.arguments[0], depth + 1);
    if ((typescript_runtime_default.isArrowFunction(node) || typescript_runtime_default.isFunctionExpression(node) || typescript_runtime_default.isFunctionDeclaration(node)) && node.body) return node;
  };
  const contextStates = /* @__PURE__ */ new Map();
  const contextReaders = /* @__PURE__ */ new Map();
  for (const unit of units.values()) walk3(unit.ast, (node) => {
    if ((typescript_runtime_default.isJsxOpeningElement(node) || typescript_runtime_default.isJsxSelfClosingElement(node)) && /\.Provider$/.test(node.tagName.getText())) {
      const value = attributes(node).find((a) => a.name.getText() === "value"), exp = value && expression(value);
      if (exp && typescript_runtime_default.isIdentifier(exp)) {
        const state = states.find((s) => s.unit === unit && s.value === exp.text && s.fn === owner(node));
        if (state) contextStates.set(symbol(unit, node.tagName.getText().replace(/\.Provider$/, "")), { state, path: [] });
      }
    }
    if (typescript_runtime_default.isCallExpression(node) && method(node.expression) === "useContext" && node.arguments[0]) {
      const fn = owner(node);
      if (fn) contextReaders.set(`${unit.file}#${functionName(fn)}`, symbol(unit, node.arguments[0].getText()));
    }
  });
  const addGuard = (state, path, label, value) => {
    if (path.some((p2) => bad.test(p2)) || bad.test(state.value)) return;
    const p = path.join(".");
    const names = guards.get(`${state.site.id}:${p}`) ?? /* @__PURE__ */ new Set();
    for (const name2 of label) names.add(name2);
    guards.set(`${state.site.id}:${p}`, names);
    if (value !== void 0) guards.set(`${state.site.id}:${p}:${JSON.stringify(value)}`, new Set(label));
    if (!state.site.paths.some((item) => item.join(".") === p)) state.site.paths.push(path);
  };
  for (const unit of units.values()) {
    const aliases = /* @__PURE__ */ new Map();
    walk3(unit.ast, (node) => {
      if (!typescript_runtime_default.isVariableDeclaration(node) || !node.initializer || !typescript_runtime_default.isCallExpression(unwrap(node.initializer))) return;
      const call = unwrap(node.initializer);
      const ctx = contextStates.get(contextReaders.get(symbol(unit, call.expression.getText())) ?? "");
      if (!ctx) return;
      if (typescript_runtime_default.isIdentifier(node.name)) aliases.set(node.name, ctx);
      if (typescript_runtime_default.isObjectBindingPattern(node.name)) {
        for (const e of node.name.elements) if (typescript_runtime_default.isIdentifier(e.name)) aliases.set(e.name, { state: ctx.state, path: [e.propertyName?.getText() ?? e.name.text] });
      }
    });
    walk3(unit.ast, (node) => {
      let condition, body;
      if (typescript_runtime_default.isConditionalExpression(node)) {
        condition = node.condition;
        body = node;
      }
      if (typescript_runtime_default.isBinaryExpression(node) && node.operatorToken.kind === typescript_runtime_default.SyntaxKind.AmpersandAmpersandToken) {
        condition = node.left;
        body = node.right;
      }
      if (typescript_runtime_default.isIfStatement(node)) {
        condition = node.expression;
        body = node.thenStatement;
      }
      if (typescript_runtime_default.isSwitchStatement(node)) {
        condition = node.expression;
        body = node.caseBlock;
      }
      if ((typescript_runtime_default.isJsxOpeningElement(node) || typescript_runtime_default.isJsxSelfClosingElement(node)) && attributes(node).some((a) => ["visible", "isOpen", "open"].includes(a.name.getText()))) {
        const attr = attributes(node).find((a) => ["visible", "isOpen", "open"].includes(a.name.getText()));
        condition = expression(attr);
        body = node.parent;
      }
      if (condition && typescript_runtime_default.isIdentifier(condition) && !aliases.has(stateBinding(condition))) {
        const local = lexical(condition, condition.text);
        if (local) condition = local;
      }
      while (condition && typescript_runtime_default.isPrefixUnaryExpression(condition) && condition.operator === typescript_runtime_default.SyntaxKind.ExclamationToken) condition = condition.operand;
      if (!condition || !body) return;
      const names = components(body);
      if (!names.length) return;
      walk3(condition, (ref) => {
        if (!typescript_runtime_default.isIdentifier(ref) || typescript_runtime_default.isPropertyAccessExpression(ref.parent) && ref.parent.name === ref) return;
        let expr2 = ref;
        const path = [];
        while (typescript_runtime_default.isPropertyAccessExpression(expr2.parent) && expr2.parent.expression === expr2) {
          path.push(expr2.parent.name.text);
          expr2 = expr2.parent;
        }
        const state = states.find((s) => s.unit === unit && s.value === ref.text && s.fn === owner(ref)), alias = aliases.get(stateBinding(ref));
        let selected = names, value;
        if (typescript_runtime_default.isBinaryExpression(condition) && [typescript_runtime_default.SyntaxKind.EqualsEqualsEqualsToken, typescript_runtime_default.SyntaxKind.EqualsEqualsToken].includes(condition.operatorToken.kind)) {
          value = constant(unit, condition.right);
          if (value === void 0) value = constant(unit, condition.left);
          if (typescript_runtime_default.isConditionalExpression(node)) selected = components(node.whenTrue);
        } else if (typescript_runtime_default.isIdentifier(condition) || typescript_runtime_default.isPropertyAccessExpression(condition)) {
          value = true;
          if (typescript_runtime_default.isConditionalExpression(node)) selected = components(node.whenTrue);
        }
        const matched = state ?? alias?.state, matchedPath = state ? path : alias ? [...alias.path, ...path] : [];
        if (matched) {
          addGuard(matched, matchedPath, selected, value);
          if (typescript_runtime_default.isConditionalExpression(node)) {
            const k = `${matched.site.id}:${matchedPath.join(".")}`, list = views.get(k) ?? [];
            list.push({ unit, node, name: ref.text, path });
            views.set(k, list);
          }
        }
      });
    });
  }
  const controlContexts = /* @__PURE__ */ new Map();
  for (const unit of units.values()) walk3(unit.ast, (node) => {
    if (!typescript_runtime_default.isJsxOpeningElement(node) && !typescript_runtime_default.isJsxSelfClosingElement(node) || !/\.Provider$/.test(node.tagName.getText())) return;
    const value = attributes(node).find((a) => a.name.getText() === "value"), exp = value && expression(value);
    if (!exp) return;
    let object = unwrap(exp);
    if (typescript_runtime_default.isIdentifier(object)) object = lexical(object, object.text);
    if (object && typescript_runtime_default.isCallExpression(unwrap(object))) {
      const fn = callback(unit, object);
      if (fn) object = typescript_runtime_default.isBlock(fn.body) ? fn.body.statements.find(typescript_runtime_default.isReturnStatement)?.expression : fn.body;
    }
    if (!object || !typescript_runtime_default.isObjectLiteralExpression(unwrap(object))) return;
    const entries = /* @__PURE__ */ new Map();
    for (const prop of unwrap(object).properties) {
      const value2 = typescript_runtime_default.isShorthandPropertyAssignment(prop) ? prop.name : typescript_runtime_default.isPropertyAssignment(prop) ? prop.initializer : void 0;
      const fn = typescript_runtime_default.isMethodDeclaration(prop) && prop.body ? prop : callback(unit, value2);
      if (fn) entries.set(prop.name.getText().replace(/^['"]|['"]$/g, ""), { fn, unit });
    }
    controlContexts.set(symbol(unit, node.tagName.getText().replace(/\.Provider$/, "")), entries);
  });
  function operation(unit, node, seen = /* @__PURE__ */ new Set(), depth = 0) {
    if (depth > 8 || seen.has(node)) return;
    seen = new Set(seen).add(node);
    node = unwrap(node);
    const local = callback(unit, node);
    if (local) return { fn: local, unit: functionUnits.get(local) ?? unit };
    if (typescript_runtime_default.isIdentifier(node)) {
      let declaration;
      for (let scope = node.parent; scope && !declaration; scope = scope.parent) {
        if (!typescript_runtime_default.isBlock(scope) && !typescript_runtime_default.isSourceFile(scope)) continue;
        const visit = (child) => {
          if (typescript_runtime_default.isFunctionLike(child) || typescript_runtime_default.isBlock(child)) return;
          if (typescript_runtime_default.isVariableDeclaration(child) && typescript_runtime_default.isObjectBindingPattern(child.name) && child.name.elements.some((e) => typescript_runtime_default.isIdentifier(e.name) && e.name.text === node.text)) declaration = child;
          typescript_runtime_default.forEachChild(child, visit);
        };
        typescript_runtime_default.forEachChild(scope, visit);
      }
      const binding = declaration?.name;
      const init = declaration?.initializer && unwrap(declaration.initializer);
      if (binding && init && typescript_runtime_default.isCallExpression(init)) {
        const context = contextReaders.get(symbol(unit, init.expression.getText()));
        const field2 = binding.elements.find((e) => typescript_runtime_default.isIdentifier(e.name) && e.name.text === node.text);
        const fieldName = field2.propertyName?.getText() ?? node.text;
        const found = controlContexts.get(context ?? "")?.get(fieldName);
        if (found) return found;
        const factory = functions.get(symbol(unit, init.expression.getText()));
        if (factory) {
          const factoryUnit = functionUnits.get(factory) ?? unit;
          let result = typescript_runtime_default.isBlock(factory.body) ? factory.body.statements.filter(typescript_runtime_default.isReturnStatement).at(-1)?.expression : factory.body;
          if (result && typescript_runtime_default.isCallExpression(unwrap(result))) {
            const fn = callback(factoryUnit, result);
            if (fn) result = typescript_runtime_default.isBlock(fn.body) ? fn.body.statements.filter(typescript_runtime_default.isReturnStatement).at(-1)?.expression : fn.body;
          }
          if (result && typescript_runtime_default.isObjectLiteralExpression(unwrap(result))) {
            const prop = unwrap(result).properties.find((p) => p.name?.getText() === fieldName);
            const value2 = prop && typescript_runtime_default.isShorthandPropertyAssignment(prop) ? prop.name : prop && typescript_runtime_default.isPropertyAssignment(prop) ? prop.initializer : void 0;
            if (value2) return operation(factoryUnit, value2, seen, depth + 1);
          }
        }
      }
      const value = lexical(node, node.text);
      if (value && typescript_runtime_default.isCallExpression(unwrap(value))) {
        const call = unwrap(value), fn = functions.get(symbol(unit, call.expression.getText()));
        if (fn) {
          const ownerUnit = functionUnits.get(fn) ?? unit;
          const result = typescript_runtime_default.isBlock(fn.body) ? fn.body.statements.filter(typescript_runtime_default.isReturnStatement).at(-1)?.expression : fn.body;
          if (result) return operation(ownerUnit, result, seen, depth + 1);
        }
      }
    }
    if (typescript_runtime_default.isCallExpression(node)) {
      if (node.arguments[0]) return operation(unit, node.arguments[0], seen, depth + 1);
    }
    return;
  }
  function transitions(unit, fn, env = /* @__PURE__ */ new Map(), seen = /* @__PURE__ */ new Set(), depth = 0) {
    if (depth > 5 || seen.has(fn)) return [];
    seen = new Set(seen).add(fn);
    const results = [];
    let blocked = false;
    const visit = (node) => {
      if (typescript_runtime_default.isFunctionLike(node) && node !== fn) return;
      if (typescript_runtime_default.isVariableDeclaration(node) && typescript_runtime_default.isIdentifier(node.name) && node.initializer) {
        const v = constant(unit, node.initializer, env);
        if (known(unit, node.initializer, env)) env.set(node.name.text, v);
      }
      if (typescript_runtime_default.isIfStatement(node)) {
        if (!known(unit, node.expression, env)) {
          walk3(node, (n) => {
            if (typescript_runtime_default.isReturnStatement(n)) blocked = true;
          });
          return;
        }
        const branch = constant(unit, node.expression, env) ? node.thenStatement : node.elseStatement;
        if (branch) visit(branch);
        return;
      }
      if (typescript_runtime_default.isSwitchStatement(node) || typescript_runtime_default.isConditionalExpression(node) || typescript_runtime_default.isAwaitExpression(node) || typescript_runtime_default.isTryStatement(node)) return;
      if (typescript_runtime_default.isCallExpression(node)) {
        const belongs = (candidate) => {
          for (let p = fn; p; p = p.parent) if (p === candidate) return true;
          return false;
        };
        const state = states.find((s) => s.unit === unit && s.setter === node.expression.getText() && belongs(s.fn));
        if (state) {
          const arg = node.arguments[0];
          if (arg) {
            const value = constant(unit, arg, env);
            if (value !== void 0) {
              if (typeof value === "object" && value !== null && !Array.isArray(value)) {
                for (const [p, v] of Object.entries(value)) if (state.site.paths.some((path) => path.join(".") === p)) results.push({ state, path: [p], value: v });
                if (state.site.paths.some((path) => !path.length)) results.push({ state, path: [], value });
              } else if (state.site.paths.some((path) => !path.length)) results.push({ state, path: [], value });
            }
            const updater = callback(unit, arg);
            if (updater && updater.parameters[0] && typescript_runtime_default.isIdentifier(updater.parameters[0].name)) {
              let body = unwrap(updater.body);
              if (typescript_runtime_default.isBlock(body)) {
                const ret = body.statements.find(typescript_runtime_default.isReturnStatement);
                body = ret?.expression ? unwrap(ret.expression) : body;
              }
              const updaterEnv = new Map(env);
              updaterEnv.set(updater.parameters[0].name.text, null);
              if (typescript_runtime_default.isBlock(unwrap(updater.body))) {
                const returns = unwrap(updater.body).statements.filter(typescript_runtime_default.isReturnStatement);
                if (returns.at(-1)?.expression) body = unwrap(returns.at(-1).expression);
              }
              const replacement = constant(unit, body, updaterEnv);
              if (replacement !== void 0 && state.site.paths.some((path) => !path.length)) results.push({ state, path: [], value: replacement });
              if (typescript_runtime_default.isObjectLiteralExpression(body)) {
                for (const p of body.properties) if (typescript_runtime_default.isPropertyAssignment(p) && !typescript_runtime_default.isComputedPropertyName(p.name)) {
                  const path = [p.name.getText().replace(/^['"]|['"]$/g, "")], v = constant(unit, p.initializer, env);
                  if (v !== void 0 && state.site.paths.some((x) => x.join(".") === path.join("."))) results.push({ state, path, value: v });
                }
              }
            }
          }
        } else {
          const remote = operation(unit, node.expression);
          if (remote) {
            const args = node.arguments.map((arg) => constant(unit, arg, env));
            const bound = /* @__PURE__ */ new Map();
            remote.fn.parameters.forEach((p, i) => {
              if (typescript_runtime_default.isIdentifier(p.name) && args[i] !== void 0) bound.set(p.name.text, args[i]);
            });
            results.push(...transitions(remote.unit, remote.fn, bound, seen, depth + 1));
          }
        }
      }
      typescript_runtime_default.forEachChild(node, visit);
    };
    visit(fn.body);
    return blocked ? [] : results;
  }
  const actions = [];
  for (const unit of units.values()) walk3(unit.ast, (node) => {
    if (!typescript_runtime_default.isJsxOpeningElement(node) && !typescript_runtime_default.isJsxSelfClosingElement(node)) return;
    const fn = owner(node);
    if (!fn) return;
    const own = functionName(fn), component = node.tagName.getText().split(".").at(-1);
    for (const attribute of attributes(node)) {
      const prop = attribute.name.getText();
      if (!/^on(?:Press|Click)(?:[A-Z].*)?$/.test(prop)) continue;
      const exp = expression(attribute), handler = callback(unit, exp);
      if (!exp) continue;
      const loc = unit.ast.getLineAndCharacterOfPosition(attribute.getStart());
      let sourceStart = node.getStart();
      for (let parent = node; parent.parent && !typescript_runtime_default.isFunctionLike(parent.parent); parent = parent.parent) {
        const container = parent.parent;
        if (typescript_runtime_default.isConditionalExpression(container)) {
          if (container.whenTrue === parent) sourceStart = container.condition.getStart();
          break;
        }
        if (typescript_runtime_default.isBinaryExpression(container) && container.operatorToken.kind === typescript_runtime_default.SyntaxKind.AmpersandAmpersandToken && container.right === parent) {
          sourceStart = container.left.getStart();
          break;
        }
      }
      const start = unit.ast.getLineAndCharacterOfPosition(sourceStart), end = unit.ast.getLineAndCharacterOfPosition(node.getEnd());
      const trigger = {};
      for (const a of attributes(node)) {
        if (!["testID", "id", "label", "accessibilityLabel"].includes(a.name.getText())) continue;
        const value = a.initializer && typescript_runtime_default.isStringLiteralLike(a.initializer) ? a.initializer.text : constant(unit, expression(a));
        if (["string", "number", "boolean"].includes(typeof value)) trigger[a.name.getText()] = value;
      }
      const base = { source: { line: start.line + 1, column: start.character, endLine: end.line + 1, endColumn: end.character }, trigger: Object.keys(trigger).length ? trigger : void 0, handler: exp && typescript_runtime_default.isIdentifier(exp) ? exp.text : void 0, id: key(`${relative3(root, unit.file)}:${attribute.pos}`), file: relative3(root, unit.file), line: loc.line + 1, owner: own, component, prop };
      const props = /* @__PURE__ */ new Map();
      const parameter = fn.parameters[0]?.name;
      if (parameter && typescript_runtime_default.isIdentifier(parameter)) props.set(parameter.text, []);
      if (parameter && typescript_runtime_default.isObjectBindingPattern(parameter)) {
        for (const e of parameter.elements) if (typescript_runtime_default.isIdentifier(e.name)) props.set(e.name.text, [e.propertyName?.getText() ?? e.name.text]);
      }
      const guard = (n) => {
        n = unwrap(n);
        if (typescript_runtime_default.isIdentifier(n) && props.has(n.text)) return { prop: props.get(n.text) };
        if (typescript_runtime_default.isPropertyAccessExpression(n)) {
          const parent = guard(n.expression);
          if (parent && "prop" in parent && !bad.test(n.name.text)) return { prop: [...parent.prop, n.name.text] };
        }
        if (typescript_runtime_default.isPrefixUnaryExpression(n) && n.operator === typescript_runtime_default.SyntaxKind.ExclamationToken) {
          const value2 = guard(n.operand);
          if (value2) return { op: "!", args: [value2] };
        }
        if (typescript_runtime_default.isBinaryExpression(n)) {
          const op = n.operatorToken.getText();
          if (["&&", "||", "===", "!==", "==", "!="].includes(op)) {
            const a = guard(n.left), b = guard(n.right);
            if (a && b) return { op, args: [a, b] };
          }
        }
        const value = constant(unit, n);
        return value !== void 0 ? { value } : void 0;
      };
      let guardedExit = false;
      const hasExit = (node2) => {
        let result = false;
        walk3(node2, (n) => {
          if (typescript_runtime_default.isReturnStatement(n)) result = true;
        });
        return result;
      };
      const exits = (node2) => typescript_runtime_default.isReturnStatement(node2) || typescript_runtime_default.isBlock(node2) && node2.statements.length === 1 && typescript_runtime_default.isReturnStatement(node2.statements[0]);
      const calls = [];
      const collect = (child, condition) => {
        if (typescript_runtime_default.isFunctionLike(child) || typescript_runtime_default.isSwitchStatement(child) || typescript_runtime_default.isTryStatement(child) || typescript_runtime_default.isAwaitExpression(child)) return;
        if (typescript_runtime_default.isBlock(child)) {
          let next = condition;
          for (const statement of child.statements) {
            collect(statement, next);
            if (typescript_runtime_default.isIfStatement(statement) && exits(statement.thenStatement)) {
              const g = guard(statement.expression);
              if (!g) {
                guardedExit = true;
                return;
              }
              const allowed = { op: "!", args: [g] };
              next = next ? { op: "&&", args: [next, allowed] } : allowed;
            }
          }
          return;
        }
        if (typescript_runtime_default.isIfStatement(child)) {
          const g = guard(child.expression);
          if (!g) {
            if (hasExit(child)) guardedExit = true;
            return;
          }
          const combine = (next) => condition ? { op: "&&", args: [condition, next] } : next;
          collect(child.thenStatement, combine(g));
          if (child.elseStatement) collect(child.elseStatement, combine({ op: "!", args: [g] }));
          return;
        }
        if (typescript_runtime_default.isConditionalExpression(child)) return;
        if (typescript_runtime_default.isCallExpression(child)) calls.push({ call: child, guard: condition });
        typescript_runtime_default.forEachChild(child, (n) => collect(n, condition));
      };
      if (handler) collect(handler.body);
      else if (typescript_runtime_default.isPropertyAccessExpression(exp)) calls.push({ call: typescript_runtime_default.factory.createCallExpression(exp, void 0, []) });
      const unsafe = handler && destructiveHandler.test(handler.body.getText());
      if (unsafe || guardedExit) continue;
      let controlAction;
      for (const candidate of calls) {
        const { call, guard: guard2 } = candidate, m = method(call.expression);
        if (!["open", "present", "show", "expand"].includes(m)) continue;
        const control = head(call.expression), reference = call.expression.getText().replace(/\?\./g, ".").includes(".current.");
        const targets2 = [];
        const visit = (child) => {
          if (typescript_runtime_default.isFunctionLike(child) && child !== fn) return;
          if (typescript_runtime_default.isJsxOpeningElement(child) || typescript_runtime_default.isJsxSelfClosingElement(child)) for (const a of attributes(child)) {
            const value = expression(a), prop2 = a.name.getText();
            if (value && value.getText() === control && (reference ? prop2 === "ref" : !/^on[A-Z]/.test(prop2))) targets2.push({ node: child, prop: prop2 });
          }
          typescript_runtime_default.forEachChild(child, visit);
        };
        visit(fn.body);
        if (targets2.length !== 1) continue;
        const target2 = targets2[0], targetComponent = target2.node.tagName.getText().split(".").at(-1);
        if (call.arguments.length) continue;
        const closes = m === "present" ? ["dismiss", "close"] : m === "show" ? ["hide", "close", "dismiss"] : m === "expand" ? ["close", "collapse", "dismiss"] : ["close", "dismiss", "hide"];
        const targetStart = unit.ast.getLineAndCharacterOfPosition(target2.node.getStart()), targetEnd = unit.ast.getLineAndCharacterOfPosition(target2.node.getEnd());
        controlAction = { ...base, id: key(`${base.id}:${targetComponent}:${call.expression.getText()}`), guard: guard2, name: targetComponent, effect: { kind: "control", component: targetComponent, prop: target2.prop, method: m, close: closes, target: { file: base.file, owner: own, line: targetStart.line + 1, source: { line: targetStart.line + 1, column: targetStart.character, endLine: targetEnd.line + 1, endColumn: targetEnd.character } } } };
        actions.push(controlAction);
      }
      if (controlAction) continue;
      if (!handler) continue;
      const changes = transitions(unit, handler);
      const supplied = changes.length === 0 ? options.openingData?.({ unit, handler, owner: fn, node }) : void 0;
      const suppliedState = supplied && states.find((s) => s.site.id === supplied.site);
      if (changes.length !== 1 && !suppliedState) continue;
      const change = changes[0] ?? { state: suppliedState, path: [], value: void 0 };
      if (change.path.some((p) => bad.test(p)) || (change.value === false || change.value === null) && !views.has(`${change.state.site.id}:${change.path.join(".")}`)) continue;
      let inferred;
      for (const view of views.get(`${change.state.site.id}:${change.path.join(".")}`) ?? []) {
        let stateValue = change.value;
        for (const part of [...view.path].reverse()) stateValue = { [part]: stateValue };
        const env = /* @__PURE__ */ new Map([[view.name, stateValue]]);
        const result = /* @__PURE__ */ new Set();
        const visit = (n) => {
          if (typescript_runtime_default.isFunctionLike(n)) return;
          if (typescript_runtime_default.isConditionalExpression(n)) {
            const condition = constant(view.unit, n.condition, env);
            if (condition !== void 0) {
              visit(condition ? n.whenTrue : n.whenFalse);
              return;
            }
          }
          if (typescript_runtime_default.isJsxOpeningElement(n) || typescript_runtime_default.isJsxSelfClosingElement(n)) {
            const name2 = n.tagName.getText();
            if (/^[A-Z]/.test(name2)) result.add(name2.split(".").at(-1));
          }
          typescript_runtime_default.forEachChild(n, visit);
        };
        visit(view.node);
        if (result.size) inferred = [...result];
      }
      const targets = inferred ?? [...guards.get(`${change.state.site.id}:${change.path.join(".")}:${JSON.stringify(change.value)}`) ?? guards.get(`${change.state.site.id}:${change.path.join(".")}`) ?? []];
      if (!targets.length) continue;
      actions.push({ ...base, ...supplied ? { input: supplied.input } : {}, name: targets.filter((name2) => !["View", "Text", "Button", "ErrorBoundary", "Modal"].includes(name2)).at(-1) ?? targets[0], effect: { kind: "state", site: change.state.site.id, path: change.path, value: change.value } });
    }
  });
  return { states: states.filter((state) => actions.some((a) => a.effect.kind === "state" && a.effect.site === state.site.id)).map((state) => state.site), actions: actions.slice(0, 1500) };
}

// packages/core/src/app-flow/views-source.ts
import { relative as relative4 } from "node:path";
var origin = (v) => {
  const candidate = v;
  return !!candidate && typeof candidate.site?.id === "string" && Array.isArray(candidate.path);
};
var origins = (v) => origin(v) ? [v] : v && "origins" in v && Array.isArray(v.origins) ? v.origins : [];
var merge = (a, b, depth = 0) => {
  if (!a) return b;
  if (!b || a === b || depth > 8) return a;
  const all = [...origins(a), ...origins(b)];
  if (all.length) {
    const values = [...new Map(all.map((v) => [JSON.stringify([v.site.id, v.path]), v])).values()];
    return values.length === 1 ? values[0] : { origins: values };
  }
  const result = { ...a };
  for (const [key2, value] of Object.entries(b)) result[key2] = merge(result[key2], value, depth + 1);
  return result;
};
var field = (v, key2) => {
  const sources = origins(v);
  if (sources.length) return sources.map((s) => ({ site: s.site, path: [...s.path, key2] })).reduce((a, b) => merge(a, b), void 0);
  return v ? v[key2] : void 0;
};
var hash = sourceHash;
var owner2 = ownerFn;
var name = (fn) => fnName(fn, { stopAtNestedFunction: false });
var defaultExport = (fn) => {
  if (fn.modifiers?.some((m) => m.kind === typescript_runtime_default.SyntaxKind.DefaultKeyword)) return true;
  for (let p = fn; p.parent && !typescript_runtime_default.isFunctionLike(p.parent) && !typescript_runtime_default.isBlock(p.parent); p = p.parent) if (typescript_runtime_default.isExportAssignment(p.parent)) return true;
  return false;
};
var attrs = jsxAttributes;
var expr = (n) => n.initializer && typescript_runtime_default.isJsxExpression(n.initializer) ? n.initializer.expression : n.initializer;
var walk2 = (n, visit) => {
  visit(n);
  typescript_runtime_default.forEachChild(n, (c) => walk2(c, visit));
};
function scanSourceViews(units, root, symbol) {
  const nodes = /* @__PURE__ */ new Map(), scopes = /* @__PURE__ */ new WeakMap();
  const initializers = /* @__PURE__ */ new WeakMap(), globals = /* @__PURE__ */ new Map();
  const fnUnits = /* @__PURE__ */ new WeakMap(), functions = /* @__PURE__ */ new Map();
  const contexts = /* @__PURE__ */ new Map(), returns = /* @__PURE__ */ new Map();
  const states = [], stateCalls = /* @__PURE__ */ new WeakMap(), enums = /* @__PURE__ */ new Map();
  const calls = /* @__PURE__ */ new Map(), types = /* @__PURE__ */ new Map();
  const scope = (node) => {
    let s = scopes.get(node);
    if (!s) {
      s = /* @__PURE__ */ new Map();
      scopes.set(node, s);
    }
    return s;
  };
  const declarationScope = (n) => {
    const blockScoped = typescript_runtime_default.isVariableDeclarationList(n.parent) && !!(n.parent.flags & typescript_runtime_default.NodeFlags.BlockScoped);
    for (let p = n.parent; p; p = p.parent) if (typescript_runtime_default.isFunctionLike(p) || blockScoped && typescript_runtime_default.isBlock(p)) return p;
    return n.getSourceFile();
  };
  const declare = (pattern, s) => {
    if (typescript_runtime_default.isIdentifier(pattern)) {
      if (!s.has(pattern.text)) s.set(pattern.text, void 0);
    } else for (const e of pattern.elements) if (typescript_runtime_default.isBindingElement(e)) declare(e.name, s);
  };
  const initializer = (unit, n) => {
    for (let p = n.parent; p; p = p.parent) if (scopes.get(p)?.has(n.text)) return initializers.get(p)?.get(n.text);
    return globals.get(unit)?.get(n.text);
  };
  const location = (unit, node) => {
    const a = unit.ast.getLineAndCharacterOfPosition(node.getStart()), b = unit.ast.getLineAndCharacterOfPosition(node.getEnd());
    return { line: a.line + 1, column: a.character, endLine: b.line + 1, endColumn: b.character };
  };
  const bind = (pattern, value, s) => {
    if (!value) return;
    if (typescript_runtime_default.isIdentifier(pattern)) {
      s.set(pattern.text, merge(s.get(pattern.text), value));
      return;
    }
    pattern.elements.forEach((e, i) => {
      if (!typescript_runtime_default.isBindingElement(e)) return;
      const key2 = e.propertyName?.getText().replace(/^['"]|['"]$/g, "") ?? (typescript_runtime_default.isArrayBindingPattern(pattern) ? String(i) : e.name.getText());
      bind(e.name, field(value, key2), s);
    });
  };
  for (const unit of units.values()) {
    const list = [];
    walk2(unit.ast, (n) => list.push(n));
    nodes.set(unit, list);
    globals.set(unit, /* @__PURE__ */ new Map());
    for (const n of list) {
      if (typescript_runtime_default.isFunctionLike(n) && "body" in n && n.body) {
        const fn2 = n;
        fnUnits.set(fn2, unit);
        for (const p of fn2.parameters) declare(p.name, scope(fn2));
        if (name(fn2) !== "default" || defaultExport(fn2)) functions.set(`${unit.file}#${name(fn2)}`, fn2);
        if (defaultExport(fn2)) functions.set(`${unit.file}#default`, fn2);
      }
      if (typescript_runtime_default.isEnumDeclaration(n)) {
        const map = /* @__PURE__ */ new Map();
        let next = 0;
        for (const m of n.members) {
          const v2 = m.initializer && typescript_runtime_default.isStringLiteralLike(m.initializer) ? m.initializer.text : m.initializer && typescript_runtime_default.isNumericLiteral(m.initializer) ? Number(m.initializer.text) : next;
          map.set(m.name.getText().replace(/^['"]|['"]$/g, ""), v2);
          if (typeof v2 === "number") next = v2 + 1;
        }
        enums.set(`${unit.file}#${n.name.text}`, map);
      }
      if (typescript_runtime_default.isTypeAliasDeclaration(n) || typescript_runtime_default.isInterfaceDeclaration(n)) types.set(`${unit.file}#${n.name.text}`, typescript_runtime_default.isTypeAliasDeclaration(n) ? n.type : n);
      if (typescript_runtime_default.isVariableDeclaration(n)) {
        const fn2 = owner2(n);
        if (fn2) {
          const container = declarationScope(n);
          declare(n.name, scope(container));
          if (typescript_runtime_default.isIdentifier(n.name) && n.initializer) {
            let values = initializers.get(container);
            if (!values) {
              values = /* @__PURE__ */ new Map();
              initializers.set(container, values);
            }
            values.set(n.name.text, n.initializer);
          }
        } else if (typescript_runtime_default.isIdentifier(n.name) && n.initializer) globals.get(unit).set(n.name.text, n.initializer);
      }
      if (!typescript_runtime_default.isVariableDeclaration(n) || !n.initializer || !typescript_runtime_default.isArrayBindingPattern(n.name)) continue;
      const call = unwrap(n.initializer), fn = owner2(n);
      if (!fn || !typescript_runtime_default.isCallExpression(call) || !/^react#use(?:State|Reducer)$/.test(symbol(unit, call.expression.getText()))) continue;
      const value = n.name.elements[0], loc = location(unit, call);
      const site = { id: sourceHash(`${relative4(root, unit.file)}:${call.pos}`), file: relative4(root, unit.file), ...loc, owner: name(fn), paths: [], hook: symbol(unit, call.expression.getText()).endsWith("useReducer") ? "useReducer" : "useState", valueName: value && typescript_runtime_default.isBindingElement(value) && typescript_runtime_default.isIdentifier(value.name) ? value.name.text : void 0 };
      states.push(site);
      const v = { 0: { site, path: [] } };
      stateCalls.set(call, v);
      calls.set(site.id, { unit, call });
      bind(n.name, v, scope(declarationScope(n)));
    }
    for (const n of list) if (typescript_runtime_default.isCallExpression(n) && !stateCalls.has(n) && /^react#use(?:State|Reducer)$/.test(symbol(unit, n.expression.getText()))) {
      const fn = owner2(n);
      if (!fn) continue;
      const loc = location(unit, n);
      const site = { id: sourceHash(`${relative4(root, unit.file)}:${n.pos}`), file: relative4(root, unit.file), ...loc, owner: name(fn), paths: [], hook: symbol(unit, n.expression.getText()).endsWith("useReducer") ? "useReducer" : "useState" };
      states.push(site);
      stateCalls.set(n, { 0: { site, path: [] } });
      calls.set(site.id, { unit, call: n });
    }
  }
  function read(unit, n, fn = n && owner2(n), seen = /* @__PURE__ */ new Set(), depth = 0) {
    if (!n || depth > 10 || seen.has(n)) return;
    n = unwrap(n);
    seen = new Set(seen).add(n);
    if (stateCalls.has(n)) return stateCalls.get(n);
    if (typescript_runtime_default.isIdentifier(n)) {
      for (let p = n.parent; p; p = p.parent) if (scopes.get(p)?.has(n.text)) return scopes.get(p).get(n.text);
      return read(unit, initializer(unit, n), fn, seen, depth + 1);
    }
    if (typescript_runtime_default.isPropertyAccessExpression(n) || typescript_runtime_default.isElementAccessExpression(n)) {
      const value = read(unit, n.expression, fn, seen, depth + 1), key2 = typescript_runtime_default.isPropertyAccessExpression(n) ? n.name.text : n.argumentExpression && typescript_runtime_default.isStringLiteralLike(n.argumentExpression) ? n.argumentExpression.text : void 0;
      return value && key2 !== void 0 ? field(value, key2) : void 0;
    }
    if (typescript_runtime_default.isObjectLiteralExpression(n)) {
      const v = {};
      for (const p of n.properties) {
        if (typescript_runtime_default.isPropertyAssignment(p)) v[p.name.getText().replace(/^['"]|['"]$/g, "")] = read(unit, p.initializer, fn, seen, depth + 1);
        else if (typescript_runtime_default.isShorthandPropertyAssignment(p)) v[p.name.text] = read(unit, p.name, fn, seen, depth + 1);
      }
      return v;
    }
    if (typescript_runtime_default.isArrayLiteralExpression(n)) return Object.fromEntries(n.elements.map((e, i) => [String(i), read(unit, e, fn, seen, depth + 1)]));
    if (typescript_runtime_default.isCallExpression(n)) {
      if (/(?:^|\.)useContext$/.test(n.expression.getText()) && n.arguments[0]) return contexts.get(symbol(unit, n.arguments[0].getText()));
      const first = n.arguments[0] && unwrap(n.arguments[0]);
      if (first && (typescript_runtime_default.isArrowFunction(first) || typescript_runtime_default.isFunctionExpression(first))) return read(unit, typescript_runtime_default.isBlock(first.body) ? first.body.statements.filter(typescript_runtime_default.isReturnStatement).at(-1)?.expression : first.body, fn, seen, depth + 1);
      return returns.get(symbol(unit, n.expression.getText()));
    }
  }
  const consumers = (value, fn, depth = 0) => {
    if (!value || !fn || depth > 8) return;
    const own = name(fn);
    if (!/^[A-Z]/.test(own) && own !== "default") return;
    const sources = origins(value);
    if (sources.length) for (const v of sources) {
      const owners = v.site.owners ??= [];
      if (!owners.includes(own)) owners.push(own);
      const ownerSites = v.site.ownerSites ??= [], file = relative4(root, fnUnits.get(fn)?.file ?? fn.getSourceFile().fileName);
      if (!ownerSites.some((site) => site.file === file && site.owner === own)) ownerSites.push({ file, owner: own });
    }
    else for (const v of Object.values(value)) consumers(v, fn, depth + 1);
  };
  for (let pass = 0; pass < 6; pass++) for (const [unit, list] of nodes) for (const n of list) {
    const fn = owner2(n);
    if (typescript_runtime_default.isVariableDeclaration(n) && n.initializer && fn) {
      const value2 = read(unit, n.initializer, fn);
      consumers(value2, fn);
      bind(n.name, value2, scope(declarationScope(n)));
    }
    if (typescript_runtime_default.isReturnStatement(n) && n.expression && fn) {
      const v = read(unit, n.expression, fn), key2 = `${unit.file}#${name(fn)}`;
      if (v && functions.get(key2) === fn) returns.set(key2, merge(returns.get(key2), v));
    }
    if (typescript_runtime_default.isArrowFunction(n) && !typescript_runtime_default.isBlock(n.body)) {
      const v = read(unit, n.body, n), key2 = `${unit.file}#${name(n)}`;
      if (v && functions.get(key2) === n) returns.set(key2, merge(returns.get(key2), v));
    }
    if (!typescript_runtime_default.isJsxOpeningElement(n) && !typescript_runtime_default.isJsxSelfClosingElement(n)) continue;
    const tag = n.tagName.getText(), value = attrs(n).find((a) => a.name.getText() === "value");
    if (value) {
      const v = read(unit, expr(value), fn), key2 = symbol(unit, tag.replace(/\.Provider$/, ""));
      if (v) contexts.set(key2, merge(contexts.get(key2), v));
    }
    const target2 = functions.get(symbol(unit, tag));
    if (!target2 || !target2.parameters[0]) continue;
    const props = {};
    for (const a of attrs(n)) {
      const v = read(unit, expr(a), fn);
      if (v) props[a.name.getText()] = v;
    }
    bind(target2.parameters[0].name, props, scope(target2));
  }
  function finite(unit, n, depth = 0) {
    if (!n || depth > 10) return;
    n = unwrap(n);
    if (typescript_runtime_default.isStringLiteralLike(n)) return n.text;
    if (typescript_runtime_default.isNumericLiteral(n)) return Number(n.text);
    if (n.kind === typescript_runtime_default.SyntaxKind.TrueKeyword) return true;
    if (n.kind === typescript_runtime_default.SyntaxKind.FalseKeyword) return false;
    if (typescript_runtime_default.isIdentifier(n)) return finite(unit, initializer(unit, n), depth + 1);
    if (typescript_runtime_default.isPropertyAccessExpression(n)) return enums.get(symbol(unit, n.expression.getText()))?.get(n.name.text);
    if (typescript_runtime_default.isPrefixUnaryExpression(n) && n.operator === typescript_runtime_default.SyntaxKind.ExclamationToken) {
      const v = finite(unit, n.operand, depth + 1);
      return v === void 0 ? void 0 : !v;
    }
    if (typescript_runtime_default.isBinaryExpression(n)) {
      const a = finite(unit, n.left, depth + 1), b = finite(unit, n.right, depth + 1);
      switch (n.operatorToken.kind) {
        case typescript_runtime_default.SyntaxKind.AmpersandAmpersandToken:
          return a === false ? false : a === true ? b : void 0;
        case typescript_runtime_default.SyntaxKind.BarBarToken:
          return a === true ? true : a === false ? b : void 0;
        case typescript_runtime_default.SyntaxKind.EqualsEqualsEqualsToken:
          return a !== void 0 && b !== void 0 ? a === b : void 0;
        case typescript_runtime_default.SyntaxKind.ExclamationEqualsEqualsToken:
          return a !== void 0 && b !== void 0 ? a !== b : void 0;
      }
    }
  }
  const universe = (v, comparison) => {
    if (comparison && typescript_runtime_default.isPropertyAccessExpression(comparison)) {
      const values = enums.get(symbol(fnUnits.get(owner2(comparison)), comparison.expression.getText()));
      if (values) return [...values.values()];
    }
    const bound = calls.get(v.site.id);
    if (!bound) return [];
    const reducer = bound.call.arguments[0] && functions.get(symbol(bound.unit, bound.call.arguments[0].getText()));
    let type = bound.call.typeArguments?.[0] ?? reducer?.parameters[0]?.type ?? reducer?.type;
    const unit = reducer ? fnUnits.get(reducer) ?? bound.unit : bound.unit;
    const follow = (n2, depth = 0) => n2 && depth < 8 && typescript_runtime_default.isTypeReferenceNode(n2) ? follow(types.get(symbol(unit, n2.typeName.getText())), depth + 1) : n2;
    for (const part of v.path) {
      const n2 = follow(type);
      if (!n2 || !typescript_runtime_default.isTypeLiteralNode(n2) && !typescript_runtime_default.isInterfaceDeclaration(n2)) return [];
      const prop = n2.members.find((m) => typescript_runtime_default.isPropertySignature(m) && m.name.getText() === part);
      type = prop && typescript_runtime_default.isPropertySignature(prop) ? prop.type : void 0;
    }
    const n = follow(type);
    return n && typescript_runtime_default.isUnionTypeNode(n) ? n.types.flatMap((t) => typescript_runtime_default.isLiteralTypeNode(t) ? [finite(unit, t.literal)] : []) : n?.kind === typescript_runtime_default.SyntaxKind.BooleanKeyword ? [true, false] : [];
  };
  const truth = (unit, n, v, value, depth = 0) => {
    if (depth > 8) return void 0;
    n = unwrap(n);
    const readValue = origins(read(unit, n));
    if (readValue.some((r) => r.site.id === v.site.id && JSON.stringify(r.path) === JSON.stringify(v.path))) return value;
    if (typescript_runtime_default.isPrefixUnaryExpression(n) && n.operator === typescript_runtime_default.SyntaxKind.ExclamationToken) {
      const a = truth(unit, n.operand, v, value, depth + 1);
      return a === void 0 ? void 0 : !a;
    }
    if (typescript_runtime_default.isBinaryExpression(n)) {
      const a = truth(unit, n.left, v, value, depth + 1), b = truth(unit, n.right, v, value, depth + 1), op = n.operatorToken.kind;
      if (op === typescript_runtime_default.SyntaxKind.AmpersandAmpersandToken && (a !== void 0 && !a || b !== void 0 && !b)) return false;
      if (op === typescript_runtime_default.SyntaxKind.BarBarToken) {
        if (a !== void 0 && a) return a;
        if (b !== void 0 && b) return b;
      }
      if (a === void 0 || b === void 0) return void 0;
      switch (op) {
        case typescript_runtime_default.SyntaxKind.EqualsEqualsEqualsToken:
        case typescript_runtime_default.SyntaxKind.EqualsEqualsToken:
          return a === b;
        case typescript_runtime_default.SyntaxKind.ExclamationEqualsEqualsToken:
        case typescript_runtime_default.SyntaxKind.ExclamationEqualsToken:
          return a !== b;
        case typescript_runtime_default.SyntaxKind.AmpersandAmpersandToken:
          return a && b;
        case typescript_runtime_default.SyntaxKind.BarBarToken:
          return a || b;
      }
    }
    return finite(unit, n);
  };
  const possible = (unit, body, v, value) => {
    for (let p = body; p.parent && !typescript_runtime_default.isFunctionLike(p.parent); p = p.parent) {
      const parent = p.parent;
      if (typescript_runtime_default.isConditionalExpression(parent)) {
        const b = truth(unit, parent.condition, v, value);
        if (b !== void 0 && (parent.whenTrue === p && !b || parent.whenFalse === p && b)) return false;
      }
      if (typescript_runtime_default.isBinaryExpression(parent) && parent.right === p && parent.operatorToken.kind === typescript_runtime_default.SyntaxKind.AmpersandAmpersandToken) {
        const b = truth(unit, parent.left, v, value);
        if (b !== void 0 && !b) return false;
      }
    }
    return true;
  };
  const mountable = (fn) => {
    const own = name(fn);
    if (!/^[A-Z]/.test(own)) return;
    const isDefault = defaultExport(fn);
    let exported = !!fn.modifiers?.some((m) => m.kind === typescript_runtime_default.SyntaxKind.ExportKeyword);
    for (let parent = fn; parent.parent && !typescript_runtime_default.isFunctionLike(parent.parent); parent = parent.parent) {
      if (typescript_runtime_default.isVariableStatement(parent)) exported ||= !!parent.modifiers?.some((m) => m.kind === typescript_runtime_default.SyntaxKind.ExportKeyword);
    }
    if (!exported && !isDefault) return;
    const optional = (type, seen = /* @__PURE__ */ new Set()) => {
      if (!type) return false;
      const context = units.get(type.getSourceFile().fileName);
      if (!context) return false;
      if (typescript_runtime_default.isTypeReferenceNode(type)) {
        const key2 = symbol(context, type.typeName.getText());
        if (seen.has(key2)) return false;
        return optional(types.get(key2), new Set(seen).add(key2));
      }
      if (typescript_runtime_default.isIntersectionTypeNode(type)) return type.types.every((part) => optional(part, seen));
      if (!typescript_runtime_default.isTypeLiteralNode(type) && !typescript_runtime_default.isInterfaceDeclaration(type)) return false;
      if (type.members.some((member) => !typescript_runtime_default.isPropertySignature(member) || !member.questionToken)) return false;
      if (typescript_runtime_default.isInterfaceDeclaration(type) && type.heritageClauses?.some((clause) => clause.types.some((base) => {
        const key2 = symbol(context, base.expression.getText());
        return seen.has(key2) || !optional(types.get(key2), new Set(seen).add(key2));
      }))) return false;
      return true;
    };
    for (const parameter of fn.parameters) {
      if (parameter.dotDotDotToken) return;
      if (!parameter.initializer && !parameter.questionToken && !optional(parameter.type)) return;
    }
    return { export: isDefault ? "default" : own };
  };
  const controlOwners = /* @__PURE__ */ new WeakMap();
  const parameterCache = /* @__PURE__ */ new WeakMap();
  const parameterBindings = (fn) => {
    const cached2 = parameterCache.get(fn);
    if (cached2) return cached2;
    const result = /* @__PURE__ */ new Map();
    const visit = (binding, path) => {
      if (typescript_runtime_default.isIdentifier(binding)) {
        result.set(binding.text, path);
        return;
      }
      for (const [index, item] of binding.elements.entries()) if (typescript_runtime_default.isBindingElement(item) && !item.dotDotDotToken) {
        const key2 = item.propertyName?.getText().replace(/^['"]|['"]$/g, "") ?? (typescript_runtime_default.isArrayBindingPattern(binding) ? String(index) : item.name.getText());
        visit(item.name, [...path, key2]);
      }
    };
    if (fn.parameters[0]) visit(fn.parameters[0].name, []);
    parameterCache.set(fn, result);
    return result;
  };
  const parameterPath = (unit, fn, node, seen = /* @__PURE__ */ new Set()) => {
    node = unwrap(node);
    if (seen.has(node)) return;
    seen = new Set(seen).add(node);
    if (typescript_runtime_default.isIdentifier(node)) {
      for (let parent = node.parent; parent; parent = parent.parent) if (scopes.get(parent)?.has(node.text)) {
        if (parent === fn) {
          const bound = parameterBindings(fn).get(node.text);
          if (bound) return bound;
        }
        const value = initializers.get(parent)?.get(node.text);
        return value ? parameterPath(unit, fn, value, seen) : void 0;
      }
    }
    if (typescript_runtime_default.isPropertyAccessExpression(node) || typescript_runtime_default.isElementAccessExpression(node)) {
      const path = parameterPath(unit, fn, node.expression, seen), key2 = typescript_runtime_default.isPropertyAccessExpression(node) ? node.name.text : node.argumentExpression && typescript_runtime_default.isStringLiteralLike(node.argumentExpression) ? node.argumentExpression.text : void 0;
      if (path && key2 !== void 0) return [...path, key2];
    }
  };
  const ownsControl = (unit, fn, prop, seen = /* @__PURE__ */ new Set()) => {
    const key2 = `${unit.file}#${name(fn)}:${prop}`;
    if (seen.has(key2)) return;
    seen = new Set(seen).add(key2);
    const cached2 = controlOwners.get(fn);
    if (cached2?.has(prop)) return cached2.get(prop);
    let owned = false, unknown = false, jsx = false;
    walk2(fn.body, (node) => {
      if (typescript_runtime_default.isCallExpression(node) && symbol(unit, node.expression.getText()) === "react#useImperativeHandle" && node.arguments[0] && parameterPath(unit, fn, node.arguments[0])?.[0] === prop) owned = true;
      if (!typescript_runtime_default.isJsxOpeningElement(node) && !typescript_runtime_default.isJsxSelfClosingElement(node)) return;
      jsx = true;
      for (const attribute of node.attributes.properties) if (typescript_runtime_default.isJsxSpreadAttribute(attribute)) {
        const path = parameterPath(unit, fn, attribute.expression);
        if (path && (!path.length || path[0] === prop)) unknown = true;
      }
      for (const attribute of attrs(node)) {
        const targetProp = attribute.name.getText(), value = expr(attribute);
        if (!value || /^on[A-Z]/.test(targetProp) || parameterPath(unit, fn, value)?.[0] !== prop) continue;
        if (targetProp === "ref") {
          owned = true;
          continue;
        }
        const target2 = functions.get(symbol(unit, node.tagName.getText()));
        const result2 = target2 ? ownsControl(fnUnits.get(target2), target2, targetProp, seen) : void 0;
        if (result2 === true) owned = true;
        else if (result2 === void 0) unknown = true;
      }
    });
    const result = owned ? true : unknown || !jsx ? void 0 : false;
    const values = cached2 ?? /* @__PURE__ */ new Map();
    values.set(prop, result);
    controlOwners.set(fn, values);
    return result;
  };
  const outboundControl = (unit, node, prop) => {
    const target2 = functions.get(symbol(unit, node.tagName.getText()));
    if (!target2) return false;
    const targetUnit = fnUnits.get(target2);
    if (ownsControl(targetUnit, target2, prop) !== false) return false;
    const props = new Set([...parameterBindings(target2).values()].map((path) => path[0]).filter(Boolean));
    walk2(target2.body, (child) => {
      if (typescript_runtime_default.isPropertyAccessExpression(child)) {
        const path = parameterPath(targetUnit, target2, child);
        if (path?.[0]) props.add(path[0]);
      }
    });
    return [...props].some((other) => other !== prop && ownsControl(targetUnit, target2, other) === true);
  };
  const views = /* @__PURE__ */ new Map();
  const reachable = (unit, node) => {
    for (let p = node; p.parent; p = p.parent) {
      const parent = p.parent;
      if (typescript_runtime_default.isConditionalExpression(parent)) {
        const value = finite(unit, parent.condition);
        if (value !== void 0 && (parent.whenTrue === p && !value || parent.whenFalse === p && value)) return false;
      }
      if (typescript_runtime_default.isIfStatement(parent)) {
        const value = finite(unit, parent.expression);
        if (value !== void 0 && (parent.thenStatement === p && !value || parent.elseStatement === p && value)) return false;
      }
      if (typescript_runtime_default.isBinaryExpression(parent) && parent.right === p && parent.operatorToken.kind === typescript_runtime_default.SyntaxKind.AmpersandAmpersandToken && finite(unit, parent.left) === false) return false;
    }
    return true;
  };
  const parts = (unit, body, state) => {
    const result = /* @__PURE__ */ new Map(), site = state && states.find((s) => s.id === state.site);
    const visit = (n) => {
      if (typescript_runtime_default.isFunctionLike(n)) return;
      if (typescript_runtime_default.isJsxOpeningElement(n) || typescript_runtime_default.isJsxSelfClosingElement(n)) {
        const ref = state && site ? { site, path: state.path } : void 0;
        if (ref && !possible(unit, n, ref, state.value)) return;
        const tag = n.tagName.getText();
        if (/^[A-Z]/.test(tag)) {
          const resolved = symbol(unit, tag), split = resolved.lastIndexOf("#");
          if (split >= 0 && units.has(resolved.slice(0, split))) {
            let guards = 0;
            if (ref) for (let p = n; p.parent && !typescript_runtime_default.isFunctionLike(p.parent); p = p.parent) {
              const parent = p.parent;
              const condition = typescript_runtime_default.isConditionalExpression(parent) ? parent.condition : typescript_runtime_default.isIfStatement(parent) ? parent.expression : typescript_runtime_default.isBinaryExpression(parent) && parent.right === p && parent.operatorToken.kind === typescript_runtime_default.SyntaxKind.AmpersandAmpersandToken ? parent.left : void 0;
              if (condition && truth(unit, condition, ref, state.value) === void 0) guards++;
            }
            const item = { file: relative4(root, resolved.slice(0, split)), component: resolved.slice(split + 1), entry: { file: relative4(root, unit.file), source: location(unit, n) }, ...ref ? { guards } : {} }, previous = result.get(resolved);
            if (!previous || (item.guards ?? 0) < (previous.guards ?? 0)) result.set(resolved, item);
          }
        }
      }
      typescript_runtime_default.forEachChild(n, visit);
    };
    visit(body);
    return [...result.values()];
  };
  const add = (unit, body, kind, extra) => {
    const loc = location(unit, body), fn = owner2(body);
    if (!fn || !reachable(unit, body)) return;
    let jsx = false;
    walk2(body, (n) => {
      if (typescript_runtime_default.isJsxElement(n) || typescript_runtime_default.isJsxOpeningElement(n) || typescript_runtime_default.isJsxSelfClosingElement(n)) jsx = true;
    });
    if (!jsx) return;
    const components2 = parts(unit, body, extra.state), file = relative4(root, unit.file), own = name(fn);
    const identity = extra.state ? ["state", extra.state] : [file, own, loc, kind, extra.control, extra.branch];
    const id2 = hash(identity), existing = views.get(id2);
    const renderBody = typescript_runtime_default.isCaseClause(body) || typescript_runtime_default.isReturnStatement(body) || typescript_runtime_default.isBlock(body) && body.statements.some(typescript_runtime_default.isReturnStatement) || (() => {
      for (let p = body; p.parent && !typescript_runtime_default.isFunctionLike(p.parent); p = p.parent) {
        if (typescript_runtime_default.isReturnStatement(p.parent)) return true;
        if (typescript_runtime_default.isJsxElement(p.parent) || typescript_runtime_default.isJsxFragment(p.parent)) return false;
      }
      return false;
    })();
    let renderFn = fn;
    for (let parent = fn; !(/^[A-Z]/.test(name(parent)) || defaultExport(parent)); ) {
      const enclosing = owner2(parent);
      if (!enclosing) break;
      renderFn = parent = enclosing;
    }
    const callback = renderFn !== fn;
    const render = {
      file,
      owner: name(renderFn),
      line: loc.line,
      source: loc,
      components: components2.map((component) => ({ ...component, ...callback ? { guards: (component.guards ?? 0) + (fn.parameters.length ? 1 : 0) } : {} })),
      renderBody: !callback && renderBody,
      ...callback ? { callbackOwner: own } : {},
      ...extra.branch ? { branch: extra.branch } : {}
    };
    if (existing) {
      existing.renders.push(render);
      existing.renderBody ||= renderBody;
      if (!existing.components.length && components2.length) existing.name = components2[0].component;
      for (const p of components2) {
        const prior = existing.components.find((c) => c.file === p.file && c.component === p.component);
        if (!prior) existing.components.push(p);
        else if (p.guards !== void 0) prior.guards = Math.min(prior.guards ?? p.guards, p.guards);
      }
      return;
    }
    views.set(id2, { id: id2, file, owner: own, line: loc.line, source: loc, kind, name: components2[0]?.component ?? own, components: components2.map((component) => ({ ...component })), availability: "observed-only", renderBody, renders: [render], ...extra });
  };
  const stateBranch = (unit, condition, body, side) => {
    let predicate = unwrap(condition), invert = side === "false";
    if (typescript_runtime_default.isIdentifier(predicate)) {
      const declaration = initializer(unit, predicate);
      if (declaration) predicate = unwrap(declaration);
    }
    while (typescript_runtime_default.isPrefixUnaryExpression(predicate) && predicate.operator === typescript_runtime_default.SyntaxKind.ExclamationToken) {
      invert = !invert;
      predicate = unwrap(predicate.operand);
    }
    const operands = [];
    const collect = (n) => {
      if (typescript_runtime_default.isBinaryExpression(n) && [typescript_runtime_default.SyntaxKind.AmpersandAmpersandToken, typescript_runtime_default.SyntaxKind.BarBarToken].includes(n.operatorToken.kind)) {
        collect(n.left);
        collect(n.right);
      } else operands.push(n);
    };
    collect(predicate);
    for (const p of operands) {
      let ref = p, value = !invert;
      let alternative = false, comparison;
      if (typescript_runtime_default.isBinaryExpression(p) && [typescript_runtime_default.SyntaxKind.EqualsEqualsEqualsToken, typescript_runtime_default.SyntaxKind.EqualsEqualsToken, typescript_runtime_default.SyntaxKind.ExclamationEqualsEqualsToken, typescript_runtime_default.SyntaxKind.ExclamationEqualsToken].includes(p.operatorToken.kind)) {
        const right = finite(unit, p.right), left = finite(unit, p.left);
        ref = right !== void 0 ? p.left : p.right;
        value = right ?? left;
        comparison = right !== void 0 ? p.right : p.left;
        const unequal = [typescript_runtime_default.SyntaxKind.ExclamationEqualsEqualsToken, typescript_runtime_default.SyntaxKind.ExclamationEqualsToken].includes(p.operatorToken.kind);
        if (invert !== unequal) {
          if (typeof value === "boolean") value = !value;
          else alternative = true;
        }
      }
      for (const v of origins(read(unit, ref))) {
        if (value === void 0) continue;
        if (!v.site.paths.some((path) => JSON.stringify(path) === JSON.stringify(v.path))) v.site.paths.push(v.path);
        const values = alternative ? universe(v, comparison).filter((item) => item !== value) : [value];
        for (const item of values) if (possible(unit, body, v, item)) add(unit, body, "state", { state: { site: v.site.id, path: v.path, value: item }, branch: { condition: condition.getText(), side } });
      }
    }
  };
  for (const [unit, list] of nodes) for (const n of list) {
    if (typescript_runtime_default.isConditionalExpression(n)) {
      for (const [side, body] of [["true", n.whenTrue], ["false", n.whenFalse]]) {
        add(unit, body, "branch", { branch: { condition: n.condition.getText(), side } });
        stateBranch(unit, n.condition, body, side);
      }
    }
    if (typescript_runtime_default.isBinaryExpression(n) && n.operatorToken.kind === typescript_runtime_default.SyntaxKind.AmpersandAmpersandToken) {
      add(unit, n.right, "branch", { branch: { condition: n.left.getText(), side: "true" } });
      stateBranch(unit, n.left, n.right, "true");
    }
    if (typescript_runtime_default.isIfStatement(n)) {
      add(unit, n.thenStatement, "branch", { branch: { condition: n.expression.getText(), side: "true" } });
      stateBranch(unit, n.expression, n.thenStatement, "true");
      let other = n.elseStatement;
      if (!other && typescript_runtime_default.isBlock(n.parent)) {
        const statements = n.parent.statements;
        const exits = typescript_runtime_default.isReturnStatement(n.thenStatement) || typescript_runtime_default.isBlock(n.thenStatement) && n.thenStatement.statements.some(typescript_runtime_default.isReturnStatement);
        if (exits) other = statements.slice(statements.indexOf(n) + 1).filter(typescript_runtime_default.isReturnStatement).at(-1);
      }
      if (other) {
        add(unit, other, "branch", { branch: { condition: n.expression.getText(), side: "false" } });
        stateBranch(unit, n.expression, other, "false");
      }
    }
    if (typescript_runtime_default.isSwitchStatement(n)) {
      for (const v of origins(read(unit, n.expression))) for (const c of n.caseBlock.clauses) if (typescript_runtime_default.isCaseClause(c)) {
        const value = finite(unit, c.expression);
        if (value !== void 0) {
          v.site.paths.push(v.path);
          add(unit, c, "state", { state: { site: v.site.id, path: v.path, value }, branch: { condition: n.expression.getText(), side: "case" } });
        }
      }
    }
    if (typescript_runtime_default.isFunctionLike(n) && "body" in n && n.body && (/^[A-Z]/.test(name(n)) || defaultExport(n))) add(unit, n.body, "component", { owner: name(n), name: name(n), mount: mountable(n) });
    if (typescript_runtime_default.isJsxOpeningElement(n) || typescript_runtime_default.isJsxSelfClosingElement(n)) {
      for (const a of attrs(n)) {
        const prop = a.name.getText(), e = expr(a);
        if (!e || /^on[A-Z]/.test(prop)) continue;
        if (/^(?:control|.*Control|controller|ref)$/.test(prop)) {
          let boundary = true;
          for (let p = n.parent; p && p !== owner2(n); p = p.parent) if (typescript_runtime_default.isJsxElement(p) && p.openingElement !== n && attrs(p.openingElement).some((a2) => /^(?:control|.*Control|controller|ref)$/.test(a2.name.getText()))) boundary = false;
          add(unit, n, "control", { control: { component: n.tagName.getText().split(".").at(-1), prop, boundary: boundary && !outboundControl(unit, n, prop), generic: n.tagName.getText().includes(".") } });
        }
        const index = attrs(n).find((p) => p.name.getText() === "index");
        if (index) for (const v of origins(read(unit, e))) {
          const value = finite(unit, expr(index));
          if (value !== void 0) {
            v.site.paths.push(v.path);
            add(unit, n, "state", { state: { site: v.site.id, path: v.path, value } });
          }
        }
      }
    }
  }
  const entries = /* @__PURE__ */ new Map();
  for (const [unit, list] of nodes) for (const n of list) if ((typescript_runtime_default.isJsxOpeningElement(n) || typescript_runtime_default.isJsxSelfClosingElement(n)) && reachable(unit, n)) {
    let target2 = symbol(unit, n.tagName.getText());
    const fn = owner2(n), callee = functions.get(target2);
    if (callee) target2 = `${fnUnits.get(callee).file}#${name(callee)}`;
    if (!fn) continue;
    const list2 = entries.get(target2) ?? [], source = location(unit, n);
    list2.push({ file: relative4(root, unit.file), line: source.line, owner: name(fn), source });
    entries.set(target2, list2);
  }
  for (const view of views.values()) if (view.kind === "component") view.entries = entries.get(`${root}/${view.file}#${view.owner}`) ?? [];
  for (const site of states) {
    const sources = [{ file: site.file, owner: site.owner }, ...site.ownerSites ?? []];
    const callers = sources.flatMap((source) => (entries.get(`${root}/${source.file}#${source.owner}`) ?? []).flatMap((entry) => entry.source ? [{ component: source.owner, file: entry.file, owner: entry.owner, source: entry.source }] : []));
    if (callers.length) site.ownerEntries = [...new Map(callers.map((entry) => [JSON.stringify(entry), entry])).values()];
  }
  return { states: states.filter((site) => site.paths.length), views: [...views.values()] };
}

// packages/core/src/app-flow/explore-ui-run.ts
var SETUP_TIMEOUT_MS = 2e4;
var LIST_TIMEOUT_MS = 2e3;
var OPEN_TIMEOUT_MS = 5e3;
var CONTENT_TIMEOUT_MS = 2e3;
var UI_STATE_SETTLE_TIMEOUT_MS = 4e3;
var SKIPPED_DIRECTORIES = /* @__PURE__ */ new Set([
  "node_modules",
  ".git",
  "ios",
  "android",
  "build",
  "dist",
  ".expo",
  ".next",
  "coverage",
  "vendor"
]);
var SOURCE_EXTENSIONS = /\.(tsx|ts|jsx|js)$/;
var MAX_SOURCE_FILES = 4e3;
var MAX_SOURCE_BYTES = 512e3;
async function collectProjectSources(root) {
  const sources = [];
  const walk3 = async (dir) => {
    if (sources.length >= MAX_SOURCE_FILES) return;
    const entries = await readdir5(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (sources.length >= MAX_SOURCE_FILES) return;
      const path = join9(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith(".") || SKIPPED_DIRECTORIES.has(entry.name)) continue;
        await walk3(path);
        continue;
      }
      if (!SOURCE_EXTENSIONS.test(entry.name) || /\.d\.ts$/.test(entry.name)) continue;
      if (/\.(test|spec)\.[tj]sx?$/.test(entry.name)) continue;
      const text2 = await readFile5(path, "utf8").catch(() => null);
      if (text2 === null || text2.length > MAX_SOURCE_BYTES) continue;
      sources.push({ file: path, text: text2 });
    }
  };
  await walk3(root);
  return sources;
}
async function buildPresentationCatalog(root) {
  setTypeScriptProject(root);
  const units = createSourceUnits(await collectProjectSources(root));
  const symbol = createSymbolResolver(units, { root });
  const found = scanPresentations(units, root, symbol);
  const views = scanSourceViews(units, root, symbol);
  return addSourcePreviewPlans({ ...found, views: views.views, viewStates: views.states });
}
function createExploreUiPorts(options) {
  const { catalog } = options;
  const command = async (payload, timeoutMs, operation) => {
    const started = performance.now();
    try {
      return await options.runtime.invoke(payload, timeoutMs);
    } finally {
      recordRuntimeTiming("app_flow.runtime.command", performance.now() - started, { operation });
    }
  };
  return {
    runtime: {
      setup: (catalogue) => command(
        {
          type: "presentation-setup",
          states: catalogue.states,
          actions: catalogue.actions,
          projectRoot: options.projectPath
        },
        SETUP_TIMEOUT_MS,
        "presentation-setup"
      ),
      configure: (matches, checked) => command(
        {
          type: "presentation-configure",
          matches: [...matches],
          ...checked?.length ? { checked: [...checked] } : {}
        },
        LIST_TIMEOUT_MS,
        "presentation-configure"
      ),
      list: () => command({ type: "presentations" }, LIST_TIMEOUT_MS, "presentations"),
      open: (id2) => command({ type: "presentation-open", id: id2 }, OPEN_TIMEOUT_MS, "presentation-open"),
      // Above the in-app deadlines it confirms against (2000ms modal dismissal, 4000ms control
      // close), so a slow but successful unwind is never cut off by the transport.
      content: (expected) => command(
        { type: "presentation-content", expected },
        CONTENT_TIMEOUT_MS,
        "presentation-content"
      ),
      rollback: (level) => command(
        { type: "presentation-rollback", level, wait: true },
        EXPLORE_UI_ROLLBACK_TIMEOUT_MS,
        "presentation-rollback"
      )
    },
    // The same merged state/action set `presentation-setup` was given, so a binding resolved here
    // names a site the device also knows about.
    bind: (bindings, report) => bindPresentationSites(
      options.projectPath,
      [...bindings],
      {
        states: [...catalog.states, ...catalog.previewStates ?? [], ...catalog.viewStates ?? []],
        actions: [...catalog.actions, ...catalog.previews ?? []]
      },
      {
        metroOrigin: `http://localhost:${options.device.metroPort}`,
        ...options.signal ? { signal: options.signal } : {},
        readSource: (file) => readFile5(file, "utf8").catch(() => void 0),
        ...report ? { report } : {}
      }
    ),
    focusedRoute: async () => {
      const reply = await command({ type: "nav-state" }, LIST_TIMEOUT_MS, "nav-state");
      const routes = reply?.routes ?? null;
      return routes?.length ? routes[routes.length - 1].name ?? null : null;
    },
    // The same settle the Fast delivery path waits on — a frame the app has stopped changing,
    // with enough interactive elements to be the presentation rather than its transition.
    settle: async () => {
      await settleAfterRoute(options.ctx, options.device, options.signal, UI_STATE_SETTLE_TIMEOUT_MS, {
        minInteractiveElements: 1
      });
    },
    screenshot: async (slug) => {
      const path = getScreenshotPath(options.projectId, slug);
      const { relaunched } = await captureScreenshot(options.ctx, options.device, path);
      if (relaunched) {
        throw new Error("The app restarted while this UI state was being photographed.");
      }
      return `screens/${slug}.png`;
    },
    emit: options.emit,
    ...options.signal ? { signal: options.signal } : {}
  };
}
async function openSweepUiStateSession(options) {
  const catalog = await buildPresentationCatalog(options.projectPath);
  if (!catalog.actions.length && !(catalog.previews ?? []).length) {
    throw new ExpectedOperationError("invalid_input", "No UI states were found in this project\u2019s source.");
  }
  return { catalog, ports: createExploreUiPorts({ ...options, catalog }) };
}
async function connectToLaunchedApp(options, appName) {
  const started = performance.now();
  let connection = null;
  try {
    const targets = await listMetroTargets(options.device.metroPort, { signal: options.signal });
    const normalize = (value) => (value ?? "").toLowerCase().replace(/[^a-z\d]/g, "");
    const app = normalize(appName);
    const candidates = targets.filter((target3) => target3.supportsMultipleDebuggers).filter(
      (target3) => target3.deviceId === options.device.deviceId || !!target3.deviceName && normalize(target3.deviceName) === normalize(options.device.deviceName)
    );
    const target2 = candidates.find(
      (candidate) => !app || normalize(candidate.title) === app || normalize(candidate.appId) === app
    ) ?? (candidates.length === 1 ? candidates[0] : null);
    if (!target2) {
      throw new Error(
        "No running app could be reached through Metro. Launch the app from the App Flow screen first, then start UI explore."
      );
    }
    connection = new CdpConnection({
      resolveTarget: createTargetResolver(options.device.metroPort, target2),
      sessionId: `explore-ui-${options.projectId}`,
      log: (message) => console.log(`[app-flow] explore-ui runtime \u2014 ${message}`)
    });
    await connection.connect();
    return connection;
  } finally {
    recordRuntimeTiming("app_flow.runtime.connect", performance.now() - started, {
      outcome: connection?.state === "ready" ? "ready" : "unavailable"
    });
  }
}
async function runExploreUi(options) {
  const saved = await readAppFlow(options.projectId);
  if (!saved) {
    throw new Error(
      "This project has no saved App Flow yet. Build the flow first \u2014 UI states attach to screens the flow already captured."
    );
  }
  options.emit({ type: "phase", message: "Reading UI states from the project\u2019s source\u2026" });
  const catalog = await buildPresentationCatalog(options.projectPath);
  if (!catalog.actions.length && !(catalog.previews ?? []).length) {
    throw new Error("No UI states were found in this project\u2019s source.");
  }
  const connection = await connectToLaunchedApp(options, options.ctx.appName);
  const ports = createExploreUiPorts({ ...options, runtime: connection, catalog });
  try {
    const outcome = await exploreUiStates(
      { catalog, nodes: saved.nodes, ...options.limit === void 0 ? {} : { limit: options.limit } },
      ports
    );
    if (outcome.nodeId) await persist(options.projectId, saved, outcome.nodeId, outcome.uiStates);
    if (!outcome.rolledBack) {
      options.emit({
        type: "error",
        message: "The app may still be showing a UI state this run opened. Close it in the app, or relaunch it from the App Flow screen."
      });
    }
    for (const failure of outcome.discoveryFailures) {
      options.emit({ type: "step", message: `Could not open a UI state \u2014 ${failure.reason}` });
    }
    return {
      nodeId: outcome.nodeId,
      captured: outcome.uiStates.filter((state) => state.screenshot).length,
      failed: outcome.uiStates.filter((state) => !state.screenshot).length,
      rolledBack: outcome.rolledBack,
      cancelled: outcome.cancelled
    };
  } finally {
    await connection.close().catch(() => void 0);
  }
}
async function persist(projectId, saved, nodeId, uiStates) {
  const nodes = saved.nodes.map((node) => {
    if (node.id !== nodeId || !node.capture) return node;
    const capture = { ...node.capture, uiStates };
    return { ...node, capture };
  });
  await writeAppFlow(projectId, { ...saved, nodes });
}

// packages/core/src/app-flow/reach/auth-gate-policy.ts
var AUTH_GATE_FRAME_WAIT_MS = 15e3;
function settlesAuthGateForRun(resolution) {
  if (resolution.outcome !== "clear") return null;
  if (resolution.userResolved) return "user";
  if (resolution.verdict === "clear" && resolution.substantiveFrame) return "classifier";
  return null;
}

// packages/core/src/app-flow/timing.ts
var PHASE_ORDER = [
  "model",
  "device-read",
  "replay",
  "device-wait",
  "screenshot",
  "settle-poll",
  "press",
  "open-url",
  "boot"
];
function mergedMs(spans) {
  if (!spans.length) return 0;
  const sorted = [...spans].sort((a, b) => a.from - b.from);
  let total = 0;
  let from = sorted[0].from;
  let to = sorted[0].to;
  for (const span of sorted.slice(1)) {
    if (span.from > to) {
      total += to - from;
      from = span.from;
      to = span.to;
    } else if (span.to > to) to = span.to;
  }
  return total + (to - from);
}
var PhaseLedger = class {
  spans = [];
  startedAt;
  constructor(now = Date.now()) {
    this.startedAt = now;
  }
  /**
   * Records `ms` of `phase` work that finished at `endedAt`.
   *
   * The end timestamp rather than the start because the one caller that cannot use `measure` —
   * `logAgentTokens`, which is handed an already-elapsed duration after the call returns — knows
   * when the work ended and not when it began. Deriving the start from the end is exact there,
   * and the default makes every other caller read as it did before.
   */
  record(phase, ms, endedAt = Date.now()) {
    const clamped = Math.max(0, ms);
    this.spans.push({ phase, from: endedAt - clamped, to: endedAt });
  }
  /**
   * Times `work` and records it under `phase`.
   *
   * Records on the way out whether or not `work` threw: a read that fails after waiting out a
   * timeout is the most expensive read there is, and dropping it would make the one sweep whose
   * timings matter most — a slow or failing one — the one the ledger under-reports.
   */
  async measure(phase, work) {
    const began = Date.now();
    try {
      return await work();
    } finally {
      const ended = Date.now();
      this.record(phase, ended - began, ended);
    }
  }
  excludedMs = 0;
  /**
   * Removes `ms` of wall clock from the sweep's total. Used for app boot, which depends on the
   * toolchain rather than on the sweep and would otherwise swamp every comparison between runs.
   */
  excludeWall(ms) {
    this.excludedMs += Math.max(0, ms);
  }
  get excludedWallMs() {
    return this.excludedMs;
  }
  get wallMs() {
    return Math.max(0, Date.now() - this.startedAt - this.excludedMs);
  }
  /** Wall clock in which *any* phase was running, overlaps counted once. */
  get busyMs() {
    return mergedMs(this.spans);
  }
  /** Work done across every phase, overlaps counted at full price. */
  get totalWorkMs() {
    return this.spans.reduce((sum, span) => sum + (span.to - span.from), 0);
  }
  /** Rows in a fixed order, skipping phases this sweep never reached. */
  rows() {
    const rows = [];
    for (const phase of PHASE_ORDER) {
      const spans = this.spans.filter((span) => span.phase === phase);
      if (!spans.length) continue;
      rows.push({
        phase,
        tally: {
          calls: spans.length,
          ms: spans.reduce((sum, span) => sum + (span.to - span.from), 0),
          clockMs: mergedMs(spans)
        }
      });
    }
    return rows;
  }
};
function formatPhaseSummary(ledger) {
  const wallMs = ledger.wallMs;
  const rows = ledger.rows();
  const share = (ms) => wallMs ? ` (${Math.round(ms / wallMs * 100)}%)` : "";
  const lines = rows.map(({ phase, tally }) => {
    const each = tally.calls ? tally.ms / tally.calls / 1e3 : 0;
    const concurrent = tally.ms > tally.clockMs ? `, ${((tally.ms - tally.clockMs) / 1e3).toFixed(1)}s overlapped` : "";
    return `[app-flow] time by phase \u2014 ${phase}: ${tally.calls} calls, ${(tally.clockMs / 1e3).toFixed(1)}s${share(tally.clockMs)}, ${each.toFixed(2)}s each` + concurrent;
  });
  const hidden = ledger.totalWorkMs - ledger.busyMs;
  if (hidden > 0) {
    lines.push(
      `[app-flow] time by phase \u2014 concurrency hid ${(hidden / 1e3).toFixed(1)}s of work inside another phase`
    );
  }
  const unmeasured = wallMs - ledger.busyMs;
  lines.push(
    `[app-flow] time by phase \u2014 unmeasured: ${(unmeasured / 1e3).toFixed(1)}s${share(Math.max(0, unmeasured))}`
  );
  lines.push(`[app-flow] sweep wall clock \u2014 ${(wallMs / 1e3).toFixed(1)}s`);
  return lines;
}

// packages/core/src/app-flow/sweep-log.ts
import { appendFile, mkdir as mkdir4, readdir as readdir6, unlink as unlink2 } from "node:fs/promises";
import { join as join10 } from "node:path";
var SWEEP_LOG_KEEP_RUNS = 20;
var FLUSH_INTERVAL_MS = 2e3;
var RUNS_DIR_NAME = "runs";
function sweepLogFileName(startedAt, runId) {
  const stamp = new Date(startedAt).toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  return `fast-${stamp}-${(runId || "unknown").replace(/[^\w-]/g, "").slice(0, 8)}.jsonl`;
}
function sweepLogDir(projectId) {
  return join10(getProjectDir(projectId), RUNS_DIR_NAME);
}
async function pruneSweepLogs(projectId, keep = SWEEP_LOG_KEEP_RUNS) {
  const dir = sweepLogDir(projectId);
  let entries;
  try {
    entries = await readdir6(dir);
  } catch {
    return;
  }
  const logs = entries.filter((entry) => /^fast-.*\.jsonl$/.test(entry)).sort();
  const stale = logs.slice(0, Math.max(0, logs.length - keep));
  await Promise.all(stale.map((entry) => unlink2(join10(dir, entry)).catch(() => void 0)));
}
async function createSweepLog(options) {
  const write = options.append ?? ((path2, data) => appendFile(path2, data, "utf-8"));
  const say = options.log ?? ((message) => console.log(message));
  const dir = sweepLogDir(options.projectId);
  const path = join10(dir, sweepLogFileName(options.startedAt, options.runId));
  try {
    await mkdir4(dir, { recursive: true });
    await pruneSweepLogs(options.projectId, options.keep ?? SWEEP_LOG_KEEP_RUNS);
  } catch (error) {
    say(
      `[app-flow] run log unavailable \u2014 ${error instanceof Error ? error.message : String(error)}`
    );
    return null;
  }
  let disabled = false;
  let buffer = [];
  const flush = async () => {
    if (disabled || !buffer.length) return;
    const pending = buffer.join("");
    buffer = [];
    try {
      await write(path, pending);
    } catch (error) {
      disabled = true;
      say(
        `[app-flow] run log disabled after a failed write \u2014 ${error instanceof Error ? error.message : String(error)}`
      );
    }
  };
  const timer = setInterval(() => {
    void flush();
  }, FLUSH_INTERVAL_MS);
  timer.unref?.();
  const push = (record2) => {
    if (disabled) return;
    try {
      buffer.push(`${JSON.stringify(record2)}
`);
    } catch {
    }
  };
  const open2 = /* @__PURE__ */ new Map();
  let transportReported = false;
  return {
    path,
    transportUnavailable(reason) {
      if (transportReported) return;
      transportReported = true;
      push({ transport: "unavailable", reason });
    },
    node(id2) {
      const existing = open2.get(id2);
      if (existing) return existing;
      const record2 = { nodeId: id2 };
      let appended = false;
      const entry = {
        route(requested, resolved) {
          record2.routeRequested = requested;
          record2.routeResolved = resolved ? [...resolved] : null;
        },
        dispatch(entry2) {
          record2.dispatch = entry2;
        },
        settle(entry2) {
          record2.settle = entry2;
        },
        verify(entry2) {
          record2.verify = entry2;
        },
        delivery(entry2) {
          record2.delivery = entry2;
        },
        uiStates(entry2) {
          record2.uiStates = entry2;
        },
        finish(closing) {
          if (appended) return;
          appended = true;
          record2.status = closing.status;
          record2.totalMs = closing.totalMs;
          open2.delete(id2);
          push(record2);
        }
      };
      open2.set(id2, entry);
      return entry;
    },
    flush,
    async close(summary) {
      clearInterval(timer);
      for (const entry of [...open2.values()]) entry.finish({ status: "incomplete", totalMs: 0 });
      if (summary?.length) push({ summary: [...summary] });
      await flush();
    }
  };
}

// packages/core/src/app-flow/coalesced-write.ts
function createCoalescedWriter(options) {
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle));
  let revision = 0;
  let saved = 0;
  let lastWriteAt = -Infinity;
  let timer = null;
  let writes = 0;
  const writeNow = async () => {
    const pending = revision;
    if (saved >= pending) return;
    lastWriteAt = options.now();
    writes += 1;
    await options.write();
    saved = Math.max(saved, pending);
  };
  const flush = async () => {
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
    await writeNow();
  };
  return {
    get writes() {
      return writes;
    },
    async mark() {
      revision += 1;
      if (options.now() - lastWriteAt < options.windowMs) {
        if (timer === null) {
          timer = setTimer(() => {
            timer = null;
            void writeNow().catch((error) => options.onError?.(error));
          }, options.windowMs);
          timer?.unref?.();
        }
        return;
      }
      await flush();
    },
    flush
  };
}

// packages/core/src/app-flow/hedge.ts
async function hedge(options) {
  const first = options.attempt(0);
  if (!(options.afterMs > 0) || !Number.isFinite(options.afterMs)) {
    return { result: await first, attempts: 1, winner: 0 };
  }
  const tagged = (promise, index) => promise.then((result) => ({ index, result }));
  let timer;
  const elapsed = new Promise((resolve3) => {
    timer = setTimeout(() => resolve3("elapsed"), options.afterMs);
  });
  let firstOrTimer;
  try {
    firstOrTimer = await Promise.race([tagged(first, 0), elapsed]);
  } finally {
    clearTimeout(timer);
  }
  if (firstOrTimer !== "elapsed") {
    return { result: firstOrTimer.result, attempts: 1, winner: 0 };
  }
  options.onHedge?.();
  const second = options.attempt(1);
  const settled = [tagged(first, 0), tagged(second, 1)].map(
    (promise) => promise.then(
      (value) => ({ ok: true, value }),
      (error) => ({ ok: false, error })
    )
  );
  const firstSettled = await Promise.race(settled);
  if (firstSettled.ok) {
    return { result: firstSettled.value.result, attempts: 2, winner: firstSettled.value.index };
  }
  const both = await Promise.all(settled);
  const won = both.find((outcome) => outcome.ok);
  if (won?.ok) return { result: won.value.result, attempts: 2, winner: won.value.index };
  throw both[0].ok ? new Error("Hedged call failed") : both[0].error;
}

// packages/core/src/app-flow/reach/chrome-path.ts
function stepToPathCommand(step) {
  if (!step.locator) return null;
  const selector = `${step.locator.by}=${JSON.stringify(step.locator.value)}`;
  if (step.type === "input") return fillCommand(selector, step.value ?? "");
  if (step.type === "tap") return pressCommand(selector);
  return null;
}
function triggerToPathCommand(trigger) {
  return pressCommand(`${trigger.by}=${JSON.stringify(trigger.value)}`);
}
function buildChromePathToReach(node, edges, runtimeEdges, chrome, device) {
  const chromeEdge = [...edges, ...runtimeEdges].find(
    // `kind: 'reveal'` is excluded on purpose: a reveal edge's `to` is the chrome's own virtual node
    // (`chromeVirtualNodes`, `reach/chrome-inventory.ts`), never a screen, so it can never be the
    // edge that reaches `node` — but saying so here keeps this honest if a reveal edge's shape ever
    // changes, rather than relying on the id namespaces staying disjoint.
    (edge) => edge.to === node.id && edge.origin === "runtime-chrome" && edge.kind !== "reveal"
  );
  if (!chromeEdge) return null;
  const openLine = [...device.setupCommands, agentDeviceOpenCommand(device.launchTarget)];
  if (chromeEdge.evidence?.replayScript) {
    return [
      ...openLine,
      `agent-device replay ${quoteCliArg(chromeEdge.evidence.replayScript)} --keep-session`
    ];
  }
  const record2 = chrome.find((candidate) => candidate.id === chromeEdge.evidence?.chromeId) ?? chrome.find((candidate) => candidate.id === chromeEdge.from) ?? chrome.find((candidate) => candidate.entryNodeId === chromeEdge.from);
  const steps = [
    ...record2?.reveal.map(stepToPathCommand) ?? [],
    chromeEdge.trigger ? triggerToPathCommand(chromeEdge.trigger) : null
  ].filter((line) => Boolean(line));
  if (!steps.length) return null;
  return [...openLine, ...steps];
}

// packages/core/src/app-flow/reach/deep-link-policy.ts
import { createHash as createHash5 } from "node:crypto";
function nodeStructureSignature(node) {
  const hash2 = createHash5("sha256");
  hash2.update(node.id);
  hash2.update("\0");
  hash2.update(node.file ?? "");
  hash2.update("\0");
  hash2.update(node.urlPath ?? "");
  hash2.update("\0");
  hash2.update([...node.params].sort().join(","));
  return hash2.digest("hex").slice(0, 16);
}
function isDeepLinkRejectionCurrent(rejection, node) {
  return Boolean(rejection) && rejection.parsedSignature === nodeStructureSignature(node);
}
function carryForwardDeepLinkRejection(previous, node) {
  return isDeepLinkRejectionCurrent(previous, node) ? previous : null;
}
function recordDeepLinkRejection(node, target2, reason, rejectedAt) {
  return {
    url: target2,
    reason,
    rejectedAt,
    parsedSignature: nodeStructureSignature(node)
  };
}
var DEEPLINK_BREAKER_LIMIT = 3;
function initialDeepLinkBreakerState(enabled = true) {
  return { enabled, consecutiveFailures: 0 };
}
function registerDeepLinkFailure(state, hasProbeRoute) {
  const consecutiveFailures = state.consecutiveFailures + 1;
  if (consecutiveFailures < DEEPLINK_BREAKER_LIMIT) {
    return { state: { ...state, consecutiveFailures }, decision: { action: "continue" } };
  }
  if (!hasProbeRoute) {
    return {
      state: { enabled: false, consecutiveFailures },
      decision: { action: "disabled-immediately" }
    };
  }
  return { state: { ...state, consecutiveFailures }, decision: { action: "reprobe" } };
}
function applyDeepLinkReprobeResult(state, stillRoutes) {
  return stillRoutes ? { enabled: true, consecutiveFailures: 0 } : { enabled: false, consecutiveFailures: state.consecutiveFailures };
}
function registerDeepLinkSuccess(state) {
  return state.consecutiveFailures === 0 ? state : { ...state, consecutiveFailures: 0 };
}
function evaluateDeepLinkAttempt(node, target2, rejection) {
  if (rejection && rejection.url === target2 && isDeepLinkRejectionCurrent(rejection, node)) {
    return {
      action: "skip",
      touchedDevice: false,
      feedsBreaker: false,
      reason: `Deep link ${target2} already rejected \u2014 ${rejection.reason}`
    };
  }
  return { action: "proceed" };
}

// packages/core/src/app-flow/reach/delivery.ts
function chooseDeliverySources(input) {
  const {
    liveScreenshot,
    livePressables,
    livePressablesError,
    arrivalFramePath,
    arrivalPressables
  } = input;
  const live = {
    source: "live",
    pressables: livePressables,
    error: livePressablesError
  };
  if (liveScreenshot.ok) {
    return { screenshot: { source: "live" }, pressables: live };
  }
  return {
    screenshot: arrivalFramePath ? { source: "arrival", framePath: arrivalFramePath } : { source: "none", reason: liveScreenshot.reason },
    pressables: arrivalPressables.length ? { source: "arrival", pressables: arrivalPressables, error: null } : live
  };
}
function joinNotes(...parts) {
  const joined = parts.filter((part) => Boolean(part)).join(" \u2014 ");
  return joined || null;
}
function captureRecord(status, fields) {
  return {
    status,
    // Two different rules, kept distinct exactly as they were before this function existed:
    // an unreached node (missing/unavailable) needs another navigation attempt unless the verdict
    // is the settled 'unavailable' — that is `recordUnreached`'s rule. A reached node needs one only
    // when the method that reached it was live exploration rather than a replay or a deep link,
    // since those already have a reusable path recorded.
    needsNavigation: fields.captureMethod === "unreached" ? status !== "unavailable" : fields.captureMethod === "agent-navigation",
    note: fields.note,
    screenshot: fields.screenshot,
    pressables: fields.pressables,
    captureMethod: fields.captureMethod,
    // Omitted rather than written as `null` when there is none, so a capture carried forward from
    // an earlier sweep is not overwritten with an absence by a later reach that walked nothing.
    ...fields.pathCommands?.length ? { pathCommands: [...fields.pathCommands] } : {},
    replayScript: fields.replayScript,
    replayVerified: fields.replayVerified,
    structureRevision: fields.structureRevision,
    stale: false
  };
}
function decideDelivery(input) {
  if (input.kind === "unavailable") {
    return {
      kind: "unavailable",
      capture: captureRecord("unavailable", {
        note: input.reason,
        screenshot: null,
        pressables: [],
        captureMethod: "unreached",
        replayScript: null,
        replayVerified: false,
        structureRevision: input.structureRevision
      })
    };
  }
  const {
    evidence,
    screenshot,
    pressables,
    pressablesError,
    pressablesSource,
    captureMethod,
    structureRevision
  } = input;
  const hasVerifiedArrival = evidence.arrival?.verdict === "match";
  const hasPublishedReplay = Boolean(evidence.replayScript) || Boolean(evidence.pathCommands?.length);
  const pressablesNote = joinNotes(
    pressablesError ? `Interactive elements unavailable: ${pressablesError}` : null,
    pressablesSource === "arrival" ? "Interactive elements are from the verified arrival observation, not the delivery read" : null
  );
  if (!hasVerifiedArrival && !hasPublishedReplay) {
    return {
      kind: "missing",
      capture: captureRecord("missing", {
        note: joinNotes(screenshot.ok ? null : screenshot.reason, pressablesNote),
        screenshot: null,
        pressables,
        captureMethod: "unreached",
        replayScript: null,
        replayVerified: false,
        structureRevision
      })
    };
  }
  const status = evidence.arrival?.status ?? "ok";
  const note = screenshot.ok ? joinNotes(evidence.arrival?.reason ?? null, pressablesNote) : joinNotes(
    `Reached and verified; screenshot unavailable: ${screenshot.reason}`,
    pressablesNote
  );
  return {
    kind: "reached",
    capture: captureRecord(status, {
      note,
      screenshot: screenshot.ok ? screenshot.relativePath : null,
      pressables,
      captureMethod,
      pathCommands: evidence.pathCommands,
      replayScript: evidence.replayScript,
      replayVerified: evidence.replayVerified,
      structureRevision
    })
  };
}

// packages/core/src/app-flow/reach/ladder.ts
async function runReachLadder(options) {
  const { input, ports, strategies, budget, signal } = options;
  const attempts = [];
  for (const strategy of strategies) {
    if (signal?.aborted) return { status: "stopped", reason: "cancelled", attempts };
    if (budget.expired) {
      return {
        status: "unreached",
        reason: "Navigation budget exhausted.",
        attempts
      };
    }
    const attempt = await strategy(input, ports);
    attempts.push(attempt);
    if (attempt.ok) return { status: "reached", strategy: attempt.strategy, attempts };
    if (attempt.failure === "unavailable") {
      return { status: "unavailable", reason: attempt.reason, attempts };
    }
    if (attempt.failure === "auth-stopped") return { status: "stopped", reason: "auth", attempts };
    if (attempt.failure === "cancelled") return { status: "stopped", reason: "cancelled", attempts };
  }
  const last = attempts[attempts.length - 1];
  return {
    status: "unreached",
    reason: last?.reason ?? "No reach strategy was configured.",
    // Only when every rung that ran was refused. One rung that actually drove the app leaves the
    // screen somewhere unknown, and the caller's stuck-app detection has to run as it always did.
    // The budget-exhausted exit above never sets this: an empty `attempts` would vacuously satisfy
    // `every`, and "we never tried" is not "nothing moved".
    refused: attempts.length > 0 && attempts.every((attempt) => attempt.refused === true),
    attempts
  };
}
function allowsAgentExploration(mode) {
  return mode === "ai" || mode === "thorough";
}
function strategiesFor(mode, rungs) {
  const shortcuts = [rungs.probeCredit, rungs.savedReplay];
  if (mode === "adaptive") return [rungs.render, rungs.deepLink, rungs.savedReplay];
  if (mode === "ai") return [rungs.savedReplay, rungs.explore];
  if (mode === "fast") return [rungs.render];
  if (mode === "thorough") return [...shortcuts, rungs.deepLink, rungs.explore];
  return [...shortcuts, rungs.deepLink, rungs.render];
}
function touchedDevice(outcome) {
  return outcome.attempts.some((attempt) => attempt.touchedDevice);
}

// packages/core/src/app-flow/reach/queue.ts
var ReachQueue = class {
  items;
  /** Index of the item currently in flight, or one past the end once every item was served. -1
   * before the first `next()` call, so `completed` reports 0 and `remaining` reports the full count. */
  index = -1;
  /** Set by `requeueCurrent()`; consumed by the following `next()`, which then re-serves `index`
   * instead of advancing past it. */
  requeued = false;
  constructor(items) {
    this.items = items;
  }
  /** Total items the queue was constructed with — never changes. */
  get total() {
    return this.items.length;
  }
  /** Items strictly before the one currently in flight (or, before any `next()` call, zero). */
  get completed() {
    return this.index < 0 ? 0 : this.index;
  }
  /** Items left to process, the current one included. */
  get remaining() {
    return this.items.length - this.completed;
  }
  /**
   * Hands out the next item, or `null` once the queue is exhausted. Advances past the previously
   * served item unless `requeueCurrent()` was called since the last `next()`, in which case the same
   * item is served again.
   */
  next() {
    this.index = this.requeued ? this.index : this.index + 1;
    this.requeued = false;
    if (this.index >= this.items.length) return null;
    return this.items[this.index];
  }
  /**
   * Re-serves the item just handed out by `next()` — the direct replacement for the old loop's
   * `i -= 1` retry (`orchestrator.ts`'s blocked-run recovery). Calling this without a preceding
   * `next()`, or calling it twice between two `next()` calls, is a caller bug; it has no effect
   * beyond arming the very next `next()` to repeat.
   */
  requeueCurrent() {
    this.requeued = true;
  }
};

// packages/core/src/app-flow/reach/runtime-nodes.ts
import { createHash as createHash6 } from "node:crypto";
function sanitizeScreenKey(raw) {
  return raw.trim().replace(/[/\\]+/g, "-").replace(/\s+/g, "-").replace(/[^A-Za-z0-9_-]/g, "").replace(/-+/g, "-").replace(/^-|-$/g, "");
}
var RUNTIME_NODE_MATCH_THRESHOLD = 0.6;
function slugifyId(id2) {
  return id2.replace(/[^a-zA-Z0-9]/g, "_").replace(/_+/g, "_").toLowerCase();
}
function uniqueRuntimeSlug(id2, used) {
  const base = slugifyId(id2) || "runtime_screen";
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  let index = 2;
  while (used.has(`${base}_${index}`)) index += 1;
  const next = `${base}_${index}`;
  used.add(next);
  return next;
}
function collisionSuffix(observedTokens) {
  return createHash6("sha256").update([...observedTokens].sort().join(",")).digest("hex").slice(0, 8);
}
function mintRuntimeNode(input) {
  const baseId = `runtime:${sanitizeScreenKey(input.key) || "screen"}`;
  const id2 = input.existingIds.has(baseId) ? `${baseId}--${collisionSuffix(input.observedTokens)}` : baseId;
  return {
    id: id2,
    urlPath: null,
    reach: "navigation-only",
    title: input.title.trim() || input.key,
    file: null,
    slug: uniqueRuntimeSlug(id2, input.usedSlugs),
    group: "",
    groups: [],
    navigator: null,
    params: [],
    presentation: null,
    guard: null,
    capture: null,
    origin: "runtime",
    runtimeSignature: [...input.observedTokens],
    sightings: 1
  };
}
function matchRuntimeNode(existing, observedTokens, candidateId, threshold = RUNTIME_NODE_MATCH_THRESHOLD) {
  if (candidateId) {
    const exact = existing.find((node) => node.id === candidateId);
    if (exact) return exact;
  }
  let best = null;
  for (const node of existing) {
    if (!node.runtimeSignature?.length) continue;
    const score = similarity(observedTokens, new Set(node.runtimeSignature));
    if (score >= threshold && (!best || score > best.score)) best = { node, score };
  }
  return best?.node ?? null;
}
function recordRuntimeSighting(node, observedTokens) {
  const prior = node.runtimeSignature ?? [];
  const pruned = prior.filter((token) => observedTokens.has(token));
  return {
    ...node,
    sightings: (node.sightings ?? 1) + 1,
    runtimeSignature: pruned.length ? pruned : prior
  };
}

// packages/core/src/app-flow/screen-keys.ts
function fallbackScreenKey(node) {
  return sanitizeScreenKey(node.title || node.id) || "Screen";
}
function uniqueScreenKey(raw, used) {
  const base = sanitizeScreenKey(raw) || "Screen";
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  let index = 2;
  while (used.has(`${base}-${index}`)) index++;
  const next = `${base}-${index}`;
  used.add(next);
  return next;
}
function defaultScreenInfo(node) {
  return `${node.title || fallbackScreenKey(node)} screen${node.urlPath ? ` at ${node.urlPath}` : ""}.`;
}

// packages/core/src/app-flow/reach/seed.ts
function findSeedSource(options) {
  const { urlPath, targetId, nodes, edges, storedPath, deepLinkedThisRun } = options;
  const ancestors = urlPath ? findRouteAncestors(urlPath, nodes) : [];
  for (const ancestor of ancestors) {
    const commands = storedPath(ancestor.id);
    if (commands?.length) return { kind: "path", id: ancestor.id, commands, trigger: null };
  }
  const graphParent = edges.filter((edge) => edge.to === targetId && edge.from !== targetId && edge.trigger?.value).map((edge) => ({ edge, commands: storedPath(edge.from) })).find((entry) => entry.commands?.length);
  if (graphParent?.commands?.length) {
    return {
      kind: "path",
      id: graphParent.edge.from,
      commands: graphParent.commands,
      trigger: graphParent.edge.trigger ?? null
    };
  }
  for (const ancestor of ancestors) {
    const url = deepLinkedThisRun(ancestor.id);
    if (url && ancestor.urlPath)
      return { kind: "deep-link", id: ancestor.id, urlPath: ancestor.urlPath, url };
  }
  return null;
}

// packages/core/src/app-flow/reach/walk-edges.ts
function createWalkCursor(startNodeId) {
  return { confirmedNodeId: startNodeId, actionsSinceConfirmation: [] };
}
function noteWalkAction(cursor, action) {
  cursor.actionsSinceConfirmation.push(action);
}
function noteWalkArrival(cursor, nodeId, context) {
  const from = cursor.confirmedNodeId;
  const actions = cursor.actionsSinceConfirmation;
  const edge = buildWalkEdge(from, nodeId, actions, context);
  cursor.confirmedNodeId = nodeId;
  cursor.actionsSinceConfirmation = [];
  return edge;
}
function buildWalkEdge(from, nodeId, actions, context) {
  if (!from) return null;
  if (from === nodeId) return null;
  if (actions.length !== 1) return null;
  const action = actions[0];
  if (action.type !== "tap") return null;
  const locator = action.locator ?? null;
  const raw = locator ? `walked: tap ${locator.by}=${locator.value}` : "walked: tap (control not captured)";
  return {
    from,
    to: nodeId,
    raw,
    target: null,
    trigger: locator,
    kind: "push",
    origin: "runtime-walk",
    evidence: {
      structureRevision: context.structureRevision,
      observedAt: context.observedAt,
      // The distinction from a chrome edge: this destination was confirmed by the arrival judge
      // after an actual walked hop, not guessed from a single screen's text overlap.
      verified: true,
      replayScript: context.replayScript ?? null
    }
  };
}
function mergeWalkEdge(edges, edge) {
  const at = edges.findIndex((existing2) => existing2.from === edge.from && existing2.to === edge.to);
  if (at === -1) {
    edges.push(edge);
    return;
  }
  const existing = edges[at];
  const existingIsWalked = existing.origin === "runtime-walk";
  const incomingIsWalked = edge.origin === "runtime-walk";
  if (existingIsWalked && !incomingIsWalked) return;
  if (existing.evidence?.verified && !edge.evidence?.verified) return;
  edges[at] = edge;
}

// packages/core/src/app-flow/reach/structure-key.ts
import { createHash as createHash7 } from "node:crypto";
function computeStructureKey(nodes, edges) {
  for (const node of nodes) {
    if (node.origin === "runtime" || node.origin === "chrome") {
      throw new Error(
        `computeStructureKey must only fingerprint parsed structure, but node "${node.id}" has origin: '${node.origin}'. Pass parsed.nodes/parsed.edges only \u2014 a runtime or chrome node folded into this hash would invalidate the resume checkpoint every time the explorer discovers a screen or a navigator chrome.`
      );
    }
  }
  const hash2 = createHash7("sha256");
  for (const node of [...nodes].sort((a, b) => a.id.localeCompare(b.id))) {
    hash2.update(`${node.id}\0${node.file ?? ""}\0${node.urlPath ?? ""}\0`);
  }
  for (const edge of [...edges].sort(
    (a, b) => `${a.from}>${a.to}`.localeCompare(`${b.from}>${b.to}`)
  )) {
    hash2.update(`${edge.from}\0${edge.to ?? ""}\0`);
  }
  return hash2.digest("hex").slice(0, 16);
}

// packages/core/src/app-flow/reach/checkpoint.ts
function reconcileSweepProgress(resumed, current) {
  const sameStructure = resumed?.structureKey === current.structureKey;
  const resuming = sameStructure && resumed?.explorationMode === current.explorationMode && resumed?.sourceHash === current.sourceHash && resumed?.fastFingerprint === current.fastFingerprint;
  if (resuming) return { resuming: true, checkpoint: resumed, retained: 0 };
  const reusable = (capture) => capture.captureMethod !== "unreached" && capture.status !== "missing";
  const captures = sameStructure ? Object.fromEntries(Object.entries(resumed?.captures ?? {}).filter(([, value]) => reusable(value))) : {};
  const ids = new Set(Object.keys(captures));
  return {
    resuming: false,
    retained: ids.size,
    checkpoint: {
      ...current,
      updatedAt: "",
      captures,
      opened: Object.fromEntries(
        Object.entries(resumed?.opened ?? {}).filter(([id2]) => ids.has(id2))
      ),
      inferred: Object.fromEntries(
        Object.entries(resumed?.inferred ?? {}).filter(([id2]) => ids.has(id2))
      ),
      runtimeNodes: sameStructure ? resumed?.runtimeNodes : [],
      runtimeEdges: sameStructure ? resumed?.runtimeEdges : [],
      chrome: sameStructure ? resumed?.chrome : []
    }
  };
}

// packages/core/src/app-flow/reach/frame-stability.ts
var MOVED_FLOOR = 0.6;
var UNCHANGED_FLOOR = 0.9;
var TARGET_COVERAGE_FLOOR = 0.5;
function round(value) {
  return value.toFixed(2);
}
function classifyFrameTransition(input) {
  const settled = input.settled ?? null;
  const afterShot = input.afterShot ?? null;
  if (!settled?.length || !afterShot?.length) {
    return {
      transition: "stable",
      reason: "no pair of reads to compare around the screenshot"
    };
  }
  const settledFrame = fingerprint(settled);
  const afterShotFrame = fingerprint(afterShot);
  const acrossShot = similarity(settledFrame, afterShotFrame);
  if (acrossShot < MOVED_FLOOR) {
    return {
      transition: "moved",
      reason: `the screen changed under the camera: the settle read ${settled.length} control(s) and the read after the screenshot found ${afterShot.length}, overlap ${round(acrossShot)} (below ${MOVED_FLOOR})`
    };
  }
  const preOpen = input.preOpen ?? null;
  if (preOpen?.length) {
    const unchanged = similarity(fingerprint(preOpen), settledFrame);
    if (unchanged >= UNCHANGED_FLOOR) {
      const coverage = input.targetCoverage ?? null;
      if (coverage !== null && coverage >= TARGET_COVERAGE_FLOOR) {
        return {
          transition: "stable",
          reason: `the frame did not change across the open (overlap ${round(unchanged)}), but it carries ${round(coverage)} of the target screen's own vocabulary \u2014 this is a deep link to a screen the app was already showing, not a link that did nothing`
        };
      }
      return {
        transition: "never-left",
        reason: `the frame is the same one that was on screen before the URL was opened (overlap ${round(unchanged)}, at or above ${UNCHANGED_FLOOR})` + (coverage === null ? " and nothing could score it against the target screen" : ` and it carries only ${round(coverage)} of the target screen's own vocabulary`)
      };
    }
  }
  return {
    transition: "stable",
    reason: `the screenshot and the control read agree (overlap ${round(acrossShot)})`
  };
}

// packages/core/src/app-flow/reach/strategies/verify-with-diagnostic.ts
function diagnosticFramePath(scratchPath, suffix) {
  return scratchPath(`verify-${suffix}`);
}
async function verifyWithDiagnostic(ports, node, scratchPath, suffix, budget, options) {
  if (budget.expired) {
    return {
      arrival: {
        verdict: "uncertain",
        status: null,
        reason: "Navigation budget exhausted before arrival verification."
      },
      pressables: null
    };
  }
  const diagnostic = diagnosticFramePath(scratchPath, suffix);
  const shoot = async () => {
    try {
      return (await ports.device.captureScreenshot(diagnostic)).relaunched;
    } catch (error) {
      throw new Error(
        `screenshot failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  };
  const lostSession = () => ({
    arrival: {
      verdict: "mismatch",
      status: null,
      reason: "session was lost; the app was relaunched at its launch URL"
    },
    pressables: null
  });
  if (await shoot()) return lostSession();
  let stability;
  let stabilityPressables = null;
  if (options?.frameStability) {
    const check = options.frameStability;
    stabilityPressables = await ports.device.capturePressables().catch(() => null);
    const first = classifyFrameTransition({
      preOpen: check.preOpen,
      settled: check.settled,
      afterShot: stabilityPressables,
      targetCoverage: check.targetCoverage?.(stabilityPressables) ?? null
    });
    if (first.transition === "moved") {
      console.log(
        `[app-flow] verify ${node.id} via ${suffix}: re-settling and re-shooting once \u2014 ${first.reason}`
      );
      const resettled = await check.resettle().catch(() => null);
      if (await shoot()) return lostSession();
      stabilityPressables = await ports.device.capturePressables().catch(() => null);
      const second = classifyFrameTransition({
        preOpen: check.preOpen,
        settled: resettled ?? check.settled,
        afterShot: stabilityPressables,
        targetCoverage: check.targetCoverage?.(stabilityPressables) ?? null
      });
      stability = {
        transition: second.transition,
        reason: `${first.reason}; re-shot after re-settling, and ${second.reason}`,
        retried: true
      };
    } else {
      stability = { transition: first.transition, reason: first.reason, retried: false };
    }
    if (stability.transition === "never-left") {
      const arrival2 = {
        verdict: "uncertain",
        status: null,
        reason: `the deep link did not move the app \u2014 ${stability.reason}`
      };
      console.log(`[app-flow] verify ${node.id} via ${suffix}: uncertain \u2014 ${arrival2.reason}`);
      return { arrival: arrival2, pressables: stabilityPressables, frameTransition: stability };
    }
  }
  const noteRetry = (arrival2) => stability?.retried ? { ...arrival2, reason: `${arrival2.reason} [frame: ${stability.reason}]` } : arrival2;
  if (options?.verdictWithoutJudge) {
    const pressables2 = stability ? stabilityPressables : await ports.device.capturePressables().catch(() => null);
    const arrival2 = noteRetry(options.verdictWithoutJudge(pressables2));
    console.log(
      `[app-flow] verify ${node.id} via ${suffix} (no judge): ${arrival2.verdict} \u2014 ${arrival2.reason}`
    );
    return { arrival: arrival2, pressables: pressables2, frameTransition: stability };
  }
  const [judged, pressables] = await Promise.all([
    ports.judge.verifyArrival(node, diagnostic, budget),
    stability || !options?.withPressables ? Promise.resolve(stabilityPressables) : ports.device.capturePressables().catch(() => null)
  ]);
  const arrival = noteRetry(judged);
  console.log(`[app-flow] verify ${node.id} via ${suffix}: ${arrival.verdict} \u2014 ${arrival.reason}`);
  return { arrival, pressables, frameTransition: stability };
}

// packages/core/src/app-flow/reach/strategies/render.ts
var REFUSALS = /* @__PURE__ */ new Set([
  "unregistered",
  "no-navigator",
  "no-dispatch",
  "no-expo-router",
  "invalid-route"
]);
function isFocusedPath(path, active) {
  if (!path.length || path.length > active.length) return false;
  return path.every((name2, index) => active[active.length - path.length + index] === name2);
}
var SUFFIX = "render-check";
async function renderStrategy(input, ports) {
  const { node, params, unresolvedParams, budget, scratchPath, guardGateClosed } = input;
  const started = Date.now();
  const skip2 = (reason) => ({
    strategy: "render",
    ok: false,
    reason,
    touchedDevice: false,
    elapsedMs: Date.now() - started,
    effects: []
  });
  if (node.guard && guardGateClosed(node.guard.condition)) {
    return {
      ...skip2(explainGuardGate(node.guard)),
      failure: "unavailable"
    };
  }
  if (!ports.render) return skip2("No runtime transport \u2014 the app\u2019s JS context is not reachable.");
  if (unresolvedParams.length) {
    return skip2(`Unresolved route parameters: ${unresolvedParams.join(", ")}.`);
  }
  if (budget.expired) return skip2("Navigation budget exhausted before rendering.");
  const availability = await ports.render.available();
  if (!availability.ok) {
    ports.sweepLog?.transportUnavailable(availability.reason);
    return skip2(`Runtime transport unavailable \u2014 ${availability.reason}`);
  }
  const log3 = ports.sweepLog?.node(node.id);
  const dispatchStartedAt = Date.now();
  const dispatched = await ports.render.navigate(node, params);
  const dispatchMs = Date.now() - dispatchStartedAt;
  console.log(
    `[app-flow] ${node.id} render dispatch ${dispatched.ok ? "ok" : "refused"} (${dispatchMs}ms) \u2014 ${dispatched.reason}`
  );
  log3?.route(node.id, dispatched.path ?? null);
  log3?.dispatch({
    ok: dispatched.ok,
    action: dispatched.action ?? null,
    reason: dispatched.reason,
    ms: dispatchMs
  });
  if (!dispatched.ok) {
    return {
      strategy: "render",
      ok: false,
      reason: dispatched.reason,
      touchedDevice: true,
      ...dispatched.refusal && REFUSALS.has(dispatched.refusal) ? { refused: true } : {},
      elapsedMs: Date.now() - started,
      effects: []
    };
  }
  const settleStartedAt = Date.now();
  const settled = await ports.render.awaitSettled(node, params, budget);
  const settleMs = Date.now() - settleStartedAt;
  console.log(
    `[app-flow] ${node.id} render settle ${settled.settled ? "ok" : "gave up"} (${settleMs}ms, ${settled.polls ?? "?"} polls, stop: ${settled.stop ?? "unknown"}) \u2014 ${settled.reason}`
  );
  log3?.settle({
    polls: settled.polls ?? 0,
    stop: settled.stop ?? null,
    ms: settleMs,
    content: settled.content
  });
  const dispatchedPath = dispatched.path ?? null;
  const runtimeEvidenceComplete = (input.arrivalJudge === "fallback" || input.arrivalJudge === "never") && settled.found && !settled.paramMismatch?.length && settled.content > 0 && dispatchedPath !== null && isFocusedPath(dispatchedPath, settled.active ?? []);
  const runtimeArrival = runtimeEvidenceComplete ? `${dispatchedPath.join(" > ")} is focused with ${settled.content} content nodes${settled.settled ? " and settled" : `, though the readiness poll stopped on ${settled.stop ?? "an unknown condition"}`}.` : null;
  const verifyStartedAt = Date.now();
  const { arrival, pressables } = await verifyWithDiagnostic(
    ports,
    node,
    scratchPath,
    SUFFIX,
    budget,
    {
      withPressables: true,
      // The scratch frame is still taken, and a relaunched session is still an automatic mismatch,
      // whichever way the verdict is reached — see `verifyWithDiagnostic`.
      ...runtimeArrival ? {
        verdictWithoutJudge: () => ({
          verdict: "match",
          status: "ok",
          reason: `Runtime navigation confirmed: ${runtimeArrival}`
        })
      } : input.arrivalJudge === "never" ? {
        verdictWithoutJudge: () => ({
          verdict: "uncertain",
          status: null,
          reason: "Runtime navigation completed, but its readiness evidence could not verify the target without AI."
        })
      } : {}
    }
  );
  const verifyPath = runtimeArrival || input.arrivalJudge === "never" ? "runtime" : "judge";
  const verifyMs = Date.now() - verifyStartedAt;
  ports.metrics?.verify(verifyMs, verifyPath, arrival.verdict);
  log3?.verify({ path: verifyPath, verdict: arrival.verdict, ms: verifyMs });
  if (arrival.verdict !== "match") {
    const guardedNotFound = arrival.status === "not-found" && node.guard;
    return {
      strategy: "render",
      ok: false,
      ...guardedNotFound ? { failure: "unavailable" } : {},
      reason: guardedNotFound ? explainGuardGate(node.guard) : settled.settled ? arrival.reason : `${arrival.reason} (screen had not settled: ${settled.reason})`,
      touchedDevice: true,
      arrival,
      elapsedMs: Date.now() - started,
      effects: guardedNotFound ? [{ kind: "guard-gate-closed", condition: node.guard.condition }] : []
    };
  }
  return {
    strategy: "render",
    ok: true,
    reason: arrival.reason,
    touchedDevice: true,
    arrival,
    evidence: {
      arrival,
      frame: diagnosticFramePath(scratchPath, SUFFIX),
      pressables,
      // No journey a user could repeat; see the doc comment.
      replayScript: null,
      replayVerified: false
    },
    elapsedMs: Date.now() - started,
    effects: []
  };
}

// packages/core/src/app-flow/reach/not-found-signal.ts
var CAPTION_RES = [
  /^404(?:\s*[-–—:|]?\s*(?:page |screen )?not found)?[.!]?$/i,
  /^(?:page|screen|route|url|link) not found[.!]?$/i,
  /^not found[.!]?$/i,
  /^unmatched route[.!]?$/i,
  /^(?:oops[,!.]?\s*)?(?:sorry[,!.]?\s*)?this (?:screen|page|route) does(?:n't| not) exist[.!]?$/i,
  /^(?:we )?could(?:n't| not) find (?:that|this) (?:page|screen|route)[.!]?$/i
];
var PHRASE_RES = [
  /\b(?:page|screen|route) (?:was )?not found\b/i,
  /\bunmatched route\b/i,
  /\bthis (?:screen|page|route) does(?:n't| not) exist\b/i,
  /\b404\b/
];
var EXIT_RES = [
  /^go (?:back )?(?:to )?home(?: screen)?[.!]?$/i,
  /^(?:back|return) to (?:home|the app|safety)[.!]?$/i,
  /^go home[.!]?$/i,
  /^take me home[.!]?$/i,
  /^go back[.!]?$/i
];
var FALLBACK_SIMILARITY_FLOOR = 0.6;
var MIN_FALLBACK_TOKENS = 3;
var SPARSE_SCREEN_MAX_CONTROLS = 8;
function captions(pressables) {
  const out = [];
  for (const pressable of pressables) {
    for (const source of [pressable.text, pressable.label, pressable.identifier]) {
      const text2 = source?.trim();
      if (text2) out.push(text2);
    }
  }
  return out;
}
function matchesAny(text2, patterns) {
  return patterns.some((pattern) => pattern.test(text2));
}
function detectNotFoundScreen(pressables, evidence = {}) {
  const noSignal = (reason) => ({ notFound: false, rule: null, reason });
  if (!pressables || !pressables.length) {
    return noSignal(
      "No controls could be read, so nothing identifies this frame as a not-found screen."
    );
  }
  const fallback = evidence.fallbackPressables;
  if (fallback && fallback.length) {
    const known = fingerprint(fallback);
    if (known.size >= MIN_FALLBACK_TOKENS) {
      const overlap = similarity(fingerprint(pressables), known);
      if (overlap >= FALLBACK_SIMILARITY_FLOOR) {
        return {
          notFound: true,
          rule: "captured-fallback",
          reason: `the screen matches this build's own captured not-found route (${overlap.toFixed(2)} control overlap)`
        };
      }
    }
  }
  const texts = captions(pressables);
  const caption = texts.find((text2) => matchesAny(text2, CAPTION_RES));
  if (caption) {
    return {
      notFound: true,
      rule: "caption",
      reason: `the screen shows "${caption}", which is the app's not-found screen`
    };
  }
  const phrase = texts.find((text2) => matchesAny(text2, PHRASE_RES));
  if (phrase) {
    if (pressables.length > SPARSE_SCREEN_MAX_CONTROLS) {
      return noSignal(
        `"${phrase}" appears here, but the screen carries ${pressables.length} controls, so it is content of its own rather than a not-found screen.`
      );
    }
    if (!texts.some((text2) => matchesAny(text2, EXIT_RES))) {
      return noSignal(
        `"${phrase}" appears here, but the screen offers no way back to the app, so it is not conclusively the not-found screen.`
      );
    }
    return {
      notFound: true,
      rule: "phrase-and-exit",
      reason: `the screen shows "${phrase}" with a way back to the app and nothing else, which is the app's not-found screen`
    };
  }
  return noSignal("Nothing on this screen identifies it as the app\u2019s not-found screen.");
}

// packages/core/src/app-flow/cancel.ts
function checkSignal(signal) {
  if (signal?.aborted) throw new Error("Cancelled");
}

// packages/core/src/app-flow/reach/strategies/deep-link.ts
function skip(reason, effects = []) {
  return {
    strategy: "deep-link",
    ok: false,
    reason,
    touchedDevice: false,
    elapsedMs: 0,
    effects
  };
}
var FRAME_RESETTLE_TIMEOUT_MS = 1500;
function routeDeclaresParams(node) {
  if (node.params?.length) return true;
  const path = node.urlPath ?? "";
  return path.split("/").some(
    (segment) => segment.startsWith(":") || segment.startsWith("[") && segment.endsWith("]")
  );
}
function isKnownRoutePrefix(prefix, nodes, self) {
  const wanted = prefix.replace(/\/+$/, "");
  if (!wanted || wanted === "/") return false;
  return nodes.some(
    (candidate) => candidate.id !== self.id && (candidate.urlPath ?? "").replace(/\/+$/, "") === wanted
  );
}
async function deepLinkStrategy(input, ports) {
  const startedAt = Date.now();
  const {
    node,
    unresolvedParams,
    params,
    budget,
    scratchPath,
    signal,
    breaker,
    storedRejection,
    memoRejected,
    guardGateClosed,
    nodesForAncestry,
    reprobe,
    arrivalJudge = true,
    notFoundEvidence
  } = input;
  const withTiming = (attempt) => ({
    ...attempt,
    elapsedMs: Date.now() - startedAt
  });
  if (!breaker.enabled) return withTiming(skip("Deep links are disabled for this sweep."));
  if (!node.urlPath || budget.expired) {
    return withTiming(skip("No urlPath to open, or budget already exhausted."));
  }
  if (isUndeeplinkableRoot(node)) {
    return withTiming(
      skip(`${node.id} sits at "/" and this app declares no route group to open instead.`)
    );
  }
  const target2 = paramFreeDeepLink(node.urlPath, unresolvedParams);
  const named = unresolvedParams.map((key2) => `:${key2}`).join(", ");
  if (!target2) {
    return withTiming(skip(`Deep link needs a real ${named} and no call site supplies one.`));
  }
  const partial = target2 !== node.urlPath;
  if (partial && !isKnownRoutePrefix(target2, nodesForAncestry, node)) {
    return withTiming(
      skip(
        `Deep link needs a real ${named}, and "${target2}" is not a route this app declares \u2014 nothing to open short of it.`
      )
    );
  }
  const stored = evaluateDeepLinkAttempt(node, target2, storedRejection);
  if (stored.action === "skip") return withTiming(skip(stored.reason));
  if (memoRejected(target2)) {
    return withTiming(skip(`Deep link ${target2} already rejected earlier this sweep.`));
  }
  if (!partial && node.guard && guardGateClosed(node.guard.condition)) {
    return withTiming({
      ...skip(explainGuardGate(node.guard)),
      failure: "unavailable"
    });
  }
  try {
    const opened = await ports.device.openDeepLink(
      partial ? { ...node, urlPath: target2, params: [] } : node,
      params
    );
    checkSignal(signal);
    const route = await ports.device.waitForRoute();
    const judgeThisOpen = arrivalJudge === "never" || partial ? false : arrivalJudge || routeDeclaresParams(node);
    const { arrival, pressables } = await verifyWithDiagnostic(
      ports,
      node,
      scratchPath,
      "deep-link-check",
      budget,
      {
        withPressables: true,
        // The straddle check. Every input is already in hand: the open's own pre-open read, the
        // settle's last read, and the node's static vocabulary. See `reach/frame-stability.ts`.
        frameStability: {
          preOpen: opened.preOpenPressables ?? null,
          settled: route.pressables,
          targetCoverage: (observed) => observed?.length ? expectedCoverage(fingerprint(observed), expectedNodeTokens(node)) : null,
          resettle: async () => (await ports.device.waitForRoute({ timeoutMs: FRAME_RESETTLE_TIMEOUT_MS })).pressables
        },
        // With the judge off, the open is a match by default and the one thing still worth
        // deciding is whether this is the build's own 404 — the single bit the rest of this
        // function branches on. A `mismatch`/`not-found` verdict is synthesised rather than
        // threading a null arrival through, so every call site below (and `ReachEvidence.arrival`,
        // and `AppFlowCapture.status`) keeps reading the same field it always read.
        verdictWithoutJudge: judgeThisOpen ? void 0 : (pressables2) => {
          if (!route.settled) {
            return {
              verdict: "uncertain",
              status: null,
              reason: `${target2} opened but the app never reached a stable frame, so nothing here says where it landed`
            };
          }
          const signal2 = detectNotFoundScreen(pressables2, notFoundEvidence);
          return signal2.notFound ? {
            verdict: "mismatch",
            status: "not-found",
            reason: `${signal2.reason} (detected without the arrival judge, rule: ${signal2.rule})`
          } : {
            // The `match` arm is the full open with the judge off: a fixed URL that did
            // not render the build's 404 is the screen it names.
            //
            // The `mismatch` arm is every partial open, which no longer reaches the judge
            // at all (see `judgeThisOpen`). A partial put the app on a prefix URL, never
            // on this node, so a partial that is not a 404 is a mismatch that landed on a
            // real screen — the `deep-link-partial-landed` case and the bounded last hop
            // below. Calling it a match would claim the target was reached by opening
            // something else.
            verdict: partial ? "mismatch" : "match",
            status: "ok",
            reason: partial ? `${target2} opened a real screen short of the target, so the last hop is still to walk` : `${target2} opened and the app did not render its not-found screen (arrival judge disabled for deep links)`
          };
        }
      }
    );
    checkSignal(signal);
    if (arrival.verdict === "uncertain") {
      return withTiming({
        strategy: "deep-link",
        ok: false,
        reason: `Deep link ${target2} proved nothing: ${arrival.reason}`,
        touchedDevice: true,
        arrival,
        elapsedMs: 0,
        effects: []
      });
    }
    if (arrival.verdict !== "match") {
      const effects2 = [{ kind: "deep-link-memo-rejected", url: target2 }];
      if (arrival.status === "not-found" && !partial) {
        const ancestor = node.urlPath ? findRouteAncestor(node.urlPath, nodesForAncestry) : null;
        const unavailableReason = explainUnavailable(node, ancestor?.capturedStatus ?? null);
        if (unavailableReason && node.guard) {
          effects2.push({ kind: "guard-gate-closed", condition: node.guard.condition });
        }
        effects2.push({
          kind: "deep-link-rejection-recorded",
          nodeId: node.id,
          rejection: recordDeepLinkRejection(node, target2, arrival.reason, (/* @__PURE__ */ new Date()).toISOString())
        });
        effects2.push({ kind: "deep-link-not-found" });
        return withTiming({
          strategy: "deep-link",
          ok: false,
          failure: unavailableReason ? "unavailable" : void 0,
          reason: unavailableReason ?? `Deep link ${target2} did not reach target: ${arrival.reason}`,
          touchedDevice: true,
          arrival,
          elapsedMs: 0,
          effects: effects2
        });
      }
      if (partial) {
        if (arrival.status !== "not-found") {
          const ancestorId = node.urlPath ? findRouteAncestor(node.urlPath, nodesForAncestry)?.id ?? node.id : node.id;
          effects2.push({
            kind: "deep-link-partial-landed",
            seed: { id: ancestorId, urlPath: target2, url: opened.url, app: opened.app }
          });
        }
        return withTiming({
          strategy: "deep-link",
          ok: false,
          reason: `Deep link ${target2} did not reach target: ${arrival.reason}`,
          touchedDevice: true,
          arrival,
          elapsedMs: 0,
          effects: effects2
        });
      }
      const { decision } = registerDeepLinkFailure(breaker, Boolean(reprobe));
      if (decision.action === "disabled-immediately") {
        effects2.push({ kind: "deep-link-breaker-disabled" });
      } else if (decision.action === "reprobe" && reprobe) {
        let stillRoutes = false;
        try {
          stillRoutes = await reprobe();
        } catch {
          stillRoutes = false;
        }
        const reprobed = applyDeepLinkReprobeResult(breaker, stillRoutes);
        effects2.push(
          reprobed.enabled ? { kind: "deep-link-breaker-success" } : { kind: "deep-link-breaker-disabled" }
        );
      } else {
        effects2.push({ kind: "deep-link-breaker-failure" });
      }
      return withTiming({
        strategy: "deep-link",
        ok: false,
        reason: `Deep link ${target2} did not reach target: ${arrival.reason}`,
        touchedDevice: true,
        arrival,
        elapsedMs: 0,
        effects: effects2
      });
    }
    const effects = [
      { kind: "deep-link-opened", nodeId: node.id, opened },
      { kind: "deep-link-breaker-success" }
    ];
    if (storedRejection) effects.push({ kind: "deep-link-rejection-cleared", nodeId: node.id });
    return withTiming({
      strategy: "deep-link",
      ok: true,
      reason: arrival.reason,
      touchedDevice: true,
      arrival,
      // The app is standing on the screen the judge just accepted and this strategy is done with
      // the device, so that frame is still what the screen looks like. Delivery takes it instead of
      // shooting the same screen a second time.
      evidence: {
        arrival,
        frame: diagnosticFramePath(scratchPath, "deep-link-check"),
        pressables,
        replayScript: null,
        replayVerified: false
      },
      elapsedMs: 0,
      effects
    });
  } catch (error) {
    checkSignal(signal);
    const effects = [];
    if (!partial) {
      const { decision } = registerDeepLinkFailure(breaker, Boolean(reprobe));
      effects.push(
        decision.action === "disabled-immediately" ? { kind: "deep-link-breaker-disabled" } : { kind: "deep-link-breaker-failure" }
      );
    }
    return withTiming({
      strategy: "deep-link",
      ok: false,
      reason: `Deep link failed verification: ${error instanceof Error ? error.message : String(error)}`,
      touchedDevice: true,
      elapsedMs: 0,
      effects
    });
  }
}

// packages/core/src/app-flow/reach/strategies/saved-replay.ts
import { existsSync as existsSync3, readFileSync as readFileSync2 } from "node:fs";
async function savedReplayStrategy(input, ports) {
  const startedAt = Date.now();
  const { node, scriptPath, budget, remaining, scratchPath, signal } = input;
  const elapsedMs = () => Date.now() - startedAt;
  if (!existsSync3(scriptPath) || budget.expired) {
    return {
      strategy: "saved-replay",
      ok: false,
      reason: "No saved replay to try.",
      touchedDevice: false,
      elapsedMs: elapsedMs(),
      effects: []
    };
  }
  try {
    const timeoutMs = Math.max(1e3, Math.min(12e4, budget.remainingMs));
    const guard = destinationGuardSelector(readFileSync2(scriptPath, "utf8").split("\n"));
    if (guard === void 0) {
      const replay = await ports.device.replayRun({ path: scriptPath, timeoutMs });
      checkSignal(signal);
      if (!replay.sessionActive) throw new Error("Replay did not leave an active session");
    } else {
      await ports.recorder.verifyAndRepairReplay(scriptPath, guard, timeoutMs);
      checkSignal(signal);
    }
    const auth = await ports.auth.checkGate(remaining, budget);
    if (auth === "stop") {
      return {
        strategy: "saved-replay",
        ok: false,
        failure: "auth-stopped",
        reason: "Auth gate stopped the sweep.",
        touchedDevice: true,
        elapsedMs: elapsedMs(),
        effects: []
      };
    }
    if (auth === "exhausted") {
      return {
        strategy: "saved-replay",
        ok: false,
        reason: "Navigation budget exhausted after five minutes.",
        touchedDevice: true,
        elapsedMs: elapsedMs(),
        effects: []
      };
    }
    const { arrival, pressables } = await verifyWithDiagnostic(
      ports,
      node,
      scratchPath,
      "saved-replay-check",
      budget,
      { withPressables: true }
    );
    checkSignal(signal);
    if (arrival.verdict !== "match") {
      return {
        strategy: "saved-replay",
        ok: false,
        reason: `Saved replay did not reach target: ${arrival.reason}`,
        touchedDevice: true,
        arrival,
        elapsedMs: elapsedMs(),
        effects: []
      };
    }
    return {
      strategy: "saved-replay",
      ok: true,
      reason: arrival.reason,
      touchedDevice: true,
      arrival,
      // The replay put the app on the screen, the judge accepted that frame, and this strategy
      // then stops touching the device — so the frame and the controls both still describe what is
      // on screen, and delivery takes them instead of shooting and reading the same screen again.
      evidence: {
        arrival,
        frame: diagnosticFramePath(scratchPath, "saved-replay-check"),
        pressables,
        replayScript: scriptPath,
        replayVerified: true
      },
      elapsedMs: elapsedMs(),
      effects: []
    };
  } catch (error) {
    checkSignal(signal);
    return {
      strategy: "saved-replay",
      ok: false,
      reason: `Saved replay diverged: ${error instanceof Error ? error.message : String(error)}`,
      touchedDevice: true,
      elapsedMs: elapsedMs(),
      effects: []
    };
  }
}

// packages/core/src/app-flow/reach/exploration-control.ts
var DEFAULT_ATTEMPTS_PER_SCREEN = 2;
var DEFAULT_MS_PER_SCREEN = 45e3;
var ExplorationControl = class {
  explored = 0;
  attempted = 0;
  screenLimit;
  attemptLimit;
  deadlineAt;
  now;
  pauseRequested;
  constructor(screenLimit, pauseRequested = () => false, options = {}) {
    screenLimit = normalizeAppFlowScreenLimit(screenLimit);
    this.screenLimit = screenLimit;
    this.pauseRequested = pauseRequested;
    this.now = options.now ?? Date.now;
    this.attemptLimit = options.attemptLimit ?? (screenLimit === void 0 ? void 0 : screenLimit * DEFAULT_ATTEMPTS_PER_SCREEN);
    const deadlineMs = options.sweepDeadlineMs ?? (screenLimit === void 0 ? void 0 : screenLimit * DEFAULT_MS_PER_SCREEN);
    this.deadlineAt = deadlineMs === void 0 ? void 0 : this.now() + deadlineMs;
  }
  /** Screens successfully captured so far — what `screenLimit` is measured against. */
  get screensExplored() {
    return this.explored;
  }
  /** Screens finished so far, captured or not — what `attemptLimit` is measured against. */
  get screensAttempted() {
    return this.attempted;
  }
  beforeNextScreen() {
    if (this.pauseRequested()) return "requested";
    if (this.screenLimit !== void 0 && this.explored >= this.screenLimit) return "limit";
    if (this.attemptLimit !== void 0 && this.attempted >= this.attemptLimit) return "attempts";
    if (this.deadlineAt !== void 0 && this.now() >= this.deadlineAt) return "deadline";
    return null;
  }
  screenFinished(captured) {
    if (captured) this.explored += 1;
    this.attempted += 1;
    return this.beforeNextScreen();
  }
};

// packages/core/src/app-flow/runtime-navigator.ts
var WALK_BUDGET2 = 6e4;
var WALK_DEADLINE_MS2 = 1e3;
var COLLECT_ROOTS_JS = `
  var collectFiberRoots = function () {
    var hook = globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__
    if (!hook || typeof hook.getFiberRoots !== "function") return []
    // Enumerate renderers rather than assuming React Native is id 1: \`hook.renderers\` is keyed by
    // registration order, so a bundle that registers anything first would leave a fixed id empty.
    var rendererIds = []
    try {
      if (hook.renderers && typeof hook.renderers.forEach === "function") {
        hook.renderers.forEach(function (renderer, id) {
          if (!renderer || renderer.rendererPackageName === "react-native-renderer") rendererIds.push(id)
        })
      }
    } catch (error) {}
    if (!rendererIds.length) rendererIds.push(1)
    var stack = []
    for (var r = 0; r < rendererIds.length; r++) {
      var roots = null
      try { roots = hook.getFiberRoots(rendererIds[r]) } catch (error) { roots = null }
      if (!roots || typeof roots.forEach !== "function") continue
      roots.forEach(function (root) { if (root && root.current) stack.push(root.current) })
    }
    return stack
  }
`;
var FIND_NAVIGATOR_JS = `
  ${COLLECT_ROOTS_JS}
  var findNavigator = function () {
    var stack = collectFiberRoots()
    if (!stack.length) return null
    var deadline = Date.now() + ${WALK_DEADLINE_MS2}
    var budget = ${WALK_BUDGET2}
    var seen = new Set()
    // Climbs a screen's navigation object to the navigator that owns the whole tree.
    var climb = function (value) {
      if (!value || typeof value !== "object") return null
      if (typeof value.getState !== "function" || typeof value.getParent !== "function") return null
      try {
        var nav = value
        var climbed = new Set()
        while (typeof nav.getParent === "function" && !climbed.has(nav)) {
          climbed.add(nav)
          var parent = nav.getParent()
          if (!parent) break
          nav = parent
        }
        var state = typeof nav.getRootState === "function" ? nav.getRootState() : nav.getState()
        return state && state.routes ? { nav: nav, state: state } : null
      } catch (error) {
        return null
      }
    }
    var found = null
    while (stack.length && budget-- > 0 && !found) {
      if ((budget & 255) === 0 && Date.now() > deadline) return null
      var fiber = stack.pop()
      if (!fiber || seen.has(fiber)) continue
      seen.add(fiber)
      var memo = fiber.memoizedState
      var props = fiber.memoizedProps
      var carriers = [
        fiber.stateNode,
        props && props.value,
        props && props.navigationRef,
        memo && memo.memoizedState && memo.memoizedState.current
      ]
      for (var at = 0; at < carriers.length && !found; at++) {
        var carrier = carriers[at]
        if (carrier && typeof carrier.getRootState === "function") {
          try {
            // Called on the carrier, not detached from it: a container ref reads its own internals
            // through its receiver, and a detached reference would throw on the first read. A
            // carrier that throws or answers without routes is skipped rather than accepted, so a
            // still-mounting ref cannot end the search as a successful read of an empty sweep.
            var direct = carrier.getRootState()
            if (direct && direct.routes) found = { nav: carrier, state: direct }
          } catch (error) {}
        }
      }
      if (!found) found = climb(props && props.navigation)
      if (!found) found = climb(props && props.value)
      if (!found) found = climb(fiber.stateNode)
      if (fiber.child) stack.push(fiber.child)
      if (fiber.sibling) stack.push(fiber.sibling)
    }
    return found
  }
`;

// packages/core/src/app-flow/nav-state.ts
var SETUP_TIMEOUT_MS2 = 3e4;
var EVAL_TIMEOUT_MS = 5e3;
var NAV_STATE_CHUNK = 160;
var NAV_STATE_STASH = "__aiHarnessNavState";
var NAV_STATE_EXPR = `(() => {
  try {
    ${FIND_NAVIGATOR_JS}
    var found = findNavigator()
    if (!found) return null
    var state = found.state
    if (!state) return null
    var flat = []
    var walk = function (node, depth) {
      if (!node || depth > 12 || !Array.isArray(node.routes)) return
      for (var i = 0; i < node.routes.length; i++) {
        var route = node.routes[i]
        if (!route || typeof route.name !== "string") continue
        var entry = { name: route.name }
        if (typeof route.path === "string" && route.path) entry.path = route.path
        var raw = route.params
        if (raw && typeof raw === "object" && !Array.isArray(raw)) {
          var kept = {}
          var any = false
          for (var key in raw) {
            var value = raw[key]
            if (typeof value === "string") { kept[key] = value; any = true }
            else if (typeof value === "number" && isFinite(value)) { kept[key] = String(value); any = true }
          }
          if (any) entry.params = kept
        }
        flat.push(entry)
        if (route.state) walk(route.state, depth + 1)
      }
    }
    walk(state, 0)
    var payload = JSON.stringify(flat)
    // Stashed so the remaining slices come from this same read; see the doc comment above.
    try { globalThis[${JSON.stringify(NAV_STATE_STASH)}] = payload } catch (error) {}
    return "AIHNS1:" + payload.length + ":" + payload.slice(0, ${NAV_STATE_CHUNK})
  } catch (error) {
    return null
  }
})()`;
function navStateChunkExpr(offset) {
  return `(() => {
  try {
    var payload = globalThis[${JSON.stringify(NAV_STATE_STASH)}]
    if (typeof payload !== "string") return null
    return "AIHNS1:" + payload.length + ":" + payload.slice(${Math.trunc(offset)}, ${Math.trunc(offset) + NAV_STATE_CHUNK})
  } catch (error) {
    return null
  }
})()`;
}
function parseNavStateChunk(output) {
  const envelope = /"((?:\\.|[^"\\])*)"/g;
  for (const match of output.matchAll(envelope)) {
    const text2 = tryParse(`"${match[1]}"`);
    if (typeof text2 !== "string") continue;
    const framed = /^AIHNS1:(\d{1,9}):([\s\S]*)$/.exec(text2);
    if (!framed) continue;
    return { total: Number(framed[1]), slice: framed[2] ?? "" };
  }
  return null;
}
function parseNavStateOutput(output) {
  for (const candidate of navStateCandidates(output)) {
    const routes = asRoutes(tryParse(candidate));
    if (routes) return routes;
  }
  return null;
}
function* navStateCandidates(output) {
  const open2 = output.indexOf("[");
  const close = output.lastIndexOf("]");
  if (open2 !== -1 && close > open2) yield output.slice(open2, close + 1);
  for (const match of output.matchAll(/"(\[(?:\\.|[^"\\])*\])"/g)) {
    const unescaped = tryParse(`"${match[1]}"`);
    if (typeof unescaped === "string") yield unescaped;
  }
}
function tryParse(text2) {
  try {
    return JSON.parse(text2);
  } catch {
    return null;
  }
}
function asRoutes(value) {
  if (!Array.isArray(value)) return null;
  const routes = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const entry = item;
    if (typeof entry.name !== "string" || !entry.name) return null;
    const route = { name: entry.name };
    if (typeof entry.path === "string" && entry.path) route.path = entry.path;
    if (entry.params && typeof entry.params === "object" && !Array.isArray(entry.params)) {
      const params = {};
      for (const [key2, raw] of Object.entries(entry.params)) {
        if (typeof raw === "string") params[key2] = raw;
      }
      if (Object.keys(params).length) route.params = params;
    }
    routes.push(route);
  }
  return routes;
}
async function selectNavStateTarget(metroPort, appLabel, deps, pickTarget) {
  const metroUrl = `http://127.0.0.1:${metroPort}`;
  try {
    const listed = await deps.run(
      deps.cdpCommand(`target list --url ${deps.quote(metroUrl)}`),
      SETUP_TIMEOUT_MS2
    );
    const target2 = pickTarget(listed, [appLabel, "React Native"]);
    if (!target2) {
      deps.log?.(`no Metro CDP target at ${metroUrl}`);
      return false;
    }
    await deps.run(deps.cdpCommand(`target select ${deps.quote(target2)}`), SETUP_TIMEOUT_MS2);
    return true;
  } catch (error) {
    deps.log?.(`could not select a Metro CDP target \u2014 ${errorText(error)}`);
    return false;
  }
}
async function readNavState(deps) {
  try {
    const first = parseNavStateChunk(
      await deps.run(
        deps.cdpCommand(`runtime eval --expr ${deps.quote(NAV_STATE_EXPR)}`),
        EVAL_TIMEOUT_MS
      )
    );
    if (!first) {
      deps.log?.("navigation state eval returned nothing usable");
      return null;
    }
    let payload = first.slice;
    while (payload.length < first.total) {
      const next = parseNavStateChunk(
        await deps.run(
          deps.cdpCommand(`runtime eval --expr ${deps.quote(navStateChunkExpr(payload.length))}`),
          EVAL_TIMEOUT_MS
        )
      );
      if (!next?.slice.length || next.total !== first.total) {
        deps.log?.(
          `navigation state read truncated at ${payload.length} of ${first.total} characters`
        );
        return null;
      }
      payload += next.slice;
    }
    const routes = parseNavStateOutput(payload);
    if (!routes) deps.log?.("navigation state eval returned nothing usable");
    return routes;
  } catch (error) {
    deps.log?.(`navigation state eval failed \u2014 ${errorText(error)}`);
    return null;
  }
}
function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}

// packages/core/src/app-flow/nav-state-gate.ts
var NAV_STATE_SPECULATIVE_READS = 3;
function selectNavStateWaiters(from, blocked, nodes, speculativeBudget) {
  if (!blocked.length) return { waiting: [], speculative: false };
  const waiting = blocked.filter(
    (other) => other.urlPath && findRouteAncestors(other.urlPath, nodes).some((ancestor) => ancestor.id === from.id)
  );
  if (waiting.length) return { waiting, speculative: false };
  if (!from.urlPath && speculativeBudget > 0) return { waiting: [...blocked], speculative: true };
  return { waiting: [], speculative: false };
}

// packages/core/src/app-flow/link-harvest.ts
function ingestLinkCandidates(links, seenOn, nodes, store) {
  let usable = 0;
  let unmatched = 0;
  for (const link of links) {
    let landed = false;
    if (link.path && store.ingestUrl(link.path, seenOn, nodes)) landed = true;
    if (link.name && link.params) {
      const target2 = resolveNavRouteTarget(nodes, link.name);
      if (target2 && store.ingestNavRoute(target2, link.params, seenOn)) landed = true;
    }
    if (landed) usable += 1;
    else unmatched += 1;
  }
  return { usable, unmatched };
}

// packages/core/src/app-flow/shell.ts
import { spawn as spawn2 } from "node:child_process";
async function runShellCommand(command, cwd, timeoutMs, signal) {
  if (signal?.aborted) throw new Error("Cancelled");
  return await new Promise((resolve3, reject) => {
    const child = spawn2("/bin/zsh", ["-lc", resolveAgentDeviceCommand(command)], { cwd });
    let output = "";
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (error) child.kill("SIGKILL");
      if (error) reject(error);
      else resolve3(output);
    };
    const timer = setTimeout(
      () => finish(new Error(`Timed out after ${timeoutMs}ms: ${command}`)),
      timeoutMs
    );
    const onAbort = () => finish(new Error("Cancelled"));
    signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout?.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.on("error", (error) => finish(error));
    child.on("close", (code) => {
      if (code === 0) finish(null);
      else finish(new Error(`Exited ${code ?? "unknown"}: ${output.trim().slice(0, 400)}`));
    });
  });
}

// packages/core/src/app-flow-deps/profiling/cdp.ts
function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
}
function text(value) {
  return typeof value === "string" && value.trim() ? value : null;
}
function target(value) {
  const item = record(value), id2 = text(item?.id) ?? text(item?.targetId);
  return item && id2 ? { id: id2, kind: text(item.kind) ?? text(item.type) ?? "unknown", title: text(item.title) ?? text(item.label) ?? id2 } : null;
}
function parseCdpTargetList(output) {
  let payload = null;
  try {
    payload = JSON.parse(output);
  } catch {
  }
  const object = record(payload);
  const items = Array.isArray(payload) ? payload : Array.isArray(object?.targets) ? object.targets : Array.isArray(object?.items) ? object.items : null;
  if (items) {
    const parsed = items.map(target).filter((item) => item !== null);
    if (parsed.length) return parsed;
  }
  const targets = [];
  for (const line of output.trim().split(/\r?\n/)) {
    if (/^no targets found$/i.test(line.trim())) continue;
    const match = line.trim().match(/^(\S+)\s+(\S+)\s+(\S.*)$/);
    if (match) targets.push({ id: match[1], kind: match[2], title: match[3] });
  }
  return targets;
}
function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
function agentDeviceCdp(deviceSession, cdpArgs, verbose = false) {
  return `agent-device --session ${shellQuote(deviceSession)} cdp ${verbose ? "--verbose " : ""}${cdpArgs}`;
}
function pickMetroCdpTarget(targets, preferred) {
  for (const label of preferred.map((value) => value?.trim()).filter((value) => Boolean(value))) {
    const match = targets.find((item) => item.title.toLowerCase().includes(label.toLowerCase()));
    if (match) return match;
  }
  return targets.find((item) => /react native/i.test(item.title)) ?? targets[0] ?? null;
}

// packages/core/src/app-flow/orchestrator.ts
var BLOCKED_SLUG = "--blocked";
function isDeterministicMode(mode) {
  return mode === "fast" || mode === "adaptive";
}
function isNonActionableAiCapture(capture) {
  return capture.status === "unavailable" || capture.status === "not-found" || capture.status === "auth-wall" || /\b(auth|sign[ -]?in|log[ -]?in)\b/i.test(capture.note ?? "");
}
var ARRIVAL_SIMILARITY = 0.9;
var BLOCKED_RUN_LIMIT = 3;
async function computeFastSourceHash(projectPath, nodes) {
  const hash2 = createHash8("sha256");
  const files = [...new Set(nodes.map((node) => node.file).filter((file) => !!file))].sort();
  for (const file of files) {
    const absolute = isAbsolute3(file) ? file : join11(projectPath, file);
    hash2.update(file).update("\0");
    try {
      hash2.update(await readFile6(absolute));
    } catch {
      hash2.update("unreadable");
    }
    hash2.update("\0");
  }
  return hash2.digest("hex").slice(0, 24);
}
var OPPORTUNISTIC_VERIFY_LIMIT = 2;
var OPPORTUNISTIC_MIN_REMAINING_MS = 6e4;
var RUNTIME_NODE_SWEEP_CAP = 10;
var ADOPTED_APP_READY_BUDGET_MS = 15e3;
function emit(projectId, onEvent, event) {
  try {
    onEvent({ ...event, projectId });
  } catch (error) {
    console.error("App flow event listener error:", error);
  }
}
function buildAgentDeviceScreens(nodes, edges, runtimeEdges, chrome, ctx, device, openedByNode, inferred, captures) {
  const used = /* @__PURE__ */ new Set();
  const screens = {};
  for (const node of nodes) {
    const params = pickSampleParams(node, edges);
    const guessed = inferred[node.id];
    const key2 = uniqueScreenKey((guessed?.key ?? "").trim() || fallbackScreenKey(node), used);
    const info = guessed?.info?.trim() || defaultScreenInfo(node);
    const capture = captures[node.id];
    const pathToReach = capture?.pathCommands?.length ? [...capture.pathCommands] : capture?.replayScript ? replayPathToReach(device, capture.replayScript) : openedByNode[node.id] ? buildAgentDevicePathToReach(ctx, device, node, params, openedByNode[node.id]) : buildChromePathToReach(node, edges, runtimeEdges, chrome, device) ?? [];
    if (pathToReach.length === 0) continue;
    const pathVerified = isPathVerified({
      pathCommands: capture?.pathCommands,
      replayScript: capture?.replayScript,
      replayVerified: capture?.replayVerified,
      deepLinkOpened: Boolean(openedByNode[node.id])
    });
    const entry = {
      key: key2,
      screenId: node.id,
      info,
      pressables: capture?.pressables ?? [],
      pathToReach,
      pathVerified,
      // Reported, not acted on — see `contentMatchedSelectors`. Computed from the finished path
      // rather than threaded out of the walk so it covers all four sources uniformly: the stored
      // `Profile-List` path leans on `label="Dummy"` (a list this account owns) and the stored
      // `TermsOfService` path on `label="Terms of Service"`, and both are facts about the path, not
      // about which producer wrote it.
      pathContentSelectors: contentMatchedSelectors(pathToReach),
      replayScript: capture?.replayScript ?? null,
      replayVerified: capture?.replayVerified ?? false
    };
    screens[key2] = entry;
  }
  return screens;
}
function withReplayableCaptures(nodes, screens) {
  const entries = new Map(
    Object.values(screens).filter(
      (entry) => Boolean(entry.screenId)
    ).map((entry) => [entry.screenId, entry])
  );
  return nodes.map((node) => {
    if (!node.capture) return node;
    const entry = entries.get(node.id);
    return {
      ...node,
      capture: {
        ...node.capture,
        replayable: Boolean(entry),
        // Carried across for the same reason `replayable` is: the renderer never reads
        // `agent-device-screens.json`, so anything the Replay button has to say about the path it
        // is about to run has to be on the capture. Stamped from the entry the map actually holds,
        // never re-derived, so the document and the map cannot disagree about whether a path was
        // walked.
        ...entry ? { pathVerified: entry.pathVerified ?? false } : {},
        ...entry?.pathContentSelectors?.length ? { pathContentSelectors: [...entry.pathContentSelectors] } : {}
      }
    };
  });
}
function logAgentInput(label, input) {
  const parts = [`prompt ${input.userPrompt.length} chars`];
  if (input.systemPrompt) parts.push(`system ${input.systemPrompt.length} chars`);
  if (input.imagePath) parts.push(`image ${basename3(input.imagePath)}`);
  if (input.historyMessages !== void 0) parts.push(`history ${input.historyMessages} msgs`);
  parts.push(`tools [${(input.tools ?? []).join(", ")}]`);
  const head2 = input.userPrompt.replace(/\s+/g, " ").slice(0, 160);
  console.log(`[app-flow] agent-in ${label} \u2014 ${parts.join(", ")} :: ${head2}`);
}
function logAgentOutput(label, result) {
  const tools = result.toolCalls.length ? result.toolCalls.map((call) => call.name).join(", ") : "none";
  console.log(
    `[app-flow] agent-out ${label} \u2014 turns ${result.diagnostics.length}, tool calls ${result.toolCalls.length} (${tools}), text ${result.text.length} chars${result.timedOut ? ", TIMED OUT" : ""}`
  );
}
function logAgentTokens(label, used, elapsedMs, running, ledger) {
  ledger?.record("model", elapsedMs);
  const cache = used.cacheRead || used.cacheWrite ? ` cache r${used.cacheRead}/w${used.cacheWrite}` : "";
  const reasoning = used.reasoning ? ` reasoning ${used.reasoning}` : "";
  const cost = used.cost ? ` $${used.cost.toFixed(4)}` : "";
  console.log(
    `[app-flow] tokens ${label} \u2014 in ${used.input} out ${used.output}${cache}${reasoning} total ${used.total}${cost} in ${(elapsedMs / 1e3).toFixed(1)}s (sweep ${running.total})`
  );
}
var HEDGE_AFTER_MS = 8e3;
function hedgeableAfterMs(agentOptions) {
  return (agentOptions.tools?.length ?? 0) === 0 ? HEDGE_AFTER_MS : Infinity;
}
function logPhaseSummary(ledger) {
  for (const line of formatPhaseSummary(ledger)) console.log(line);
}
function tokenUsageSince(before, after) {
  return {
    input: Math.max(0, after.input - before.input),
    output: Math.max(0, after.output - before.output),
    cacheRead: Math.max(0, after.cacheRead - before.cacheRead),
    cacheWrite: Math.max(0, after.cacheWrite - before.cacheWrite),
    reasoning: Math.max(0, after.reasoning - before.reasoning),
    total: Math.max(0, after.total - before.total),
    cost: Math.max(0, after.cost - before.cost)
  };
}
function logAgentFailure(label, error, elapsedMs) {
  console.error(
    `[app-flow] agent-failed ${label} after ${(elapsedMs / 1e3).toFixed(1)}s \u2014 ${error instanceof Error ? error.message : String(error)}`
  );
}
function logAgentTokenSummary(tallies, total, hedges) {
  const byCost = [...tallies.entries()].sort((a, b) => b[1].tokens.total - a[1].tokens.total);
  for (const [role, tally] of byCost) {
    const share = total.total ? Math.round(tally.tokens.total / total.total * 100) : 0;
    console.log(
      `[app-flow] tokens by role \u2014 ${role}: ${tally.calls} calls, ${tally.tokens.total} tokens (${share}%)${tally.tokens.cost ? `, $${tally.tokens.cost.toFixed(4)}` : ""}`
    );
  }
  const reasoning = total.reasoning ? ` reasoning ${total.reasoning}` : "";
  if (hedges)
    console.log(
      `[app-flow] tokens \u2014 ${hedges} hedged duplicate${hedges === 1 ? "" : "s"} billed to the total but not to any role above`
    );
  console.log(
    `[app-flow] tokens total \u2014 in ${total.input} out ${total.output}${reasoning} cache r${total.cacheRead}/w${total.cacheWrite} total ${total.total}${total.cost ? ` $${total.cost.toFixed(4)}` : ""}`
  );
}
function pickSampleParams(node, edges, store) {
  const resolved = resolveNodeParams(node, edges, store).values;
  return Object.fromEntries(node.params.map((key2) => [key2, resolved[key2] ?? "1"]));
}
function captureContext(projectPath, projectId, parsed, signal, timing) {
  return {
    projectPath,
    projectId,
    scheme: parsed.scheme,
    appName: parsed.appName,
    bundleId: parsed.bundleId,
    slug: parsed.slug,
    platform: "ios",
    sessionName: projectId,
    signal,
    timing
  };
}
async function buildAppFlow(options) {
  options = { ...options, screenLimit: normalizeAppFlowScreenLimit(options.screenLimit) };
  const { projectPath, signal } = options;
  const mode = options.mode ?? "structure-only";
  const activeNow = () => options.decisionProvider?.activeNow?.() ?? Date.now();
  const projectId = getProjectId(projectPath);
  let activeManifest = null;
  const startedAt = Date.now();
  const timing = new PhaseLedger(startedAt);
  let carriedDurationMs = 0;
  const finishManifest = async (final) => {
    final.durationMs = timing.wallMs;
    final.cumulativeDurationMs = carriedDurationMs + timing.wallMs;
    await writeManifest(projectId, final);
  };
  let tokens = emptyTokenUsage();
  const onEvent = (event) => options.onEvent({ ...event, tokens: snapshotUsage(tokens) });
  const tallies = /* @__PURE__ */ new Map();
  let hedges = 0;
  const recordAgentCall = (label, startedAt2, used) => {
    const role = label.split(" ")[0];
    const tally = tallies.get(role) ?? { calls: 0, tokens: emptyTokenUsage() };
    tallies.set(role, { calls: tally.calls + 1, tokens: addTokenUsage(tally.tokens, used) });
    logAgentTokens(label, used, Date.now() - startedAt2, tokens, timing);
  };
  const runAgent = async (agentOptions, label) => {
    logAgentInput(label, agentOptions);
    const startedAt2 = Date.now();
    const tokensBefore = snapshotUsage(tokens);
    const callOnce = () => {
      if (!options.decisionProvider) throw new Error("A decision provider is required for a screen sweep.");
      return options.decisionProvider.run(agentOptions, label);
    };
    let result;
    try {
      const outcome = await hedge({
        attempt: callOnce,
        // The guard `hedge` cannot make for itself. A call that can run twice harmlessly is one
        // with no tools to invoke and no session history to append to, which is every judge that
        // arrives here: one system prompt, one screenshot, a JSON verdict. A call carrying tools
        // could act on the device twice, so it waits however long it waits.
        afterMs: options.decisionProvider?.supportsConcurrentRequests === false ? Infinity : hedgeableAfterMs(agentOptions),
        onHedge: () => console.log(
          `[app-flow] hedge ${label} \u2014 no answer in ${(HEDGE_AFTER_MS / 1e3).toFixed(1)}s, racing a duplicate`
        )
      });
      result = outcome.result;
      hedges += outcome.attempts - 1;
      if (outcome.attempts > 1)
        console.log(
          `[app-flow] hedge ${label} \u2014 ${outcome.winner === 0 ? "the original" : "the duplicate"} answered first after ${((Date.now() - startedAt2) / 1e3).toFixed(1)}s`
        );
    } catch (error) {
      recordAgentCall(label, startedAt2, tokenUsageSince(tokensBefore, tokens));
      logAgentFailure(label, error, Date.now() - startedAt2);
      throw error;
    }
    tokens = addTokenUsage(tokens, result.tokens);
    recordAgentCall(label, startedAt2, result.tokens);
    logAgentOutput(label, result);
    return result;
  };
  const runAgentSession = async (sessionOptions) => {
    if (!options.decisionProvider) throw new Error("A decision provider is required for a screen sweep.");
    const hostSession = await options.decisionProvider.createSession(sessionOptions);
    const historyLength = () => hostSession.historyLength();
    return {
      prompt: async (callOptions, label) => {
        logAgentInput(label, {
          ...callOptions,
          systemPrompt: sessionOptions.systemPrompt,
          tools: sessionOptions.tools,
          historyMessages: historyLength()
        });
        const startedAt2 = Date.now();
        const tokensBefore = snapshotUsage(tokens);
        let result;
        try {
          result = await hostSession.prompt(callOptions, label);
        } catch (error) {
          recordAgentCall(label, startedAt2, tokenUsageSince(tokensBefore, tokens));
          logAgentFailure(label, error, Date.now() - startedAt2);
          throw error;
        }
        tokens = addTokenUsage(tokens, result.tokens);
        recordAgentCall(label, startedAt2, result.tokens);
        logAgentOutput(label, result);
        return result;
      },
      dispose: () => hostSession.dispose()
    };
  };
  try {
    checkSignal(signal);
    emit(projectId, onEvent, { type: "phase", phase: "parse", message: "Parsing routes..." });
    console.log("[app-flow] parse routes");
    const { name: name2 } = await registerProject(projectPath);
    console.log(`[app-flow] registered project "${name2}" (${projectId}) at ${projectPath}`);
    const previousManifest = await readManifest(projectId);
    const parseStartedAt = Date.now();
    const parsed = await parseProject(projectPath);
    if (!parsed) {
      throw new Error(
        `No supported Expo Router or React Navigation routes found in ${projectPath}.`
      );
    }
    console.log(
      `[app-flow] parse done in ${Date.now() - parseStartedAt}ms \u2014 ${parsed.nodes.length} routes, ${parsed.edges.length} edges, mode=${parsed.mode}, appDir=${parsed.appDir}`
    );
    const structureRevision = `${Date.now().toString(36)}-${randomUUID3().slice(0, 8)}`;
    const structureKey = computeStructureKey(parsed.nodes, parsed.edges);
    const fastSourceHash = await computeFastSourceHash(projectPath, parsed.nodes);
    const fastFingerprint = createHash8("sha256").update(agentSource()).digest("hex").slice(0, 24);
    const navigation = {
      layouts: parsed.layouts,
      rootNavigator: parsed.rootNavigator,
      entryLayouts: parsed.entryLayouts,
      entryScreenIds: parsed.entryScreenIds
    };
    const manifest = {
      // Bumped for Step 4's new persisted shape (`node.origin`, `edge.origin`/`evidence`,
      // `runtimeEdges`, `chrome`, `navigation`). Nothing branches on this number today; it exists so
      // a future reader can refuse a document it cannot represent.
      formatVersion: 4,
      generator: "ai-harness/app-flow",
      generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      project: {
        name: name2,
        path: projectPath,
        scheme: parsed.scheme,
        platform: "ios",
        mode: parsed.mode
      },
      buildMode: mode,
      structureRevision,
      sweepStatus: mode === "structure-only" ? "not-requested" : "running"
    };
    activeManifest = manifest;
    await writeManifest(projectId, manifest);
    const previous = await readAppFlow(projectId);
    const previousById = new Map(previous?.nodes.map((node) => [node.id, node]) ?? []);
    const usedSlugs = /* @__PURE__ */ new Set();
    const nodesWithSlug = parsed.nodes.map((node) => {
      const baseSlug = generateSlug2(node.id);
      const slug = usedSlugs.has(baseSlug) ? `${baseSlug}_${createHash8("sha256").update(node.id).digest("hex").slice(0, 8)}` : baseSlug;
      usedSlugs.add(slug);
      return {
        ...node,
        slug,
        capture: previousById.get(node.id)?.file === node.file && previousById.get(node.id)?.capture ? {
          ...previousById.get(node.id).capture,
          structureRevision: previous?.manifest.structureRevision,
          stale: true
        } : null,
        // Carried forward alongside `capture`, but independently validated: a rejection survives a
        // rebuild only when this node's own structure (id/file/urlPath/params) still matches what it
        // was recorded against, not when its capture happens to survive too.
        deepLinkRejection: carryForwardDeepLinkRejection(
          previousById.get(node.id)?.deepLinkRejection,
          node
        )
      };
    });
    const paramStore = ParamStore.fromJSON(await readParamStore(projectId));
    const partialResult = {
      manifest,
      nodes: nodesWithSlug,
      edges: parsed.edges,
      // This is the structure-only write, before the device sweep that discovers any of this even
      // starts — written as empty rather than left absent so a fresh v4 document never looks like a
      // mid-migration v3 one. The sweep below fills these in as it runs (plan Steps 3d/4a).
      runtimeEdges: [],
      chrome: [],
      navigation
    };
    await writeAppFlow(projectId, partialResult);
    const activeNodeIds = new Set(nodesWithSlug.map((node) => node.id));
    const previousScreens = await readAgentDeviceScreens(projectId);
    await writeAgentDeviceScreens(
      projectId,
      Object.fromEntries(
        Object.entries(previousScreens).filter(
          ([, entry]) => entry.screenId && activeNodeIds.has(entry.screenId)
        )
      )
    );
    emit(projectId, onEvent, {
      type: "structure-ready",
      phase: "render",
      message: `Structure ready: ${nodesWithSlug.length} screens, ${parsed.edges.length} edges.`
    });
    if (mode === "structure-only") {
      if (nodesWithSlug.some((node) => node.capture)) {
        carriedDurationMs = carriedSweepDurationMs(previousManifest, true);
      }
      await finishManifest(manifest);
      emit(projectId, onEvent, {
        type: "complete",
        phase: "render",
        message: "Structure complete."
      });
      return { ok: true, projectId, result: partialResult };
    }
    if (!options.decisionProvider && requiresDecisionProvider(mode, options.explorationMode, options.judgeUnclearScreens)) {
      throw new Error("A decision provider is required for a screen sweep.");
    }
    checkSignal(signal);
    const bootStartedAt = Date.now();
    const bootCtx = captureContext(projectPath, projectId, parsed, signal);
    const reusedDevice = options.launchedDevice;
    let device;
    let fastRuntime = null;
    let flushCheckpointOnExit = null;
    let sweepLogOnExit = null;
    if (reusedDevice) {
      emit(projectId, onEvent, {
        type: "phase",
        phase: "boot",
        message: "Checking the app you launched..."
      });
      device = reusedDevice;
    } else {
      emit(projectId, onEvent, {
        type: "phase",
        phase: "boot",
        message: "Booting the simulator, installing the app, and starting Metro..."
      });
      console.log("[app-flow] bootDevice start");
      device = await bootDevice(bootCtx);
      console.log("[app-flow] bootDevice done");
    }
    try {
      const ctx = captureContext(projectPath, projectId, parsed, signal, timing);
      checkSignal(signal);
      if (reusedDevice) {
        const metroCheckStartedAt = performance.now();
        const adoptedMetro = await ensureAdoptedMetro(bootCtx, device, {
          explorationMode: options.explorationMode ?? "adaptive"
        });
        recordRuntimeTiming("app_flow.runtime.connect", performance.now() - metroCheckStartedAt, {
          outcome: adoptedMetro.status === "degraded" ? "unavailable" : adoptedMetro.status === "recovered" ? "recovered" : "ready"
        });
        if (adoptedMetro.status === "recovered") {
          emit(projectId, onEvent, {
            type: "phase",
            phase: "boot",
            message: `Metro was not running; restarted it on port ${adoptedMetro.metroPort}.`
          });
        }
        if (adoptedMetro.warning) {
          console.warn(`[app-flow] ${adoptedMetro.warning}`);
          emit(projectId, onEvent, {
            type: "phase",
            phase: "boot",
            message: adoptedMetro.warning
          });
        }
        const adoptedAppReady = await waitForAppReady(
          bootCtx,
          device,
          signal,
          ADOPTED_APP_READY_BUDGET_MS,
          {
            minInteractiveElements: PROBE_FRAME_ELEMENT_FLOOR,
            minInteractiveElementsGraceMs: SUBSTANTIVE_FRAME_GRACE_MS
          }
        );
        if (adoptedAppReady) {
          console.log(
            "[app-flow] adopted the launched app as-is \u2014 it is already settled on a substantive frame, so no relaunch"
          );
        } else {
          console.log(
            "[app-flow] adopted app is not on a substantive frame \u2014 soft re-rooting it instead of relaunching"
          );
          await goHome(bootCtx, device, { reconnectDevClientWhenUnloaded: true });
          await waitForAppReady(bootCtx, device, signal, void 0, {
            minInteractiveElements: PROBE_FRAME_ELEMENT_FLOOR,
            minInteractiveElementsGraceMs: SUBSTANTIVE_FRAME_GRACE_MS
          });
        }
      } else {
        emit(projectId, onEvent, {
          type: "phase",
          phase: "boot",
          message: "Waiting for the app to finish loading..."
        });
        console.log("[app-flow] waitForAppReady start");
        await waitForAppReady(bootCtx, device, signal, void 0, {
          minInteractiveElements: PROBE_FRAME_ELEMENT_FLOOR,
          minInteractiveElementsGraceMs: SUBSTANTIVE_FRAME_GRACE_MS
        });
        console.log("[app-flow] waitForAppReady done");
      }
      timing.excludeWall(Date.now() - bootStartedAt);
      await pruneTransientScreens(projectId);
      await prepareScratchDir(projectId);
      let authCheckpointStored = false;
      let authCheckpointVersion = 0;
      let consecutiveSilentAuthChecks = 0;
      let authSettledBy = null;
      const runAuthGate = async (remaining, budget) => {
        let userResolved = false;
        for (; ; ) {
          checkSignal(signal);
          if (budget?.expired)
            return { outcome: "exhausted", verdict: null, substantiveFrame: false, userResolved };
          const launchElements = await capturePressables(ctx, device).then((pressables) => pressables.length).catch(() => null);
          let substantiveFrame = isSubstantiveFrame(launchElements);
          if (!substantiveFrame) {
            console.log(
              `[app-flow] auth-gate \u2014 app shows ${launchElements ?? "an unreadable frame"} interactive element(s), below the ${PROBE_FRAME_ELEMENT_FLOOR} a settled screen reads; waiting up to ${AUTH_GATE_FRAME_WAIT_MS / 1e3}s before classifying`
            );
            const waitStartedAt2 = Date.now();
            substantiveFrame = await waitForAppReady(ctx, device, signal, AUTH_GATE_FRAME_WAIT_MS, {
              minInteractiveElements: PROBE_FRAME_ELEMENT_FLOOR
            });
            checkSignal(signal);
            console.log(
              `[app-flow] auth-gate \u2014 classifying after ${((Date.now() - waitStartedAt2) / 1e3).toFixed(1)}s${substantiveFrame ? "" : " on a frame that never became readable; this verdict will not be cached for the sweep"}`
            );
          }
          const probe = getScratchPath(projectId, "auth-probe");
          await captureScreenshot(ctx, device, probe);
          let verdict = null;
          let emptyResponses = 0;
          let attempts = 0;
          for (let attempt = 0; attempt < 2 && (!verdict || verdict.verdict === "uncertain"); attempt++) {
            attempts++;
            const response = await runAgent(
              {
                cwd: projectPath,
                systemPrompt: 'Classify the mobile screenshot. Return strict JSON: {"verdict":"auth"|"clear"|"uncertain","reason":"short reason"}. Auth includes login/signup landing screens even with guest access. An incidental sign-in link on a normal content screen is clear. Do not infer credentials or suggest actions.',
                userPrompt: "Is the current app UI an authentication gate?",
                tools: [],
                // The cheapest question the sweep asks: one screenshot, two outcomes, no context to
                // weigh. It was nonetheless spending 472 output tokens per call, 91% of them
                // reasoning, across 14 calls in one run.
                //
                // `off`, not `minimal`. This is the call that asked for `minimal` — a level this
                // backend answers with `400 Unexpected reasoning effort minimal`, which is what
                // produced the empty auth-gate verdicts blamed on the endpoint in `provider.ts`'s
                // old comment. `off` maps to `reasoning_effort: "none"`, measured at 0 reasoning
                // tokens with the JSON verdict still returned.
                thinkingLevel: "off",
                imagePath: probe,
                timeoutMs: Math.max(1e3, Math.min(6e4, budget?.remainingMs ?? 6e4))
              },
              "auth-gate"
            );
            if (!response.text.trim()) emptyResponses++;
            verdict = parseSubAgentJson(response.text);
          }
          const classifierSilent = attempts > 0 && emptyResponses === attempts;
          const stored = getScreenshotPath(projectId, AUTH_CHECKPOINT_SLUG);
          if (!authCheckpointStored || verdict?.verdict !== "clear") {
            await copyFile(probe, stored);
            authCheckpointStored = true;
            authCheckpointVersion += 1;
          }
          await unlink3(probe).catch(() => void 0);
          if (verdict?.verdict === "clear")
            return { outcome: "clear", verdict: "clear", substantiveFrame, userResolved };
          if (classifierSilent) {
            consecutiveSilentAuthChecks++;
            console.log(
              `[app-flow] auth-gate \u2014 classifier returned an empty response ${emptyResponses}/${attempts} times (round ${consecutiveSilentAuthChecks}); this is a model or endpoint failure, not the app's launch screen`
            );
            if (consecutiveSilentAuthChecks >= 2) {
              throw new Error(
                "The screen classifier returned no response. App Flow cannot tell whether the app is showing a login screen, so the build has stopped. This is a model or endpoint problem rather than something to fix in the app."
              );
            }
          } else {
            consecutiveSilentAuthChecks = 0;
          }
          if (!options.requestUserAction)
            return {
              outcome: "stop",
              verdict: verdict?.verdict ?? null,
              substantiveFrame,
              userResolved
            };
          manifest.sweepStatus = "awaiting-user";
          await writeManifest(projectId, manifest);
          const prompt = {
            id: randomUUID3(),
            kind: verdict?.verdict === "auth" ? "auth" : "review",
            detail: verdict?.verdict === "auth" ? "Complete auth in the simulator. Once logged in, click Continue." : `Could not confidently classify this launch screen${verdict?.reason ? `: ${verdict.reason}` : "."}`,
            screenshot: screenshotUrl(
              projectId,
              `screens/${AUTH_CHECKPOINT_SLUG}.png?v=${authCheckpointVersion}`
            ),
            remaining
          };
          emit(projectId, onEvent, {
            type: "prompt",
            phase: "capture",
            message: verdict?.verdict === "auth" ? "Authentication required." : "Launch screen needs review.",
            prompt
          });
          const waitStartedAt = Date.now();
          const resolution = await options.requestUserAction(prompt);
          budget?.exclude(Date.now() - waitStartedAt);
          if (resolution === "stop")
            return {
              outcome: "stop",
              verdict: verdict?.verdict ?? null,
              substantiveFrame,
              userResolved
            };
          userResolved = true;
          manifest.sweepStatus = "running";
          await writeManifest(projectId, manifest);
          if (resolution === "override" && verdict?.verdict !== "auth")
            return {
              outcome: "clear",
              verdict: verdict?.verdict ?? null,
              substantiveFrame,
              userResolved
            };
        }
      };
      const checkAuthGate = async (remaining, budget) => {
        if (isDeterministicMode(options.explorationMode)) return "clear";
        if (authSettledBy) return "clear";
        const resolution = await runAuthGate(remaining, budget);
        authSettledBy = settlesAuthGateForRun(resolution);
        if (authSettledBy) {
          console.log(
            `[app-flow] auth-gate \u2014 cleared by the ${authSettledBy}; settled for this sweep, later launches will not re-check`
          );
        } else if (resolution.outcome === "clear" && !resolution.substantiveFrame) {
          console.log(
            "[app-flow] auth-gate \u2014 cleared, but the classified frame never became readable; not cached, the next launch will ask again"
          );
        }
        return resolution.outcome;
      };
      const deepLinkArrivalJudge = options.deepLinkJudgeMode === "never" ? "never" : (options.deepLinkJudgeMode ?? "on") === "on";
      console.log(
        `[app-flow] deep-link arrival judge: ${deepLinkArrivalJudge === "never" ? "off for every route (not-found detected from the screen)" : deepLinkArrivalJudge ? "on" : "off for routes with no params (not-found detected from the screen); routes with params keep the judge"}`
      );
      const reachMetrics = {
        navigate(outcome) {
          recordRuntimeCount("app_flow.runtime.navigate", { outcome });
        },
        settle(durationMs, stop) {
          recordRuntimeTiming("app_flow.runtime.settle", durationMs, { stop });
        },
        verify(durationMs, path, verdict) {
          recordRuntimeTiming("app_flow.runtime.verify", durationMs, { path, verdict });
        }
      };
      fastRuntime = createAppRuntimeTransport({
        metroPort: device.metroPort,
        deviceId: device.deviceId,
        deviceName: device.deviceName,
        appName: parsed.appName,
        sessionId: `fast-${projectId}`,
        signal,
        // Set from the transport rather than inline so one failed handshake is not retried for
        // every later node — the sweep's `navState === 'unknown'` fallback reads this.
        onAvailability: (availability) => {
          paramStore.navState = availability;
        }
      });
      const renderTransport = fastRuntime.transport;
      const sweepLog = isDeterministicMode(options.explorationMode) ? await createSweepLog({
        projectId,
        // The sweep has no run id of its own (the run store's lives in the server layer), so
        // this names the file after a fresh one; the timestamp is what actually identifies
        // the run, and the suffix only keeps two sweeps started in the same second apart.
        runId: randomUUID3(),
        startedAt
      }).catch(() => null) : null;
      sweepLogOnExit = sweepLog;
      if (sweepLog) console.log(`[app-flow] run log \u2014 ${sweepLog.path}`);
      const ports = createReachPorts({
        ctx,
        device,
        projectId,
        projectPath,
        runAgent,
        checkAuthGate,
        signal,
        renderTransport,
        sweepLog,
        metrics: reachMetrics,
        expoRouter: parsed.mode === "expo-router",
        // Fast fails the settle poll over at 3s unless the screen is visibly still loading, in
        // which case it may run to 8s. Every other mode keeps the single 8s bound it has always
        // had, so the poll's behaviour outside Fast is unchanged.
        settleDeadlinesMs: isDeterministicMode(options.explorationMode) ? [3e3, 8e3] : [8e3]
      });
      const uiStateCapturer = options.captureUiStates ? createSweepUiStateCapturer({
        signal,
        note: (message) => emit(projectId, onEvent, {
          type: "step",
          phase: "capture",
          message,
          completed: sweepQueue.completed,
          total: sweepQueue.total,
          captured: explorationControl.screensExplored,
          captureLimit: options.screenLimit
        }),
        report: (error) => captureServerError(error, "app_flow.capture_ui_states"),
        // Counts and categories into this node's run-log record (closed by `nodeLog.finish`).
        onScreen: (screenNode, log3) => sweepLog?.node(screenNode.id).uiStates(log3),
        open: async () => {
          const ready = await renderTransport.ready();
          const runtime = fastRuntime?.connection;
          if (!ready.ok || !runtime) {
            throw new ExpectedOperationError(
              "device_unavailable",
              `the app\u2019s runtime could not be reached (${ready.ok ? "not connected" : ready.reason})`
            );
          }
          return openSweepUiStateSession({
            projectPath,
            projectId,
            ctx,
            device,
            runtime,
            signal,
            // Per-state `phase`/`step` messages from the pass are not forwarded: see above.
            emit: () => void 0
          });
        }
      }) : null;
      if (!options.decisionProvider) {
        ports.judge = {
          verifyArrival: async () => ({
            verdict: "uncertain",
            status: null,
            reason: "No decision provider, so arrival could not be judged from the screenshot."
          })
        };
      }
      if (isDeterministicMode(options.explorationMode)) {
        emit(projectId, onEvent, {
          type: "phase",
          phase: "boot",
          message: "The deterministic pass skips the sign-in check \u2014 make sure the app is launched and signed in before the sweep."
        });
      }
      if (await checkAuthGate(nodesWithSlug.length) === "stop") {
        const paused = options.pauseRequested?.() ?? false;
        manifest.sweepStatus = paused ? "paused" : "stopped";
        await finishManifest(manifest);
        await writeAppFlow(projectId, { ...partialResult, manifest });
        emit(projectId, onEvent, {
          type: "complete",
          phase: "render",
          message: paused ? "Screen sweep paused." : "Screen sweep stopped."
        });
        return { ok: true, projectId, result: partialResult };
      }
      checkSignal(signal);
      emit(projectId, onEvent, {
        type: "phase",
        phase: "capture",
        message: "Capturing screenshots..."
      });
      const resumed = await readSweepProgress(projectId);
      const explorationMode = options.explorationMode ?? "adaptive";
      const reconciled = reconcileSweepProgress(resumed, {
        structureKey,
        explorationMode,
        sourceHash: fastSourceHash,
        fastFingerprint
      });
      const { resuming, checkpoint } = reconciled;
      if (resumed?.structureKey === structureKey && !resuming) {
        console.log(
          `[app-flow] checkpoint pipeline changed \u2014 kept ${reconciled.retained} successful capture(s), re-queued unfinished screens`
        );
      }
      if (resuming) {
        carriedDurationMs = carriedSweepDurationMs(previousManifest, true);
      }
      const captureMap = { ...checkpoint.captures };
      if (explorationMode === "ai") {
        let reusedPriorCapture = false;
        for (const [id2, prior] of previousById) {
          const capture = prior.capture;
          if (!capture) continue;
          const settledWithoutAI = isNonActionableAiCapture(capture);
          if (capture.screenshot || settledWithoutAI) {
            captureMap[id2] ??= { ...capture, stale: false };
            reusedPriorCapture = true;
          }
        }
        if (reusedPriorCapture) {
          carriedDurationMs = carriedSweepDurationMs(previousManifest, true);
        }
      }
      const openedByNode = { ...checkpoint.opened };
      const inferredScreens = {
        ...checkpoint.inferred
      };
      const runtimeNodes = [...checkpoint.runtimeNodes ?? []];
      const runtimeEdgesList = [...checkpoint.runtimeEdges ?? []];
      const chromeInventory = [...checkpoint.chrome ?? []];
      let walkCursor = null;
      const noteArrival = (nodeId) => {
        if (!walkCursor) return;
        const edge = noteWalkArrival(walkCursor, nodeId, {
          structureRevision,
          observedAt: (/* @__PURE__ */ new Date()).toISOString()
        });
        if (!edge) return;
        mergeWalkEdge(runtimeEdgesList, edge);
        console.log(`[app-flow] walked edge \u2014 ${edge.from} -> ${edge.to} (${edge.raw})`);
      };
      const deepLinkRejections = {};
      for (const node of nodesWithSlug) {
        if (node.deepLinkRejection) deepLinkRejections[node.id] = node.deepLinkRejection;
      }
      const entryNodeIds = parsed.entryScreenIds;
      const appEntryBrief = parsed.rootNavigator ? `App entry: a ${parsed.rootNavigator} navigator. Its entries are ${parsed.entryLayouts.join(", ")}. Every journey starts there, so when you have no better lead, go back to that chrome and open the entry the target belongs to.` : "App entry: unknown; treat the launch screen as the start of every journey.";
      const orphans = nodesWithSlug.filter(
        (candidate) => !findNavigationPath(parsed.edges, candidate.id, entryNodeIds)
      ).length;
      const hasUrlPath = (node) => Boolean(node.urlPath) && node.urlPath !== "/";
      const deepLinkable = nodesWithSlug.filter(
        (node) => hasUrlPath(node) && node.params.length === 0
      ).length;
      const paramBlocked = nodesWithSlug.filter(
        (node) => hasUrlPath(node) && node.params.length > 0
      ).length;
      const noUrl = nodesWithSlug.length - deepLinkable - paramBlocked;
      console.log(
        `[app-flow] entry \u2014 root=${parsed.rootNavigator ?? "unknown"} layouts=[${parsed.entryLayouts.join(", ")}] entryScreens=${entryNodeIds.length} \u2014 ${deepLinkable}/${nodesWithSlug.length} reachable by deep link, ${paramBlocked} param-blocked until a value is observed, ${noUrl} with no URL; ${orphans} have no static path from an entry in the parsed edge graph`
      );
      const requestedIds = new Set(options.screenIds ?? []);
      const selectedNodes = nodesWithSlug.filter((node) => requestedIds.has(node.id));
      if (requestedIds.size > 0 && selectedNodes.length === 0) {
        console.warn(
          "[app-flow] screenIds matched no parsed screen \u2014 sweeping every screen instead"
        );
      }
      const sweepScope = selectedNodes.length ? new Set(selectedNodes.map((node) => node.id)) : null;
      if (sweepScope) {
        console.log(
          `[app-flow] sweep scoped to ${sweepScope.size} of ${nodesWithSlug.length} screens by screenIds`
        );
      }
      const scopedNodes = sweepScope ? selectedNodes : nodesWithSlug;
      const total = scopedNodes.length;
      const alreadyCaptured = scopedNodes.filter((node) => captureMap[node.id]).length;
      if (alreadyCaptured > 0) {
        console.log(
          `[app-flow] resuming sweep \u2014 ${alreadyCaptured}/${total} screens already checkpointed`
        );
        emit(projectId, onEvent, {
          type: "phase",
          phase: "capture",
          message: `Resuming: ${alreadyCaptured} of ${total} screens already captured.`
        });
      }
      const navStateDeps = {
        run: (command, timeoutMs) => runShellCommand(command, projectPath, timeoutMs, signal),
        cdpCommand: (args) => agentDeviceCdp(ctx.sessionName, args),
        quote: shellQuote,
        log: (message) => console.log(`[app-flow] nav-state \u2014 ${message}`)
      };
      let speculativeNavReads = 0;
      const harvestNavState = async (from) => {
        if (paramStore.navState === "unavailable") return;
        try {
          const blocked = nodesWithSlug.filter(
            (other) => other.id !== from.id && !captureMap[other.id] && other.params.length > 0 && other.urlPath && resolveNodeParams(other, parsed.edges, paramStore).unresolved.length > 0
          );
          const { waiting, speculative } = selectNavStateWaiters(
            from,
            blocked,
            nodesWithSlug,
            NAV_STATE_SPECULATIVE_READS - speculativeNavReads
          );
          if (!waiting.length) return;
          if (speculative) speculativeNavReads += 1;
          const live = fastRuntime?.state === "ready";
          if (!live && paramStore.navState === "unknown") {
            const ready = await selectNavStateTarget(
              device.metroPort,
              parsed.appName,
              navStateDeps,
              (output, preferred) => pickMetroCdpTarget(parseCdpTargetList(output), preferred)?.id ?? null
            );
            paramStore.navState = ready ? "ready" : "unavailable";
            if (!ready) return;
          }
          const routes = live ? await renderTransport.navState() : await readNavState(navStateDeps);
          if (!routes) {
            paramStore.navState = "unavailable";
            return;
          }
          let usable = 0;
          for (const route of routes) {
            if (route.path && paramStore.ingestUrl(route.path, from.id, nodesWithSlug)) usable += 1;
            if (!route.params) continue;
            const target2 = resolveNavRouteTarget(nodesWithSlug, route.name);
            if (!target2) continue;
            if (paramStore.ingestNavRoute(target2, route.params, from.id)) usable += 1;
          }
          if (usable) {
            console.log(
              `[app-flow] nav-state \u2014 ${routes.length} route(s) read on ${from.urlPath ?? from.id}, ${usable} usable`
            );
          } else {
            const seen = routes.slice(0, 12).map(
              (route) => `${route.name}${route.path ? " +path" : ""}${route.params ? " +params" : ""}`
            ).join(", ");
            console.log(
              `[app-flow] nav-state \u2014 ${routes.length} route(s) read on ${from.urlPath ?? from.id}, none usable, ${waiting.length} node(s) still blocked \u2014 saw: ${seen}${routes.length > 12 ? ", \u2026" : ""}`
            );
          }
        } catch (error) {
          paramStore.navState = "unavailable";
          console.log(
            `[app-flow] nav-state \u2014 read failed, not retrying \u2014 ${error instanceof Error ? error.message : String(error)}`
          );
        }
      };
      let linksUnavailable = false;
      const harvestLinks = async (from) => {
        if (linksUnavailable || fastRuntime?.state !== "ready") return;
        const blocked = nodesWithSlug.some(
          (other) => !captureMap[other.id] && other.params.length > 0 && resolveNodeParams(other, parsed.edges, paramStore).unresolved.length > 0
        );
        if (!blocked) return;
        try {
          const reply = await fastRuntime.invoke(
            { type: "links", max: LINK_CANDIDATE_CAP },
            5e3
          );
          const links = reply?.links ?? [];
          if (!links.length) {
            recordRuntimeCount("app_flow.runtime.links", { outcome: "empty" });
            return;
          }
          const { usable, unmatched } = ingestLinkCandidates(
            links,
            from.id,
            nodesWithSlug,
            paramStore
          );
          recordRuntimeCount("app_flow.runtime.links", {
            outcome: usable ? "usable" : "unmatched"
          });
          console.log(
            `[app-flow] links \u2014 ${links.length} destination(s) on ${from.urlPath ?? from.id}, ${usable} usable, ${unmatched} unmatched${reply.capped ? ", capped" : ""}`
          );
        } catch (error) {
          linksUnavailable = true;
          recordRuntimeCount("app_flow.runtime.links", { outcome: "failed" });
          console.log(
            `[app-flow] links \u2014 read failed, not retrying \u2014 ${error instanceof Error ? error.message : String(error)}`
          );
        }
      };
      const CHECKPOINT_COALESCE_MS = 1500;
      const checkpointWriter = createCoalescedWriter({
        write: () => writeSweepProgressNow(),
        windowMs: CHECKPOINT_COALESCE_MS,
        now: activeNow,
        onError: (error) => console.warn(
          `[app-flow] checkpoint write failed \u2014 ${error instanceof Error ? error.message : String(error)}`
        )
      });
      const persistCheckpoint = async (options2) => {
        await checkpointWriter.mark();
        if (options2?.force) await checkpointWriter.flush();
      };
      flushCheckpointOnExit = () => checkpointWriter.flush();
      const writeSweepProgressNow = async () => {
        await writeSweepProgress(projectId, {
          structureKey,
          explorationMode,
          sourceHash: fastSourceHash,
          fastFingerprint,
          updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
          captures: captureMap,
          opened: openedByNode,
          inferred: inferredScreens,
          runtimeNodes,
          runtimeEdges: runtimeEdgesList,
          chrome: chromeInventory
        });
      };
      const currentAgentDeviceScreens = () => buildAgentDeviceScreens(
        [...nodesWithSlug, ...runtimeNodes],
        parsed.edges,
        runtimeEdgesList,
        chromeInventory,
        ctx,
        device,
        openedByNode,
        inferredScreens,
        captureMap
      );
      const currentFlowDocument = (screens) => {
        manifest.durationMs = timing.wallMs;
        manifest.cumulativeDurationMs = carriedDurationMs + timing.wallMs;
        const screenNodes = withReplayableCaptures(
          [
            ...nodesWithSlug.map((node) => ({
              ...node,
              capture: captureMap[node.id] ?? node.capture,
              deepLinkRejection: deepLinkRejections[node.id] ?? null
            })),
            ...runtimeNodes
          ],
          screens
        );
        const navigators = navigatorChrome(chromeInventory, screenNodes);
        const nodes = [...screenNodes, ...chromeVirtualNodes(navigators)];
        return {
          manifest,
          nodes,
          edges: parsed.edges,
          runtimeEdges: rebuildChromeEdges(runtimeEdgesList, navigators, nodes),
          chrome: chromeInventory,
          navigation
        };
      };
      const LIVE_PUBLISH_INTERVAL_MS = 4e3;
      let lastLivePublishAt = 0;
      let livePublishInFlight = Promise.resolve();
      const publishLiveDocument = () => {
        const now = activeNow();
        if (now - lastLivePublishAt < LIVE_PUBLISH_INTERVAL_MS) return livePublishInFlight;
        lastLivePublishAt = now;
        const began = now;
        livePublishInFlight = (async () => {
          try {
            await writeAppFlow(projectId, currentFlowDocument(currentAgentDeviceScreens()));
            console.log(`[app-flow] live graph published in ${activeNow() - began}ms`);
          } catch (error) {
            console.warn(
              `[app-flow] live graph publish failed \u2014 ${error instanceof Error ? error.message : String(error)}`
            );
          }
        })();
        return livePublishInFlight;
      };
      const persistCaptureUpdate = async () => {
        await persistCheckpoint();
        await publishLiveDocument();
      };
      let nodeStartedAt = 0;
      const recordUnreached = async (node, status, note) => {
        console.log(`[app-flow] ${node.id} recorded ${status} \u2014 ${note ?? "no reason given"}`);
        sweepLog?.node(node.id).finish({ status, totalMs: nodeStartedAt ? Date.now() - nodeStartedAt : 0 });
        captureMap[node.id] = {
          status,
          // `unavailable` is a settled answer about this build, not a screen still to be reached,
          // so it must not come back as outstanding navigation work on the next run.
          needsNavigation: status !== "unavailable",
          note,
          screenshot: null,
          pressables: [],
          captureMethod: "unreached",
          replayScript: null,
          replayVerified: false
        };
        await persistCaptureUpdate();
      };
      const chromeCandidates = () => [
        ...nodesWithSlug.map((candidate) => ({
          label: candidate.id,
          toNodeId: candidate.id,
          tokens: expectedNodeTokens(candidate)
        })),
        ...runtimeNodes.map((candidate) => ({
          label: candidate.id,
          toNodeId: candidate.id,
          tokens: new Set(candidate.runtimeSignature ?? [])
        })),
        ...parsed.entryLayouts.map((name3) => ({
          label: `layout:${name3}`,
          toNodeId: null,
          tokens: new Set(tokenize(name3.replace(/([a-z0-9])([A-Z])/g, "$1 $2")))
        }))
      ];
      const applyDiscoveredFact = async (fact) => {
        switch (fact.kind) {
          case "opportunistic-capture": {
            const match = nodesWithSlug.find((candidate) => candidate.id === fact.nodeId);
            if (!match) return;
            await copyFile(fact.screenshotPath, getScreenshotPath(projectId, match.slug));
            captureMap[match.id] = {
              status: fact.arrival.status ?? "ok",
              // There is no saved journey here, only an accidental sighting — a resumed sweep
              // still needs to actually navigate to this screen to redo anything with it.
              needsNavigation: true,
              note: fact.arrival.reason,
              screenshot: `screens/${match.slug}.png`,
              pressables: [...fact.pressables],
              captureMethod: "opportunistic",
              replayScript: null,
              replayVerified: false,
              structureRevision,
              stale: false
            };
            inferredScreens[match.id] = { key: fact.arrival.key, info: fact.arrival.info };
            noteArrival(match.id);
            await persistCaptureUpdate();
            console.log(
              `[app-flow] opportunistic capture \u2014 reached ${match.id} while exploring toward another screen`
            );
            emit(projectId, onEvent, {
              type: "step",
              phase: "capture",
              message: `Captured ${match.urlPath ?? match.title} opportunistically`,
              completed: nodesWithSlug.filter((candidate) => captureMap[candidate.id]).length,
              total
            });
            return;
          }
          case "chrome-observed": {
            const kind = inferChromeKind(fact.reveal);
            const detected = {
              id: `chrome:${kind}:${fact.entryNodeId}`,
              kind,
              entryNodeId: fact.entryNodeId,
              reveal: fact.reveal,
              items: fact.items,
              observedAt: (/* @__PURE__ */ new Date()).toISOString(),
              structureRevision
            };
            const canonical = findMatchingChrome(chromeInventory, detected) ?? detected;
            const merged = mergeChromeInventory(chromeInventory, detected);
            chromeInventory.splice(0, chromeInventory.length, ...merged);
            for (const edge of chromeEdges({
              ...detected,
              id: canonical.id,
              entryNodeId: canonical.entryNodeId
            })) {
              const at = runtimeEdgesList.findIndex(
                (existing) => existing.from === edge.from && existing.to === edge.to
              );
              if (at === -1) runtimeEdgesList.push(edge);
              else runtimeEdgesList[at] = edge;
            }
            await persistCaptureUpdate();
            console.log(
              `[app-flow] chrome inventory recorded from ${fact.entryNodeId} \u2014 ${fact.items.length} items (${kind})`
            );
            return;
          }
          case "runtime-screen-sighted": {
            if (fact.match) {
              const at = runtimeNodes.findIndex((candidate) => candidate.id === fact.match.id);
              if (at !== -1) {
                runtimeNodes[at] = recordRuntimeSighting(
                  runtimeNodes[at],
                  new Set(fact.observedTokens)
                );
                noteArrival(runtimeNodes[at].id);
                await persistCaptureUpdate();
                console.log(`[app-flow] runtime screen re-sighted \u2014 ${fact.match.id}`);
              }
              return;
            }
            if (runtimeNodes.length >= RUNTIME_NODE_SWEEP_CAP) {
              console.log(
                `[app-flow] runtime screen discovery capped at ${RUNTIME_NODE_SWEEP_CAP} for this sweep \u2014 not minting "${fact.key}"`
              );
              return;
            }
            const minted = mintRuntimeNode({
              key: fact.key,
              title: fact.info || fact.key,
              observedTokens: new Set(fact.observedTokens),
              existingIds: /* @__PURE__ */ new Set([
                ...nodesWithSlug.map((candidate) => candidate.id),
                ...runtimeNodes.map((candidate) => candidate.id)
              ]),
              usedSlugs
            });
            await copyFile(fact.screenshotPath, getScreenshotPath(projectId, minted.slug));
            runtimeNodes.push({
              ...minted,
              capture: {
                status: "ok",
                needsNavigation: true,
                note: fact.info,
                screenshot: `screens/${minted.slug}.png`,
                pressables: [...fact.pressables],
                captureMethod: "opportunistic",
                replayScript: null,
                replayVerified: false,
                structureRevision,
                stale: false
              }
            });
            noteArrival(minted.id);
            await persistCaptureUpdate();
            console.log(`[app-flow] runtime screen discovered \u2014 ${minted.id} ("${fact.key}")`);
            return;
          }
        }
      };
      let failedReference = null;
      let blockedRun = 0;
      let sweepStopped = false;
      const promptToUnblock = async (detail, remaining) => {
        const stop = () => "stop";
        if (!options.requestUserAction) return stop();
        const shot = getScreenshotPath(projectId, BLOCKED_SLUG);
        await captureScreenshot(ctx, device, shot).catch(() => void 0);
        const prompt = {
          id: randomUUID3(),
          kind: "blocked",
          detail,
          screenshot: screenshotUrl(projectId, `screens/${BLOCKED_SLUG}.png`),
          remaining
        };
        manifest.sweepStatus = "awaiting-user";
        await writeManifest(projectId, manifest);
        emit(projectId, onEvent, {
          type: "prompt",
          phase: "capture",
          message: "Waiting for you to get the app past this screen...",
          prompt
        });
        console.log(`[app-flow] blocked \u2014 waiting for the user (${remaining} screens left)`);
        const resolution = await options.requestUserAction(prompt);
        console.log(`[app-flow] blocked \u2014 user chose "${resolution}"`);
        if (resolution === "stop") return stop();
        manifest.sweepStatus = "running";
        await writeManifest(projectId, manifest);
        emit(projectId, onEvent, {
          type: "phase",
          phase: "capture",
          message: "Checking the app again..."
        });
        await waitForAppReady(ctx, device, signal);
        return "continue";
      };
      const resolveBlocked = async (remaining) => {
        console.log(
          `[app-flow] blocked \u2014 relaunching the app before asking the user (${remaining} screens left)`
        );
        try {
          await reopenBoundApp(ctx, device);
          const recovered = fingerprint(await capturePressables(ctx, device).catch(() => []));
          const stillBlocked = failedReference !== null && similarity(recovered, failedReference) >= ARRIVAL_SIMILARITY;
          if (!stillBlocked) {
            console.log(
              "[app-flow] blocked \u2014 relaunch cleared it, resuming without asking the user"
            );
            failedReference = null;
            blockedRun = 0;
            return "continue";
          }
          console.log("[app-flow] blocked \u2014 relaunch did not clear it, escalating to the user");
        } catch (error) {
          console.log(
            `[app-flow] blocked \u2014 relaunch attempt failed, escalating to the user \u2014 ${error instanceof Error ? error.message : String(error)}`
          );
        }
        const resolution = await promptToUnblock(
          "The app keeps rendering this one screen whatever route is opened, so nothing behind it can be captured. Resolve the visible blocker in the simulator; it stays running, then continue.",
          remaining
        );
        if (resolution === "continue") {
          failedReference = null;
          blockedRun = 0;
        }
        return resolution;
      };
      const verifyCurrentTarget = (node, screenshotPath, budget) => ports.judge.verifyArrival(node, screenshotPath, budget);
      if (options.explorationMode !== "fast") {
        try {
          const launchEntryNodeId = entryNodeIds[0] ?? "app-launch";
          const tabBarPressables = await ports.device.capturePressables(15e3);
          const tabBarChrome = detectChromeInventory(tabBarPressables, chromeCandidates());
          if (tabBarChrome) {
            await applyDiscoveredFact({
              kind: "chrome-observed",
              entryNodeId: launchEntryNodeId,
              reveal: [],
              items: tabBarChrome.items
            });
          }
          const drawerOpener = findDrawerOpener(tabBarPressables);
          if (drawerOpener) {
            const revealStep = { type: "tap", locator: drawerOpener };
            let drawerChrome = null;
            try {
              await ports.device.executeNavigationActions([revealStep], 15e3);
              const drawerPressables = await ports.device.capturePressables(15e3);
              drawerChrome = detectChromeInventory(drawerPressables, chromeCandidates());
              if (drawerChrome) {
                await applyDiscoveredFact({
                  kind: "chrome-observed",
                  entryNodeId: launchEntryNodeId,
                  reveal: [revealStep],
                  items: drawerChrome.items
                });
              }
              console.log(
                `[app-flow] entry-chrome pass \u2014 drawer opened via ${drawerOpener.by}="${drawerOpener.value}", ${drawerChrome?.items.length ?? 0} items recorded from ${drawerPressables.length} controls`
              );
            } catch (error) {
              console.log(
                `[app-flow] entry-chrome pass \u2014 drawer opener ${drawerOpener.by}="${drawerOpener.value}" could not be used, keeping the tab inventory \u2014 ${error instanceof Error ? error.message : String(error)}`
              );
            }
            let closed = false;
            try {
              await ports.device.executeNavigationActions([revealStep], 15e3);
              closed = Boolean(findDrawerOpener(await ports.device.capturePressables(15e3)));
            } catch (error) {
              console.log(
                `[app-flow] entry-chrome pass \u2014 close tap on ${drawerOpener.by}="${drawerOpener.value}" failed: ${error instanceof Error ? error.message : String(error)}`
              );
            }
            if (!closed) {
              const drawerItems = (drawerChrome?.items ?? []).filter(
                (item) => item.trigger.value !== drawerOpener.value
              );
              const exitTarget = (drawerItems.find((item) => item.toNodeId === launchEntryNodeId) ?? drawerItems.find((item) => item.toNodeId !== null) ?? drawerItems[0])?.trigger;
              if (exitTarget) {
                try {
                  await ports.device.executeNavigationActions(
                    [{ type: "tap", locator: exitTarget }],
                    15e3
                  );
                  closed = Boolean(findDrawerOpener(await ports.device.capturePressables(15e3)));
                } catch (error) {
                  console.log(
                    `[app-flow] entry-chrome pass \u2014 exit tap on ${exitTarget.by}="${exitTarget.value}" failed: ${error instanceof Error ? error.message : String(error)}`
                  );
                }
              }
              console.log(
                closed ? `[app-flow] entry-chrome pass \u2014 drawer would not toggle shut; left it via ${exitTarget?.by}="${exitTarget?.value}"` : (
                  // Loud on purpose. Everything downstream now starts from a screen the sweep did
                  // not intend, and the probe's `frameChangedAfterOpen` guard is the only thing
                  // standing between that and the transport being switched off for every route.
                  `[app-flow] entry-chrome pass \u2014 WARNING: the drawer is still open and could not be dismissed; the next screens are being read through it`
                )
              );
            }
          } else {
            console.log(
              `[app-flow] entry-chrome pass \u2014 no drawer opener among ${tabBarPressables.length} entry controls`
            );
          }
        } catch (error) {
          console.log(
            `[app-flow] entry-chrome pass failed, continuing without it \u2014 ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }
      let deepLinkBreaker = initialDeepLinkBreakerState();
      const rejectedDeepLinkUrls = new DeepLinkRejectionMemo();
      const closedGuardGates = new GuardGateMemo();
      const probeRoute = options.explorationMode === "fast" || options.explorationMode === "adaptive" || options.explorationMode === "ai" ? null : pickProbeRoute(nodesWithSlug);
      let probeCredit = null;
      const claimProbeCredit = (nodeId) => {
        if (!probeCredit) return null;
        const credit = probeCredit;
        probeCredit = null;
        return credit.nodeId === nodeId ? credit : null;
      };
      const countInteractiveElements = async () => {
        try {
          return (await ports.device.capturePressables()).length;
        } catch {
          return null;
        }
      };
      const probeOpenPass = async (route, pass) => {
        const probeBudget = new ActiveTimeBudget(6e4, activeNow(), activeNow);
        const deviceStartedAt = Date.now();
        let launchElements = await countInteractiveElements();
        if (!isSubstantiveFrame(launchElements)) {
          console.log(
            `[app-flow] deep-link probe \u2014 app shows ${launchElements ?? "an unreadable frame"} interactive element(s), below the ${PROBE_FRAME_ELEMENT_FLOOR} needed to trust a probe verdict; waiting up to ${PROBE_LAUNCH_READY_BUDGET_MS / 1e3}s for it to finish loading before opening the URL`
          );
          const waitStartedAt = Date.now();
          await ports.device.waitForRoute({
            minInteractiveElements: PROBE_FRAME_ELEMENT_FLOOR,
            timeoutMs: PROBE_LAUNCH_READY_BUDGET_MS
          });
          checkSignal(signal);
          launchElements = await countInteractiveElements();
          const waitedSeconds = ((Date.now() - waitStartedAt) / 1e3).toFixed(1);
          console.log(
            isSubstantiveFrame(launchElements) ? `[app-flow] deep-link probe \u2014 app rendered ${launchElements} interactive element(s) after ${waitedSeconds}s, opening the URL now` : `[app-flow] deep-link probe \u2014 app still shows ${launchElements ?? "an unreadable frame"} interactive element(s) after ${waitedSeconds}s; opening the URL anyway, but a mismatch cannot be trusted from here`
          );
        }
        const preOpenSubstantive = isSubstantiveFrame(launchElements);
        const preOpenFrame = await ports.device.capturePressables().then((pressables) => fingerprint(pressables)).catch(() => null);
        const opened = await ports.device.openDeepLink(route, {});
        checkSignal(signal);
        const { settled } = await ports.device.waitForRoute();
        probeBudget.exclude(Date.now() - deviceStartedAt);
        const probeShot = getScratchPath(projectId, "deep-link-probe");
        await ports.device.captureScreenshot(probeShot);
        const [arrival, probePressables] = await Promise.all([
          verifyCurrentTarget(route, probeShot, probeBudget),
          ports.device.capturePressables().catch(() => null)
        ]);
        const frameElements = arrival.verdict === "match" ? launchElements : probePressables?.length ?? await countInteractiveElements();
        const frameChangedAfterOpen = preOpenFrame && probePressables ? similarity(preOpenFrame, fingerprint(probePressables)) < APP_READY_SETTLE_SIMILARITY : null;
        const outcome = judgeProbeFrame({
          verdict: arrival.verdict,
          settled,
          elementCount: frameElements,
          preOpenSubstantive,
          frameChangedAfterOpen
        });
        if (outcome === "match")
          return { outcome, arrival, opened, frame: probeShot, pressables: probePressables };
        if (outcome === "inconclusive" && arrival.verdict === "mismatch") {
          const why = !preOpenSubstantive ? `was opened into an app showing only ${launchElements ?? "an unreadable number of"} interactive element(s), which could not have routed it` : frameChangedAfterOpen === false ? "left the screen exactly as it was, so the URL was swallowed rather than routed \u2014 something already on screen took it" : frameChangedAfterOpen === null ? "could not be checked against the frame before the open, so there is no evidence the URL reached the app" : !settled ? "mismatched on a frame the app never settled on" : `mismatched on a frame carrying only ${frameElements ?? "an unreadable number of"} interactive element(s) \u2014 too thin to be evidence about the scheme`;
          console.log(
            `[app-flow] deep-link probe ${route.id} (pass ${pass}) ${why} \u2014 inconclusive, not evidence about the scheme`
          );
        }
        return { outcome, arrival: null };
      };
      const probeDeepLinkRoute = async (route) => {
        const first = await probeOpenPass(route, 1);
        if (first.outcome !== "mismatch") return first;
        console.log(
          `[app-flow] deep-link probe ${route.id} looks like the wrong screen \u2014 re-opening the URL once against the now-loaded app before disabling deep links for the sweep`
        );
        const second = await probeOpenPass(route, 2);
        if (second.outcome !== "mismatch") {
          console.log(
            `[app-flow] deep-link probe ${route.id} did not reproduce the mismatch on the second open (${second.outcome}) \u2014 the first was the app not being ready, deep links stay enabled`
          );
        }
        return second;
      };
      if (probeRoute?.urlPath) {
        let outcome = "inconclusive";
        let lastError = null;
        for (let attempt = 1; attempt <= 2 && outcome !== "match"; attempt++) {
          try {
            const probed = await probeDeepLinkRoute(probeRoute);
            outcome = probed.outcome;
            if (probed.arrival && probed.frame)
              probeCredit = {
                nodeId: probeRoute.id,
                arrival: probed.arrival,
                frame: probed.frame,
                pressables: probed.pressables,
                opened: probed.opened
              };
            lastError = null;
            if (outcome === "mismatch") break;
          } catch (error) {
            lastError = error;
            outcome = "inconclusive";
            if (attempt === 1) {
              console.log(
                `[app-flow] deep-link probe errored, retrying once \u2014 ${error instanceof Error ? error.message : String(error)}`
              );
            }
          }
        }
        deepLinkBreaker = initialDeepLinkBreakerState(outcome !== "mismatch");
        if (lastError) {
          console.log(
            `[app-flow] deep-link probe errored twice \u2014 inconclusive, leaving deep links enabled for the per-node breaker to judge \u2014 ${lastError instanceof Error ? lastError.message : String(lastError)}`
          );
        } else if (outcome === "match") {
          console.log(
            `[app-flow] deep-link probe ${probeRoute.id} (${probeRoute.urlPath}) matched \u2014 deep links enabled for this sweep`
          );
        } else if (outcome === "mismatch") {
          console.log(
            `[app-flow] deep-link probe ${probeRoute.id} (${probeRoute.urlPath}) settled on the wrong screen \u2014 deep links disabled for this sweep`
          );
        } else {
          console.log(
            `[app-flow] deep-link probe ${probeRoute.id} (${probeRoute.urlPath}) inconclusive \u2014 leaving deep links enabled for the per-node breaker to judge`
          );
        }
      } else {
        console.log(
          "[app-flow] deep-link probe \u2014 no eligible probe route (need a urlPath with no params), leaving deep links enabled"
        );
      }
      const reprobeDeepLinkRoute = probeRoute ? async () => (await probeDeepLinkRoute(probeRoute)).outcome !== "mismatch" : void 0;
      const sweptNodes = orderSweepNodes(
        nodesWithSlug,
        parsed.edges,
        parsed.entryScreenIds,
        parsed.entryLayouts,
        {
          deepLinksEnabled: deepLinkBreaker.enabled,
          // Only when a credit is actually in hand. `probeCredit` is set by a probe the judge
          // accepted and cleared by the first `claimProbeCredit` call, so this is precisely "there
          // is verified work on this node waiting to be claimed" — not merely "a route was probed".
          probeRouteId: probeCredit?.nodeId ?? null
        }
      );
      const sweepQueue = new ReachQueue(
        sweepScope ? sweptNodes.filter((node) => sweepScope.has(node.id)) : sweptNodes
      );
      let sweepPaused = false;
      const requeuedIds = /* @__PURE__ */ new Set();
      const explorationControl = new ExplorationControl(
        options.screenLimit,
        options.pauseRequested,
        {
          attemptLimit: options.attemptLimit,
          sweepDeadlineMs: options.sweepDeadlineMs,
          now: activeNow
        }
      );
      const pauseMessage = (reason) => {
        if (reason === "requested") return "[app-flow] pausing at the latest screen checkpoint";
        if (reason === "limit")
          return `[app-flow] screen limit reached (${options.screenLimit}) \u2014 pausing`;
        if (reason === "attempts")
          return `[app-flow] attempt limit reached (${explorationControl.screensAttempted} attempts for ${explorationControl.screensExplored}/${options.screenLimit} screens) \u2014 pausing; the remaining routes are costing more to reach than they are returning`;
        return `[app-flow] time limit reached (${explorationControl.screensExplored}/${options.screenLimit} screens in ${explorationControl.screensAttempted} attempts) \u2014 pausing`;
      };
      const pauseBeforeNextScreen = () => {
        const reason = explorationControl.beforeNextScreen();
        if (!reason) return false;
        sweepPaused = true;
        sweepStopped = true;
        console.log(pauseMessage(reason));
        return true;
      };
      const finishExploredScreen = (captured) => {
        const reason = explorationControl.screenFinished(captured);
        if (!reason) return false;
        sweepPaused = true;
        sweepStopped = true;
        console.log(pauseMessage(reason));
        return true;
      };
      for (let node = sweepQueue.next(); node !== null; node = sweepQueue.next()) {
        checkSignal(signal);
        if (pauseBeforeNextScreen()) break;
        const settled = checkpoint.captures[node.id] ?? null;
        const opportunistic = captureMap[node.id]?.captureMethod === "opportunistic";
        const aiContinuationSettled = explorationMode === "ai" && Boolean(captureMap[node.id]) && (captureMap[node.id]?.screenshot != null || isNonActionableAiCapture(captureMap[node.id]));
        if (settled || opportunistic || aiContinuationSettled) {
          console.log(
            opportunistic ? `[app-flow] skip ${node.id} \u2014 captured opportunistically while exploring another screen` : `[app-flow] skip ${node.id} \u2014 already settled in a previous run`
          );
          emit(projectId, onEvent, {
            type: "step",
            phase: "capture",
            message: opportunistic ? `Captured ${node.urlPath ?? node.title} opportunistically` : `Already captured ${node.urlPath ?? node.title}`,
            completed: sweepQueue.completed + 1,
            total,
            captured: explorationControl.screensExplored,
            captureLimit: options.screenLimit
          });
          continue;
        }
        nodeStartedAt = Date.now();
        const budget = new ActiveTimeBudget(
          isDeterministicMode(options.explorationMode) ? 45e3 : 5 * 6e4,
          activeNow(),
          activeNow
        );
        const label = node.urlPath ?? node.title;
        emit(projectId, onEvent, {
          type: "step",
          phase: "capture",
          message: `Reaching ${label}`,
          completed: sweepQueue.completed,
          total,
          captured: explorationControl.screensExplored,
          captureLimit: options.screenLimit
        });
        const resolution = resolveNodeParams(node, parsed.edges, paramStore);
        const params = Object.fromEntries(
          node.params.filter((key2) => resolution.values[key2] !== void 0).map((key2) => [key2, resolution.values[key2]])
        );
        const unresolvedParams = resolution.unresolved;
        if (unresolvedParams.length === 0 && resolution.source && resolution.source !== "static") {
          console.log(
            `[app-flow] params \u2014 ${node.urlPath} resolved from ${resolution.source} seen on ${resolution.seenOn}: ${JSON.stringify(resolution.values)}`
          );
        }
        let captureMethod = "unreached";
        let replayScript = null;
        let replayScriptVerified = false;
        let pathCommands = null;
        let reachError = null;
        let acceptedArrival = null;
        let arrivalFrame = null;
        let arrivalPressables = [];
        let verifiedFrame = null;
        let verifiedPressables = null;
        let authStopped = false;
        let unavailableReason = null;
        let deepLinkNotFound = false;
        let seedBaseFailed = false;
        let seededWalkRan = false;
        const savedScript = join11(getFlowsDir(projectId), `${node.slug}.ad`);
        const exploreFrom = async (seed, exploreOptions = {}) => {
          checkSignal(signal);
          seededWalkRan = false;
          if (authStopped || budget.expired || isFallbackRoute(node) || unavailableReason) {
            if (isFallbackRoute(node)) {
              reachError = "Fallback route has no in-app entry point.";
            }
            return false;
          }
          const commandSeed = seed && "commands" in seed ? seed : null;
          const seedUrl = seed && "url" in seed ? seed.url : null;
          const prefix = commandSeed ? [...commandSeed.commands] : baselineLaunchCommands(device, seedUrl);
          let walkLines = [];
          try {
            try {
              if (commandSeed) {
                await ports.device.runPathCommands(commandSeed.commands);
                checkSignal(signal);
              } else {
                await ports.device.resetToLaunch(
                  seedUrl,
                  Math.max(1e3, Math.min(9e4, budget.remainingMs))
                );
                checkSignal(signal);
              }
            } catch (error) {
              if (commandSeed) seedBaseFailed = true;
              reachError = `${commandSeed ? "Seed's stored path" : "Launch"} failed: ${error instanceof Error ? error.message : String(error)}`;
              console.log(`[app-flow] ${node.id} ${reachError}`);
              return false;
            }
            const launchAuth = await ports.auth.checkGate(sweepQueue.remaining, budget);
            if (launchAuth === "stop") {
              authStopped = true;
              return false;
            }
            if (launchAuth === "exhausted") {
              reachError = "Navigation budget exhausted after five minutes.";
              return false;
            }
            const graphPath = findNavigationPath(parsed.edges, node.id, entryNodeIds);
            const incoming = parsed.edges.filter((edge) => edge.to === node.id).map(
              (edge) => edge.trigger ? `from ${edge.from}: tap ${edge.trigger.by}=${JSON.stringify(edge.trigger.value)}` : `from ${edge.from}: control unknown (${edge.raw})`
            );
            const layoutLine = node.groups.length > 1 ? `Target is registered via a shared helper in every one of: ${node.groups.join(", ")} \u2014 it is reachable from any of them, not only the first.` : `Target is registered in layout: ${node.group || "unknown"}`;
            let opportunisticAttempts = 0;
            let lastAction = null;
            const cursor = createWalkCursor(seed?.id ?? null);
            walkCursor = cursor;
            const navigationSession = await runAgentSession({
              cwd: projectPath,
              systemPrompt: NAVIGATION_SYSTEM_PROMPT,
              tools: [],
              // `low`, and deliberately not `off` like the judges. This is the one app-flow role
              // that makes a genuine multi-step decision — where am I, what did my last tap do,
              // which control moves me toward a screen I have not seen yet — so it is the role most
              // likely to pay for zero reasoning in failed walks, and a failed walk costs far more
              // than the reasoning it saved. `low` is still a large cut from what this role was
              // actually getting: nothing was reaching the wire before, so every call ran at the
              // backend's xhigh default (see `pi/provider.ts`). Worth retrying at `off` once a
              // sweep has shown what `low` does to the arrival rate.
              thinkingLevel: "low",
              compactHistory: { keepRecentUserTurns: 2 }
            });
            let stepsSent = 0;
            let exploration;
            try {
              exploration = await runInteractiveExploration({
                budget,
                // The five-minute budget alone is not a bound on how much a hopeless target costs:
                // it bounds wall clock, not model calls, and a fast app burns decisions far quicker
                // than it burns minutes. This is the bound on calls — see the constant's comment for
                // why seven, and why an unreachable screen is exactly the case that used to run long.
                // A bounded attempt gets a much tighter version of the same reasoning: the seed
                // already proved everything up to one tap away, so three unproductive decisions (or
                // even one that makes no visible difference, or one failed planner call) says the
                // target is not one more tap from here after all.
                maxDecisions: exploreOptions.bounded ? 3 : EXPLORATION_MAX_DECISIONS,
                maxNoProgress: exploreOptions.bounded ? 1 : void 0,
                maxPlannerFailures: exploreOptions.bounded ? 1 : void 0,
                observe: async () => {
                  const screenshotPath2 = getScratchPath(projectId, "explore");
                  await ports.device.captureScreenshot(screenshotPath2);
                  return {
                    screenshotPath: screenshotPath2,
                    pressables: await ports.device.capturePressables(Math.max(1e3, Math.min(3e4, budget.remainingMs))).catch(() => [])
                  };
                },
                check: () => checkSignal(signal),
                decide: async (observation, history) => {
                  const visible = summarizePressables(observation.pressables);
                  const recentFailures = history.length ? `
Since the last step: ${JSON.stringify(history)}` : "";
                  const controlsLine = `Visible controls now: ${JSON.stringify(visible.shown)}${visible.omitted ? ` (+${visible.omitted} more controls on this screen, not listed)` : ""}${recentFailures}
Choose one next decision from this fresh observation.`;
                  const seedLine = commandSeed ? `
You replayed a proven journey to ${commandSeed.id} and are one tap away from the target.${commandSeed.trigger ? ` The last known control for this hop: tap ${commandSeed.trigger.by}=${JSON.stringify(commandSeed.trigger.value)} \u2014 use it if it is still on screen, otherwise find the equivalent control.` : ""}` : seed && "url" in seed ? `
The app was opened directly at ${seed.urlPath} (${seed.id}), so you start there rather than at the entry screen.` : "";
                  const boundedLine = exploreOptions.bounded ? "\nYou have very few actions left to find this screen from here \u2014 act only on a control you are confident leads to the target, and return blocked as soon as none does." : "";
                  const userPrompt = stepsSent === 0 ? `${appEntryBrief}${seedLine}${boundedLine}
Target screen: ${node.id} (${node.title})${deepLinkNotFound ? "\nOpening this route by URL landed on the app's not-found screen, so this build may not offer it at all. Confirm quickly via the named entry control and return blocked if it is absent." : ""}${unresolvedParams.length ? `
This route needs ${unresolvedParams.map((key2) => `:${key2}`).join(", ")}, so it shows one concrete item. If the entry chrome has a tab or menu item named after this screen, tap that first; it goes straight there. Only when no such entry exists, open any one item from a list that already leads here \u2014 which one does not matter.` : ""}
${layoutLine}
Source: ${node.file ?? "unknown"}
Journey from an entry screen: ${graphPath ? describeJourney(parsed.edges, graphPath) : "none in the route graph \u2014 find it by exploring from the entry chrome"}
Ways into this screen: ${incoming.length ? incoming.join(" | ") : "none found statically"}
${controlsLine}` : controlsLine;
                  stepsSent += 1;
                  const response = await navigationSession.prompt(
                    {
                      userPrompt,
                      imagePath: observation.screenshotPath,
                      // One planning step is a look at a screenshot and a control list, so a call
                      // still running after a minute is stuck. Capping it here leaves the
                      // five-minute budget for the steps that follow instead of spending it all
                      // on one of them.
                      timeoutMs: Math.max(1e3, Math.min(6e4, budget.remainingMs))
                    },
                    `navigate ${node.id} step ${stepsSent}`
                  );
                  return parseNavigationDecision(parseSubAgentJson(response.text));
                },
                act: async (action) => {
                  console.log(`[app-flow] explore ${node.id} action ${JSON.stringify(action)}`);
                  try {
                    await ports.device.executeNavigationActions(
                      [action],
                      Math.max(1e3, budget.remainingMs)
                    );
                    lastAction = action;
                    noteWalkAction(cursor, action);
                    if (walkLines) {
                      const line = walkStepCommand(action);
                      if (line) walkLines.push(line);
                      else if (action.type !== "wait") walkLines = null;
                    }
                  } catch (error) {
                    console.log(
                      `[app-flow] explore ${node.id} action failed \u2014 ${error instanceof Error ? error.message : String(error)}`
                    );
                    throw error;
                  }
                },
                verifyArrival: async (observation) => {
                  const arrival = await verifyCurrentTarget(
                    node,
                    observation.screenshotPath,
                    budget
                  );
                  if (arrival.verdict !== "match") return false;
                  acceptedArrival = arrival;
                  if (cursor.actionsSinceConfirmation.length <= 1 && lastAction?.locator?.by === "id") {
                    paramStore.learnFromArrival(lastAction.locator.value, node, node.id);
                  }
                  noteArrival(node.id);
                  arrivalPressables = observation.pressables;
                  try {
                    const frame = getScratchPath(projectId, "arrival-frame");
                    await copyFile(observation.screenshotPath, frame);
                    arrivalFrame = frame;
                  } catch (error) {
                    console.log(
                      `[app-flow] ${node.id} could not keep the verified arrival frame \u2014 ${error instanceof Error ? error.message : String(error)}`
                    );
                  }
                  return true;
                },
                // Side observations: a tap made while walking to `node` can land on, or reveal,
                // something worth remembering that has nothing to do with this walk's own target —
                // another still-pending screen (the original opportunistic-capture case), a
                // navigator chrome (plan Step 3d), or a screen the parser never registered a node
                // for at all (plan Step 4a). This purely observes: it never influences what `decide`
                // returns, never injects a step, and never lets `node` itself resolve via this path —
                // `verifyArrival` above is the only way this walk's own target is accepted. Each
                // check below reports what it found as a `DiscoveredFact` rather than writing
                // `captureMap`/`runtimeNodes`/`chromeInventory` directly, so this hook stays ignorant
                // of the graph it feeds — see `DiscoveredFact`'s doc comment (`reach/types.ts`) and
                // `applyDiscoveredFact` above, which is what actually folds one in.
                observed: async (observation) => {
                  if (budget.remainingMs < OPPORTUNISTIC_MIN_REMAINING_MS) return;
                  const observedTokens = fingerprint(observation.pressables);
                  if (opportunisticAttempts < OPPORTUNISTIC_VERIFY_LIMIT && !matchRuntimeNode(runtimeNodes, observedTokens)) {
                    const pending = nodesWithSlug.filter(
                      (other) => other.id !== node.id && !captureMap[other.id] && !isFallbackRoute(other)
                    );
                    const known = pending.length ? pickOpportunisticCandidate(observedTokens, pending) : null;
                    if (known) {
                      opportunisticAttempts += 1;
                      const arrival = await verifyCurrentTarget(
                        known,
                        observation.screenshotPath,
                        budget
                      );
                      if (arrival.verdict === "match") {
                        await applyDiscoveredFact({
                          kind: "opportunistic-capture",
                          nodeId: known.id,
                          arrival,
                          screenshotPath: observation.screenshotPath,
                          pressables: observation.pressables
                        });
                        return;
                      }
                      console.log(
                        `[app-flow] opportunistic ${known.id} rejected while exploring ${node.id} \u2014 ${arrival.reason}`
                      );
                    }
                  }
                  const chromeDetected = detectChromeInventory(
                    observation.pressables,
                    chromeCandidates()
                  );
                  if (chromeDetected) {
                    const revealedFrom = walkCursor?.confirmedNodeId ?? node.id;
                    const reveal = lastAction && inferChromeKind([lastAction]) === "drawer" ? [lastAction] : [];
                    await applyDiscoveredFact({
                      kind: "chrome-observed",
                      entryNodeId: revealedFrom,
                      reveal,
                      items: chromeDetected.items
                    });
                    return;
                  }
                  if (opportunisticAttempts >= OPPORTUNISTIC_VERIFY_LIMIT) return;
                  if (runtimeNodes.length >= RUNTIME_NODE_SWEEP_CAP) return;
                  const knownRuntime = matchRuntimeNode(runtimeNodes, observedTokens);
                  if (knownRuntime) {
                    await applyDiscoveredFact({
                      kind: "runtime-screen-sighted",
                      match: knownRuntime,
                      key: knownRuntime.id,
                      info: "",
                      observedTokens: [...observedTokens],
                      screenshotPath: observation.screenshotPath,
                      pressables: observation.pressables
                    });
                    return;
                  }
                  opportunisticAttempts += 1;
                  const distinctResponse = await runAgent(
                    {
                      cwd: projectPath,
                      systemPrompt: RUNTIME_SCREEN_SYSTEM_PROMPT,
                      userPrompt: "Is this a distinct app screen not already accounted for?",
                      tools: [],
                      // A classification of the frame in front of it, like the arrival judge — real
                      // screen or transient overlay — so `off` for the same reason. This one is also
                      // purely opportunistic: it runs on frames a walk happened to pass through, and
                      // declining to mint a node is always a safe answer.
                      thinkingLevel: "off",
                      imagePath: observation.screenshotPath,
                      timeoutMs: Math.max(1e3, Math.min(3e4, budget.remainingMs))
                    },
                    "runtime-screen"
                  ).catch((error) => {
                    console.log(
                      `[app-flow] runtime-screen check failed while exploring ${node.id} \u2014 ${error instanceof Error ? error.message : String(error)}`
                    );
                    return null;
                  });
                  const verdict = distinctResponse ? parseSubAgentJson(
                    distinctResponse.text
                  ) : null;
                  if (!verdict?.distinct || !verdict.key) return;
                  const candidateId = `runtime:${sanitizeScreenKey(verdict.key) || "screen"}`;
                  const exactMatch = matchRuntimeNode(runtimeNodes, observedTokens, candidateId);
                  await applyDiscoveredFact({
                    kind: "runtime-screen-sighted",
                    match: exactMatch,
                    key: verdict.key,
                    info: verdict.info ?? "",
                    observedTokens: [...observedTokens],
                    screenshotPath: observation.screenshotPath,
                    pressables: observation.pressables
                  });
                }
              });
            } finally {
              navigationSession.dispose();
              walkCursor = null;
            }
            if (!exploration.arrived) {
              seededWalkRan = true;
              reachError = exploration.reason;
              console.log(`[app-flow] ${node.id} exploration stopped \u2014 ${exploration.reason}`);
              return false;
            }
            if (!walkLines) {
              console.log(
                `[app-flow] ${node.id} arrival preserved without a stored path \u2014 a walked step had no faithful agent-device form`
              );
              return true;
            }
            const minimized = minimizeWalkCommands(walkLines);
            pathCommands = [...prefix, ...minimized.commands];
            const contentSelectors = contentMatchedSelectors(pathCommands);
            console.log(
              `[app-flow] ${node.id} stored a ${pathCommands.length}-command path${commandSeed ? ` seeded from ${commandSeed.id}` : ""}${minimized.removed.length ? ` (minimized: dropped ${minimized.removed.length} \u2014 ${minimized.removed.map((entry) => `${entry.rule}: ${entry.command}`).join("; ")})` : ""}${contentSelectors.length ? ` \u2014 matches on rendered content, may not replay elsewhere: ${contentSelectors.join(", ")}` : ""}`
            );
            return true;
          } catch (error) {
            checkSignal(signal);
            reachError = `Interactive exploration failed: ${error instanceof Error ? error.message : String(error)}`;
            console.log(`[app-flow] ${node.id} exploration failed \u2014 ${reachError}`);
            return false;
          }
        };
        const scratchPath = (key2) => getScratchPath(projectId, key2);
        const applyReachEffects = (effects) => {
          for (const effect of effects) {
            switch (effect.kind) {
              case "deep-link-opened":
                openedByNode[effect.nodeId] = effect.opened;
                paramStore.ingestUrl(effect.opened.url, effect.nodeId, nodesWithSlug);
                break;
              case "deep-link-rejection-recorded":
                deepLinkRejections[effect.nodeId] = effect.rejection;
                console.log(
                  `[app-flow] ${effect.nodeId} recording deep-link rejection so later sweeps skip ${effect.rejection.url}`
                );
                break;
              case "deep-link-rejection-cleared":
                deepLinkRejections[effect.nodeId] = null;
                console.log(
                  `[app-flow] ${effect.nodeId} deep link succeeded \u2014 clearing stored rejection`
                );
                break;
              case "deep-link-memo-rejected":
                rejectedDeepLinkUrls.reject(effect.url);
                break;
              case "guard-gate-closed":
                closedGuardGates.close(effect.condition);
                break;
              case "deep-link-not-found":
                deepLinkNotFound = true;
                break;
              case "deep-link-breaker-success":
                deepLinkBreaker = registerDeepLinkSuccess(deepLinkBreaker);
                break;
              case "deep-link-breaker-failure":
                deepLinkBreaker = registerDeepLinkFailure(
                  deepLinkBreaker,
                  Boolean(probeRoute)
                ).state;
                break;
              case "deep-link-breaker-disabled":
                deepLinkBreaker = { ...deepLinkBreaker, enabled: false };
                break;
              case "deep-link-partial-landed":
                break;
            }
          }
        };
        const probeCreditRung = async () => {
          const credit = claimProbeCredit(node.id);
          if (!credit) {
            return {
              strategy: "deep-link",
              ok: false,
              reason: "No verified probe reach is available for this node.",
              touchedDevice: false,
              elapsedMs: 0,
              effects: []
            };
          }
          const effects = [{ kind: "deep-link-breaker-success" }];
          if (credit.opened) {
            effects.push({ kind: "deep-link-opened", nodeId: node.id, opened: credit.opened });
          }
          applyReachEffects(effects);
          console.log(
            `[app-flow] reach ${node.id} \u2014 reusing the deep-link probe's verified arrival, no second navigation`
          );
          return {
            strategy: "deep-link",
            ok: true,
            reason: credit.arrival.reason,
            touchedDevice: false,
            arrival: credit.arrival,
            evidence: {
              arrival: credit.arrival,
              frame: credit.frame,
              pressables: credit.pressables,
              replayScript: null,
              replayVerified: false
            },
            elapsedMs: 0,
            effects
          };
        };
        const savedReplayRung = (_input, p) => savedReplayStrategy(
          {
            node,
            scriptPath: savedScript,
            budget,
            remaining: sweepQueue.remaining,
            scratchPath,
            signal
          },
          p
        );
        const capturedFallbackPressables = () => {
          for (const candidate of nodesWithSlug) {
            if (!isFallbackRoute(candidate)) continue;
            const captured = captureMap[candidate.id]?.pressables;
            if (captured?.length) return captured;
          }
          return null;
        };
        const deepLinkRung = async (_input, p) => {
          const attempt = await deepLinkStrategy(
            {
              node,
              unresolvedParams,
              params,
              budget,
              scratchPath,
              signal,
              breaker: deepLinkBreaker,
              storedRejection: deepLinkRejections[node.id],
              memoRejected: (url) => rejectedDeepLinkUrls.wasRejected(url),
              guardGateClosed: (condition) => closedGuardGates.wasClosed(condition),
              nodesForAncestry: nodesWithSlug.map((candidate) => ({
                id: candidate.id,
                urlPath: candidate.urlPath,
                capturedStatus: captureMap[candidate.id]?.status ?? null
              })),
              reprobe: reprobeDeepLinkRoute,
              arrivalJudge: deepLinkArrivalJudge,
              // Only assembled when it will be read. The build's own fallback route is the one
              // build-specific signature the judge-free check has; `isFallbackRoute` is the same
              // predicate the sweep order and this loop's own fallback handling use, so the three
              // cannot disagree about which route that is. Usually null on a first sweep (fallback
              // routes sort last) and populated on a resumed one, where the capture is read back
              // off the document — see `detectNotFoundScreen`'s rule 1.
              notFoundEvidence: deepLinkArrivalJudge === true ? void 0 : { fallbackPressables: capturedFallbackPressables() }
            },
            p
          );
          applyReachEffects(attempt.effects);
          if (attempt.ok || attempt.failure) return attempt;
          const partial = attempt.effects.find(
            (effect) => effect.kind === "deep-link-partial-landed"
          );
          if (!partial || partial.kind !== "deep-link-partial-landed") return attempt;
          if (!allowsAgentExploration(options.explorationMode)) {
            console.log(
              `[app-flow] ${node.id} prefix ${partial.seed.urlPath} landed on a real screen \u2014 leaving the last hop for AI completion`
            );
            return attempt;
          }
          console.log(
            `[app-flow] ${node.id} prefix ${partial.seed.urlPath} landed on a real screen \u2014 attempting a bounded last hop for the remaining segment`
          );
          if (await exploreFrom(
            { id: partial.seed.id, urlPath: partial.seed.urlPath, url: partial.seed.url },
            { bounded: true }
          )) {
            openedByNode[node.id] = { app: partial.seed.app, url: partial.seed.url };
            paramStore.ingestUrl(partial.seed.url, node.id, nodesWithSlug);
            deepLinkBreaker = registerDeepLinkSuccess(deepLinkBreaker);
            if (deepLinkRejections[node.id]) {
              deepLinkRejections[node.id] = null;
              console.log(
                `[app-flow] ${node.id} bounded last hop succeeded \u2014 clearing stored rejection`
              );
            }
            return {
              ...attempt,
              ok: true,
              reason: "Bounded last hop from the partial prefix reached the target.",
              arrival: acceptedArrival,
              evidence: {
                arrival: acceptedArrival,
                pathCommands,
                replayScript,
                replayVerified: replayScriptVerified
              }
            };
          }
          if (authStopped) return { ...attempt, failure: "auth-stopped" };
          if (!budget.expired) {
            console.log(
              `[app-flow] ${node.id} bounded last hop from ${partial.seed.urlPath} did not reach \u2014 falling back to full exploration \u2014 ${reachError}`
            );
          }
          return attempt;
        };
        const exploreRung = async () => {
          const runExplore = async () => {
            const seed = findSeedSource({
              urlPath: node.urlPath,
              targetId: node.id,
              nodes: nodesWithSlug,
              edges: parsed.edges,
              // Any journey this sweep has stored, not only one a *previous* sweep re-verified.
              // The old test was `capture.replayScript`, and before that `replayVerified` — which
              // could only ever be set by a previous sweep's saved replay, so seeding never fired
              // within one run and every walk re-walked the hops its own parent had just walked.
              //
              // `pathCommands` is the honest test now, and strictly better than the script ever
              // was: it is set by exactly the walks that arrived, it stands alone (its first line
              // is its own launch), and running it needs no file on disk. A capture carried
              // forward from a previous sweep brings its own along, so a resumed run seeds from it
              // too.
              storedPath: (id2) => captureMap[id2]?.pathCommands ?? null,
              deepLinkedThisRun: (id2) => openedByNode[id2]?.url ?? null
            });
            if (seed?.kind === "path") {
              console.log(
                `[app-flow] ${node.id} bounded last hop from ${seed.id}'s stored path${seed.trigger ? ` \u2014 tap ${seed.trigger.by}=${JSON.stringify(seed.trigger.value)}` : ""}`
              );
              if (await exploreFrom(
                { id: seed.id, commands: seed.commands, trigger: seed.trigger },
                { bounded: true }
              )) {
                return true;
              }
              if (authStopped || budget.expired) return false;
              if (!seedBaseFailed) {
                return false;
              }
              console.log(
                `[app-flow] ${node.id} seed's stored path failed \u2014 falling back to full exploration \u2014 ${reachError}`
              );
            } else if (seed?.kind === "deep-link") {
              console.log(`[app-flow] ${node.id} explore seeded at ${seed.urlPath} \u2014 ${seed.url}`);
              if (await exploreFrom({ id: seed.id, urlPath: seed.urlPath, url: seed.url }))
                return true;
              if (authStopped || budget.expired || unavailableReason) return false;
              if (!shouldRetryFromEntry({ walkRan: seededWalkRan, reason: reachError })) {
                console.log(
                  `[app-flow] ${node.id} seeded exploration ran its decisions without arriving \u2014 not retrying from the app entry, it would have nothing new to try \u2014 ${reachError}`
                );
                return false;
              }
              console.log(
                `[app-flow] ${node.id} seeded exploration failed, retrying from the app entry \u2014 ${reachError}`
              );
            }
            return exploreFrom(null);
          };
          const exploreStartedAt = Date.now();
          const ok = await runExplore();
          return {
            strategy: "entry-exploration",
            ok,
            failure: !ok && authStopped ? "auth-stopped" : void 0,
            reason: ok ? acceptedArrival?.reason ?? "Exploration arrived." : reachError ?? "Exploration failed.",
            touchedDevice: true,
            arrival: acceptedArrival,
            evidence: ok ? {
              arrival: acceptedArrival,
              // Always null since verification moved to first use: nothing on the exploration
              // path takes a post-replay frame any more, so delivery takes its own frame and
              // read — the fallback this field always had.
              frame: null,
              pressables: null,
              pathCommands,
              replayScript,
              replayVerified: replayScriptVerified
            } : void 0,
            // Measured rather than the 0 this used to report: the `reach <strategy> <verdict>
            // (<ms>)` line reads this field, and the most expensive rung in the ladder logged as
            // free.
            elapsedMs: Date.now() - exploreStartedAt,
            effects: []
          };
        };
        const renderRung = async (_input, p) => {
          const attempt = await renderStrategy(
            {
              node,
              params,
              unresolvedParams,
              budget,
              scratchPath,
              guardGateClosed: (condition) => closedGuardGates.wasClosed(condition),
              // Only Fast may settle for the runtime's own readiness evidence in place of the
              // vision judge; auto and thorough ask the judge on every arrival exactly as before.
              // See `RenderInput.arrivalJudge`.
              arrivalJudge: options.explorationMode === "adaptive" && !options.judgeUnclearScreens ? "never" : isDeterministicMode(options.explorationMode) ? "fallback" : "always"
            },
            p
          );
          applyReachEffects(attempt.effects);
          return attempt;
        };
        const outcome = await runReachLadder({
          input: null,
          ports,
          budget,
          signal,
          // `probeCreditRung` first: it is the only rung that can succeed without touching the
          // device at all, and when it has nothing to claim it falls through for free. Ahead of
          // the saved replay because a replay would move the app off the very screen the credit
          // is a statement about.
          // `renderRung` between the deep link and exploration: a deep link is the more faithful
          // journey and produces a reusable replay, so it keeps priority, but a navigator
          // dispatch is far cheaper and far more predictable than asking a model to find the
          // screen. See `reach/strategies/render.ts`.
          //
          // Which of the last two rungs are present is the user's choice — see `strategiesFor`.
          strategies: strategiesFor(options.explorationMode, {
            probeCredit: probeCreditRung,
            savedReplay: savedReplayRung,
            deepLink: deepLinkRung,
            render: renderRung,
            explore: exploreRung
          })
        });
        for (const attempt of outcome.attempts) {
          if (attempt.ok) {
            console.log(
              `[app-flow] ${node.id} reach ${attempt.strategy} succeeded (${attempt.elapsedMs}ms)`
            );
            continue;
          }
          const how = attempt.touchedDevice ? "failed" : "declined";
          console.log(
            `[app-flow] ${node.id} reach ${attempt.strategy} ${how} (${attempt.elapsedMs}ms) \u2014 ${attempt.reason}`
          );
        }
        if (outcome.status === "reached") {
          const winner = outcome.attempts[outcome.attempts.length - 1];
          captureMethod = winner.strategy === "deep-link" ? "deep-link" : winner.strategy === "saved-replay" ? "saved-replay" : winner.strategy === "render" ? "rendered" : "agent-navigation";
          if (winner.evidence) {
            acceptedArrival = winner.evidence.arrival;
            pathCommands = winner.evidence.pathCommands ?? pathCommands;
            replayScript = winner.evidence.replayScript;
            replayScriptVerified = winner.evidence.replayVerified;
            verifiedFrame = winner.evidence.frame ?? null;
            verifiedPressables = winner.evidence.pressables ?? null;
          } else if (winner.arrival) {
            acceptedArrival = winner.arrival;
          }
        } else if (outcome.status === "unavailable") {
          unavailableReason = outcome.reason;
        } else if (outcome.status === "stopped") {
          if (outcome.reason === "auth") authStopped = true;
          else checkSignal(signal);
        } else {
          reachError = outcome.reason;
        }
        const deepLinkAttempted = outcome.attempts.some(
          (attempt) => attempt.strategy === "deep-link" && attempt.touchedDevice
        );
        if (authStopped) {
          sweepStopped = true;
        }
        if (sweepStopped) break;
        if (!unavailableReason)
          demoteFailedHarvest(paramStore, node.id, resolution, outcome.attempts);
        if (captureMethod === "unreached") {
          if (unavailableReason) {
            await recordUnreached(node, "unavailable", unavailableReason);
            emit(projectId, onEvent, {
              type: "step",
              phase: "capture",
              message: `${label} is not available in this build`,
              completed: sweepQueue.completed + 1,
              total,
              captured: explorationControl.screensExplored,
              captureLimit: options.screenLimit
            });
            if (finishExploredScreen(false)) break;
            continue;
          }
          await recordUnreached(node, "missing", reachError);
          if (finishExploredScreen(false)) break;
          if (outcome.status === "unreached" && outcome.refused) continue;
          if (!touchedDevice(outcome)) continue;
          if (isToolingFailure(reachError)) continue;
          const current = fingerprint(await capturePressables(ctx, device).catch(() => []));
          const overlap = failedReference ? similarity(current, failedReference) : 0;
          if (failedReference && overlap >= ARRIVAL_SIMILARITY) blockedRun += 1;
          else {
            failedReference = current;
            blockedRun = 1;
          }
          if (blockedRun >= BLOCKED_RUN_LIMIT) {
            const resolution2 = await resolveBlocked(sweepQueue.remaining - 1);
            if (resolution2 === "continue") {
              if (requeuedIds.has(node.id)) {
                console.log(
                  `[app-flow] ${node.id} \u2014 not retrying a second time; this run already reached the same verdict once`
                );
                continue;
              }
              requeuedIds.add(node.id);
              sweepQueue.requeueCurrent();
              continue;
            }
            sweepStopped = true;
            break;
          }
          continue;
        }
        if (captureMethod === "deep-link") {
          node.reach = "deep-link";
        } else if ((captureMethod === "agent-navigation" || captureMethod === "saved-replay") && deepLinkAttempted) {
          node.reach = "navigation-only";
        }
        emit(projectId, onEvent, {
          type: "step",
          phase: "capture",
          message: `Capturing ${label}`,
          completed: sweepQueue.completed + 1,
          total,
          captured: explorationControl.screensExplored,
          captureLimit: options.screenLimit
        });
        const screenshotPath = getScreenshotPath(projectId, node.slug);
        const deliveryStartedAt = Date.now();
        console.log(
          `[app-flow] capture ${sweepQueue.completed + 1}/${total} screenshot ${node.urlPath}`
        );
        const deliveryShot = getScratchPath(projectId, "delivery");
        const relativePath = `screens/${node.slug}.png`;
        const liveFrame = verifiedFrame ?? deliveryShot;
        let liveScreenshot;
        if (verifiedFrame) {
          console.log(`[app-flow] ${node.id} delivering the frame the arrival judge verified`);
          liveScreenshot = { ok: true, relativePath };
        } else {
          try {
            const { relaunched } = await ports.device.captureScreenshot(deliveryShot);
            liveScreenshot = relaunched ? { ok: false, reason: "session was lost; the app was relaunched at its launch URL" } : { ok: true, relativePath };
          } catch (error) {
            checkSignal(signal);
            const detail = error instanceof Error ? error.message : String(error);
            console.log(`[app-flow] ${node.id} screenshot failed \u2014 ${detail}`);
            liveScreenshot = { ok: false, reason: `Screenshot failed: ${detail}` };
          }
        }
        console.log(
          `[app-flow] capture ${sweepQueue.completed + 1}/${total} pressables ${node.urlPath}`
        );
        let livePressables = [];
        let livePressablesError = null;
        if (verifiedPressables) {
          livePressables = [...verifiedPressables];
        } else {
          try {
            livePressables = await ports.device.capturePressables();
          } catch (error) {
            checkSignal(signal);
            livePressablesError = error instanceof Error ? error.message : String(error);
            console.log(`[app-flow] ${node.id} pressables failed \u2014 ${livePressablesError}`);
          }
        }
        console.log(
          `[app-flow] capture ${sweepQueue.completed + 1}/${total} pressables found ${livePressables.length} ${node.urlPath}`
        );
        const sources = chooseDeliverySources({
          liveScreenshot,
          livePressables,
          livePressablesError,
          arrivalFramePath: arrivalFrame,
          arrivalPressables
        });
        paramStore.ingestPressables(node.id, sources.pressables.pressables, nodesWithSlug);
        await harvestNavState(node);
        await harvestLinks(node);
        let screenshotOutcome;
        if (sources.screenshot.source === "none") {
          screenshotOutcome = { ok: false, reason: sources.screenshot.reason };
        } else {
          const frame = sources.screenshot.source === "live" ? liveFrame : sources.screenshot.framePath;
          try {
            await copyFile(frame, screenshotPath);
            screenshotOutcome = { ok: true, relativePath };
            if (sources.screenshot.source === "arrival") {
              console.log(
                `[app-flow] ${node.id} delivered the verified arrival frame; the live device had moved on`
              );
            }
          } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            console.log(`[app-flow] ${node.id} could not store the delivery frame \u2014 ${detail}`);
            screenshotOutcome = { ok: false, reason: `Screenshot unavailable: ${detail}` };
          }
        }
        if (sources.pressables.source === "arrival") {
          console.log(
            `[app-flow] ${node.id} delivered the verified arrival's controls; the live read was taken after the device had moved on`
          );
        }
        const finalArrival = acceptedArrival;
        if (finalArrival) {
          inferredScreens[node.id] = {
            key: finalArrival.key,
            info: finalArrival.info
          };
        }
        failedReference = null;
        blockedRun = 0;
        const evidence = {
          arrival: finalArrival,
          pathCommands,
          replayScript,
          replayVerified: replayScriptVerified
        };
        const delivery = decideDelivery({
          kind: "attempt",
          evidence,
          screenshot: screenshotOutcome,
          pressables: sources.pressables.pressables,
          pressablesError: sources.pressables.error,
          pressablesSource: sources.pressables.source,
          captureMethod,
          structureRevision
        });
        const nodeCapture = await attachSweepUiStates(uiStateCapturer, node, delivery);
        captureMap[node.id] = nodeCapture;
        const nodeLog = sweepLog?.node(node.id);
        nodeLog?.delivery({
          screenshotMs: Date.now() - deliveryStartedAt,
          pressables: sources.pressables.pressables.length
        });
        nodeLog?.finish({
          status: delivery.capture.status,
          totalMs: Date.now() - nodeStartedAt
        });
        if (delivery.capture.replayVerified && delivery.capture.replayScript) {
          for (let at = 0; at < runtimeEdgesList.length; at++) {
            const edge = runtimeEdgesList[at];
            if (edge.to !== node.id || !edge.evidence) continue;
            runtimeEdgesList[at] = {
              ...edge,
              evidence: {
                ...edge.evidence,
                verified: true,
                replayScript: delivery.capture.replayScript
              }
            };
          }
        }
        await persistCaptureUpdate();
        if (finishExploredScreen(delivery.kind === "reached" && Boolean(delivery.capture.screenshot)))
          break;
      }
      if (options.pauseRequested?.()) {
        sweepPaused = true;
      }
      if (sweepStopped) {
        await persistCheckpoint({ force: true });
        manifest.sweepStatus = sweepPaused ? "paused" : "stopped";
        await writeCaptureStatus(projectId, captureMap);
        const stoppedScreens = currentAgentDeviceScreens();
        await writeAgentDeviceScreens(projectId, stoppedScreens);
        const stoppedResult = currentFlowDocument(stoppedScreens);
        await finishManifest(manifest);
        await writeAppFlow(projectId, stoppedResult);
        await writeParamStore(projectId, paramStore.toJSON()).catch(() => void 0);
        emit(projectId, onEvent, {
          type: "complete",
          phase: "render",
          message: sweepPaused ? "Screen sweep paused at a checkpoint; partial results were preserved." : "Screen sweep stopped; partial results were preserved."
        });
        logAgentTokenSummary(tallies, tokens, hedges);
        logPhaseSummary(timing);
        return { ok: true, projectId, result: stoppedResult };
      }
      await writeCaptureStatus(projectId, captureMap);
      const agentDeviceScreens = buildAgentDeviceScreens(
        [...nodesWithSlug, ...runtimeNodes],
        parsed.edges,
        runtimeEdgesList,
        chromeInventory,
        ctx,
        device,
        openedByNode,
        inferredScreens,
        captureMap
      );
      await writeAgentDeviceScreens(projectId, agentDeviceScreens);
      console.log(
        `[app-flow] wrote agent-device screens \u2014 ${Object.keys(agentDeviceScreens).length} entries`
      );
      checkSignal(signal);
      if (options.pauseRequested?.()) {
        sweepPaused = true;
        sweepStopped = true;
      }
      await persistCheckpoint({ force: true });
      await writeCaptureStatus(projectId, captureMap);
      const finalScreens = currentAgentDeviceScreens();
      await writeAgentDeviceScreens(projectId, finalScreens);
      const finalResult = currentFlowDocument(finalScreens);
      manifest.tokens = snapshotUsage(tokens);
      manifest.sweepStatus = sweepPaused ? "paused" : sweepStopped ? "stopped" : "completed";
      await finishManifest(manifest);
      if (!sweepStopped) await clearSweepProgress(projectId);
      await writeAppFlow(projectId, finalResult);
      await writeParamStore(projectId, paramStore.toJSON()).catch(() => void 0);
      const harvest = paramStore.summary();
      console.log(
        `[app-flow] params \u2014 harvested ${harvest.records} record(s) from ${harvest.templates} testID shape(s), ${harvest.learned} demonstrated`
      );
      checkSignal(signal);
      emit(projectId, onEvent, {
        type: "complete",
        phase: "render",
        message: sweepPaused ? "Screen sweep paused at a checkpoint; partial results were preserved." : sweepStopped ? "Screen sweep stopped; partial results were preserved." : "Done."
      });
      logAgentTokenSummary(tallies, tokens, hedges);
      logPhaseSummary(timing);
      console.log("[app-flow] done");
      return { ok: true, projectId, result: finalResult };
    } finally {
      await flushCheckpointOnExit?.().catch(() => void 0);
      await sweepLogOnExit?.close(formatPhaseSummary(timing));
      await fastRuntime?.close().catch(() => void 0);
      if (!reusedDevice) await closeDevice(device);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    let preserved = null;
    if (activeManifest) {
      activeManifest.sweepStatus = message === "Cancelled" ? "stopped" : "failed";
      activeManifest.tokens = snapshotUsage(tokens);
      logAgentTokenSummary(tallies, tokens, hedges);
      logPhaseSummary(timing);
      await finishManifest(activeManifest).catch(() => void 0);
      const existing = await readAppFlow(projectId).catch(() => null);
      if (existing) {
        preserved = { ...existing, manifest: activeManifest };
        await writeAppFlow(projectId, preserved).catch(() => void 0);
      }
    }
    if (message === "Cancelled" && preserved) {
      emit(projectId, onEvent, {
        type: "complete",
        phase: "render",
        message: "Screen sweep cancelled; partial results were preserved."
      });
      return { ok: true, projectId, result: preserved };
    }
    console.error(`[app-flow] build failed: ${message}`);
    emit(projectId, onEvent, { type: "error", phase: "render", message });
    return { ok: false, error: message };
  }
}
var PROMPT_TIMEOUT_MS = 15 * 6e4;
var AppFlowBuilder = class extends EventEmitter {
  controller = new AbortController();
  running = false;
  pauseRequested = false;
  pendingPrompt = null;
  /** Answers an open prompt. Returns false when nothing is waiting for one. */
  resolvePrompt(resolution, promptId) {
    const pending = this.pendingPrompt;
    if (!pending || promptId !== pending.id) return false;
    pending.settle(resolution);
    return true;
  }
  requestUserAction = (prompt) => {
    this.pendingPrompt?.settle("stop");
    return new Promise((resolve3) => {
      const signal = this.controller.signal;
      const settle = (resolution) => {
        if (this.pendingPrompt?.settle !== settle) return;
        this.pendingPrompt = null;
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        resolve3(resolution);
      };
      const onAbort = () => settle("stop");
      const timer = setTimeout(() => {
        console.log(`[app-flow] prompt (${prompt.kind}) timed out \u2014 stopping`);
        settle("stop");
      }, PROMPT_TIMEOUT_MS);
      this.pendingPrompt = { id: prompt.id, settle };
      if (signal.aborted) settle("stop");
      else signal.addEventListener("abort", onAbort, { once: true });
    });
  };
  /**
   * An options object rather than positional parameters: the list had reached seven, two of its
   * callers passed `undefined` through the middle of it to reach the ones they cared about, and
   * adding `explorationMode` would have made an eighth.
   */
  async start(options) {
    if (this.running) throw new Error("Build already in progress");
    this.running = true;
    this.controller = new AbortController();
    this.pauseRequested = false;
    let result;
    try {
      result = await buildAppFlow({
        ...options,
        pauseRequested: () => this.pauseRequested,
        signal: this.controller.signal,
        onEvent: (event) => this.emit("event", event),
        requestUserAction: this.requestUserAction
      });
    } catch (error) {
      result = { ok: false, error: error instanceof Error ? error.message : "Unknown error" };
    } finally {
      this.running = false;
      this.pendingPrompt = null;
    }
    if (result.ok) {
      this.emit("done", result);
    } else {
      this.emit("error", result);
    }
  }
  cancel() {
    console.log("[app-flow] cancel requested");
    this.controller.abort();
  }
  pause() {
    console.log("[app-flow] pause requested; waiting for the next screen checkpoint");
    this.pauseRequested = true;
    this.pendingPrompt?.settle("stop");
  }
  isRunning() {
    return this.running;
  }
};

// packages/core/src/app-flow/index.ts
var builders = /* @__PURE__ */ new Map();
var exploring = /* @__PURE__ */ new Map();
var launchedApps = /* @__PURE__ */ new Map();
var launching = /* @__PURE__ */ new Set();
function getAppFlowBuilders() {
  return builders;
}
function getLaunchedApps() {
  return launchedApps;
}
function createAppFlowService(host) {
  configureAppFlowHost(host);
  return {
    getStatus: async (projectPath) => {
      const projectId = getProjectId(projectPath);
      const manifest = await readManifest(projectId);
      return { exists: manifest !== null, projectId, manifest: manifest ?? void 0 };
    },
    getResult: async (projectPath) => {
      const projectId = getProjectId(projectPath);
      return readAppFlowForRenderer(projectId);
    },
    clear: async (projectPath) => {
      const projectId = getProjectId(projectPath);
      if (builders.get(projectId)?.isRunning() || exploring.has(projectId) || launching.has(projectId)) {
        throw new Error("Stop the active App Flow operation before clearing its saved data.");
      }
      await clearSavedAppFlow(projectId);
      return { cleared: true, projectId };
    },
    launchApp: async (projectPath) => {
      const projectId = getProjectId(projectPath);
      if (builders.get(projectId)?.isRunning()) {
        return { ok: false, error: "App flow build already in progress.", expected: true };
      }
      if (launching.has(projectId)) {
        return { ok: false, error: "App is already launching.", expected: true };
      }
      launching.add(projectId);
      try {
        const parsed = await parseProject(projectPath);
        if (!parsed) {
          return {
            ok: false,
            error: "No supported Expo Router or React Navigation routes were found in the selected project.",
            expected: true
          };
        }
        const previous = launchedApps.get(projectId);
        if (previous) {
          launchedApps.delete(projectId);
          await closeDevice(previous.device);
        }
        const ctx = {
          projectPath,
          projectId,
          scheme: parsed.scheme,
          appName: parsed.appName,
          bundleId: parsed.bundleId,
          slug: parsed.slug,
          platform: "ios",
          sessionName: projectId
        };
        const device = await bootDevice(ctx);
        try {
          await waitForAppReady(ctx, device);
        } catch (error) {
          await closeDevice(device);
          throw error;
        }
        launchedApps.set(projectId, { device, ctx });
        return { ok: true };
      } catch (error) {
        console.error("[app-flow] launch failed:", error);
        return { ok: false, error: error instanceof Error ? error.message : "Unknown error" };
      } finally {
        launching.delete(projectId);
      }
    },
    isAppLaunched: async (projectPath) => launchedApps.has(getProjectId(projectPath)),
    exploreUi: async (projectPath, options) => {
      const projectId = getProjectId(projectPath);
      if (builders.get(projectId)?.isRunning()) {
        return { ok: false, error: "App flow build already in progress.", expected: true };
      }
      if (exploring.has(projectId)) {
        return { ok: false, error: "UI explore is already running for this project.", expected: true };
      }
      const launched = launchedApps.get(projectId);
      if (!launched) {
        return {
          ok: false,
          error: "Launch the app from the App Flow screen first, then start UI explore.",
          expected: true
        };
      }
      const device = launched.device;
      const parsed = await parseProject(projectPath);
      if (!parsed) {
        return {
          ok: false,
          error: "No supported Expo Router or React Navigation routes were found in the selected project.",
          expected: true
        };
      }
      const controller = new AbortController();
      exploring.set(projectId, controller);
      const ctx = { ...launched.ctx, signal: controller.signal };
      const emit2 = (event) => {
        host.emit({ ...event, phase: "capture", projectId });
      };
      void runExploreUi({
        projectPath,
        projectId,
        ctx,
        device,
        ...options?.limit === void 0 ? {} : { limit: options.limit },
        signal: controller.signal,
        emit: emit2
      }).then((result) => {
        emit2({
          type: "complete",
          message: result.cancelled ? "UI explore cancelled." : `Captured ${result.captured} UI state(s)${result.failed ? `, ${result.failed} could not be opened` : ""}.`,
          completed: result.captured
        });
      }).catch((error) => {
        emit2({
          type: "error",
          message: error instanceof Error ? error.message : "Unknown error"
        });
      }).finally(() => {
        exploring.delete(projectId);
      });
      return { ok: true };
    },
    start: async (input) => {
      const {
        projectPath,
        mode,
        screenLimit,
        explorationMode,
        deepLinkJudgeMode,
        captureUiStates,
        judgeUnclearScreens,
        screenIds
      } = resolveAppFlowStart(input);
      if (requiresDecisionProvider(mode, explorationMode, judgeUnclearScreens) && !host.decisions) {
        return { ok: false, error: "App Flow decision provider is not available." };
      }
      const projectId = getProjectId(projectPath);
      let builder = builders.get(projectId);
      if (builder?.isRunning()) {
        return { ok: false, error: "App flow build already in progress." };
      }
      if (launching.has(projectId)) return { ok: false, error: "App is still launching." };
      const launchedDevice = launchedApps.get(projectId)?.device;
      builder = new AppFlowBuilder();
      builders.set(projectId, builder);
      builder.on("event", (event) => {
        host.emit(event);
      });
      builder.on("done", () => {
        console.log(`[app-flow] build done (${projectId})`);
        builders.delete(projectId);
      });
      builder.on("error", (result) => {
        console.error(`[app-flow] build error (${projectId}): ${result.error}`);
        host.emit({
          type: "error",
          phase: "render",
          message: result.error,
          projectId
        });
        builders.delete(projectId);
      });
      console.log(`[app-flow] start requested for ${projectPath} (${projectId})`);
      void builder.start({
        projectPath,
        mode,
        decisionProvider: host.decisions,
        screenLimit,
        explorationMode,
        deepLinkJudgeMode,
        captureUiStates,
        judgeUnclearScreens,
        screenIds,
        launchedDevice
      }).catch((error) => {
        console.error("[app-flow] builder.start rejected:", error);
        builders.delete(projectId);
        host.emit({
          type: "error",
          phase: "render",
          message: error instanceof Error ? error.message : "Unknown error",
          projectId
        });
      });
      return { ok: true };
    },
    resolvePrompt: async (projectPath, resolution, promptId) => {
      const projectId = getProjectId(projectPath);
      const builder = builders.get(projectId);
      const resolved = builder?.resolvePrompt(resolution, promptId) ?? false;
      console.log(
        `[app-flow] prompt resolution "${resolution}" for ${projectId} \u2014 ${resolved ? "delivered" : "nothing waiting"}`
      );
      return { resolved };
    },
    pause: async (projectPath) => {
      const projectId = getProjectId(projectPath);
      const builder = builders.get(projectId);
      console.log(
        `[app-flow] pause requested for ${projectId} \u2014 ${builder ? "builder found" : "no running builder"}`
      );
      if (!builder) return { paused: false };
      builder.pause();
      return { paused: true };
    },
    cancel: async (projectPath) => {
      const projectId = getProjectId(projectPath);
      const explore = exploring.get(projectId);
      if (explore) {
        explore.abort();
        console.log(`[app-flow] cancel requested for ${projectId} \u2014 UI explore aborting`);
        return { cancelled: true };
      }
      const builder = builders.get(projectId);
      console.log(
        `[app-flow] cancel requested for ${projectId} \u2014 ${builder ? "builder found" : "no running builder"}`
      );
      if (!builder) return { cancelled: false };
      builder.cancel();
      return { cancelled: true };
    }
  };
}

export {
  readAppConfig,
  isMetroReady,
  agentDeviceOpenCommand,
  pressCommand,
  pressPointCommand,
  fillCommand,
  scrollCommand,
  ParamStore,
  serializeLocator,
  ActiveTimeBudget,
  resolveNodeParams,
  configureAppFlowHost,
  getProjectId,
  getFlowsDir,
  registerProject,
  readAppFlow,
  writeAppFlow,
  readParamStore,
  writeAgentDeviceScreens,
  readAgentDeviceScreens,
  getScreenshotPath,
  endLiveSession,
  bootDevice,
  waitForRoute,
  startReplayRecording,
  pressWithLocator,
  saveAndReplayRecording,
  replayPathToReach,
  captureScreenshot,
  capturePressables,
  closeDevice,
  contentMatchedSelectors,
  runPathToReach,
  waitForReplayableFrame,
  createRenderPortForTransport,
  recordRuntimeTiming,
  recordRuntimeCount,
  createAppRuntimeTransport,
  uniqueScreenKey,
  defaultScreenInfo,
  getAppFlowBuilders,
  getLaunchedApps,
  createAppFlowService
};

//# debugId=90f83a24-cc37-5525-89e9-3cf679b8b863
