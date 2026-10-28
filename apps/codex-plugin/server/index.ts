import "@mobile-dev/core/instrument.ts";
import { runStdioServer } from "@mobile-dev/core/stdio-server.ts";
import { createPanel } from "@mobile-dev/core/panel-tools.ts";
import { codexUpdates } from "./codex-updates.ts";

// Codex's server: the shared server with Mobile Dev's panel, plus the updater for Codex plugin installs.
await runStdioServer({ panel: createPanel(), features: [codexUpdates] });
