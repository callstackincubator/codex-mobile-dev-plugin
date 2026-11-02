import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dependencyLanes, laneOf, renderUpdates, reportLane } from "./dependency-lanes.mjs";
import { compare, parse, targets } from "./dependency-versions.mjs";

/**
 * Finds updates for every external dependency and, with `--apply`, applies the safe
 * ones: the newest release with the same major version, or the same minor for 0.x,
 * whose minor releases may break. Larger updates and dependencies that need a person
 * (forked sources, unreleased Git pins) are reported but left alone.
 *
 *   node tooling/update-dependencies.mjs [--apply] [--only <lane>] [--skip-workflows] [--report <file.md>] [--json <file.json>]
 *
 * `--only` limits the run to one lane of `tooling/dependency-lanes.mjs`, or to the
 * report-only `forks`. `--skip-workflows` reports GitHub Action updates without editing
 * workflow files, for tokens that may not push workflow changes. Native pins only
 * change here; the caller rebuilds the affected helpers (`tooling/release-native.mjs`
 * does that). `--json` writes the updates with their lanes.
 */
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const skipWorkflows = args.includes("--skip-workflows");
const option = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const reportPath = option("--report");
const jsonPath = option("--json");
const only = option("--only");
if (only !== undefined && only !== reportLane && !dependencyLanes.some(lane => lane.name === only)) throw new Error(`Unknown lane ${only}.`);
const wants = lane => only === undefined || only === lane;

/** One row of the report. `applied` is false for updates held back, with the reason. */
const updates = [];
function record(group, name, from, to, { applied = apply, reason, link, lane = laneOf(group) } = {}) {
  // A package in several manifests is one row.
  if (updates.some(update => update.group === group && update.name === name && update.from === from && update.to === to)) return;
  updates.push({ lane, group, name, from, to, applied, reason, link });
}

const run = (command, commandArgs, options = {}) => execFileSync(command, commandArgs, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...options });
const gh = (...commandArgs) => JSON.parse(run("gh", ["api", ...commandArgs]));
const readJson = path => JSON.parse(readFileSync(path, "utf8"));
const writeJson = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + "\n");

async function sha256(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not download ${url}: HTTP ${response.status}.`);
  return createHash("sha256").update(Buffer.from(await response.arrayBuffer())).digest("hex");
}

/** Reports a dependency's updates and returns the version to apply, if any. */
function choose(group, name, current, versions, link, lane) {
  const { latest, safe } = targets(current, versions);
  if (group === "agent-device" && name === "agent-device" && current === "0.21.33") {
    if (latest) record(group, name, current, latest, { applied: false, reason: "manual pin: upstream #3995 breaks iOS input with a stale Xcode selection link", link });
    return;
  }
  if (safe) record(group, name, current, safe, { link, lane });
  if (latest && latest !== safe) record(group, name, safe ?? current, latest, { applied: false, reason: "breaking version; update by hand", link, lane });
  return apply ? safe : undefined;
}

const releases = repository => gh(`repos/${repository}/releases?per_page=100`).filter(release => !release.draft && !release.prerelease).map(release => release.tag_name);

const npmVersions = new Map();
function versionsOf(name) {
  if (!npmVersions.has(name)) npmVersions.set(name, JSON.parse(run("npm", ["view", name, "versions", "--json"])));
  return npmVersions.get(name);
}

/** Updates direct dependencies in a package.json, keeping exact pins exact and ranges ranges. */
function updateManifest(path, group) {
  const manifest = readJson(path);
  let changed = false;
  for (const field of ["dependencies", "devDependencies"]) {
    for (const [name, spec] of Object.entries(manifest[field] ?? {})) {
      const match = /^([\^~]?)(\d+\.\d+\.\d+)$/.exec(spec);
      if (!match) continue;
      const next = choose(group, name, match[2], versionsOf(name), `https://www.npmjs.com/package/${name}?activeTab=versions`);
      if (next) { manifest[field][name] = `${match[1]}${next}`; changed = true; }
    }
  }
  if (changed) writeJson(path, manifest);
  return { manifest, changed };
}

