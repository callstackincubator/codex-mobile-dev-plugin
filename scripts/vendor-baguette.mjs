import { createHash } from "node:crypto";
import { access, chmod, copyFile, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { rebuildBaguette } from "./rebuild-baguette.mjs";

const release = JSON.parse(await readFile("vendor/baguette-release.json", "utf8"));
const temporary = await mkdtemp(join(tmpdir(), "mobile-dev-baguette-"));
try {
  const response = await fetch(release.url);
  if (!response.ok) throw new Error(`Baguette download failed with HTTP ${response.status}.`);
  const archive = Buffer.from(await response.arrayBuffer());
  const digest = createHash("sha256").update(archive).digest("hex");
  if (digest !== release.sha256) throw new Error("Baguette archive checksum did not match the pinned release.");
  const archivePath = join(temporary, "baguette.tar.gz");
  await writeFile(archivePath, archive);
  const members = execFileSync("tar", ["-tzf", archivePath], { encoding: "utf8" }).trim().split("\n");
  if (members.some(path => path.startsWith("/") || path.split("/").includes(".."))) throw new Error("Invalid archive path.");
  execFileSync("tar", ["-xzf", archivePath, "-C", temporary]);
  const root = join(temporary, `baguette-v${release.version}-macOS-arm64`);
  await access(join(root, "Baguette"));
  await access(join(root, "Baguette_Baguette.bundle"));
  await mkdir("vendor/baguette", { recursive: true });
  await cp(root, "vendor/baguette", { recursive: true });
  await chmod("vendor/baguette/Baguette", 0o755);
  await copyFile("vendor/baguette-release.json", "vendor/baguette/release.json");
  const license = await fetch(`https://raw.githubusercontent.com/tddworks/baguette/v${release.version}/LICENSE`);
  if (!license.ok) throw new Error("Could not fetch Baguette's license.");
  await writeFile("vendor/baguette/LICENSE", await license.text());
  console.log(`Vendored Baguette ${release.version} with verified SHA-256.`);
  if (release.rebuild) await rebuildBaguette();
} finally {
  await rm(temporary, { recursive: true, force: true });
}
