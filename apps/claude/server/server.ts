import { readFile } from "node:fs/promises";
import { runStdioServer } from "@mobile-dev/core/stdio-server.ts";
import { agentDeviceTools, readAgentDeviceCatalog } from "@mobile-dev/core/agent-device-tools.ts";
import { createPanel } from "@mobile-dev/core/panel-tools.ts";
import { downloadedPanelRuntime, panelRuntimeReleaseSchema, usePanelRuntime } from "@mobile-dev/core/panel-runtime.ts";

// Claude's server uses the shared native MCP Apps panel and agent-device tools.
// The plugin directory's file limit leaves the panel's native parts out of the
// package. It pins their release archive in panel-runtime.json for download on
// first use. Without that file, as in host tests, the parts sit beside the server.
const pinned = await readFile(new URL("./panel-runtime.json", import.meta.url), "utf8").catch(() => undefined);
if (pinned !== undefined) usePanelRuntime(downloadedPanelRuntime(panelRuntimeReleaseSchema.parse(JSON.parse(pinned))));
await runStdioServer({ panel: createPanel(), features: [agentDeviceTools(readAgentDeviceCatalog())] });
