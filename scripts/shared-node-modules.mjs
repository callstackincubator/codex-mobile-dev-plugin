import { readFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";

/**
 * Keep a linked Explore package sharing this bundle's copies of its libraries.
 *
 * `@callstack/tracesift-explore` is wired in with a local `file:` link until it
 * is published, and esbuild resolves a link to the TraceSift checkout, whose
 * `node_modules` then answer the package's imports — a second React and a
 * second copy of every `@rozenite/ui` library, bundled twice into one page that
 * every panel re-reads. This plugin takes a bare import coming from outside the
 * project and resolves it from the plugin's install instead, whenever that
 * install carries a compatible version: the same major, or an identical version
 * below 1.0, where promises are per-minor. Anything else resolves where it came
 * from. At publish time the link becomes a plain dependency, the package lives
 * under this `node_modules` like any other, and this plugin stops finding
 * anything to rewrite.
 */
export function sharedNodeModules(projectRoot) {
  const root = resolve(projectRoot);
  const ownRoot = resolve(root, "node_modules");
  const readVersion = async directory => {
    try { return JSON.parse(await readFile(resolve(directory, "package.json"), "utf8")).version ?? null; }
    catch { return null; }
  };
  // Node's own rule, walked to the filesystem root like any other install: the
  // closest `node_modules/<name>` the importer can see.
  const installedFor = async (importer, name) => {
    let directory = dirname(importer);
    for (;;) {
      const candidate = resolve(directory, "node_modules", ...name.split("/"));
      if (await readVersion(candidate)) return candidate;
      const parent = dirname(directory);
      if (parent === directory) return null;
      directory = parent;
    }
  };
  return {
    name: "shared-node-modules",
    setup(build) {
      build.onResolve({ filter: /^[^./]/ }, async ({ path: specifier, importer, kind }) => {
        if (importer === undefined || kind === "entry-point" || specifier.startsWith("/")) return undefined;
        if (!importer.startsWith("/") || importer.startsWith(root + sep)) return undefined;
        const segments = specifier.split("/");
        const name = specifier.startsWith("@") ? segments.slice(0, 2).join("/") : segments[0];
        const there = await installedFor(importer, name);
        if (there === null || there.startsWith(ownRoot + sep)) return undefined;
        const own = await readVersion(resolve(ownRoot, ...name.split("/")));
        const other = await readVersion(there);
        if (own === null || other === null) return undefined;
        const major = version => Number(version.match(/^(\d+)/)?.[1] ?? -1);
        if (major(own) !== major(other) || (major(own) === 0 && own !== other)) return undefined;
        // The plugin's copy answers with its own exports map, subpaths included.
        const answered = await build.resolve(specifier, { resolveDir: root, kind }).catch(() => null);
        if (!answered?.path || answered.errors.length > 0) return undefined;
        return { path: answered.path };
      });
    },
  };
}
