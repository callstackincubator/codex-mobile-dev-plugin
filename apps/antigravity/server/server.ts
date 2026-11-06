import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { runStdioServer } from "@mobile-dev/core/stdio-server.ts";
import { agentDeviceTools, readAgentDeviceCatalog } from "@mobile-dev/core/agent-device-tools.ts";
import { createPanel } from "@mobile-dev/core/panel-tools.ts";
import { browserPanel } from "@mobile-dev/core/browser-panel.ts";
import { downloadedPanelRuntime, panelRuntimeReleaseSchema, usePanelRuntime } from "@mobile-dev/core/panel-runtime.ts";

const stateFile = process.env.MOBILE_DEV_SIDECAR_STANDALONE === "1"
  ? "antigravity-standalone.json"
  : "antigravity-panel.json";
const statePath = join(homedir(), "Library", "Caches", "mobile-dev", stateFile);

async function writePanelState(url: string) {
  try {
    await mkdir(dirname(statePath), { recursive: true });
    await writeFile(statePath, JSON.stringify({ pid: process.pid, url, updatedAt: Date.now() }) + "\n");
  } catch {}
}

const pinned = await readFile(new URL("./panel-runtime.json", import.meta.url), "utf8").catch(() => undefined);
if (pinned !== undefined) usePanelRuntime(downloadedPanelRuntime(panelRuntimeReleaseSchema.parse(JSON.parse(pinned))));
await runStdioServer({
  panel: createPanel({ inline: false }),
  features: [
    agentDeviceTools(readAgentDeviceCatalog()),
    browserPanel({
      always: true,
      onPage: writePanelState,
      instructions: url => `Mobile Dev's panel is a page to show beside the chat, not in it. In Antigravity, the Mobile Dev Auxiliary Pane (sidecar "mobile-dev.device-panel") renders ${url} automatically; you can also surface a toggle pill for "mobile-dev.device-panel" or open ${url} if needed. The page shares the user's devices and what they add to chat through mobile_read_panel_context; read it before device work.`,
    }),
  ],
});
