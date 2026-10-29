import "@mobile-dev/core/instrument.ts";
import { runStdioServer } from "@mobile-dev/core/stdio-server.ts";
import { createPanel } from "@mobile-dev/core/panel-tools.ts";
import { macPage } from "./mac-page.ts";

// The Mac app's server: the shared server with Mobile Dev's panel, plus the page its window loads.
await runStdioServer({ features: [createPanel(), macPage] });
