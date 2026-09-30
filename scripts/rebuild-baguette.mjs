import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { copyFile, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const execute = promisify(execFile);

export async function rebuildBaguette(sourceDirectory) {
  const release = JSON.parse(await readFile("vendor/baguette-release.json", "utf8"));
  if (process.platform !== "darwin" || process.arch !== "arm64") throw new Error("Rebuilding Baguette requires an Apple Silicon Mac.");
  const { stdout: swift } = await execute("xcrun", ["swift", "--version"]);
  const version = /Swift version (\d+)\.(\d+)/.exec(swift);
  if (!version || Number(version[1]) < 6 || (Number(version[1]) === 6 && Number(version[2]) < 4)) {
    throw new Error("Rebuilding this runtime requires Swift 6.4 or later, included in Xcode 27.");
  }
  const temporary = sourceDirectory ? undefined : await mkdtemp(join(tmpdir(), "mobile-dev-baguette-build-"));
  const source = resolve(sourceDirectory ?? temporary);
  try {
    if (!sourceDirectory) {
      await execute("git", ["init", source]);
      await execute("git", ["-C", source, "remote", "add", "origin", "https://github.com/tddworks/baguette.git"]);
      await execute("git", ["-C", source, "fetch", "--depth", "1", "origin", release.rebuild.sourceCommit]);
      await execute("git", ["-C", source, "checkout", "--detach", "FETCH_HEAD"]);
    }
    const { stdout: commit } = await execute("git", ["-C", source, "rev-parse", "HEAD"]);
    if (commit.trim() !== release.rebuild.sourceCommit) throw new Error("Baguette source does not match the pinned commit.");
    const { stdout: changes } = await execute("git", ["-C", source, "status", "--porcelain", "--untracked-files=no"]);
    if (changes.trim()) throw new Error("Baguette source has changes. Rebuild from the pinned source.");
    console.log(`Rebuilding Baguette ${release.version} with ${swift.trim().split("\n")[0]}…`);
    try {
      await execute("xcrun", ["swift", "build", "-c", "release", "--product", "Baguette"], {
        cwd: source, timeout: 600000, maxBuffer: 20 * 1024 * 1024,
      });
    } catch (error) { throw new Error(`Baguette build failed. ${String(error.stderr ?? error.message).slice(-5000)}`); }
    const executable = join(source, ".build/release/Baguette");
    const target = "vendor/baguette/Baguette";
    // Replace the inode so macOS cannot reuse the old code-signature cache.
    await rm(target, { force: true });
    await copyFile(executable, target);
    const licenses = [];
    const checkouts = join(source, ".build/checkouts");
    for (const dependency of (await readdir(checkouts)).sort()) {
      for (const file of (await readdir(join(checkouts, dependency))).filter(file => /^(LICENSE|LICENCE|COPYING|NOTICE)(\.|$)/i.test(file))) {
        licenses.push(`${dependency} (${file})\n\n${await readFile(join(checkouts, dependency, file), "utf8")}`);
      }
    }
    await writeFile("vendor/baguette/third-party-licenses.txt", licenses.join("\n\n====================\n\n"));
    const binarySha256 = createHash("sha256").update(await readFile(target)).digest("hex");
    await writeFile("vendor/baguette/release.json", JSON.stringify({ ...release, build: {
      sourceCommit: commit.trim(), swift: swift.trim(), binarySha256,
    } }, null, 2) + "\n");
    console.log(`Bundled runtime rebuilt; SHA-256 ${binarySha256}.`);
  } finally { if (temporary) await rm(temporary, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await rebuildBaguette(process.argv[2]);
