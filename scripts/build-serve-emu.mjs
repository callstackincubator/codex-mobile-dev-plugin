import { build } from "esbuild";
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const runtime = resolve("runtimes/serve-emu");

async function sha256(path) {
  const bytes = await readFile(path);
  const hash = createHash("sha256");
  hash.update(bytes);
  return hash.digest("hex");
}

async function sourceHash() {
  const hash = createHash("sha256");
  const visit = async directory => {
    const directoryPath = join(runtime, directory);
    const entries = await readdir(directoryPath, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else {
        const sourcePath = join(runtime, path);
        const bytes = await readFile(sourcePath);
        hash.update(path);
        hash.update(bytes);
      }
    }
  };
  await visit("src");
  await visit("scripts");
  return hash.digest("hex");
}

// npm ci records what it installed. Refuse to package dependencies from an older lockfile.
async function assertInstalledDependencies() {
  const packages = async path => {
    const text = await readFile(join(runtime, path), "utf8").catch(() => "{}");
    const entries = Object.entries(JSON.parse(text).packages ?? {}).filter(([name]) => name);
    return JSON.stringify(entries.map(([name, item]) => [name, item.version]).sort());
  };
  const [locked, installed] = await Promise.all([packages("package-lock.json"), packages("node_modules/.package-lock.json")]);
  if (locked !== installed) throw new Error("runtimes/serve-emu/node_modules does not match its package-lock.json. Run npm run vendor:serve-emu.");
}

export async function buildServeEmu(directory) {
  const outputDirectory = resolve(directory);
  if (outputDirectory === runtime) throw new Error("Build the Android runtime into a separate output directory.");
  const upstreamPath = join(runtime, "upstream.json");
  const upstreamText = await readFile(upstreamPath, "utf8");
  const upstream = JSON.parse(upstreamText);
  const scrcpyPath = join(runtime, "vendor/scrcpy-server-v4.0");
  const scrcpySHA256 = await sha256(scrcpyPath);
  if (scrcpySHA256 !== upstream.scrcpySHA256) throw new Error("The bundled scrcpy server does not match its pinned SHA-256.");
  const lockPath = join(runtime, "package-lock.json");
  const lockfileSHA256 = await sha256(lockPath);
  const scrcpyClientPath = join(runtime, "src/scrcpy.ts");
  const scrcpyClientSHA256 = await sha256(scrcpyClientPath);
  const sourceSHA256 = await sourceHash();
  await assertInstalledDependencies();
  await rm(outputDirectory, { recursive: true, force: true });
  await mkdir(outputDirectory, { recursive: true });
  for (const path of ["src", "scripts", "node_modules", "vendor", "LICENSE", "README.md", "upstream.json", "package-lock.json"]) {
    const sourcePath = join(runtime, path);
    const targetPath = join(outputDirectory, path);
    await cp(sourcePath, targetPath, { recursive: true, verbatimSymlinks: true });
  }
  const sourceUi = join(runtime, "ui");
  const targetUi = join(outputDirectory, "dist/ui");
  await cp(sourceUi, targetUi, { recursive: true });
  const entryPoint = join(runtime, "src/cli.ts");
  const output = join(outputDirectory, "src/cli.mjs");
  await build({
    entryPoints: [entryPoint], outfile: output,
    bundle: true, format: "esm", platform: "node", target: "node22.18",
    external: ["ws", "@fastify/busboy"],
  });
  const cliSHA256 = await sha256(output);
  const release = {
    ...upstream, runtime: "node", entryPoint: "src/cli.mjs",
    lockfileSHA256, sourceSHA256, scrcpyClientSHA256, cliSHA256,
  };
  const releaseText = JSON.stringify(release, null, 2);
  const releasePath = join(outputDirectory, "release.json");
  await writeFile(releasePath, releaseText + "\n");
  return output;
}
