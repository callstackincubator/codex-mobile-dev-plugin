import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { browserPanel, createPanel, downloadedPanelRuntime, panelRuntimeReleaseSchema, runStdioServer, SharedTransport, usePanelRuntime } from "@mobile-dev/core";

const pin = new URL("./panel-runtime.json", import.meta.url);
usePanelRuntime(async () => {
  const release = panelRuntimeReleaseSchema.parse(JSON.parse(await readFile(pin, "utf8")));
  const runtime = downloadedPanelRuntime(release);
  usePanelRuntime(runtime);
  return runtime();
});

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

export async function runServer() {
  await runStdioServer(transport => {
    const connections = new SharedTransport(transport);
    const panel = createPanel({ inline: false });
    const features = [
      browserPanel({
        always: true,
        onPage: writePanelState,
        instructions: url => `Mobile Dev's panel is a page to show beside the chat, not in it. In Antigravity, the Mobile Dev Auxiliary Pane (sidecar "mobile-dev.device-panel") renders ${url} automatically; you can also surface a toggle pill for "mobile-dev.device-panel" or open ${url} if needed. The page shares the user's devices and what they add to chat through mobile_read_panel_context; read it before device work.`,
      }),
    ];
    return { transport: connections, options: { panel, features, connections } };
  });
}
