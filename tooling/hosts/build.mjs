import { existsSync } from "node:fs";
import { copyFile, cp, mkdir, rm, writeFile } from "node:fs/promises";
import { build } from "esbuild";
import { buildCodexHost } from "../../apps/codex-plugin/tooling/build.mjs";
import { buildHost as buildClaudeHost } from "../../apps/claude/tooling/build.mjs";
import { agentDeviceCatalog } from "../agent-device-catalog.mjs";
import { buildServerBundles } from "../server-bundle.mjs";
import { buildUIPage } from "../ui-page.mjs";

/**
 * Builds every host target's server and page into `.host-tests/<target>`, plus the
 * browser host that loads them. Only the JavaScript is built, beside the helpers
 * committed to the repository that the server reads at startup; Baguette and the
 * device runtimes stay out. This runs on Linux, and the tests exercise what needs
 * no device. Claude's target lists agent-device's commands from the vendored runtime
 * (`npm run vendor:agent-device`).
 */
export const HOST_TESTS = ".host-tests";
const environment = "development";

async function runtime(target) {
  const directory = `${HOST_TESTS}/${target}`;
  await mkdir(directory, { recursive: true });
  await writeFile(`${directory}/telemetry-environment.json`, JSON.stringify({ environment }) + "\n");
  for (const helper of ["android-cpu", "android-fps", "ios-fps", "ios-logs", "ios-mirror"]) {
    await cp(`packages/native/vendor/${helper}`, `${directory}/${helper}`, { recursive: true });
  }
  return directory;
}

/** The shared MCP Apps panel, which Claude loads and the Mac server also serves. */
const sharedPage = output => buildUIPage({
  name: "host-tests/mcp-app", entry: "packages/mcp-app/src/main.tsx", template: "packages/mcp-app/src/index.html",
  sources: ["packages/ui/src", "packages/mcp-app/src"], output, environment, sourceURL: "app:///mobile-dev-ui.js",
});

const targets = {
  // Claude Desktop and Claude Code load Claude's server, without the panel, and the
  // shared page for its cards.
  async claude(directory) {
    await sharedPage(`${directory}/app.html`);
    if (existsSync("packages/runtimes/agent-device/node_modules/agent-device") === false) throw new Error("Run npm run vendor:agent-device to build Claude's target.");
    await mkdir(`${directory}/agent-device`, { recursive: true });
    await writeFile(`${directory}/agent-device/tools.json`, JSON.stringify(await agentDeviceCatalog("packages/runtimes/agent-device")));
    await buildClaudeHost(directory, { sentryDirectory: ".sentry/host-tests/claude" });
  },
  codex: directory => buildCodexHost(environment, directory),
  async mac(directory) {
    await sharedPage(`${directory}/app.html`);
    await buildUIPage({
      name: "host-tests/mac", entry: "apps/mac/web/main.tsx", template: "apps/mac/web/index.html",
      sources: ["packages/ui/src", "apps/mac/web"], output: `${directory}/mac.html`,
      environment, sourceURL: "app:///mobile-dev-mac-ui.js",
    });
    await buildServerBundles({ entryPoints: { server: "apps/mac/server/index.ts" }, outdir: directory, sentryDirectory: ".sentry/host-tests/mac" });
  },
};

// `node tooling/hosts/build.mjs codex` builds one target; no arguments builds all.
const selected = process.argv.length > 2 ? process.argv.slice(2) : Object.keys(targets);
for (const target of selected) {
  if (!(target in targets)) throw new Error(`Unknown target ${target}. Use ${Object.keys(targets).join(", ")}.`);
  await rm(`${HOST_TESTS}/${target}`, { recursive: true, force: true });
  await targets[target](await runtime(target));
}
await build({
  entryPoints: ["tooling/hosts/harness/host.ts"], outfile: `${HOST_TESTS}/harness/host.js`,
  bundle: true, format: "iife", platform: "browser", target: "chrome120",
});
await copyFile("tooling/hosts/harness/host.html", `${HOST_TESTS}/harness/host.html`);
console.log(`Built ${selected.join(", ")} into ${HOST_TESTS}.`);
