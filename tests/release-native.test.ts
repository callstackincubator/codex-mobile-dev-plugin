import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test, type TestContext } from "node:test";
import { downloadNativeArtifact, findNativeArtifact, nativeArtifactKey, nativeHelpers, prepareNativeHelper, restoreNativeArtifact, saveNativeArtifact } from "../scripts/release-native.mjs";

const toolchain = { shared: { node: "22", cmake: "4" }, darwin: "Xcode 27", swift: "6.4", rust: "1.98.1", android: "NDK 27", iosLogs: "OpenSSL 3" };

async function put(directory: string, path: string, content: string) {
  const absolute = join(directory, path);
  const parent = dirname(absolute);
  await mkdir(parent, { recursive: true });
  await writeFile(absolute, content);
}

async function fixture(t: TestContext) {
  const parent = tmpdir();
  const prefix = join(parent, "mobile-dev-native-artifact-test-");
  const directory = await mkdtemp(prefix);
  t.after(async () => { await rm(directory, { recursive: true, force: true }); });
  execFileSync("git", ["init", "--quiet", directory]);
  const scripts: Record<string, string> = {};
  for (const helper of nativeHelpers) {
    scripts[helper.command] = `node scripts/${helper.scripts[0]}`;
    await put(directory, `native/${helper.name}/source`, "native source\n");
    for (const file of helper.scripts) await put(directory, `scripts/${file}`, "build script\n");
    for (const file of helper.inputs) await put(directory, file, '{"sourceCommit":"pinned"}\n');
  }
  await put(directory, "scripts/native-telemetry.mjs", "SDK configuration\n");
  await put(directory, "scripts/release-native.mjs", "artifact configuration\n");
  await put(directory, "native/telemetry/telemetry.c", "shared telemetry\n");
  const metadata = JSON.stringify({ version: "1.2.3", scripts });
  await put(directory, "package.json", metadata);
  execFileSync("git", ["add", "."], { cwd: directory });
  return directory;
}

async function payload(directory: string, helper: typeof nativeHelpers[number]) {
  await put(directory, `vendor/${helper.name}/release.json`, '{"sourceSHA256":"source"}\n');
  await put(directory, `vendor/${helper.name}/LICENSE`, "license\n");
  for (const binary of helper.binaries) {
    if (binary.endsWith(".bundle")) {
      await put(directory, `vendor/${helper.name}/${binary}/Info.plist`, "bundle\n");
    } else {
      const path = `vendor/${helper.name}/${binary}`;
      await put(directory, path, "native binary\n");
      const absolute = join(directory, path);
      await chmod(absolute, 0o755);
    }
  }
  for (const symbol of helper.symbols) {
    const path = symbol.endsWith(".dSYM") ? `${symbol}/Contents/Resources/DWARF/program` : symbol;
    await put(directory, path, "matching symbols\n");
  }
}

test("native keys ignore plugin versions and unrelated UI edits", async t => {
  const directory = await fixture(t);
  const helper = nativeHelpers[0];
  const before = await nativeArtifactKey(helper, toolchain, directory);
  const packageText = await readFile(`${directory}/package.json`, "utf8");
  const metadata = JSON.parse(packageText);
  metadata.version = "1.2.4";
  const updated = JSON.stringify(metadata);
  await put(directory, "package.json", updated);
  await put(directory, "src/ui/app.tsx", "different UI\n");
  const after = await nativeArtifactKey(helper, toolchain, directory);
  assert.equal(after, before);
});

test("native keys include helper sources, added files, scripts, pins and shared telemetry", async t => {
  const directory = await fixture(t);
  for (const helper of nativeHelpers) {
    const files = [`native/${helper.name}/source`, `scripts/${helper.scripts[0]}`, ...helper.inputs,
      "scripts/native-telemetry.mjs", "scripts/release-native.mjs", "native/telemetry/telemetry.c"];
    for (const file of files) {
      const before = await nativeArtifactKey(helper, toolchain, directory);
      const original = await readFile(`${directory}/${file}`, "utf8");
      await put(directory, file, original + "changed\n");
      const after = await nativeArtifactKey(helper, toolchain, directory);
      assert.notEqual(after, before, `${helper.name}: ${file}`);
      await put(directory, file, original);
    }
    const before = await nativeArtifactKey(helper, toolchain, directory);
    const addition = `native/${helper.name}/new-source`;
    await put(directory, addition, "added\n");
    execFileSync("git", ["add", addition], { cwd: directory });
    const after = await nativeArtifactKey(helper, toolchain, directory);
    assert.notEqual(after, before, `${helper.name}: added source`);
  }
});

