import "@mobile-dev/core/instrument.ts";
import { readFile } from "node:fs/promises";
import { useDownloadedTestingRuntime } from "@mobile-dev/core/e2e-runtime.ts";
import { panelRuntimeReleaseSchema } from "@mobile-dev/core/panel-runtime.ts";
import { runStdioServer } from "@mobile-dev/core/stdio-server.ts";
import { createPanel } from "@mobile-dev/core/panel-tools.ts";
import { agentDeviceTools, readAgentDeviceCatalog } from "@mobile-dev/core/agent-device-tools.ts";
import { browserPanel } from "@mobile-dev/core/browser-panel.ts";
import { panelPlacement } from "@mobile-dev/core/panel-placement.ts";
import { codexUpdates } from "./codex-updates.ts";
import { panelSelection } from "./panel-selection.ts";

// Codex's server: the shared server with Mobile Dev's panel and agent-device's commands, plus
// the updater for Codex plugin installs.
if (!process.env.MOBILE_DEV_E2E_RUNTIME?.trim()) {
  const pin = new URL("./testing-runtime.json", import.meta.url);
  const source = await readFile(pin, "utf8");
  const metadata: unknown = JSON.parse(source);
  const release = panelRuntimeReleaseSchema.parse(metadata);
  useDownloadedTestingRuntime(release);
}
const inline = panelPlacement("inline") === "inline";
const panelContext = inline ? panelSelection : browserPanel({ always: true });
const features = [agentDeviceTools(readAgentDeviceCatalog()), codexUpdates, panelContext];
await runStdioServer({ panel: createPanel({ inline }), features });
