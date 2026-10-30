import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, readFile, readdir } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import { PANEL_PARTS, RELEASE_DOCUMENTS, runtimeFiles } from "../host-runtime.mjs";
import { foreignPaths } from "../plugin-hosts.mjs";

// The checks every host's package smoke test makes of what it ships, before the
// host's own checks of its manifest, launcher and server.

const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

/**
 * The runtime files a package ships, relative to its runtime folder (`dist/`). A host
 * whose package leaves the panel's parts out (`bundlesPanel` false) while its server
 * keeps the panel pins their archive in `panel-runtime.json` instead.
 */
export function runtimePayloadFiles({ panel, bundlesPanel = panel }) {
  return [
    ...runtimeFiles({ panel: bundlesPanel }), "telemetry-environment.json", "ios-fps/third-party-licenses.txt", "ios-logs/release.json",
    ...bundlesPanel ? ["baguette/Baguette_Baguette.bundle/Web", "serve-emu/release.json"] : [],
    ...panel && !bundlesPanel ? ["panel-runtime.json"] : [],
  ];
}

/**
 * Checks a packaged runtime folder: its files, the environment it was built for, no
 * baked-in telemetry identity, and that its native helpers and bundled runtimes load
 * from where the package put them. Hosts without the panel, or that download its
 * parts, ship none of them.
 */
export async function assertRuntimePayload(runtime, { panel, bundlesPanel = panel }) {
  for (const path of runtimePayloadFiles({ panel, bundlesPanel })) await access(join(runtime, path));
  if (bundlesPanel === false) for (const part of PANEL_PARTS) await assert.rejects(access(join(runtime, part)), part);
  const { environment } = JSON.parse(await readFile(join(runtime, "telemetry-environment.json"), "utf8"));
  assert.ok(environment === "development" || environment === "release", `Unexpected telemetry environment ${environment}.`);
  const html = await readFile(join(runtime, "app.html"), "utf8");
  assert.ok(html.includes(`name="mobile-dev-environment" content="${environment}"`));
  assert.equal(/<meta name="mobile-dev-(?:user|session)-id"/.test(html), false, "Packages must contain no installation or session identity.");

  // The physical iOS log reader loads its bundled libraries, and its dependency sources ship beside it.
  const iosLogs = JSON.parse(await readFile(join(runtime, "ios-logs/release.json"), "utf8"));
  for (const source of iosLogs.sources) await access(join(runtime, `ios-logs/sources/${source.name}-${source.version}.tar.bz2`));
  const unavailablePhone = spawnSync(join(runtime, "ios-logs/mobile-dev-ios-logs"), ["--device", "00000000-0000000000000000", "usb"], { encoding: "utf8", timeout: 5000 });
  assert.equal(unavailablePhone.error, undefined);
  assert.equal(unavailablePhone.status, 1);
  assert.match(unavailablePhone.stderr, /unavailable to libimobiledevice/);
  const cpuLicense = await readFile(join(runtime, "android-cpu/LICENSE"), "utf8");
  assert.ok(cpuLicense.includes("Copyright (c) 2022 BAM"));
  if (bundlesPanel === false) return;

  // Baguette ships without the 3D model assets the panel never shows.
  const baguetteResources = await readdir(join(runtime, "baguette/Baguette_Baguette.bundle"));
  assert.equal(baguetteResources.includes("Models3D"), false, "Baguette's unused Models3D assets must stay out of the package.");

  const mirrorProbe = "const mirror = require(process.argv[1]); if (typeof mirror.openDevice !== 'function') process.exit(1);";
  const mirror = spawnSync(process.execPath, ["-e", mirrorProbe, join(runtime, "ios-mirror/darwin-arm64.node")], { encoding: "utf8" });
  assert.equal(mirror.status, 0, mirror.stderr);
  // serve-emu runs on Node from its own files, with the patched scrcpy client its release records.
  const serveEmu = join(runtime, "serve-emu");
  const androidRelease = JSON.parse(await readFile(join(serveEmu, "release.json"), "utf8"));
  const scrcpyClient = await readFile(join(serveEmu, "src/scrcpy.ts"));
  assert.match(scrcpyClient.toString(), /Modified for Mobile Dev/);
  assert.equal(androidRelease.scrcpyClientSHA256, sha256(scrcpyClient));
  assert.equal(androidRelease.runtime, "node");
  assert.equal(androidRelease.entryPoint, "src/cli.mjs");
  const androidCli = join(serveEmu, androidRelease.entryPoint);
  assert.equal(androidRelease.cliSHA256, sha256(await readFile(androidCli)));
  const androidHelp = execFileSync(process.execPath, [androidCli, "--help"], { encoding: "utf8", env: { ...process.env, PATH: "/usr/bin:/bin", BUN_PATH: "/missing/bun" } });
  assert.match(androidHelp, /host an Android device/);
  await assert.rejects(access(join(serveEmu, "node_modules/patch-package")), { code: "ENOENT" });
}

/**
 * Checks a plugin folder against what its host declares: the runtime payload, the
 * documents, its skills (with their `agents/` display metadata only for a host that
 * keeps it), no symlinks for a host that rejects them, and none of another host's
 * manifest or launcher files.
 */
export async function assertPluginFolder(plugin, host) {
  await assertRuntimePayload(join(plugin, "dist"), { panel: host.panel, bundlesPanel: host.bundlesPanel });
  for (const path of RELEASE_DOCUMENTS) await access(join(plugin, path));
  if (host.readme) assert.equal(await readFile(join(plugin, "README.md"), "utf8"), await readFile(host.readme, "utf8"));
  for (const skill of host.skills) await access(join(plugin, "skills", basename(skill), "SKILL.md"));
  await access(join(plugin, "skills/agent-device/references/workflow.md"));
  for (const entry of await readdir(plugin, { recursive: true, withFileTypes: true })) {
    const path = relative(plugin, join(entry.parentPath, entry.name));
    if (host.symlinks !== true) assert.equal(entry.isSymbolicLink(), false, `${path} is a symlink`);
    if (host.keepSkillAgents !== true) assert.doesNotMatch(path, /^skills\/[^/]+\/agents$/);
  }
  if (host.keepSkillAgents) for (const skill of host.skills) await access(join(plugin, "skills", basename(skill), "agents"));
  for (const path of foreignPaths(host.name)) await assert.rejects(access(join(plugin, path)), path);
}