test("native keys invalidate only helpers affected by source and toolchain changes", async t => {
  const directory = await fixture(t);
  for (const helper of nativeHelpers) {
    const before = await nativeArtifactKey(helper, toolchain, directory);
    const changedRust = { ...toolchain, rust: "new Rust" };
    const afterRust = await nativeArtifactKey(helper, changedRust, directory);
    const usesRust = helper.tools.includes("rust");
    assert.equal(afterRust === before, usesRust === false);
    const changedNdk = { ...toolchain, android: "new NDK" };
    const afterNdk = await nativeArtifactKey(helper, changedNdk, directory);
    const usesNdk = helper.tools.includes("android");
    assert.equal(afterNdk === before, usesNdk === false);
    const changedShared = { ...toolchain, shared: { ...toolchain.shared, cmake: "new CMake" } };
    const afterShared = await nativeArtifactKey(helper, changedShared, directory);
    assert.notEqual(afterShared, before);
    if (helper.name !== "ios-logs") {
      await put(directory, "native/ios-logs/source", "unrelated log change\n");
      const afterLogs = await nativeArtifactKey(helper, toolchain, directory);
      assert.equal(afterLogs, before);
    }
  }
});

test("native keys include the npm build command without hashing the package version", async t => {
  const directory = await fixture(t);
  const helper = nativeHelpers[0];
  const before = await nativeArtifactKey(helper, toolchain, directory);
  const text = await readFile(`${directory}/package.json`, "utf8");
  const metadata = JSON.parse(text);
  metadata.scripts[helper.command] += " --changed";
  const changed = JSON.stringify(metadata);
  await put(directory, "package.json", changed);
  const after = await nativeArtifactKey(helper, toolchain, directory);
  assert.notEqual(after, before);
});

function artifact(id: number, name = "exact-key") {
  return { id, name, expired: false, workflow_run: { id, head_repository_id: 1, repository_id: 1 } };
}

const successfulRun = { path: ".github/workflows/release.yml", event: "push", status: "completed", conclusion: "success" };

test("artifact lookup rejects expired, partial, failed, foreign and pull request artifacts", async () => {
  const candidates = [
    { ...artifact(9), expired: true },
    artifact(8, "exact-key-partial"),
    { ...artifact(7), workflow_run: { id: 7, head_repository_id: 2, repository_id: 1 } },
    artifact(6), artifact(5), artifact(4), artifact(3), artifact(2),
  ];
  const runs: Record<number, object> = {
    6: { ...successfulRun, event: "pull_request" },
    5: { ...successfulRun, conclusion: "failure" },
    4: { ...successfulRun, status: "in_progress", conclusion: null },
    3: { ...successfulRun, path: ".github/workflows/other.yml" },
    2: { ...successfulRun, event: "workflow_dispatch" },
  };
  const calls: string[] = [];
  async function request(path: string) {
    calls.push(path);
    if (path.startsWith("actions/artifacts?")) return { artifacts: candidates };
    const idText = path.split("/").at(-1);
    const id = Number(idText);
    return runs[id];
  }
  const found = await findNativeArtifact("exact-key", request);
  assert.equal(found.id, 2);
  for (const id of [7, 8, 9]) {
    const queried = calls.includes(`actions/runs/${id}`);
    assert.equal(queried, false);
  }
});

