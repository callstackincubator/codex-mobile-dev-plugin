import "@mobile-dev/core/instrument.ts";
import { runStdioServer } from "@mobile-dev/core/stdio-server.ts";
import { codexUpdates } from "./codex-updates.ts";

// Codex's server: the shared server plus the updater for Codex plugin installs.
await runStdioServer([codexUpdates]);
