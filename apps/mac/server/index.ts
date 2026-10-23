import "@mobile-dev/core/instrument.ts";
import { runStdioServer } from "@mobile-dev/core/stdio-server.ts";
import { macPage } from "./mac-page.ts";

// The Mac app's server: the shared server plus the page its window loads.
await runStdioServer([macPage]);