test("artifact lookup continues past a full page of unusable artifacts", async () => {
  const expired = Array.from({ length: 100 }, (_, id) => {
    const candidate = artifact(id);
    return { ...candidate, expired: true };
  });
  async function request(path: string) {
    if (path.endsWith("&page=1")) return { artifacts: expired };
    if (path.endsWith("&page=2")) return { artifacts: [artifact(101)] };
    return successfulRun;
  }
  const found = await findNativeArtifact("exact-key", request);
  assert.equal(found.id, 101);
});

test("native artifacts round-trip all helpers, matching symbols, support files and executable modes", async t => {
  const source = await fixture(t);
  const destination = await fixture(t);
  for (const helper of nativeHelpers) {
    await payload(source, helper);
    const key = await nativeArtifactKey(helper, toolchain, source);
    const archive = join(source, `${helper.name}.tar.gz`);
    await saveNativeArtifact(helper, key, archive, source);
    await put(destination, `vendor/${helper.name}/stale-file`, "obsolete\n");
    await restoreNativeArtifact(helper, key, archive, destination);
    const license = await readFile(`${destination}/vendor/${helper.name}/LICENSE`, "utf8");
    assert.equal(license, "license\n");
    const stale = stat(`${destination}/vendor/${helper.name}/stale-file`);
    await assert.rejects(stale, { code: "ENOENT" });
    for (const binary of helper.binaries) {
      if (binary.endsWith(".bundle")) continue;
      const binaryStat = await stat(`${destination}/vendor/${helper.name}/${binary}`);
      assert.equal(binaryStat.mode & 0o777, 0o755);
    }
    for (const symbol of helper.symbols) {
      const path = symbol.endsWith(".dSYM") ? `${symbol}/Contents/Resources/DWARF/program` : symbol;
      const contents = await readFile(`${destination}/${path}`, "utf8");
      assert.equal(contents, "matching symbols\n");
    }
  }
});

test("native artifacts reject mismatched keys and changed symbols before replacing binaries", async t => {
  const source = await fixture(t);
  const destination = await fixture(t);
  const helper = nativeHelpers[0];
  await payload(source, helper);
  await payload(destination, helper);
  const archive = join(source, "native.tar.gz");
  await saveNativeArtifact(helper, "expected", archive, source);
  const mismatch = restoreNativeArtifact(helper, "different", archive, destination);
  await assert.rejects(mismatch, /identity mismatch/);
  const staging = join(source, "unpacked");
  await mkdir(staging);
  execFileSync("tar", ["-xzf", archive, "-C", staging]);
  const symbolPath = `${helper.symbols[0]}/Contents/Resources/DWARF/program`;
  await put(staging, symbolPath, "wrong symbols\n");
  execFileSync("tar", ["-czf", archive, "-C", staging, ".native-artifact.json", "vendor/baguette", ...helper.symbols]);
  const corrupted = restoreNativeArtifact(helper, "expected", archive, destination);
  await assert.rejects(corrupted, /integrity check failed/);
  const original = await readFile(`${destination}/${symbolPath}`, "utf8");
  assert.equal(original, "matching symbols\n");
});

test("native artifacts require retained symbols even when their vendor files exist", async t => {
  const source = await fixture(t);
  const helper = nativeHelpers[0];
  await payload(source, helper);
  const symbol = join(source, helper.symbols[0]);
  await rm(symbol, { recursive: true });
  await mkdir(symbol);
  const archive = join(source, "native.tar.gz");
  const result = saveNativeArtifact(helper, "expected", archive, source);
  await assert.rejects(result, /missing matching symbols/);
});

test("cold builds produce artifacts and warm releases restore them without invoking the build", async t => {
  const directory = await fixture(t);
  const helper = nativeHelpers[0];
  const outputDirectory = join(directory, "artifacts");
  let builds = 0;
  let downloads = 0;
  async function build() { builds++; await payload(directory, helper); }
  async function noDownload() { assert.fail("Cold build should not download."); }
  async function miss() { return { artifacts: [] }; }
  const cold = await prepareNativeHelper(helper, { directory, toolchain, outputDirectory, request: miss, download: noDownload, build });
  assert.equal(cold.action, "built");
  assert.equal(builds, 1);
  const saved = join(directory, "saved.tar.gz");
  await copyFile(cold.archive, saved);
  const vendor = join(directory, "vendor/baguette");
  await rm(vendor, { recursive: true });
  async function hit(path: string) {
    if (path.startsWith("actions/artifacts?")) return { artifacts: [artifact(1, cold.key)] };
    return successfulRun;
  }
  async function download(candidate: object, archive: string) { downloads++; await copyFile(saved, archive); }
  const warm = await prepareNativeHelper(helper, { directory, toolchain, outputDirectory, request: hit, download, build });
  assert.equal(warm.action, "restored");
  assert.equal(builds, 1);
  assert.equal(downloads, 1);
  const binary = await readFile(`${directory}/vendor/baguette/Baguette`, "utf8");
  assert.equal(binary, "native binary\n");
});