const workspaceManifests = ["package.json", ...["packages", "apps"].flatMap(root => readdirSync(root)
  .map(name => join(root, name, "package.json")).filter(path => existsSync(path) && !path.startsWith("packages/runtimes")))];
if (wants("js")) {
  let workspaceChanged = false;
  for (const path of workspaceManifests) workspaceChanged = updateManifest(path, "npm").changed || workspaceChanged;
  if (workspaceChanged) run("npm", ["install", "--no-audit", "--no-fund"], { stdio: "inherit", env: { ...process.env, HUSKY: "0" } });

  // The device runtimes ship their own lockfiles; build.mjs checks agent-device against its manifest.
  for (const runtime of ["packages/runtimes/agent-device", "packages/runtimes/serve-emu"]) {
    const path = `${runtime}/package.json`;
    const { manifest, changed } = updateManifest(path, runtime.split("/").pop());
    if (!changed) continue;
    if (manifest.dependencies["agent-device"]) { manifest.version = manifest.dependencies["agent-device"]; writeJson(path, manifest); }
    run("npm", ["install", "--prefix", runtime, "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"], { stdio: "inherit" });
  }

  // GitHub Actions, pinned by commit with a `# vN` comment.

  for (const file of readdirSync(".github/workflows").map(name => `.github/workflows/${name}`)) {
    let text = readFileSync(file, "utf8");
    for (const [line, action, pinned, major] of [...text.matchAll(/uses: ([\w.-]+\/[\w.-]+)@([0-9a-f]{40}) # (v\d+)/g)]) {
      const tags = releases(action);
      const sameMajor = tags.filter(tag => tag.startsWith(`${major}.`) || tag === major).sort((a, b) => compare(parse(a) ?? [0, 0, 0], parse(b) ?? [0, 0, 0]));
      const newest = sameMajor.at(-1);
      const latestMajor = tags.map(tag => parse(tag)?.[0]).filter(Number.isInteger).sort((a, b) => a - b).at(-1);
      if (newest) {
        const ref = gh(`repos/${action}/git/ref/tags/${newest}`);
        const sha = ref.object.type === "tag" ? gh(`repos/${action}/git/tags/${ref.object.sha}`).object.sha : ref.object.sha;
        if (sha !== pinned && !updates.some(update => update.name === action && update.to === newest)) {
          const applied = apply && !skipWorkflows;
          record("github-actions", action, `${major} (${pinned.slice(0, 7)})`, newest, {
            applied, reason: applied ? undefined : apply ? "workflow files need a token with workflow permission" : undefined, link: `https://github.com/${action}/releases/tag/${newest}`,
          });
          if (applied) text = text.replaceAll(line, `uses: ${action}@${sha} # ${major}`);
        }
      }
      if (latestMajor > Number(major.slice(1)) && !updates.some(update => update.name === action && update.to === `v${latestMajor}`)) {
        record("github-actions", action, major, `v${latestMajor}`, { applied: false, reason: "breaking version; update by hand", link: `https://github.com/${action}/releases` });
      }
    }
    if (apply && !skipWorkflows) writeFileSync(file, text);
  }
}

if (wants("baguette")) {
  const path = "packages/native/vendor/baguette-release.json";
  const release = readJson(path);
  const next = choose("native", "Baguette", release.version, releases("tddworks/baguette"), "https://github.com/tddworks/baguette/releases", "baguette");
  if (next) {
    const version = next.replace(/^v/, "");
    const url = `https://github.com/tddworks/baguette/releases/download/v${version}/baguette_v${version}_macOS_arm64.tar.gz`;
    const commit = gh(`repos/tddworks/baguette/commits/v${version}`).sha;
    writeJson(path, { ...release, version, url, sha256: await sha256(url), source: `https://github.com/tddworks/baguette/tree/v${version}`,
      ...(release.rebuild ? { rebuild: { ...release.rebuild, sourceCommit: commit } } : {}) });
  }
}

if (wants("sentry-native")) {
  const path = "tooling/native-telemetry.mjs";
  let text = readFileSync(path, "utf8");
  const current = /NATIVE_SENTRY_VERSION = "([^"]+)"/.exec(text)[1];
  const next = choose("native", "sentry-native", current, releases("getsentry/sentry-native"), "https://github.com/getsentry/sentry-native/blob/master/CHANGELOG.md", "sentry-native");
  if (next) {
    const digest = await sha256(`https://github.com/getsentry/sentry-native/releases/download/${next}/sentry-native.zip`);
    text = text.replace(/NATIVE_SENTRY_VERSION = "[^"]+"/, `NATIVE_SENTRY_VERSION = "${next}"`).replace(/archiveSHA256 = "[0-9a-f]{64}"/, `archiveSHA256 = "${digest}"`);
    writeFileSync(path, text);
  }
}

