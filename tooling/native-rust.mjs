import { execFileSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { nativeTelemetrySourceHash } from "./native-telemetry.mjs";

// The Rust helpers share one Cargo workspace, lockfile and target directory.
const workspace = "packages/native";
const manifest = `${workspace}/Cargo.toml`;
export const cargoTarget = `${workspace}/target`;
// Workspace crates every Rust helper links.
const sharedCrates = ["telemetry", "device-tunnel"];

async function addTree(hash, path) {
  const entries = await readdir(path, { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const child = `${path}/${entry.name}`;
    if (entry.isDirectory()) await addTree(hash, child);
    else { hash.update(child); hash.update(await readFile(child)); }
  }
}

async function addCrate(hash, crate) {
  const root = `${workspace}/${crate}`;
  for (const file of ["Cargo.toml", "build.rs"]) {
    const path = `${root}/${file}`;
    let bytes;
    try { bytes = await readFile(path); }
    catch (error) { if (error.code === "ENOENT") continue; throw error; }
    hash.update(path);
    hash.update(bytes);
  }
  await addTree(hash, `${root}/src`);
}

/** Adds everything a workspace binary is built from: the workspace manifest and lockfile, the crate, and the shared crates including the C telemetry. */
export async function rustHelperSourceHash(hash, crate) {
  for (const file of [manifest, `${workspace}/Cargo.lock`]) {
    hash.update(file);
    hash.update(await readFile(file));
  }
  await addCrate(hash, crate);
  for (const shared of sharedCrates) await addCrate(hash, shared);
  await nativeTelemetrySourceHash(hash);
}

export function cargoBuild(name, environment) {
  execFileSync("cargo", ["build", "--release", "--locked", "--manifest-path", manifest, "-p", name], { stdio: "inherit", env: environment });
}

/** License notices for the crates `name` links, resolved with that package's own features. */
export async function cargoLicenses(name) {
  const metadataText = execFileSync("cargo", ["metadata", "--locked", "--format-version", "1", "--manifest-path", manifest], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const metadata = JSON.parse(metadataText);
  const treeText = execFileSync("cargo", ["tree", "--locked", "--manifest-path", manifest, "-p", name, "--target", "all",
    "--prefix", "none", "--no-dedupe", "--format", "{p}"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const linked = new Set();
  for (const line of treeText.split("\n")) {
    const match = /^(\S+) v(\S+)/.exec(line);
    if (match) linked.add(`${match[1]}@${match[2]}`);
  }
  const licenses = [];
  for (const dependency of metadata.packages) {
    if (dependency.name === name || linked.has(`${dependency.name}@${dependency.version}`) === false) continue;
    const directory = resolve(dependency.manifest_path, "..");
    const entries = await readdir(directory);
    const files = entries.filter(file => /^(LICENSE|LICENCE|COPYING|NOTICE)([-._]|$)/i.test(file));
    if (dependency.name === "idevice") files.push("../LICENSE.txt");
    const texts = [];
    for (const file of files) {
      try { texts.push(await readFile(`${directory}/${file}`, "utf8")); }
      catch { /* License directories are represented by separate files when present. */ }
    }
    licenses.push(`${dependency.name} ${dependency.version} (${dependency.license ?? "see source"})\n${dependency.repository ?? ""}\n\n${texts.join("\n\n")}`);
  }
  return licenses;
}
