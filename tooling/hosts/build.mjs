import { copyFile, cp, mkdir, rm, writeFile } from "node:fs/promises";
import { build } from "esbuild";
import { stageRuntime } from "../host-runtime.mjs";
import { appHost, buildHost, hosts } from "../plugin-hosts.mjs";
import { buildSharedServer } from "../server-bundle.mjs";
import { buildSharedPage } from "../ui-page.mjs";
import { nativeHelpers } from "../native-helpers.mjs";

/**
 * Builds every host target's server and page into `.host-tests/<target>`, plus the
 * browser host that loads them, the way the package steps do: each target is a copy
 * of the shared runtime that its app's `buildHost` builds its own parts into. Only the
 * JavaScript is built, beside the helpers committed to the repository that the server
 * reads at startup; Baguette and the device runtimes stay out. This runs on Linux, and
 * the tests exercise what needs no device. Sentry files stay under `.sentry/host-tests`,
 * apart from the release's.
 */
export const HOST_TESTS = ".host-tests";
const environment = "development";
const sentryRoot = ".sentry/host-tests";
const shared = `${HOST_TESTS}/runtime`;

/** The shared runtime's JavaScript, as `npm run build` writes it to `dist/`. */
async function sharedRuntime() {
  await rm(shared, { recursive: true, force: true });
  await mkdir(shared, { recursive: true });
  await writeFile(`${shared}/telemetry-environment.json`, JSON.stringify({ environment }) + "\n");
  for (const { name: helper } of nativeHelpers.filter(entry => entry.committed)) {
    await cp(`packages/native/vendor/${helper}`, `${shared}/${helper}`, { recursive: true });
  }
  // The agent-device commands every host's server registers.
  await mkdir(`${shared}/agent-device`, { recursive: true });
  await copyFile("packages/runtimes/agent-device/tools.json", `${shared}/agent-device/tools.json`);
  await buildSharedPage({ output: `${shared}/app.html`, environment, sentryRoot });
  await buildSharedServer({ outdir: shared, sentryRoot });
}

// `node tooling/hosts/build.mjs codex` builds one target; no arguments builds all.
const selected = process.argv.length > 2 ? process.argv.slice(2) : Object.keys(hosts);
for (const target of selected) appHost(target);
await rm(sentryRoot, { recursive: true, force: true });
await sharedRuntime();
for (const target of selected) {
  const host = appHost(target);
  const directory = `${HOST_TESTS}/${target}`;
  await rm(directory, { recursive: true, force: true });
  await stageRuntime(directory, { panel: host.panel, runtime: shared });
  await buildHost(host, { outdir: directory, environment, sentryRoot });
}
await rm(shared, { recursive: true, force: true });
await build({
  entryPoints: ["tooling/hosts/harness/host.ts"], outfile: `${HOST_TESTS}/harness/host.js`,
  bundle: true, format: "iife", platform: "browser", target: "chrome120",
});
await copyFile("tooling/hosts/harness/host.html", `${HOST_TESTS}/harness/host.html`);
console.log(`Built ${selected.join(", ")} into ${HOST_TESTS}.`);