if (wants("libimobiledevice")) {
  const path = "packages/native/ios-logs/dependencies.json";
  const dependencies = readJson(path);
  for (const dependency of dependencies) {
    const next = choose("native", dependency.name, dependency.version, releases(`libimobiledevice/${dependency.name}`), `https://github.com/libimobiledevice/${dependency.name}/releases`, "libimobiledevice");
    if (!next) continue;
    dependency.version = next;
    dependency.sha256 = await sha256(`https://github.com/libimobiledevice/${dependency.name}/releases/download/${next}/${dependency.name}-${next}.tar.bz2`);
  }
  // One dependency per line, as the file is written by hand.
  const line = dependency => `  { ${JSON.stringify(dependency).slice(1, -1).replaceAll('":', '": ').replaceAll(',"', ', "')} }`;
  if (apply) writeFileSync(path, `[\n${dependencies.map(line).join(",\n")}\n]\n`);
}

// Rust crates of the iPhone mirror, within their Cargo.toml ranges.
if (wants("ios-mirror-crates")) {
  if (apply) run("cargo", ["update", "--manifest-path", "packages/native/ios-mirror/Cargo.toml"], { stdio: "inherit" });
}

// Report-only: forks and Git pins a person merges by hand.

if (wants(reportLane)) {
  const upstream = readJson("packages/runtimes/serve-emu/upstream.json");
  const { latest } = targets(upstream.version, versionsOf("serve-emu"));
  if (latest) record("forked", "serve-emu", upstream.version, latest, { applied: false, reason: "our fork; merge upstream changes by hand", link: "https://github.com/jiunshinn/serve-emu/releases" });
  const scrcpy = targets(upstream.scrcpyVersion, releases("Genymobile/scrcpy")).latest;
  if (scrcpy) record("forked", "scrcpy server", upstream.scrcpyVersion, scrcpy, { applied: false, reason: "follows serve-emu", link: "https://github.com/Genymobile/scrcpy/releases" });
  const perfetto = readJson("packages/native/vendor/android-fps/release.json").perfettoVersion;
  const newest = targets(perfetto, releases("google/perfetto")).latest;
  if (newest) record("forked", "Perfetto SDK", `v${perfetto}`, newest, { applied: false, reason: "vendored source; update by hand", link: "https://github.com/google/perfetto/releases" });
  for (const [name, repository, readme] of [["idevice", "jkcoxson/idevice", "packages/native/ios-mirror/Cargo.toml"], ["device-hub-ios", "JaviSoto/device-hub-ios", "packages/native/ios-mirror/README.md"]]) {
    const rev = new RegExp(`${repository.replace("/", "\\/")}[^\\n]*?([0-9a-f]{40})`).exec(readFileSync(readme, "utf8"))?.[1];
    if (!rev) continue;
    const ahead = gh(`repos/${repository}/compare/${rev}...HEAD`).ahead_by;
    if (ahead > 0) record("forked", name, rev.slice(0, 7), `${ahead} commits newer`, { applied: false, reason: "unreleased Git pin; update by hand", link: `https://github.com/${repository}/compare/${rev}...HEAD` });
  }
}

const cargoChanges = apply && wants("ios-mirror-crates") ? run("git", ["diff", "--unified=0", "--", "packages/native/ios-mirror/Cargo.lock"]).split("\n").filter(line => /^[-+]version = /.test(line)).length / 2 : 0;
const report = renderUpdates(updates, { apply, cargoChanges });
if (reportPath) writeFileSync(reportPath, report || "No dependency updates.\n");
if (jsonPath) writeJson(jsonPath, { updates, cargoChanges });
console.log(report || "No dependency updates.");
