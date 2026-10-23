import { execFileSync } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { telemetryBuildEnvironment } from "./telemetry-build.mjs";

export async function packageEditor(host) {
  if (host !== "cursor" && host !== "vscode") throw new Error("Unsupported editor host.");
  telemetryBuildEnvironment();
  // Retain the canonical native inventory, licenses and environment checks.
  execFileSync(process.execPath, ["scripts/package.mjs", ...process.argv.slice(2)], { stdio: "inherit" });
  const { version } = JSON.parse(await readFile("package.json", "utf8"));
  const source = resolve("release/marketplace/plugins/mobile-dev");
  const directory = resolve(`release/${host}/mobile-dev`);
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
  for (const path of ["dist", "THIRD_PARTY_NOTICES.md", "PRIVACY.md", "TERMS.md", "SUPPORT.md"]) {
    await cp(`${source}/${path}`, `${directory}/${path}`, { recursive: true, verbatimSymlinks: true });
  }
  await cp(`integrations/${host}`, directory, { recursive: true });
  await cp(`docs/${host}.md`, `${directory}/README.md`);
  await cp("scripts/local-host-config.mjs", `${directory}/local-host-config.mjs`);
  await writeFile(`${directory}/configure.mjs`, `import { localHostConfig } from "./local-host-config.mjs";\nconsole.log(JSON.stringify(await localHostConfig(${JSON.stringify(host)}, import.meta.dirname), null, 2));\n`);
  if (host === "cursor") {
    const path = `${directory}/.cursor-plugin/plugin.json`;
    const manifest = JSON.parse(await readFile(path, "utf8"));
    manifest.version = version;
    await writeFile(path, JSON.stringify(manifest, null, 2) + "\n");
  }
  const archive = resolve(`release/mobile-dev-${version}-${host}-darwin-arm64.zip`);
  await rm(archive, { force: true });
  execFileSync("zip", ["-qr", archive, "."], { cwd: directory });
  execFileSync("unzip", ["-tq", archive], { stdio: "inherit" });
  console.log(`${host} development bundle: ${archive}`);
}
