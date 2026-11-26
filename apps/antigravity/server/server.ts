import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { runStdioServer } from "@mobile-dev/core/stdio-server.ts";
import { agentDeviceTools, readAgentDeviceCatalog } from "@mobile-dev/core/agent-device-tools.ts";
import { createPanel } from "@mobile-dev/core/panel-tools.ts";
import { browserPanel } from "@mobile-dev/core/browser-panel.ts";
import { downloadedPanelRuntime, panelRuntimeReleaseSchema, usePanelRuntime } from "@mobile-dev/core/panel-runtime.ts";

const isStandalone = process.env.MOBILE_DEV_SIDECAR_STANDALONE === "1";
const stateFile = isStandalone ? "antigravity-standalone.json" : "antigravity-panel.json";
const statePath = join(homedir(), "Library", "Caches", "mobile-dev", stateFile);
let lastWrittenUrl = "";
let writeQueue: Promise<void> = Promise.resolve();

function writePanelState(url: string) {
  if (url === lastWrittenUrl) return;
  lastWrittenUrl = url;
  const run = async () => {
    try {
      await mkdir(dirname(statePath), { recursive: true });
      const tmpPath = `${statePath}.${process.pid}.tmp`;
      await writeFile(tmpPath, JSON.stringify({ pid: process.pid, url, updatedAt: Date.now() }) + "\n");
      await rename(tmpPath, statePath);
    } catch {}
  };
  writeQueue = writeQueue.then(run, run);
  return writeQueue;
}

const pinned = await readFile(new URL("./panel-runtime.json", import.meta.url), "utf8").catch(() => undefined);
if (pinned !== undefined) {
  const metadata: unknown = JSON.parse(pinned);
  const release = panelRuntimeReleaseSchema.parse(metadata);
  const download = downloadedPanelRuntime(release);
  usePanelRuntime(download.ensure);
}
await runStdioServer({
  panel: createPanel({ inline: false }),
  features: [
    agentDeviceTools(readAgentDeviceCatalog()),
    browserPanel({
      always: true,
      onPage: writePanelState,
      instructions: url => `Mobile Dev's panel is a page to show beside the chat, not in it. In Antigravity, the Mobile Dev Auxiliary Pane renders this panel automatically; include the toggle pill [Mobile Dev](sidecar://mobile-dev/device-panel/) in your reply so the user can open it with one click, and never open ${url} in an external Chrome browser or browser subagent. The page shares the user's devices and what they add to chat through mobile_read_panel_context; read it before device work.`,
    }),
  ],
});