test("artifact service errors stop a release instead of silently rebuilding", async t => {
  const directory = await fixture(t);
  const outputDirectory = join(directory, "artifacts");
  async function request() { throw new Error("GitHub unavailable"); }
  async function build() { assert.fail("Service failure must not trigger a build."); }
  const result = prepareNativeHelper(nativeHelpers[0], { directory, toolchain, outputDirectory, request, build });
  await assert.rejects(result, /GitHub unavailable/);
});

test("artifact downloads verify GitHub's ZIP digest and do not forward credentials to storage", async t => {
  const directory = await fixture(t);
  const helper = nativeHelpers[0];
  await payload(directory, helper);
  const archive = join(directory, "baguette.tar.gz");
  await saveNativeArtifact(helper, "key", archive, directory);
  const zip = join(directory, "artifact.zip");
  execFileSync("zip", ["-q", zip, "baguette.tar.gz"], { cwd: directory });
  const bytes = await readFile(zip);
  const hash = createHash("sha256");
  hash.update(bytes);
  const digest = hash.digest("hex");
  const candidate = { ...artifact(1), digest: `sha256:${digest}` };
  const environment = { GITHUB_API_URL: "https://api.github.com", GITHUB_REPOSITORY: "owner/repo", GH_TOKEN: "test-token" };
  let requests = 0;
  async function fetcher(url: string, options?: RequestInit) {
    requests++;
    if (url.startsWith("https://api.github.com/")) {
      assert.equal(url, "https://api.github.com/repos/owner/repo/actions/artifacts/1/zip");
      const headers = new Headers(options?.headers);
      const authorization = headers.get("Authorization");
      assert.equal(authorization, "Bearer test-token");
      assert.equal(options?.redirect, "manual");
      return new Response(null, { status: 302, headers: { location: "https://storage.example/archive" } });
    }
    assert.equal(options, undefined);
    return new Response(bytes);
  }
  const restored = join(directory, "download.tar.gz");
  await downloadNativeArtifact(candidate, restored, helper, environment, fetcher);
  assert.equal(requests, 2);
  const downloaded = await readFile(restored);
  const original = await readFile(archive);
  const identical = downloaded.equals(original);
  assert.equal(identical, true);
  const zeroDigest = "0".repeat(64);
  const corrupt = { ...candidate, digest: `sha256:${zeroDigest}` };
  const rejected = downloadNativeArtifact(corrupt, restored, helper, environment, fetcher);
  await assert.rejects(rejected, /download integrity check failed/);
});

test("artifact downloads reject missing digests and expired downloads", async t => {
  const directory = await fixture(t);
  const helper = nativeHelpers[0];
  const archive = join(directory, "baguette.tar.gz");
  const environment = { GITHUB_API_URL: "https://api.github.com", GITHUB_REPOSITORY: "owner/repo", GH_TOKEN: "test-token" };
  async function expired() { return new Response(null, { status: 410 }); }
  const missing = downloadNativeArtifact(artifact(1), archive, helper, environment, expired);
  await assert.rejects(missing, /no SHA-256 digest/);
  const original = artifact(1);
  const zeroDigest = "0".repeat(64);
  const candidate = { ...original, digest: `sha256:${zeroDigest}` };
  const rejected = downloadNativeArtifact(candidate, archive, helper, environment, expired);
  await assert.rejects(rejected, /HTTP 410/);
});
