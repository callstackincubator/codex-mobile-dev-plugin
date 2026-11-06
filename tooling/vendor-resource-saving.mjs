import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const resourceSavingDirectory = "packages/native/vendor/resource-saving";
const metadataPath = "packages/native/resource-saving/releases.json";

function sha256(bytes) {
  const hash = createHash("sha256");
  hash.update(bytes);
  return hash.digest("hex");
}

export async function verifyResourceSaving(directory = resourceSavingDirectory) {
  const text = await readFile(metadataPath, "utf8");
  const releases = JSON.parse(text);
  for (const [name, release] of Object.entries(releases)) {
    const bytes = await readFile(`${directory}/${name}`);
    if (sha256(bytes) !== release.binarySHA256) throw new Error(`Resource optimizer ${name} integrity check failed. Run npm run vendor:resource-saving.`);
    await readFile(`${directory}/${name}-LICENSE`);
  }
}

export async function vendorResourceSaving() {
  const text = await readFile(metadataPath, "utf8");
  const releases = JSON.parse(text);
  const temporaryRoot = tmpdir();
  const prefix = join(temporaryRoot, "mobile-dev-resource-saving-");
  const temporary = await mkdtemp(prefix);
  try {
    await mkdir(resourceSavingDirectory, { recursive: true });
    for (const [name, release] of Object.entries(releases)) {
      const response = await fetch(release.url);
      if (response.ok === false) throw new Error(`Cannot download ${name}: HTTP ${response.status}.`);
      const buffer = await response.arrayBuffer();
      const bytes = Buffer.from(buffer);
      if (sha256(bytes) !== release.archiveSHA256) throw new Error(`${name} archive integrity check failed.`);
      const archive = join(temporary, `${name}.tar.gz`);
      const unpacked = join(temporary, name);
      await writeFile(archive, bytes);
      await mkdir(unpacked);
      execFileSync("tar", ["-xzf", archive, "-C", unpacked], { stdio: "inherit" });
      const source = join(unpacked, release.binaryPath);
      const binary = await readFile(source);
      if (sha256(binary) !== release.binarySHA256) throw new Error(`${name} binary integrity check failed.`);
      const target = `${resourceSavingDirectory}/${name}`;
      await copyFile(source, target);
      await chmod(target, 0o755);
      await copyFile(`packages/native/resource-saving/${name}-LICENSE`, `${resourceSavingDirectory}/${name}-LICENSE`);
    }
    await writeFile(`${resourceSavingDirectory}/release.json`, text);
    await verifyResourceSaving();
  } finally { await rm(temporary, { recursive: true, force: true }); }
}

const ownPath = fileURLToPath(import.meta.url);
if (process.argv[1] === ownPath) await vendorResourceSaving();
