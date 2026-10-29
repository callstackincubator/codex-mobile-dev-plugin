import "@mobile-dev/core/instrument.ts";
import { runStdioServer } from "@mobile-dev/core/stdio-server.ts";
import { createPanel } from "@mobile-dev/core/panel-tools.ts";
import { macTelemetry } from "./mac-telemetry.ts";

// The Mac app's server: the shared server with Mobile Dev's panel, plus the telemetry metadata its page reads.
await runStdioServer({ features: [createPanel(), macTelemetry], telemetryHost: "mac" });
