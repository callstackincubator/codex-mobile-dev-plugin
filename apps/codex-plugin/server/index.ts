import "@mobile-dev/core/instrument.ts";
import { runStdioServer } from "@mobile-dev/core/stdio-server.ts";
import { createPanel } from "@mobile-dev/core/panel-tools.ts";
import { agentDeviceTools, readAgentDeviceCatalog } from "@mobile-dev/core/agent-device-tools.ts";
import { browserPanel } from "@mobile-dev/core/browser-panel.ts";
import { panelPlacement } from "@mobile-dev/core/panel-placement.ts";
import { codexUpdates } from "./codex-updates.ts";

// Codex's server: the shared server with Mobile Dev's panel and agent-device's commands, plus
// the updater for Codex plugin installs.
const inline = panelPlacement("inline") === "inline";
const features = [agentDeviceTools(readAgentDeviceCatalog()), codexUpdates];
await runStdioServer({ panel: createPanel({ inline }), features: inline ? features : [...features, browserPanel({ always: true })] });
