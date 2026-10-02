import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { buildNativeSentry, nativeTelemetrySourceHash, nativeSentryLicense } from "./native-telemetry.mjs";

export async function iosLogsSourceHash() {
  const hash = createHash("sha256");
  for (const file of ["collector.c", "dependencies.json"]) {
    const bytes = await readFile(`native/ios-logs/${file}`);
    hash.update(file);
    hash.update(bytes);
  }
  const script = await readFile("scripts/build-ios-logs.mjs");
  hash.update(script);
  await nativeTelemetrySourceHash(hash);
  return hash.digest("hex");
}

const buildScriptPath = resolve("scripts/build-ios-logs.mjs");
const executedScriptPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (executedScriptPath === buildScriptPath) {
  if (process.platform !== "darwin" || process.arch !== "arm64") throw new Error("Build the physical iOS log reader on an Apple Silicon Mac.");
  const root = resolve(".local-dev/ios-logs");
  const prefix = `${root}/prefix`;
  const output = resolve("vendor/ios-logs");
  const openssl = process.env.MOBILE_DEV_OPENSSL_PREFIX ?? "/opt/homebrew/opt/openssl@3";
  const sdk = await buildNativeSentry();
  const sslVersion = execFileSync(`${openssl}/bin/openssl`, ["version"], { encoding: "utf8" });
  const sslVersionText = sslVersion.trim();
  const environment = { ...process.env, PKG_CONFIG_PATH: `${prefix}/lib/pkgconfig:${openssl}/lib/pkgconfig`,
    CFLAGS: "-O2 -arch arm64 -mmacosx-version-min=14.0", LDFLAGS: "-arch arm64 -mmacosx-version-min=14.0" };
  const dependenciesText = await readFile("native/ios-logs/dependencies.json", "utf8");
  const dependencies = JSON.parse(dependenciesText);
  await rm(prefix, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
  const licenses = [];
  const sources = [];
  for (const dependency of dependencies) {
    const name = `${dependency.name}-${dependency.version}`;
    const url = `https://github.com/libimobiledevice/${dependency.name}/releases/download/${dependency.version}/${name}.tar.bz2`;
    const response = await fetch(url);
    if (response.ok === false) throw new Error(`Could not download ${url}: HTTP ${response.status}.`);
    const archive = await response.arrayBuffer();
    const bytes = Buffer.from(archive);
    const hash = createHash("sha256");
    hash.update(bytes);
    const sha256 = hash.digest("hex");
    if (sha256 !== dependency.sha256) throw new Error(`Source integrity check failed for ${name}.`);
    const archivePath = `${root}/${name}.tar.bz2`;
    await writeFile(archivePath, bytes);
    const directory = `${root}/${name}`;
    await rm(directory, { recursive: true, force: true });
    execFileSync("tar", ["-xjf", archivePath, "-C", root]);
    console.log(`Building ${name}…`);
    execFileSync(`${directory}/configure`, [`--prefix=${prefix}`, "--disable-static", ...dependency.configure], { cwd: directory, env: environment, stdio: "inherit" });
    execFileSync("make", ["-j4"], { cwd: directory, env: environment, stdio: "inherit" });
    execFileSync("make", ["install"], { cwd: directory, env: environment, stdio: "inherit" });
    const copying = await readFile(`${directory}/COPYING`, "utf8");
    licenses.push(`${name}\n${url}\n\n${copying}`);
    sources.push({ name: dependency.name, version: dependency.version, url, sha256 });
  }
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  await mkdir(`${output}/sources`, { recursive: true });
  for (const dependency of dependencies) {
    const file = `${dependency.name}-${dependency.version}.tar.bz2`;
    await copyFile(`${root}/${file}`, `${output}/sources/${file}`);
  }
  const flagsText = execFileSync("pkg-config", ["--cflags", "--libs", "libimobiledevice-1.0"], { env: environment, encoding: "utf8" });
  const trimmedFlags = flagsText.trim();
  const flags = trimmedFlags.split(/\s+/);
  const executable = `${output}/mobile-dev-ios-logs`;
  execFileSync("clang", ["-std=c11", "-O2", "-g", "-Wall", "-Wextra", "-Werror", "-arch", "arm64", "-mmacosx-version-min=14.0",
    "-DSENTRY_BUILD_STATIC=1", "-I", sdk.include, "native/ios-logs/collector.c", "native/telemetry/telemetry.c",
    sdk.library, "-lcurl", ...flags, "-o", executable], { stdio: "inherit" });
  const symbols = resolve(".sentry/native/darwin-arm64/mobile-dev-ios-logs.dSYM");
  await mkdir(".sentry/native/darwin-arm64", { recursive: true });
  await rm(symbols, { recursive: true, force: true });
  await rename(`${executable}.dSYM`, symbols);
  execFileSync("strip", ["-x", executable]);
  const libraryFiles = await readdir(`${prefix}/lib`);
  const libraries = new Map();
  for (const file of libraryFiles) {
    if (file.endsWith(".dylib") === false || file.startsWith("libplist++")) continue;
    const path = await realpath(`${prefix}/lib/${file}`);
    const name = basename(path);
    libraries.set(name, path);
  }
  for (const file of ["libssl.3.dylib", "libcrypto.3.dylib"]) {
    const path = await realpath(`${openssl}/lib/${file}`);
    const name = basename(path);
    libraries.set(name, path);
  }
  const sslLicense = await readFile(`${openssl}/LICENSE.txt`, "utf8");
  licenses.push(`${sslVersionText}\nhttps://www.openssl.org/\n\n${sslLicense}`);
  for (const [name, source] of libraries) await copyFile(source, `${output}/${name}`);
  const binaries = {};
  for (const file of ["mobile-dev-ios-logs", ...libraries.keys()]) {
    const path = `${output}/${file}`;
    const linked = execFileSync("otool", ["-L", path], { encoding: "utf8" });
    const trimmedLinks = linked.trim();
    const linkLines = trimmedLinks.split("\n");
    const lines = linkLines.slice(1);
    for (const line of lines) {
      const trimmedLine = line.trim();
      const parts = trimmedLine.split(" ");
      const dependency = parts[0];
      const name = basename(dependency);
      if (libraries.has(name)) execFileSync("install_name_tool", ["-change", dependency, `@loader_path/${name}`, path]);
      else if (dependency.startsWith("/System/") === false && dependency.startsWith("/usr/lib/") === false) {
        throw new Error(`Unbundled native dependency: ${dependency}`);
      }
    }
    if (file.endsWith(".dylib")) execFileSync("install_name_tool", ["-id", `@loader_path/${file}`, path]);
    execFileSync("codesign", ["--force", "--sign", "-", path], { stdio: "inherit" });
    const bytes = await readFile(path);
    const hash = createHash("sha256");
    hash.update(bytes);
    binaries[file] = { sha256: hash.digest("hex"), bytes: bytes.length };
  }
  const licenseText = licenses.join("\n\n====================\n\n");
  await writeFile(`${output}/third-party-licenses.txt`, licenseText);
  const sourceSHA256 = await iosLogsSourceHash();
  const sentryLicense = await nativeSentryLicense();
  await writeFile(`${output}/SENTRY-LICENSE.txt`, sentryLicense);
  const releaseText = JSON.stringify({ name: "mobile-dev-ios-logs", target: "darwin-arm64", sourceSHA256,
    sources, openssl: sslVersionText, binaries }, null, 2);
  await writeFile(`${output}/release.json`, `${releaseText}\n`);
  console.log("Built the bundled physical iOS unified-log reader.");
}
