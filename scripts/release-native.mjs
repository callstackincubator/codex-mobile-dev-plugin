import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { appendFile, copyFile, cp, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";

const androidAbis = ["arm64-v8a", "armeabi-v7a", "x86", "x86_64"];

function androidSymbols(name) {
  return androidAbis.map(abi => `.sentry/native/${abi}/${name}`);
}

const androidFpsSymbols = androidSymbols("mobile-dev-fps");
const androidCpuSymbols = androidSymbols("mobile-dev-cpu");
const androidFpsBinaries = androidAbis.map(abi => `${abi}/mobile-dev-fps`);
const androidCpuBinaries = androidAbis.map(abi => `${abi}/mobile-dev-cpu`);

export const nativeHelpers = [
  { name: "baguette", command: "vendor:baguette", scripts: ["vendor-baguette.mjs", "rebuild-baguette.mjs", "baguette-foreground-diagnostics.mjs", "baguette-rpaths.mjs"],
    inputs: ["vendor/baguette-release.json"], tools: ["darwin", "swift"],
    symbols: [".sentry/native/darwin-arm64/Baguette.dSYM"], binaries: ["Baguette", "Baguette_Baguette.bundle"] },
  { name: "ios-fps", command: "rebuild:ios-fps", scripts: ["build-fps.mjs"], inputs: [], tools: ["darwin", "rust"],
    symbols: [".sentry/native/darwin-arm64/mobile-dev-ios-fps.dSYM"], binaries: ["mobile-dev-ios-fps"] },
  { name: "ios-mirror", command: "rebuild:ios-mirror", scripts: ["build-ios-mirror.mjs"], inputs: [], tools: ["darwin", "rust"],
    symbols: [".sentry/native/darwin-arm64/darwin-arm64.node.dSYM"], binaries: ["darwin-arm64.node"] },
  { name: "ios-logs", command: "rebuild:ios-logs", scripts: ["build-ios-logs.mjs"], inputs: [], tools: ["darwin", "iosLogs"],
    symbols: [".sentry/native/darwin-arm64/mobile-dev-ios-logs.dSYM"], binaries: ["mobile-dev-ios-logs"] },
  { name: "android-fps", command: "rebuild:android-fps", scripts: ["build-fps.mjs"], inputs: [], tools: ["android"],
    symbols: androidFpsSymbols, binaries: androidFpsBinaries },
  { name: "android-cpu", command: "rebuild:android-cpu", scripts: ["build-android-cpu.mjs"], inputs: [], tools: ["android"],
    symbols: androidCpuSymbols, binaries: androidCpuBinaries },
];

function version(command, args) {
  const output = execFileSync(command, args, { encoding: "utf8" });
  const trimmed = output.trim();
  const lines = trimmed.split("\n");
  const portable = lines.filter(line => {
    const installedDirectory = line.startsWith("InstalledDir:");
    return installedDirectory === false;
  });
  return portable.join("\n");
}

export async function nativeToolchain(environment = process.env) {
  const ndk = environment.ANDROID_NDK_HOME;
  if (ndk === undefined) throw new Error("Set ANDROID_NDK_HOME before preparing native release artifacts.");
  const compiler = join(ndk, "toolchains/llvm/prebuilt/darwin-x86_64/bin/clang");
  const ndkProperties = await readFile(`${ndk}/source.properties`, "utf8");
  const flags = {};
  for (const name of ["CFLAGS", "CXXFLAGS", "CPPFLAGS", "LDFLAGS", "RUSTFLAGS", "CARGO_ENCODED_RUSTFLAGS", "MACOSX_DEPLOYMENT_TARGET"]) {
    flags[name] = environment[name] ?? "";
  }
  const os = version("sw_vers", ["-buildVersion"]);
  const cmake = version("cmake", ["--version"]);
  const ninja = version("ninja", ["--version"]);
  const xcode = version("xcodebuild", ["-version"]);
  const clang = version("xcrun", ["clang", "--version"]);
  const sdk = version("xcrun", ["--sdk", "macosx", "--show-sdk-build-version"]);
  const swift = version("xcrun", ["swift", "--version"]);
  const rustc = version("rustc", ["-Vv"]);
  const cargo = version("cargo", ["--version"]);
  const ndkClang = version(compiler, ["--version"]);
  const properties = ndkProperties.trim();
  const iosLogs = version("brew", ["list", "--versions", "openssl@3", "pkgconf", "autoconf", "automake", "libtool"]);
  return {
    shared: { platform: process.platform, arch: process.arch, node: process.version, flags, os, cmake, ninja },
    darwin: { xcode, clang, sdk }, swift, rust: { rustc, cargo }, android: { properties, clang: ndkClang }, iosLogs,
  };
}

export async function nativeArtifactKey(helper, toolchain, directory = ".") {
  const tracked = execFileSync("git", ["ls-files", "-z", "--", `native/${helper.name}`, "native/telemetry"], {
    cwd: directory, encoding: "utf8",
  });
  const trackedFiles = tracked.split("\0");
  const nativeFiles = trackedFiles.filter(Boolean);
  const hasSources = nativeFiles.some(file => {
    return file.startsWith(`native/${helper.name}/`);
  });
  if (hasSources === false) {
    throw new Error(`No tracked native sources for ${helper.name}.`);
  }
  const scripts = helper.scripts.map(file => `scripts/${file}`);
  const inputs = ["scripts/release-native.mjs", "scripts/native-telemetry.mjs", ...scripts, ...helper.inputs, ...nativeFiles];
  const uniqueInputs = new Set(inputs);
  const sortedInputs = [...uniqueInputs].sort();
  const tools = { shared: toolchain.shared };
  for (const name of helper.tools) {
    if (toolchain[name] === undefined) throw new Error(`Missing ${name} toolchain fingerprint.`);
    tools[name] = toolchain[name];
  }
  const packageText = await readFile(`${directory}/package.json`, "utf8");
  const metadata = JSON.parse(packageText);
  const configuration = JSON.stringify({ schema: 1, helper: helper.name, command: metadata.scripts[helper.command], tools });
  const hash = createHash("sha256");
  hash.update(configuration);
  for (const file of sortedInputs) {
    const bytes = await readFile(`${directory}/${file}`);
    hash.update(`\0${file}\0${bytes.length}\0`);
    hash.update(bytes);
  }
  const digest = hash.digest("hex");
  return `native-v1-${helper.name}-${digest}`;
}

export async function findNativeArtifact(name, request, runs = new Map()) {
  const encodedName = encodeURIComponent(name);
  for (let page = 1; ; page++) {
    const response = await request(`actions/artifacts?name=${encodedName}&per_page=100&page=${page}`);
    const artifacts = response.artifacts.toSorted((a, b) => b.id - a.id);
    for (const artifact of artifacts) {
      if (artifact.name !== name || artifact.expired || artifact.workflow_run === undefined) continue;
      const source = artifact.workflow_run;
      if (source.head_repository_id !== source.repository_id) continue;
      if (runs.has(source.id) === false) {
        const run = await request(`actions/runs/${source.id}`);
        runs.set(source.id, run);
      }
      const run = runs.get(source.id);
      const trustedEvent = run.event === "push" || run.event === "workflow_dispatch";
      const successfulRelease = run.path === ".github/workflows/release.yml" && run.status === "completed" && run.conclusion === "success";
      if (trustedEvent && successfulRelease) return artifact;
    }
    if (response.artifacts.length < 100) return undefined;
  }
}

function artifactRoots(helper) {
  return [`vendor/${helper.name}`, ...helper.symbols];
}

async function fileDigest(path) {
  const hash = createHash("sha256");
  const stream = createReadStream(path);
  for await (const bytes of stream) hash.update(bytes);
  return hash.digest("hex");
}

async function inventory(directory, paths) {
  const files = [];
  async function visit(path) {
    const absolute = join(directory, path);
    const stat = await lstat(absolute);
    if (stat.isDirectory()) {
      const entries = await readdir(absolute);
      entries.sort();
      for (const entry of entries) {
        const child = `${path}/${entry}`;
        await visit(child);
      }
    } else if (stat.isFile()) {
      const sha256 = await fileDigest(absolute);
      files.push({ path, sha256, mode: stat.mode & 0o777 });
    } else {
      throw new Error(`Unsupported native artifact entry: ${path}.`);
    }
  }
  for (const path of paths) await visit(path);
  return files;
}

async function assertPayload(helper, key, directory) {
  const text = await readFile(`${directory}/.native-artifact.json`, "utf8");
  const manifest = JSON.parse(text);
  if (manifest.schema !== 1 || manifest.helper !== helper.name || manifest.key !== key) {
    throw new Error(`Native artifact identity mismatch for ${helper.name}.`);
  }
  const roots = artifactRoots(helper);
  const files = await inventory(directory, roots);
  const expected = JSON.stringify(manifest.files);
  const actual = JSON.stringify(files);
  if (actual !== expected) throw new Error(`Native artifact integrity check failed for ${helper.name}.`);
  const required = [`vendor/${helper.name}/release.json`];
  for (const binary of helper.binaries) required.push(`vendor/${helper.name}/${binary}`);
  for (const symbol of helper.symbols) {
    const symbolFiles = files.filter(file => {
      const dwarf = file.path.startsWith(`${symbol}/Contents/Resources/DWARF/`);
      return file.path === symbol || dwarf;
    });
    if (symbolFiles.length === 0) throw new Error(`Native artifact is missing matching symbols: ${symbol}.`);
  }
  for (const path of required) {
    const absolute = join(directory, path);
    await lstat(absolute);
  }
}

export async function saveNativeArtifact(helper, key, archive, directory = ".") {
  const parent = tmpdir();
  const prefix = join(parent, "mobile-dev-native-save-");
  const staging = await mkdtemp(prefix);
  try {
    const roots = artifactRoots(helper);
    for (const path of roots) {
      const source = join(directory, path);
      const target = join(staging, path);
      const targetParent = dirname(target);
      await mkdir(targetParent, { recursive: true });
      await cp(source, target, { recursive: true, dereference: true });
    }
    const files = await inventory(staging, roots);
    const manifest = JSON.stringify({ schema: 1, helper: helper.name, key, files });
    await writeFile(`${staging}/.native-artifact.json`, manifest + "\n");
    await assertPayload(helper, key, staging);
    const outputParent = dirname(archive);
    await mkdir(outputParent, { recursive: true });
    execFileSync("tar", ["-czf", archive, "-C", staging, ".native-artifact.json", ...roots]);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

export async function restoreNativeArtifact(helper, key, archive, directory = ".") {
  const roots = artifactRoots(helper);
  const listing = execFileSync("tar", ["-tzf", archive], { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
  const trimmedListing = listing.trim();
  const entries = trimmedListing.split("\n");
  for (const entry of entries) {
    const path = entry.replace(/\/$/, "");
    const parts = path.split("/");
    const inPayload = roots.some(root => {
      const descendant = path.startsWith(`${root}/`);
      return path === root || descendant;
    });
    const allowed = path === ".native-artifact.json" || inPayload;
    const traversal = parts.includes("..");
    if (allowed === false || traversal) throw new Error(`Invalid native artifact path: ${entry}.`);
  }
  const parent = tmpdir();
  const prefix = join(parent, "mobile-dev-native-restore-");
  const staging = await mkdtemp(prefix);
  try {
    execFileSync("tar", ["-xzf", archive, "-C", staging]);
    await assertPayload(helper, key, staging);
    for (const path of roots) {
      const source = join(staging, path);
      const target = join(directory, path);
      const targetParent = dirname(target);
      await mkdir(targetParent, { recursive: true });
      await rm(target, { recursive: true, force: true });
      await cp(source, target, { recursive: true });
    }
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

export async function downloadNativeArtifact(artifact, archive, helper, environment, fetcher = fetch) {
  if (/^sha256:[a-f0-9]{64}$/.test(artifact.digest) === false) throw new Error("Native artifact has no SHA-256 digest.");
  const api = environment.GITHUB_API_URL;
  const repository = environment.GITHUB_REPOSITORY;
  const url = `${api}/repos/${repository}/actions/artifacts/${artifact.id}/zip`;
  const response = await fetcher(url, {
    headers: { Authorization: `Bearer ${environment.GH_TOKEN}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
    redirect: "manual",
  });
  if (response.status !== 302) throw new Error(`Native artifact download failed: HTTP ${response.status}.`);
  const location = response.headers.get("location");
  if (location === null) throw new Error("Native artifact download is missing its redirect.");
  const download = await fetcher(location);
  if (download.ok === false || download.body === null) throw new Error(`Native artifact download failed: HTTP ${download.status}.`);
  const parent = tmpdir();
  const prefix = join(parent, "mobile-dev-native-download-");
  const staging = await mkdtemp(prefix);
  try {
    const zip = join(staging, "artifact.zip");
    const hash = createHash("sha256");
    const checksum = new Transform({ transform(chunk, encoding, callback) { hash.update(chunk); callback(null, chunk); } });
    const input = Readable.fromWeb(download.body);
    const output = createWriteStream(zip);
    await pipeline(input, checksum, output);
    const digest = hash.digest("hex");
    if (`sha256:${digest}` !== artifact.digest) throw new Error(`Native artifact download integrity check failed for ${helper.name}.`);
    const filename = `${helper.name}.tar.gz`;
    const listing = execFileSync("unzip", ["-Z1", zip], { encoding: "utf8" });
    if (listing.trim() !== filename) throw new Error(`Unexpected native artifact ZIP contents for ${helper.name}.`);
    execFileSync("unzip", ["-q", zip, "-d", staging]);
    const extracted = join(staging, filename);
    await copyFile(extracted, archive);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

export async function prepareNativeHelper(helper, options) {
  const { directory, toolchain, request, runs, download, build, outputDirectory } = options;
  const key = await nativeArtifactKey(helper, toolchain, directory);
  const archive = join(outputDirectory, `${helper.name}.tar.gz`);
  await mkdir(outputDirectory, { recursive: true });
  const artifact = await findNativeArtifact(key, request, runs);
  if (artifact) {
    console.log(`Restoring ${helper.name} from release run ${artifact.workflow_run.id}.`);
    await download(artifact, archive, helper);
    await restoreNativeArtifact(helper, key, archive, directory);
  } else {
    console.log(`Building ${helper.name}: no successful release artifact matches ${key}.`);
    await build(helper);
    await saveNativeArtifact(helper, key, archive, directory);
  }
  const action = artifact ? "restored" : "built";
  return { helper: helper.name, key, archive, action };
}

async function releaseNative(environment = process.env) {
  for (const name of ["GITHUB_REPOSITORY", "GITHUB_API_URL", "GH_TOKEN", "GITHUB_OUTPUT", "GITHUB_STEP_SUMMARY"]) {
    if (environment[name] === undefined || environment[name].length === 0) throw new Error(`Set ${name} to prepare native release artifacts.`);
  }
  if (process.platform !== "darwin" || process.arch !== "arm64") throw new Error("Prepare native release artifacts on an Apple Silicon Mac.");
  const directory = process.cwd();
  const outputDirectory = resolve("release/native-artifacts");
  await rm(outputDirectory, { recursive: true, force: true });
  const toolchain = await nativeToolchain(environment);
  const runs = new Map();
  async function request(path) {
    const endpoint = `repos/${environment.GITHUB_REPOSITORY}/${path}`;
    const response = execFileSync("gh", ["api", endpoint], { encoding: "utf8", env: environment, maxBuffer: 10 * 1024 * 1024 });
    return JSON.parse(response);
  }
  async function download(artifact, archive, helper) {
    await downloadNativeArtifact(artifact, archive, helper, environment);
  }
  async function build(helper) {
    execFileSync("npm", ["run", helper.command], { cwd: directory, env: environment, stdio: "inherit" });
  }
  await appendFile(environment.GITHUB_STEP_SUMMARY, "### Native release artifacts\n\n| Helper | Result | Duration |\n| --- | --- | --- |\n");
  for (const helper of nativeHelpers) {
    const start = performance.now();
    const result = await prepareNativeHelper(helper, { directory, toolchain, request, runs, download, build, outputDirectory });
    const elapsed = performance.now() - start;
    const seconds = (elapsed / 1000).toFixed(1);
    await appendFile(environment.GITHUB_OUTPUT, `${helper.name}=${result.key}\n`);
    await appendFile(environment.GITHUB_STEP_SUMMARY, `| ${helper.name} | ${result.action} | ${seconds}s |\n`);
  }
}

const executedPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
const executedUrl = executedPath ? pathToFileURL(executedPath).href : undefined;
if (import.meta.url === executedUrl) await releaseNative();
