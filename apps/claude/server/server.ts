import { readFile } from "node:fs/promises";
import { runStdioServer } from "@mobile-dev/core/stdio-server.ts";
import { agentDeviceTools, readAgentDeviceCatalog } from "@mobile-dev/core/agent-device-tools.ts";
import { createPanel } from "@mobile-dev/core/panel-tools.ts";
import { browserPanel } from "@mobile-dev/core/browser-panel.ts";
import { downloadedPanelRuntime, panelRuntimeReleaseSchema, usePanelRuntime } from "@mobile-dev/core/panel-runtime.ts";

// Claude's server: the shared server with agent-device's commands and Mobile Dev's panel,
// which Claude Code shows in a browser beside the chat. The panel never renders inline,
// even in the desktop app's Code tab, which renders MCP Apps: every host gets the
// browser link, so the device stays beside the chat. The plugin directory's file limit
// leaves the panel's native parts out of the package; it pins their release archive in
// panel-runtime.json, which the server downloads on first use. Without that file, as in
// host tests, the parts sit beside the server.
const pinned = await readFile(new URL("./panel-runtime.json", import.meta.url), "utf8").catch(() => undefined);
if (pinned !== undefined) usePanelRuntime(downloadedPanelRuntime(panelRuntimeReleaseSchema.parse(JSON.parse(pinned))));
await runStdioServer({ panel: createPanel({ inline: false }), features: [agentDeviceTools(readAgentDeviceCatalog()), browserPanel({ always: true })] });
